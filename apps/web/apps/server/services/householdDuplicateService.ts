/**
 * Household Duplicate Prevention Service
 * 
 * Implements a 2-Way Guardrail against cross-household & cross-barangay duplication:
 * 1. Checks if the registrant (Household Head) is already listed as a head or member in an active household.
 * 2. Checks if any submitted household member is already listed as a head or member in an active household.
 * 
 * Classification:
 * - Tier 1 (Hard Block): Matching First Name + Last Name + matching Birth Year / DOB.
 * - Tier 2 (Review Warning): Matching First Name + Last Name, but different/unspecified Birth Year.
 */

import mongoose from 'mongoose';
import Resident, { IResident } from '../models/Resident';
import { escapeRegex } from '../validation/mongoSanitize';

export interface PersonIdentityInput {
  firstName: string;
  lastName: string;
  relationship?: string;
  dateOfBirth?: string | null;
  birthYear?: number | null;
}

export interface DuplicateConflictDetail {
  conflictType: 'HEAD_ALREADY_EXISTS' | 'HEAD_ALREADY_MEMBER' | 'MEMBER_IS_HEAD' | 'MEMBER_ALREADY_MEMBER';
  tier: 1 | 2; // 1 = Hard Block, 2 = Warning for Staff Review
  personName: string;
  matchedResidentId: string;
  matchedResidentCode?: string;
  matchedBarangay: string;
  matchedHouseholdHead: string;
  matchedRole: 'HEAD' | 'MEMBER';
  message: string;
}

export interface HouseholdDuplicateCheckResult {
  hasConflict: boolean;
  hardBlocked: boolean; // True if any Tier 1 conflict exists
  hardBlockMessage?: string;
  hardBlockConflict?: DuplicateConflictDetail;
  warnings: string[];
  conflicts: DuplicateConflictDetail[];
}

/**
 * Extracts a 4-digit birth year from a date string (YYYY-MM-DD) or explicit birthYear number
 */
export function extractBirthYear(dateOfBirth?: string | null, birthYear?: number | null): number | null {
  if (birthYear && typeof birthYear === 'number' && birthYear >= 1900 && birthYear <= 2100) {
    return birthYear;
  }
  if (!dateOfBirth) return null;
  const match = dateOfBirth.match(/\b(19\d{2}|20\d{2})\b/);
  if (match) {
    return parseInt(match[1], 10);
  }
  const parsed = new Date(dateOfBirth);
  if (!isNaN(parsed.getFullYear()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2100) {
    return parsed.getFullYear();
  }
  return null;
}

/**
 * Compares two birth years. Returns true if both are present and within 1 year tolerance.
 */
function areBirthYearsMatching(yearA: number | null, yearB: number | null): boolean {
  if (!yearA || !yearB) return false;
  return Math.abs(yearA - yearB) <= 1;
}

/**
 * Helper to build case-insensitive exact string match regex
 */
function buildExactNameRegex(name: string): RegExp {
  const sanitized = escapeRegex(name.trim().toLowerCase());
  return new RegExp(`^${sanitized}$`, 'i');
}

/**
 * Performs complete 2-way duplicate verification across active/pending households
 */
export async function checkHouseholdDuplicates(params: {
  registrant?: PersonIdentityInput;
  members?: PersonIdentityInput[];
  excludeResidentId?: string | mongoose.Types.ObjectId;
}): Promise<HouseholdDuplicateCheckResult> {
  const { registrant, members = [], excludeResidentId } = params;
  const conflicts: DuplicateConflictDetail[] = [];
  const warnings: string[] = [];

  const baseFilter: Record<string, any> = {
    status: mongoose.trusted({ $in: ['Pending', 'Approved', 'Needs Revision'] }),
  };
  if (excludeResidentId) {
    baseFilter._id = mongoose.trusted({ $ne: new mongoose.Types.ObjectId(excludeResidentId.toString()) });
  }

  // ─────────────────────────────────────────────────────────────────
  // CHECK 1: Registrant Head vs Existing System
  // ─────────────────────────────────────────────────────────────────
  if (registrant && registrant.firstName && registrant.lastName) {
    const regFirstNameRegex = buildExactNameRegex(registrant.firstName);
    const regLastNameRegex = buildExactNameRegex(registrant.lastName);
    const regBirthYear = extractBirthYear(registrant.dateOfBirth, registrant.birthYear);
    const registrantFullName = `${registrant.firstName.trim()} ${registrant.lastName.trim()}`;

    // 1A. Check if head is already a Household Head elsewhere
    const headMatches = await Resident.find({
      ...baseFilter,
      firstName: regFirstNameRegex,
      lastName: regLastNameRegex,
    })
      .setOptions({ sanitizeFilter: false })
      .select('_id residentCode barangay firstName lastName dateOfBirth status')
      .lean();

    for (const match of headMatches) {
      const matchBirthYear = extractBirthYear(match.dateOfBirth);
      const isDefinitive = areBirthYearsMatching(regBirthYear, matchBirthYear);
      const tier: 1 | 2 = isDefinitive ? 1 : 2;

      const detail: DuplicateConflictDetail = {
        conflictType: 'HEAD_ALREADY_EXISTS',
        tier,
        personName: registrantFullName,
        matchedResidentId: match._id.toString(),
        matchedResidentCode: match.residentCode,
        matchedBarangay: match.barangay,
        matchedHouseholdHead: `${match.firstName} ${match.lastName}`,
        matchedRole: 'HEAD',
        message: tier === 1
          ? `Registrant "${registrantFullName}" is already registered as the head of an active household in Barangay ${match.barangay} (${match.residentCode || 'Pending'}).`
          : `A registered household head named "${registrantFullName}" exists in Barangay ${match.barangay} (${match.residentCode || 'Household'}) with a different birth year. Flagged for verification.`,
      };
      conflicts.push(detail);
      if (tier === 2) {
        warnings.push(detail.message);
      }
    }

    // 1B. Check if head is already listed as a Family Member in another household
    const memberMatches = await Resident.find({
      ...baseFilter,
      'householdMembers.firstName': regFirstNameRegex,
      'householdMembers.lastName': regLastNameRegex,
    })
      .setOptions({ sanitizeFilter: false })
      .select('_id residentCode barangay firstName lastName householdMembers status')
      .lean();

    for (const match of memberMatches) {
      const matchingMember = (match.householdMembers || []).find((m: any) =>
        m.firstName?.toLowerCase()?.trim() === registrant.firstName.toLowerCase().trim() &&
        m.lastName?.toLowerCase()?.trim() === registrant.lastName.toLowerCase().trim()
      );

      if (matchingMember) {
        const memberBirthYear = extractBirthYear(matchingMember.dateOfBirth, matchingMember.birthYear);
        const isDefinitive = areBirthYearsMatching(regBirthYear, memberBirthYear);
        const tier: 1 | 2 = isDefinitive ? 1 : 2;

        const detail: DuplicateConflictDetail = {
          conflictType: 'HEAD_ALREADY_MEMBER',
          tier,
          personName: registrantFullName,
          matchedResidentId: match._id.toString(),
          matchedResidentCode: match.residentCode,
          matchedBarangay: match.barangay,
          matchedHouseholdHead: `${match.firstName} ${match.lastName}`,
          matchedRole: 'MEMBER',
          message: tier === 1
            ? `Registrant "${registrantFullName}" is already listed as a household member under ${match.firstName} ${match.lastName} in Barangay ${match.barangay} (${match.residentCode || 'Household'}). Under relief guidelines, each individual may only belong to one household.`
            : `Registrant "${registrantFullName}" shares the same name as a household member under ${match.firstName} ${match.lastName} in Barangay ${match.barangay} (${match.residentCode || 'Household'}). Flagged for staff review.`,
        };
        conflicts.push(detail);
        if (tier === 2) {
          warnings.push(detail.message);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // CHECK 2: Family Members vs Existing System
  // ─────────────────────────────────────────────────────────────────
  for (const member of members) {
    if (!member.firstName || !member.lastName) continue;
    const memFirstNameRegex = buildExactNameRegex(member.firstName);
    const memLastNameRegex = buildExactNameRegex(member.lastName);
    const memBirthYear = extractBirthYear(member.dateOfBirth, member.birthYear);
    const memberFullName = `${member.firstName.trim()} ${member.lastName.trim()}`;

    // 2A. Check if this member is already registered as a Head in another household
    const headMatches = await Resident.find({
      ...baseFilter,
      firstName: memFirstNameRegex,
      lastName: memLastNameRegex,
    })
      .setOptions({ sanitizeFilter: false })
      .select('_id residentCode barangay firstName lastName dateOfBirth status')
      .lean();

    for (const match of headMatches) {
      const headBirthYear = extractBirthYear(match.dateOfBirth);
      const isDefinitive = areBirthYearsMatching(memBirthYear, headBirthYear);
      const tier: 1 | 2 = isDefinitive ? 1 : 2;

      const detail: DuplicateConflictDetail = {
        conflictType: 'MEMBER_IS_HEAD',
        tier,
        personName: memberFullName,
        matchedResidentId: match._id.toString(),
        matchedResidentCode: match.residentCode,
        matchedBarangay: match.barangay,
        matchedHouseholdHead: `${match.firstName} ${match.lastName}`,
        matchedRole: 'HEAD',
        message: tier === 1
          ? `Member "${memberFullName}" is already registered as an independent Household Head in Barangay ${match.barangay} (${match.residentCode || 'Household'}).`
          : `Member "${memberFullName}" matches the name of a Household Head in Barangay ${match.barangay} (${match.residentCode || 'Household'}). Flagged for verification.`,
      };
      conflicts.push(detail);
      if (tier === 2) {
        warnings.push(detail.message);
      }
    }

    // 2B. Check if this member is already listed as a member in another household
    const memberMatches = await Resident.find({
      ...baseFilter,
      'householdMembers.firstName': memFirstNameRegex,
      'householdMembers.lastName': memLastNameRegex,
    })
      .setOptions({ sanitizeFilter: false })
      .select('_id residentCode barangay firstName lastName householdMembers status')
      .lean();

    for (const match of memberMatches) {
      const matchingMember = (match.householdMembers || []).find((m: any) =>
        m.firstName?.toLowerCase()?.trim() === member.firstName.toLowerCase().trim() &&
        m.lastName?.toLowerCase()?.trim() === member.lastName.toLowerCase().trim()
      );

      if (matchingMember) {
        const otherMemberBirthYear = extractBirthYear(matchingMember.dateOfBirth, matchingMember.birthYear);
        const isDefinitive = areBirthYearsMatching(memBirthYear, otherMemberBirthYear);
        const tier: 1 | 2 = isDefinitive ? 1 : 2;

        const detail: DuplicateConflictDetail = {
          conflictType: 'MEMBER_ALREADY_MEMBER',
          tier,
          personName: memberFullName,
          matchedResidentId: match._id.toString(),
          matchedResidentCode: match.residentCode,
          matchedBarangay: match.barangay,
          matchedHouseholdHead: `${match.firstName} ${match.lastName}`,
          matchedRole: 'MEMBER',
          message: tier === 1
            ? `Member "${memberFullName}" is already listed in another household under ${match.firstName} ${match.lastName} in Barangay ${match.barangay} (${match.residentCode || 'Household'}).`
            : `Member "${memberFullName}" matches a listed member under ${match.firstName} ${match.lastName} in Barangay ${match.barangay} (${match.residentCode || 'Household'}). Flagged for staff review.`,
        };
        conflicts.push(detail);
        if (tier === 2) {
          warnings.push(detail.message);
        }
      }
    }
  }

  const hardBlockConflict = conflicts.find((c) => c.tier === 1);
  const hardBlocked = Boolean(hardBlockConflict);

  return {
    hasConflict: conflicts.length > 0,
    hardBlocked,
    hardBlockMessage: hardBlockConflict?.message,
    hardBlockConflict,
    warnings,
    conflicts,
  };
}
