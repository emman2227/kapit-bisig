/**
 * Distribution Routes
 * 
 * CRUD operations for barangay relief distributions.
 * 
 * Endpoints:
 * - POST   /api/distributions         - Create a distribution (Admin, Staff)
 * - GET    /api/distributions         - List all distributions (Admin, Staff, Volunteer)
 * - PATCH  /api/distributions/:id/claim - Mark distribution as claimed (Admin, Staff)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Distribution from '../models/Distribution';
import DisasterEvent from '../models/DisasterEvent';
import Resident from '../models/Resident';
import DistributionClaim from '../models/DistributionClaim';
import Claim from '../models/Claim';
import StaffUser from '../models/StaffUser';
import User from '../models/User';
import { AuthRequest, requireStaffOrSuperadmin, requireSuperadmin } from '../middleware/unifiedAuth';
import { validateRequest } from '../validation/validateRequest';
import {
  createDistributionBody,
  distributionIdParams,
  distributionRosterParams,
  rescheduleDistributionBody,
  syncClaimsBody,
  updateDistributionStaffBody,
} from '../validation/distribution.schema';
import { logAudit } from '../utils/audit';
import { broadcastResidentNotification, broadcastScopedNotification } from '../utils/createNotification';
import { broadcastDistributionSms } from '../utils/distributionSms';
import { broadcastDistributionPush } from '../utils/distributionPush';
import { deriveDistributionLifecycle } from '../utils/distributionLifecycle';
import {
  countRegisteredHouseholdsForDistribution,
  enrollApprovedResidentsInDistribution,
  getEligibleResidentIdsByDistribution,
  getEligibleResidentIdsForDistribution,
  getTargetBarangays,
  isResidentApprovedBeneficiaryForDistribution,
  requiresBeneficiaryApproval,
  upsertDistributionClaimFromClaim,
} from '../services/distributionFlowService';
import { upsertOfflineSyncLog } from '../services/beneficiaryService';

function getMaskedName(fullName: string): string {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return 'Uxxxx Uxxxx';
  }
  if (parts.length === 1) {
    const firstInitial = parts[0][0]?.toUpperCase() || 'U';
    return `${firstInitial}xxxx`;
  }

  const firstInitial = parts[0][0]?.toUpperCase() || 'U';
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() || 'U';
  return `${firstInitial}xxxx ${lastInitial}xxxx`;
}

const router = Router();

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyStore = new Map<string, {
  expiresAt: number;
  distributionId: string;
  response: Record<string, unknown>;
}>();

function cleanIdempotencyStore(): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    if (entry.expiresAt <= now) {
      idempotencyStore.delete(key);
    }
  }
}

function idempotencyCacheKey(userKey: string, key: string): string {
  return `${userKey}::${key}`;
}

function hasCoverage(scopes: string[], targets: string[]): boolean {
  return targets.every((target) => scopes.includes(target));
}

function hasAnyCoverage(scopes: string[], targets: string[]): boolean {
  return scopes.some((scope) => targets.includes(scope));
}

function normalizeScope(targets: Array<string | undefined | null>): string[] {
  return Array.from(new Set(targets.filter((t): t is string => Boolean(t))));
}

function getUncoveredTargets(teamScopes: string[][], targets: string[]): string[] {
  return targets.filter((target) => !teamScopes.some((scopes) => scopes.includes(target)));
}

const isScopedRole = (role?: string) => role === 'LGU_STAFF' || role === 'Volunteer';

async function getScopedBarangays(user?: AuthRequest['authUser']): Promise<string[]> {
  if (!user || !isScopedRole(user.role)) return [];

  // Prefer DB source of truth so scope updates apply immediately without requiring re-login.
  if (user.role === 'LGU_STAFF' && user.userId) {
    const staff = await StaffUser.findById(user.userId).select('assignedBarangays').lean();
    if (Array.isArray(staff?.assignedBarangays) && staff.assignedBarangays.length > 0) {
      return Array.from(new Set(staff.assignedBarangays.filter(Boolean)));
    }
  }

  if (user.role === 'Volunteer' && user.userId) {
    const volunteer = await User.findById(user.userId).select('barangay').lean();
    if (volunteer?.barangay) {
      return [volunteer.barangay];
    }
  }

  return Array.from(new Set((user.assignedBarangays ?? []).filter(Boolean)));
}

const hasDistributionAccess = (scopedBarangays: string[], distribution: { barangay: string; assignedBarangays?: string[] }) => {
  if (scopedBarangays.length === 0) return false;
  if (scopedBarangays.includes(distribution.barangay)) return true;
  const targetBarangays = distribution.assignedBarangays ?? [];
  return targetBarangays.some((b) => scopedBarangays.includes(b));
};

/**
 * POST /api/distributions
 *
 * Create a new distribution for a barangay.
 * LGU_STAFF can only create for their assigned barangays.
 */
router.post(
  '/',
  requireStaffOrSuperadmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.authUser?.role !== 'SUPERADMIN' && req.authUser?.role !== 'LGU_STAFF') {
        return res.status(403).json({
          success: false,
          message: 'Forbidden',
        });
      }

      const scopedBarangays = await getScopedBarangays(req.authUser);
      let parsed;
      try {
        parsed = createDistributionBody.safeParse(req.body);
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parseError instanceof Error ? parseError.message : 'Validation failed',
        });
      }
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const {
        disasterEventId,
        barangay,
        assignedBarangays = [],
        assignedStaffIds,
        scheduled,
        endsAt,
        notes,
        requiresBeneficiaryApproval: requestedRequiresApproval,
      } = parsed.data;

      cleanIdempotencyStore();
      const idempotencyKeyHeader = req.header('Idempotency-Key')?.trim();
      if (idempotencyKeyHeader) {
        const actorId = req.authUser?.userId ?? req.authUser?.sub ?? 'anonymous';
        const key = idempotencyCacheKey(actorId, idempotencyKeyHeader);
        const existing = idempotencyStore.get(key);
        if (existing && existing.expiresAt > Date.now()) {
          return res.status(200).json(existing.response);
        }
      }

      const coverageScope = normalizeScope([barangay, ...assignedBarangays]);

      // Scope check: LGU staff can only create distributions within their assigned barangays.
      if (req.authUser?.role === 'LGU_STAFF') {
        const outOfScope = coverageScope.find((b) => !scopedBarangays.includes(b));
        if (outOfScope) {
          return res.status(403).json({
            success: false,
            code: 'OUT_OF_SCOPE_STAFF',
            message: `You do not have access to create distributions for ${outOfScope}`,
          });
        }
      }

      const uniqueStaffIds = [...new Set(assignedStaffIds)];
      const activeStaffDocs = await StaffUser.find({ isActive: true })
        .select('_id role assignedBarangays firstName lastName')
        .lean();

      const requestedIdSet = new Set(uniqueStaffIds);
      const staffDocs = activeStaffDocs.filter((doc) => requestedIdSet.has(doc._id.toString()));

      const foundIds = new Set(staffDocs.map((doc) => doc._id.toString()));
      const missingStaffIds = uniqueStaffIds.filter((id) => !foundIds.has(id));
      if (missingStaffIds.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'STAFF_NOT_FOUND',
          message: 'One or more selected staff members were not found',
          missingStaffIds,
        });
      }

      const invalidRole = staffDocs.find((doc) => !['LGU_STAFF'].includes(doc.role));
      if (invalidRole) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ASSIGNED_STAFF',
          message: 'Only active LGU staff can be assigned to a distribution',
        });
      }

      const outOfScopeAssignees = staffDocs
        .filter((doc) => !hasAnyCoverage(doc.assignedBarangays ?? [], coverageScope))
        .map((doc) => doc._id.toString());

      if (outOfScopeAssignees.length > 0) {
        return res.status(403).json({
          success: false,
          code: 'OUT_OF_SCOPE_STAFF',
          message: 'Some selected staff are not assigned to any barangay in this distribution.',
          outOfScopeStaffIds: outOfScopeAssignees,
        });
      }

      // Check same-day distribution conflicts for assigned staff
      const targetDate = new Date(scheduled);
      if (!isNaN(targetDate.getTime())) {
        const targetYMD = targetDate.toISOString().slice(0, 10);
        const allDists = await Distribution.find({}).lean();
        const existingActiveDists = allDists.filter((d) => d.status !== 'Claimed');

        for (const dist of existingActiveDists) {
          if (!dist.scheduled) continue;
          const distDate = new Date(dist.scheduled);
          if (isNaN(distDate.getTime())) continue;
          const distYMD = distDate.toISOString().slice(0, 10);
          if (distYMD === targetYMD) {
            const existingStaffSet = new Set((dist.assignedStaffIds || []).map((id) => id.toString()));
            const conflicting = staffDocs.filter((doc) => existingStaffSet.has(doc._id.toString()));
            if (conflicting.length > 0) {
              const names = conflicting
                .map((doc: any) => `${doc.firstName || ''} ${doc.lastName || ''}`.trim() || 'Staff')
                .join(', ');
              return res.status(409).json({
                success: false,
                code: 'STAFF_SCHEDULE_CONFLICT',
                message: `Staff member (${names}) is already assigned to a distribution for Barangay ${dist.barangay} on this day.`,
                conflictingStaffIds: conflicting.map((doc) => doc._id.toString()),
              });
            }
          }
        }
      }

      const uncoveredTargets = getUncoveredTargets(
        staffDocs.map((doc) => normalizeScope(doc.assignedBarangays ?? [])),
        coverageScope,
      );

      if (uncoveredTargets.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'INSUFFICIENT_SCOPE_COVERAGE',
          message: 'Selected staff do not collectively cover every barangay in this distribution.',
          uncoveredBarangays: uncoveredTargets,
        });
      }

      if (req.authUser?.role === 'LGU_STAFF') {
        const outOfScopeAssigneesForRequester = staffDocs
          .filter((doc) => !hasCoverage(scopedBarangays, normalizeScope(doc.assignedBarangays ?? [])))
          .map((doc) => doc._id.toString());

        if (outOfScopeAssigneesForRequester.length > 0) {
          return res.status(403).json({
            success: false,
            code: 'OUT_OF_SCOPE_STAFF',
            message: 'Some selected staff are outside your barangay scope.',
            outOfScopeStaffIds: outOfScopeAssigneesForRequester,
          });
        }
      }

      const targetBarangays = getTargetBarangays(barangay, assignedBarangays);

      let disasterEvent: {
        _id: mongoose.Types.ObjectId;
        name: string;
        status: string;
        barangays: string[];
      } | null = null;
      let requiresBeneficiaryApproval = false;

      if (disasterEventId) {
        const foundEvent = await DisasterEvent.findById(disasterEventId)
          .select('_id name status barangays')
          .lean();
        if (!foundEvent) {
          return res.status(404).json({
            success: false,
            code: 'DISASTER_EVENT_NOT_FOUND',
            message: 'Disaster event not found.',
          });
        }
        if (foundEvent.status !== 'Active') {
          return res.status(409).json({
            success: false,
            code: 'DISASTER_EVENT_NOT_ACTIVE',
            message: 'Distributions can only be created for an active disaster event.',
          });
        }

        const uncoveredByEvent = targetBarangays.filter((target) => !foundEvent.barangays.includes(target));
        if (uncoveredByEvent.length > 0) {
          return res.status(400).json({
            success: false,
            code: 'EVENT_BARANGAY_MISMATCH',
            message: 'Every distribution barangay must be covered by the selected disaster event.',
            uncoveredBarangays: uncoveredByEvent,
          });
        }
        disasterEvent = foundEvent;
        requiresBeneficiaryApproval = requestedRequiresApproval === true;
      } else if (requestedRequiresApproval === true) {
        // Auto-resolve active disaster event for this barangay if one exists
        const foundEvent = (await DisasterEvent.findOne({
          status: 'Active',
          barangays: barangay,
        })
          .sort({ eventDate: -1, createdAt: -1 })
          .select('_id name status barangays')
          .lean()) || (await DisasterEvent.findOne({ status: 'Active' })
          .sort({ eventDate: -1, createdAt: -1 })
          .select('_id name status barangays')
          .lean());

        if (foundEvent) {
          disasterEvent = foundEvent;
        }
        requiresBeneficiaryApproval = true;
      }

      const distribution = new Distribution({
        disasterEventId: disasterEvent ? disasterEvent._id : null,
        barangay,
        assignedBarangays,
        assignedStaffIds: uniqueStaffIds,
        scheduled,
        endsAt: new Date(endsAt),
        households: 0,
        notes: notes || '',
        requiresBeneficiaryApproval,
        status: 'Unclaimed',
        claimedAt: null,
      });

      await distribution.save();

      const enrollment = await enrollApprovedResidentsInDistribution(distribution);
      distribution.households = await countRegisteredHouseholdsForDistribution(distribution);
      await distribution.save();

      await logAudit(req, 'DISTRIBUTION_CREATED', 'Distribution', distribution._id.toString(), {
        barangay,
        disasterEventId: disasterEvent ? disasterEvent._id.toString() : null,
        disasterEventName: disasterEvent ? disasterEvent.name : null,
        assignedBarangays,
        scheduled,
        endsAt,
        householdsDerived: distribution.households,
        requiresBeneficiaryApproval,
        assignedStaffCount: uniqueStaffIds.length,
        automaticallyEnrolledResidents: enrollment.matchedResidents,
      });

      // Notify staff assigned to the covered barangays.
      await broadcastScopedNotification({
        title: 'New Distribution',
        message: `A relief distribution for ${barangay} has been scheduled on ${scheduled}.`,
        type: 'dispatch',
        meta: { distributionId: distribution._id.toString(), barangay, assignedBarangays, scheduled },
        targetBarangays,
      });

      // Notify approved residents in the covered barangays.
      await broadcastResidentNotification({
        title: requiresBeneficiaryApproval
          ? 'Targeted Relief Distribution • Proof Required'
          : 'New Relief Distribution',
        message: requiresBeneficiaryApproval
          ? `A targeted relief distribution for ${targetBarangays.join(', ')} has been scheduled on ${scheduled}. You must submit proof of damage in the app to become eligible.`
          : `A relief distribution for ${targetBarangays.join(', ')} has been scheduled on ${scheduled}. Open to all verified residents.`,
        type: 'dispatch',
        meta: {
          distributionId: distribution._id.toString(),
          barangay,
          assignedBarangays,
          targetBarangays,
          scheduled,
          requiresBeneficiaryApproval,
          screen: requiresBeneficiaryApproval ? 'proof-request' : 'distributions',
        },
        targetBarangays,
      });

      const [smsDelivery, pushDelivery] = await Promise.all([
        broadcastDistributionSms({ targetBarangays, scheduled }).catch((error: unknown) => {
          console.warn('[distributionSms] Broadcast failed:', error instanceof Error ? error.message : 'Unknown error');
          return { status: 'provider_request_failed' as const, attempted: 0, sent: 0, skipped: 0, failed: 0 };
        }),
        broadcastDistributionPush({
          distributionId: distribution._id.toString(),
          targetBarangays,
          scheduled,
          requiresBeneficiaryApproval,
        }).catch((error: unknown) => {
          console.warn('[distributionPush] Broadcast failed:', error instanceof Error ? error.message : 'Unknown error');
          return { status: 'provider_request_failed' as const, attempted: 0, sent: 0, skipped: 0, failed: 0 };
        }),
      ]);

      res.status(201).json({
        success: true,
        message: `Distribution created successfully with ${enrollment.matchedResidents} automatically enrolled resident${enrollment.matchedResidents === 1 ? '' : 's'}.`,
        data: { ...distribution.toJSON(), lifecycleStatus: deriveDistributionLifecycle(distribution) },
        enrollment,
        smsDelivery,
        pushDelivery,
      });

      if (idempotencyKeyHeader) {
        const actorId = req.authUser?.userId ?? req.authUser?.sub ?? 'anonymous';
        const key = idempotencyCacheKey(actorId, idempotencyKeyHeader);
        idempotencyStore.set(key, {
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
          distributionId: distribution._id.toString(),
          response: {
            success: true,
            message: `Distribution created successfully with ${enrollment.matchedResidents} automatically enrolled resident${enrollment.matchedResidents === 1 ? '' : 's'}.`,
            data: { ...distribution.toJSON(), lifecycleStatus: deriveDistributionLifecycle(distribution) },
            enrollment,
            smsDelivery,
            pushDelivery,
          },
        });
      }
    } catch (error: unknown) {
      console.error('Error creating distribution:', error);
      let userFriendlyMessage = 'Failed to create distribution. Please verify your inputs and try again.';
      if (error instanceof mongoose.Error.ValidationError) {
        userFriendlyMessage = Object.values(error.errors).map((e) => e.message).join(' ') || 'Validation error while creating distribution.';
      } else if (error instanceof Error) {
        const isInternalDbError = error.name.includes('Cast') ||
          error.message.includes('$') ||
          error.message.includes('Mongoose') ||
          error.message.includes('BSON') ||
          error.message.includes('at path');
        if (!isInternalDbError && error.message.length < 150) {
          userFriendlyMessage = error.message;
        }
      }
      res.status(500).json({ success: false, code: 'INTERNAL_SERVER_ERROR', message: userFriendlyMessage });
    }
  }
);

/**
 * GET /api/distributions
 *
 * List distributions. LGU_STAFF only sees their assigned barangays.
 */
router.get(
  '/',
  async (req: AuthRequest, res: Response) => {
    try {
      let distributions = await Distribution.find({})
        .sort({ createdAt: -1 })
        .lean();

      if (isScopedRole(req.authUser?.role)) {
        const scopedBarangays = await getScopedBarangays(req.authUser);
        const assigned = new Set(scopedBarangays);
        distributions = distributions.filter((d) => {
          if (assigned.has(d.barangay)) return true;
          return (d.assignedBarangays ?? []).some((b) => assigned.has(b));
        });
      }

      // Aggregate registered (approved) household counts per barangay for open distributions.
      const barangays = [...new Set(
        distributions.flatMap((d) =>
          Array.isArray(d.assignedBarangays) && d.assignedBarangays.length > 0
            ? d.assignedBarangays
            : [d.barangay]
        )
      )];
      const counts = await Resident.aggregate([
        { $match: { barangay: mongoose.trusted({ $in: barangays }), status: 'Approved' } },
        { $group: { _id: '$barangay', count: { $sum: 1 } } },
      ]);
      const countMap: Record<string, number> = {};
      for (const c of counts) {
        countMap[c._id] = c.count;
      }

      // Aggregate claimed household counts per distribution from DistributionClaim
      const distLookupIds = distributions.flatMap((d) => [
        new mongoose.Types.ObjectId(d._id),
        d._id.toString(),
      ]);
      const claimedCounts = await DistributionClaim.aggregate([
        { $match: { distributionId: mongoose.trusted({ $in: distLookupIds }) } },
        { $group: { _id: { $toString: '$distributionId' }, count: { $sum: 1 } } },
      ]);
      const claimedCountMap: Record<string, number> = {};
      for (const c of claimedCounts) {
        if (c._id) {
          claimedCountMap[c._id] = c.count;
        }
      }

      const targetedDistributionIds = distributions
        .filter((d) => requiresBeneficiaryApproval(d))
        .map((d) => d._id.toString());
      const eligibleResidentIdsByDistribution = await getEligibleResidentIdsByDistribution(targetedDistributionIds);

      const data = distributions.map((d) => {
        const claimed = claimedCountMap[d._id.toString()] ?? 0;
        const targetBarangays = getTargetBarangays(d.barangay, d.assignedBarangays ?? []);
        const registered = requiresBeneficiaryApproval(d)
          ? (eligibleResidentIdsByDistribution.get(d._id.toString())?.length ?? 0)
          : targetBarangays.reduce((sum, b) => sum + (countMap[b] ?? 0), 0);

        // Derive status from actual claims vs registered households
        let derivedStatus = d.status;
        if (claimed > 0 && registered > 0 && claimed >= registered) {
          derivedStatus = 'Claimed';           // all households claimed
        } else if (claimed > 0) {
          derivedStatus = 'Partially Claimed';  // some households claimed
        }

        const lifecycleStatus = deriveDistributionLifecycle({
          ...d,
          status: derivedStatus,
          claimedHouseholds: claimed,
          registeredHouseholds: registered,
        });

        return {
          ...d,
          id: d._id.toString(),
          households: registered,
          registeredHouseholds: registered,
          claimedHouseholds: claimed,
          status: derivedStatus,
          lifecycleStatus,
          claimedAt: claimed > 0 ? (d.claimedAt || new Date().toISOString()) : d.claimedAt,
          requiresBeneficiaryApproval: requiresBeneficiaryApproval(d),
        };
      });

      res.json({ success: true, data });
    } catch (error: unknown) {
      console.error('Error fetching distributions:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch distributions';
      res.status(500).json({ success: false, message });
    }
  }
);

/**
 * GET /api/distributions/scanner/active
 *
 * Returns only explicitly assigned distributions that are in scope and active.
 * The nearest upcoming assignment is included for validation-only mode.
 */
router.get('/scanner/active', async (req: AuthRequest, res: Response) => {
  try {
    if (req.authUser?.role !== 'LGU_STAFF' || !req.authUser.userId) {
      return res.status(403).json({
        success: false,
        code: 'SCANNER_FORBIDDEN',
        message: 'Only authenticated LGU staff can load scanner assignments.',
      });
    }

    const staffId = req.authUser.userId;
    if (!mongoose.Types.ObjectId.isValid(staffId)) {
      return res.status(401).json({ success: false, message: 'Invalid staff session.' });
    }

    const scopedBarangays = await getScopedBarangays(req.authUser);
    const scoped = new Set(scopedBarangays);
    const assignments = await Distribution.find({
      assignedStaffIds: new mongoose.Types.ObjectId(staffId),
      archivedAt: null,
      status: mongoose.trusted({ $ne: 'Claimed' }),
    }).sort({ scheduled: 1 }).lean();

    const inScope = assignments.filter((distribution) => {
      const targets = getTargetBarangays(distribution.barangay, distribution.assignedBarangays ?? []);
      return targets.some((barangay) => scoped.has(barangay));
    });

    const distLookupIds = inScope.flatMap((d) => [
      new mongoose.Types.ObjectId(d._id),
      d._id.toString(),
    ]);

    const claimedCounts = await DistributionClaim.aggregate([
      { $match: { distributionId: mongoose.trusted({ $in: distLookupIds }) } },
      { $group: { _id: { $toString: '$distributionId' }, count: { $sum: 1 } } },
    ]);
    const claimedCountMap: Record<string, number> = {};
    for (const c of claimedCounts) {
      if (c._id) claimedCountMap[c._id] = c.count;
    }

    const residentCounts = await Resident.aggregate([
      { $match: { status: 'Approved' } },
      { $group: { _id: '$barangay', count: { $sum: 1 } } },
    ]);
    const residentCountMap: Record<string, number> = {};
    for (const r of residentCounts) {
      if (r._id) residentCountMap[r._id] = r.count;
    }

    const getLifecycle = (distribution: typeof inScope[number]) => {
      const targets = getTargetBarangays(distribution.barangay, distribution.assignedBarangays ?? []);
      const registered = targets.reduce((sum, b) => sum + (residentCountMap[b] ?? 0), 0);
      const claimed = claimedCountMap[distribution._id.toString()] ?? 0;
      const derivedStatus = distribution.status;
      return deriveDistributionLifecycle({
        ...distribution,
        status: derivedStatus,
        claimedHouseholds: claimed,
        registeredHouseholds: registered,
      });
    };

    const toScannerDistribution = (distribution: typeof inScope[number]) => {
      const targets = getTargetBarangays(distribution.barangay, distribution.assignedBarangays ?? []);
      const registered = targets.reduce((sum, b) => sum + (residentCountMap[b] ?? 0), 0);
      const claimed = claimedCountMap[distribution._id.toString()] ?? 0;
      const derivedStatus = distribution.status;
      return {
        ...distribution,
        id: distribution._id.toString(),
        households: registered,
        registeredHouseholds: registered,
        claimedHouseholds: claimed,
        status: derivedStatus,
        lifecycleStatus: getLifecycle(distribution),
      };
    };

    const active = inScope
      .filter((distribution) => getLifecycle(distribution) === 'Active')
      .map(toScannerDistribution);
    const upcoming = inScope
      .filter((distribution) => getLifecycle(distribution) === 'Upcoming')
      .sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime())[0];

    return res.json({
      success: true,
      data: {
        active,
        nearestUpcoming: upcoming ? toScannerDistribution(upcoming) : null,
      },
    });
  } catch (error) {
    console.error('[SCANNER_ACTIVE_DISTRIBUTIONS]', error);
    return res.status(500).json({ success: false, message: 'Unable to load scanner assignments.' });
  }
});

/**
 * GET /api/distributions/scanner/roster/:distributionId
 *
 * Pre-downloads the eligible resident roster for a distribution
 * so staff can scan offline without internet connectivity.
 */
router.get(
  '/scanner/roster/:distributionId',
  validateRequest({ params: distributionRosterParams }),
  async (req: AuthRequest, res: Response) => {
    try {
      if ((req.authUser?.role !== 'LGU_STAFF' && req.authUser?.role !== 'SUPERADMIN') || !req.authUser?.userId) {
        return res.status(403).json({
          success: false,
          code: 'SCANNER_FORBIDDEN',
          message: 'Only authenticated LGU staff can download scanner rosters.',
        });
      }

      const staffId = req.authUser.userId;
      const { distributionId } = req.params;

      const distribution = await Distribution.findById(distributionId).lean();
      if (!distribution || distribution.archivedAt) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      const isAssigned = (distribution.assignedStaffIds ?? []).some(
        (id) => id.toString() === staffId
      );
      if (req.authUser.role !== 'SUPERADMIN' && !isAssigned) {
        return res.status(403).json({
          success: false,
          code: 'SCANNER_NOT_ASSIGNED',
          message: 'Your staff account is not assigned to this distribution.',
        });
      }

      const scopedBarangays = await getScopedBarangays(req.authUser);
      const targets = getTargetBarangays(distribution.barangay, distribution.assignedBarangays ?? []);
      if (req.authUser.role !== 'SUPERADMIN' && !targets.some((b) => scopedBarangays.includes(b))) {
        return res.status(403).json({
          success: false,
          code: 'SCANNER_OUT_OF_SCOPE',
          message: 'Distribution is out of your assigned barangay scope.',
        });
      }

      const requiresBeneficiary = requiresBeneficiaryApproval(distribution as any);
      let residents: Array<{
        _id: mongoose.Types.ObjectId;
        residentCode?: string;
        fullName?: string;
        barangay: string;
        qrVersion?: number;
      }> = [];

      if (requiresBeneficiary) {
        const eligibleIds = await getEligibleResidentIdsForDistribution(distributionId);
        residents = await Resident.find({
          _id: mongoose.trusted({ $in: eligibleIds.map((id) => new mongoose.Types.ObjectId(id)) }),
          status: 'Approved',
          qrStatus: 'ACTIVE',
        })
          .setOptions({ sanitizeFilter: false })
          .select('_id residentCode fullName barangay qrVersion')
          .lean();
      } else {
        residents = await Resident.find({
          barangay: mongoose.trusted({ $in: targets }),
          status: 'Approved',
        })
          .setOptions({ sanitizeFilter: false })
          .select('_id residentCode fullName barangay qrVersion')
          .lean();
      }

      // Query already claimed households for this distribution
      const claimedDocs = await DistributionClaim.find({
        distributionId: distribution._id,
      })
        .select('householdId')
        .lean();
      const claimedSet = new Set(claimedDocs.map((c) => c.householdId.toString()));

      const roster = residents.map((r) => ({
        residentId: r._id.toString(),
        residentCode: r.residentCode || '',
        maskedName: getMaskedName(r.fullName || ''),
        barangay: r.barangay,
        qrVersion: r.qrVersion ?? 1,
        isApprovedBeneficiary: true,
        alreadyClaimed: claimedSet.has(r._id.toString()),
      }));

      return res.json({
        success: true,
        data: {
          distributionId: distribution._id.toString(),
          barangay: distribution.barangay,
          assignedBarangays: distribution.assignedBarangays ?? [],
          requiresBeneficiaryApproval: requiresBeneficiary,
          totalCount: roster.length,
          claimedCount: claimedSet.size,
          generatedAt: new Date().toISOString(),
          roster,
        },
      });
    } catch (error: any) {
      console.error('[SCANNER_ROSTER]', error);
      return res.status(500).json({ success: false, message: 'Unable to generate scanner roster.', error: error?.message || String(error) });
    }
  }
);

/**
 * POST /api/distributions/scanner/sync-claims
 *
 * Accepts a batch of claims recorded offline by staff/volunteers.
 * Validates eligibility, guards against duplicates, records Claims and DistributionClaims,
 * and tracks sync operations in OfflineSyncQueue.
 */
router.post(
  '/scanner/sync-claims',
  validateRequest({ body: syncClaimsBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      if ((req.authUser?.role !== 'LGU_STAFF' && req.authUser?.role !== 'SUPERADMIN') || !req.authUser?.userId) {
        return res.status(403).json({
          success: false,
          code: 'SCANNER_FORBIDDEN',
          message: 'Only authenticated LGU staff can sync claims.',
        });
      }

      const staffId = req.authUser.userId;
      const { deviceId, distributionId, claims } = req.body;

      const distribution = await Distribution.findById(distributionId)
        .select('_id barangay assignedBarangays assignedStaffIds requiresBeneficiaryApproval status archivedAt')
        .lean();

      if (!distribution || distribution.archivedAt) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      const isAssigned = (distribution.assignedStaffIds ?? []).some(
        (id) => id.toString() === staffId
      );
      if (req.authUser.role !== 'SUPERADMIN' && !isAssigned) {
        return res.status(403).json({
          success: false,
          code: 'SCANNER_NOT_ASSIGNED',
          message: 'Your staff account is not assigned to this distribution.',
        });
      }

      const scopedBarangays = await getScopedBarangays(req.authUser);
      const targets = getTargetBarangays(distribution.barangay, distribution.assignedBarangays ?? []);
      const coverage = new Set<string>(targets);

      if (req.authUser.role !== 'SUPERADMIN' && !targets.some((b) => scopedBarangays.includes(b))) {
        return res.status(403).json({
          success: false,
          code: 'SCANNER_OUT_OF_SCOPE',
          message: 'Distribution is out of your assigned barangay scope.',
        });
      }

      const actorRole = (req.authUser.role === 'SUPERADMIN' ? 'SUPERADMIN' : 'LGU_STAFF') as 'SUPERADMIN' | 'LGU_STAFF';
      const staffName = req.authUser.sub || req.authUser.userId || 'Mobile Scanner';
      const distributionSite = `${distribution.barangay} Barangay Hall`;
      const results: Array<{
        clientGeneratedId: string;
        syncStatus: 'Synced' | 'Duplicate' | 'Failed';
        claimId?: string;
        residentId: string;
        residentCode?: string;
        error?: string;
      }> = [];

      for (const item of claims as Array<{
        clientGeneratedId: string;
        residentId: string;
        residentCode?: string;
        scannedAt: string;
      }>) {
        await upsertOfflineSyncLog({
          actorId: staffId,
          actorRole,
          queueType: 'CLAIM',
          clientGeneratedId: item.clientGeneratedId,
          deviceId,
          residentId: item.residentId,
          distributionId: distribution._id.toString(),
          payload: {
            ...item,
            distributionId: distribution._id.toString(),
          },
          syncStatus: 'Processing',
        });

        try {
          const resident = await Resident.findById(item.residentId)
            .select('_id residentCode fullName barangay status')
            .lean();

          if (!resident || resident.status !== 'Approved') {
            const err = 'Approved resident not found';
            await upsertOfflineSyncLog({
              actorId: staffId,
              actorRole,
              queueType: 'CLAIM',
              clientGeneratedId: item.clientGeneratedId,
              deviceId,
              residentId: item.residentId,
              distributionId: distribution._id.toString(),
              payload: { ...item, distributionId: distribution._id.toString() },
              syncStatus: 'Failed',
              errorMessage: err,
            });
            results.push({
              clientGeneratedId: item.clientGeneratedId,
              syncStatus: 'Failed',
              residentId: item.residentId,
              error: err,
            });
            continue;
          }

          if (!coverage.has(resident.barangay)) {
            const err = 'Resident barangay is not covered by this distribution';
            await upsertOfflineSyncLog({
              actorId: staffId,
              actorRole,
              queueType: 'CLAIM',
              clientGeneratedId: item.clientGeneratedId,
              deviceId,
              residentId: item.residentId,
              distributionId: distribution._id.toString(),
              payload: { ...item, distributionId: distribution._id.toString() },
              syncStatus: 'Failed',
              errorMessage: err,
            });
            results.push({
              clientGeneratedId: item.clientGeneratedId,
              syncStatus: 'Failed',
              residentId: item.residentId,
              error: err,
            });
            continue;
          }

          if (requiresBeneficiaryApproval(distribution as any)) {
            const isApprovedBeneficiary = await isResidentApprovedBeneficiaryForDistribution(
              distribution._id.toString(),
              resident._id.toString()
            );
            if (!isApprovedBeneficiary) {
              const err = 'Resident is not an approved target beneficiary for this distribution';
              await upsertOfflineSyncLog({
                actorId: staffId,
                actorRole,
                queueType: 'CLAIM',
                clientGeneratedId: item.clientGeneratedId,
                deviceId,
                residentId: item.residentId,
                distributionId: distribution._id.toString(),
                payload: { ...item, distributionId: distribution._id.toString() },
                syncStatus: 'Failed',
                errorMessage: err,
              });
              results.push({
                clientGeneratedId: item.clientGeneratedId,
                syncStatus: 'Failed',
                residentId: item.residentId,
                error: err,
              });
              continue;
            }
          }

          // Check if already claimed
          const householdId = resident._id.toString();
          const existingClaim = await Claim.findOne({
            claimCategory: 'DISTRIBUTION',
            householdId,
            distributionId: distribution._id.toString(),
          }).lean();

          if (existingClaim) {
            await upsertOfflineSyncLog({
              actorId: staffId,
              actorRole,
              queueType: 'CLAIM',
              clientGeneratedId: item.clientGeneratedId,
              deviceId,
              residentId: householdId,
              distributionId: distribution._id.toString(),
              claimMongoId: existingClaim._id?.toString(),
              claimId: existingClaim.claimId,
              payload: { ...item, distributionId: distribution._id.toString() },
              syncStatus: 'Synced',
              errorMessage: '',
            });

            results.push({
              clientGeneratedId: item.clientGeneratedId,
              syncStatus: 'Duplicate',
              claimId: existingClaim.claimId,
              residentId: householdId,
              residentCode: resident.residentCode,
            });
            continue;
          }

          const householdCode =
            String(resident.residentCode || '').trim() ||
            `HH-${resident.barangay.slice(0, 2).toUpperCase()}-${resident._id.toString().slice(-4).toUpperCase()}`;

          const claimId = `CLM-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
          const scannedAtDate = new Date(item.scannedAt);
          const validScannedAt = Number.isNaN(scannedAtDate.getTime()) ? new Date() : scannedAtDate;

          const upsertResult = await Claim.updateOne(
            { householdId, distributionId: distribution._id.toString(), claimCategory: 'DISTRIBUTION' },
            {
              $setOnInsert: {
                claimId,
                householdId,
                residentId: householdId,
                householdCode,
                barangay: resident.barangay,
                distributionId: distribution._id.toString(),
                distributionSite,
                staffUserId: staffId,
                staffName,
                claimCategory: 'DISTRIBUTION',
                claimStatus: 'Claimed',
                scannedBy: staffId,
                scannedAt: validScannedAt,
                source: 'OFFLINE_SYNC',
                syncMetadata: {
                  deviceId,
                  clientGeneratedId: item.clientGeneratedId,
                  offlineCapturedAt: validScannedAt,
                },
                status: 'CONFIRMED',
                errorMessage: '',
              },
            },
            { upsert: true, setDefaultsOnInsert: true }
          );

          const claim = await Claim.findOne({
            householdId,
            distributionId: distribution._id.toString(),
            claimCategory: 'DISTRIBUTION',
          });

          if (claim) {
            claim.status = 'CONFIRMED';
            claim.errorMessage = '';
            await claim.save();
            await upsertDistributionClaimFromClaim(claim);
          }

          await upsertOfflineSyncLog({
            actorId: staffId,
            actorRole,
            queueType: 'CLAIM',
            clientGeneratedId: item.clientGeneratedId,
            deviceId,
            residentId: householdId,
            distributionId: distribution._id.toString(),
            claimMongoId: claim?._id?.toString(),
            claimId: claim?.claimId || claimId,
            payload: { ...item, distributionId: distribution._id.toString() },
            syncStatus: 'Synced',
          });

          await logAudit(req as unknown as any, 'OFFLINE_SYNC_RECEIVED', 'OfflineSyncQueue', item.clientGeneratedId, {
            queueType: 'CLAIM',
            distributionId: distribution._id.toString(),
            claimId: claim?.claimId || claimId,
          });

          results.push({
            clientGeneratedId: item.clientGeneratedId,
            syncStatus: upsertResult.upsertedCount === 1 ? 'Synced' : 'Duplicate',
            claimId: claim?.claimId || claimId,
            residentId: householdId,
            residentCode: resident.residentCode,
          });
        } catch (innerErr: any) {
          const errMsg = innerErr?.message || 'Failed to process claim';
          await upsertOfflineSyncLog({
            actorId: staffId,
            actorRole,
            queueType: 'CLAIM',
            clientGeneratedId: item.clientGeneratedId,
            deviceId,
            residentId: item.residentId,
            distributionId: distribution._id.toString(),
            payload: { ...item, distributionId: distribution._id.toString() },
            syncStatus: 'Failed',
            errorMessage: errMsg,
          });
          results.push({
            clientGeneratedId: item.clientGeneratedId,
            syncStatus: 'Failed',
            residentId: item.residentId,
            error: errMsg,
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
      console.error('[SCANNER_SYNC_CLAIMS]', error);
      return res.status(500).json({ success: false, message: 'Unable to sync offline claims.' });
    }
  }
);

/**
 * PATCH /api/distributions/:id/reschedule
 *
 * Reschedule an active distribution to a new date/time with an optional delay reason.
 * Superadmin only.
 */
router.patch(
  '/:id/reschedule',
  requireSuperadmin,
  validateRequest({ params: distributionIdParams, body: rescheduleDistributionBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { scheduled, reason } = req.body;

      const distribution = await Distribution.findById(id);

      if (!distribution) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      if (distribution.status === 'Claimed') {
        return res.status(400).json({
          success: false,
          message: 'Cannot reschedule a completed distribution',
        });
      }

      // Check same-day staff schedule conflicts for assigned staff on the new date
      const targetDate = new Date(scheduled);
      if (!isNaN(targetDate.getTime())) {
        const targetYMD = targetDate.toISOString().slice(0, 10);
        const allDists = await Distribution.find({}).lean();
        const otherActiveDists = allDists.filter(
          (d) => d.status !== 'Claimed' && d._id.toString() !== distribution._id.toString(),
        );

        for (const dist of otherActiveDists) {
          if (!dist.scheduled) continue;
          const distDate = new Date(dist.scheduled);
          if (isNaN(distDate.getTime())) continue;
          const distYMD = distDate.toISOString().slice(0, 10);
          if (distYMD === targetYMD) {
            const otherStaffSet = new Set((dist.assignedStaffIds || []).map((id) => id.toString()));
            const conflictingIds = (distribution.assignedStaffIds || [])
              .map((id) => id.toString())
              .filter((id) => otherStaffSet.has(id));

            if (conflictingIds.length > 0) {
              const conflictStaffDocs = await StaffUser.find({ _id: { $in: conflictingIds } })
                .setOptions({ sanitizeFilter: false })
                .select('firstName lastName')
                .lean();
              const names = conflictStaffDocs
                .map((doc: any) => `${doc.firstName || ''} ${doc.lastName || ''}`.trim() || 'Staff')
                .join(', ');
              return res.status(409).json({
                success: false,
                code: 'STAFF_SCHEDULE_CONFLICT',
                message: `Assigned staff (${names}) is already assigned to a distribution for Barangay ${dist.barangay} on this day.`,
                conflictingStaffIds: conflictingIds,
              });
            }
          }
        }
      }

      const previousScheduled = distribution.scheduled;
      distribution.scheduled = scheduled;

      if (reason && reason.trim()) {
        const timestamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const rescheduleNote = `[Rescheduled on ${timestamp}]: ${reason.trim()}`;
        distribution.notes = distribution.notes
          ? `${distribution.notes}\n${rescheduleNote}`
          : rescheduleNote;
      }

      await distribution.save();

      await logAudit(req, 'DISTRIBUTION_RESCHEDULED', 'Distribution', distribution._id.toString(), {
        barangay: distribution.barangay,
        previousScheduled,
        newScheduled: scheduled,
        reason: reason?.trim() || null,
      });

      return res.json({
        success: true,
        message: 'Distribution rescheduled successfully',
        data: { ...distribution.toJSON(), lifecycleStatus: deriveDistributionLifecycle(distribution) },
      });
    } catch (error: unknown) {
      console.error('Error rescheduling distribution:', error);
      const message = error instanceof Error ? error.message : 'Failed to reschedule distribution';
      return res.status(500).json({ success: false, message });
    }
  },
);

/**
 * PATCH /api/distributions/:id/staff
 *
 * Update assigned staff members for an upcoming or active distribution.
 * RBAC: SUPERADMIN only.
 */
router.patch(
  '/:id/staff',
  requireSuperadmin,
  validateRequest({ params: distributionIdParams, body: updateDistributionStaffBody }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { assignedStaffIds } = req.body as { assignedStaffIds: string[] };

      const distribution = await Distribution.findById(id);
      if (!distribution) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      // Lifecycle status check: cannot edit completed or archived distributions
      if (distribution.status === 'Claimed') {
        return res.status(400).json({
          success: false,
          code: 'DISTRIBUTION_COMPLETED',
          message: 'Cannot modify assigned staff on a completed distribution',
        });
      }
      if (distribution.archivedAt) {
        return res.status(400).json({
          success: false,
          code: 'DISTRIBUTION_ARCHIVED',
          message: 'Cannot modify assigned staff on an archived distribution',
        });
      }

      const coverageScope = normalizeScope([distribution.barangay, ...(distribution.assignedBarangays ?? [])]);
      const uniqueStaffIds: string[] = [...new Set((assignedStaffIds || []).map((sId) => String(sId)))];

      const activeStaffDocs = await StaffUser.find({ isActive: true })
        .select('_id role assignedBarangays firstName lastName')
        .lean();

      const requestedIdSet = new Set(uniqueStaffIds);
      const staffDocs = activeStaffDocs.filter((doc) => requestedIdSet.has(doc._id.toString()));

      const foundIds = new Set(staffDocs.map((doc) => doc._id.toString()));
      const missingStaffIds = uniqueStaffIds.filter((staffId) => !foundIds.has(staffId));
      if (missingStaffIds.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'STAFF_NOT_FOUND',
          message: 'One or more selected staff members were not found or are inactive',
          missingStaffIds,
        });
      }

      const invalidRole = staffDocs.find((doc) => !['LGU_STAFF'].includes(doc.role));
      if (invalidRole) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ASSIGNED_STAFF',
          message: 'Only active LGU staff can be assigned to a distribution',
        });
      }

      const outOfScopeAssignees = staffDocs
        .filter((doc) => !hasAnyCoverage(doc.assignedBarangays ?? [], coverageScope))
        .map((doc) => doc._id.toString());

      if (outOfScopeAssignees.length > 0) {
        return res.status(403).json({
          success: false,
          code: 'OUT_OF_SCOPE_STAFF',
          message: 'One or more selected staff members are not assigned to any covered barangay for this distribution',
          outOfScopeStaffIds: outOfScopeAssignees,
        });
      }

      // Check same-day schedule conflicts for newly added staff
      const currentStaffSet = new Set((distribution.assignedStaffIds || []).map((sId) => sId.toString()));
      const newlyAddedStaffIds = uniqueStaffIds.filter((sId) => !currentStaffSet.has(sId));

      if (newlyAddedStaffIds.length > 0 && distribution.scheduled) {
        const targetDate = new Date(distribution.scheduled);
        if (!isNaN(targetDate.getTime())) {
          const targetYMD = targetDate.toISOString().slice(0, 10);
          const allDists = await Distribution.find({}).lean();
          const otherActiveDists = allDists.filter(
            (d) => d.status !== 'Claimed' && d._id.toString() !== distribution._id.toString(),
          );

          for (const dist of otherActiveDists) {
            if (!dist.scheduled) continue;
            const distDate = new Date(dist.scheduled);
            if (isNaN(distDate.getTime())) continue;
            const distYMD = distDate.toISOString().slice(0, 10);
            if (distYMD === targetYMD) {
              const otherStaffSet = new Set((dist.assignedStaffIds || []).map((sId) => sId.toString()));
              const conflictingIds = newlyAddedStaffIds.filter((sId) => otherStaffSet.has(sId));

              if (conflictingIds.length > 0) {
                const conflictStaffDocs = await StaffUser.find({ _id: { $in: conflictingIds } })
                  .setOptions({ sanitizeFilter: false })
                  .select('firstName lastName')
                  .lean();
                const names = conflictStaffDocs
                  .map((doc: any) => `${doc.firstName || ''} ${doc.lastName || ''}`.trim() || 'Staff')
                  .join(', ');
                return res.status(409).json({
                  success: false,
                  code: 'STAFF_SCHEDULE_CONFLICT',
                  message: `Staff member (${names}) is already assigned to another distribution for Barangay ${dist.barangay} on this day.`,
                  conflictingStaffIds: conflictingIds,
                });
              }
            }
          }
        }
      }

      const previousStaffIds = (distribution.assignedStaffIds || []).map((sId) => sId.toString());
      distribution.assignedStaffIds = uniqueStaffIds.map((sId) => new mongoose.Types.ObjectId(sId));
      await distribution.save();

      await logAudit(req, 'DISTRIBUTION_STAFF_UPDATED', 'Distribution', distribution._id.toString(), {
        barangay: distribution.barangay,
        previousStaffIds,
        newStaffIds: uniqueStaffIds,
        addedStaffIds: newlyAddedStaffIds,
        removedStaffIds: previousStaffIds.filter((sId) => !uniqueStaffIds.includes(sId)),
      });

      return res.json({
        success: true,
        message: 'Assigned staff updated successfully',
        data: {
          ...distribution.toJSON(),
          id: distribution._id.toString(),
          lifecycleStatus: deriveDistributionLifecycle(distribution),
        },
      });
    } catch (error: unknown) {
      console.error('Error updating distribution staff:', error);
      const message = error instanceof Error ? error.message : 'Failed to update assigned staff';
      return res.status(500).json({ success: false, message });
    }
  },
);

/**
 * PATCH /api/distributions/:id/claim
 *
 * Mark a distribution as claimed. Staff can only claim within scope.
 */
router.patch(
  '/:id/claim',
  validateRequest({ params: distributionIdParams }),
  async (req: AuthRequest, res: Response) => {
    try {
      const scopedBarangays = await getScopedBarangays(req.authUser);
      const { id } = req.params;

      const distribution = await Distribution.findById(id);

      if (!distribution) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      // Scope check
      if (
        isScopedRole(req.authUser?.role) && !hasDistributionAccess(scopedBarangays, distribution)
      ) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this distribution',
        });
      }

      if (distribution.status === 'Claimed') {
        return res.status(400).json({
          success: false,
          message: 'Distribution is already claimed',
        });
      }

      if (typeof distribution.households !== 'number' || Number.isNaN(distribution.households)) {
        const approvedCount = await Resident.countDocuments({
          barangay: distribution.barangay,
          status: 'Approved',
        });
        distribution.households = approvedCount;
      }

      distribution.status = 'Claimed';
      distribution.claimedAt = new Date();
      await distribution.save();

      await logAudit(req, 'DISTRIBUTION_CLAIMED', 'Distribution', distribution._id.toString(), {
        barangay: distribution.barangay,
      });

      res.json({
        success: true,
        message: 'Distribution marked as claimed',
        data: { ...distribution.toJSON(), lifecycleStatus: deriveDistributionLifecycle(distribution) },
      });
    } catch (error: unknown) {
      console.error('Error claiming distribution:', error);
      const message = error instanceof Error ? error.message : 'Failed to claim distribution';
      res.status(500).json({ success: false, message });
    }
  }
);

/**
 * PATCH /api/distributions/:id/archive
 *
 * Archive a completed distribution. Superadmin only.
 */
router.patch(
  '/:id/archive',
  requireSuperadmin,
  validateRequest({ params: distributionIdParams }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const distribution = await Distribution.findById(id);

      if (!distribution) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      if (distribution.archivedAt) {
        return res.status(400).json({
          success: false,
          message: 'Distribution is already archived',
        });
      }

      if (typeof distribution.households !== 'number' || Number.isNaN(distribution.households)) {
        const approvedCount = await Resident.countDocuments({
          barangay: distribution.barangay,
          status: 'Approved',
        });
        distribution.households = approvedCount;
      }

      distribution.archivedAt = new Date();
      distribution.archivedBy = req.authUser?.sub || 'SUPERADMIN';
      await distribution.save();

      await logAudit(req, 'DISTRIBUTION_ARCHIVED', 'Distribution', distribution._id.toString(), {
        barangay: distribution.barangay,
        archivedAt: distribution.archivedAt,
        archivedBy: distribution.archivedBy,
      });

      return res.json({
        success: true,
        message: 'Distribution archived successfully',
        data: {
          ...distribution.toJSON(),
          id: distribution._id.toString(),
          lifecycleStatus: deriveDistributionLifecycle(distribution),
        },
      });
    } catch (error: unknown) {
      console.error('Error archiving distribution:', error);
      const message = error instanceof Error ? error.message : 'Failed to archive distribution';
      return res.status(500).json({ success: false, message });
    }
  },
);

/**
 * PATCH /api/distributions/:id/restore
 *
 * Restore an archived distribution. Superadmin only.
 */
router.patch(
  '/:id/restore',
  requireSuperadmin,
  validateRequest({ params: distributionIdParams }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const distribution = await Distribution.findById(id);

      if (!distribution) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      if (!distribution.archivedAt) {
        return res.status(400).json({
          success: false,
          message: 'Distribution is not archived',
        });
      }

      if (typeof distribution.households !== 'number' || Number.isNaN(distribution.households)) {
        const approvedCount = await Resident.countDocuments({
          barangay: distribution.barangay,
          status: 'Approved',
        });
        distribution.households = approvedCount;
      }

      distribution.archivedAt = null;
      distribution.archivedBy = null;
      await distribution.save();

      await logAudit(req, 'DISTRIBUTION_RESTORED', 'Distribution', distribution._id.toString(), {
        barangay: distribution.barangay,
      });

      return res.json({
        success: true,
        message: 'Distribution restored successfully',
        data: {
          ...distribution.toJSON(),
          id: distribution._id.toString(),
          lifecycleStatus: deriveDistributionLifecycle(distribution),
        },
      });
    } catch (error: unknown) {
      console.error('Error restoring distribution:', error);
      const message = error instanceof Error ? error.message : 'Failed to restore distribution';
      return res.status(500).json({ success: false, message });
    }
  },
);

/**
 * GET /api/distributions/:id/households
 *
 * Returns households for the distribution's barangay split into
 * Claimed (for this distribution) and Not Yet Claimed.
 *
 * RBAC:
 * - SUPERADMIN: all
 * - LGU_STAFF: only if distribution.barangay ∈ assignedBarangays
 */
router.get(
  '/:id/households',
  validateRequest({ params: distributionIdParams }),
  async (req: AuthRequest, res: Response) => {
    try {
      const scopedBarangays = await getScopedBarangays(req.authUser);
      const { id } = req.params;

      // 1) Find the distribution
      const distribution = await Distribution.findById(id);
      if (!distribution) {
        return res.status(404).json({
          success: false,
          message: 'Distribution not found',
        });
      }

      // 2) RBAC scope check
      if (
        isScopedRole(req.authUser?.role) && !hasDistributionAccess(scopedBarangays, distribution)
      ) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this distribution',
        });
      }

      const targetBarangays = getTargetBarangays(
        distribution.barangay,
        distribution.assignedBarangays ?? [],
      );

      const eligibleResidentIds = requiresBeneficiaryApproval(distribution)
        ? await getEligibleResidentIdsByDistribution([distribution._id.toString()])
        : new Map<string, string[]>();

      // 3) Get all claimable residents for this distribution.
      const registeredHouseholds = requiresBeneficiaryApproval(distribution)
        ? await Resident.find({
          _id: mongoose.trusted({
            $in: (eligibleResidentIds.get(distribution._id.toString()) ?? [])
              .map((residentId) => new mongoose.Types.ObjectId(residentId)),
          }),
          status: 'Approved',
          qrStatus: 'ACTIVE',
        })
          .select('_id residentCode fullName firstName lastName streetAddress barangay')
          .lean()
        : await Resident.find({
          barangay: mongoose.trusted({ $in: targetBarangays }),
          status: 'Approved',
        })
          .select('_id residentCode fullName firstName lastName streetAddress barangay')
          .lean();

      // 4) If zero registered households, return early
      if (registeredHouseholds.length === 0) {
        return res.json({
          success: true,
          data: {
            distributionId: id,
            barangay: distribution.barangay,
            assignedBarangays: targetBarangays,
            requiresBeneficiaryApproval: requiresBeneficiaryApproval(distribution),
            totals: { registered: 0, claimed: 0, notYetClaimed: 0 },
            claimed: [],
            notYetClaimed: [],
          },
        });
      }

      // 5) Find claims for THIS distribution
      const distLookupIds = [
        new mongoose.Types.ObjectId(distribution._id),
        distribution._id.toString(),
      ];
      const claims = await DistributionClaim.find({
        distributionId: mongoose.trusted({ $in: distLookupIds }),
      }).lean();
      const claimRecords = await Claim.find({
        distributionId: mongoose.trusted({ $in: [id, distribution._id.toString()] }),
        claimCategory: 'DISTRIBUTION',
        status: 'CONFIRMED',
      })
        .select('claimId householdId householdCode barangay staffUserId staffName scannedAt createdAt source')
        .lean();
      const claimRecordByHousehold = new Map(
        claimRecords.map((claim) => [String(claim.householdId), claim]),
      );

      const claimedHouseholdIds = new Set(
        claims.map((c) => c.householdId.toString())
      );

      // 6) Build claimed and notYetClaimed lists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimedList: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const notYetClaimedList: any[] = [];

      for (const hh of registeredHouseholds) {
        const hhId = (hh._id as any).toString();
        const householdName =
          hh.fullName || `${hh.firstName} ${hh.lastName}`;
        const address = hh.streetAddress
          ? `${hh.streetAddress}, ${hh.barangay}`
          : hh.barangay;

        if (claimedHouseholdIds.has(hhId)) {
          const claim = claims.find(
            (c) => c.householdId.toString() === hhId
          );
          const claimRecord = claimRecordByHousehold.get(hhId);
          claimedList.push({
            householdId: hhId,
            householdCode: claimRecord?.householdCode || (hh as any).residentCode || null,
            householdName,
            barangay: hh.barangay,
            address,
            claimId: claimRecord?.claimId || null,
            claimedAt: claim?.claimedAt?.toISOString() ?? claimRecord?.scannedAt?.toISOString() ?? null,
            claimedBy: claim?.claimedBy ?? (claimRecord ? { id: claimRecord.staffUserId, name: claimRecord.staffName } : null),
            scanner: claimRecord ? { id: claimRecord.staffUserId, name: claimRecord.staffName } : claim?.claimedBy ?? null,
            proofMethod: claim?.proofMethod ?? (claimRecord ? 'QR' : null),
            source: claimRecord?.source ?? null,
          });
        } else {
          notYetClaimedList.push({
            householdId: hhId,
            householdCode: (hh as any).residentCode || null,
            householdName,
            barangay: hh.barangay,
            address,
          });
        }
      }

      // 7) Return response
      res.json({
        success: true,
        data: {
          distributionId: id,
          barangay: distribution.barangay,
          assignedBarangays: targetBarangays,
          requiresBeneficiaryApproval: requiresBeneficiaryApproval(distribution),
          totals: {
            registered: registeredHouseholds.length,
            claimed: claimedList.length,
            notYetClaimed: notYetClaimedList.length,
          },
          claimed: claimedList,
          notYetClaimed: notYetClaimedList,
        },
      });
    } catch (error: unknown) {
      console.error('Error fetching distribution households:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to fetch distribution households';
      res.status(500).json({ success: false, message });
    }
  }
);

export default router;
