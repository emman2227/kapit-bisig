/**
 * Distribution Model
 * 
 * MongoDB schema for barangay relief distributions.
 * 
 * Fields:
 * - barangay: The target barangay (one of the 10 predefined values)
 * - status: 'Unclaimed' (default) or 'Claimed'
 * - claimedAt: Date when the distribution was marked as claimed
 * - createdAt / updatedAt: Timestamps
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Valid barangay values
 */
export const BARANGAY_OPTIONS = [
  'Bolo',
  'Bongalon',
  'Dulig',
  'Laois',
  'Magsaysay',
  'Poblacion',
  'San Gonzalo',
  'San Jose',
  'Tobuan',
  'Uyong',
] as const;

export type Barangay = typeof BARANGAY_OPTIONS[number];

export type DistributionStatus = 'Unclaimed' | 'Partially Claimed' | 'Claimed';

export interface IDistribution extends Document {
  disasterEventId?: mongoose.Types.ObjectId | null;
  barangay: Barangay;
  assignedBarangays: Barangay[];
  assignedStaffIds: mongoose.Types.ObjectId[];
  scheduled: string;
  endsAt: Date | null;
  households: number;
  location?: string;
  notes?: string;
  requiresBeneficiaryApproval: boolean;
  status: DistributionStatus;
  claimedAt: Date | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const distributionSchema = new Schema<IDistribution>(
  {
    disasterEventId: {
      type: Schema.Types.ObjectId,
      ref: 'DisasterEvent',
      default: null,
      index: true,
    },
    barangay: {
      type: String,
      required: [true, 'Barangay is required'],
      enum: {
        values: BARANGAY_OPTIONS as unknown as string[],
        message: '{VALUE} is not a valid barangay',
      },
    },
    assignedBarangays: {
      type: [String],
      enum: {
        values: BARANGAY_OPTIONS as unknown as string[],
        message: '{VALUE} is not a valid barangay',
      },
      default: [],
    },
    assignedStaffIds: {
      type: [Schema.Types.ObjectId],
      default: [],
      index: true,
    },
    scheduled: {
      type: String,
      required: [true, 'Scheduled date is required'],
    },
    households: {
      type: Number,
      required: [true, 'Households count is required'],
      min: [0, 'Households must be at least 0'],
      default: 0,
    },
    location: {
      type: String,
      trim: true,
      maxlength: [60, 'Location must be 60 characters or fewer'],
      match: [/^[a-zA-Z0-9\s\-,\.\/:#()ñÑ']*$/, 'Location contains invalid characters'],
      default: '',
    },
    notes: {
      type: String,
      default: '',
    },
    endsAt: {
      type: Date,
      default: null,
      index: true,
    },
    requiresBeneficiaryApproval: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['Unclaimed', 'Partially Claimed', 'Claimed'],
      default: 'Unclaimed',
    },
    claimedAt: {
      type: Date,
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
      index: true,
    },
    archivedBy: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Transform output to include id field
 */
distributionSchema.set('toJSON', {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret.__v;
    return ret;
  },
});

/* ── Indexes for common queries ─────────────────────────────────── */
distributionSchema.index({ barangay: 1, createdAt: -1 });
distributionSchema.index({ status: 1, createdAt: -1 });
distributionSchema.index({ assignedStaffIds: 1, createdAt: -1 });
distributionSchema.index({ requiresBeneficiaryApproval: 1, status: 1, createdAt: -1 });
distributionSchema.index({ disasterEventId: 1, status: 1, createdAt: -1 });
distributionSchema.index({ archivedAt: 1, endsAt: 1, scheduled: 1 });
distributionSchema.index({ barangay: 1, archivedAt: 1, endsAt: 1, scheduled: 1 });
distributionSchema.index({ assignedBarangays: 1, archivedAt: 1, endsAt: 1, scheduled: 1 });

const Distribution = mongoose.model<IDistribution>('Distribution', distributionSchema);

export default Distribution;
