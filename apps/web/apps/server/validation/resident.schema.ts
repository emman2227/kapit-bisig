/**
 * Zod schemas for Resident routes (/api/residents)
 */

import { z } from 'zod';
import { barangayEnum, objectId, trimmedString } from './shared';

const NAME_REGEX = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;
const PH_MOBILE_REGEX = /^(09\d{9}|\+639\d{9})$/;
const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~\\]).+$/;

/* POST /api/residents/register */
export const registerResidentBody = z.object({
  firstName: trimmedString(2, 50).regex(
    NAME_REGEX,
    'First name must be 2–50 characters and contain letters only.',
  ),
  lastName: trimmedString(2, 50).regex(
    NAME_REGEX,
    'Last name must be 2–50 characters and contain letters only.',
  ),
  fullName: z.string().max(200).optional(),
  dateOfBirth: z.string().min(1, 'Date of birth is required').max(30),
  gender: z.string().min(1, 'Gender is required').max(30),
  mobileNumber: z
    .string()
    .min(1, 'Mobile number is required')
    .regex(PH_MOBILE_REGEX, 'Please enter a valid Philippine mobile number.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.')
    .max(16, 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.')
    .regex(
      PASSWORD_COMPLEXITY_REGEX,
      'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
    ),
  // Address
  city: z.string().max(100).optional().default(''),
  barangay: trimmedString(1, 100),
  streetAddress: trimmedString(1, 500),
  householdSize: z.number().int().min(1).max(50).optional().default(1),
  vulnerableMembers: z.array(z.string().max(50)).optional().default([]),
  vulnerableCounts: z.record(z.string(), z.number()).optional().default({}),
  // ID
  idType: z.string().min(1, 'ID type is required').max(50),
  idNumber: z.string().min(1, 'ID number is required').max(100),
  frontIdImage: z
    .string()
    .min(1, 'Front ID image is required')
    .max(6_000_000, 'Front ID image payload is too large'),
  backIdImage: z
    .string()
    .min(1, 'Back ID image is required')
    .max(6_000_000, 'Back ID image payload is too large'),
  // Face
  faceImage: z
    .string()
    .min(1, 'Face image is required')
    .max(6_000_000, 'Face image payload is too large'),
  // Verification (from mobile AI)
  verificationResult: z.unknown().optional(),
}); // Not strict to allow mobile client flexibility

/* GET /api/residents */
export const listResidentsQuery = z.object({
  status: z.string().max(30).optional(),
  barangay: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  assistedBy: z.string().max(100).optional(),
  myOnly: z.enum(['true', 'false']).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
}).strict();

/* GET /api/residents/:id */
export const residentIdParams = z.object({
  id: objectId,
}).strict();

/* PATCH /api/residents/:id/status */
export const residentStatusUpdateBody = z
  .object({
    status: z.enum(['Approved', 'Needs Revision', 'Rejected']),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.status === 'Rejected' || value.status === 'Needs Revision')
      && (!value.rejectionReason || value.rejectionReason.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReason'],
        message: 'A review note is required when returning or rejecting a registration.',
      });
    }
  })
  .strict();

/* POST /api/residents/codes/generate-batch */
export const generateCodeBatchBody = z
  .object({
    barangay: barangayEnum,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

/* PATCH /api/residents/:id/assisted-revision */
export const assistedRevisionBody = z
  .object({
    idType: z.string().trim().max(100).optional(),
    idNumber: z.string().trim().max(100).optional(),
    frontIdImage: z.string().max(6_000_000).optional(),
    backIdImage: z.string().max(6_000_000).optional(),
    faceImage: z.string().max(6_000_000).optional(),
    attestationReason: z.string().trim().max(500).optional(),
    staffNote: z.string().trim().max(500).optional(),
  })
  .strict();


