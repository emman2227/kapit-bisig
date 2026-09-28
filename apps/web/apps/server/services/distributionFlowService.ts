import mongoose from 'mongoose';
import Distribution, { DistributionStatus, IDistribution } from '../models/Distribution';
import DistributionClaim from '../models/DistributionClaim';
import Resident from '../models/Resident';
import BeneficiaryEligibility, { RegistrationSnapshotStatus } from '../models/BeneficiaryEligibility';
import { ProofSubmissionStatus } from '../models/ProofSubmission';
import { isDistributionVisibleToResidents } from '../utils/distributionLifecycle';

type DistributionCoverage = Pick<
  IDistribution,
  '_id' | 'disasterEventId' | 'barangay' | 'assignedBarangays' | 'requiresBeneficiaryApproval'
>;

type EnrollmentSummary = {
  matchedResidents: number;
  enrolledResidents: number;
};

export function getTargetBarangays(
  hostBarangay: string,
  assignedBarangays: string[] = [],
): string[] {
  const cleaned = [hostBarangay, ...assignedBarangays].filter(Boolean);
  return Array.from(new Set(cleaned));
}

export function isResidentEligibleForDistribution(
  residentBarangay: string,
  distribution: Pick<IDistribution, 'barangay' | 'assignedBarangays'>,
): boolean {
  const targetBarangays = getTargetBarangays(distribution.barangay, distribution.assignedBarangays);
  return targetBarangays.includes(residentBarangay);
}

export function requiresBeneficiaryApproval(
  distribution: Pick<IDistribution, 'requiresBeneficiaryApproval'> | { requiresBeneficiaryApproval?: boolean | null },
): boolean {
  return distribution.requiresBeneficiaryApproval === true;
}

export function deriveDistributionStatus(
  registeredHouseholds: number,
  claimedHouseholds: number,
): DistributionStatus {
  if (registeredHouseholds <= 0 || claimedHouseholds <= 0) {
    return 'Unclaimed';
  }
  if (claimedHouseholds >= registeredHouseholds) {
    return 'Claimed';
  }
  return 'Partially Claimed';
}

async function countApprovedResidentsForBarangayCoverage(
  distribution: Pick<IDistribution, 'barangay' | 'assignedBarangays'>,
): Promise<number> {
  const targetBarangays = getTargetBarangays(distribution.barangay, distribution.assignedBarangays);
  return Resident.countDocuments({
    barangay: mongoose.trusted({ $in: targetBarangays }),
    status: 'Approved',
  });
}

export async function getEligibleResidentIdsByDistribution(
  distributionIds: Array<string | mongoose.Types.ObjectId>,
): Promise<Map<string, string[]>> {
  const objectIds = distributionIds
    .map((value) => (value instanceof mongoose.Types.ObjectId ? value : String(value || '').trim()))
    .filter((value): value is string | mongoose.Types.ObjectId => Boolean(value))
    .map((value) =>
      value instanceof mongoose.Types.ObjectId
        ? value
        : (mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null))
    .filter((value): value is mongoose.Types.ObjectId => value instanceof mongoose.Types.ObjectId);

  if (objectIds.length === 0) {
    return new Map();
  }

  const rows = await BeneficiaryEligibility.aggregate([
    {
      $match: {
        distributionId: mongoose.trusted({ $in: objectIds }),
        status: 'Eligible',
        registrationStatus: 'Approved',
        proofStatus: 'Approved',
      },
    },
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
      $match: {
        'resident.status': 'Approved',
        'resident.qrStatus': 'ACTIVE',
      },
    },
    {
      $group: {
        _id: '$distributionId',
        residentIds: { $addToSet: '$residentId' },
      },
    },
  ]) as Array<{
    _id: mongoose.Types.ObjectId;
    residentIds: mongoose.Types.ObjectId[];
  }>;

  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(
      row._id.toString(),
      row.residentIds.map((residentId) => residentId.toString()),
    );
  }

  return map;
}

export async function getEligibleResidentIdsForDistribution(distributionId: string): Promise<string[]> {
  const map = await getEligibleResidentIdsByDistribution([distributionId]);
  return map.get(String(distributionId)) ?? [];
}

export async function isResidentApprovedBeneficiaryForDistribution(
  distributionId: string,
  residentId: string,
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(distributionId) || !mongoose.Types.ObjectId.isValid(residentId)) {
    return false;
  }

  const eligibility = await BeneficiaryEligibility.findOne({
    distributionId: new mongoose.Types.ObjectId(distributionId),
    residentId: new mongoose.Types.ObjectId(residentId),
    status: 'Eligible',
    registrationStatus: 'Approved',
    proofStatus: 'Approved',
  })
    .select('_id')
    .lean();

  if (!eligibility) {
    return false;
  }

  const resident = await Resident.exists({
    _id: new mongoose.Types.ObjectId(residentId),
    status: 'Approved',
    qrStatus: 'ACTIVE',
  });

  return Boolean(resident);
}

/**
 * Copies approved disaster-event eligibility into a distribution-specific
 * enrollment snapshot. The distribution snapshot is what QR validation uses.
 */
export async function enrollApprovedResidentsInDistribution(
  distribution: DistributionCoverage,
): Promise<EnrollmentSummary> {
  if (!distribution.disasterEventId || !requiresBeneficiaryApproval(distribution)) {
    return { matchedResidents: 0, enrolledResidents: 0 };
  }

  const targetBarangays = getTargetBarangays(distribution.barangay, distribution.assignedBarangays);
  const eventEligibilityRows = await BeneficiaryEligibility.find({
    disasterEventId: distribution.disasterEventId,
    distributionId: null,
    status: 'Eligible',
    registrationStatus: 'Approved',
    proofStatus: 'Approved',
  }).lean();

  if (eventEligibilityRows.length === 0) {
    return { matchedResidents: 0, enrolledResidents: 0 };
  }

  const eligibleResidentIds = eventEligibilityRows.map((row) => row.residentId);
  const residents = await Resident.find({
    _id: mongoose.trusted({ $in: eligibleResidentIds }),
    barangay: mongoose.trusted({ $in: targetBarangays }),
    status: 'Approved',
    qrStatus: 'ACTIVE',
  }).select('_id').lean();
  const allowedIds = new Set(residents.map((resident) => resident._id.toString()));
  const matchingRows = eventEligibilityRows.filter((row) => allowedIds.has(row.residentId.toString()));

  if (matchingRows.length === 0) {
    return { matchedResidents: 0, enrolledResidents: 0 };
  }

  const result = await BeneficiaryEligibility.bulkWrite(
    matchingRows.map((row) => ({
      updateOne: {
        filter: { residentId: row.residentId, distributionId: distribution._id },
        update: {
          $set: {
            disasterEventId: null,
            distributionId: distribution._id,
            proofSubmissionId: row.proofSubmissionId || null,
            status: 'Eligible',
            registrationStatus: 'Approved',
            proofStatus: 'Approved',
            rejectionReason: '',
            reviewedBy: row.reviewedBy || '',
            reviewedAt: row.reviewedAt || null,
            lastQualifiedAt: row.lastQualifiedAt || row.reviewedAt || new Date(),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return {
    matchedResidents: matchingRows.length,
    enrolledResidents: result.upsertedCount + result.modifiedCount,
  };
}

/**
 * Runs after proof review so approval is reflected in every open matching
 * distribution, including distributions created before the proof was reviewed.
 */
export async function syncResidentEnrollmentsForEvent(params: {
  residentId: mongoose.Types.ObjectId;
  disasterEventId: mongoose.Types.ObjectId;
  proofSubmissionId: mongoose.Types.ObjectId;
  registrationStatus: RegistrationSnapshotStatus;
  proofStatus: ProofSubmissionStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: Date | null;
}): Promise<number> {
  const resident = await Resident.findById(params.residentId)
    .select('_id barangay status qrStatus')
    .lean();
  if (!resident) return 0;

  const candidates = await Distribution.find({
    disasterEventId: params.disasterEventId,
    status: mongoose.trusted({ $ne: 'Claimed' }),
    requiresBeneficiaryApproval: true,
    archivedAt: null,
    endsAt: mongoose.trusted({ $gte: new Date() }),
  });
  const matching = candidates.filter((distribution) =>
    isDistributionVisibleToResidents(distribution)
    && isResidentEligibleForDistribution(String(resident.barangay || ''), distribution));
  if (matching.length === 0) return 0;

  const eligible = params.registrationStatus === 'Approved'
    && params.proofStatus === 'Approved'
    && resident.status === 'Approved'
    && resident.qrStatus === 'ACTIVE';

  const result = await BeneficiaryEligibility.bulkWrite(
    matching.map((distribution) => ({
      updateOne: {
        filter: { residentId: params.residentId, distributionId: distribution._id },
        update: {
          $set: {
            disasterEventId: null,
            distributionId: distribution._id,
            proofSubmissionId: params.proofSubmissionId,
            status: eligible ? 'Eligible' : 'Not Eligible',
            registrationStatus: params.registrationStatus,
            proofStatus: params.proofStatus,
            rejectionReason: params.rejectionReason || '',
            reviewedBy: params.reviewedBy || '',
            reviewedAt: params.reviewedAt || null,
            lastQualifiedAt: eligible ? params.reviewedAt || new Date() : null,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  await Promise.all(matching.map((distribution) => syncDistributionStatus(distribution._id.toString())));
  return result.upsertedCount + result.modifiedCount;
}

export async function countRegisteredHouseholdsForDistribution(
  distribution: DistributionCoverage,
): Promise<number> {
  if (requiresBeneficiaryApproval(distribution)) {
    const eligibleResidentIds = await getEligibleResidentIdsForDistribution(String(distribution._id));
    return eligibleResidentIds.length;
  }

  return countApprovedResidentsForBarangayCoverage(distribution);
}

export async function syncDistributionStatus(distributionId: string): Promise<{
  status: DistributionStatus;
  registeredHouseholds: number;
  claimedHouseholds: number;
}> {
  if (!mongoose.Types.ObjectId.isValid(distributionId)) {
    throw new Error('Invalid distribution id');
  }

  const distribution = await Distribution.findById(distributionId);
  if (!distribution) {
    throw new Error('Distribution not found');
  }

  const [registeredHouseholds, claimedHouseholds] = await Promise.all([
    countRegisteredHouseholdsForDistribution(distribution),
    DistributionClaim.countDocuments({ distributionId: distribution._id }),
  ]);

  const nextStatus = deriveDistributionStatus(registeredHouseholds, claimedHouseholds);
  distribution.households = registeredHouseholds;
  distribution.status = nextStatus;
  distribution.claimedAt = nextStatus === 'Claimed' ? new Date() : null;
  await distribution.save();

  return {
    status: nextStatus,
    registeredHouseholds,
    claimedHouseholds,
  };
}

export async function upsertDistributionClaimFromClaim(claim: any): Promise<void> {
  if (!claim?.residentId || !claim?.distributionId) return;

  await DistributionClaim.findOneAndUpdate(
    { distributionId: claim.distributionId, householdId: claim.residentId },
    {
      distributionId: claim.distributionId,
      householdId: claim.residentId,
      claimedAt: claim.createdAt || new Date(),
      claimedBy: { id: claim.staffUserId, name: claim.staffName },
      proofMethod: 'QR',
    },
    { upsert: true, new: true },
  );

  await syncDistributionStatus(String(claim.distributionId));
}
