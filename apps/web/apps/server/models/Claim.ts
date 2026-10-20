/**
 * Claim Model
 *
 * Stores the full off-chain record of every relief-pack claim.
 * The `blockchain` sub-document mirrors what is stored on-chain
 * so the UI can cross-reference on-chain proof with local data.
 *
 * Status flow:
 *   PENDING_CHAIN   → CHAIN_SUBMITTED → CONFIRMED
 *   PENDING_CHAIN   → CHAIN_FAILED
 *   CHAIN_SUBMITTED → CHAIN_FAILED
 *   CHAIN_FAILED    → CHAIN_SUBMITTED (manual retry)
 */

import mongoose, { Document, Schema } from 'mongoose';

export type ClaimStatus =
  | 'CONFIRMED';

export type ClaimCategory = 'DISTRIBUTION' | 'DISASTER_EVENT';
export type ResidentClaimStatus = 'Unclaimed' | 'Not Claimed' | 'Claimed';
export type ClaimSource = 'ONLINE' | 'OFFLINE_SYNC';

export interface IClaim extends Document {
  claimId: string;
  householdId: string;
  residentId: string;
  householdCode: string;
  barangay: string;
  distributionId: string;
  distributionSite: string;
  staffUserId: string;
  staffName: string;
  claimCategory: ClaimCategory;
  claimStatus: ResidentClaimStatus;
  disasterEventId?: string;
  scannedBy?: string;
  scannedAt?: Date;
  source: ClaimSource;
  syncMetadata?: {
    deviceId?: string;
    clientGeneratedId?: string;
    offlineCapturedAt?: Date;
    syncedAt?: Date;
  };
  status: ClaimStatus;

  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClaimSchema = new Schema<IClaim>(
  {
    claimId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    householdId: {
      type: String,
      required: true,
      index: true,
    },
    residentId: {
      type: String,
      default: '',
      index: true,
    },
    householdCode: {
      type: String,
      required: true,
    },
    barangay: {
      type: String,
      required: true,
      index: true,
    },
    distributionId: {
      type: String,
      required: true,
    },
    distributionSite: {
      type: String,
      required: true,
    },
    staffUserId: {
      type: String,
      required: true,
    },
    staffName: {
      type: String,
      required: true,
    },
    claimCategory: {
      type: String,
      enum: ['DISTRIBUTION', 'DISASTER_EVENT'],
      default: 'DISTRIBUTION',
      index: true,
    },
    claimStatus: {
      type: String,
      enum: ['Unclaimed', 'Not Claimed', 'Claimed'],
      default: 'Claimed',
      index: true,
    },
    disasterEventId: {
      type: String,
      default: '',
      index: true,
    },
    scannedBy: {
      type: String,
      default: '',
    },
    scannedAt: {
      type: Date,
      default: null,
    },
    source: {
      type: String,
      enum: ['ONLINE', 'OFFLINE_SYNC'],
      default: 'ONLINE',
    },
    syncMetadata: {
      deviceId: { type: String, default: '' },
      clientGeneratedId: { type: String, default: '' },
      offlineCapturedAt: { type: Date, default: null },
      syncedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ['CONFIRMED'],
      default: 'CONFIRMED',
      index: true,
    },

    errorMessage: {
      type: String,
      default: '',
    },
  },
  { timestamps: true },
);

// Compound indexes: one successful logical claim per scope.
ClaimSchema.index(
  { householdId: 1, distributionId: 1, claimCategory: 1 },
  {
    unique: true,
    partialFilterExpression: { claimCategory: 'DISTRIBUTION' },
  },
);
ClaimSchema.index(
  { residentId: 1, disasterEventId: 1, claimCategory: 1 },
  {
    unique: true,
    partialFilterExpression: { claimCategory: 'DISASTER_EVENT' },
  },
);
ClaimSchema.index({ claimCategory: 1, disasterEventId: 1, residentId: 1 });

/**
 * Transform output to include id field
 */
ClaimSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret.__v;
    return ret;
  },
});

const Claim = mongoose.model<IClaim>('Claim', ClaimSchema);

export default Claim;
