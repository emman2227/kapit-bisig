/**
 * Zod schemas for Household routes (/api/household)
 */

import { z } from 'zod';
import { barangayEnum, trimmedString } from './shared';

/* POST /api/household/validate-token */
export const validateTokenBody = z.object({
  token: z.string().min(1, 'Token is required').max(50),
  barangay: z.string().max(50).optional(),
}).strict();

/* POST /api/household/record-duplicate-block */
export const recordDuplicateBlockBody = z.object({
  token: z.string().min(1, 'Token is required').max(50),
  barangay: z.string().max(50).optional(),
  similarity: z.number().min(0).max(1).optional(),
}).strict();

/* Household member item */
export const householdMemberInputSchema = z.object({
  firstName: trimmedString(1, 100),
  lastName: trimmedString(1, 100),
  relationship: z.string().max(50).default('Other'),
  birthYear: z.number().int().min(1900).max(2100).optional().nullable(),
  dateOfBirth: z.string().trim().regex(/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/, 'Invalid Date of Birth format (expected MM-DD-YYYY or YYYY-MM-DD)').optional().nullable(),
  gender: z.enum(['Male', 'Female', 'Other']).optional().nullable(),
  vulnerabilities: z.array(z.string().max(50)).optional(),
});

/* POST /api/household/register */
export const registerHouseholdBody = z.object({
  firstName: trimmedString(1, 100),
  lastName: trimmedString(1, 100),
  dateOfBirth: z.string().min(1, 'Date of birth is required').max(30),
  gender: z.string().min(1, 'Gender is required').max(30),
  mobileNumber: z.string().min(1, 'Mobile number is required').max(20),
  email: z.string().trim().toLowerCase().email('Invalid email format').max(254).optional(),
  password: z.string().min(1, 'Password is required').max(200),
  barangay: barangayEnum,
  streetAddress: trimmedString(1, 500),
  householdToken: z.string().min(1, 'Household token is required').max(50),
  // Optional fields
  city: z.string().max(100).optional(),
  householdSize: z.number().int().min(1).max(50).optional(),
  householdMembers: z.array(householdMemberInputSchema).optional(),
  vulnerableMembers: z.array(z.string().max(50)).optional(),
  vulnerableCounts: z.record(z.string(), z.number()).optional(),
  idType: z.string().min(1, 'ID type is required').max(50),
  idNumber: z.string().min(1, 'ID number is required').max(100),
  frontIdImage: z.string().min(1, 'Front ID image is required'),
  backIdImage: z.string().min(1, 'Back ID image is required'),
  faceImage: z.string().min(1, 'Face image is required'),
  verification: z.any().optional(),
  verificationResult: z.any().optional(),
  verifiedToken: z.string().optional(),
}); // Not strict — service layer handles extra fields

/* POST /api/household/auth/me/household-members/request */
export const requestHouseholdMemberRevisionBody = z.object({
  reason: z.string().trim().min(3, 'A reason is required for household changes').max(500),
  members: z.array(householdMemberInputSchema).min(0).max(50),
}).strict();

/* POST /api/residents/:id/household-members/review */
export const reviewHouseholdMemberRevisionBody = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().trim().max(500).optional(),
}).strict();

/* POST /api/household/check-mobile */
export const checkMobileBody = z.object({
  mobileNumber: z.string().max(20).optional(),
}).strict();

/* PATCH /api/household/auth/me/revision-submit */
export const residentRevisionSubmitBody = z.object({
  idType: z.string().min(1, 'ID type is required').max(50),
  idNumber: z.string().min(1, 'ID number is required').max(100),
  frontIdImage: z.string().min(1, 'Front ID image is required'),
  backIdImage: z.string().min(1, 'Back ID image is required'),
  faceImage: z.string().min(1, 'Face image is required'),
}).strict();

/* POST /api/household/registration/send-otp */
export const sendRegistrationOtpBody = z.object({
  mobileNumber: z.string().min(1, 'Mobile number is required').max(20),
}).strict();

/* POST /api/household/registration/verify-otp */
export const verifyRegistrationOtpBody = z.object({
  otpToken: z.string().min(1, 'OTP token is required'),
  otp: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d{6}$/, 'OTP must be 6 digits'),
}).strict();

/* POST /api/household/registration/resend-otp */
export const resendRegistrationOtpBody = z.object({
  otpToken: z.string().min(1, 'OTP token is required'),
}).strict();
