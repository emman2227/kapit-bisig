export type DistributionLifecycleStatus = 'Upcoming' | 'Active' | 'Completed' | 'Archived';

export interface DistributionLifecycleRecord {
  scheduled?: string | Date | null;
  endsAt?: string | Date | null;
  archivedAt?: string | Date | null;
  status?: string | null;
  claimedHouseholds?: number | null;
  registeredHouseholds?: number | null;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function validDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function deriveDistributionLifecycle(
  distribution: DistributionLifecycleRecord,
  now = new Date(),
): DistributionLifecycleStatus {
  if (validDate(distribution.archivedAt)) return 'Archived';

  if (distribution.status === 'Claimed') return 'Completed';

  if (
    typeof distribution.claimedHouseholds === 'number' &&
    typeof distribution.registeredHouseholds === 'number' &&
    distribution.registeredHouseholds > 0 &&
    distribution.claimedHouseholds >= distribution.registeredHouseholds
  ) {
    return 'Completed';
  }

  const startsAt = validDate(distribution.scheduled);
  const endsAt = validDate(distribution.endsAt);
  if (!startsAt || !endsAt) return 'Completed';
  if (now.getTime() < startsAt.getTime()) return 'Upcoming';
  if (now.getTime() <= endsAt.getTime()) return 'Active';
  return 'Completed';
}

export function isDistributionVisibleToResidents(
  distribution: DistributionLifecycleRecord,
  now = new Date(),
): boolean {
  const lifecycle = deriveDistributionLifecycle(distribution, now);
  return lifecycle === 'Active' || lifecycle === 'Upcoming';
}

export function isDistributionClaimable(
  distribution: DistributionLifecycleRecord,
  now = new Date(),
): boolean {
  return deriveDistributionLifecycle(distribution, now) === 'Active';
}

/** Return 8:00 PM Asia/Manila on the start date for legacy records. */
export function legacyDistributionEnd(scheduled?: string | Date | null, fallback = new Date(0)): Date {
  const startsAt = validDate(scheduled);
  if (!startsAt) return fallback;

  const manila = new Date(startsAt.getTime() + MANILA_OFFSET_MS);
  return new Date(Date.UTC(
    manila.getUTCFullYear(),
    manila.getUTCMonth(),
    manila.getUTCDate(),
    12,
    0,
    0,
    0,
  ));
}

export function manilaDateParts(value: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const shifted = new Date(value.getTime() + MANILA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}
