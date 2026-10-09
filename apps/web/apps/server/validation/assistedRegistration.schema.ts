/**
 * Zod validation schema for Assisted Registration routes (/api/assisted-registration)
 */

import { z } from 'zod';
import { barangayEnum, trimmedString } from './shared';

export const assistedRegistrationBody = z.object({
  firstName: trimmedString(1, 100),
  lastName: trimmedString(1, 100),
  dateOfBirth: z.string().min(1, 'Date of birth is required').max(30),
  gender: z.enum(['Male', 'Female']),
  mobileNumber: z.string().max(20).optional(),
  email: z.string().trim().toLowerCase().email('Invalid email format').max(254).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
  barangay: barangayEnum,
  streetAddress: trimmedString(1, 500),
  householdToken: z.string().trim().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i, 'Invalid household token format (XXXX-XXXX-XXXX)'),
  city: z.string().max(100).optional(),
  householdSize: z.number().int().min(1).max(50).optional(),
  vulnerableMembers: z.array(z.string().max(50)).optional(),
  vulnerableCounts: z.record(z.string(), z.number()).optional(),
  idType: z.string().min(1, 'ID type is required').max(80),
  idNumber: z.string().max(100).optional(),
  frontIdImage: z.string().optional(),
  backIdImage: z.string().optional(),
  faceImage: z.string().min(1, 'Face image is required'),
  attestationReason: z.string().max(500).optional(),
  verification: z.any().optional(),
});

export type AssistedRegistrationInput = z.infer<typeof assistedRegistrationBody>;
