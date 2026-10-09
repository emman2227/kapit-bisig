/**
 * Assisted Registration Service
 * 
 * Handles walk-in registration of residents conducted by authorized staff or volunteers.
 * Used for residents without mobile phones, SIM cards, or standard government IDs.
 */

import crypto from 'crypto';
import Resident from '../models/Resident';
import { AssistedRegistrationInput } from '../validation/assistedRegistration.schema';
import {
  isValidPhilippineMobileNumber,
  normalizePhilippineMobileNumber,
} from '../utils/mobileNumber';
import {
  normalizeIdNumber,
  validateIdType,
  validateIdNumberFormat,
} from '../utils/idVerification';
import { persistVerificationImage } from '../utils/imageStorage';
import { buildResidentQrToken } from './residentQrService';
import { checkDuplicateFace } from './duplicateFaceService';
import { householdTokenService, generateRequestId } from './householdTokenService';
import mongoose from 'mongoose';

export interface AssistedStaffUser {
  userId: string;
  name?: string;
  role: string;
}

export interface AssistedRegistrationResult {
  success: boolean;
  message: string;
  residentId?: string;
  residentCode?: string;
  qrToken?: string;
  tempPassword?: string;
  errorCode?: string;
}

export async function registerAssistedResident(
  data: AssistedRegistrationInput,
  staffUser: AssistedStaffUser,
  ipAddress: string = '127.0.0.1',
  userAgent: string = 'Staff-Assisted-Registration'
): Promise<AssistedRegistrationResult> {
  const requestId = generateRequestId();
  const lockerId = `${staffUser.userId || 'staff'}_${requestId}`;
  let tokenId: mongoose.Types.ObjectId | null = null;
  let lockAcquired = false;

  const abortWithLockRelease = async (
    message: string,
    errorCode: string
  ): Promise<AssistedRegistrationResult> => {
    if (lockAcquired && tokenId) {
      await householdTokenService.releaseLock(
        tokenId,
        lockerId,
        ipAddress,
        userAgent,
        requestId,
        `Assisted registration aborted: ${errorCode}`
      );
    }
    return {
      success: false,
      message,
      errorCode,
    };
  };

  try {
    // 0. Household Token validation & atomic lock
    if (!data.householdToken || !data.householdToken.trim()) {
      return {
        success: false,
        message: 'Household registration token is required.',
        errorCode: 'TOKEN_REQUIRED',
      };
    }

    const lockResult = await householdTokenService.acquireLock(
      data.householdToken.trim(),
      lockerId,
      ipAddress,
      userAgent,
      requestId,
      data.barangay
    );

    if (!lockResult.success || !lockResult.locked) {
      const errorMessages: Record<string, string> = {
        'TOKEN_NOT_FOUND': 'Household token not found or has expired. Please verify the code.',
        'TOKEN_ALREADY_USED': 'This household token has already been used for registration.',
        'TOKEN_EXPIRED': 'This household token has expired. Please generate a new code.',
        'TOKEN_LOCKED': 'This household token is currently being processed by another registration.',
        'LOCK_CONFLICT': 'Registration is already in progress for this household token.',
        'TOKEN_REVIEW_REQUIRED': 'This token is temporarily blocked for review due to repeated duplicate detections.',
        'BARANGAY_MISMATCH': `This household token is issued for a different barangay, not ${data.barangay}.`,
      };
      return {
        success: false,
        message: lockResult.error || errorMessages[lockResult.errorCode || ''] || 'Invalid household token.',
        errorCode: lockResult.errorCode || 'INVALID_TOKEN',
      };
    }

    tokenId = lockResult.tokenId!;
    lockAcquired = true;

    // 1. Mobile number validation & duplicate check (if provided)
    let normalizedMobile = '';
    if (data.mobileNumber && data.mobileNumber.trim().length > 0) {
      if (!isValidPhilippineMobileNumber(data.mobileNumber)) {
        return await abortWithLockRelease(
          'Invalid Philippine mobile number format.',
          'INVALID_MOBILE'
        );
      }
      normalizedMobile = normalizePhilippineMobileNumber(data.mobileNumber);
      const existingMobile = await Resident.findOne({ mobileNumber: normalizedMobile });
      if (existingMobile) {
        return await abortWithLockRelease(
          'This mobile number is already registered.',
          'DUPLICATE_MOBILE'
        );
      }
    }

    // 2. ID validation & duplicate check
    if (!validateIdType(data.idType, true)) {
      return await abortWithLockRelease('Unsupported ID type.', 'INVALID_ID_TYPE');
    }

    let finalIdNumber = '';
    if (data.idType !== 'STAFF_ATTESTATION') {
      if (!data.idNumber || data.idNumber.trim() === '') {
        return await abortWithLockRelease(
          'ID number is required for the selected ID type.',
          'MISSING_ID_NUMBER'
        );
      }
      finalIdNumber = normalizeIdNumber(data.idType, data.idNumber);
      if (!validateIdNumberFormat(data.idType, finalIdNumber)) {
        return await abortWithLockRelease(
          'Invalid ID number format for this ID type.',
          'INVALID_ID_FORMAT'
        );
      }
      const existingId = await Resident.findOne({ idNumber: finalIdNumber });
      if (existingId) {
        return await abortWithLockRelease(
          'This ID number is already registered in the system.',
          'DUPLICATE_ID'
        );
      }
    } else {
      // For STAFF_ATTESTATION, attestationReason is required
      if (!data.attestationReason || data.attestationReason.trim().length === 0) {
        return await abortWithLockRelease(
          'Please provide an attestation reason for residents without documents.',
          'MISSING_ATTESTATION_REASON'
        );
      }
    }

    // 3. Face verification & duplicate check
    if (!data.faceImage || data.faceImage.trim().length === 0) {
      return await abortWithLockRelease(
        'Face scan/photo is required for assisted registration.',
        'MISSING_FACE_IMAGE'
      );
    }

    // Check duplicate face (unified FaceNet 512-d backend)
    try {
      const residentBiometricData = {
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        mobileNumber: normalizedMobile || data.mobileNumber || '',
        barangay: data.barangay,
        streetAddress: data.streetAddress,
      };

      const duplicateCheck = await checkDuplicateFace(data.faceImage, residentBiometricData);
      if (duplicateCheck.isDuplicate) {
        return await abortWithLockRelease(
          `Biometric duplicate detected. This face matches an existing registered resident (${duplicateCheck.matchedResident?.name || 'already registered'}).`,
          'DUPLICATE_FACE'
        );
      }
    } catch (faceErr: any) {
      console.error('[AssistedRegistration] Face duplicate check failed:', faceErr.message);
      const isBackendDown = faceErr.message?.includes('Face verification backend unavailable');
      return await abortWithLockRelease(
        isBackendDown
          ? 'Face verification service is temporarily unavailable. Please try again shortly.'
          : (faceErr.message || 'No face detected in the photo. Please ensure the resident face is clearly visible and try again.'),
        isBackendDown ? 'FACE_CHECK_UNAVAILABLE' : 'INVALID_FACE_IMAGE'
      );
    }

    // 4. Persist images
    const faceImagePath = persistVerificationImage(data.faceImage, 'face_assisted');
    const frontIdImagePath = data.frontIdImage ? persistVerificationImage(data.frontIdImage, 'front_id_assisted') : '';
    const backIdImagePath = data.backIdImage ? persistVerificationImage(data.backIdImage, 'back_id_assisted') : '';

    // 5. Password handling
    let plainPassword = data.password;
    if (!plainPassword || plainPassword.trim().length < 8) {
      plainPassword = `Kb#${crypto.randomBytes(4).toString('hex')}!`;
    }

    // 6. Build Resident record
    const resident = new Resident({
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: `${data.firstName} ${data.lastName}`.trim(),
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      mobileNumber: normalizedMobile || undefined,
      email: data.email || '',
      password: plainPassword,
      barangay: data.barangay,
      streetAddress: data.streetAddress,
      city: 'Labrador',
      householdSize: data.householdSize || 1,
      vulnerableMembers: data.vulnerableMembers || [],
      vulnerableCounts: data.vulnerableCounts || {},
      idType: data.idType,
      idNumber: finalIdNumber, // If STAFF_ATTESTATION, pre-save hook will set ATTEST-<code/timestamp>
      frontIdImage: frontIdImagePath,
      backIdImage: backIdImagePath,
      faceImage: faceImagePath,
      registrationMethod: 'assisted',
      assistedBy: staffUser.userId,
      attestationReason: data.attestationReason || '',
      status: 'Pending',
      verification: {
        overallConfidence: 75,
        idConfidence: data.idType === 'STAFF_ATTESTATION' ? 100 : 70,
        faceMatchConfidence: 85,
        livenessConfidence: 85,
        dataMatchScore: 80,
        riskScore: 10,
        isVerified: false,
        aiVerificationStatus: 'Medium Match',
        warnings: ['Assisted walk-in registration by staff'],
        riskFactors: [],
        idCheckDecision: 'REVIEW',
        idCheckRequiresManualReview: true,
        idCheckReasons: ['Assisted walk-in registration flagged for administrative review'],
        reviewFlags: ['ASSISTED_REGISTRATION'],
      },
    });

    await resident.save();

    // 7. Complete token registration
    await householdTokenService.completeRegistration(
      tokenId,
      lockerId,
      resident._id,
      ipAddress,
      userAgent,
      requestId
    );

    // 8. Generate QR token
    const qrToken = buildResidentQrToken(resident.residentCode, resident.qrVersion, resident.createdAt);

    return {
      success: true,
      message: 'Resident successfully registered via assisted registration.',
      residentId: resident._id.toString(),
      residentCode: resident.residentCode,
      qrToken,
      tempPassword: plainPassword,
    };
  } catch (err: any) {
    console.error('[AssistedRegistration] Service error:', err);

    if (lockAcquired && tokenId) {
      await householdTokenService.releaseLock(
        tokenId,
        lockerId,
        ipAddress,
        userAgent,
        requestId,
        `Assisted registration threw error: ${err.message}`
      );
    }

    // Friendly mapping for MongoDB duplicate key (E11000) errors
    if (err && (err.code === 11000 || err.name === 'MongoServerError')) {
      const keyPattern = err.keyPattern || {};
      const keyValue = err.keyValue || {};
      if (keyPattern.mobileNumber || ('mobileNumber' in keyValue)) {
        return {
          success: false,
          message: 'This mobile number is already registered.',
          errorCode: 'DUPLICATE_MOBILE',
        };
      }
      if (keyPattern.idNumber || ('idNumber' in keyValue)) {
        return {
          success: false,
          message: 'This ID number is already registered in the system.',
          errorCode: 'DUPLICATE_ID',
        };
      }
      return {
        success: false,
        message: 'A resident with these unique details already exists.',
        errorCode: 'DUPLICATE_RECORD',
      };
    }

    // Never leak raw MongoDB or stack errors to the user
    return {
      success: false,
      message: 'Unable to complete registration. Please check the details and try again.',
      errorCode: 'INTERNAL_ERROR',
    };
  }
}


