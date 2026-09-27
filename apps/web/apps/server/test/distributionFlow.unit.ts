import assert from 'assert';
import { createDistributionBody, updateDistributionStaffBody } from '../validation/distribution.schema';
import {
  deriveDistributionStatus,
  getTargetBarangays,
  isResidentEligibleForDistribution,
} from '../services/distributionFlowService';
import { deriveDistributionLifecycle, manilaDateParts } from '../utils/distributionLifecycle';

const validStaffId = '507f1f77bcf86cd799439011';
const validDisasterEventId = '507f1f77bcf86cd799439012';
const tomorrowManila = new Date(Date.now() + 32 * 60 * 60 * 1000);
const tomorrowParts = manilaDateParts(tomorrowManila);
const validSchedule = new Date(Date.UTC(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 1, 0)).toISOString();
const validEndsAt = new Date(Date.UTC(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 9, 0)).toISOString();

export function runDistributionFlowUnitTests(): void {
  // Single barangay target
  const targetSingle = getTargetBarangays('Bolo');
  assert.deepStrictEqual(targetSingle, ['Bolo']);

  const targetWithAssigned = getTargetBarangays('Bolo', ['Bongalon', 'Dulig', 'San Jose']);
  assert.deepStrictEqual(targetWithAssigned, ['Bolo', 'Bongalon', 'Dulig', 'San Jose']);

  const eligible = isResidentEligibleForDistribution('Bolo', {
    barangay: 'Bolo',
    assignedBarangays: [],
  } as any);
  assert.strictEqual(eligible, true);

  const notEligible = isResidentEligibleForDistribution('Uyong', {
    barangay: 'Bolo',
    assignedBarangays: [],
  } as any);
  assert.strictEqual(notEligible, false);

  assert.strictEqual(deriveDistributionStatus(10, 0), 'Unclaimed');
  assert.strictEqual(deriveDistributionStatus(10, 3), 'Partially Claimed');
  assert.strictEqual(deriveDistributionStatus(10, 10), 'Claimed');

  const lifecycleWindow = {
    scheduled: '2026-08-25T09:00:00+08:00',
    endsAt: '2026-08-25T17:00:00+08:00',
    archivedAt: null,
  };
  assert.strictEqual(deriveDistributionLifecycle(lifecycleWindow, new Date('2026-08-25T08:59:59+08:00')), 'Upcoming');
  assert.strictEqual(deriveDistributionLifecycle(lifecycleWindow, new Date('2026-08-25T09:00:00+08:00')), 'Active');
  assert.strictEqual(deriveDistributionLifecycle(lifecycleWindow, new Date('2026-08-25T17:00:00+08:00')), 'Active');
  assert.strictEqual(deriveDistributionLifecycle(lifecycleWindow, new Date('2026-08-25T17:00:01+08:00')), 'Completed');
  assert.strictEqual(deriveDistributionLifecycle({ ...lifecycleWindow, archivedAt: '2026-08-25T12:00:00+08:00' }, new Date('2026-08-25T13:00:00+08:00')), 'Archived');
  assert.strictEqual(deriveDistributionLifecycle({ ...lifecycleWindow, status: 'Claimed' }, new Date('2026-08-25T10:00:00+08:00')), 'Completed');
  assert.strictEqual(deriveDistributionLifecycle({ ...lifecycleWindow, registeredHouseholds: 10, claimedHouseholds: 10 }, new Date('2026-08-25T10:00:00+08:00')), 'Completed');
  assert.strictEqual(deriveDistributionLifecycle({ ...lifecycleWindow, registeredHouseholds: 10, claimedHouseholds: 5 }, new Date('2026-08-25T10:00:00+08:00')), 'Active');

  // Valid create without assignedBarangays (new 3-step per-barangay flow)
  const validCreateSingle = createDistributionBody.safeParse({
    disasterEventId: validDisasterEventId,
    barangay: 'Bolo',
    scheduled: validSchedule,
    endsAt: validEndsAt,
    assignedStaffIds: [validStaffId],
    notes: 'Single barangay distribution',
  });
  assert.strictEqual(validCreateSingle.success, true);

  // Valid create with empty array
  const validCreateEmptyAssigned = createDistributionBody.safeParse({
    disasterEventId: validDisasterEventId,
    barangay: 'Bolo',
    assignedBarangays: [],
    scheduled: validSchedule,
    endsAt: validEndsAt,
    assignedStaffIds: [validStaffId],
    notes: 'Empty assigned array',
  });
  assert.strictEqual(validCreateEmptyAssigned.success, true);

  // Valid create without disasterEventId
  const validCreateWithoutEvent = createDistributionBody.safeParse({
    barangay: 'Bolo',
    scheduled: validSchedule,
    endsAt: validEndsAt,
    assignedStaffIds: [validStaffId],
    notes: 'Single barangay distribution without event',
  });
  assert.strictEqual(validCreateWithoutEvent.success, true);

  // Invalid: missing assigned staff
  const missingStaff = createDistributionBody.safeParse({
    barangay: 'Bolo',
    scheduled: validSchedule,
    endsAt: validEndsAt,
    assignedStaffIds: [],
    notes: 'test',
  });
  assert.strictEqual(missingStaff.success, false);

  // Unit tests for updateDistributionStaffBody
  const validStaffUpdate = updateDistributionStaffBody.safeParse({
    assignedStaffIds: [validStaffId, '507f1f77bcf86cd799439013'],
  });
  assert.strictEqual(validStaffUpdate.success, true);

  const emptyStaffUpdate = updateDistributionStaffBody.safeParse({
    assignedStaffIds: [],
  });
  assert.strictEqual(emptyStaffUpdate.success, false);

  const duplicateStaffUpdate = updateDistributionStaffBody.safeParse({
    assignedStaffIds: [validStaffId, validStaffId],
  });
  assert.strictEqual(duplicateStaffUpdate.success, false);

  const invalidObjectIdStaffUpdate = updateDistributionStaffBody.safeParse({
    assignedStaffIds: ['not-an-objectid'],
  });
  assert.strictEqual(invalidObjectIdStaffUpdate.success, false);
}

