/**
 * Household Registration Service
 * 
 * Orchestrates the complete household registration flow with
 * atomic token validation and concurrent registration protection.
 * 
 * Flow:
 * 1. Validate token format
 * 2. Acquire atomic lock on token
 * 3. Validate registration data
 * 4. Create resident record
 * 5. Mark token as USED (atomic)
 * 6. If any step fails, release lock and allow retry
 * 
 * Concurrency Protection:
 * - Only ONE registration per token succeeds
 * - All other concurrent attempts fail with clear error
 * - Locks auto-expire after 60 seconds if not completed
 */

import mongoose from 'mongoose';
import Resident, { IResident } from '../models/Resident';
import { householdTokenService, generateRequestId } from './householdTokenService';
import RegistrationAuditLog from '../models/RegistrationAuditLog';
import { validatePassword, isCommonPassword } from '../utils/passwordValidator';
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
import {
  IdScreeningResult,
  screenSubmittedId,
} from './idScreeningService';

export interface RegistrationData {
  // Personal Info (Step 1)
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female';
  mobileNumber: string;
  email?: string;
  password: string;
  
  // Household Info (Step 2)
  city?: string;
  barangay: string;
  streetAddress: string;
  householdSize?: number;
  vulnerableMembers?: string[];
  vulnerableCounts?: Record<string, number>;
  
  // Identity Verification (Step 3)
  idType: string;
  idNumber: string;
  frontIdImage: string;
  backIdImage: string;
  
  // Face Scan (Step 4)
  faceImage: string;
  
  // AI Verification Results
  verification?: {
    overallConfidence: number;
    idConfidence?: number;
    faceMatchConfidence?: number;
    livenessConfidence?: number;
    dataMatchScore?: number;
    riskScore?: number;
    isVerified: boolean;
    aiVerificationStatus: 'High Match' | 'Medium Match' | 'Low Match';
    warnings?: string[];
    riskFactors?: string[];
  };
  
  // Household Token (moved to last in Step 1)
  householdToken: string;
}

export interface RegistrationResult {
  success: boolean;
  residentId?: mongoose.Types.ObjectId;
  residentCode?: string;
  message: string;
  errorCode?: string;
  validationErrors?: Array<{ field: string; code: string; message: string }>;
  householdInfo?: {
    headOfHousehold: string;
    address: string;
    barangay: string;
  };
}

export interface TokenValidationResponse {
  success: boolean;
  valid: boolean;
  message: string;
  errorCode?: string;
  householdInfo?: {
    headOfHousehold: string;
    address: string;
    barangay: string;
    expectedMembers: number;
  };
}

interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

function getAIVerificationStatus(confidence: number): 'High Match' | 'Medium Match' | 'Low Match' {
  if (confidence >= 80) return 'High Match';
  if (confidence >= 50) return 'Medium Match';
  return 'Low Match';
}

export function buildScreeningValidationIssues(screening: IdScreeningResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const reasonMessage = screening.reasons[0] || 'ID screening failed.';

  if (screening.reviewFlags.includes('TYPE_MISMATCH')) {
    issues.push({
      field: 'idType',
      code: 'ID_TYPE_MISMATCH',
      message: reasonMessage,
    });
  }

  if (screening.reviewFlags.includes('ID_NUMBER_MISMATCH')) {
    issues.push({
      field: 'idNumber',
      code: 'ID_NUMBER_MISMATCH',
      message: reasonMessage,
    });
  }

  if (issues.length === 0) {
    issues.push({
      field: 'frontIdImage',
      code: 'ID_SCREENING_BLOCKED',
      message: reasonMessage,
    });
    issues.push({
      field: 'backIdImage',
      code: 'ID_SCREENING_BLOCKED',
      message: reasonMessage,
    });
  }

  return issues;
}

export function buildVerificationPayload(
  baseVerification: RegistrationData['verification'] | undefined,
  screening: IdScreeningResult,
): NonNullable<IResident['verification']> {
  const baseOverallConfidence = Number(baseVerification?.overallConfidence || 0);
  const idConfidence = Math.round(screening.screeningConfidence * 100);
  const overallConfidence = Math.round((baseOverallConfidence * 0.45) + (idConfidence * 0.55));
  const warnings = Array.from(new Set([
    ...(baseVerification?.warnings || []),
    ...screening.warnings,
  ]));
  const riskFactors = Array.from(new Set([
    ...(baseVerification?.riskFactors || []),
    ...(screening.decision === 'PASS'
      ? []
      : screening.reasons.concat(screening.reviewFlags)),
  ]));
  const screeningRiskPenalty =
    screening.decision === 'PASS' ? 0 : screening.decision === 'REVIEW' ? 25 : 50;

  return {
    overallConfidence,
    idConfidence,
    faceMatchConfidence: Math.round(Number(baseVerification?.faceMatchConfidence || 0)),
    livenessConfidence: Math.round(Number(baseVerification?.livenessConfidence || 0)),
    dataMatchScore:
      screening.idNumberMatch === true
        ? 100
        : screening.idNumberMatch === false
          ? 0
          : Math.round(screening.screeningConfidence * 100),
    riskScore: Math.min(100, Math.round(Number(baseVerification?.riskScore || 0) + screeningRiskPenalty)),
    isVerified: screening.decision === 'PASS' && Boolean(baseVerification?.isVerified),
    aiVerificationStatus: getAIVerificationStatus(overallConfidence),
    warnings,
    riskFactors,
    idCheckDecision: screening.decision,
    idCheckRequiresManualReview: screening.requiresManualReview,
    idCheckReasons: screening.reasons,
    idCheckWarnings: screening.warnings,
    reviewFlags: screening.reviewFlags,
    screeningConfidence: idConfidence,
    detectedIdType: screening.detectedIdType || '',
    typeMatch: screening.typeMatch ?? undefined,
    typeConfidence: Math.round(screening.typeConfidence * 100),
    idNumberMatch: screening.idNumberMatch ?? undefined,
    ocrConfidence: Math.round(screening.ocrConfidence * 100),
    qualityScore: Math.round(screening.qualityScore * 100),
    extractedIdNumberMasked: screening.extractedIdNumberMasked || '',
    rawTextPreview: screening.rawTextPreview || '',
  };
}

/**
 * HouseholdRegistrationService
 * 
 * Handles complete registration flow with concurrency protection.
 */
export class HouseholdRegistrationService {
  
  /**
   * Validate token before starting registration
   * 
   * This is called when user enters their token to check if it's valid.
   * Does NOT acquire a lock - just validates.
   * 
   * @param token - The token to validate
   * @param ipAddress - Client IP address
   * @param userAgent - Client user agent
   * @param barangay - Optional barangay to filter tokens (speeds up validation)
   */
  async validateToken(
    token: string,
    ipAddress: string,
    userAgent: string,
    barangay?: string
  ): Promise<TokenValidationResponse> {
    const requestId = generateRequestId();
    
    try {
      const result = await householdTokenService.validateToken(
        token,
        ipAddress,
        userAgent,
        requestId,
        barangay
      );
      
      if (!result.success) {
        return {
          success: false,
          valid: false,
          message: 'Token validation failed. Please try again.',
          errorCode: 'VALIDATION_ERROR',
        };
      }
      
      if (!result.valid) {
        // Provide user-friendly error messages
        const errorMessages: Record<string, string> = {
          'INVALID_FORMAT': 'Invalid token format. Please enter a valid token (XXXX-XXXX-XXXX).',
          'TOKEN_NOT_FOUND': 'Token not found or has expired. Please contact your barangay office.',
          'TOKEN_EXPIRED': 'This token has expired. Please contact your barangay office for a new token.',
          'TOKEN_ALREADY_USED': 'This household token has already been used for registration. Please contact your barangay office for a new token.',
          'TOKEN_REVIEW_REQUIRED': 'This token is temporarily blocked for review due to repeated duplicate detections. Please contact your barangay office.',
        };
        
        return {
          success: true,
          valid: false,
          message: errorMessages[result.errorCode || ''] || 'Invalid token.',
          errorCode: result.errorCode,
        };
      }
      
      return {
        success: true,
        valid: true,
        message: 'Token is valid',
        householdInfo: result.householdInfo ? {
          headOfHousehold: result.householdInfo.headOfHousehold,
          address: result.householdInfo.address,
          barangay: result.householdInfo.barangay,
          expectedMembers: result.householdInfo.expectedMembers,
        } : undefined,
      };
      
    } catch (error) {
      console.error('[RegistrationService] Token validation error:', error);
      return {
        success: false,
        valid: false,
        message: 'Unable to validate token. Please try again.',
        errorCode: 'SYSTEM_ERROR',
      };
    }
  }
  
  /**
   * Register a new resident with household token
   * 
   * This is the main registration endpoint that:
   * 1. Acquires atomic lock on token
   * 2. Creates resident record
   * 3. Marks token as used
   * 
   * Only ONE registration per token will succeed.
   */
  async registerResident(
    data: RegistrationData,
    ipAddress: string,
    userAgent: string
  ): Promise<RegistrationResult> {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const lockerId = `${ipAddress}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    let tokenId: mongoose.Types.ObjectId | null = null;
    let lockAcquired = false;
    
    try {
      const normalizedMobileNumber = normalizePhilippineMobileNumber(data.mobileNumber || '');
      data.mobileNumber = normalizedMobileNumber;
      data.idNumber = normalizeIdNumber(data.idType, data.idNumber || '');

      // Log registration start
      await RegistrationAuditLog.log({
        eventType: 'REGISTRATION_STARTED',
        severity: 'INFO',
        tokenPrefix: data.householdToken.replace(/-/g, '').slice(0, 4),
        ipAddress,
        userAgent,
        requestId,
        message: 'Registration attempt started',
        success: true,
      });
      
      // Step 1: Acquire atomic lock on token
      // This is where concurrent registrations are blocked
      const lockResult = await householdTokenService.acquireLock(
        data.householdToken,
        lockerId,
        ipAddress,
        userAgent,
        requestId,
        data.barangay  // Pass barangay for faster token lookup
      );
      
      if (!lockResult.success || !lockResult.locked) {
        // Lock failed - another registration is in progress or token is invalid
        const errorMessages: Record<string, string> = {
          'TOKEN_NOT_FOUND': 'Token not found or has expired. Please contact your barangay office for a new token.',
          'TOKEN_ALREADY_USED': 'This token has already been used for registration.',
          'TOKEN_EXPIRED': 'This token has expired. Please contact your barangay office for a new token.',
          'TOKEN_REVIEW_REQUIRED': 'This token is temporarily blocked for review due to repeated duplicate detections. Please contact your barangay office.',
          'LOCK_CONFLICT': 'Another family member is currently registering. Please wait and try again.',
          'LOCK_ERROR': 'Registration temporarily unavailable. Please try again.',
        };
        
        console.log('[RegistrationService] Lock failed:', lockResult.errorCode, lockResult.error);
        
        return {
          success: false,
          message: errorMessages[lockResult.errorCode || ''] || `Unable to start registration: ${lockResult.error || 'Unknown error'}`,
          errorCode: lockResult.errorCode,
        };
      }
      
      tokenId = lockResult.tokenId!;
      lockAcquired = true;
      
      // Step 2: Validate registration data
      const validationIssues = this.validateRegistrationData(data);
      if (validationIssues.length > 0) {
        // Release lock and return errors
        await householdTokenService.releaseLock(
          tokenId,
          lockerId,
          ipAddress,
          userAgent,
          requestId,
          'Validation failed'
        );
        
        return {
          success: false,
          message: `Validation failed: ${validationIssues.map((v) => v.message).join(', ')}`,
          errorCode: 'VALIDATION_FAILED',
          validationErrors: validationIssues,
        };
      }
      
      // Step 3: Check for duplicate registration (by mobile number or normalized ID number)
      const existingResident = await Resident.findOne({
        $or: [
          { mobileNumber: normalizedMobileNumber },
          { idNumber: data.idNumber },
        ],
      });
      
      if (existingResident) {
        await householdTokenService.releaseLock(
          tokenId,
          lockerId,
          ipAddress,
          userAgent,
          requestId,
          'Duplicate mobile number'
        );
        
        const isDuplicateId = existingResident.idNumber === data.idNumber;
        await RegistrationAuditLog.log({
          eventType: 'REGISTRATION_FAILED',
          severity: 'WARNING',
          tokenPrefix: data.householdToken.replace(/-/g, '').slice(0, 4),
          tokenId,
          ipAddress,
          userAgent,
          requestId,
          message: isDuplicateId
            ? 'Registration failed - duplicate ID number'
            : 'Registration failed - duplicate mobile number',
          success: false,
          errorCode: isDuplicateId ? 'DUPLICATE_ID' : 'DUPLICATE_MOBILE',
          processingTimeMs: Date.now() - startTime,
        });
        
        return {
          success: false,
          message: isDuplicateId
            ? 'This ID number is already registered.'
            : 'This mobile number is already registered.',
          errorCode: isDuplicateId ? 'DUPLICATE_ID' : 'DUPLICATE_MOBILE',
          validationErrors: isDuplicateId
            ? [{ field: 'idNumber', code: 'DUPLICATE_ID', message: 'ID number is already registered' }]
            : [{ field: 'mobileNumber', code: 'DUPLICATE_MOBILE', message: 'Mobile number is already registered' }],
        };
      }

      let idScreening: IdScreeningResult;
      try {
        idScreening = await screenSubmittedId({
          idType: data.idType,
          idNumber: data.idNumber,
          frontIdImage: data.frontIdImage,
          backIdImage: data.backIdImage,
        });
      } catch (screeningError) {
        const message = screeningError instanceof Error
          ? screeningError.message
          : 'Unable to analyze the uploaded ID.';
        const normalizedMessage = message.toLowerCase();
        const field = normalizedMessage.includes('front')
          ? 'frontIdImage'
          : normalizedMessage.includes('back')
            ? 'backIdImage'
            : normalizedMessage.includes('type')
              ? 'idType'
              : normalizedMessage.includes('number')
                ? 'idNumber'
                : 'frontIdImage';

        if (
          normalizedMessage.includes('front') ||
          normalizedMessage.includes('back') ||
          normalizedMessage.includes('type') ||
          normalizedMessage.includes('number')
        ) {
          await householdTokenService.releaseLock(
            tokenId,
            lockerId,
            ipAddress,
            userAgent,
            requestId,
            'ID screening validation failed'
          );

          return {
            success: false,
            message,
            errorCode: 'VALIDATION_FAILED',
            validationErrors: [{
              field,
              code: 'ID_SCREENING_FAILED',
              message,
            }],
          };
        }

        throw screeningError;
      }

      if (idScreening.decision === 'BLOCK') {
        await householdTokenService.releaseLock(
          tokenId,
          lockerId,
          ipAddress,
          userAgent,
          requestId,
          'ID screening blocked registration'
        );

        await RegistrationAuditLog.log({
          eventType: 'REGISTRATION_FAILED',
          severity: 'WARNING',
          tokenPrefix: data.householdToken.replace(/-/g, '').slice(0, 4),
          tokenId,
          ipAddress,
          userAgent,
          requestId,
          message: idScreening.reasons[0] || 'Registration failed - ID screening blocked submission',
          success: false,
          errorCode: 'ID_SCREENING_BLOCKED',
          processingTimeMs: Date.now() - startTime,
        });

        return {
          success: false,
          message: idScreening.reasons[0] || 'The uploaded ID failed automated screening.',
          errorCode: 'VALIDATION_FAILED',
          validationErrors: buildScreeningValidationIssues(idScreening),
        };
      }
      
      const frontIdImageRef = persistVerificationImage(data.frontIdImage, 'front-id');
      const backIdImageRef = persistVerificationImage(data.backIdImage, 'back-id');
      const faceImageRef = persistVerificationImage(data.faceImage, 'face');

      // Step 4: Create resident record
      const verificationPayload = buildVerificationPayload(data.verification, idScreening);
      const isAutoApproved = false;

      const resident = new Resident({
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: `${data.firstName} ${data.lastName}`,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        mobileNumber: normalizedMobileNumber,
        email: data.email || '',
        password: data.password,
        city: data.city || '',
        barangay: data.barangay,
        streetAddress: data.streetAddress,
        householdSize: data.householdSize || 1,
        vulnerableMembers: data.vulnerableMembers || [],
        vulnerableCounts: data.vulnerableCounts || {},
        idType: data.idType,
        idNumber: data.idNumber,
        frontIdImage: frontIdImageRef,
        backIdImage: backIdImageRef,
        faceImage: faceImageRef,
        verification: verificationPayload,
        status: 'Pending',
        verifiedAt: undefined,
      });
      
      try {
        await resident.save();
      } catch (saveError: any) {
        // Release lock on save failure
        await householdTokenService.releaseLock(
          tokenId,
          lockerId,
          ipAddress,
          userAgent,
          requestId,
          `Save failed: ${saveError.message}`
        );
        
        if (saveError?.code === 11000) {
          const duplicateKey = saveError?.keyPattern && typeof saveError.keyPattern === 'object'
            ? Object.keys(saveError.keyPattern)[0]
            : null;
          const duplicateIsId = duplicateKey === 'idNumber';
          const duplicateIsMobile = duplicateKey === 'mobileNumber';
          const duplicateIsResidentCode = duplicateKey === 'residentCode';

          let errorCode = 'VALIDATION_FAILED';
          let userMessage = 'A duplicate record already exists in the system.';
          let logMessage = `Registration failed - duplicate key (${duplicateKey || 'unknown'})`;
          let validationErrors: Array<{ field: string; code: string; message: string }> = [];

          if (duplicateIsId) {
            errorCode = 'DUPLICATE_ID';
            userMessage = 'This ID number is already registered.';
            logMessage = 'Registration failed - duplicate ID number (unique index)';
            validationErrors = [{ field: 'idNumber', code: 'DUPLICATE_ID', message: 'ID number is already registered' }];
          } else if (duplicateIsMobile) {
            errorCode = 'DUPLICATE_MOBILE';
            userMessage = 'This mobile number is already registered.';
            logMessage = 'Registration failed - duplicate mobile number (unique index)';
            validationErrors = [{ field: 'mobileNumber', code: 'DUPLICATE_MOBILE', message: 'Mobile number is already registered' }];
          } else if (duplicateIsResidentCode) {
            errorCode = 'SYSTEM_ERROR';
            userMessage = 'Registration sequence conflict. Please try submitting again.';
            logMessage = 'Registration failed - duplicate resident code (unique index)';
          }

          await RegistrationAuditLog.log({
            eventType: 'REGISTRATION_FAILED',
            severity: 'WARNING',
            tokenPrefix: data.householdToken.replace(/-/g, '').slice(0, 4),
            tokenId,
            ipAddress,
            userAgent,
            requestId,
            message: logMessage,
            success: false,
            errorCode,
            processingTimeMs: Date.now() - startTime,
          });

          return {
            success: false,
            message: userMessage,
            errorCode,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
          };
        }

        // Handle Mongoose validation errors specifically
        if (saveError.name === 'ValidationError') {
          const validationMessages = Object.values(saveError.errors)
            .map((err: any) => err.message);
          
          console.error('[RegistrationService] Validation error:', validationMessages);
          
          await RegistrationAuditLog.log({
            eventType: 'REGISTRATION_FAILED',
            severity: 'WARNING',
            tokenPrefix: data.householdToken.replace(/-/g, '').slice(0, 4),
            tokenId,
            ipAddress,
            userAgent,
            requestId,
            message: `Validation error: ${validationMessages.join(', ')}`,
            success: false,
            errorCode: 'VALIDATION_ERROR',
            processingTimeMs: Date.now() - startTime,
          });
          
          return {
            success: false,
            message: `Validation failed: ${validationMessages.join(', ')}`,
            errorCode: 'VALIDATION_ERROR',
            validationErrors: validationMessages.map((message: string) => ({
              field: 'form',
              code: 'VALIDATION_ERROR',
              message,
            })),
          };
        }
        
        // Re-throw other errors to be handled by the outer catch
        throw saveError;
      }
      
      // Step 5: Mark token as used (atomic)
      const completeResult = await householdTokenService.completeRegistration(
        tokenId,
        lockerId,
        resident._id as mongoose.Types.ObjectId,
        ipAddress,
        userAgent,
        requestId
      );
      
      if (!completeResult.success || !completeResult.completed) {
        // This is rare - lock expired during registration
        // We have a resident but token completion failed
        // Log this for manual review
        console.error('[RegistrationService] Token completion failed after resident created:', {
          residentId: resident._id,
          tokenId,
          error: completeResult.error,
        });
        
        await RegistrationAuditLog.log({
          eventType: 'REGISTRATION_FAILED',
          severity: 'CRITICAL',
          tokenPrefix: data.householdToken.replace(/-/g, '').slice(0, 4),
          tokenId,
          residentId: resident._id as mongoose.Types.ObjectId,
          ipAddress,
          userAgent,
          requestId,
          message: 'Token completion failed after resident created - manual review required',
          success: false,
          errorCode: 'COMPLETION_RACE',
          processingTimeMs: Date.now() - startTime,
        });
        
        // Still return success as resident was created
        // Admin will need to manually mark token as used
      }
      
      // Step 6: Log successful registration
      await RegistrationAuditLog.log({
        eventType: 'REGISTRATION_COMPLETED',
        severity: 'INFO',
        tokenPrefix: data.householdToken.replace(/-/g, '').slice(0, 4),
        tokenId,
        residentId: resident._id as mongoose.Types.ObjectId,
        ipAddress,
        userAgent,
        requestId,
        message: 'Registration completed successfully',
        success: true,
        processingTimeMs: Date.now() - startTime,
      });
      
      // Get token info for response
      const token = await householdTokenService.getTokenStatus(tokenId);
      
      return {
        success: true,
        residentId: resident._id as mongoose.Types.ObjectId,
        residentCode: resident.residentCode,
        message: isAutoApproved
          ? 'Registration successful! Your account is approved and can log in immediately.'
          : 'Registration successful! Your application is pending review.',
        householdInfo: token?.householdInfo ? {
          headOfHousehold: token.householdInfo.headOfHousehold,
          address: token.householdInfo.address,
          barangay: token.householdInfo.barangay,
        } : undefined,
      };
      
    } catch (error) {
      console.error('[RegistrationService] Registration error:', error);
      
      // Release lock if acquired
      if (lockAcquired && tokenId) {
        await householdTokenService.releaseLock(
          tokenId,
          lockerId,
          ipAddress,
          userAgent,
          requestId,
          `Error: ${(error as Error).message}`
        );
      }
      
      await RegistrationAuditLog.log({
        eventType: 'REGISTRATION_FAILED',
        severity: 'ERROR',
        tokenPrefix: data.householdToken?.replace(/-/g, '').slice(0, 4) || 'unknown',
        tokenId: tokenId || undefined,
        ipAddress,
        userAgent,
        requestId,
        message: `Registration error: ${(error as Error).message}`,
        success: false,
        errorCode: 'SYSTEM_ERROR',
        processingTimeMs: Date.now() - startTime,
      });
      
      return {
        success: false,
        message: 'Registration failed due to a system error. Please try again.',
        errorCode: 'SYSTEM_ERROR',
      };
    }
  }
  
  /**
   * Validate registration data
   */
  private validateRegistrationData(data: RegistrationData): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const normalizedMobile = normalizePhilippineMobileNumber(data.mobileNumber || '');
    const normalizedIdNumber = normalizeIdNumber(data.idType || '', data.idNumber || '');
    
    // Required fields
    if (!data.firstName?.trim()) issues.push({ field: 'firstName', code: 'FIRST_NAME_REQUIRED', message: 'First name is required' });
    if (!data.lastName?.trim()) issues.push({ field: 'lastName', code: 'LAST_NAME_REQUIRED', message: 'Last name is required' });
    if (!data.dateOfBirth?.trim()) issues.push({ field: 'dateOfBirth', code: 'DOB_REQUIRED', message: 'Date of birth is required' });
    if (!data.gender) issues.push({ field: 'gender', code: 'GENDER_REQUIRED', message: 'Gender is required' });
    if (!data.mobileNumber?.trim()) issues.push({ field: 'mobileNumber', code: 'MOBILE_REQUIRED', message: 'Mobile number is required' });
    if (!data.password?.trim()) issues.push({ field: 'password', code: 'PASSWORD_REQUIRED', message: 'Password is required' });
    if (!data.barangay?.trim()) issues.push({ field: 'barangay', code: 'BARANGAY_REQUIRED', message: 'Barangay is required' });
    if (!data.streetAddress?.trim()) issues.push({ field: 'streetAddress', code: 'ADDRESS_REQUIRED', message: 'Street address is required' });
    if (!data.householdToken?.trim()) issues.push({ field: 'householdToken', code: 'TOKEN_REQUIRED', message: 'Household token is required' });
    if (!data.idType?.trim()) issues.push({ field: 'idType', code: 'ID_TYPE_REQUIRED', message: 'ID type is required' });
    if (!data.idNumber?.trim()) issues.push({ field: 'idNumber', code: 'ID_NUMBER_REQUIRED', message: 'ID number is required' });
    if (!data.frontIdImage?.trim()) issues.push({ field: 'frontIdImage', code: 'FRONT_ID_REQUIRED', message: 'Front ID image is required' });
    if (!data.backIdImage?.trim()) issues.push({ field: 'backIdImage', code: 'BACK_ID_REQUIRED', message: 'Back ID image is required' });
    if (!data.faceImage?.trim()) issues.push({ field: 'faceImage', code: 'FACE_IMAGE_REQUIRED', message: 'Face image is required' });
    
    // Password validation aligned with shared security policy.
    if (data.password) {
      const passwordValidation = validatePassword(data.password);
      if (!passwordValidation.isValid && passwordValidation.errors.length > 0) {
        issues.push({ field: 'password', code: 'PASSWORD_INVALID', message: passwordValidation.errors[0] });
      }
      if (isCommonPassword(data.password)) {
        issues.push({ field: 'password', code: 'PASSWORD_TOO_COMMON', message: 'Password is too common' });
      }
    }
    
    // Mobile number format (Philippines): exactly 11 digits, starts with 09
    if (data.mobileNumber && !isValidPhilippineMobileNumber(normalizedMobile)) {
      issues.push({
        field: 'mobileNumber',
        code: 'MOBILE_INVALID_FORMAT',
        message: 'Invalid mobile number format (must be 11 digits and start with 09)',
      });
    }
    
    // Token format
    if (data.householdToken && !/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(data.householdToken.trim())) {
      issues.push({ field: 'householdToken', code: 'TOKEN_INVALID_FORMAT', message: 'Invalid token format' });
    }

    if (data.idType && !validateIdType(data.idType)) {
      issues.push({
        field: 'idType',
        code: 'ID_TYPE_UNSUPPORTED',
        message: 'Unsupported ID type selected',
      });
    }

    if (data.idType && data.idNumber && !validateIdNumberFormat(data.idType, normalizedIdNumber)) {
      issues.push({
        field: 'idNumber',
        code: 'ID_NUMBER_INVALID_FORMAT',
        message: 'Enter a valid ID number for the selected ID type',
      });
    }

    return issues;
  }
}

// Export singleton instance
export const householdRegistrationService = new HouseholdRegistrationService();
export default householdRegistrationService;
