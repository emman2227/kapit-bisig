/**
 * Household Registration Routes
 * 
 * Secure API endpoints for household token validation and registration.
 * 
 * Security Features:
 * 1. Rate limiting on all endpoints
 * 2. Brute-force detection and blocking
 * 3. Input validation and sanitization
 * 4. Comprehensive audit logging
 * 5. Atomic token locking for concurrent registration protection
 * 
 * Endpoints:
 * - POST /validate-token: Check if a token is valid (before registration)
 * - POST /register: Complete household registration with token
 * 
 * Flow:
 * 1. User enters token → validate-token endpoint checks validity
 * 2. User fills registration form
 * 3. User submits → register endpoint acquires lock, creates resident, marks token used
 * 
 * Concurrency Protection:
 * - If multiple family members submit simultaneously, only ONE succeeds
 * - Others receive "Registration in progress" error
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import mongoose from 'mongoose';
import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { householdRegistrationService } from '../services/householdRegistrationService';
import RegistrationAuditLog from '../models/RegistrationAuditLog';
import { generateRequestId, householdTokenService } from '../services/householdTokenService';
import HouseholdToken from '../models/HouseholdToken';
import Resident from '../models/Resident';
import ResidentPasswordResetOtp from '../models/ResidentPasswordResetOtp';
import Distribution from '../models/Distribution';
import StaffUser from '../models/StaffUser';
import Claim from '../models/Claim';
import Notification from '../models/Notification';
import ResidentQrScanLog from '../models/ResidentQrScanLog';
import ResidentPushDevice from '../models/ResidentPushDevice';
import BeneficiaryEligibility from '../models/BeneficiaryEligibility';
import { computeEventHash, computeHouseholdHash } from '../utils/hashHelpers';
import {
  upsertDistributionClaimFromClaim,
  requiresBeneficiaryApproval,
  isResidentApprovedBeneficiaryForDistribution,
} from '../services/distributionFlowService';
import { buildResidentQrToken, parseResidentQrToken } from '../services/residentQrService';
import { isDistributionClaimable } from '../utils/distributionLifecycle';
import bcrypt from 'bcrypt';
import {
  loginRateLimiter,
  passwordResetFinalizeRateLimiter,
  passwordResetSendRateLimiter,
  passwordResetVerifyRateLimiter,
  tokenValidationRateLimiter,
  householdRegistrationRateLimiter,
  mobileLookupRateLimiter,
  authenticatedResidentReadRateLimiter,
  scannerOperationRateLimiter,
  registrationOtpRateLimiter,
} from '../middleware/rateLimiter';
import { validateRequest } from '../validation/validateRequest';
import {
  validateTokenBody,
  recordDuplicateBlockBody,
  registerHouseholdBody,
  checkMobileBody,
  residentRevisionSubmitBody,
  sendRegistrationOtpBody,
  verifyRegistrationOtpBody,
  resendRegistrationOtpBody,
} from '../validation/household.schema';
import { validateBase64Image } from '../validation/imageValidation';
import { normalizeIdNumber } from '../utils/idVerification';
import { authMiddleware, generateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import {
  isValidPhilippineMobileNumber,
  normalizePhilippineMobileNumber,
} from '../utils/mobileNumber';
import {
  householdForgotResetSchema,
  householdForgotSendOtpSchema,
  householdForgotVerifyOtpSchema,
  householdLoginSchema,
} from '../schemas/authSchemas';
import { revokeJWTByValue } from '../services/tokenRevocationService';
import { isMailerConfigured, sendResetOtpEmail } from '../utils/mailer';
import { validatePasswordStrength } from '../utils/passwordValidator';
import { buildScreeningValidationIssues, buildVerificationPayload } from '../services/householdRegistrationService';
import { screenSubmittedId } from '../services/idScreeningService';
import { persistVerificationImage } from '../utils/imageStorage';
import { broadcastScopedNotification } from '../utils/createNotification';
import RegistrationOtp from '../models/RegistrationOtp';
import { sendRegistrationOtpSms, sendPasswordResetOtpSms, isSmsConfigured } from '../utils/smsService';
import { deriveDistributionLifecycle } from '../utils/distributionLifecycle';

const router = Router();
const CLAIMED_STATUSES = ['PENDING_CHAIN', 'CHAIN_SUBMITTED', 'CONFIRMED', 'CHAIN_FAILED'] as const;
const PASSWORD_RESET_OTP_EXPIRY_MINUTES = 10;
const PASSWORD_RESET_OTP_MAX_ATTEMPTS = 5;
const RESIDENT_RESET_TOKEN_EXPIRY = '10m';

/**
 * Debug endpoint to check tokens in database
 * Remove this in production!
 */
router.get('/debug-tokens', async (_req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({
        success: false,
        message: 'Endpoint not found',
      });
    }

    const tokens = await HouseholdToken.find({
      status: { $in: ['UNUSED', 'LOCKED'] },
      expiresAt: mongoose.trusted({ $gt: new Date() }),
    }).setOptions({ sanitizeFilter: false });
    
    const testToken = 'JFTP-3OMT-Y9Q7';
    let matchResult = 'No match';
    
    for (const token of tokens) {
      const isMatch = await bcrypt.compare(testToken, token.tokenHash);
      if (isMatch) {
        matchResult = `Match found: ${token.tokenPrefix}`;
        break;
      }
    }
    
    res.json({
      tokenCount: tokens.length,
      tokenPrefixes: tokens.map(t => t.tokenPrefix),
      testToken,
      matchResult,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Get client IP address
 * Handles X-Forwarded-For for proxy setups
 */
function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Get user agent string
 */
function getUserAgent(req: Request): string {
  return req.headers['user-agent'] || 'unknown';
}

function generateOtp(): string {
  const num = crypto.randomInt(0, 1_000_000);
  return num.toString().padStart(6, '0');
}

function getJWTSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  if (s.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long');
  return s;
}

/**
 * Sanitize token input
 */
function sanitizeToken(token: string): string {
  if (!token || typeof token !== 'string') {
    return '';
  }
  // Remove whitespace and convert to uppercase
  return token.trim().toUpperCase();
}

type CachedScanResult = {
  residentId: string;
  residentCode: string;
  maskedName: string;
  barangay: string;
  city: string;
  status: string;
  cachedAt: number;
};

const SCAN_CACHE_TTL_MS = 30 * 1000;
const scanLookupCache = new Map<string, CachedScanResult>();

const residentAvatarUploadsDir = path.resolve(__dirname, '../../public/uploads/resident-avatars');
if (!fs.existsSync(residentAvatarUploadsDir)) {
  fs.mkdirSync(residentAvatarUploadsDir, { recursive: true });
}

const residentAvatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, residentAvatarUploadsDir),
  filename: (req: any, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `resident-avatar-${userId}${ext}`);
  },
});

const residentAvatarUpload = multer({
  storage: residentAvatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  },
});

function getMaskedName(fullName: string): string {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return 'Uxxxx Uxxxx';
  }
  if (parts.length === 1) {
    const firstInitial = parts[0][0]?.toUpperCase() || 'U';
    return `${firstInitial}xxxx`;
  }

  const firstInitial = parts[0][0]?.toUpperCase() || 'U';
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() || 'U';
  return `${firstInitial}xxxx ${lastInitial}xxxx`;
}

const residentNameNoiseWords = new Set([
  'APPROVED',
  'PENDING',
  'REJECTED',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'RESIDENT',
  'HOUSEHOLD',
]);

export function normalizeResidentName(input: { firstName?: string; lastName?: string; fullName?: string }): {
  firstName: string;
  lastName: string;
  fullName: string;
} {
  const cleanParts = (raw: string): string[] =>
    String(raw || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((part) => !residentNameNoiseWords.has(part.toUpperCase()));

  let firstParts = cleanParts(input.firstName || '');
  let lastParts = cleanParts(input.lastName || '');
  const fullParts = cleanParts(input.fullName || '');

  if (firstParts.length === 0 && fullParts.length > 0) {
    firstParts = [fullParts[0]];
  }
  if (lastParts.length === 0 && fullParts.length > 1) {
    lastParts = [fullParts[fullParts.length - 1]];
  }

  const firstName = firstParts.join(' ').trim();
  const lastName = lastParts.join(' ').trim();
  const fullName = `${firstName} ${lastName}`.trim() || fullParts.join(' ').trim();

  return { firstName, lastName, fullName };
}

function getResidentDisplayName(input: { firstName?: string; lastName?: string; fullName?: string }): string {
  return normalizeResidentName(input).fullName;
}

function isAllowedScannerRole(role: string | undefined): boolean {
  if (!role) return false;
  return ['Volunteer', 'Staff', 'Admin', 'LGU_STAFF', 'SUPERADMIN'].includes(role);
}

function cacheScanResult(cacheKey: string, value: Omit<CachedScanResult, 'cachedAt'>): void {
  scanLookupCache.set(cacheKey, {
    ...value,
    cachedAt: Date.now(),
  });
}

function getCachedScanResult(cacheKey: string): CachedScanResult | null {
  const cached = scanLookupCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  const age = Date.now() - cached.cachedAt;
  if (age > SCAN_CACHE_TTL_MS) {
    scanLookupCache.delete(cacheKey);
    return null;
  }

  return cached;
}

/**
 * Validate Token Endpoint
 * 
 * POST /api/household/validate-token
 * 
 * Checks if a token is valid before starting registration.
 * Returns household info if valid (auto-fills address fields).
 * 
 * Request body:
 * {
 *   token: string  // Format: XXXX-XXXX-XXXX
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   valid: boolean,
 *   message: string,
 *   householdInfo?: {
 *     headOfHousehold: string,
 *     address: string,
 *     barangay: string,
 *     expectedMembers: number
 *   }
 * }
 */
router.post('/validate-token', tokenValidationRateLimiter, validateRequest({ body: validateTokenBody }), async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = generateRequestId();
  const ipAddress = getClientIP(req);
  const userAgent = getUserAgent(req);
  
  try {
    const { token, barangay } = req.body;
    
    // Input validation
    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'Token is required',
        errorCode: 'MISSING_TOKEN',
      });
    }
    
    const sanitizedToken = sanitizeToken(token);
    const sanitizedBarangay = barangay && typeof barangay === 'string' ? barangay.trim() : undefined;
    
    // Check for brute force attempts
    const bruteForceCheck = await RegistrationAuditLog.detectBruteForce(ipAddress, 15, 10);
    if (bruteForceCheck.detected) {
      await RegistrationAuditLog.log({
        eventType: 'BRUTE_FORCE_DETECTED',
        severity: 'CRITICAL',
        tokenPrefix: sanitizedToken.replace(/-/g, '').slice(0, 4),
        ipAddress,
        userAgent,
        requestId,
        message: `Brute force detected: ${bruteForceCheck.attemptCount} failed attempts`,
        metadata: { attemptCount: bruteForceCheck.attemptCount },
        success: false,
        errorCode: 'BRUTE_FORCE',
        processingTimeMs: Date.now() - startTime,
      });
      
      return res.status(429).json({
        success: false,
        valid: false,
        message: 'Too many failed attempts. Please try again later.',
        errorCode: 'RATE_LIMITED',
      });
    }
    
    // Validate token format
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(sanitizedToken)) {
      await RegistrationAuditLog.log({
        eventType: 'TOKEN_INVALID',
        severity: 'WARNING',
        tokenPrefix: sanitizedToken.slice(0, 4),
        ipAddress,
        userAgent,
        requestId,
        message: 'Invalid token format',
        success: false,
        errorCode: 'INVALID_FORMAT',
        processingTimeMs: Date.now() - startTime,
      });
      
      return res.status(400).json({
        success: true,
        valid: false,
        message: 'Invalid token format. Please enter a valid token (XXXX-XXXX-XXXX).',
        errorCode: 'INVALID_FORMAT',
      });
    }
    
    // Validate token (with barangay filter for faster lookup)
    const result = await householdRegistrationService.validateToken(
      sanitizedToken,
      ipAddress,
      userAgent,
      sanitizedBarangay
    );
    
    return res.status(result.valid ? 200 : 400).json(result);
    
  } catch (error) {
    console.error('[HouseholdRoutes] Token validation error:', error);
    
    await RegistrationAuditLog.log({
      eventType: 'TOKEN_INVALID',
      severity: 'ERROR',
      ipAddress,
      userAgent,
      requestId,
      message: `Validation error: ${(error as Error).message}`,
      success: false,
      errorCode: 'SYSTEM_ERROR',
      processingTimeMs: Date.now() - startTime,
    });
    
    return res.status(500).json({
      success: false,
      valid: false,
      message: 'Unable to validate token. Please try again.',
      errorCode: 'SYSTEM_ERROR',
    });
  }
});

/**
 * Register Household Endpoint
 * 
 * POST /api/household/register
 * 
 * Complete registration with household token.
 * Uses atomic locking to ensure only ONE registration per token.
 * 
 * Request body: Full registration data including householdToken
 * 
 * Response:
 * {
 *   success: boolean,
 *   message: string,
 *   residentId?: string,
 *   householdInfo?: { ... }
 * }
 */
router.post('/register', householdRegistrationRateLimiter, validateRequest({ body: registerHouseholdBody }), async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = generateRequestId();
  const ipAddress = getClientIP(req);
  const userAgent = getUserAgent(req);
  
  try {
    const registrationData = req.body;
    
    // Input validation
    if (!registrationData || typeof registrationData !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errorCode: 'INVALID_REQUEST',
      });
    }
    
    // Sanitize token
    if (registrationData.householdToken) {
      registrationData.householdToken = sanitizeToken(registrationData.householdToken);
    }
    
    // Check for brute force
    const bruteForceCheck = await RegistrationAuditLog.detectBruteForce(ipAddress, 30, 5);
    if (bruteForceCheck.detected) {
      await RegistrationAuditLog.log({
        eventType: 'BRUTE_FORCE_DETECTED',
        severity: 'CRITICAL',
        tokenPrefix: registrationData.householdToken?.replace(/-/g, '').slice(0, 4),
        ipAddress,
        userAgent,
        requestId,
        message: `Brute force on registration: ${bruteForceCheck.attemptCount} failed attempts`,
        metadata: { attemptCount: bruteForceCheck.attemptCount },
        success: false,
        errorCode: 'BRUTE_FORCE',
        processingTimeMs: Date.now() - startTime,
      });
      
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please try again later.',
        errorCode: 'RATE_LIMITED',
      });
    }
    
    // Validate required fields exist
    const requiredFields = [
      'firstName', 'lastName', 'dateOfBirth', 'gender', 'mobileNumber',
      'password', 'barangay', 'streetAddress', 'householdToken',
      'idType', 'idNumber', 'frontIdImage', 'backIdImage', 'faceImage',
    ];
    
    const missingFields = requiredFields.filter(field => !registrationData[field]);
    if (missingFields.length > 0) {
      await RegistrationAuditLog.log({
        eventType: 'REGISTRATION_FAILED',
        severity: 'WARNING',
        tokenPrefix: registrationData.householdToken?.replace(/-/g, '').slice(0, 4),
        ipAddress,
        userAgent,
        requestId,
        message: `Missing required fields: ${missingFields.join(', ')}`,
        metadata: { missingFields },
        success: false,
        errorCode: 'MISSING_FIELDS',
        processingTimeMs: Date.now() - startTime,
      });
      
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`,
        errorCode: 'MISSING_FIELDS',
        validationErrors: missingFields.map((field) => ({
          field,
          code: 'REQUIRED',
          message: `${field} is required`,
        })),
      });
    }
    
    // Validate token format
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(registrationData.householdToken)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid token format',
        errorCode: 'INVALID_TOKEN_FORMAT',
      });
    }

    // Validate mobile verification token if provided
    if (registrationData.verifiedToken) {
      try {
        const decoded = jwt.verify(registrationData.verifiedToken, getJWTSecret()) as {
          mobile?: string;
          purpose?: string;
        };
        const normalizedMobile = normalizePhilippineMobileNumber(registrationData.mobileNumber.trim());
        if (decoded.purpose !== 'registration-verified' || decoded.mobile !== normalizedMobile) {
          return res.status(400).json({
            success: false,
            message: 'Mobile verification token is invalid or does not match this mobile number.',
            errorCode: 'INVALID_VERIFIED_TOKEN',
          });
        }
      } catch (tokenErr) {
        return res.status(400).json({
          success: false,
          message: 'Mobile verification has expired. Please verify your phone number again.',
          errorCode: 'VERIFIED_TOKEN_EXPIRED',
        });
      }
    }
    
    registrationData.idNumber = normalizeIdNumber(registrationData.idType, registrationData.idNumber);

    const [frontValidation, backValidation, faceValidation] = await Promise.all([
      validateBase64Image(registrationData.frontIdImage, {
        fieldName: 'Front ID image',
        maxBytes: 2 * 1024 * 1024,
        minWidth: 200,
        minHeight: 200,
        maxWidth: 4096,
        maxHeight: 4096,
      }),
      validateBase64Image(registrationData.backIdImage, {
        fieldName: 'Back ID image',
        maxBytes: 2 * 1024 * 1024,
        minWidth: 200,
        minHeight: 200,
        maxWidth: 4096,
        maxHeight: 4096,
      }),
      validateBase64Image(registrationData.faceImage, {
        fieldName: 'Face image',
        maxBytes: 2 * 1024 * 1024,
        minWidth: 160,
        minHeight: 160,
        maxWidth: 4096,
        maxHeight: 4096,
      }),
    ]);

    const failedValidation = [frontValidation, backValidation, faceValidation].find((v) => !v.ok);
    if (failedValidation && !failedValidation.ok) {
      const field = failedValidation.message.toLowerCase().includes('front')
        ? 'frontIdImage'
        : failedValidation.message.toLowerCase().includes('back')
          ? 'backIdImage'
          : 'faceImage';
      return res.status(400).json({
        success: false,
        message: failedValidation.message,
        errorCode: 'IMAGE_VALIDATION_FAILED',
        validationErrors: [{
          field,
          code: 'INVALID_IMAGE',
          message: failedValidation.message,
        }],
      });
    }

    // Process registration
    const result = await householdRegistrationService.registerResident(
      registrationData,
      ipAddress,
      userAgent
    );
    
    if (result.success) {
      return res.status(201).json({
        success: true,
        message: result.message,
        residentId: result.residentId?.toString(),
        residentCode: result.residentCode,
        householdInfo: result.householdInfo,
      });
    } else {
      // Map error codes to HTTP status codes
      const statusCodes: Record<string, number> = {
        'TOKEN_NOT_FOUND': 400,
        'TOKEN_EXPIRED': 400,
        'TOKEN_ALREADY_USED': 409,
        'TOKEN_REVIEW_REQUIRED': 403,
        'LOCK_CONFLICT': 409, // Conflict - another registration in progress
        'VALIDATION_FAILED': 400,
        'VALIDATION_ERROR': 400,
        'DUPLICATE_MOBILE': 409,
        'DUPLICATE_ID': 409,
        'SYSTEM_ERROR': 500,
      };
      
      const statusCode = statusCodes[result.errorCode || ''] || 400;
      
      return res.status(statusCode).json({
        success: false,
        message: result.message,
        errorCode: result.errorCode,
        validationErrors: result.validationErrors,
      });
    }
    
  } catch (error) {
    console.error('[HouseholdRoutes] Registration error:', error);
    
    await RegistrationAuditLog.log({
      eventType: 'REGISTRATION_FAILED',
      severity: 'ERROR',
      ipAddress,
      userAgent,
      requestId,
      message: `Registration error: ${(error as Error).message}`,
      success: false,
      errorCode: 'SYSTEM_ERROR',
      processingTimeMs: Date.now() - startTime,
    });
    
    return res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.',
      errorCode: 'SYSTEM_ERROR',
    });
  }
});


/**
 * Resident Distribution Feed Endpoint
 *
 * GET /api/household/distributions
 *
 * Returns distributions that cover the authenticated resident's barangay.
 */
router.get('/distributions', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident') {
      return res.status(403).json({
        success: false,
        message: 'Only resident accounts can access this feed.',
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const resident = await Resident.findById(userId).select('barangay status');
    if (!resident) {
      return res.status(404).json({
        success: false,
        message: 'Resident not found',
      });
    }

    if (resident.status !== 'Approved') {
      return res.status(403).json({
        success: false,
        message:
          resident.status === 'Pending'
            ? 'Your account is still pending approval. Distribution feed is unavailable.'
            : 'Resident account is not approved.',
        code: resident.status === 'Pending' ? 'PENDING_APPROVAL' : 'REGISTRATION_NOT_APPROVED',
      });
    }

    const now = new Date();
    const residentBarangay = resident.barangay;
    const coveredDistributions = await Distribution.find({
      archivedAt: null,
      // Query operators are sanitized globally. Mark this server-built range
      // as trusted so Mongoose does not wrap `$gte` in `$eq` and attempt to
      // cast the whole operator object as a Date.
      endsAt: mongoose.trusted({ $gte: now }),
      $or: [
        { barangay: residentBarangay },
        { assignedBarangays: residentBarangay },
      ],
    })
      .setOptions({ sanitizeFilter: false })
      .select('barangay assignedBarangays scheduled endsAt notes status archivedAt createdAt requiresBeneficiaryApproval')
      .sort({ scheduled: 1, createdAt: -1 })
      .limit(50)
      .lean();

    const visibleDistributionIds = coveredDistributions.map((distribution) => distribution._id);
    const visibleEventIds = coveredDistributions.map((d) => d.disasterEventId).filter(Boolean);

    const [residentClaims, residentEligibilities] = await Promise.all([
      visibleDistributionIds.length > 0
        ? Claim.find({
            claimCategory: 'DISTRIBUTION',
            residentId: userId,
            distributionId: mongoose.trusted({ $in: visibleDistributionIds }),
            status: mongoose.trusted({ $in: [...CLAIMED_STATUSES] }),
          })
            .setOptions({ sanitizeFilter: false })
            .select('distributionId status createdAt')
            .sort({ createdAt: -1 })
            .limit(50)
            .lean()
        : Promise.resolve([]),
      visibleDistributionIds.length > 0
        ? BeneficiaryEligibility.find({
            residentId: userId,
            $or: [
              { distributionId: mongoose.trusted({ $in: visibleDistributionIds }) },
              ...(visibleEventIds.length > 0 ? [{ disasterEventId: mongoose.trusted({ $in: visibleEventIds }) }] : []),
            ],
          })
            .setOptions({ sanitizeFilter: false })
            .select('distributionId disasterEventId status proofStatus')
            .lean()
        : Promise.resolve([]),
    ]);

    const claimByDistribution = new Map<string, string>();
    for (const claim of residentClaims) {
      if (claim?.distributionId) {
        claimByDistribution.set(String(claim.distributionId), String(claim.status || ''));
      }
    }

    const eligibilityByDistribution = new Map<string, { status: string; proofStatus: string }>();
    const eligibilityByEvent = new Map<string, { status: string; proofStatus: string }>();
    for (const el of residentEligibilities) {
      if (el.distributionId) {
        eligibilityByDistribution.set(String(el.distributionId), {
          status: el.status,
          proofStatus: el.proofStatus,
        });
      }
      if (el.disasterEventId) {
        eligibilityByEvent.set(String(el.disasterEventId), {
          status: el.status,
          proofStatus: el.proofStatus,
        });
      }
    }

    const data = coveredDistributions.map((distribution) => {
      const id = distribution._id.toString();
      const claimStatus = claimByDistribution.get(id) || null;
      const el = eligibilityByDistribution.get(id) || (distribution.disasterEventId ? eligibilityByEvent.get(String(distribution.disasterEventId)) : null);
      const isApprovedBeneficiary = el?.status === 'Eligible' && el?.proofStatus === 'Approved';
      const proofStatus = el?.proofStatus || null;

      return {
        id,
        barangay: distribution.barangay,
        assignedBarangays: distribution.assignedBarangays ?? [],
        scheduled: distribution.scheduled,
        endsAt: distribution.endsAt,
        notes: distribution.notes || '',
        status: distribution.status,
        requiresBeneficiaryApproval: distribution.requiresBeneficiaryApproval === true,
        isBeneficiaryApproved: isApprovedBeneficiary,
        beneficiaryProofStatus: proofStatus,
        createdAt: distribution.createdAt,
        lifecycleStatus: deriveDistributionLifecycle(distribution, now),
        residentClaimed: Boolean(claimStatus),
        residentClaimStatus: claimStatus,
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
        generatedAt: now.toISOString(),
        cacheTtlSeconds: 60,
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident /distributions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch distributions.',
    });
  }
});

/**
 * Resident Notifications Endpoint
 *
 * GET /api/household/notifications
 *
 * Returns notifications addressed to the authenticated resident.
 */
router.get('/notifications', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident') {
      return res.status(403).json({
        success: false,
        message: 'Only resident accounts can access notifications.',
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      data: {
        notifications,
        unreadCount: notifications.filter((item) => !item.isRead).length,
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident notifications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load notifications.',
    });
  }
});

/** Register or reactivate this resident device for remote push notifications. */
router.post('/notifications/devices', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident' || !req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only resident accounts can register notification devices.' });
    }
    const expoPushToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const platform = req.body?.platform === 'ios' ? 'ios' : req.body?.platform === 'android' ? 'android' : null;
    if (!/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(expoPushToken) || !platform) {
      return res.status(400).json({ success: false, code: 'INVALID_PUSH_DEVICE', message: 'A valid Expo push token and platform are required.' });
    }

    await ResidentPushDevice.findOneAndUpdate(
      { expoPushToken },
      { residentId: req.user.userId, expoPushToken, platform, active: true, lastSeenAt: new Date(), disabledReason: null },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return res.json({ success: true, message: 'Notification device registered.' });
  } catch (error) {
    console.error('[RESIDENT_PUSH_REGISTER]', error);
    return res.status(500).json({ success: false, message: 'Unable to register notification device.' });
  }
});

/** Deactivate a resident device token on logout. */
router.delete('/notifications/devices', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident' || !req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only resident accounts can unregister notification devices.' });
    }
    const expoPushToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!expoPushToken) {
      return res.status(400).json({ success: false, message: 'Push token is required.' });
    }
    await ResidentPushDevice.updateOne(
      { residentId: req.user.userId, expoPushToken },
      { $set: { active: false, disabledReason: 'LOGOUT' } },
    );
    return res.json({ success: true, message: 'Notification device unregistered.' });
  } catch (error) {
    console.error('[RESIDENT_PUSH_UNREGISTER]', error);
    return res.status(500).json({ success: false, message: 'Unable to unregister notification device.' });
  }
});

/**
 * Resident Notification Read Endpoint
 *
 * PATCH /api/household/notifications/:id/read
 */
router.patch('/notifications/:id/read', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident') {
      return res.status(403).json({
        success: false,
        message: 'Only resident accounts can update notifications.',
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const notification = await Notification.findOne({ _id: req.params.id, userId });
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    notification.isRead = true;
    await notification.save();

    return res.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident notification mark-read error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to update notification.',
    });
  }
});

/**
 * Resident Forgot Password OTP (SMS or Email)
 *
 * POST /api/household/auth/forgot-password/send-otp
 * POST /api/household/auth/forgot-password/verify-otp
 * POST /api/household/auth/forgot-password/reset
 */
router.post('/auth/forgot-password/send-otp', passwordResetSendRateLimiter, validateRequest({ body: householdForgotSendOtpSchema }), async (req: Request, res: Response) => {
  try {
    const rawMobile = req.body.mobileNumber ? String(req.body.mobileNumber).trim() : '';
    const rawEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : '';

    if (rawMobile) {
      const normalizedMobile = normalizePhilippineMobileNumber(rawMobile);
      const resident = await Resident.findOne({
        mobileNumber: normalizedMobile,
        status: { $ne: 'Rejected' },
      }).select('_id mobileNumber fullName firstName lastName');

      if (resident) {
        const otp = generateOtp();
        const otpHash = await bcrypt.hash(otp, 12);

        await ResidentPasswordResetOtp.deleteMany({
          $or: [{ identifier: normalizedMobile }, { mobileNumber: normalizedMobile }],
        });

        try {
          await sendPasswordResetOtpSms(resident.mobileNumber, otp);
        } catch (smsErr) {
          console.error('[SMS] Failed to send resident reset OTP:', (smsErr as Error).message);
          return res.status(503).json({
            success: false,
            code: 'RESET_SMS_UNAVAILABLE',
            message: 'Password-reset SMS could not be delivered. Please try again later.',
          });
        }

        await ResidentPasswordResetOtp.create({
          residentId: resident._id,
          identifier: normalizedMobile,
          mobileNumber: normalizedMobile,
          otpHash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_OTP_EXPIRY_MINUTES * 60 * 1000),
          attemptsLeft: PASSWORD_RESET_OTP_MAX_ATTEMPTS,
          lastSentAt: new Date(),
          createdAt: new Date(),
        });
      }

      return res.json({
        success: true,
        message: 'If the mobile number exists, an OTP was sent via SMS.',
      });
    }

    // Email delivery path
    const emailLower = rawEmail;
    if (!isMailerConfigured()) {
      return res.status(503).json({
        success: false,
        code: 'RESET_EMAIL_UNAVAILABLE',
        message: 'Password-reset email is temporarily unavailable. Please contact support or try again later.',
      });
    }

    const resident = await Resident.findOne({
      emailLower,
      status: { $ne: 'Rejected' },
    }).select('_id email emailLower');

    if (resident) {
      const otp = generateOtp();
      const otpHash = await bcrypt.hash(otp, 12);

      await ResidentPasswordResetOtp.deleteMany({
        $or: [{ identifier: emailLower }, { emailLower }],
      });

      try {
        await sendResetOtpEmail(resident.email || emailLower, otp);
      } catch (mailErr) {
        console.error('[MAILER] Failed to send resident reset OTP:', (mailErr as Error).message);
        return res.status(503).json({
          success: false,
          code: 'RESET_EMAIL_UNAVAILABLE',
          message: 'Password-reset email could not be sent. Please try again later.',
        });
      }

      await ResidentPasswordResetOtp.create({
        residentId: resident._id,
        identifier: emailLower,
        emailLower,
        otpHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_OTP_EXPIRY_MINUTES * 60 * 1000),
        attemptsLeft: PASSWORD_RESET_OTP_MAX_ATTEMPTS,
        lastSentAt: new Date(),
        createdAt: new Date(),
      });
    }

    return res.json({
      success: true,
      message: 'If the email exists, an OTP was sent.',
    });
  } catch (error) {
    console.error('[HOUSEHOLD_FORGOT_SEND_OTP]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
});

router.post('/auth/forgot-password/verify-otp', passwordResetVerifyRateLimiter, validateRequest({ body: householdForgotVerifyOtpSchema }), async (req: Request, res: Response) => {
  try {
    const rawMobile = req.body.mobileNumber ? String(req.body.mobileNumber).trim() : '';
    const rawEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : '';
    const otp = String(req.body.otp || '');

    const identifier = rawMobile ? normalizePhilippineMobileNumber(rawMobile) : rawEmail;

    const record = await ResidentPasswordResetOtp.findOne({
      $or: [
        { identifier },
        { emailLower: identifier },
        { mobileNumber: identifier },
      ],
    });

    if (!record || record.expiresAt < new Date() || record.attemptsLeft <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired code.',
      });
    }

    const isMatch = await bcrypt.compare(otp, record.otpHash);
    if (!isMatch) {
      record.attemptsLeft = Math.max(0, record.attemptsLeft - 1);
      await record.save();

      return res.status(400).json({
        success: false,
        message: 'Invalid or expired code.',
      });
    }

    const resident = await Resident.findById(record.residentId).select('_id');
    if (!resident) {
      await ResidentPasswordResetOtp.deleteOne({ _id: record._id });
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired code.',
      });
    }

    const resetToken = jwt.sign(
      { sub: resident._id.toString(), purpose: 'resident_password_reset' },
      getJWTSecret(),
      { expiresIn: RESIDENT_RESET_TOKEN_EXPIRY, algorithm: 'HS256' } as SignOptions,
    );

    await ResidentPasswordResetOtp.deleteOne({ _id: record._id });

    return res.json({
      success: true,
      resetToken,
    });
  } catch (error) {
    console.error('[HOUSEHOLD_FORGOT_VERIFY_OTP]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
});


router.post('/auth/forgot-password/reset', passwordResetFinalizeRateLimiter, validateRequest({ body: householdForgotResetSchema }), async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword } = req.body as { resetToken: string; newPassword: string };

    let payload: { sub?: string; purpose?: string };
    try {
      payload = jwt.verify(resetToken, getJWTSecret()) as { sub?: string; purpose?: string };
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token.',
      });
    }

    if (payload.purpose !== 'resident_password_reset' || !payload.sub) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token.',
      });
    }

    const pwCheck = validatePasswordStrength(newPassword);
    if (!pwCheck.ok) {
      return res.status(400).json({
        success: false,
        message: 'Password is too weak.',
        errors: pwCheck.reason ? pwCheck.reason.split('; ') : ['Password is too weak'],
      });
    }

    const resident = await Resident.findById(payload.sub).select('+password');
    if (!resident) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token.',
      });
    }

    resident.password = await bcrypt.hash(newPassword, 12);
    await resident.save();

    if (resident.emailLower) {
      await ResidentPasswordResetOtp.deleteMany({
        $or: [{ residentId: resident._id }, { emailLower: resident.emailLower }],
      });
    } else {
      await ResidentPasswordResetOtp.deleteMany({ residentId: resident._id });
    }

    return res.json({
      success: true,
      message: 'Password has been reset successfully.',
    });
  } catch (error) {
    console.error('[HOUSEHOLD_FORGOT_RESET_PASSWORD]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
});

/**
 * Record Duplicate Face BLOCK Attempt Endpoint
 *
 * POST /api/household/record-duplicate-block
 *
 * Records duplicate-face BLOCK events by token.
 * After 3 BLOCK attempts, token is temporarily blocked for review (24h).
 */
router.post(
  '/record-duplicate-block',
  householdRegistrationRateLimiter,
  validateRequest({ body: recordDuplicateBlockBody }),
  async (req: Request, res: Response) => {
    const requestId = generateRequestId();
    const ipAddress = getClientIP(req);
    const userAgent = getUserAgent(req);

    try {
      const { token, barangay, similarity } = req.body;
      const sanitizedToken = sanitizeToken(token);
      const sanitizedBarangay = barangay && typeof barangay === 'string' ? barangay.trim() : undefined;

      const result = await householdTokenService.recordDuplicateBlockAttempt(
        sanitizedToken,
        ipAddress,
        userAgent,
        requestId,
        sanitizedBarangay,
        typeof similarity === 'number' ? similarity : undefined
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: 'Unable to record duplicate attempt.',
          errorCode: 'SYSTEM_ERROR',
        });
      }

      if (!result.recorded) {
        return res.status(400).json({
          success: false,
          message: result.error || 'Unable to record duplicate attempt.',
          errorCode: result.errorCode || 'VALIDATION_ERROR',
        });
      }

      const maxAttempts = result.maxAttempts || 3;
      const attempts = result.attempts || 1;
      const blocked = !!result.blockedUntil;

      return res.status(200).json({
        success: true,
        blocked,
        attempts,
        maxAttempts,
        blockedUntil: result.blockedUntil || null,
        message: blocked
          ? 'Token is temporarily blocked for review due to repeated duplicate detections.'
          : `Duplicate attempt recorded (${attempts}/${maxAttempts}).`,
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Record duplicate block error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to record duplicate attempt.',
        errorCode: 'SYSTEM_ERROR',
      });
    }
  }
);

/**
 * Resident Announcements Endpoint
 *
 * GET /api/household/announcements
 *
 * Reserved endpoint for resident-facing announcements.
 * Pending residents are explicitly blocked until admin approval.
 */
router.get('/announcements', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident') {
      return res.status(403).json({
        success: false,
        message: 'Only resident accounts can access announcements.',
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const resident = await Resident.findById(userId).select('status');
    if (!resident) {
      return res.status(404).json({
        success: false,
        message: 'Resident not found',
      });
    }

    if (resident.status !== 'Approved') {
      return res.status(403).json({
        success: false,
        message:
          resident.status === 'Pending'
            ? 'Your account is still pending approval. Announcements are unavailable.'
            : 'Resident account is not approved.',
        code: resident.status === 'Pending' ? 'PENDING_APPROVAL' : 'REGISTRATION_NOT_APPROVED',
      });
    }

    return res.json({
      success: true,
      data: [],
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident /announcements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch announcements.',
    });
  }
});

/**
 * Resident QR Generator Endpoint
 *
 * GET /api/household/qr/me
 *
 * Returns compact QR payload and resident metadata for display.
 */
router.get('/qr/me', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident') {
      return res.status(403).json({
        success: false,
        message: 'Only resident accounts can generate resident QR.',
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    let resident = await Resident.findById(userId).select(
      'residentCode firstName lastName fullName avatarUrl barangay city streetAddress status createdAt qrVersion qrIssuedAt qrStatus'
    );

    if (!resident) {
      return res.status(404).json({
        success: false,
        message: 'Resident not found',
      });
    }

    if (resident.status !== 'Approved') {
      return res.status(403).json({
        success: false,
        message:
          resident.status === 'Pending'
            ? 'Your account is still pending approval. QR generation is disabled.'
            : 'Resident account is not approved for QR use.',
        code: resident.status === 'Pending' ? 'PENDING_APPROVAL' : 'QR_NOT_ALLOWED',
      });
    }

    if (resident.qrStatus === 'REVOKED') {
      return res.status(403).json({
        success: false,
        message: 'Resident QR is currently revoked. Please contact barangay office.',
        code: 'QR_REVOKED',
      });
    }

    if (!resident.residentCode || !resident.qrIssuedAt) {
      const fullResident = await Resident.findById(userId);
      if (!fullResident) {
        return res.status(404).json({
          success: false,
          message: 'Resident not found',
        });
      }

      let changed = false;
      if (!fullResident.residentCode) {
        changed = true;
      }
      if (!fullResident.qrIssuedAt) {
        fullResident.qrIssuedAt = new Date();
        changed = true;
      }

      if (changed) {
        await fullResident.save();
      }

      resident = await Resident.findById(userId).select(
        'residentCode firstName lastName fullName avatarUrl barangay city streetAddress status createdAt qrVersion qrIssuedAt qrStatus'
      );
      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident not found',
        });
      }
    }

    const residentDisplayName = getResidentDisplayName({
      firstName: (resident as any).firstName,
      lastName: (resident as any).lastName,
      fullName: (resident as any).fullName,
    });

    const qrData = buildResidentQrToken(
      resident.residentCode as string,
      resident.qrVersion || 1,
      resident.qrIssuedAt || resident.createdAt,
    );

    return res.json({
      success: true,
      data: {
        residentId: resident._id.toString(),
        residentCode: resident.residentCode,
        qrData,
        qrVersion: resident.qrVersion || 1,
        issuedAt: (resident.qrIssuedAt || resident.createdAt).toISOString(),
        resident: {
          fullName: residentDisplayName,
          avatarUrl: resident.avatarUrl || null,
          barangay: resident.barangay,
          city: resident.city || '',
          streetAddress: resident.streetAddress,
          status: resident.status,
          createdAt: resident.createdAt,
          qrStatus: resident.qrStatus,
          verificationStatus: 'Verified',
        },
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident QR generation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to generate QR data.',
    });
  }
});

/**
 * Volunteer/Staff QR Resolve Endpoint
 *
 * POST /api/household/qr/resolve
 *
 * Resolves scanned resident QR data to resident profile fields used on-site.
 */
router.post('/qr/resolve', authMiddleware, scannerOperationRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const ipAddress = getClientIP(req);
  const userAgent = getUserAgent(req);

  try {
    const scannerRole = req.user?.role || 'Unknown';
    const scannerId = req.user?.userId || null;
    const { qrData, distributionId } = req.body;

    if (!isAllowedScannerRole(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only authorized scanner accounts can resolve resident QR.',
        code: 'SCANNER_FORBIDDEN',
      });
    }

    if (!qrData || typeof qrData !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'qrData is required',
        code: 'INVALID_QR',
      });
    }
    if (distributionId !== undefined && typeof distributionId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'distributionId must be a string',
        code: 'INVALID_DISTRIBUTION_ID',
      });
    }

    if (qrData.length > 512) {
      return res.status(400).json({
        success: false,
        message: 'QR payload too large',
        code: 'INVALID_QR',
      });
    }

    const parsedQr = parseResidentQrToken(qrData);
    if (!parsedQr) {
      ResidentQrScanLog.create({
        residentId: null,
        residentCode: null,
        scannerId,
        scannerRole,
        result: 'INVALID',
        ipAddress,
        userAgent,
      }).catch(() => undefined);

      return res.status(400).json({
        success: false,
        message: 'Invalid QR payload',
        code: 'INVALID_QR',
      });
    }

    const residentCode = parsedQr.residentCode;

    if (parsedQr.qrVersion !== undefined) {
      const qrState = await Resident.findOne({ residentCode })
        .select('qrVersion status qrStatus')
        .lean();
      if (
        !qrState ||
        qrState.status !== 'Approved' ||
        qrState.qrStatus === 'REVOKED' ||
        (qrState.qrVersion || 1) !== parsedQr.qrVersion
      ) {
        return res.status(403).json({
          success: false,
          message: 'This virtual ID is no longer active. Ask the resident to refresh their ID.',
          code: 'QR_OUTDATED',
        });
      }
    }

    const cacheKey = `${residentCode}:${parsedQr.qrVersion || 'legacy'}`;
    const cached = getCachedScanResult(cacheKey);
    let alreadyClaimed = false;

    let residentId = '';
    let residentBarangay = '';
    let residentStatus = '';
    let residentDisplayName = '';
    let maskedName = '';
    let fromCache = false;

    if (cached) {
      residentId = cached.residentId;
      residentBarangay = cached.barangay;
      residentStatus = cached.status;
      maskedName = cached.maskedName;
      fromCache = true;
    } else {
      const resident = await Resident.findOne({ residentCode })
        .select('residentCode firstName lastName fullName barangay city status qrStatus')
        .lean();

      if (!resident) {
        ResidentQrScanLog.create({
          residentId: null,
          residentCode,
          scannerId,
          scannerRole,
          result: 'NOT_FOUND',
          ipAddress,
          userAgent,
        }).catch(() => undefined);

        return res.status(404).json({
          success: false,
          message: 'Resident not found',
          code: 'RESIDENT_NOT_FOUND',
        });
      }

      if (resident.status !== 'Approved' || resident.qrStatus === 'REVOKED') {
        return res.status(403).json({
          success: false,
          message: 'Resident QR is not active',
          code: 'QR_INACTIVE',
        });
      }

      residentId = resident._id.toString();
      residentBarangay = resident.barangay;
      residentStatus = resident.status;
      residentDisplayName = getResidentDisplayName({
        firstName: (resident as any).firstName,
        lastName: (resident as any).lastName,
        fullName: (resident as any).fullName,
      });
      maskedName = getMaskedName(residentDisplayName);

      cacheScanResult(cacheKey, {
        residentId,
        residentCode: resident.residentCode,
        maskedName,
        barangay: residentBarangay,
        city: resident.city || '',
        status: residentStatus,
      });
    }

    // Run the distribution eligibility checks
    let isEligible = true;
    let eligibilityError = '';

    if (distributionId && typeof distributionId === 'string') {
      const distribution = await Distribution.findById(distributionId)
        .select('_id barangay assignedBarangays requiresBeneficiaryApproval')
        .lean();

      if (!distribution) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
          code: 'DISTRIBUTION_NOT_FOUND',
        });
      }

      // 1. Check barangay coverage
      const coverage = new Set<string>([
        distribution.barangay,
        ...(Array.isArray(distribution.assignedBarangays) ? distribution.assignedBarangays : []),
      ]);
      if (!coverage.has(residentBarangay)) {
        isEligible = false;
        eligibilityError = 'Resident barangay is not covered by this relief distribution.';
      }

      // 2. Check if distribution requires beneficiary approval (approved proof)
      if (isEligible && requiresBeneficiaryApproval(distribution as any)) {
        const isApprovedTargetBeneficiary = await isResidentApprovedBeneficiaryForDistribution(
          distributionId,
          residentId,
        );
        if (!isApprovedTargetBeneficiary) {
          isEligible = false;
          eligibilityError = 'Resident is not an approved target beneficiary for this distribution (proof not approved).';
        }
      }

      if (!isEligible) {
        return res.status(403).json({
          success: false,
          message: eligibilityError,
          code: 'RESIDENT_NOT_ELIGIBLE',
        });
      }

      // 3. Check if already claimed
      alreadyClaimed = Boolean(
        await Claim.findOne({
          claimCategory: 'DISTRIBUTION',
          residentId,
          distributionId: distributionId.trim(),
          status: mongoose.trusted({ $in: [...CLAIMED_STATUSES] }),
        }).select('_id')
      );
    }

    ResidentQrScanLog.create({
      residentId: new mongoose.Types.ObjectId(residentId),
      residentCode,
      scannerId,
      scannerRole,
      result: 'VALID',
      ipAddress,
      userAgent,
    }).catch(() => undefined);

    return res.json({
      success: true,
      data: {
        residentId,
        maskedName,
        alreadyClaimed,
        fromCache,
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] QR resolve error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to resolve QR.',
    });
  }
});

/**
 * Volunteer/Staff QR Auto-Claim Endpoint
 *
 * POST /api/household/qr/claim
 *
 * Finalizes a claim after a valid resident QR scan.
 */
router.post('/qr/claim', authMiddleware, scannerOperationRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isAllowedScannerRole(req.user?.role) || req.user?.role === 'Resident') {
      return res.status(403).json({
        success: false,
        message: 'Only authorized scanner accounts can record resident claims.',
        code: 'SCANNER_FORBIDDEN',
      });
    }

    const residentId = typeof req.body?.residentId === 'string' ? req.body.residentId.trim() : '';
    const distributionId = typeof req.body?.distributionId === 'string' ? req.body.distributionId.trim() : '';

    if (!residentId || !distributionId) {
      return res.status(400).json({
        success: false,
        message: 'residentId and distributionId are required',
      });
    }

    const resident = await Resident.findById(residentId)
      .select('_id residentCode fullName barangay status')
      .lean();
    if (!resident || resident.status !== 'Approved') {
      return res.status(404).json({
        success: false,
        message: 'Approved resident not found',
      });
    }

    const distribution = await Distribution.findById(distributionId)
      .select('_id barangay assignedBarangays assignedStaffIds requiresBeneficiaryApproval scheduled endsAt archivedAt status')
      .lean();
    if (!distribution) {
      return res.status(404).json({
        success: false,
        message: 'Distribution not found',
      });
    }

    if (distribution.status === 'Claimed' || !isDistributionClaimable(distribution)) {
      return res.status(409).json({
        success: false,
        code: 'DISTRIBUTION_NOT_ACTIVE',
        message: 'This distribution is no longer inside its active claim window.',
      });
    }

    const scannerId = req.user?.userId || req.user?.id || '';
    const explicitlyAssigned = (distribution.assignedStaffIds ?? [])
      .some((id) => id.toString() === scannerId);
    if (req.user?.role !== 'SUPERADMIN' && !explicitlyAssigned) {
      return res.status(403).json({
        success: false,
        code: 'SCANNER_NOT_ASSIGNED',
        message: 'Your staff account is not assigned to this distribution.',
      });
    }

    const coverage = new Set<string>([
      distribution.barangay,
      ...(Array.isArray(distribution.assignedBarangays) ? distribution.assignedBarangays : []),
    ]);
    if (!coverage.has(resident.barangay)) {
      return res.status(403).json({
        success: false,
        message: 'Resident barangay is not covered by this distribution',
      });
    }

    if (requiresBeneficiaryApproval(distribution as any)) {
      const isApprovedTargetBeneficiary = await isResidentApprovedBeneficiaryForDistribution(
        distributionId,
        residentId,
      );
      if (!isApprovedTargetBeneficiary) {
        return res.status(403).json({
          success: false,
          message: 'Resident is not an approved target beneficiary for this distribution (proof not accepted)',
        });
      }
    }

    // Re-read staff scope so assignment changes take effect without requiring re-login.
    const currentStaff = scannerId && mongoose.Types.ObjectId.isValid(scannerId)
      ? await StaffUser.findById(scannerId).select('assignedBarangays isActive').lean()
      : null;
    const scannerScope = currentStaff?.assignedBarangays ?? [];
    if (
      req.user?.role !== 'SUPERADMIN' &&
      (!currentStaff?.isActive || !scannerScope.some((b) => coverage.has(b)))
    ) {
      return res.status(403).json({
        success: false,
        code: 'SCANNER_OUT_OF_SCOPE',
        message: 'Scanner account is inactive or out of scope for this distribution.',
      });
    }

    const householdId = residentId;

    // Idempotency guard for scanner retries and race conditions.
    // Unique index is (householdId, distributionId), so check exactly that pair.
    const existingClaim = await Claim.findOne({
      claimCategory: 'DISTRIBUTION',
      householdId,
      distributionId,
    })
      .setOptions({ sanitizeFilter: false })
      .lean();
    if (existingClaim) {
      return res.json({
        success: true,
        message: 'Resident already claimed for this distribution',
        alreadyClaimed: true,
        claimId: existingClaim.claimId,
        claimStatus: existingClaim.status,
      });
    }

    const householdCode =
      String(resident.residentCode || '').trim() ||
      `HH-${resident.barangay.slice(0, 2).toUpperCase()}-${residentId.slice(-4).toUpperCase()}`;

    const claimId = `CLM-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
    const staffUserId = scannerId || 'unknown';
    const staffName = req.user?.email || req.user?.userId || 'Mobile Scanner';
    const distributionSite = `${distribution.barangay} Barangay Hall`;

    const upsertResult = await Claim.updateOne(
      { householdId, distributionId, claimCategory: 'DISTRIBUTION' },
      {
        $setOnInsert: {
          claimId,
          householdId,
          residentId,
          householdCode,
          barangay: resident.barangay,
          distributionId,
          distributionSite,
          staffUserId,
          staffName,
          claimCategory: 'DISTRIBUTION',
          claimStatus: 'Claimed',
          scannedBy: staffUserId,
          scannedAt: new Date(),
          source: 'ONLINE',
          status: 'CONFIRMED',
          errorMessage: '',
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    const inserted = upsertResult.upsertedCount === 1;
    const claim = await Claim.findOne({ householdId, distributionId, claimCategory: 'DISTRIBUTION' });
    if (!claim) {
      return res.status(500).json({
        success: false,
        message: 'Unable to load claim after upsert.',
      });
    }

    if (!inserted) {
      return res.json({
        success: true,
        message: 'Resident already claimed for this distribution',
        alreadyClaimed: true,
        claimId: claim.claimId,
        claimStatus: claim.status,
      });
    }

    claim.status = 'CONFIRMED';
    claim.errorMessage = '';
    await claim.save();
    await upsertDistributionClaimFromClaim(claim);

    return res.status(201).json({
      success: true,
      message: 'Claim recorded successfully',
      alreadyClaimed: false,
      claimId: claim.claimId,
      claimStatus: claim.status,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      const residentId = typeof req.body?.residentId === 'string' ? req.body.residentId.trim() : '';
      const distributionId = typeof req.body?.distributionId === 'string' ? req.body.distributionId.trim() : '';

      const existingClaim = residentId && distributionId
        ? await Claim.findOne({ householdId: residentId, distributionId, claimCategory: 'DISTRIBUTION' }).lean()
        : null;

      return res.json({
        success: true,
        message: 'Resident already claimed for this distribution',
        alreadyClaimed: true,
        claimId: existingClaim?.claimId,
        claimStatus: existingClaim?.status,
      });
    }

    console.error('[HouseholdRoutes] QR claim error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to record claim.',
    });
  }
});

/**
 * Check Mobile Number Endpoint
 *
 * POST /api/household/check-mobile
 *
 * Performs a privacy-preserving mobile number pre-check.
 *
 * Request body:
 * {
 *   mobileNumber: string
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   message: string
 * }
 */
router.post('/check-mobile', mobileLookupRateLimiter, validateRequest({ body: checkMobileBody }), async (req: Request, res: Response) => {
  try {
    const { mobileNumber } = req.body;

    if (!mobileNumber || typeof mobileNumber !== 'string') {
      return res.status(400).json({
        success: false,
        available: false,
        message: 'Mobile number is required.',
      });
    }

    const normalizedMobile = normalizePhilippineMobileNumber(mobileNumber.trim());
    if (!isValidPhilippineMobileNumber(normalizedMobile)) {
      return res.status(400).json({
        success: false,
        available: false,
        message: 'Please enter a valid Philippine mobile number.',
      });
    }

    const resident = await Resident.findOne({ mobileNumber: normalizedMobile });

    if (resident) {
      return res.status(409).json({
        success: false,
        available: false,
        message: 'This account already exists. Please sign in instead.',
        errorCode: 'DUPLICATE_MOBILE',
      });
    }

    return res.json({
      success: true,
      available: true,
      message: 'Mobile number is available.',
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Check mobile error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to process request.',
    });
  }
});

/**
 * Dev-only Registration Reset Endpoint
 *
 * POST /api/household/testing/reset-registration
 *
 * Deletes an existing resident registration and resets the linked household token
 * back to UNUSED so the same household can re-test registration.
 */
router.post('/testing/reset-registration', async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is disabled in production',
      });
    }

    const { mobileNumber } = req.body;
    if (!mobileNumber || typeof mobileNumber !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'mobileNumber is required',
      });
    }

    const normalizedMobile = normalizePhilippineMobileNumber(mobileNumber.trim());
    const resident = await Resident.findOne({ mobileNumber: normalizedMobile });

    if (!resident) {
      return res.json({
        success: true,
        message: 'No registration found for this mobile number',
        data: {
          residentDeleted: false,
          tokenReset: false,
        },
      });
    }

    const token = await HouseholdToken.findOne({
      'usedBy.residentId': resident._id,
      status: 'USED',
    }).sort({ usedAt: -1 });

    await Resident.deleteOne({ _id: resident._id });

    let tokenReset = false;
    if (token) {
      const now = new Date();
      token.status = 'UNUSED';
      token.usedAt = null;
      token.usedBy = {
        residentId: null,
        ipAddress: null,
        userAgent: null,
      };
      token.lockedAt = null;
      token.lockedBy = null;
      token.lockExpiresAt = null;

      // Keep token usable for local test retries when it already expired.
      if (token.expiresAt <= now) {
        token.expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      }

      await token.save();
      tokenReset = true;
    }

    return res.json({
      success: true,
      message: 'Registration reset complete',
      data: {
        residentDeleted: true,
        tokenReset,
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Reset registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to reset registration.',
    });
  }
});

/* ================================================================== */
/*  Registration SMS OTP Endpoints                                     */
/* ================================================================== */

const REGISTRATION_OTP_EXPIRY_MINUTES = 5;
const REGISTRATION_OTP_MAX_ATTEMPTS = 5;
const REGISTRATION_OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

/**
 * Send Registration OTP
 *
 * POST /api/household/registration/send-otp
 *
 * Sends a 6-digit OTP via SMS to the given mobile number for
 * registration verification. In dry-run mode (no SMS API key),
 * the OTP is logged to the server console.
 */
router.post(
  '/registration/send-otp',
  registrationOtpRateLimiter,
  validateRequest({ body: sendRegistrationOtpBody }),
  async (req: Request, res: Response) => {
    try {
      const { mobileNumber } = req.body;

      // Validate format
      const normalizedMobile = normalizePhilippineMobileNumber(mobileNumber.trim());
      if (!isValidPhilippineMobileNumber(normalizedMobile)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid mobile number format. Use 09XXXXXXXXX.',
        });
      }

      // Check if mobile is already registered
      const existingResident = await Resident.findOne({ mobileNumber: normalizedMobile });
      if (existingResident) {
        return res.status(409).json({
          success: false,
          message: 'This mobile number is already registered. Please sign in instead.',
          code: 'DUPLICATE_MOBILE',
        });
      }

      // Delete any existing OTP for this number (one active OTP per number)
      await RegistrationOtp.deleteMany({ mobileNumber: normalizedMobile });

      // Generate 6-digit OTP
      const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
      const otpHash = await bcrypt.hash(otp, 10);

      // Store OTP record
      const expiresAt = new Date(Date.now() + REGISTRATION_OTP_EXPIRY_MINUTES * 60 * 1000);
      await RegistrationOtp.create({
        mobileNumber: normalizedMobile,
        otpHash,
        expiresAt,
        attemptsLeft: REGISTRATION_OTP_MAX_ATTEMPTS,
        resendCooldownUntil: new Date(Date.now() + REGISTRATION_OTP_RESEND_COOLDOWN_MS),
      });

      // Send SMS (or log in dry-run)
      try {
        await sendRegistrationOtpSms(normalizedMobile, otp);
      } catch (smsError) {
        console.error('[HouseholdRoutes] SMS send error:', smsError);
        // Don't fail registration if SMS fails — the OTP is still in the DB
        // In dry-run mode this never errors
      }

      // Generate a short-lived JWT as otpToken
      const otpToken = jwt.sign(
        { mobile: normalizedMobile, purpose: 'registration-otp' },
        getJWTSecret(),
        { expiresIn: `${REGISTRATION_OTP_EXPIRY_MINUTES}m` } as SignOptions,
      );

      return res.json({
        success: true,
        message: isSmsConfigured()
          ? 'Verification code sent to your mobile number.'
          : 'Verification code generated (check server console in dev mode).',
        otpToken,
        expiresInSeconds: REGISTRATION_OTP_EXPIRY_MINUTES * 60,
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Send registration OTP error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code. Please try again.',
      });
    }
  },
);

/**
 * Verify Registration OTP
 *
 * POST /api/household/registration/verify-otp
 *
 * Verifies the 6-digit OTP code entered by the user.
 * On success, returns a verifiedToken JWT that proves the mobile
 * number was verified — this is checked at final registration.
 */
router.post(
  '/registration/verify-otp',
  validateRequest({ body: verifyRegistrationOtpBody }),
  async (req: Request, res: Response) => {
    try {
      const { otpToken, otp } = req.body;

      // Verify the otpToken JWT
      let decoded: { mobile: string; purpose: string };
      try {
        decoded = jwt.verify(otpToken, getJWTSecret()) as { mobile: string; purpose: string };
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Verification code has expired. Please request a new one.',
          code: 'OTP_EXPIRED',
        });
      }

      if (decoded.purpose !== 'registration-otp') {
        return res.status(400).json({
          success: false,
          message: 'Invalid verification token.',
        });
      }

      const mobileNumber = decoded.mobile;

      // Find the active OTP record
      const otpRecord = await RegistrationOtp.findOne({
        mobileNumber,
        usedAt: null,
        expiresAt: mongoose.trusted({ $gt: new Date() }),
      }).setOptions({ sanitizeFilter: false });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          message: 'Verification code has expired. Please request a new one.',
          code: 'OTP_EXPIRED',
        });
      }

      // Check attempts
      if (otpRecord.attemptsLeft <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Too many incorrect attempts. Please request a new code.',
          code: 'MAX_ATTEMPTS',
        });
      }

      // Compare OTP
      const isMatch = await bcrypt.compare(otp, otpRecord.otpHash);
      if (!isMatch) {
        otpRecord.attemptsLeft -= 1;
        await otpRecord.save();

        return res.status(400).json({
          success: false,
          message: otpRecord.attemptsLeft > 0
            ? `Incorrect code. ${otpRecord.attemptsLeft} attempt(s) remaining.`
            : 'Too many incorrect attempts. Please request a new code.',
          code: 'WRONG_OTP',
          attemptsLeft: otpRecord.attemptsLeft,
        });
      }

      // Mark OTP as used
      otpRecord.usedAt = new Date();
      await otpRecord.save();

      // Generate a verifiedToken — proof that mobile number was verified
      // This is checked during final registration submission
      const verifiedToken = jwt.sign(
        { mobile: mobileNumber, purpose: 'registration-verified', verifiedAt: Date.now() },
        getJWTSecret(),
        { expiresIn: '30m' } as SignOptions, // Generous: user has 30 min to complete registration
      );

      return res.json({
        success: true,
        message: 'Mobile number verified successfully!',
        verified: true,
        verifiedToken,
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Verify registration OTP error:', error);
      return res.status(500).json({
        success: false,
        message: 'Verification failed. Please try again.',
      });
    }
  },
);

/**
 * Resend Registration OTP
 *
 * POST /api/household/registration/resend-otp
 *
 * Generates a new OTP and resends it via SMS.
 * Enforces a cooldown period between resends.
 */
router.post(
  '/registration/resend-otp',
  registrationOtpRateLimiter,
  validateRequest({ body: resendRegistrationOtpBody }),
  async (req: Request, res: Response) => {
    try {
      const { otpToken } = req.body;

      // Verify the otpToken JWT
      let decoded: { mobile: string; purpose: string };
      try {
        decoded = jwt.verify(otpToken, getJWTSecret()) as { mobile: string; purpose: string };
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Session has expired. Please start over.',
          code: 'OTP_EXPIRED',
        });
      }

      if (decoded.purpose !== 'registration-otp') {
        return res.status(400).json({
          success: false,
          message: 'Invalid verification token.',
        });
      }

      const mobileNumber = decoded.mobile;

      // Check cooldown on existing record
      const existingOtp = await RegistrationOtp.findOne({
        mobileNumber,
        usedAt: null,
        expiresAt: mongoose.trusted({ $gt: new Date() }),
      }).setOptions({ sanitizeFilter: false });

      if (existingOtp && existingOtp.resendCooldownUntil > new Date()) {
        const remainingMs = existingOtp.resendCooldownUntil.getTime() - Date.now();
        const remainingSec = Math.ceil(remainingMs / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${remainingSec} seconds before requesting a new code.`,
          code: 'COOLDOWN',
          retryAfterSeconds: remainingSec,
        });
      }

      // Delete existing OTP and create new one
      await RegistrationOtp.deleteMany({ mobileNumber });

      const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + REGISTRATION_OTP_EXPIRY_MINUTES * 60 * 1000);

      await RegistrationOtp.create({
        mobileNumber,
        otpHash,
        expiresAt,
        attemptsLeft: REGISTRATION_OTP_MAX_ATTEMPTS,
        resendCooldownUntil: new Date(Date.now() + REGISTRATION_OTP_RESEND_COOLDOWN_MS),
      });

      // Send SMS
      try {
        await sendRegistrationOtpSms(mobileNumber, otp);
      } catch (smsError) {
        console.error('[HouseholdRoutes] SMS resend error:', smsError);
      }

      // Generate new otpToken
      const newOtpToken = jwt.sign(
        { mobile: mobileNumber, purpose: 'registration-otp' },
        getJWTSecret(),
        { expiresIn: `${REGISTRATION_OTP_EXPIRY_MINUTES}m` } as SignOptions,
      );

      return res.json({
        success: true,
        message: isSmsConfigured()
          ? 'A new verification code has been sent.'
          : 'New verification code generated (check server console).',
        otpToken: newOtpToken,
        expiresInSeconds: REGISTRATION_OTP_EXPIRY_MINUTES * 60,
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Resend registration OTP error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to resend code. Please try again.',
      });
    }
  },
);

/**
 * Health check for household registration service
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'household-registration',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

export default router;
