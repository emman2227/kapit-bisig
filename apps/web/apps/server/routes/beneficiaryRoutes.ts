import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import DisasterEvent from '../models/DisasterEvent';
import Distribution from '../models/Distribution';
import ProofSubmission from '../models/ProofSubmission';
import Resident from '../models/Resident';
import { requireAuth, AuthRequest } from '../middleware/unifiedAuth';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../validation/validateRequest';
import {
  beneficiaryClaimBody,
  createDisasterEventBody,
  disasterEventIdParams,
  listDisasterEventsQuery,
  offlineClaimSyncBody,
  offlineProofSyncBody,
  proofSubmissionIdParams,
  proofSubmissionListQuery,
  proofSubmissionReviewBody,
  qrValidationBody,
  residentProofSubmissionBody,
} from '../validation/beneficiary.schema';
import {
  BeneficiaryActor,
  BeneficiaryServiceError,
  buildOfflineBeneficiaryPack,
  recordDisasterEventClaim,
  submitResidentProof,
  reviewResidentProof,
  upsertOfflineSyncLog,
  validateResidentQrForEvent,
} from '../services/beneficiaryService';
import { logAudit } from '../utils/audit';
import { broadcastScopedNotification } from '../utils/createNotification';
import { escapeRegex } from '../validation/mongoSanitize';
import { getTargetBarangays, requiresBeneficiaryApproval } from '../services/distributionFlowService';
import { deriveDistributionLifecycle } from '../utils/distributionLifecycle';

const router = Router();

type OfflineProofSubmissionItem = {
  clientGeneratedId: string;
  distributionId?: string;
  disasterEventId?: string;
  damageType: 'Flood' | 'House Damage' | 'Storm Surge' | 'Landslide' | 'Livelihood Loss' | 'Other';
  description: string;
  supportingInfo?: string;
  dateSubmitted: string;
  photoProofs: string[];
};

function isAdminVerifierRole(role: string | undefined): boolean {
  return role === 'SUPERADMIN' || role === 'LGU_STAFF';
}

function isResidentRole(role: string | undefined): boolean {
  return role === 'Resident';
}

function isScannerRole(role: string | undefined): boolean {
  return ['Volunteer', 'LGU_STAFF', 'Admin', 'Staff', 'SUPERADMIN'].includes(String(role || ''));
}

function getMobileActor(req: AuthenticatedRequest): BeneficiaryActor {
  return {
    userId: req.user?.userId || '',
    displayName: req.user?.email || req.user?.userId || 'Mobile Scanner',
    role: req.user?.role || 'Unknown',
    assignedBarangays: Array.isArray(req.user?.assignedBarangays) ? req.user?.assignedBarangays : [],
  };
}

function handleServiceError(res: Response, error: unknown): Response {
  if (error instanceof BeneficiaryServiceError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }

  console.error('[BeneficiaryRoutes] Unexpected error:', error);
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
}

router.get('/events', validateRequest({ query: listDisasterEventsQuery }), async (req: Request, res: Response) => {
  try {
    const { page, limit, status, barangay } = req.query as unknown as {
      page: number;
      limit: number;
      status?: string;
      barangay?: string;
    };

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (barangay) filter.barangays = barangay;

    const skip = (page - 1) * limit;
    const [total, events] = await Promise.all([
      DisasterEvent.countDocuments(filter),
      DisasterEvent.find(filter)
        .sort({ eventDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    return res.json({
      success: true,
      data: events,
      pagination: {
        page,
        limit,
        totalDocs: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
});

router.get('/events/active', async (_req: Request, res: Response) => {
  try {
    const event = await DisasterEvent.findOne({ status: 'Active' }).sort({ eventDate: -1, createdAt: -1 });
    return res.json({
      success: true,
      data: event,
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
});

router.get(
  '/distributions/open',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isResidentRole(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only residents can view open beneficiary distributions.',
        });
      }

      const residentId = req.user?.userId || '';
      const resident = await Resident.findById(residentId)
        .select('_id barangay status')
        .lean<{ _id: mongoose.Types.ObjectId; barangay: string; status: string } | null>();

      if (!resident) {
        return res.status(404).json({
          success: false,
          message: 'Resident not found.',
        });
      }

      const candidateDistributions = await Distribution.find({
        requiresBeneficiaryApproval: true,
        status: mongoose.trusted({ $ne: 'Claimed' }),
        archivedAt: null,
        endsAt: mongoose.trusted({ $gte: new Date() }),
      })
        .sort({ scheduled: 1, createdAt: -1 })
        .lean();

      const coveredDistributions = candidateDistributions.filter((distribution) => {
        if (deriveDistributionLifecycle(distribution) !== 'Upcoming') return false;
        const targetBarangays = getTargetBarangays(distribution.barangay, distribution.assignedBarangays ?? []);
        return targetBarangays.includes(resident.barangay);
      });

      const distributionIds = coveredDistributions.map((distribution) => distribution._id);
      const submissions = distributionIds.length > 0
        ? await ProofSubmission.find({
          residentId: resident._id,
          distributionId: mongoose.trusted({ $in: distributionIds }),
        })
          .select('distributionId status updatedAt submissionVersion rejectionReason')
          .lean()
        : [];

      const submissionMap = new Map(
        submissions.map((submission) => [String((submission as { distributionId?: mongoose.Types.ObjectId }).distributionId || ''), submission]),
      );

      return res.json({
        success: true,
        data: coveredDistributions.map((distribution) => {
          const distributionId = distribution._id.toString();
          const targetBarangays = getTargetBarangays(distribution.barangay, distribution.assignedBarangays ?? []);
          const submission = submissionMap.get(distributionId) as {
            status?: string;
            updatedAt?: Date;
            submissionVersion?: number;
            rejectionReason?: string;
          } | undefined;

          return {
            id: distributionId,
            barangay: distribution.barangay,
            assignedBarangays: distribution.assignedBarangays ?? [],
            targetBarangays,
            scheduled: distribution.scheduled,
            endsAt: distribution.endsAt,
            lifecycleStatus: deriveDistributionLifecycle(distribution),
            notes: distribution.notes || '',
            applicationRequired: requiresBeneficiaryApproval(distribution),
            applicationStatus: submission?.status || 'Not Submitted',
            rejectionReason: submission?.rejectionReason || null,
            submissionVersion: submission?.submissionVersion || 0,
            lastSubmissionAt: submission?.updatedAt || null,
          };
        }),
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.post(
  '/events',
  requireAuth,
  validateRequest({ body: createDisasterEventBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdminVerifierRole(req.authUser?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only admin verifiers can manage disaster events.',
        });
      }

      const assignedBarangays = req.authUser?.assignedBarangays ?? [];
      const requestedBarangays = (req.body.barangays as string[]) || [];
      if (
        req.authUser?.role === 'LGU_STAFF' &&
        requestedBarangays.some((barangay) => !assignedBarangays.includes(barangay))
      ) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to one or more requested barangays.',
        });
      }

      const actorId = req.authUser?.userId || req.authUser?.sub || 'system';
      const event = new DisasterEvent({
        name: req.body.name,
        disasterType: req.body.disasterType,
        description: req.body.description,
        barangays: req.body.barangays,
        eventDate: new Date(req.body.eventDate),
        submissionDeadline: req.body.submissionDeadline ? new Date(req.body.submissionDeadline) : null,
        status: req.body.status,
        createdBy: actorId,
        updatedBy: actorId,
      });

      await event.save();

      return res.status(201).json({
        success: true,
        message: 'Disaster event created successfully.',
        data: event,
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.post(
  '/proof-submissions',
  authMiddleware,
  validateRequest({ body: residentProofSubmissionBody }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isResidentRole(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only residents can submit disaster proof.',
        });
      }

      const residentId = req.user?.userId || '';
      const result = await submitResidentProof({
        residentId,
        distributionId: req.body.distributionId,
        disasterEventId: req.body.disasterEventId,
        damageType: req.body.damageType,
        description: req.body.description,
        supportingInfo: req.body.supportingInfo,
        dateSubmitted: new Date(req.body.dateSubmitted),
        photoProofs: req.body.photoProofs,
        syncSource: 'ONLINE',
        clientGeneratedId: req.body.clientGeneratedId,
        deviceId: req.body.deviceId,
      });

      await logAudit(req as unknown as Request, 'PROOF_SUBMISSION_CREATED', 'ProofSubmission', result.submission._id.toString(), {
        residentId,
        disasterEventId: result.event?._id?.toString?.() || '',
        distributionId: result.distribution?._id?.toString?.() || '',
        scopeType: result.scope.type,
        status: result.submission.status,
      });

      const residentDoc = await Resident.findById(residentId).select('barangay fullName').lean();
      if (residentDoc?.barangay) {
        broadcastScopedNotification({
          title: 'New Proof Submission',
          message: `${residentDoc.fullName || 'A resident'} has submitted proof for ${result.scope.name}.`,
          type: 'system',
          meta: { 
            submissionId: result.submission._id.toString(),
            residentId,
          },
          targetBarangays: [residentDoc.barangay],
        }).catch(err => console.error('[Notify Error]', err));
      }

      return res.status(201).json({
        success: true,
        message: 'Disaster assistance request submitted for verification.',
        data: {
          proofSubmission: result.submission,
          eligibility: result.eligibility,
          scope: {
            id: result.scope.id,
            type: result.scope.type,
            name: result.scope.name,
            status: result.scope.status,
          },
        },
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.get(
  '/proof-submissions/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isResidentRole(req.user?.role)) {
        return res.status(403).json({ success: false, message: 'Only residents can view their proof status.' });
      }

      const disasterEventId = String(req.query.disasterEventId || '');
      if (!mongoose.Types.ObjectId.isValid(disasterEventId)) {
        return res.status(400).json({ success: false, message: 'A valid disasterEventId is required.' });
      }

      const submission = await ProofSubmission.findOne({
        residentId: req.user?.userId,
        disasterEventId,
      })
        .populate('disasterEventId', 'name disasterType status barangays eventDate submissionDeadline')
        .sort({ updatedAt: -1 })
        .lean();

      if (!submission) {
        return res.json({ success: true, data: null });
      }

      const event = submission.disasterEventId as any;
      return res.json({
        success: true,
        data: {
          id: submission._id.toString(),
          status: submission.status,
          rejectionReason: submission.rejectionReason || '',
          damageType: submission.damageType,
          photoCount: submission.photoProofUrls?.length || 0,
          dateSubmitted: submission.dateSubmitted,
          reviewedAt: submission.reviewedAt || null,
          submissionVersion: submission.submissionVersion,
          event: event && event._id ? {
            id: event._id.toString(),
            name: event.name,
            disasterType: event.disasterType,
            status: event.status,
          } : null,
          automaticallyEnrolled: submission.status === 'Approved',
        },
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.get(
  '/admin/proof-submissions',
  requireAuth,
  validateRequest({ query: proofSubmissionListQuery }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdminVerifierRole(req.authUser?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only admin verifiers can view proof submissions.',
        });
      }

      const { page, limit, distributionId, disasterEventId, residentId, status, barangay, search } = req.query as unknown as {
        page: number;
        limit: number;
        distributionId?: string;
        disasterEventId?: string;
        residentId?: string;
        status?: string;
        barangay?: string;
        search?: string;
      };

      const residentMatch: Record<string, unknown> = {};
      if (req.authUser?.role === 'LGU_STAFF') {
        const assigned = req.authUser.assignedBarangays ?? [];
        if (barangay) {
          if (!assigned.includes(barangay)) {
            return res.status(403).json({
              success: false,
              message: 'You do not have access to the requested barangay',
            });
          }
          residentMatch['resident.barangay'] = barangay;
        } else {
          residentMatch['resident.barangay'] = { $in: assigned };
        }
      } else if (barangay) {
        residentMatch['resident.barangay'] = barangay;
      }
      if (search) {
        const re = new RegExp(escapeRegex(search), 'i');
        residentMatch.$or = [
          { 'resident.fullName': re },
          { 'resident.firstName': re },
          { 'resident.lastName': re },
          { 'resident.residentCode': re },
        ];
      }

      const proofMatch: Record<string, unknown> = {};
      if (distributionId) proofMatch.distributionId = new mongoose.Types.ObjectId(distributionId);
      if (disasterEventId) proofMatch.disasterEventId = new mongoose.Types.ObjectId(disasterEventId);
      if (residentId) proofMatch.residentId = new mongoose.Types.ObjectId(residentId);
      if (status) proofMatch.status = status;

      const basePipeline: mongoose.PipelineStage[] = [
        { $match: proofMatch },
        {
          $lookup: {
            from: 'residents',
            localField: 'residentId',
            foreignField: '_id',
            as: 'resident',
          },
        },
        { $unwind: '$resident' },
        {
          $lookup: {
            from: 'disasterevents',
            localField: 'disasterEventId',
            foreignField: '_id',
            as: 'eventRef',
          },
        },
        {
          $lookup: {
            from: 'distributions',
            localField: 'distributionId',
            foreignField: '_id',
            as: 'distributionRef',
          },
        },
        {
          $addFields: {
            distribution: { $arrayElemAt: ['$distributionRef', 0] },
            eventSource: { $arrayElemAt: ['$eventRef', 0] },
          },
        },
        {
          $addFields: {
            event: {
              $cond: [
                { $ifNull: ['$distribution._id', false] },
                {
                  _id: '$distribution._id',
                  name: {
                    $concat: [
                      '$distribution.barangay',
                      ' Distribution - ',
                      '$distribution.scheduled',
                    ],
                  },
                  disasterType: 'Distribution',
                  status: {
                    $cond: [
                      { $eq: ['$distribution.status', 'Claimed'] },
                      'Closed',
                      'Active',
                    ],
                  },
                },
                {
                  _id: '$eventSource._id',
                  name: '$eventSource.name',
                  disasterType: '$eventSource.disasterType',
                  status: '$eventSource.status',
                },
              ],
            },
          },
        },
      ];

      if (Object.keys(residentMatch).length > 0) {
        basePipeline.push({ $match: residentMatch });
      }

      const skip = (page - 1) * limit;
      const countPipeline: mongoose.PipelineStage[] = [...basePipeline, { $count: 'total' }];
      const summaryPipeline: mongoose.PipelineStage[] = [
        ...basePipeline,
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ];
      const dataPipeline: mongoose.PipelineStage[] = [
        ...basePipeline,
        { $sort: { updatedAt: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            damageType: 1,
            description: 1,
            supportingInfo: 1,
            dateSubmitted: 1,
            photoProofUrl: 1,
            photoProofUrls: 1,
            status: 1,
            submissionVersion: 1,
            syncSource: 1,
            rejectionReason: 1,
            reviewedBy: 1,
            reviewedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            resident: {
              _id: '$resident._id',
              residentCode: '$resident.residentCode',
              fullName: '$resident.fullName',
              barangay: '$resident.barangay',
              status: '$resident.status',
            },
            event: {
              _id: '$event._id',
              name: '$event.name',
              disasterType: '$event.disasterType',
              status: '$event.status',
            },
            distribution: {
              _id: '$distribution._id',
              barangay: '$distribution.barangay',
              assignedBarangays: '$distribution.assignedBarangays',
              scheduled: '$distribution.scheduled',
              status: '$distribution.status',
              requiresBeneficiaryApproval: '$distribution.requiresBeneficiaryApproval',
            },
          },
        },
      ];

      const [countResult, summaryRows, rows] = await Promise.all([
        ProofSubmission.aggregate(countPipeline),
        ProofSubmission.aggregate(summaryPipeline),
        ProofSubmission.aggregate(dataPipeline),
      ]);

      const total = countResult[0]?.total || 0;
      const summary = {
        total,
        pendingVerification: 0,
        approved: 0,
        rejected: 0,
      };

      for (const row of summaryRows as Array<{ _id?: string; count?: number }>) {
        if (row._id === 'Pending Verification') summary.pendingVerification = row.count || 0;
        if (row._id === 'Approved') summary.approved = row.count || 0;
        if (row._id === 'Rejected') summary.rejected = row.count || 0;
      }

      return res.json({
        success: true,
        data: rows,
        summary,
        pagination: {
          page,
          limit,
          totalDocs: total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.patch(
  '/admin/proof-submissions/:id/review',
  requireAuth,
  validateRequest({ params: proofSubmissionIdParams, body: proofSubmissionReviewBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdminVerifierRole(req.authUser?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only admin verifiers can review proof submissions.',
        });
      }

      if (req.authUser?.role === 'LGU_STAFF') {
        const existing = await ProofSubmission.findById(req.params.id).select('residentId');
        if (!existing) {
          return res.status(404).json({
            success: false,
            message: 'Proof submission not found.',
          });
        }

        const resident = await Resident.findById(existing.residentId).select('barangay').lean();
        const scopedBarangays = req.authUser.assignedBarangays ?? [];
        if (resident?.barangay && !scopedBarangays.includes(resident.barangay)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to review this resident submission.',
          });
        }
      }

      const reviewerId = req.authUser?.userId || req.authUser?.sub || 'system';
      const result = await reviewResidentProof({
        proofSubmissionId: req.params.id,
        decision: req.body.decision,
        rejectionReason: req.body.rejectionReason,
        reviewerId,
      });

      await logAudit(req, 'PROOF_SUBMISSION_REVIEWED', 'ProofSubmission', result.submission._id.toString(), {
        decision: req.body.decision,
        residentId: result.resident._id.toString(),
        disasterEventId: result.event?._id?.toString?.() || '',
        distributionId: result.distribution?._id?.toString?.() || '',
        scopeType: result.scope.type,
        smsDeliveryStatus: result.notificationDelivery.sms.status,
        pushDeliveryStatus: result.notificationDelivery.push.status,
      });

      await logAudit(req, 'BENEFICIARY_ELIGIBILITY_UPDATED', 'BeneficiaryEligibility', result.eligibility._id.toString(), {
        residentId: result.resident._id.toString(),
        disasterEventId: result.event?._id?.toString?.() || '',
        distributionId: result.distribution?._id?.toString?.() || '',
        status: result.eligibility.status,
      });


      return res.json({
        success: true,
        message: req.body.decision === 'Approved'
          ? 'Proof submission approved.'
          : 'Proof submission returned for revision.',
        data: {
          proofSubmission: result.submission,
          notificationDelivery: result.notificationDelivery,
          eligibility: result.eligibility,
        },
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.post(
  '/scan/validate',
  authMiddleware,
  validateRequest({ body: qrValidationBody }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isScannerRole(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only authorized scanner accounts can validate beneficiary QR codes.',
        });
      }

      const actor = getMobileActor(req);
      const validation = await validateResidentQrForEvent({
        qrData: req.body.qrData,
        disasterEventId: req.body.disasterEventId,
        actor,
      });

      return res.json({
        success: true,
        data: validation,
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.post(
  '/scan/claim',
  authMiddleware,
  validateRequest({ body: beneficiaryClaimBody }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isScannerRole(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only authorized scanner accounts can record claims.',
        });
      }

      const actor = getMobileActor(req);
      const result = await recordDisasterEventClaim({
        disasterEventId: req.body.disasterEventId,
        qrData: req.body.qrData,
        residentId: req.body.residentId,
        scannedAt: req.body.scannedAt ? new Date(req.body.scannedAt) : new Date(),
        source: 'ONLINE',
        clientGeneratedId: req.body.clientGeneratedId,
        deviceId: req.body.deviceId,
        actor,
      });

      if (!result.claim) {
        return res.json({
          success: true,
          data: result.validation,
        });
      }

      await logAudit(req as unknown as Request, 'BENEFICIARY_CLAIM_RECORDED', 'Claim', result.claim._id.toString(), {
        claimId: result.claim.claimId,
        residentId: result.claim.residentId,
        disasterEventId: result.claim.disasterEventId,
      });

      return res.status(201).json({
        success: true,
        message: 'Beneficiary claim recorded successfully.',
        data: {
          validation: result.validation,
          claim: result.claim,
        },
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.get(
  '/events/:id/offline-pack',
  authMiddleware,
  validateRequest({ params: disasterEventIdParams }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isScannerRole(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only authorized scanner accounts can download offline beneficiary lists.',
        });
      }

      const pack = await buildOfflineBeneficiaryPack({
        disasterEventId: req.params.id,
        actor: getMobileActor(req),
      });

      return res.json({
        success: true,
        data: pack,
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.post(
  '/sync/proof-submissions',
  authMiddleware,
  validateRequest({ body: offlineProofSyncBody }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isResidentRole(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only residents can sync proof submissions.',
        });
      }

      const actorId = req.user?.userId || '';
      const deviceId = req.body.deviceId;
      const results: Array<Record<string, unknown>> = [];

      for (const item of req.body.submissions as OfflineProofSubmissionItem[]) {
        await upsertOfflineSyncLog({
          actorId,
          actorRole: 'Resident',
          queueType: 'PROOF_SUBMISSION',
          clientGeneratedId: item.clientGeneratedId,
          deviceId,
          residentId: actorId,
          disasterEventId: item.disasterEventId,
          distributionId: item.distributionId,
          payload: item,
          syncStatus: 'Processing',
        });

        try {
          const result = await submitResidentProof({
            residentId: actorId,
            distributionId: item.distributionId,
            disasterEventId: item.disasterEventId,
            damageType: item.damageType as never,
            description: item.description,
            supportingInfo: item.supportingInfo,
            dateSubmitted: new Date(item.dateSubmitted),
            photoProofs: item.photoProofs,
            syncSource: 'OFFLINE_SYNC',
            clientGeneratedId: item.clientGeneratedId,
            deviceId,
          });

          await upsertOfflineSyncLog({
            actorId,
            actorRole: 'Resident',
            queueType: 'PROOF_SUBMISSION',
            clientGeneratedId: item.clientGeneratedId,
            deviceId,
            residentId: actorId,
            disasterEventId: item.disasterEventId,
            distributionId: item.distributionId,
            proofSubmissionId: result.submission._id.toString(),
            payload: item,
            syncStatus: 'Synced',
            errorCode: '',
            retryable: false,
          });

          await logAudit(req as unknown as Request, 'OFFLINE_SYNC_RECEIVED', 'OfflineSyncQueue', item.clientGeneratedId, {
            queueType: 'PROOF_SUBMISSION',
            disasterEventId: item.disasterEventId,
            distributionId: item.distributionId,
            proofSubmissionId: result.submission._id.toString(),
          });

          results.push({
            clientGeneratedId: item.clientGeneratedId,
            syncStatus: 'Synced',
            proofSubmissionId: result.submission._id.toString(),
            serverStatus: result.submission.status,
            retryable: false,
          });
        } catch (error) {
          const message = error instanceof BeneficiaryServiceError ? error.message : 'Unable to sync proof submission.';
          const errorCode = error instanceof BeneficiaryServiceError ? error.code : 'SYNC_INTERNAL_ERROR';
          const retryable = !(error instanceof BeneficiaryServiceError) || error.statusCode >= 500;
          await upsertOfflineSyncLog({
            actorId,
            actorRole: 'Resident',
            queueType: 'PROOF_SUBMISSION',
            clientGeneratedId: item.clientGeneratedId,
            deviceId,
            residentId: actorId,
            disasterEventId: item.disasterEventId,
            distributionId: item.distributionId,
            payload: item,
            syncStatus: 'Failed',
            errorMessage: message,
            errorCode,
            retryable,
          });

          results.push({
            clientGeneratedId: item.clientGeneratedId,
            syncStatus: 'Failed',
            error: message,
            errorCode,
            retryable,
          });
        }
      }

      return res.json({
        success: true,
        data: {
          synced: results,
        },
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

router.post(
  '/sync/claims',
  authMiddleware,
  validateRequest({ body: offlineClaimSyncBody }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isScannerRole(req.user?.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only authorized scanner accounts can sync claims.',
        });
      }

      const actor = getMobileActor(req);
      const results: Array<Record<string, unknown>> = [];

      for (const item of req.body.claims as Array<Record<string, string>>) {
        await upsertOfflineSyncLog({
          actorId: actor.userId,
          actorRole: actor.role as 'Volunteer' | 'LGU_STAFF' | 'Admin' | 'Staff' | 'SUPERADMIN',
          queueType: 'CLAIM',
          clientGeneratedId: item.clientGeneratedId,
          deviceId: req.body.deviceId,
          residentId: item.residentId,
          disasterEventId: req.body.disasterEventId,
          payload: {
            ...item,
            disasterEventId: req.body.disasterEventId,
          },
          syncStatus: 'Processing',
        });

        try {
          const result = await recordDisasterEventClaim({
            disasterEventId: req.body.disasterEventId,
            qrData: item.qrData,
            residentId: item.residentId,
            scannedAt: new Date(item.scannedAt),
            source: 'OFFLINE_SYNC',
            clientGeneratedId: item.clientGeneratedId,
            deviceId: req.body.deviceId,
            actor,
          });

          const syncStatus = result.claim || result.validation.outcome === 'ALREADY_CLAIMED'
            ? 'Synced'
            : 'Failed';
          const errorMessage = syncStatus === 'Failed' ? result.validation.resultLabel : '';

          await upsertOfflineSyncLog({
            actorId: actor.userId,
            actorRole: actor.role as 'Volunteer' | 'LGU_STAFF' | 'Admin' | 'Staff' | 'SUPERADMIN',
            queueType: 'CLAIM',
            clientGeneratedId: item.clientGeneratedId,
            deviceId: req.body.deviceId,
            residentId: item.residentId,
            disasterEventId: req.body.disasterEventId,
            claimMongoId: result.claim?._id?.toString(),
            claimId: result.claim?.claimId || result.validation.claimId,
            payload: {
              ...item,
              disasterEventId: req.body.disasterEventId,
            },
            syncStatus,
            errorMessage,
          });

          await logAudit(req as unknown as Request, 'OFFLINE_SYNC_RECEIVED', 'OfflineSyncQueue', item.clientGeneratedId, {
            queueType: 'CLAIM',
            disasterEventId: req.body.disasterEventId,
            claimId: result.claim?.claimId || result.validation.claimId || '',
            outcome: result.validation.outcome,
          });

          results.push({
            clientGeneratedId: item.clientGeneratedId,
            syncStatus,
            validation: result.validation,
            claimId: result.claim?.claimId || result.validation.claimId,
          });
        } catch (error) {
          const message = error instanceof BeneficiaryServiceError ? error.message : 'Unable to sync claim.';
          await upsertOfflineSyncLog({
            actorId: actor.userId,
            actorRole: actor.role as 'Volunteer' | 'LGU_STAFF' | 'Admin' | 'Staff' | 'SUPERADMIN',
            queueType: 'CLAIM',
            clientGeneratedId: item.clientGeneratedId,
            deviceId: req.body.deviceId,
            residentId: item.residentId,
            disasterEventId: req.body.disasterEventId,
            payload: {
              ...item,
              disasterEventId: req.body.disasterEventId,
            },
            syncStatus: 'Failed',
            errorMessage: message,
          });

          results.push({
            clientGeneratedId: item.clientGeneratedId,
            syncStatus: 'Failed',
            error: message,
          });
        }
      }

      return res.json({
        success: true,
        data: {
          synced: results,
        },
      });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
);

export default router;
