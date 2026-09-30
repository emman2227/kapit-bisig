import mongoose, { Document, Schema } from 'mongoose';

export type ProfileUpdateTarget = 'mobileNumber' | 'email' | 'phoneNumber';

export interface IProfileUpdateOtp extends Document {
  userId: mongoose.Types.ObjectId;
  role: 'Resident' | 'Volunteer' | 'Staff' | 'Admin';
  target: ProfileUpdateTarget;
  newValue: string;
  otpHash: string;
  expiresAt: Date;
  attemptsLeft: number;
  resendCooldownUntil: Date;
  verifiedAt?: Date | null;
  createdAt: Date;
  lastSentAt: Date;
}

const ProfileUpdateOtpSchema = new Schema<IProfileUpdateOtp>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      enum: ['Resident', 'Volunteer', 'Staff', 'Admin'],
    },
    target: {
      type: String,
      required: true,
      enum: ['mobileNumber', 'email', 'phoneNumber'],
    },
    newValue: {
      type: String,
      required: true,
      trim: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index
    },
    attemptsLeft: {
      type: Number,
      required: true,
      default: 5,
      min: 0,
    },
    resendCooldownUntil: {
      type: Date,
      default: () => new Date(0),
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    collection: 'profile_update_otps',
  }
);

ProfileUpdateOtpSchema.index({ userId: 1, target: 1 });

export default (mongoose.models.ProfileUpdateOtp as mongoose.Model<IProfileUpdateOtp>) ||
  mongoose.model<IProfileUpdateOtp>('ProfileUpdateOtp', ProfileUpdateOtpSchema);
