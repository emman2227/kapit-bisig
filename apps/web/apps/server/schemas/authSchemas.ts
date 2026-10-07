import { z } from 'zod';
import { email as safeEmail } from '../validation/shared';

const trimmedString = z.string().trim();

export const unifiedLoginSchema = z
  .object({
    username: trimmedString.min(3).max(60),
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().optional(),
  })
  .strict();

export const superadminLoginSchema = z
  .object({
    username: trimmedString.min(3).max(60),
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().optional(),
  })
  .strict();

export const householdLoginSchema = z
  .object({
    identifier: trimmedString.min(1).max(50).optional(),
    mobileNumber: trimmedString.max(32).optional(),
    password: z.string().min(1).max(128),
  })
  .refine((data) => Boolean(data.identifier || data.mobileNumber), {
    message: 'Mobile number or Resident Code is required',
  });

export const householdForgotSendOtpSchema = z
  .object({
    email: safeEmail.optional(),
    mobileNumber: trimmedString.max(32).optional(),
  })
  .refine((data) => Boolean(data.email || data.mobileNumber), {
    message: 'Either email or mobileNumber is required',
  })
  .strict();

export const householdForgotVerifyOtpSchema = z
  .object({
    email: safeEmail.optional(),
    mobileNumber: trimmedString.max(32).optional(),
    otp: z.string().length(6).regex(/^\d{6}$/),
  })
  .refine((data) => Boolean(data.email || data.mobileNumber), {
    message: 'Either email or mobileNumber is required',
  })
  .strict();

export const householdForgotResetSchema = z
  .object({
    resetToken: z.string().min(1),
    newPassword: z.string().min(1).max(200),
  })
  .strict();

export const householdChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: z.string().min(1, 'New password is required').max(200),
  })
  .strict();

export const householdChangePasswordRequestOtpSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: z.string().min(1, 'New password is required').max(200),
    channel: z.enum(['sms', 'email']).optional().default('sms'),
  })
  .strict();

export const householdChangePasswordConfirmSchema = z
  .object({
    otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
    newPassword: z.string().min(1, 'New password is required').max(200),
  })
  .strict();

export const userRegisterSchema = z
  .object({
    email: safeEmail,
    password: z.string().min(8).max(128),
    firstName: trimmedString.min(1).max(50),
    lastName: trimmedString.min(1).max(50),
  })
  .strict();

export const userLoginSchema = z
  .object({
    email: safeEmail,
    password: z.string().min(1).max(128),
  })
  .strict();
