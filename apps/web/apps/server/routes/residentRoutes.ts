/**
 * Resident Registration Routes
 * 
 * Handles mobile app registration with AI verification data.
 * Stores verification confidence scores for admin review.
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Resident from '../models/Resident';
import HouseholdToken from '../models/HouseholdToken';
import StaffUser from '../models/StaffUser';
import { requireAuth, requireSuperadmin, requireStaffOrSuperadmin, scopeBarangayGuard, AuthRequest } from '../middleware/unifiedAuth';
import { householdTokenService } from '../services/householdTokenService';
import { validateRequest } from '../validation/validateRequest';
import { escapeRegex } from '../validation/mongoSanitize';
import {
  generateCodeBatchBody,
  registerResidentBody,
  listResidentsQuery,
  residentIdParams,
  residentStatusUpdateBody,
  assistedRevisionBody,
} from '../validation/resident.schema';
import { reviewHouseholdMemberRevisionBody } from '../validation/household.schema';
import {
  isValidPhilippineMobileNumber,
  normalizePhilippineMobileNumber,
} from '../utils/mobileNumber';
import { validateBase64Image } from '../validation/imageValidation';
import { normalizeIdNumber, validateIdType } from '../utils/idVerification';
import {
  persistVerificationImage,
  readVerificationImageAsDataUrl,
} from '../utils/imageStorage';
import { createNotification } from '../utils/createNotification';
import { sendAccountStatusUpdateSms } from '../utils/smsService';
import { logAudit } from '../utils/audit';
import {
  removeResidentFaceEmbedding,
  enrollResidentFaceEmbedding,
  checkDuplicateFace,
} from '../services/duplicateFaceService';

const router = Router();
const REGISTER_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024; // 8MB

/**
 * Calculate AI verification status based on confidence score
 */
function getAIVerificationStatus(confidence: number): 'High Match' | 'Medium Match' | 'Low Match' {
  if (confidence >= 80) return 'High Match';
  if (confidence >= 50) return 'Medium Match';
  return 'Low Match';
}

/**
 * POST /api/residents/register
 * Register a new resident from mobile app
 */
router.post('/register', validateRequest({ body: registerResidentBody }), async (req: Request, res: Response) => {
  try {
    const payloadBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
    if (payloadBytes > REGISTER_PAYLOAD_MAX_BYTES) {
      return res.status(413).json({
        success: false,
        message: 'Request payload too large.',
      });
    }

    const {
      // Personal Info
      firstName,
      lastName,
      fullName,
      dateOfBirth,
      gender,
      mobileNumber,
      password,
      
      // Household Info
      city,
      barangay,
      streetAddress,
      householdSize,
      vulnerableMembers,
      vulnerableCounts,
      
      // Identity Verification
      idType,
      idNumber,
      frontIdImage,
      backIdImage,
      
      // Face Scan
      faceImage,
      
      // AI Verification Results from mobile
      verificationResult,
    } = req.body;

    const normalizedMobileNumber = normalizePhilippineMobileNumber(mobileNumber || '');
    const normalizedIdNumber = normalizeIdNumber(idType || '', idNumber || '');

    // Validate required fields
    if (!firstName || !lastName || !dateOfBirth || !gender || !mobileNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'Personal information is required',
        error: {
          code: 'VALIDATION_ERROR',
          field: 'mobileNumber',
        },
      });
    }

    if (!isValidPhilippineMobileNumber(normalizedMobileNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Philippine mobile number.',
        error: {
          code: 'INVALID_MOBILE_FORMAT',
          field: 'mobileNumber',
          details: 'Mobile number must be 09XXXXXXXXX or +639XXXXXXXXX.',
        },
      });
    }

    if (!barangay || !streetAddress) {
      return res.status(400).json({
        success: false,
        message: 'Address information is required',
      });
    }

    if (!idType || !idNumber || !frontIdImage || !backIdImage) {
      return res.status(400).json({
        success: false,
        message: 'ID verification is required',
      });
    }

    if (!validateIdType(idType)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported ID type selected.',
        error: {
          code: 'ID_TYPE_UNSUPPORTED',
          field: 'idType',
        },
      });
    }

    if (!faceImage) {
      return res.status(400).json({
        success: false,
        message: 'Face scan is required',
      });
    }

    const [frontValidation, backValidation, faceValidation] = await Promise.all([
      validateBase64Image(frontIdImage, {
        fieldName: 'Front ID image',
        maxBytes: 2 * 1024 * 1024,
        minWidth: 160,
        minHeight: 160,
        maxWidth: 4096,
        maxHeight: 4096,
      }),
      validateBase64Image(backIdImage, {
        fieldName: 'Back ID image',
        maxBytes: 2 * 1024 * 1024,
        minWidth: 160,
        minHeight: 160,
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

    const failedValidation = [frontValidation, backValidation, faceValidation].find((v) => !v.ok);
    if (failedValidation && !failedValidation.ok) {
      return res.status(400).json({
        success: false,
        message: failedValidation.message,
      });
    }

    // Check if resident already exists
    const existingResident = await Resident.findOne({
      $or: [
        { mobileNumber: normalizedMobileNumber },
        { idNumber: normalizedIdNumber },
      ],
    });

    if (existingResident) {
      const isDuplicateMobile = existingResident.mobileNumber === normalizedMobileNumber;
      return res.status(409).json({
        success: false,
        message: isDuplicateMobile
          ? 'This account already exists. Please sign in instead.'
          : 'ID number is already registered',
        error: {
          code: isDuplicateMobile ? 'DUPLICATE_MOBILE' : 'DUPLICATE_ID',
          field: isDuplicateMobile ? 'mobileNumber' : 'idNumber',
        },
      });
    }

    // Keep client AI output as advisory metadata only; approval stays admin-driven.
    const overallConfidence = verificationResult?.overallConfidence 
      ? Math.round(verificationResult.overallConfidence * 100) 
      : 0;
    
    const verification = {
      overallConfidence,
      idConfidence: Math.round((verificationResult?.idVerification?.confidence || 0) * 100),
      faceMatchConfidence: Math.round((verificationResult?.faceVerification?.matchConfidence || 0) * 100),
      livenessConfidence: Math.round((verificationResult?.faceVerification?.livenessConfidence || 0) * 100),
      dataMatchScore: Math.round((verificationResult?.dataMatchVerification?.matchScore || 0) * 100),
      riskScore: Math.round((verificationResult?.riskScore || 0) * 100),
      isVerified: verificationResult?.isVerified || false,
      aiVerificationStatus: getAIVerificationStatus(overallConfidence),
      warnings: verificationResult?.idVerification?.warnings || [],
      riskFactors: verificationResult?.riskFactors || [],
    };

    const initialStatus: 'Pending' = 'Pending';

    // Create new resident
    const frontIdImageRef = persistVerificationImage(frontIdImage, 'front-id');
    const backIdImageRef = persistVerificationImage(backIdImage, 'back-id');
    const faceImageRef = persistVerificationImage(faceImage, 'face');

    const resident = new Resident({
      firstName,
      lastName,
      fullName: fullName || `${firstName} ${lastName}`.trim(),
      dateOfBirth,
      gender,
      mobileNumber: normalizedMobileNumber,
      password,
      city: city || '',
      barangay,
      streetAddress,
      householdSize: householdSize || 1,
      vulnerableMembers: vulnerableMembers || [],
      vulnerableCounts: vulnerableCounts || {},
      idType,
      idNumber: normalizedIdNumber,
      frontIdImage: frontIdImageRef,
      backIdImage: backIdImageRef,
      faceImage: faceImageRef,
      verification,
      status: initialStatus,
    });

    await resident.save();

    // Enroll face embedding post-save with definitive identifiers
    enrollResidentFaceEmbedding({
      image: faceImage,
      residentId: resident._id.toString(),
      residentCode: resident.residentCode,
      firstName: resident.firstName,
      lastName: resident.lastName,
      mobileNumber: resident.mobileNumber,
      barangay: resident.barangay,
      dateOfBirth: resident.dateOfBirth,
      gender: resident.gender,
      streetAddress: resident.streetAddress,
    }).catch((err) => {
      console.warn('[ResidentRoutes] Face enrollment warning:', err?.message || err);
    });

    res.status(201).json({
      success: true,
      message: 'Registration submitted successfully - Pending admin review',
      data: {
        id: resident._id,
        firstName: resident.firstName,
        lastName: resident.lastName,
        fullName: resident.fullName,
        verification: {
          overallConfidence: verification.overallConfidence,
          aiVerificationStatus: verification.aiVerificationStatus,
          isVerified: verification.isVerified,
        },
        status: resident.status,
        autoApproved: false,
      },
    });
  } catch (error) {
    console.error('[ResidentRoutes] Registration error:', error);

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      const duplicateKey =
        typeof (error as any).keyPattern === 'object' && (error as any).keyPattern
          ? Object.keys((error as any).keyPattern)[0]
          : 'mobileNumber';
      const isDuplicateId = duplicateKey === 'idNumber';
      return res.status(409).json({
        success: false,
        message: isDuplicateId
          ? 'ID number is already registered'
          : 'This account already exists. Please sign in instead.',
        error: {
          code: isDuplicateId ? 'DUPLICATE_ID' : 'DUPLICATE_MOBILE',
          field: isDuplicateId ? 'idNumber' : 'mobileNumber',
        },
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: {
        code: 'SERVER_ERROR',
      },
    });
  }
});

/**
 * GET /api/residents
 * Get all residents (for admin dashboard)
 */
router.get('/', requireAuth, requireStaffOrSuperadmin, validateRequest({ query: listResidentsQuery }), async (req: AuthRequest, res: Response) => {
  try {
    const { status, barangay, search, assistedBy, myOnly } = req.query as {
      status?: string;
      barangay?: string;
      search?: string;
      assistedBy?: string;
      myOnly?: 'true' | 'false';
    };
    
    const query: Record<string, unknown> = {};

    // RBAC: LGU_STAFF can only see residents in their assigned barangays
    if (req.authUser?.role === 'LGU_STAFF') {
      const assigned = req.authUser.assignedBarangays ?? [];
      query.barangay = mongoose.trusted({ $in: assigned });

      // For LGU_STAFF: if myOnly is 'true' or when viewing Needs Revision by default (unless myOnly is 'false'),
      // scope to the staff member's own assisted registrations.
      if (myOnly === 'true' || (status === 'Needs Revision' && myOnly !== 'false')) {
        query.assistedBy = req.authUser.userId;
      }
    } else if (req.authUser?.role === 'SUPERADMIN') {
      // SUPERADMIN has municipality-wide oversight; can filter by specific staff or myOnly
      if (myOnly === 'true') {
        query.assistedBy = req.authUser.userId;
      } else if (assistedBy && assistedBy !== 'All' && assistedBy !== 'ALL') {
        query.assistedBy = assistedBy;
      }
    }
    
    if (status && status !== 'All') {
      query.status = status;
    }
    
    if (barangay && barangay !== 'All') {
      // If staff, verify the requested barangay is within scope
      if (req.authUser?.role === 'LGU_STAFF') {
        const assigned = req.authUser.assignedBarangays ?? [];
        if (!assigned.includes(barangay as string)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to the requested barangay',
          });
        }
      }
      query.barangay = barangay;
    }
    
    if (search) {
      const escaped = escapeRegex(search as string);
      query.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { mobileNumber: { $regex: escaped, $options: 'i' } },
        { idNumber: { $regex: escaped, $options: 'i' } },
      ];
    }
    
    // ── Pagination ──────────────────────────────────────────────
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const rawLimit = parseInt(req.query.limit as string, 10) || 50;
    const limit = Math.min(rawLimit, 50);   // hard cap
    const skip = (page - 1) * limit;

    const residents = await Resident.aggregate([
      { $match: query },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $set: {
          proofUploads: {
            frontId: { $gt: [{ $strLenCP: { $ifNull: ['$frontIdImage', ''] } }, 0] },
            backId: { $gt: [{ $strLenCP: { $ifNull: ['$backIdImage', ''] } }, 0] },
            face: { $gt: [{ $strLenCP: { $ifNull: ['$faceImage', ''] } }, 0] },
          },
        },
      },
      {
        $project: {
          password: 0,
          frontIdImage: 0,
          backIdImage: 0,
          faceImage: 0,
        },
      },
    ]);
    
    res.json({
      success: true,
      data: residents,
    });
  } catch (error) {
    console.error('[ResidentRoutes] Get residents error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

/**
 * PATCH /api/residents/:id/status
 * Approve, return, or reject a pending resident registration.
 */
router.patch(
  '/:id/status',
  requireAuth,
  requireStaffOrSuperadmin,
  validateRequest({ params: residentIdParams, body: residentStatusUpdateBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, rejectionReason } = req.body as {
        status: 'Approved' | 'Needs Revision' | 'Rejected';
        rejectionReason?: string;
      };

      const resident = await Resident.findById(req.params.id).select('-password');
      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident not found',
        });
      }

      if (req.authUser?.role === 'LGU_STAFF') {
        const assigned = req.authUser.assignedBarangays ?? [];
        if (!assigned.includes(resident.barangay)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to modify this resident',
          });
        }
      }

      const previousStatus = resident.status;
      resident.status = status;
      resident.rejectionReason = status === 'Approved' ? undefined : rejectionReason?.trim();
      resident.verifiedAt = new Date();
      resident.verifiedBy = req.authUser?.userId || req.authUser?.sub || 'system';

      let reviewerName: string = 'Staff';
      if (req.authUser?.role === 'SUPERADMIN') {
        reviewerName = 'Super Admin';
      } else if (req.authUser?.userId) {
        try {
          const staff = await StaffUser.findById(req.authUser.userId).select('firstName lastName fullName').lean();
          if (staff) {
            reviewerName = staff.fullName || `${staff.firstName || ''} ${staff.lastName || ''}`.trim() || 'Staff';
          } else if (req.authUser.sub) {
            reviewerName = req.authUser.sub;
          }
        } catch {
          reviewerName = req.authUser.sub || 'Staff';
        }
      } else if (req.authUser?.sub) {
        reviewerName = req.authUser.sub;
      }
      resident.verifiedByName = reviewerName;

      if (status === 'Approved') {
        if (previousStatus !== 'Approved' && resident.qrIssuedAt) {
          resident.qrVersion = (resident.qrVersion || 1) + 1;
        }
        resident.qrIssuedAt = new Date();
        resident.qrStatus = 'ACTIVE';
      } else if (previousStatus === 'Approved') {
        resident.qrStatus = 'REVOKED';
      }
      await resident.save();

      const residentName = resident.fullName || `${resident.firstName || ''} ${resident.lastName || ''}`.trim() || 'Resident';

      // Send SMS status announcement (best effort)
      if (resident.mobileNumber) {
        sendAccountStatusUpdateSms(
          resident.mobileNumber,
          residentName,
          status,
          resident.rejectionReason,
        ).catch((smsErr) => {
          console.warn('[ResidentRoutes] Failed to send status SMS:', smsErr?.message || smsErr);
        });
      }

      if (status === 'Approved') {
        await createNotification({
          userId: resident._id.toString(),
          title: 'Your Virtual Resident ID is Ready',
          message: 'Your registration is approved. Open My Virtual ID in the app when claiming relief assistance.',
          type: 'status_update',
          meta: {
            screen: 'qr',
            residentId: resident._id.toString(),
          },
        });
      } else if (status === 'Needs Revision') {
        await createNotification({
          userId: resident._id.toString(),
          title: 'Registration Needs Revision',
          message: resident.rejectionReason
            ? `Your registration was returned for revision. ${resident.rejectionReason}`
            : 'Your registration was returned for revision. Please review the admin note and upload corrected documents.',
          type: 'status_update',
          meta: {
            screen: 'registration-revision',
            residentId: resident._id.toString(),
          },
        });
      } else if (status === 'Rejected') {
        await createNotification({
          userId: resident._id.toString(),
          title: 'Registration Rejected',
          message: resident.rejectionReason
            ? `Your registration could not be approved: ${resident.rejectionReason}`
            : 'Your registration could not be approved. Please contact your barangay office.',
          type: 'status_update',
          meta: {
            residentId: resident._id.toString(),
          },
        });
      }
 
      // If registration is returned for revision or rejected, remove biometric embedding so applicant is not blocked
      if (status === 'Needs Revision' || status === 'Rejected') {
        const linkedToken = await HouseholdToken.findOne({ 'usedBy.residentId': resident._id }).select('tokenPrefix').lean();
        removeResidentFaceEmbedding({
          residentId: resident._id.toString(),
          residentCode: resident.residentCode,
          mobileNumber: resident.mobileNumber,
          householdToken: linkedToken?.tokenPrefix,
        }).catch((err: any) => {
          console.warn('[ResidentRoutes] Failed to remove face embedding on status change:', err?.message || err);
        });
      }

      await logAudit(req, 'RESIDENT_STATUS_UPDATED', 'Resident', resident._id.toString(), {
        status,
        rejectionReason: resident.rejectionReason,
        barangay: resident.barangay,
        verifiedBy: resident.verifiedBy,
      });

      return res.json({
        success: true,
        message:
          status === 'Approved'
            ? 'Registration approved successfully'
            : status === 'Needs Revision'
              ? 'Registration returned for revision successfully'
              : 'Registration rejected successfully',
        data: {
          id: resident._id,
          status: resident.status,
          rejectionReason: resident.rejectionReason,
          verifiedAt: resident.verifiedAt,
          verifiedBy: resident.verifiedBy,
        },
      });
    } catch (error) {
      console.error('[ResidentRoutes] Update resident status error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error',
      });
    }
  }
);

/**
 * PATCH /api/residents/:id/assisted-revision
 * Staff endpoint to update photos, documents, or attestation for an assisted walk-in registration returned for revision.
 * Automatically resets status back to 'Pending' for review.
 */
router.patch(
  '/:id/assisted-revision',
  requireAuth,
  requireStaffOrSuperadmin,
  validateRequest({ params: residentIdParams, body: assistedRevisionBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      const resident = await Resident.findById(req.params.id);
      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident record not found.',
        });
      }

      if (req.authUser?.role === 'LGU_STAFF') {
        const assigned = req.authUser.assignedBarangays ?? [];
        if (!assigned.includes(resident.barangay)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to modify residents in this barangay.',
          });
        }
      }

      // Safeguard: Only assisted walk-ins can be revised by staff
      if (resident.registrationMethod !== 'assisted') {
        return res.status(400).json({
          success: false,
          message: 'Only assisted walk-in registrations can be revised by staff. Self-registered residents must submit revisions through the mobile application.',
        });
      }

      if (resident.status !== 'Needs Revision') {
        return res.status(409).json({
          success: false,
          message: 'Only resident registrations currently marked as "Needs Revision" can be updated.',
        });
      }

      const {
        idType,
        idNumber,
        frontIdImage,
        backIdImage,
        faceImage,
        attestationReason,
        staffNote,
      } = req.body as {
        idType?: string;
        idNumber?: string;
        frontIdImage?: string;
        backIdImage?: string;
        faceImage?: string;
        attestationReason?: string;
        staffNote?: string;
      };

      if (idType) {
        if (!validateIdType(idType, true)) {
          return res.status(400).json({ success: false, message: 'Unsupported ID type selected.' });
        }
        resident.idType = idType;
      }

      if (idNumber) {
        resident.idNumber = normalizeIdNumber(resident.idType, idNumber);
      }

      if (attestationReason !== undefined) {
        resident.attestationReason = attestationReason.trim();
      }

      // Validate & persist images if provided
      if (frontIdImage) {
        const frontVal = await validateBase64Image(frontIdImage, {
          fieldName: 'Front ID image',
          maxBytes: 3 * 1024 * 1024,
          minWidth: 160,
          minHeight: 160,
          maxWidth: 4096,
          maxHeight: 4096,
        });
        if (!frontVal.ok) {
          return res.status(400).json({ success: false, message: frontVal.message });
        }
        resident.frontIdImage = persistVerificationImage(frontIdImage, 'front_id_assisted');
      }

      if (backIdImage) {
        const backVal = await validateBase64Image(backIdImage, {
          fieldName: 'Back ID image',
          maxBytes: 3 * 1024 * 1024,
          minWidth: 160,
          minHeight: 160,
          maxWidth: 4096,
          maxHeight: 4096,
        });
        if (!backVal.ok) {
          return res.status(400).json({ success: false, message: backVal.message });
        }
        resident.backIdImage = persistVerificationImage(backIdImage, 'back_id_assisted');
      }

      if (faceImage) {
        const faceVal = await validateBase64Image(faceImage, {
          fieldName: 'Face capture image',
          maxBytes: 3 * 1024 * 1024,
          minWidth: 160,
          minHeight: 160,
          maxWidth: 4096,
          maxHeight: 4096,
        });
        if (!faceVal.ok) {
          return res.status(400).json({ success: false, message: faceVal.message });
        }

        // Duplicate check with composite self-exclusion
        const linkedToken = await HouseholdToken.findOne({ 'usedBy.residentId': resident._id }).select('tokenPrefix').lean();
        const dupCheck = await checkDuplicateFace(faceImage, {
          residentId: resident._id.toString(),
          residentCode: resident.residentCode,
          householdToken: linkedToken?.tokenPrefix,
          firstName: resident.firstName,
          lastName: resident.lastName,
          dateOfBirth: resident.dateOfBirth,
          barangay: resident.barangay,
          mobileNumber: resident.mobileNumber,
        });

        if (dupCheck.isDuplicate) {
          return res.status(409).json({
            success: false,
            message: `Biometric duplicate detected. This face matches an existing registered resident (${dupCheck.matchedResident?.name || 'already registered'}).`,
          });
        }

        resident.faceImage = persistVerificationImage(faceImage, 'face_assisted');

        // Re-enroll the face embedding
        enrollResidentFaceEmbedding({
          image: faceImage,
          residentId: resident._id.toString(),
          residentCode: resident.residentCode,
          householdToken: linkedToken?.tokenPrefix,
          firstName: resident.firstName,
          lastName: resident.lastName,
          mobileNumber: resident.mobileNumber,
          barangay: resident.barangay,
          dateOfBirth: resident.dateOfBirth,
          gender: resident.gender,
          streetAddress: resident.streetAddress,
        }).catch((err) => {
          console.warn('[ResidentRoutes] Assisted revision face enrollment warning:', err?.message || err);
        });
      }

      // Reset to Pending review
      resident.status = 'Pending';
      resident.rejectionReason = undefined;
      resident.verifiedAt = undefined;
      resident.verifiedBy = undefined;

      await resident.save();

      await logAudit(req, 'RESIDENT_ASSISTED_REVISED', 'Resident', resident._id.toString(), {
        staffNote,
        residentCode: resident.residentCode,
        barangay: resident.barangay,
        revisedBy: req.authUser?.userId || req.authUser?.sub || 'staff',
      });

      return res.json({
        success: true,
        message: 'Assisted registration revised and resubmitted for admin review.',
        data: {
          id: resident._id,
          residentCode: resident.residentCode,
          status: resident.status,
          updatedAt: resident.updatedAt,
        },
      });
    } catch (error) {
      console.error('[ResidentRoutes] Assisted revision error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error while revising assisted registration.',
      });
    }
  }
);

/**
 * POST /api/residents/codes/generate-batch
 * Generate household registration codes by barangay using high-performance concurrent batching.
 */
router.post(
  '/codes/generate-batch',
  requireAuth,
  requireSuperadmin,
  validateRequest({ body: generateCodeBatchBody }),
  scopeBarangayGuard('body'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { barangay, quantity } = req.body as { barangay: string; quantity: number };
      const issuedBy = req.authUser?.userId || req.authUser?.sub || 'system';
      const startTime = Date.now();

      const result = await householdTokenService.generateBatch({
        barangay,
        quantity,
        issuedBy,
        validityDays: 30,
      });

      if (!result.success || !result.tokens?.length) {
        return res.status(500).json({
          success: false,
          message: result.error || 'Failed to generate codes',
        });
      }

      const resolveTimeMs = Date.now() - startTime;

      return res.status(201).json({
        success: true,
        message: `Generated ${result.tokens.length} code${result.tokens.length > 1 ? 's' : ''}`,
        data: {
          batchId: result.batchId,
          barangay,
          quantity: result.tokens.length,
          generatedAt: result.generatedAt,
          resolveTimeMs,
          tokens: result.tokens,
        },
      });
    } catch (error) {
      console.error('[ResidentRoutes] Batch code generation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate codes',
      });
    }
  }
);

/**
 * GET /api/residents/codes/stats
 * Real-time token statistics for a barangay
 */
router.get(
  '/codes/stats',
  requireAuth,
  requireStaffOrSuperadmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const barangay = (req.query.barangayId || req.query.barangay) as string;
      if (!barangay || !barangay.trim()) {
        return res.status(400).json({
          success: false,
          message: 'barangayId query parameter is required',
        });
      }

      const stats = await householdTokenService.getTokenStatsByBarangay(barangay.trim());
      return res.json({
        success: true,
        activeUnused: stats.activeUnused,
        used: stats.used,
        expired: stats.expired,
        total: stats.total,
      });
    } catch (error) {
      console.error('[ResidentRoutes] Token stats error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch token stats',
      });
    }
  }
);

/**
 * GET /api/residents/codes/batches
 * List generated batches with live usage breakdown
 */
router.get(
  '/codes/batches',
  requireAuth,
  requireSuperadmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const barangay = (req.query.barangayId || req.query.barangay) as string | undefined;
      const batches = await householdTokenService.listBatchesByBarangay(barangay?.trim());
      return res.json({
        success: true,
        batches,
      });
    } catch (error) {
      console.error('[ResidentRoutes] Batches list error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch batch history',
      });
    }
  }
);

/**
 * GET /api/residents/codes/batch/:batchId
 * Fetch tokens belonging to a specific batch
 */
router.get(
  '/codes/batch/:batchId',
  requireAuth,
  requireSuperadmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { batchId } = req.params;
      const tokens = await householdTokenService.getBatchTokens(batchId);
      return res.json({
        success: true,
        tokens,
      });
    } catch (error) {
      console.error('[ResidentRoutes] Batch tokens error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch batch tokens',
      });
    }
  }
);

/**
 * GET /api/residents/codes/list
 * Query all tokens for a barangay with optional status filter and pagination
 */
router.get(
  '/codes/list',
  requireAuth,
  requireSuperadmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const barangay = (req.query.barangayId || req.query.barangay) as string;
      const status = req.query.status as any;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

      if (!barangay || !barangay.trim()) {
        return res.status(400).json({
          success: false,
          message: 'barangay parameter is required',
        });
      }

      const result = await householdTokenService.listTokensByBarangay(
        barangay.trim(),
        status === 'ALL' || !status ? undefined : status,
        page,
        limit
      );

      return res.json({
        success: true,
        tokens: result.tokens.map((t) => ({
          code: `${t.tokenPrefix}-****-****`,
          barangay: t.householdInfo.barangay,
          status: t.status,
          expiry: t.expiresAt,
          createdAt: t.createdAt,
          usedAt: t.usedAt,
        })),
        total: result.total,
        page,
        limit,
      });
    } catch (error) {
      console.error('[ResidentRoutes] List tokens error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to list tokens',
      });
    }
  }
);

/**
 * GET /api/residents/:id
 * Get resident by ID with all details
 */
router.get('/:id', requireAuth, requireStaffOrSuperadmin, validateRequest({ params: residentIdParams }), async (req: AuthRequest, res: Response) => {
  try {
    const resident = await Resident.findById(req.params.id).select('-password');
    
    if (!resident) {
      return res.status(404).json({
        success: false,
        message: 'Resident not found',
      });
    }

    if (req.authUser?.role === 'LGU_STAFF') {
      const assigned = req.authUser.assignedBarangays ?? [];
      if (!assigned.includes(resident.barangay)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this resident',
        });
      }
    }
    const record = resident.toObject() as any;

    // Resolve human-readable staff names for legacy records
    if (!record.assistedByName && record.assistedBy) {
      try {
        const staff = await StaffUser.findById(record.assistedBy).select('firstName lastName fullName').lean();
        if (staff) {
          record.assistedByName = staff.fullName || `${staff.firstName || ''} ${staff.lastName || ''}`.trim() || 'Barangay Staff';
        }
      } catch {}
    }

    if (!record.verifiedByName && record.verifiedBy) {
      const vBy = String(record.verifiedBy);
      if (vBy.toLowerCase().includes('admin') || vBy === 'superadmin' || vBy === 'system') {
        record.verifiedByName = 'Super Admin';
      } else {
        try {
          const staff = await StaffUser.findById(vBy).select('firstName lastName fullName').lean();
          if (staff) {
            record.verifiedByName = staff.fullName || `${staff.firstName || ''} ${staff.lastName || ''}`.trim();
          } else {
            record.verifiedByName = record.verifiedBy;
          }
        } catch {
          record.verifiedByName = record.verifiedBy;
        }
      }
    }

    res.json({
      success: true,
      data: {
        ...record,
        frontIdImage: readVerificationImageAsDataUrl(record.frontIdImage),
        backIdImage: readVerificationImageAsDataUrl(record.backIdImage),
        faceImage: readVerificationImageAsDataUrl(record.faceImage),
      },
    });
  } catch (error) {
    console.error('[ResidentRoutes] Get resident error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

/**
 * GET /api/residents/codes/active
 * Returns active household token codes from MongoDB.
 */
router.get('/codes/active', requireAuth, requireStaffOrSuperadmin, async (req: AuthRequest, res: Response) => {
  try {
    const query: Record<string, unknown> = {
      status: 'UNUSED',
    };

    if (req.authUser?.role === 'LGU_STAFF') {
      const assigned = req.authUser.assignedBarangays ?? [];
      query['householdInfo.barangay'] = mongoose.trusted({ $in: assigned });
    }

    const tokens = await HouseholdToken.find(query)
      .select('tokenPrefix status expiresAt issuedAt createdAt householdInfo')
      .sort({ createdAt: -1 })
      .lean();

    const data = tokens.map((token) => ({
      id: token._id.toString(),
      code: token.tokenPrefix,
      status: token.status,
      barangay: token.householdInfo?.barangay || '',
      headOfHousehold: token.householdInfo?.headOfHousehold || '',
      address: token.householdInfo?.address || '',
      expiresAt: token.expiresAt,
      issuedAt: token.issuedAt,
      createdAt: token.createdAt,
    }));

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('[ResidentRoutes] Active codes fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active codes',
    });
  }
});

/**
 * POST /api/residents/:id/generate-code
 * Generate a unique resident code for an approved resident.
 */
router.post('/:id/generate-code', requireAuth, requireStaffOrSuperadmin, validateRequest({ params: residentIdParams }), async (req: AuthRequest, res: Response) => {
  try {
    const resident = await Resident.findById(req.params.id).select('-password');

    if (!resident) {
      return res.status(404).json({
        success: false,
        message: 'Resident not found',
      });
    }

    if (resident.residentCode) {
      return res.json({
        success: true,
        message: 'Code already generated',
        data: {
          id: resident._id,
          residentCode: resident.residentCode,
          alreadyGenerated: true,
        },
      });
    }

    if (resident.status !== 'Approved') {
      return res.status(409).json({
        success: false,
        message: 'Only approved records can generate a code',
      });
    }

    await resident.save();

    if (!resident.residentCode) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate resident code',
      });
    }

    res.json({
      success: true,
      message: 'Code generated successfully',
      data: {
        id: resident._id,
        residentCode: resident.residentCode,
        alreadyGenerated: false,
      },
    });
  } catch (error) {
    console.error('[ResidentRoutes] Generate resident code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

/**
 * GET /api/residents/stats/summary
 * Get summary statistics for dashboard
 */
router.get('/stats/summary', requireAuth, requireStaffOrSuperadmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [total, pending, approved, needsRevision, rejected] = await Promise.all([
      Resident.countDocuments(),
      Resident.countDocuments({ status: 'Pending' }),
      Resident.countDocuments({ status: 'Approved' }),
      Resident.countDocuments({ status: 'Needs Revision' }),
      Resident.countDocuments({ status: 'Rejected' }),
    ]);
    
    const highMatch = await Resident.countDocuments({
      'verification.aiVerificationStatus': 'High Match',
    });
    
    const mediumMatch = await Resident.countDocuments({
      'verification.aiVerificationStatus': 'Medium Match',
    });
    
    const lowMatch = await Resident.countDocuments({
      'verification.aiVerificationStatus': 'Low Match',
    });
    
    res.json({
      success: true,
      data: {
        total,
        pending,
        approved,
        needsRevision,
        rejected,
        aiStats: {
          highMatch,
          mediumMatch,
          lowMatch,
        },
      },
    });
  } catch (error) {
    console.error('[ResidentRoutes] Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

/**
 * GET /api/residents/household-member-requests
 * Lists residents with pending household member revisions, scoped by staff assigned barangays.
 */
router.get('/household-member-requests', requireAuth, requireStaffOrSuperadmin, async (req: AuthRequest, res: Response) => {
  try {
    const query: Record<string, any> = {
      'pendingHouseholdRevision.status': 'PENDING',
    };

    if (req.authUser?.role === 'LGU_STAFF') {
      const assigned = req.authUser.assignedBarangays ?? [];
      query.barangay = mongoose.trusted({ $in: assigned });
    }

    const residents = await Resident.find(query)
      .select('_id residentCode fullName firstName lastName barangay streetAddress householdSize householdMembers pendingHouseholdRevision createdAt')
      .sort({ 'pendingHouseholdRevision.requestedAt': -1 })
      .lean();

    return res.json({
      success: true,
      data: residents,
      count: residents.length,
    });
  } catch (err: any) {
    console.error('[ResidentRoutes] Get household member requests error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching member requests' });
  }
});

/**
 * POST /api/residents/:id/household-members/review
 * Approves or rejects a pending household member revision.
 */
router.post(
  '/:id/household-members/review',
  requireAuth,
  requireStaffOrSuperadmin,
  validateRequest({ body: reviewHouseholdMemberRevisionBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      const residentId = req.params.id;
      const { action, rejectionReason } = req.body;
      const resident = await Resident.findById(residentId);

      if (!resident) {
        return res.status(404).json({ success: false, message: 'Resident not found' });
      }

      if (req.authUser?.role === 'LGU_STAFF') {
        const assigned = req.authUser.assignedBarangays ?? [];
        if (!assigned.includes(resident.barangay)) {
          return res.status(403).json({ success: false, message: 'Forbidden: You do not have permission for this barangay.' });
        }
      }

      if (!resident.pendingHouseholdRevision || resident.pendingHouseholdRevision.status !== 'PENDING') {
        return res.status(400).json({ success: false, message: 'No pending household member revision for this resident.' });
      }

      const staffUserId = req.authUser?.userId || req.authUser?.sub || 'staff';
      const staffName = (req.authUser as any)?.email || (req.authUser as any)?.fullName || 'Barangay Staff';

      if (action === 'APPROVE') {
        resident.householdMembers = resident.pendingHouseholdRevision.members || [];
        resident.householdSize = (resident.householdMembers.length || 0) + 1;

        // Recalculate vulnerable counts from head & members
        const vCounts: Record<string, number> = {};
        const vMembersSet = new Set<string>();
        for (const m of resident.householdMembers) {
          for (const v of m.vulnerabilities || []) {
            vMembersSet.add(v);
            vCounts[v] = (vCounts[v] || 0) + 1;
          }
        }
        resident.vulnerableMembers = Array.from(vMembersSet);
        resident.vulnerableCounts = vCounts;

        resident.pendingHouseholdRevision.status = 'APPROVED';
        resident.pendingHouseholdRevision.reviewedBy = staffUserId;
        resident.pendingHouseholdRevision.reviewedByName = staffName;
        resident.pendingHouseholdRevision.reviewedAt = new Date();

        await resident.save();

        await logAudit(req, 'HOUSEHOLD_MEMBERS_REVISION_APPROVED', 'Resident', resident._id.toString(), {
          householdSize: resident.householdSize,
          membersCount: resident.householdMembers.length,
          barangay: resident.barangay,
        });

        await createNotification({
          userId: resident._id.toString(),
          title: 'Household Members Update Approved',
          message: 'Your request to update household members has been approved by your barangay office.',
          type: 'status_update',
          meta: {
            screen: 'profile',
            residentId: resident._id.toString(),
          },
        });

        return res.json({
          success: true,
          message: 'Household member revision approved successfully',
          data: {
            householdMembers: resident.householdMembers,
            householdSize: resident.householdSize,
            pendingHouseholdRevision: resident.pendingHouseholdRevision,
          },
        });
      } else {
        resident.pendingHouseholdRevision.status = 'REJECTED';
        resident.pendingHouseholdRevision.rejectionReason = rejectionReason || 'Request rejected by staff.';
        resident.pendingHouseholdRevision.reviewedBy = staffUserId;
        resident.pendingHouseholdRevision.reviewedByName = staffName;
        resident.pendingHouseholdRevision.reviewedAt = new Date();

        await resident.save();

        await logAudit(req, 'HOUSEHOLD_MEMBERS_REVISION_REJECTED', 'Resident', resident._id.toString(), {
          rejectionReason,
          barangay: resident.barangay,
        });

        await createNotification({
          userId: resident._id.toString(),
          title: 'Household Members Update Rejected',
          message: rejectionReason
            ? `Your household members update was rejected: ${rejectionReason}`
            : 'Your household members update was not approved. Please contact your barangay office.',
          type: 'status_update',
          meta: {
            screen: 'profile',
            residentId: resident._id.toString(),
          },
        });

        return res.json({
          success: true,
          message: 'Household member revision rejected',
          data: {
            pendingHouseholdRevision: resident.pendingHouseholdRevision,
          },
        });
      }
    } catch (err: any) {
      console.error('[ResidentRoutes] Review household member request error:', err);
      return res.status(500).json({ success: false, message: 'Server error reviewing member revision' });
    }
  }
);

export default router;
