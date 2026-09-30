/**
 * User Model
 * 
 * [SECURITY CHECKLIST §1.1] Strong Password Hashing (bcrypt 12 rounds, pre-save hook)
 * [SECURITY CHECKLIST §3.2] Role-Based Access Control (RBAC) — permission mapping
 * 
 * MongoDB schema for user authentication with security features:
 * - Password hashing with bcrypt (pre-save hook)
 * - Password comparison method
 * - Password field excluded from JSON serialization
 * - Role-Based Access Control (RBAC) support
 * 
 * Security Notes:
 * - Passwords are NEVER stored in plaintext
 * - Password is automatically hashed before saving
 * - Use user.comparePassword() for authentication
 * 
 * Roles:
 * - Admin: Full system access (web only)
 * - Staff: Limited admin access (web only)
 * - Volunteer: Field volunteer access (mobile only)
 */

import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcrypt';

/**
 * Salt rounds for bcrypt hashing
 * 12 rounds is the industry standard (2024)
 * Higher = more secure but slower
 */
const SALT_ROUNDS = 12;

/**
 * User Roles for RBAC
 * 
 * Admin: Full system access - can manage users, view all data
 * Staff: Barangay staff - can manage residents, distributions
 * Volunteer: Field volunteer - mobile app access for verification
 */
export type UserRole = 'Admin' | 'Staff' | 'Volunteer';

/**
 * User Status
 */
export type UserStatus = 'Active' | 'Inactive' | 'Suspended';

/**
 * Role permissions mapping
 * Defines what each role can access
 */
export const ROLE_PERMISSIONS = {
  Admin: [
    'users:read',
    'users:create',
    'users:update',
    'users:delete',
    'residents:read',
    'residents:create',
    'residents:update',
    'residents:delete',
    'distribution:read',
    'distribution:create',
    'distribution:update',
    'distribution:delete',
    'reports:read',
    'reports:export',
    'inventory:read',
    'inventory:create',
    'inventory:update',
    'inventory:delete',
    'settings:read',
    'settings:update',
  ],
  Staff: [
    'residents:read',
    'residents:create',
    'residents:update',
    'distribution:read',
    'distribution:create',
    'distribution:update',
    'reports:read',
    'inventory:read',
    'inventory:update',
  ],
  Volunteer: [
    'residents:read',
    'distribution:read',
    'distribution:verify',
    'verification:create',
  ],
} as const;

export type Permission = typeof ROLE_PERMISSIONS[keyof typeof ROLE_PERMISSIONS][number];

export interface IUser extends Document {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  barangay?: string;
  phoneNumber?: string;
  lastLogin?: Date;
  lastProfileUpdateAt?: Date | null;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  hasPermission(permission: Permission): boolean;
}

const UserSchema: Schema = new Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please enter a valid email address',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters long'],
      // Password is never selected by default for security
      select: false,
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    role: {
      type: String,
      enum: {
        values: ['Admin', 'Staff', 'Volunteer'],
        message: '{VALUE} is not a valid role',
      },
      default: 'Staff',
      required: [true, 'Role is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['Active', 'Inactive', 'Suspended'],
        message: '{VALUE} is not a valid status',
      },
      default: 'Active',
    },
    barangay: {
      type: String,
      trim: true,
      maxlength: [100, 'Barangay name cannot exceed 100 characters'],
    },
    phoneNumber: {
      type: String,
      trim: true,
      match: [
        /^(\+63|0)?[0-9]{10,11}$/,
        'Please enter a valid Philippine phone number',
      ],
    },
    lastLogin: {
      type: Date,
    },
    lastProfileUpdateAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-save Middleware: Hash Password
 * 
 * Automatically hashes the password before saving to database.
 * Only runs if password field was modified (prevents re-hashing).
 * 
 * How it works:
 * 1. Check if password was modified
 * 2. Generate salt and hash password with bcrypt
 * 3. Replace plaintext password with hash
 * 4. Continue to save
 * 
 * Security: This ensures passwords are ALWAYS hashed, even if
 * developer forgets to hash manually in route handlers.
 */
UserSchema.pre('save', async function (next) {
  // Only hash if password was modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }
  
  const password = this.password as string;
  
  try {
    // Check if already hashed (starts with bcrypt prefix)
    // This prevents double-hashing if password comes pre-hashed
    if (password.startsWith('$2b$') || password.startsWith('$2a$')) {
      return next();
    }
    
    // Generate salt and hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    this.password = hashedPassword;
    
    next();
  } catch (error) {
    next(error as Error);
  }
});

/**
 * Instance Method: Compare Password
 * 
 * Securely compares a candidate password with the stored hash.
 * Uses bcrypt's constant-time comparison to prevent timing attacks.
 * 
 * @param candidatePassword - The password to verify
 * @returns Promise<boolean> - True if password matches
 * 
 * Usage:
 * const user = await User.findOne({ email }).select('+password');
 * const isMatch = await user.comparePassword('userPassword123');
 */
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  const user = this as IUser;
  return bcrypt.compare(candidatePassword, user.password);
};

/**
 * Instance Method: Check Permission
 * 
 * Checks if the user has a specific permission based on their role.
 * 
 * @param permission - The permission to check
 * @returns boolean - True if user has permission
 * 
 * Usage:
 * if (user.hasPermission('users:create')) { ... }
 */
UserSchema.methods.hasPermission = function (permission: Permission): boolean {
  const user = this as IUser;
  const permissions = ROLE_PERMISSIONS[user.role] as readonly string[];
  return permissions.includes(permission);
};

/**
 * JSON Transformation
 * 
 * Removes password from JSON output for security.
 * Ensures password is never accidentally sent to client.
 */
UserSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

UserSchema.set('toObject', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model<IUser>('User', UserSchema);
