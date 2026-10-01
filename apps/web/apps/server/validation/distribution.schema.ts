/**
 * Zod schemas for Distribution routes (/api/distributions)
 */

import { z } from 'zod';
import { barangayEnum, objectId } from './shared';
import { manilaDateParts } from '../utils/distributionLifecycle';

export const LOCATION_REGEX = /^[a-zA-Z0-9\s\-,\.\/:#()ñÑ']*$/;

/* POST /api/distributions — create */
export const createDistributionBody = z.object({
  disasterEventId: objectId.optional(),
  barangay: barangayEnum,
  assignedBarangays: z.array(barangayEnum).optional().default([]),
  location: z
    .string()
    .trim()
    .max(60, 'Location must be 60 characters or fewer')
    .refine((v) => !v || LOCATION_REGEX.test(v), 'Location contains invalid characters')
    .optional()
    .default(''),
  scheduled: z.string().min(1, 'Scheduled date is required').max(50),
  endsAt: z.string().min(1, 'Distribution end time is required').max(50),
  assignedStaffIds: z.array(objectId)
    .min(1, 'Select at least 1 staff member'),
  notes: z.string().max(2000).optional().default(''),
  requiresBeneficiaryApproval: z.boolean().optional(),
}).strict().superRefine((data, ctx) => {
  if (data.assignedBarangays && data.assignedBarangays.length > 0) {
    const unique = new Set(data.assignedBarangays);
    if (unique.size !== data.assignedBarangays.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignedBarangays'],
        message: 'Assigned barangays must be unique',
      });
    }
  }

  if (new Set(data.assignedStaffIds).size !== data.assignedStaffIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignedStaffIds'],
      message: 'Assigned staff must be unique',
    });
  }

  const scheduledAt = new Date(data.scheduled);
  const endsAt = new Date(data.endsAt);
  const minAllowed = Date.now() + 5 * 60 * 1000;
  if (Number.isNaN(scheduledAt.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduled'],
      message: 'Scheduled date/time is invalid',
    });
  } else if (scheduledAt.getTime() < minAllowed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduled'],
      message: 'Scheduled date/time must be at least 5 minutes from now',
    });
  } else {
    const start = manilaDateParts(scheduledAt);
    const startOutsideHours = start.hour < 6 || start.hour >= 20;
    if (startOutsideHours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduled'],
        message: 'Scheduled time must start at or after 6:00 AM and before 8:00 PM Asia/Manila',
      });
    }
  }

  if (Number.isNaN(endsAt.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: 'Distribution end time is invalid',
    });
  } else if (!Number.isNaN(scheduledAt.getTime())) {
    const start = manilaDateParts(scheduledAt);
    const end = manilaDateParts(endsAt);
    if (endsAt.getTime() <= scheduledAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'Distribution end time must be after the start time',
      });
    } else if (start.year !== end.year || start.month !== end.month || start.day !== end.day) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'Distribution must start and end on the same day',
      });
    } else if (end.hour > 20 || (end.hour === 20 && end.minute > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'Distribution must end by 8:00 PM Asia/Manila',
      });
    }
  }
});

/* PATCH /api/distributions/:id/reschedule */
export const rescheduleDistributionBody = z.object({
  scheduled: z.string().min(1, 'Scheduled date is required').max(50),
  reason: z.string().max(500, 'Reason must not exceed 500 characters').optional().default(''),
}).strict().superRefine((data, ctx) => {
  const scheduledAt = new Date(data.scheduled);
  const minAllowed = Date.now() + 5 * 60 * 1000;
  if (Number.isNaN(scheduledAt.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduled'],
      message: 'Scheduled date/time is invalid',
    });
  } else if (scheduledAt.getTime() < minAllowed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduled'],
      message: 'Scheduled date/time must be at least 5 minutes from now',
    });
  }
});

/* PATCH /api/distributions/:id/claim */
export const distributionIdParams = z.object({
  id: objectId,
}).strict();

/* PATCH /api/distributions/:id/staff */
export const updateDistributionStaffBody = z.object({
  assignedStaffIds: z.array(objectId)
    .min(1, 'Select at least 1 staff member'),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.assignedStaffIds).size !== data.assignedStaffIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignedStaffIds'],
      message: 'Assigned staff must be unique',
    });
  }
});

/* GET /api/distributions/:id/households */
// reuses distributionIdParams

/* GET /api/distributions/scanner/roster/:distributionId */
export const distributionRosterParams = z.object({
  distributionId: objectId,
}).strict();

/* POST /api/distributions/scanner/sync-claims */
export const syncClaimsBody = z.object({
  deviceId: z.string().min(1, 'Device ID is required'),
  distributionId: objectId,
  claims: z.array(
    z.object({
      clientGeneratedId: z.string().min(1, 'Client generated ID is required'),
      residentId: objectId,
      residentCode: z.string().optional().default(''),
      scannedAt: z.string().min(1, 'Scanned date is required'),
    })
  ).min(1, 'At least 1 claim required').max(500, 'Maximum 500 claims per batch'),
}).strict();
