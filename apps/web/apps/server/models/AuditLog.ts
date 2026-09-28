/**
 * AuditLog Model
 *
 * [SECURITY CHECKLIST §3.3] Audit Logging Enabled — immutable, append-only collection
 *
 * General-purpose, immutable audit trail for security-relevant events.
 * Complements the domain-specific RegistrationAuditLog with a broader
 * scope: auth events, admin actions, distribution/claim operations, etc.
 *
 * Records are append-only — update and delete hooks throw to enforce
 * immutability.
 */

import mongoose, { Document, Schema } from 'mongoose';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'STAFF_CREATED'
  | 'STAFF_UPDATED'
  | 'STAFF_DISABLED'
  | 'STAFF_DELETED'
  | 'STAFF_PASSWORD_RESET'
  | 'STAFF_PASSWORD_RESET_OTP_SENT'
  | 'STAFF_ACTIVATION_OTP_RESENT'
  | 'DISTRIBUTION_CREATED'
  | 'DISTRIBUTION_RESCHEDULED'
  | 'DISTRIBUTION_STAFF_UPDATED'
  | 'DISTRIBUTION_CLAIMED'
  | 'DISTRIBUTION_ARCHIVED'
  | 'DISTRIBUTION_RESTORED'
  | 'CLAIM_RECORDED'
  | 'PROOF_SUBMISSION_CREATED'
  | 'PROOF_SUBMISSION_REVIEWED'
  | 'BENEFICIARY_ELIGIBILITY_UPDATED'
  | 'BENEFICIARY_CLAIM_RECORDED'
  | 'OFFLINE_SYNC_RECEIVED'
  | 'CLAIM_RETRY'
  | 'HOUSEHOLD_UPDATED'
  | 'ACCESS_DENIED'
  | 'FORGOT_PASSWORD_OTP_REQUESTED'
  | 'FORGOT_PASSWORD_OTP_VERIFIED_SUCCESS'
  | 'FORGOT_PASSWORD_OTP_VERIFIED_FAILED'
  | 'FORGOT_PASSWORD_RESET_SUCCESS'
  | 'LOGIN_OTP_SENT'
  | 'LOGIN_OTP_VERIFY_SUCCESS'
  | 'LOGIN_OTP_VERIFY_FAILED'
  | 'LOGIN_OTP_RESEND'
  | 'FACE_DETECT'
  | 'FACE_COMPARE'
  | 'FACE_DESCRIPTOR'
  | 'FACE_VERIFY'
  | 'FACE_DUPLICATE_CHECK'
  | 'FACE_HEALTH_CHECK'
  | 'RESIDENT_STATUS_UPDATED';

export interface IAuditLog extends Document {
  actorId: string | null;
  actorRole: string;
  actorName?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ip: string;
  userAgent: string;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: String, default: null, index: true },
    actorRole: { type: String, required: true },
    actorName: { type: String, default: '' },
    action: {
      type: String,
      required: true,
      index: true,
    },
    entityType: { type: String, required: true },
    entityId: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, required: true },
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  {
    timestamps: false, // we use our own createdAt
    strict: true,
  },
);

/* ------------------------------------------------------------------ */
/*  Indexes                                                            */
/* ------------------------------------------------------------------ */

AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });

// [SECURITY CHECKLIST §3.3] TTL — keep audit entries for 2 years
AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 2 * 365 * 24 * 60 * 60 },
);

/* ------------------------------------------------------------------ */
/*  Immutability guards                                                */
/*  [SECURITY CHECKLIST §3.3] Records are immutable — no update/delete  */
/* ------------------------------------------------------------------ */

for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const) {
  AuditLogSchema.pre(op, function () {
    throw new Error('AuditLog records are immutable');
  });
}

/* ------------------------------------------------------------------ */
/*  Export                                                              */
/* ------------------------------------------------------------------ */

const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
export default AuditLog;
