import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import Resident from '../models/Resident';
import ResidentPasswordResetOtp from '../models/ResidentPasswordResetOtp';
import {
  loginRateLimiter,
  authenticatedResidentReadRateLimiter,
} from '../middleware/rateLimiter';
import { validateRequest } from '../validation/validateRequest';
import {
  householdLoginSchema,
  householdChangePasswordSchema,
  householdChangePasswordRequestOtpSchema,
  householdChangePasswordConfirmSchema,
} from '../schemas/authSchemas';
import { residentRevisionSubmitBody } from '../validation/household.schema';
import {
  isValidPhilippineMobileNumber,
  normalizePhilippineMobileNumber,
} from '../utils/mobileNumber';
import { authMiddleware, generateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import { revokeJWTByValue } from '../services/tokenRevocationService';
import { normalizeResidentName } from './householdRoutes';
import { normalizeIdNumber } from '../utils/idVerification';
import { validateBase64Image } from '../validation/imageValidation';
import { screenSubmittedId } from '../services/idScreeningService';
import { persistVerificationImage } from '../utils/imageStorage';
import { buildScreeningValidationIssues, buildVerificationPayload } from '../services/householdRegistrationService';
import { broadcastScopedNotification, createNotification } from '../utils/createNotification';
import { validatePasswordStrength } from '../utils/passwordValidator';
import { sendPasswordResetOtpSms, sendProfileUpdateOtpSms } from '../utils/smsService';
import { sendProfileUpdateOtpEmail } from '../utils/mailer';
import ProfileUpdateOtp from '../models/ProfileUpdateOtp';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable is not set in production');
    }
    return 'dev-jwt-secret-fallback-do-not-use-in-production-min32chars';
  }
  return secret;
}

const router = Router();

const residentAvatarUploadsDir = path.resolve(__dirname, '../../public/uploads/resident-avatars');
if (!fs.existsSync(residentAvatarUploadsDir)) {
  fs.mkdirSync(residentAvatarUploadsDir, { recursive: true });
}
const residentAvatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, residentAvatarUploadsDir),
  filename: (req: any, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `resident-avatar-${userId}${ext}`);
  },
});
const residentAvatarUpload = multer({
  storage: residentAvatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  },
});

/**
 * Resident Login Endpoint
 *
 * POST /api/household/auth/login
 *
 * Authenticates a registered household resident using mobile number + password.
 * Pending and Needs Revision residents are allowed to sign in for limited access (home/profile only).
 * Rejected residents are blocked from sign-in.
 */
router.post('/auth/login', loginRateLimiter, validateRequest({ body: householdLoginSchema }), async (req: Request, res: Response) => {
  try {
    const { mobileNumber, password } = req.body;

    if (!mobileNumber || !password || typeof mobileNumber !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Mobile number and password are required',
      });
    }

    const normalizedMobile = normalizePhilippineMobileNumber(mobileNumber.trim());
    if (!isValidPhilippineMobileNumber(normalizedMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format',
      });
    }

    const resident = await Resident.findOne({ mobileNumber: normalizedMobile }).select('+password');

    if (!resident) {
      return res.status(401).json({
        success: false,
        message: 'Invalid mobile number or password',
      });
    }

    const storedPassword = resident.password || '';
    let passwordValid = false;

    if (/^\$2[aby]\$\d{2}\$/.test(storedPassword)) {
      passwordValid = await bcrypt.compare(password, storedPassword);
    } else {
      passwordValid = password === storedPassword;
      if (passwordValid) {
        resident.password = password;
        await resident.save();
      }
    }

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid mobile number or password',
      });
    }

    if (resident.status === 'Rejected') {
      return res.status(403).json({
        success: false,
        message: 'Your registration was rejected. Please contact your barangay office.',
        code: 'REGISTRATION_REJECTED',
      });
    }

    const token = generateToken(resident._id.toString(), normalizedMobile, 'Resident');

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: resident._id,
          firstName: resident.firstName,
          lastName: resident.lastName,
          fullName: resident.fullName,
          mobileNumber: resident.mobileNumber,
          barangay: resident.barangay,
          status: resident.status,
          role: 'Resident',
        },
        token,
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to process login.',
    });
  }
});

/**
 * Resident Logout Endpoint
 *
 * POST /api/household/auth/logout
 *
 * Invalidates the active bearer token server-side via JWT revocation list.
 */
router.post('/auth/logout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (token) {
      await revokeJWTByValue(token, 'access');
    }
    return res.json({
      success: true,
      message: 'Logged out.',
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to process logout.',
    });
  }
});

/**
 * Resident Session Endpoint
 *
 * GET /api/household/auth/me
 *
 * Returns the authenticated resident profile.
 */
router.get('/auth/me', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const resident = await Resident.findById(userId).select(
      'residentCode avatarUrl firstName lastName fullName mobileNumber email barangay city streetAddress householdSize status rejectionReason lastProfileUpdateAt createdAt'
    );

    if (!resident) {
      return res.status(404).json({
        success: false,
        message: 'Resident not found',
      });
    }

    const normalizedName = normalizeResidentName({
      firstName: resident.firstName,
      lastName: resident.lastName,
      fullName: resident.fullName,
    });

    return res.json({
      success: true,
      data: {
        id: resident._id.toString(),
        residentCode: resident.residentCode,
        avatarUrl: resident.avatarUrl || null,
        firstName: normalizedName.firstName || resident.firstName,
        lastName: normalizedName.lastName || resident.lastName,
        fullName: normalizedName.fullName || resident.fullName,
        mobileNumber: resident.mobileNumber,
        email: resident.email || '',
        barangay: resident.barangay,
        city: resident.city || '',
        streetAddress: resident.streetAddress,
        householdSize: resident.householdSize,
        status: resident.status,
        rejectionReason: resident.rejectionReason || '',
        lastProfileUpdateAt: resident.lastProfileUpdateAt || null,
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident /auth/me error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch resident profile.',
    });
  }
});

/**
 * Request OTP to verify new mobile number or recovery email before saving profile update.
 * POST /api/household/auth/me/profile-update/request-otp
 */
router.post(
  '/auth/me/profile-update/request-otp',
  authMiddleware,
  authenticatedResidentReadRateLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.user?.role !== 'Resident') {
        return res.status(403).json({
          success: false,
          message: 'Only resident accounts can use this endpoint.',
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const { target, value } = req.body || {};
      if (!target || !value || typeof value !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Target (mobileNumber or email) and value are required.',
        });
      }

      const resident = await Resident.findById(userId);
      if (!resident) {
        return res.status(404).json({ success: false, message: 'Resident not found' });
      }

      // Check 24-hour cooldown before sending OTP
      const COOLDOWN_HOURS = 24;
      if (resident.lastProfileUpdateAt) {
        const elapsedMs = Date.now() - new Date(resident.lastProfileUpdateAt).getTime();
        const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
        if (elapsedMs < cooldownMs) {
          const remainingHours = Math.ceil((cooldownMs - elapsedMs) / (60 * 60 * 1000));
          return res.status(429).json({
            success: false,
            message: `Profile details can only be changed once every 24 hours. You can update your profile again in ${remainingHours} hour${remainingHours === 1 ? '' : 's'}.`,
            remainingHours,
          });
        }
      }


      let normalizedValue = '';
      if (target === 'mobileNumber') {
        normalizedValue = normalizePhilippineMobileNumber(value.trim());
        if (!isValidPhilippineMobileNumber(normalizedValue)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid mobile number format. Please use 09XXXXXXXXX format.',
          });
        }

        if (normalizedValue === resident.mobileNumber) {
          return res.status(400).json({
            success: false,
            message: 'This is already your current mobile number.',
          });
        }

        const existingResident = await Resident.findOne({
          _id: mongoose.trusted({ $ne: userId }),
          mobileNumber: normalizedValue,
        }).select('_id').lean();
        if (existingResident) {
          return res.status(409).json({
            success: false,
            message: 'Mobile number is already registered to another account.',
          });
        }
      } else if (target === 'email') {
        normalizedValue = value.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(normalizedValue)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid email address format.',
          });
        }

        if (normalizedValue === (resident.email || '').toLowerCase()) {
          return res.status(400).json({
            success: false,
            message: 'This is already your current email address.',
          });
        }

        const existingResident = await Resident.findOne({
          _id: mongoose.trusted({ $ne: userId }),
          emailLower: normalizedValue,
        }).select('_id').lean();
        if (existingResident) {
          return res.status(409).json({
            success: false,
            message: 'Email is already registered to another account.',
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: 'Unsupported verification target. Must be mobileNumber or email.',
        });
      }

      // Check resend cooldown
      const existingOtp = await ProfileUpdateOtp.findOne({
        userId: resident._id,
        target,
        newValue: normalizedValue,
      });

      if (existingOtp && existingOtp.resendCooldownUntil && existingOtp.resendCooldownUntil > new Date()) {
        const remainingSec = Math.ceil((existingOtp.resendCooldownUntil.getTime() - Date.now()) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${remainingSec} second${remainingSec === 1 ? '' : 's'} before requesting another code.`,
        });
      }

      const otp = crypto.randomInt(100000, 1000000).toString();
      const otpHash = await bcrypt.hash(otp, 10);

      await ProfileUpdateOtp.deleteMany({
        userId: resident._id,
        target,
      });

      await ProfileUpdateOtp.create({
        userId: resident._id,
        role: 'Resident',
        target,
        newValue: normalizedValue,
        otpHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        attemptsLeft: 5,
        resendCooldownUntil: new Date(Date.now() + 60 * 1000), // 60s cooldown
        lastSentAt: new Date(),
      });

      if (target === 'mobileNumber') {
        await sendProfileUpdateOtpSms(normalizedValue, otp);
      } else {
        await sendProfileUpdateOtpEmail(normalizedValue, otp);
      }

      return res.json({
        success: true,
        message: target === 'mobileNumber'
          ? 'Verification code sent to your new mobile number.'
          : 'Verification code sent to your new email address.',
      });
    } catch (error) {
      console.error('[HouseholdRoutes] request-otp error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to send verification code. Please try again.',
      });
    }
  }
);

/**
 * Confirm OTP for new mobile number or recovery email before saving profile update.
 * POST /api/household/auth/me/profile-update/confirm-otp
 */
router.post(
  '/auth/me/profile-update/confirm-otp',
  authMiddleware,
  authenticatedResidentReadRateLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.user?.role !== 'Resident') {
        return res.status(403).json({
          success: false,
          message: 'Only resident accounts can use this endpoint.',
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const { target, value, otp } = req.body || {};
      if (!target || !value || !otp || typeof otp !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Target, value, and OTP are required.',
        });
      }

      let normalizedValue = '';
      if (target === 'mobileNumber') {
        normalizedValue = normalizePhilippineMobileNumber(value.trim());
      } else if (target === 'email') {
        normalizedValue = value.trim().toLowerCase();
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid target',
        });
      }

      const otpRecord = await ProfileUpdateOtp.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        target,
        newValue: normalizedValue,
      });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          message: 'No active verification code found. Please request a new code.',
        });
      }

      if (otpRecord.expiresAt < new Date()) {
        await ProfileUpdateOtp.findByIdAndDelete(otpRecord._id);
        return res.status(400).json({
          success: false,
          message: 'Verification code has expired. Please request a new code.',
        });
      }

      if (otpRecord.attemptsLeft <= 0) {
        await ProfileUpdateOtp.findByIdAndDelete(otpRecord._id);
        return res.status(429).json({
          success: false,
          message: 'Too many incorrect attempts. Please request a new code.',
        });
      }

      const isOtpValid = await bcrypt.compare(otp.trim(), otpRecord.otpHash);
      if (!isOtpValid) {
        otpRecord.attemptsLeft -= 1;
        await otpRecord.save();
        return res.status(400).json({
          success: false,
          message: `Incorrect verification code. ${otpRecord.attemptsLeft} attempt${otpRecord.attemptsLeft === 1 ? '' : 's'} remaining.`,
        });
      }

      // Valid OTP! Generate signed verification token
      const verificationToken = jwt.sign(
        {
          userId,
          role: 'Resident',
          target,
          value: normalizedValue,
          purpose: 'profile-update-verification',
        },
        getJWTSecret(),
        { expiresIn: '15m' }
      );

      // Clean up the verified OTP record
      await ProfileUpdateOtp.findByIdAndDelete(otpRecord._id);

      return res.json({
        success: true,
        message: 'Verification successful.',
        verificationToken,
      });
    } catch (error) {
      console.error('[HouseholdRoutes] confirm-otp error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to verify code.',
      });
    }
  }
);

/**
 * Resident Profile Update Endpoint
 *
 * PATCH /api/household/auth/me
 *
 * Allows authenticated resident to update selected profile fields with password confirmation,
 * 30-day cooldown enforcement, and OTP verification for mobile/email changes.
 */
router.patch('/auth/me', authMiddleware, authenticatedResidentReadRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Resident') {
      return res.status(403).json({
        success: false,
        message: 'Only resident accounts can update this profile.',
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const resident = await Resident.findById(userId).select('+password');
    if (!resident) {
      return res.status(404).json({
        success: false,
        message: 'Resident not found',
      });
    }

    const payload = req.body || {};

    // 1. Password Verification
    if (!payload.password || typeof payload.password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Password is required to confirm profile changes.',
      });
    }

    let isPasswordValid = false;
    if (/^\$2[aby]\$\d{2}\$/.test(resident.password || '')) {
      isPasswordValid = await bcrypt.compare(payload.password, resident.password || '');
    } else {
      isPasswordValid = payload.password === resident.password;
    }

    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect password. Changes were not saved.',
      });
    }

    // 2. Cooldown check (24 hours)
    const COOLDOWN_HOURS = 24;
    if (resident.lastProfileUpdateAt) {
      const elapsedMs = Date.now() - new Date(resident.lastProfileUpdateAt).getTime();
      const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
      if (elapsedMs < cooldownMs) {
        const remainingHours = Math.ceil((cooldownMs - elapsedMs) / (60 * 60 * 1000));
        return res.status(429).json({
          success: false,
          message: `Profile details can only be changed once every 24 hours. You can update your profile again in ${remainingHours} hour${remainingHours === 1 ? '' : 's'}.`,
          remainingHours,
        });
      }
    }


    // 3. Strict immutability checks: firstName, lastName, city, barangay CANNOT be modified
    if (payload.firstName !== undefined && payload.firstName.trim() !== resident.firstName) {
      return res.status(400).json({
        success: false,
        message: 'First name cannot be changed directly. Please submit an official revision request.',
      });
    }
    if (payload.lastName !== undefined && payload.lastName.trim() !== resident.lastName) {
      return res.status(400).json({
        success: false,
        message: 'Last name cannot be changed directly. Please submit an official revision request.',
      });
    }
    if (payload.city !== undefined && payload.city.trim() !== (resident.city || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'City/Municipality cannot be changed. It is assigned by your LGU.',
      });
    }

    const updates: Record<string, any> = {};

    // 4. Street Address update
    if (payload.streetAddress !== undefined) {
      if (typeof payload.streetAddress !== 'string') {
        return res.status(400).json({ success: false, message: 'Street address must be a string.' });
      }
      const trimmedAddress = payload.streetAddress.trim();
      if (!trimmedAddress) {
        return res.status(400).json({ success: false, message: 'Street address cannot be empty.' });
      }
      if (trimmedAddress !== resident.streetAddress) {
        updates.streetAddress = trimmedAddress;
      }
    }

    // 5. Mobile Number update (requires OTP verificationToken)
    if (payload.mobileNumber !== undefined) {
      if (typeof payload.mobileNumber !== 'string') {
        return res.status(400).json({ success: false, message: 'mobileNumber must be a string' });
      }
      const normalizedMobile = normalizePhilippineMobileNumber(payload.mobileNumber.trim());
      if (!isValidPhilippineMobileNumber(normalizedMobile)) {
        return res.status(400).json({ success: false, message: 'Invalid mobile number format' });
      }

      if (normalizedMobile !== resident.mobileNumber) {
        if (!payload.mobileVerificationToken || typeof payload.mobileVerificationToken !== 'string') {
          return res.status(400).json({
            success: false,
            message: 'Mobile number change requires OTP verification.',
          });
        }

        try {
          const decoded = jwt.verify(payload.mobileVerificationToken, getJWTSecret()) as any;
          if (
            decoded.userId !== userId ||
            decoded.target !== 'mobileNumber' ||
            decoded.value !== normalizedMobile ||
            decoded.purpose !== 'profile-update-verification'
          ) {
            return res.status(400).json({
              success: false,
              message: 'Invalid or expired mobile verification token.',
            });
          }
        } catch {
          return res.status(400).json({
            success: false,
            message: 'Invalid or expired mobile verification token. Please verify again.',
          });
        }

        const existing = await Resident.findOne({
          _id: mongoose.trusted({ $ne: userId }),
          mobileNumber: normalizedMobile,
        }).select('_id').lean();
        if (existing) {
          return res.status(409).json({ success: false, message: 'Mobile number is already in use.' });
        }

        updates.mobileNumber = normalizedMobile;
      }
    }

    // 6. Email update (requires OTP verificationToken)
    if (payload.email !== undefined) {
      if (typeof payload.email !== 'string') {
        return res.status(400).json({ success: false, message: 'email must be a string' });
      }
      const normalizedEmail = payload.email.trim().toLowerCase();
      if (normalizedEmail.length > 0 && !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: 'Invalid email format' });
      }

      if (normalizedEmail !== (resident.email || '').toLowerCase()) {
        if (normalizedEmail.length > 0) {
          if (!payload.emailVerificationToken || typeof payload.emailVerificationToken !== 'string') {
            return res.status(400).json({
              success: false,
              message: 'Email change requires OTP verification.',
            });
          }

          try {
            const decoded = jwt.verify(payload.emailVerificationToken, getJWTSecret()) as any;
            if (
              decoded.userId !== userId ||
              decoded.target !== 'email' ||
              decoded.value !== normalizedEmail ||
              decoded.purpose !== 'profile-update-verification'
            ) {
              return res.status(400).json({
                success: false,
                message: 'Invalid or expired email verification token.',
              });
            }
          } catch {
            return res.status(400).json({
              success: false,
              message: 'Invalid or expired email verification token. Please verify again.',
            });
          }

          const existing = await Resident.findOne({
            _id: mongoose.trusted({ $ne: userId }),
            emailLower: normalizedEmail,
          }).select('_id').lean();
          if (existing) {
            return res.status(409).json({ success: false, message: 'Email is already in use.' });
          }
        }

        updates.email = normalizedEmail;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No changes detected to save.',
      });
    }

    Object.assign(resident, updates);
    resident.lastProfileUpdateAt = new Date();
    await resident.save();

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: resident._id.toString(),
        residentCode: resident.residentCode,
        avatarUrl: resident.avatarUrl || null,
        firstName: resident.firstName,
        lastName: resident.lastName,
        fullName: resident.fullName,
        mobileNumber: resident.mobileNumber,
        email: resident.email || '',
        barangay: resident.barangay,
        city: resident.city || '',
        streetAddress: resident.streetAddress,
        householdSize: resident.householdSize,
        status: resident.status,
        rejectionReason: resident.rejectionReason || '',
        lastProfileUpdateAt: resident.lastProfileUpdateAt,
      },
    });
  } catch (error) {
    console.error('[HouseholdRoutes] Resident PATCH /auth/me error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to update resident profile.',
    });
  }
});


/**
 * Resident Change Password — Step 1: Request OTP
 *
 * POST /api/household/auth/me/change-password/request-otp
 *
 * Validates current password and new password strength, generates a 6-digit OTP,
 * and sends it via SMS to the resident's registered phone number.
 */
router.post(
  '/auth/me/change-password/request-otp',
  authMiddleware,
  authenticatedResidentReadRateLimiter,
  validateRequest({ body: householdChangePasswordRequestOtpSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.user?.role !== 'Resident') {
        return res.status(403).json({
          success: false,
          message: 'Only resident accounts can change password using this endpoint.',
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };

      const resident = await Resident.findById(userId).select('+password');
      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident account not found',
        });
      }

      const storedPassword = resident.password || '';
      let isCurrentValid = false;
      if (/^\$2[aby]\$\d{2}\$/.test(storedPassword)) {
        isCurrentValid = await bcrypt.compare(currentPassword, storedPassword);
      } else {
        isCurrentValid = currentPassword === storedPassword;
      }

      if (!isCurrentValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect.',
        });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({
          success: false,
          message: 'New password cannot be the same as your current password.',
        });
      }

      const strengthResult = validatePasswordStrength(newPassword);
      if (!strengthResult.ok) {
        return res.status(400).json({
          success: false,
          message: 'Password does not meet security requirements.',
          errors: strengthResult.reason ? strengthResult.reason.split('; ') : ['Password is too weak'],
        });
      }

      if (!resident.mobileNumber) {
        return res.status(400).json({
          success: false,
          message: 'No mobile number registered to receive verification code.',
        });
      }

      const otp = crypto.randomInt(100000, 1000000).toString();
      const otpHash = await bcrypt.hash(otp, 10);
      const identifier = `change_pw_${resident._id.toString()}`;

      await ResidentPasswordResetOtp.deleteMany({ identifier });
      await ResidentPasswordResetOtp.create({
        residentId: resident._id,
        identifier,
        mobileNumber: resident.mobileNumber,
        otpHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        attemptsLeft: 5,
        lastSentAt: new Date(),
      });

      await sendPasswordResetOtpSms(resident.mobileNumber, otp);

      return res.json({
        success: true,
        message: 'Verification code sent to your registered mobile number.',
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Resident request change-password OTP error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to send verification code.',
      });
    }
  }
);

/**
 * Resident Change Password — Step 2: Confirm OTP & Change Password
 *
 * POST /api/household/auth/me/change-password/confirm
 *
 * Verifies the 6-digit OTP and updates the resident password.
 */
router.post(
  '/auth/me/change-password/confirm',
  authMiddleware,
  authenticatedResidentReadRateLimiter,
  validateRequest({ body: householdChangePasswordConfirmSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.user?.role !== 'Resident') {
        return res.status(403).json({
          success: false,
          message: 'Only resident accounts can change password using this endpoint.',
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const { otp, newPassword } = req.body as {
        otp: string;
        newPassword: string;
      };

      const identifier = `change_pw_${userId}`;
      const otpRecord = await ResidentPasswordResetOtp.findOne({ identifier });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          message: 'No active password change request found. Please request a new code.',
        });
      }

      if (otpRecord.expiresAt < new Date()) {
        await ResidentPasswordResetOtp.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({
          success: false,
          message: 'Verification code has expired. Please request a new code.',
        });
      }

      if (otpRecord.attemptsLeft <= 0) {
        await ResidentPasswordResetOtp.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please request a new code.',
        });
      }

      const isOtpValid = await bcrypt.compare(otp, otpRecord.otpHash);
      if (!isOtpValid) {
        otpRecord.attemptsLeft -= 1;
        await otpRecord.save();
        return res.status(400).json({
          success: false,
          message: `Invalid verification code. ${otpRecord.attemptsLeft} attempt(s) remaining.`,
        });
      }

      const strengthResult = validatePasswordStrength(newPassword);
      if (!strengthResult.ok) {
        return res.status(400).json({
          success: false,
          message: 'Password does not meet security requirements.',
          errors: strengthResult.reason ? strengthResult.reason.split('; ') : ['Password is too weak'],
        });
      }

      const resident = await Resident.findById(userId).select('+password');
      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident account not found',
        });
      }

      resident.password = await bcrypt.hash(newPassword, 12);
      await resident.save();

      await ResidentPasswordResetOtp.deleteOne({ _id: otpRecord._id });

      await createNotification({
        userId: resident._id.toString(),
        title: 'Password Changed Successfully',
        message: 'Your account password has been updated. If you did not make this change, please contact your barangay office immediately.',
        type: 'security',
        meta: {
          residentId: resident._id.toString(),
          residentCode: resident.residentCode,
        },
      });

      return res.json({
        success: true,
        message: 'Password updated successfully.',
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Resident confirm change-password error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to update password.',
      });
    }
  }
);

/**
 * Resident Change Password Endpoint (Direct)
 *
 * POST /api/household/auth/me/change-password
 */
router.post(
  '/auth/me/change-password',
  authMiddleware,
  authenticatedResidentReadRateLimiter,
  validateRequest({ body: householdChangePasswordSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.user?.role !== 'Resident') {
        return res.status(403).json({
          success: false,
          message: 'Only resident accounts can change password using this endpoint.',
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };

      const resident = await Resident.findById(userId).select('+password');
      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident account not found',
        });
      }

      const storedPassword = resident.password || '';
      let isCurrentValid = false;
      if (/^\$2[aby]\$\d{2}\$/.test(storedPassword)) {
        isCurrentValid = await bcrypt.compare(currentPassword, storedPassword);
      } else {
        isCurrentValid = currentPassword === storedPassword;
      }

      if (!isCurrentValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect.',
        });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({
          success: false,
          message: 'New password cannot be the same as your current password.',
        });
      }

      const strengthResult = validatePasswordStrength(newPassword);
      if (!strengthResult.ok) {
        return res.status(400).json({
          success: false,
          message: 'Password does not meet security requirements.',
          errors: strengthResult.reason ? strengthResult.reason.split('; ') : ['Password is too weak'],
        });
      }

      resident.password = await bcrypt.hash(newPassword, 12);
      await resident.save();

      await createNotification({
        userId: resident._id.toString(),
        title: 'Password Changed Successfully',
        message: 'Your account password has been updated. If you did not make this change, please contact your barangay office immediately.',
        type: 'security',
        meta: {
          residentId: resident._id.toString(),
          residentCode: resident.residentCode,
        },
      });

      return res.json({
        success: true,
        message: 'Password updated successfully.',
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Resident change password error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to update password.',
      });
    }
  }
);

/**
 * Resident Revision Resubmission Endpoint
 *
 * PATCH /api/household/auth/me/revision-submit
 *
 * Allows a resident whose registration needs revision to upload corrected
 * ID files and selfie, then return the account to Pending review.
 */
router.patch(
  '/auth/me/revision-submit',
  authMiddleware,
  authenticatedResidentReadRateLimiter,
  validateRequest({ body: residentRevisionSubmitBody }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.user?.role !== 'Resident') {
        return res.status(403).json({
          success: false,
          message: 'Only resident accounts can submit registration revisions.',
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const resident = await Resident.findById(userId).select(
        'residentCode firstName lastName fullName mobileNumber email barangay city streetAddress householdSize status rejectionReason idType idNumber frontIdImage backIdImage faceImage verification verifiedAt verifiedBy',
      );

      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident not found',
        });
      }

      if (resident.status !== 'Needs Revision') {
        return res.status(409).json({
          success: false,
          message: 'This registration is not currently marked for revision.',
        });
      }

      const { idType, idNumber, frontIdImage, backIdImage, faceImage } = req.body as {
        idType: string;
        idNumber: string;
        frontIdImage: string;
        backIdImage: string;
        faceImage: string;
      };

      const normalizedIdNumber = normalizeIdNumber(idType, idNumber || '');

      const [frontValidation, backValidation, faceValidation] = await Promise.all([
        validateBase64Image(frontIdImage, {
          fieldName: 'Front ID image',
          maxBytes: 2 * 1024 * 1024,
          minWidth: 200,
          minHeight: 200,
          maxWidth: 4096,
          maxHeight: 4096,
        }),
        validateBase64Image(backIdImage, {
          fieldName: 'Back ID image',
          maxBytes: 2 * 1024 * 1024,
          minWidth: 200,
          minHeight: 200,
          maxWidth: 4096,
          maxHeight: 4096,
        }),
        validateBase64Image(faceImage, {
          fieldName: 'Face image',
          maxBytes: 2 * 1024 * 1024,
          minWidth: 160,
          minHeight: 160,
          maxWidth: 4096,
          maxHeight: 4096,
        }),
      ]);

      const failedValidation = [frontValidation, backValidation, faceValidation].find((item) => !item.ok);
      if (failedValidation && !failedValidation.ok) {
        const field = failedValidation.message.toLowerCase().includes('front')
          ? 'frontIdImage'
          : failedValidation.message.toLowerCase().includes('back')
            ? 'backIdImage'
            : 'faceImage';
        return res.status(400).json({
          success: false,
          message: failedValidation.message,
          validationErrors: [{
            field,
            code: 'INVALID_IMAGE',
            message: failedValidation.message,
          }],
        });
      }

      let idScreening;
      try {
        idScreening = await screenSubmittedId({
          idType,
          idNumber: normalizedIdNumber,
          frontIdImage,
          backIdImage,
        });
      } catch (screeningError) {
        const message = screeningError instanceof Error
          ? screeningError.message
          : 'Unable to screen the corrected ID.';
        return res.status(400).json({
          success: false,
          message,
          validationErrors: [{
            field: 'frontIdImage',
            code: 'ID_SCREENING_FAILED',
            message,
          }],
        });
      }

      if (idScreening.decision === 'BLOCK') {
        return res.status(400).json({
          success: false,
          message: idScreening.reasons[0] || 'The corrected ID failed automated screening.',
          validationErrors: buildScreeningValidationIssues(idScreening),
        });
      }

      resident.idType = idType;
      resident.idNumber = normalizedIdNumber;
      resident.frontIdImage = persistVerificationImage(frontIdImage, 'revision-front-id');
      resident.backIdImage = persistVerificationImage(backIdImage, 'revision-back-id');
      resident.faceImage = persistVerificationImage(faceImage, 'revision-face');
      resident.verification = buildVerificationPayload({
        overallConfidence: Number(resident.verification?.overallConfidence || 0),
        idConfidence: Number(resident.verification?.idConfidence || 0),
        faceMatchConfidence: Number(resident.verification?.faceMatchConfidence || 0),
        livenessConfidence: Number(resident.verification?.livenessConfidence || 0),
        dataMatchScore: Number(resident.verification?.dataMatchScore || 0),
        riskScore: Number(resident.verification?.riskScore || 0),
        isVerified: Boolean(resident.verification?.isVerified),
        aiVerificationStatus: resident.verification?.aiVerificationStatus || 'Low Match',
        warnings: resident.verification?.warnings || [],
        riskFactors: resident.verification?.riskFactors || [],
      }, idScreening);
      resident.status = 'Pending';
      resident.rejectionReason = undefined;
      resident.verifiedAt = undefined;
      resident.verifiedBy = undefined;

      await resident.save();

      await broadcastScopedNotification({
        title: 'Resident Resubmitted Registration',
        message: `${resident.fullName || `${resident.firstName} ${resident.lastName}`.trim()} submitted corrected registration documents for review.`,
        type: 'status_update',
        targetBarangays: [resident.barangay],
        meta: {
          residentId: resident._id.toString(),
          residentCode: resident.residentCode,
        },
      });

      return res.json({
        success: true,
        message: 'Corrected documents submitted successfully. Your registration is back in the review queue.',
        data: {
          id: resident._id.toString(),
          residentCode: resident.residentCode,
          firstName: resident.firstName,
          lastName: resident.lastName,
          fullName: resident.fullName,
          mobileNumber: resident.mobileNumber,
          email: resident.email || '',
          barangay: resident.barangay,
          city: resident.city || '',
          streetAddress: resident.streetAddress,
          householdSize: resident.householdSize,
          status: resident.status,
          rejectionReason: resident.rejectionReason || '',
        },
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Resident revision submit error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to submit corrected registration files.',
      });
    }
  },
);

/**
 * Resident Avatar Upload Endpoint
 *
 * POST /api/household/auth/me/avatar
 *
 * Stores resident profile photo and returns public avatar URL.
 */
router.post(
  '/auth/me/avatar',
  authMiddleware,
  authenticatedResidentReadRateLimiter,
  residentAvatarUpload.single('avatar'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.user?.role !== 'Resident') {
        return res.status(403).json({
          success: false,
          message: 'Only resident accounts can update this profile.',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image file uploaded.',
        });
      }

      const userId = req.user.userId;
      const resident = await Resident.findById(userId);

      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident not found',
        });
      }

      const avatarUrl = `/uploads/resident-avatars/${req.file.filename}`;
      resident.avatarUrl = avatarUrl;
      await resident.save();

      return res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl,
        },
      });
    } catch (error) {
      console.error('[HouseholdRoutes] Resident avatar upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Unable to upload avatar.',
      });
    }
  }
);

export default router;
