/**
 * Rate Limiting Middleware
 * 
 * [SECURITY CHECKLIST §1.4] Rate Limiting for Logins (and all endpoints)
 * 
 * Protects against brute-force attacks and DoS by limiting request rates.
 * 
 * Security Features:
 * - IP-based rate limiting
 * - Separate limits for different endpoint sensitivities
 * - Progressive lockout for repeated violations
 * - Proper headers to inform clients of limit status
 * 
 * Rate Limiting Strategy:
 * 1. General API: Liberal limits for normal usage
 * 2. Authentication: Strict limits to prevent credential stuffing
 * 3. Account Creation: Moderate limits to prevent spam accounts
 * 
 * Note: When behind a reverse proxy (nginx, load balancer), ensure:
 * - app.set('trust proxy', 1) is configured in Express
 * - X-Forwarded-For header is properly set by the proxy
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';

const isTest = process.env.NODE_ENV === 'test';

/**
 * Custom key generator for rate limiting.
 * Uses X-Forwarded-For when behind a proxy, falls back to direct IP.
 * 
 * Security Note: Ensure your proxy is configured correctly to prevent
 * IP spoofing via X-Forwarded-For header manipulation.
 */
const getClientIP = (req: Request): string => {
  // Get forwarded IP (when behind proxy) or direct IP
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    // X-Forwarded-For can contain multiple IPs; the first is the client
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

type AuthenticatedRateLimitRequest = Request & {
  user?: {
    userId?: string;
    id?: string;
    role?: string;
  };
  rateLimit?: {
    resetTime?: Date;
  };
};

const getAuthenticatedAccountKey = (req: Request): string => {
  const authenticatedRequest = req as AuthenticatedRateLimitRequest;
  const userId = authenticatedRequest.user?.userId || authenticatedRequest.user?.id;
  const role = authenticatedRequest.user?.role || 'authenticated';
  return userId ? `${role}:${userId}` : `ip:${getClientIP(req)}`;
};

const getRetryAfterSeconds = (req: Request, res: Response, fallbackSeconds: number): number => {
  const resetTime = (req as AuthenticatedRateLimitRequest).rateLimit?.resetTime;
  if (resetTime) {
    return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
  }

  const retryAfterHeader = Number(res.getHeader('Retry-After'));
  return Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? Math.ceil(retryAfterHeader)
    : fallbackSeconds;
};

/**
 * General Rate Limiter
 * [SECURITY CHECKLIST §1.4] Global rate limiting — 5,000 req / 15 min per IP
 * 
 * Applied to all API routes to prevent abuse.
 * The broad IP safety net is deliberately high because barangay deployments
 * commonly place many authenticated residents behind one shared connection.
 * 
 * This is a baseline protection; specific endpoints have stricter limits.
 */
export const generalRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: isTest ? 10000 : 5000,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers (deprecated)
  keyGenerator: getClientIP,
  handler: (req: Request, res: Response) => {
    const retryAfterSeconds = getRetryAfterSeconds(req, res, 15 * 60);
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many requests from this IP. Please try again later.',
      retryAfterSeconds,
      retryAfter: retryAfterSeconds,
    });
  },
});

/**
 * Authenticated resident API reads.
 *
 * This limiter must be mounted after authMiddleware so the key is the resident
 * account rather than the shared public IP address.
 */
export const authenticatedResidentReadRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAuthenticatedAccountKey,
  handler: (req: Request, res: Response) => {
    const retryAfterSeconds = getRetryAfterSeconds(req, res, 15 * 60);
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many resident requests. Please wait before trying again.',
      retryAfterSeconds,
      retryAfter: retryAfterSeconds,
    });
  },
});

/**
 * Authenticated QR resolve/claim throughput limiter.
 * Mounted after authMiddleware and keyed per scanner account.
 */
export const scannerOperationRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAuthenticatedAccountKey,
  handler: (req: Request, res: Response) => {
    const retryAfterSeconds = getRetryAfterSeconds(req, res, 15 * 60);
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many scanner requests. Please wait before trying again.',
      retryAfterSeconds,
      retryAfter: retryAfterSeconds,
    });
  },
});

/**
 * Login Rate Limiter (STRICT)
 * [SECURITY CHECKLIST §1.4] Login rate limiting — 5 attempts / 15 min per IP
 * 
 * Critical security measure to prevent:
 * - Brute-force password attacks
 * - Credential stuffing attacks
 * - Account enumeration attacks
 * 
 * Policy:
 * - 5 login attempts per 15 minutes per IP
 * - After limit: 15-minute lockout
 * 
 * Security Rationale:
 * - Low limit prevents automated attacks
 * - 15-minute window provides good security without frustrating legitimate users
 * - Combined with account-based lockout (in authRoutes) for defense in depth
 */
export const loginRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: isTest || process.env.NODE_ENV === 'development'
    ? 10000
    : (Number(process.env.LOGIN_RATE_LIMIT_MAX) || 100), // Accommodate testing & shared NAT networks
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  skipSuccessfulRequests: true, // Only count failed attempts so successful logins do not consume limit
  handler: (req: Request, res: Response) => {
    console.warn(`[SECURITY] Login rate limit exceeded for IP: ${getClientIP(req)}`);
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again later.',
    });
  },
});

/**
 * Registration Rate Limiter
 * 
 * Prevents:
 * - Automated spam account creation
 * - Resource exhaustion attacks
 * - Abuse of registration for enumeration
 * 
 * Policy:
 * - 60 registration attempts per hour per IP (supports field/testing setups)
 * - Legitimate users rarely need more than 1-2 attempts
 */
export const registrationRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window
  max: isTest || process.env.NODE_ENV === 'development'
    ? 10000
    : (Number(process.env.REGISTRATION_RATE_LIMIT_MAX) || 60),
  message: {
    success: false,
    message: 'Too many accounts created from this IP. Please try again later.',
    retryAfter: '1 hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  skipSuccessfulRequests: true,
  handler: (req: Request, res: Response) => {
    console.warn(`[SECURITY] Registration rate limit exceeded for IP: ${getClientIP(req)}`);
    
    res.status(429).json({
      success: false,
      message: 'Account creation limit reached. Please try again in 1 hour.',
      retryAfter: '1 hour',
    });
  },
});

/**
 * Password Reset Rate Limiter
 * 
 * Protects password reset functionality from:
 * - Email flooding attacks
 * - Account enumeration via reset responses
 * 
 * Policy:
 * - 3 reset requests per hour per IP
 */
const createPasswordResetRateLimiter = (options: {
  windowMs: number;
  max: number;
  message: string;
}): RateLimitRequestHandler => rateLimit({
  windowMs: options.windowMs,
  max: isTest || process.env.NODE_ENV === 'development' ? 10000 : options.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  handler: (req: Request, res: Response) => {
    const retryAfterSeconds = getRetryAfterSeconds(
      req,
      res,
      Math.ceil(options.windowMs / 1000),
    );

    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: options.message,
      retryAfterSeconds,
      retryAfter: retryAfterSeconds,
    });
  },
});

// Keep each recovery phase independent. A normal send/verify/reset sequence
// must not exhaust one shared three-request quota.
export const passwordResetSendRateLimiter = createPasswordResetRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many reset-code requests. Please try again later.',
});

export const passwordResetVerifyRateLimiter = createPasswordResetRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many verification attempts. Please try again later.',
});

export const passwordResetFinalizeRateLimiter = createPasswordResetRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many password-reset attempts. Please try again later.',
});

/** @deprecated Use a phase-specific password reset limiter. */
export const passwordResetRateLimiter = passwordResetSendRateLimiter;

/**
 * Login OTP Rate Limiter
 * 
 * Protects login-OTP sending from flooding.
 * 
 * Policy:
 * - 3 OTP send requests per 15 minutes per IP
 */
export const loginOtpRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: isTest || process.env.NODE_ENV === 'development'
    ? 10000
    : (Number(process.env.LOGIN_OTP_RATE_LIMIT_MAX) || 30),
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  skipSuccessfulRequests: true,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many OTP requests. Please try again later.',
      retryAfter: '15 minutes',
    });
  },
});

/**
 * Strict Rate Limiter for Sensitive Operations
 * 
 * Use for highly sensitive operations like:
 * - Changing email/password
 * - Deleting account
 * - Accessing admin functions
 */
export const strictRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: isTest ? 10000 : 10, // 10 requests per window
  message: {
    success: false,
    message: 'Rate limit exceeded for sensitive operation.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
});

/**
 * Household Token Validation Rate Limiter
 * 
 * STRICT limiter to prevent brute-force token guessing.
 * Tokens are valuable one-time use codes, so we protect aggressively.
 * 
 * Policy:
 * - 5 token validation attempts per 15 minutes per IP
 * - This prevents automated token enumeration
 * 
 * Security Rationale:
 * - With 12-character alphanumeric tokens (36^12 combinations)
 *   brute force is impractical, but we still rate limit
 * - Legitimate users should only need 1-2 attempts
 */
export const tokenValidationRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: isTest ? 10000 : 5, // Only 5 attempts allowed
  message: {
    success: false,
    message: 'Too many token validation attempts. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  skipSuccessfulRequests: false, // Count all requests
  handler: (req: Request, res: Response) => {
    console.warn(`[SECURITY] Token validation rate limit exceeded for IP: ${getClientIP(req)}`);
    
    res.status(429).json({
      success: false,
      message: 'Too many token attempts. Your IP has been temporarily blocked.',
      retryAfter: '15 minutes',
      blocked: true,
    });
  },
});

/**
 * Household Registration Rate Limiter
 * 
 * Limits full registration attempts per IP.
 * More restrictive than token validation since registration is heavier.
 * 
 * Policy:
 * - 3 registration attempts per hour per IP
 * - Combined with token-based one-time use for strong protection
 */
export const householdRegistrationRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window
  max: isTest ? 10000 : 3, // 3 registrations per hour
  message: {
    success: false,
    message: 'Too many registration attempts. Please try again later.',
    retryAfter: '1 hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  handler: (req: Request, res: Response) => {
    console.warn(`[SECURITY] Registration rate limit exceeded for IP: ${getClientIP(req)}`);
    
    res.status(429).json({
      success: false,
      message: 'Registration limit reached. Please try again in 1 hour.',
      retryAfter: '1 hour',
    });
  },
});

/**
 * Mobile Number Lookup Rate Limiter
 *
 * Limits anonymous mobile-number probing attempts.
 */
export const mobileLookupRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: isTest ? 10000 : 10,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: '15 minutes',
    });
  },
});

/**
 * Admin Token Generation Rate Limiter
 * 
 * Limits how many tokens an admin can generate.
 * Prevents abuse of token generation endpoint.
 * 
 * Policy:
 * - 50 token generations per hour per IP
 * - Enough for legitimate batch operations
 */
export const tokenGenerationRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window
  max: isTest ? 10000 : 50, // 50 tokens per hour
  message: {
    success: false,
    message: 'Token generation limit reached. Please try again later.',
    retryAfter: '1 hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
});

/**
 * Registration OTP Rate Limiter
 *
 * Limits SMS OTP sending during registration to prevent
 * SMS flooding and cost abuse.
 *
 * Policy:
 * - 5 OTP send requests per 15 minutes per IP
 * - Enough for legitimate retries, strict enough to prevent abuse
 */
export const registrationOtpRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 5,
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIP,
  handler: (_req: Request, res: Response) => {
    console.warn(`[SECURITY] Registration OTP rate limit exceeded for IP: ${getClientIP(_req)}`);
    res.status(429).json({
      success: false,
      message: 'Too many verification code requests. Please try again later.',
      retryAfter: '15 minutes',
    });
  },
});

