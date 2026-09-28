/**
 * SMS Verification Service
 *
 * Mobile-side client for the registration OTP API endpoints.
 * Handles sending, verifying, and resending OTP codes during
 * household registration.
 *
 * Usage:
 *   import { smsVerificationService } from '../services/auth/SmsVerificationService';
 *   const result = await smsVerificationService.sendOtp('09171234567');
 */

import { resolveApiBaseUrl, resolveDevApiFallbackUrl } from '../config/apiSecurity';

const API_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL,
  'https://kapit-bisig.onrender.com/api',
  'SmsVerificationService',
);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SendOtpResult {
  success: boolean;
  message: string;
  otpToken?: string;
  expiresInSeconds?: number;
  code?: string;
}

export interface VerifyOtpResult {
  success: boolean;
  message: string;
  verified?: boolean;
  verifiedToken?: string;
  code?: string;
  attemptsLeft?: number;
}

export interface ResendOtpResult {
  success: boolean;
  message: string;
  otpToken?: string;
  expiresInSeconds?: number;
  code?: string;
  retryAfterSeconds?: number;
}

/* ------------------------------------------------------------------ */
/*  Fetch helper with fallback                                         */
/* ------------------------------------------------------------------ */

async function fetchWithFallback<T>(
  path: string,
  options: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const doFetch = async (baseUrl: string): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json();
    return data as T;
  };

  try {
    return await doFetch(API_URL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      message.includes('Network request failed') ||
      message.includes('fetch failed') ||
      message.includes('Failed to fetch') ||
      message.toLowerCase().includes('aborted');

    if (isNetworkError) {
      const fallback = resolveDevApiFallbackUrl(API_URL);
      if (fallback) {
        console.warn(`[SmsVerificationService] Retrying via fallback: ${fallback}`);
        return doFetch(fallback);
      }
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------ */
/*  Service Class                                                      */
/* ------------------------------------------------------------------ */

class SmsVerificationService {
  /**
   * Send an OTP to the given mobile number.
   * Returns an otpToken JWT that must be used for verify/resend calls.
   */
  async sendOtp(mobileNumber: string): Promise<SendOtpResult> {
    try {
      const data = await fetchWithFallback<any>(
        '/household/registration/send-otp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mobileNumber }),
        },
      );

      return {
        success: data.success ?? false,
        message: data.message || 'Unknown error',
        otpToken: data.otpToken,
        expiresInSeconds: data.expiresInSeconds,
        code: data.code,
      };
    } catch (error) {
      console.error('[SmsVerificationService] sendOtp error:', error);
      return {
        success: false,
        message: 'Unable to send verification code. Please check your connection.',
      };
    }
  }

  /**
   * Verify the OTP code entered by the user.
   * Returns a verifiedToken JWT on success.
   */
  async verifyOtp(otpToken: string, otp: string): Promise<VerifyOtpResult> {
    try {
      const data = await fetchWithFallback<any>(
        '/household/registration/verify-otp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otpToken, otp }),
        },
      );

      return {
        success: data.success ?? false,
        message: data.message || 'Unknown error',
        verified: data.verified,
        verifiedToken: data.verifiedToken,
        code: data.code,
        attemptsLeft: data.attemptsLeft,
      };
    } catch (error) {
      console.error('[SmsVerificationService] verifyOtp error:', error);
      return {
        success: false,
        message: 'Verification failed. Please check your connection.',
      };
    }
  }

  /**
   * Resend the OTP code to the same mobile number.
   * Returns a new otpToken JWT.
   */
  async resendOtp(otpToken: string): Promise<ResendOtpResult> {
    try {
      const data = await fetchWithFallback<any>(
        '/household/registration/resend-otp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otpToken }),
        },
      );

      return {
        success: data.success ?? false,
        message: data.message || 'Unknown error',
        otpToken: data.otpToken,
        expiresInSeconds: data.expiresInSeconds,
        code: data.code,
        retryAfterSeconds: data.retryAfterSeconds,
      };
    } catch (error) {
      console.error('[SmsVerificationService] resendOtp error:', error);
      return {
        success: false,
        message: 'Unable to resend code. Please check your connection.',
      };
    }
  }
}

// Export singleton instance
export const smsVerificationService = new SmsVerificationService();
export default smsVerificationService;
