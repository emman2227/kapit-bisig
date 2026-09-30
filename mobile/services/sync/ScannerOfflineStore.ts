import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

export interface RosterResident {
  residentId: string;
  residentCode: string;
  maskedName: string;
  barangay: string;
  qrVersion: number;
  isApprovedBeneficiary: boolean;
  alreadyClaimed: boolean;
}

export interface OfflineRosterData {
  distributionId: string;
  barangay: string;
  assignedBarangays: string[];
  requiresBeneficiaryApproval: boolean;
  totalCount: number;
  claimedCount: number;
  downloadedAt: string;
  roster: RosterResident[];
}

export interface QueuedOfflineClaim {
  clientGeneratedId: string;
  distributionId: string;
  residentId: string;
  residentCode: string;
  maskedName?: string;
  scannedAt: string;
  queuedAt: string;
  status: 'PENDING' | 'SYNCING' | 'FAILED';
  error?: string;
}

const ROOT = `${FileSystem.documentDirectory || ''}scanner-offline/`;
const DEVICE_ID_KEY = 'kapitbisigscannerdeviceid';

export interface OfflineScannerAssignments {
  active: any[];
  nearestUpcoming?: any | null;
  cachedAt: string;
}

function assignmentsFile(staffId: string): string {
  return `${staffDir(staffId)}assignments.json`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function staffDir(staffId: string): string {
  return `${ROOT}${safeSegment(staffId)}/`;
}

function rosterFile(staffId: string, distributionId: string): string {
  return `${staffDir(staffId)}roster-${safeSegment(distributionId)}.json`;
}

function claimsFile(staffId: string, distributionId: string): string {
  return `${staffDir(staffId)}claims-${safeSegment(distributionId)}.json`;
}

async function ensureDirectory(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 });
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(value), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/**
 * Get or generate a persistent device ID for scanner sync tracking.
 */
export async function getStableScannerDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `scanner-device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

/**
 * Save distribution roster downloaded from server for offline lookup.
 */
export async function saveDistributionRoster(
  staffId: string,
  distributionId: string,
  rosterData: OfflineRosterData,
): Promise<void> {
  await ensureDirectory(staffDir(staffId));
  await writeJson(rosterFile(staffId, distributionId), rosterData);
}

/**
 * Load offline distribution roster.
 */
export async function loadDistributionRoster(
  staffId: string,
  distributionId: string,
): Promise<OfflineRosterData | null> {
  return readJson<OfflineRosterData>(rosterFile(staffId, distributionId));
}

/**
 * Check if a distribution roster has been downloaded.
 */
export async function hasOfflineRoster(
  staffId: string,
  distributionId: string,
): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(rosterFile(staffId, distributionId));
  return Boolean(info.exists);
}

/**
 * Delete offline distribution roster.
 */
export async function clearDistributionRoster(
  staffId: string,
  distributionId: string,
): Promise<void> {
  await FileSystem.deleteAsync(rosterFile(staffId, distributionId), { idempotent: true }).catch(() => undefined);
}

/**
 * Mark a resident as claimed in the local offline roster.
 */
export async function markResidentClaimedInRoster(
  staffId: string,
  distributionId: string,
  residentId: string,
): Promise<void> {
  const rosterData = await loadDistributionRoster(staffId, distributionId);
  if (!rosterData) return;

  let changed = false;
  for (const resident of rosterData.roster) {
    if (resident.residentId === residentId) {
      if (!resident.alreadyClaimed) {
        resident.alreadyClaimed = true;
        rosterData.claimedCount += 1;
        changed = true;
      }
      break;
    }
  }

  if (changed) {
    await writeJson(rosterFile(staffId, distributionId), rosterData);
  }
}

/**
 * List offline recorded claims for a specific distribution.
 */
export async function listOfflineClaims(
  staffId: string,
  distributionId: string,
): Promise<QueuedOfflineClaim[]> {
  await ensureDirectory(staffDir(staffId));
  const claims = await readJson<QueuedOfflineClaim[]>(claimsFile(staffId, distributionId));
  return Array.isArray(claims) ? claims : [];
}

/**
 * Add a new claim to the offline queue.
 */
export async function addOfflineClaim(
  staffId: string,
  distributionId: string,
  claim: Omit<QueuedOfflineClaim, 'queuedAt' | 'status'>,
): Promise<void> {
  await ensureDirectory(staffDir(staffId));
  const claims = await listOfflineClaims(staffId, distributionId);
  const existingIdx = claims.findIndex((c) => c.residentId === claim.residentId);

  const fullClaim: QueuedOfflineClaim = {
    ...claim,
    queuedAt: new Date().toISOString(),
    status: 'PENDING',
  };

  if (existingIdx >= 0) {
    claims[existingIdx] = fullClaim;
  } else {
    claims.push(fullClaim);
  }

  await writeJson(claimsFile(staffId, distributionId), claims);

  // Also mark in local roster
  await markResidentClaimedInRoster(staffId, distributionId, claim.residentId);
}

/**
 * Remove synced claims from the offline queue.
 */
export async function removeOfflineClaims(
  staffId: string,
  distributionId: string,
  clientGeneratedIds: string[],
): Promise<void> {
  const set = new Set(clientGeneratedIds);
  const claims = await listOfflineClaims(staffId, distributionId);
  const remaining = claims.filter((c) => !set.has(c.clientGeneratedId));
  await writeJson(claimsFile(staffId, distributionId), remaining);
}

/**
 * Update status of an offline claim (e.g. SYNCING or FAILED).
 */
export async function updateOfflineClaimStatus(
  staffId: string,
  distributionId: string,
  clientGeneratedId: string,
  status: QueuedOfflineClaim['status'],
  error?: string,
): Promise<void> {
  const claims = await listOfflineClaims(staffId, distributionId);
  const target = claims.find((c) => c.clientGeneratedId === clientGeneratedId);
  if (target) {
    target.status = status;
    if (error !== undefined) target.error = error;
    await writeJson(claimsFile(staffId, distributionId), claims);
  }
}

/**
 * Check if a resident is already claimed locally (either in the queue or marked in roster).
 */
export async function isResidentClaimedLocally(
  staffId: string,
  distributionId: string,
  residentId: string,
): Promise<boolean> {
  const claims = await listOfflineClaims(staffId, distributionId);
  if (claims.some((c) => c.residentId === residentId)) {
    return true;
  }

  const roster = await loadDistributionRoster(staffId, distributionId);
  if (roster) {
    const resident = roster.roster.find((r) => r.residentId === residentId);
    if (resident?.alreadyClaimed) {
      return true;
    }
  }

  return false;
}

/**
 * Count total pending offline claims across all distributions for a staff member.
 */
export async function countTotalPendingClaims(staffId: string): Promise<number> {
  try {
    const dir = staffDir(staffId);
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(dir);
    let count = 0;
    for (const file of files) {
      if (file.startsWith('claims-') && file.endsWith('.json')) {
        const claims = await readJson<QueuedOfflineClaim[]>(`${dir}${file}`);
        if (Array.isArray(claims)) {
          count += claims.filter((c) => c.status === 'PENDING' || c.status === 'FAILED').length;
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Save scanner assignments locally for offline retrieval.
 */
export async function saveScannerAssignments(
  staffId: string,
  data: { active: any[]; nearestUpcoming?: any | null },
): Promise<void> {
  await ensureDirectory(staffDir(staffId));
  const payload: OfflineScannerAssignments = {
    active: Array.isArray(data.active) ? data.active : [],
    nearestUpcoming: data.nearestUpcoming || null,
    cachedAt: new Date().toISOString(),
  };
  await writeJson(assignmentsFile(staffId), payload);
}

/**
 * Load cached scanner assignments for offline retrieval.
 */
export async function loadScannerAssignments(
  staffId: string,
): Promise<OfflineScannerAssignments | null> {
  return readJson<OfflineScannerAssignments>(assignmentsFile(staffId));
}

/**
 * List all downloaded rosters currently on the device for this staff member.
 */
export async function listDownloadedRosters(
  staffId: string,
): Promise<OfflineRosterData[]> {
  try {
    const dir = staffDir(staffId);
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return [];

    const files = await FileSystem.readDirectoryAsync(dir);
    const rosters: OfflineRosterData[] = [];
    for (const file of files) {
      if (file.startsWith('roster-') && file.endsWith('.json')) {
        const roster = await readJson<OfflineRosterData>(`${dir}${file}`);
        if (roster && roster.distributionId) {
          rosters.push(roster);
        }
      }
    }
    return rosters;
  } catch {
    return [];
  }
}

