import crypto from 'crypto';
import mongoose from 'mongoose';
import DisasterEvent, { IDisasterEvent } from '../models/DisasterEvent';
import Distribution, { IDistribution } from '../models/Distribution';
import Resident from '../models/Resident';
import ProofSubmission, { IProofSubmission, ProofSubmissionSource, ProofSubmissionStatus } from '../models/ProofSubmission';
import BeneficiaryEligibility, { EligibilityStatus, IBeneficiaryEligibility } from '../models/BeneficiaryEligibility';
import Claim, { IClaim } from '../models/Claim';
import OfflineSyncQueue, { IOfflineSyncQueue, OfflineActorRole, OfflineSyncQueueType, OfflineSyncStatus } from '../models/OfflineSyncQueue';
import { persistVerificationImage, VERIFICATION_IMAGE_MAX_BYTES } from '../utils/imageStorage';
import { createResidentNotification } from '../utils/createNotification';
import {
  BeneficiaryReviewSmsDeliverySummary,
  sendBeneficiaryReviewSms,
} from '../utils/beneficiaryReviewSms';
import type { PushDeliverySummary } from '../utils/distributionPush';
import { sendResidentPushNotification } from '../utils/residentPush';
import { validateBase64Image } from '../validation/imageValidation';
import {
  getTargetBarangays,
  isResidentEligibleForDistribution,
  requiresBeneficiaryApproval,
  syncResidentEnrollmentsForEvent,
} from './distributionFlowService';
import {
  buildResidentQrToken as buildSignedResidentQrToken,
  parseResidentQrToken,
} from './residentQrService';
import { deriveDistributionLifecycle } from '../utils/distributionLifecycle';
import { formatResidentFullName } from '../utils/residentName';

type ResidentApprovalStatus = 'Pending' | 'Approved' | 'Needs Revision' | 'Rejected';

type ResidentScanRecord = {
  _id: mongoose.Types.ObjectId;
  residentCode: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  mobileNumber?: string;
  barangay: string;
  city?: string;
  status: ResidentApprovalStatus;
  qrStatus: 'ACTIVE' | 'REVOKED';
};

export type QrValidationOutcome =
  | 'VALID'
  | 'ALREADY_CLAIMED'
  | 'NOT_ELIGIBLE'
  | 'INVALID_QR';

export type ClaimFlowStatus = 'Not Claimed' | 'Claimed';

export interface BeneficiaryActor {
  userId: string;
  displayName: string;
  role: string;
  assignedBarangays?: string[];
}

export interface ProofSubmissionInput {
  residentId: string;
  distributionId?: string;
  disasterEventId?: string;
  damageType: IProofSubmission['damageType'];
  description: string;
  supportingInfo?: string;
  dateSubmitted: Date;
  photoProofs: string[];
  syncSource: ProofSubmissionSource;
  clientGeneratedId?: string;
  deviceId?: string;
}

export interface ProofReviewInput {
  proofSubmissionId: string;
  decision: 'Approved' | 'Rejected';
  rejectionReason?: string;
  reviewerId: string;
}

export interface BeneficiaryScopeSummary {
  id: string;
  type: 'DISTRIBUTION' | 'DISASTER_EVENT';
  name: string;
  status: string;
  barangays: string[];
  scheduled?: string;
  disasterType?: string;
}

export interface QrValidationResult {
  outcome: QrValidationOutcome;
  resultLabel: 'Valid - eligible to claim' | 'Already claimed' | 'Not eligible for this event' | 'Invalid QR';
  claimStatus: ClaimFlowStatus;
  event: {
    id: string;
    name: string;
    status: string;
  };
  resident?: {
    id: string;
    residentCode: string;
    fullName: string;
    barangay: string;
  };
  claimId?: string;
}

export interface DisasterEventClaimInput {
  disasterEventId?: string;
  qrData?: string;
  residentId?: string;
  scannedAt?: Date;
  source?: 'ONLINE' | 'OFFLINE_SYNC';
  clientGeneratedId?: string;
  deviceId?: string;
  actor: BeneficiaryActor;
}

type ResolvedBeneficiaryScope = {
  scope: BeneficiaryScopeSummary;
  event: IDisasterEvent | null;
  distribution: IDistribution | null;
};

const BENEFICIARY_PROOF_MIN_WIDTH = 160;
const BENEFICIARY_PROOF_MIN_HEIGHT = 160;
const BENEFICIARY_PROOF_MAX_WIDTH = 4096;
const BENEFICIARY_PROOF_MAX_HEIGHT = 4096;
const BENEFICIARY_PROOF_TOTAL_MAX_BYTES = VERIFICATION_IMAGE_MAX_BYTES * 5;

export class BeneficiaryServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function generateClaimId(): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomInt(0, 99999).toString().padStart(5, '0');
  return `CLM-${year}-${rand}`;
}

function getResidentDisplayName(input: { firstName?: string; lastName?: string; fullName?: string }): string {
  return formatResidentFullName(input);
}

export function deriveEligibilityStatus(
  registrationStatus: ResidentApprovalStatus,
  proofStatus: ProofSubmissionStatus,
): EligibilityStatus {
  return registrationStatus === 'Approved' && proofStatus === 'Approved'
    ? 'Eligible'
    : 'Not Eligible';
}

export function buildResidentQrToken(residentCode: string): string {
  return buildSignedResidentQrToken(residentCode);
}

export function parseResidentCodeFromQrData(qrData: string): string | null {
  return parseResidentQrToken(qrData)?.residentCode || null;
}

function getBase64PayloadBytes(value: string): number {
  const raw = String(value || '').trim();
  const marker = 'base64,';
  const markerIndex = raw.indexOf(marker);
  const payload = markerIndex >= 0 ? raw.slice(markerIndex + marker.length) : raw;
  return Buffer.from(payload, 'base64').length;
}

async function validateProofPhotoSet(photoProofs: string[]): Promise<void> {
  const validations = await Promise.all(
    photoProofs.map((photoProof, index) =>
      validateBase64Image(photoProof, {
        fieldName: `Proof photo ${index + 1}`,
        maxBytes: VERIFICATION_IMAGE_MAX_BYTES,
        minWidth: BENEFICIARY_PROOF_MIN_WIDTH,
        minHeight: BENEFICIARY_PROOF_MIN_HEIGHT,
        maxWidth: BENEFICIARY_PROOF_MAX_WIDTH,
        maxHeight: BENEFICIARY_PROOF_MAX_HEIGHT,
      }),
    ),
  );

  const failedValidation = validations.find((validation) => !validation.ok);
  if (failedValidation && !failedValidation.ok) {
    throw new BeneficiaryServiceError(400, 'INVALID_PROOF_IMAGE', failedValidation.message);
  }

  const totalBytes = photoProofs.reduce((sum, photoProof) => sum + getBase64PayloadBytes(photoProof), 0);
  if (totalBytes > BENEFICIARY_PROOF_TOTAL_MAX_BYTES) {
    throw new BeneficiaryServiceError(
      400,
      'PROOF_IMAGE_TOTAL_TOO_LARGE',
      `Combined proof image size exceeds the maximum upload size of ${Math.floor(BENEFICIARY_PROOF_TOTAL_MAX_BYTES / (1024 * 1024))}MB.`,
    );
  }
}

async function resolveDisasterEvent(disasterEventId?: string): Promise<IDisasterEvent> {
  if (disasterEventId) {
    if (!mongoose.Types.ObjectId.isValid(disasterEventId)) {
      throw new BeneficiaryServiceError(400, 'INVALID_EVENT_ID', 'Invalid disaster event id.');
    }

    const event = await DisasterEvent.findById(disasterEventId);
    if (!event) {
      throw new BeneficiaryServiceError(404, 'EVENT_NOT_FOUND', 'Disaster event not found.');
    }
    return event;
  }

  const event = await DisasterEvent.findOne({ status: 'Active' }).sort({ eventDate: -1, createdAt: -1 });
  if (!event) {
    throw new BeneficiaryServiceError(404, 'ACTIVE_EVENT_NOT_FOUND', 'No active disaster event found.');
  }

  return event;
}

function buildEventScopeSummary(event: IDisasterEvent): BeneficiaryScopeSummary {
  return {
    id: event._id.toString(),
    type: 'DISASTER_EVENT',
    name: event.name,
    status: event.status,
    barangays: event.barangays,
    disasterType: event.disasterType,
  };
}

function buildDistributionScopeSummary(distribution: IDistribution): BeneficiaryScopeSummary {
  const scheduledAt = new Date(distribution.scheduled);
  const scheduleLabel = Number.isNaN(scheduledAt.getTime())
    ? distribution.scheduled
    : scheduledAt.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  const barangays = getTargetBarangays(distribution.barangay, distribution.assignedBarangays);

  return {
    id: distribution._id.toString(),
    type: 'DISTRIBUTION',
    name: `${distribution.barangay} Distribution - ${scheduleLabel}`,
    status: distribution.status === 'Claimed' ? 'Closed' : 'Active',
    barangays,
    scheduled: distribution.scheduled,
    disasterType: 'Distribution',
  };
}

async function resolveBeneficiaryScope(input: {
  distributionId?: string;
  disasterEventId?: string;
}): Promise<ResolvedBeneficiaryScope> {
  if (input.distributionId && input.disasterEventId) {
    throw new BeneficiaryServiceError(
      400,
      'AMBIGUOUS_SCOPE',
      'Provide either distributionId or disasterEventId, not both.',
    );
  }

  if (input.distributionId) {
    if (!mongoose.Types.ObjectId.isValid(input.distributionId)) {
      throw new BeneficiaryServiceError(400, 'INVALID_DISTRIBUTION_ID', 'Invalid distribution id.');
    }

    const distribution = await Distribution.findById(input.distributionId);
    if (!distribution) {
      throw new BeneficiaryServiceError(404, 'DISTRIBUTION_NOT_FOUND', 'Distribution not found.');
    }

    return {
      scope: buildDistributionScopeSummary(distribution),
      event: null,
      distribution,
    };
  }

  const event = await resolveDisasterEvent(input.disasterEventId);
  return {
    scope: buildEventScopeSummary(event),
    event,
    distribution: null,
  };
}

function assertEventAcceptingSubmissions(event: IDisasterEvent): void {
  if (event.status !== 'Active') {
    throw new BeneficiaryServiceError(409, 'EVENT_NOT_ACTIVE', 'Disaster event is not accepting submissions.');
  }

  if (event.submissionDeadline && event.submissionDeadline.getTime() < Date.now()) {
    throw new BeneficiaryServiceError(409, 'SUBMISSION_WINDOW_CLOSED', 'Submission deadline has already passed.');
  }
}

function assertDistributionAcceptingSubmissions(distribution: IDistribution): void {
  if (!requiresBeneficiaryApproval(distribution)) {
    throw new BeneficiaryServiceError(
      409,
      'BENEFICIARY_APPROVAL_NOT_REQUIRED',
      'This distribution does not require a target-beneficiary application.',
    );
  }

  if (distribution.status === 'Claimed' || deriveDistributionLifecycle(distribution) !== 'Upcoming') {
    throw new BeneficiaryServiceError(
      409,
      'DISTRIBUTION_CLOSED',
      'This distribution is not open for beneficiary applications.',
    );
  }
}

function assertEventActiveForClaims(event: IDisasterEvent): void {
  if (event.status !== 'Active') {
    throw new BeneficiaryServiceError(409, 'EVENT_NOT_ACTIVE', 'Disaster event is not active for claims.');
  }
}

function assertScannerScope(actor: BeneficiaryActor, event: IDisasterEvent, residentBarangay?: string): void {
  const scopedRoles = new Set(['Volunteer', 'LGU_STAFF']);
  const scopedBarangays = Array.isArray(actor.assignedBarangays)
    ? actor.assignedBarangays.filter(Boolean)
    : [];

  if (!scopedRoles.has(actor.role) || scopedBarangays.length === 0) {
    return;
  }

  if (residentBarangay && scopedBarangays.includes(residentBarangay)) {
    return;
  }

  if (event.barangays.some((barangay) => scopedBarangays.includes(barangay))) {
    return;
  }

  throw new BeneficiaryServiceError(403, 'SCANNER_OUT_OF_SCOPE', 'Scanner account is out of scope for this event.');
}

async function getResidentForSubmission(residentId: string): Promise<ResidentScanRecord> {
  if (!mongoose.Types.ObjectId.isValid(residentId)) {
    throw new BeneficiaryServiceError(400, 'INVALID_RESIDENT_ID', 'Invalid resident id.');
  }

  const resident = await Resident.findById(residentId)
    .select('_id residentCode firstName lastName fullName barangay city status qrStatus')
    .lean<ResidentScanRecord | null>();

  if (!resident) {
    throw new BeneficiaryServiceError(404, 'RESIDENT_NOT_FOUND', 'Resident not found.');
  }

  return resident;
}

async function getResidentFromClaimInput(input: { residentId?: string; qrData?: string }): Promise<ResidentScanRecord> {
  if (input.residentId) {
    return getResidentForSubmission(input.residentId);
  }

  const residentCode = input.qrData ? parseResidentCodeFromQrData(input.qrData) : null;
  if (!residentCode) {
    throw new BeneficiaryServiceError(400, 'INVALID_QR', 'Invalid QR payload.');
  }

  const resident = await Resident.findOne({ residentCode })
    .select('_id residentCode firstName lastName fullName barangay city status qrStatus')
    .lean<ResidentScanRecord | null>();

  if (!resident) {
    throw new BeneficiaryServiceError(404, 'RESIDENT_NOT_FOUND', 'Resident not found.');
  }

  return resident;
}

async function upsertEligibilitySnapshot(params: {
  residentId: mongoose.Types.ObjectId;
  disasterEventId?: mongoose.Types.ObjectId | null;
  distributionId?: mongoose.Types.ObjectId | null;
  proofSubmissionId: mongoose.Types.ObjectId;
  registrationStatus: ResidentApprovalStatus;
  proofStatus: ProofSubmissionStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: Date | null;
}): Promise<IBeneficiaryEligibility> {
  const scopeQuery = params.distributionId
    ? { distributionId: params.distributionId }
    : params.disasterEventId
      ? { disasterEventId: params.disasterEventId }
      : null;

  if (!scopeQuery) {
    throw new BeneficiaryServiceError(500, 'SCOPE_REQUIRED', 'Eligibility updates require a scope id.');
  }

  const status = deriveEligibilityStatus(params.registrationStatus, params.proofStatus);
  const reviewedAt = params.reviewedAt ?? null;

  const eligibility = await BeneficiaryEligibility.findOneAndUpdate(
    {
      residentId: params.residentId,
      ...scopeQuery,
    },
    {
      $set: {
        disasterEventId: params.disasterEventId || null,
        distributionId: params.distributionId || null,
        proofSubmissionId: params.proofSubmissionId,
        status,
        registrationStatus: params.registrationStatus,
        proofStatus: params.proofStatus,
        rejectionReason: params.rejectionReason || '',
        reviewedBy: params.reviewedBy || '',
        reviewedAt,
        lastQualifiedAt: status === 'Eligible' ? reviewedAt || new Date() : null,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return eligibility;
}

export async function submitResidentProof(params: ProofSubmissionInput): Promise<{
  scope: BeneficiaryScopeSummary;
  event: IDisasterEvent | null;
  distribution: IDistribution | null;
  resident: ResidentScanRecord;
  submission: IProofSubmission;
  eligibility: IBeneficiaryEligibility;
}> {
  const [resolvedScope, resident] = await Promise.all([
    resolveBeneficiaryScope({
      distributionId: params.distributionId,
      disasterEventId: params.disasterEventId,
    }),
    getResidentForSubmission(params.residentId),
  ]);

  if (resident.status !== 'Approved') {
    throw new BeneficiaryServiceError(
      403,
      'REGISTRATION_NOT_APPROVED',
      'Resident registration must be approved before submitting disaster proof.',
    );
  }

  if (resolvedScope.distribution) {
    assertDistributionAcceptingSubmissions(resolvedScope.distribution);
    if (!isResidentEligibleForDistribution(resident.barangay, resolvedScope.distribution)) {
      throw new BeneficiaryServiceError(
        403,
        'RESIDENT_OUT_OF_SCOPE',
        'Resident barangay is not covered by this distribution.',
      );
    }
  } else if (resolvedScope.event) {
    assertEventAcceptingSubmissions(resolvedScope.event);
    if (!resolvedScope.event.barangays.includes(resident.barangay)) {
      throw new BeneficiaryServiceError(
        403,
        'RESIDENT_OUT_OF_SCOPE',
        'Resident barangay is not covered by this disaster event.',
      );
    }
  }

  const normalizedClientGeneratedId = String(params.clientGeneratedId || '').trim();
  const existingFilter: Record<string, unknown> = {
    residentId: resident._id,
  };
  if (resolvedScope.distribution) {
    existingFilter.distributionId = resolvedScope.distribution._id;
  } else if (resolvedScope.event) {
    existingFilter.disasterEventId = resolvedScope.event._id;
  }

  const existing = await ProofSubmission.findOne(existingFilter);

  if (existing && normalizedClientGeneratedId && existing.clientGeneratedId === normalizedClientGeneratedId) {
    const eligibility = await upsertEligibilitySnapshot({
      residentId: resident._id,
      disasterEventId: existing.disasterEventId ?? null,
      distributionId: existing.distributionId ?? null,
      proofSubmissionId: existing._id,
      registrationStatus: resident.status,
      proofStatus: existing.status,
      rejectionReason: existing.rejectionReason,
      reviewedBy: existing.reviewedBy,
      reviewedAt: existing.reviewedAt ?? null,
    });

    return {
      scope: resolvedScope.scope,
      event: resolvedScope.event,
      distribution: resolvedScope.distribution,
      resident,
      submission: existing,
      eligibility,
    };
  }

  if (existing && existing.status === 'Approved') {
    throw new BeneficiaryServiceError(
      409,
      'PROOF_ALREADY_APPROVED',
      'Resident proof for this disaster event has already been approved.',
    );
  }

  await validateProofPhotoSet(params.photoProofs);

  const photoProofUrls = params.photoProofs.map((photoProof, index) =>
    persistVerificationImage(photoProof, `disaster-proof-${index + 1}`),
  );
  const nextVersion = existing ? existing.submissionVersion + 1 : 1;

  const submission = existing || new ProofSubmission({
    residentId: resident._id,
  });

  submission.distributionId = resolvedScope.distribution?._id || null;
  submission.disasterEventId = resolvedScope.event?._id || null;
  submission.damageType = params.damageType;
  submission.description = params.description.trim();
  submission.supportingInfo = String(params.supportingInfo || '').trim();
  submission.dateSubmitted = params.dateSubmitted;
  submission.photoProofUrls = photoProofUrls;
  submission.photoProofUrl = photoProofUrls[0];
  submission.status = 'Pending Verification';
  submission.syncSource = params.syncSource;
  submission.submissionVersion = nextVersion;
  submission.clientGeneratedId = normalizedClientGeneratedId;
  submission.submittedViaDeviceId = String(params.deviceId || '').trim();
  submission.rejectionReason = '';
  submission.reviewedBy = '';
  submission.reviewedAt = undefined;
  await submission.save();

  const eligibility = await upsertEligibilitySnapshot({
    residentId: resident._id,
    disasterEventId: resolvedScope.event?._id || null,
    distributionId: resolvedScope.distribution?._id || null,
    proofSubmissionId: submission._id,
    registrationStatus: resident.status,
    proofStatus: submission.status,
  });

  return {
    scope: resolvedScope.scope,
    event: resolvedScope.event,
    distribution: resolvedScope.distribution,
    resident,
    submission,
    eligibility,
  };
}

export async function reviewResidentProof(params: ProofReviewInput): Promise<{
  scope: BeneficiaryScopeSummary;
  event: IDisasterEvent | null;
  distribution: IDistribution | null;
  resident: ResidentScanRecord;
  submission: IProofSubmission;
  eligibility: IBeneficiaryEligibility;
  notificationDelivery: {
    sms: BeneficiaryReviewSmsDeliverySummary;
    push: PushDeliverySummary;
  };
}> {
  if (!mongoose.Types.ObjectId.isValid(params.proofSubmissionId)) {
    throw new BeneficiaryServiceError(400, 'INVALID_PROOF_ID', 'Invalid proof submission id.');
  }

  const submission = await ProofSubmission.findById(params.proofSubmissionId);
  if (!submission) {
    throw new BeneficiaryServiceError(404, 'PROOF_NOT_FOUND', 'Proof submission not found.');
  }

  const [event, distribution, resident] = await Promise.all([
    submission.disasterEventId ? DisasterEvent.findById(submission.disasterEventId) : Promise.resolve(null),
    submission.distributionId ? Distribution.findById(submission.distributionId) : Promise.resolve(null),
    Resident.findById(submission.residentId)
      .select('_id residentCode firstName lastName fullName mobileNumber barangay city status qrStatus')
      .lean<ResidentScanRecord | null>(),
  ]);

  if (!event && !distribution) {
    throw new BeneficiaryServiceError(404, 'SCOPE_NOT_FOUND', 'Linked distribution or disaster event not found.');
  }
  if (!resident) {
    throw new BeneficiaryServiceError(404, 'RESIDENT_NOT_FOUND', 'Resident not found.');
  }

  const scope = distribution
    ? buildDistributionScopeSummary(distribution)
    : buildEventScopeSummary(event as IDisasterEvent);

  submission.status = params.decision;
  submission.rejectionReason = params.decision === 'Rejected'
    ? String(params.rejectionReason || '').trim()
    : '';
  submission.reviewedBy = params.reviewerId;
  submission.reviewedAt = new Date();
  await submission.save();

  const eligibility = await upsertEligibilitySnapshot({
    residentId: resident._id,
    disasterEventId: event?._id || null,
    distributionId: distribution?._id || null,
    proofSubmissionId: submission._id,
    registrationStatus: resident.status,
    proofStatus: submission.status,
    rejectionReason: submission.rejectionReason,
    reviewedBy: params.reviewerId,
    reviewedAt: submission.reviewedAt,
  });

  if (event) {
    await syncResidentEnrollmentsForEvent({
      residentId: resident._id,
      disasterEventId: event._id,
      proofSubmissionId: submission._id,
      registrationStatus: resident.status,
      proofStatus: submission.status,
      rejectionReason: submission.rejectionReason,
      reviewedBy: params.reviewerId,
      reviewedAt: submission.reviewedAt,
    });
  }

  // One authoritative in-app notification is always created. SMS is
  // best-effort and never rolls back the completed review decision.
  const scopeName = scope.name || 'your disaster proof';
  const approved = params.decision === 'Approved';
  const rejectionDetails = submission.rejectionReason
    ? ` Reason: ${submission.rejectionReason}`
    : ' Please resubmit with updated photos and information.';
  const notificationMessage = approved
    ? `Your disaster proof for ${scopeName} has been approved. You are now eligible for relief distribution.`
    : `Your disaster proof for ${scopeName} was not approved.${rejectionDetails}`;

  await createResidentNotification(resident._id.toString(), {
    title: approved ? 'Proof Approved' : 'Proof Needs Update',
    message: notificationMessage,
    type: 'status_update',
    meta: {
      screen: 'proof-request',
      proofSubmissionId: submission._id.toString(),
      distributionId: distribution?._id?.toString() || '',
      disasterEventId: event?._id?.toString() || '',
      decision: params.decision,
    },
  });

  const [smsDelivery, pushDelivery] = await Promise.all([
    sendBeneficiaryReviewSms({
      mobileNumber: resident.mobileNumber,
      decision: params.decision,
      scopeName,
      rejectionReason: submission.rejectionReason,
      residentName: resident.firstName || resident.fullName || undefined,
    }),
    sendResidentPushNotification({
      residentId: resident._id.toString(),
      title: approved ? 'Proof Approved' : 'Proof Needs Update',
      body: notificationMessage,
      data: {
        screen: 'proof-request',
        proofSubmissionId: submission._id.toString(),
        distributionId: distribution?._id?.toString() || '',
        disasterEventId: event?._id?.toString() || '',
        decision: params.decision,
      },
    }),
  ]);

  return {
    scope,
    event,
    distribution,
    resident,
    submission,
    eligibility,
    notificationDelivery: {
      sms: smsDelivery,
      push: pushDelivery,
    },
  };
}

async function findDisasterEventClaim(residentId: string, disasterEventId: string): Promise<IClaim | null> {
  const claim = await Claim.findOne({
    claimCategory: 'DISASTER_EVENT',
    residentId,
    disasterEventId,
    claimStatus: 'Claimed',
  });
  return claim;
}

function buildValidationResult(args: {
  outcome: QrValidationOutcome;
  event: IDisasterEvent;
  resident?: ResidentScanRecord;
  claimId?: string;
}): QrValidationResult {
  const resultLabelMap: Record<QrValidationOutcome, QrValidationResult['resultLabel']> = {
    VALID: 'Valid - eligible to claim',
    ALREADY_CLAIMED: 'Already claimed',
    NOT_ELIGIBLE: 'Not eligible for this event',
    INVALID_QR: 'Invalid QR',
  };

  return {
    outcome: args.outcome,
    resultLabel: resultLabelMap[args.outcome],
    claimStatus: args.outcome === 'ALREADY_CLAIMED' ? 'Claimed' : 'Not Claimed',
    event: {
      id: args.event._id.toString(),
      name: args.event.name,
      status: args.event.status,
    },
    resident: args.resident
      ? {
          id: args.resident._id.toString(),
          residentCode: args.resident.residentCode,
          fullName: getResidentDisplayName(args.resident),
          barangay: args.resident.barangay,
        }
      : undefined,
    claimId: args.claimId,
  };
}

export async function validateResidentQrForEvent(params: {
  qrData: string;
  disasterEventId?: string;
  actor?: BeneficiaryActor;
}): Promise<QrValidationResult> {
  const event = await resolveDisasterEvent(params.disasterEventId);
  assertEventActiveForClaims(event);

  const residentCode = parseResidentCodeFromQrData(params.qrData);
  if (!residentCode) {
    return buildValidationResult({ outcome: 'INVALID_QR', event });
  }

  const resident = await Resident.findOne({ residentCode })
    .select('_id residentCode firstName lastName fullName barangay city status qrStatus')
    .lean<ResidentScanRecord | null>();

  if (!resident) {
    return buildValidationResult({ outcome: 'INVALID_QR', event });
  }

  if (params.actor) {
    assertScannerScope(params.actor, event, resident.barangay);
  }

  if (resident.status !== 'Approved' || resident.qrStatus === 'REVOKED') {
    return buildValidationResult({ outcome: 'NOT_ELIGIBLE', event, resident });
  }

  const disasterEventId = event._id.toString();
  const existingClaim = await findDisasterEventClaim(resident._id.toString(), disasterEventId);
  if (existingClaim) {
    return buildValidationResult({
      outcome: 'ALREADY_CLAIMED',
      event,
      resident,
      claimId: existingClaim.claimId,
    });
  }

  const eligibility = await BeneficiaryEligibility.findOne({
    residentId: resident._id,
    disasterEventId: event._id,
    status: 'Eligible',
  })
    .select('_id')
    .lean();

  if (!eligibility) {
    return buildValidationResult({ outcome: 'NOT_ELIGIBLE', event, resident });
  }

  return buildValidationResult({ outcome: 'VALID', event, resident });
}

export async function recordDisasterEventClaim(params: DisasterEventClaimInput): Promise<{
  validation: QrValidationResult;
  claim?: IClaim;
}> {
  const event = await resolveDisasterEvent(params.disasterEventId);
  assertEventActiveForClaims(event);

  const resident = await getResidentFromClaimInput({
    residentId: params.residentId,
    qrData: params.qrData,
  });

  assertScannerScope(params.actor, event, resident.barangay);

  if (!params.qrData) {
    const validation = await validateResidentQrForEvent({
      qrData: buildResidentQrToken(resident.residentCode),
      disasterEventId: event._id.toString(),
      actor: params.actor,
    });
    if (validation.outcome !== 'VALID') {
      return { validation };
    }
  } else {
    const validation = await validateResidentQrForEvent({
      qrData: params.qrData,
      disasterEventId: event._id.toString(),
      actor: params.actor,
    });
    if (validation.outcome !== 'VALID') {
      return { validation };
    }
  }

  const claimId = generateClaimId();
  const residentId = resident._id.toString();
  const disasterEventId = event._id.toString();
  const distributionSite = `${event.name} - ${event.barangays.join(', ')}`;
  const scannedAt = params.scannedAt || new Date();

  try {
    const claim = new Claim({
      claimId,
      householdId: residentId,
      residentId,
      householdCode: resident.residentCode,
      barangay: resident.barangay,
      distributionId: disasterEventId,
      distributionSite,
      staffUserId: params.actor.userId,
      staffName: params.actor.displayName,
      claimCategory: 'DISASTER_EVENT',
      claimStatus: 'Claimed',
      disasterEventId,
      scannedBy: params.actor.userId,
      scannedAt,
      source: params.source || 'ONLINE',
      syncMetadata: {
        deviceId: String(params.deviceId || '').trim(),
        clientGeneratedId: String(params.clientGeneratedId || '').trim(),
        offlineCapturedAt: params.source === 'OFFLINE_SYNC' ? scannedAt : null,
        syncedAt: params.source === 'OFFLINE_SYNC' ? new Date() : null,
      },
      status: 'CONFIRMED',

      errorMessage: '',
    });

    await claim.save();

    return {
      validation: buildValidationResult({
        outcome: 'VALID',
        event,
        resident,
      }),
      claim,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) {
      const existingClaim = await findDisasterEventClaim(residentId, disasterEventId);
      return {
        validation: buildValidationResult({
          outcome: 'ALREADY_CLAIMED',
          event,
          resident,
          claimId: existingClaim?.claimId,
        }),
        claim: existingClaim || undefined,
      };
    }
    throw error;
  }
}

export async function buildOfflineBeneficiaryPack(params: {
  disasterEventId: string;
  actor: BeneficiaryActor;
}): Promise<{
  event: {
    id: string;
    name: string;
    disasterType: string;
    barangays: string[];
  };
  downloadedAt: string;
  beneficiaries: Array<{
    residentId: string;
    qrToken: string;
    fullName: string;
    barangay: string;
    eligibilityStatus: EligibilityStatus;
    claimStatus: ClaimFlowStatus;
  }>;
}> {
  const event = await resolveDisasterEvent(params.disasterEventId);
  assertScannerScope(params.actor, event);

  const eligibilities = await BeneficiaryEligibility.find({
    disasterEventId: event._id,
    status: 'Eligible',
  })
    .select('residentId status')
    .lean();

  const residentIds = eligibilities.map((item) => item.residentId);
  if (residentIds.length === 0) {
    return {
      event: {
        id: event._id.toString(),
        name: event.name,
        disasterType: event.disasterType,
        barangays: event.barangays,
      },
      downloadedAt: new Date().toISOString(),
      beneficiaries: [],
    };
  }

  const residents = await Resident.find({
    _id: mongoose.trusted({ $in: residentIds }),
    status: 'Approved',
    qrStatus: 'ACTIVE',
  })
    .select('_id residentCode firstName lastName fullName barangay')
    .lean<ResidentScanRecord[]>();

  const claimedResidents = await Claim.find({
    claimCategory: 'DISASTER_EVENT',
    disasterEventId: event._id.toString(),
    residentId: mongoose.trusted({ $in: residents.map((resident) => resident._id.toString()) }),
    claimStatus: 'Claimed',
  })
    .select('residentId')
    .lean();

  const claimedResidentIds = new Set(
    claimedResidents.map((claim) => String((claim as { residentId?: string }).residentId || '')),
  );

  return {
    event: {
      id: event._id.toString(),
      name: event.name,
      disasterType: event.disasterType,
      barangays: event.barangays,
    },
    downloadedAt: new Date().toISOString(),
    beneficiaries: residents.map((resident) => ({
      residentId: resident._id.toString(),
      qrToken: buildResidentQrToken(resident.residentCode),
      fullName: getResidentDisplayName(resident),
      barangay: resident.barangay,
      eligibilityStatus: 'Eligible',
      claimStatus: claimedResidentIds.has(resident._id.toString()) ? 'Claimed' : 'Not Claimed',
    })),
  };
}

export async function upsertOfflineSyncLog(params: {
  actorId: string;
  actorRole: OfflineActorRole;
  queueType: OfflineSyncQueueType;
  clientGeneratedId: string;
  deviceId?: string;
  residentId?: string;
  disasterEventId?: string;
  distributionId?: string;
  payload: Record<string, unknown>;
  syncStatus: OfflineSyncStatus;
  errorMessage?: string;
  errorCode?: string;
  retryable?: boolean;
  proofSubmissionId?: string;
  claimMongoId?: string;
  claimId?: string;
}): Promise<IOfflineSyncQueue> {
  const residentObjectId = params.residentId && mongoose.Types.ObjectId.isValid(params.residentId)
    ? new mongoose.Types.ObjectId(params.residentId)
    : null;
  const disasterEventObjectId = params.disasterEventId && mongoose.Types.ObjectId.isValid(params.disasterEventId)
    ? new mongoose.Types.ObjectId(params.disasterEventId)
    : null;
  const distributionObjectId = params.distributionId && mongoose.Types.ObjectId.isValid(params.distributionId)
    ? new mongoose.Types.ObjectId(params.distributionId)
    : null;
  const proofSubmissionObjectId = params.proofSubmissionId && mongoose.Types.ObjectId.isValid(params.proofSubmissionId)
    ? new mongoose.Types.ObjectId(params.proofSubmissionId)
    : null;
  const claimMongoObjectId = params.claimMongoId && mongoose.Types.ObjectId.isValid(params.claimMongoId)
    ? new mongoose.Types.ObjectId(params.claimMongoId)
    : null;

  const queue = await OfflineSyncQueue.findOneAndUpdate(
    {
      actorId: params.actorId,
      queueType: params.queueType,
      clientGeneratedId: params.clientGeneratedId,
    },
    {
      $set: {
        syncStatus: params.syncStatus,
        actorRole: params.actorRole,
        residentId: residentObjectId,
        disasterEventId: disasterEventObjectId,
        distributionId: distributionObjectId,
        proofSubmissionId: proofSubmissionObjectId,
        claimMongoId: claimMongoObjectId,
        claimId: params.claimId || '',
        deviceId: String(params.deviceId || '').trim(),
        payload: params.payload,
        errorMessage: params.errorMessage || '',
        errorCode: params.errorCode || '',
        retryable: Boolean(params.retryable),
        syncedAt: params.syncStatus === 'Synced' ? new Date() : null,
      },
      $setOnInsert: {
        actorId: params.actorId,
        queueType: params.queueType,
        clientGeneratedId: params.clientGeneratedId,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return queue;
}
