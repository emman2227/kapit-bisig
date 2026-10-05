import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import type {
  ResidentDisasterEvent,
  ResidentDistributionItem,
  ResidentProfile,
  ResidentProofSubmissionStatus,
  ResidentQrData,
  ResidentSession,
} from '../api/ResidentQrService';
export { isCachedEventUsable, isOfflineCacheWithinGrace } from './OfflinePolicy';

const ROOT = `${FileSystem.documentDirectory || ''}resident-proof-offline/`;
const LEGACY_QUEUE_FILE = `${FileSystem.documentDirectory || ''}resident-proof-sync-queue.json`;
const CACHE_KEY = 'kapitbisigresidentofflinecache';
const DEVICE_ID_KEY = 'kapitbisigresidentproofdeviceid';
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineProofStatus = 'PENDING_SYNC' | 'SYNCING' | 'NEEDS_ATTENTION';

export interface OfflineProofPhoto {
  uri: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface OfflineProofRecord {
  schemaVersion: 1;
  ownerResidentId: string;
  clientGeneratedId: string;
  deviceId: string;
  disasterEventId?: string | null;
  distributionId?: string | null;
  eventSnapshot?: {
    name: string;
    disasterType: string;
    submissionDeadline?: string | null;
  };
  damageType: 'Flood' | 'House Damage' | 'Storm Surge' | 'Landslide' | 'Livelihood Loss' | 'Other';
  description: string;
  supportingInfo?: string;
  dateSubmitted: string;
  photos: OfflineProofPhoto[];
  queuedAt: string;
  lastAttemptAt?: string;
  attemptCount: number;
  lastError?: string;
  errorCode?: string;
  status: OfflineProofStatus;
}

export interface StoredProofDraft {
  damageType: string;
  description: string;
  supportingInfo: string;
  showSupportingInfo: boolean;
  selectedDistributionId: string | null;
  photoUris: string[];
  savedAt: string;
}

export interface ResidentOfflineCache {
  residentId: string;
  session: ResidentSession;
  profile: ResidentProfile;
  virtualId?: ResidentQrData | null;
  virtualIdFetchedAt?: string | null;
  activeEvent: ResidentDisasterEvent | null;
  activeEventFetchedAt: string | null;
  proofStatus: ResidentProofSubmissionStatus | null;
  lastOnlineValidatedAt: string;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function residentDir(residentId: string): string {
  return `${ROOT}${safeSegment(residentId)}/`;
}

function queueFile(residentId: string): string {
  return `${residentDir(residentId)}queue.json`;
}

function draftFile(residentId: string): string {
  return `${residentDir(residentId)}draft.json`;
}

function photosDir(residentId: string): string {
  return `${residentDir(residentId)}photos/`;
}

function distributionCacheFile(residentId: string): string {
  return `${residentDir(residentId)}distributions.json`;
}

async function ensureDirectory(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

async function ensureResidentDirectory(residentId: string): Promise<void> {
  await ensureDirectory(photosDir(residentId));
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

export interface ResidentDistributionOfflineCache {
  residentId: string;
  items: ResidentDistributionItem[];
  fetchedAt: string;
}

export async function saveResidentDistributionOfflineCache(
  residentId: string,
  items: ResidentDistributionItem[],
  fetchedAt: string,
): Promise<void> {
  await ensureResidentDirectory(residentId);
  await writeJson(distributionCacheFile(residentId), { residentId, items, fetchedAt });
}

export async function loadResidentDistributionOfflineCache(
  residentId: string,
): Promise<ResidentDistributionOfflineCache | null> {
  const cached = await readJson<ResidentDistributionOfflineCache>(distributionCacheFile(residentId));
  if (
    !cached ||
    cached.residentId !== residentId ||
    !Array.isArray(cached.items) ||
    typeof cached.fetchedAt !== 'string'
  ) return null;
  return cached;
}

export async function clearResidentDistributionOfflineCache(residentId: string): Promise<void> {
  await FileSystem.deleteAsync(distributionCacheFile(residentId), { idempotent: true }).catch(() => undefined);
}

function mimeTypeForUri(uri: string): OfflineProofPhoto['mimeType'] {
  if (/\.png(?:\?|$)/i.test(uri)) return 'image/png';
  if (/\.webp(?:\?|$)/i.test(uri)) return 'image/webp';
  return 'image/jpeg';
}

export async function quarantineLegacyOwnerlessQueue(): Promise<void> {
  try {
    await ensureDirectory(ROOT);
    const legacyInfo = await FileSystem.getInfoAsync(LEGACY_QUEUE_FILE);
    if (!legacyInfo.exists) return;

    const destination = `${ROOT}legacy-unowned-queue-${Date.now()}.json`;
    await FileSystem.moveAsync({ from: LEGACY_QUEUE_FILE, to: destination });
    console.warn('[OfflineProof] Legacy ownerless queue quarantined and will not be uploaded.');
  } catch (error) {
    console.warn('[OfflineProof] Unable to quarantine legacy queue:', error);
  }
}

export async function getStableProofDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `resident-proof-device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

export async function saveResidentOfflineCache(cache: ResidentOfflineCache): Promise<void> {
  await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(cache));
}

export async function updateResidentOfflineCache(
  residentId: string,
  update: Partial<ResidentOfflineCache>,
): Promise<ResidentOfflineCache | null> {
  const current = await loadResidentOfflineCache();
  if (!current || current.residentId !== residentId) return null;
  const next = { ...current, ...update, residentId } as ResidentOfflineCache;
  await saveResidentOfflineCache(next);
  return next;
}

export async function loadResidentOfflineCache(): Promise<ResidentOfflineCache | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    return raw ? JSON.parse(raw) as ResidentOfflineCache : null;
  } catch {
    return null;
  }
}

export async function clearResidentOfflineCache(): Promise<void> {
  const current = await loadResidentOfflineCache();
  await SecureStore.deleteItemAsync(CACHE_KEY);
  if (current?.residentId) {
    await clearResidentDistributionOfflineCache(current.residentId);
  }
}

export async function persistProofPhoto(residentId: string, uri: string): Promise<OfflineProofPhoto> {
  await ensureResidentDirectory(residentId);
  const residentPhotoRoot = photosDir(residentId);
  if (uri.startsWith(residentPhotoRoot)) {
    return { uri, mimeType: mimeTypeForUri(uri) };
  }

  const mimeType = mimeTypeForUri(uri);
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const destination = `${residentPhotoRoot}${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return { uri: destination, mimeType };
}

export async function saveStoredProofDraft(
  residentId: string,
  draft: Omit<StoredProofDraft, 'savedAt'>,
): Promise<void> {
  await ensureResidentDirectory(residentId);
  await writeJson(draftFile(residentId), { ...draft, savedAt: new Date().toISOString() });
}

export async function loadStoredProofDraft(residentId: string): Promise<StoredProofDraft | null> {
  const draft = await readJson<StoredProofDraft>(draftFile(residentId));
  if (!draft) return null;
  const savedAt = new Date(draft.savedAt).getTime();
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > DRAFT_MAX_AGE_MS) {
    await clearStoredProofDraft(residentId);
    return null;
  }
  return draft;
}

export async function clearStoredProofDraft(residentId: string): Promise<void> {
  const path = draftFile(residentId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
}

export async function migrateLegacyTokenDraft(residentId: string, token: string): Promise<void> {
  try {
    const current = await loadStoredProofDraft(residentId);
    if (current) return;
    const suffix = token.slice(-16).replace(/[^a-zA-Z0-9]/g, 'x');
    const legacyPath = `${FileSystem.documentDirectory || ''}proof-drafts/draft_${suffix}.json`;
    const legacy = await readJson<StoredProofDraft>(legacyPath);
    if (!legacy) return;
    await ensureResidentDirectory(residentId);
    await writeJson(draftFile(residentId), legacy);
    await FileSystem.deleteAsync(legacyPath, { idempotent: true });
  } catch (error) {
    console.warn('[OfflineProof] Legacy draft migration failed:', error);
  }
}

export async function listOfflineProofRecords(residentId: string): Promise<OfflineProofRecord[]> {
  await ensureResidentDirectory(residentId);
  const queue = await readJson<OfflineProofRecord[]>(queueFile(residentId));
  return Array.isArray(queue) ? queue.filter((item) => item.ownerResidentId === residentId) : [];
}

export async function putOfflineProofRecord(record: OfflineProofRecord): Promise<void> {
  const queue = await listOfflineProofRecords(record.ownerResidentId);
  const index = queue.findIndex((item) => item.clientGeneratedId === record.clientGeneratedId);
  if (index >= 0) queue[index] = record;
  else queue.push(record);
  await writeJson(queueFile(record.ownerResidentId), queue);
}

export async function removeOfflineProofRecord(
  residentId: string,
  clientGeneratedId: string,
  deletePhotos: boolean,
): Promise<void> {
  const queue = await listOfflineProofRecords(residentId);
  const target = queue.find((item) => item.clientGeneratedId === clientGeneratedId);
  await writeJson(
    queueFile(residentId),
    queue.filter((item) => item.clientGeneratedId !== clientGeneratedId),
  );

  if (deletePhotos && target) {
    await Promise.all(target.photos.map(async ({ uri }) => {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        // Best-effort cleanup; the queue entry has already been removed.
      }
    }));
  }
}

export async function updateOfflineProofRecord(
  residentId: string,
  clientGeneratedId: string,
  update: Partial<OfflineProofRecord>,
): Promise<OfflineProofRecord | null> {
  const queue = await listOfflineProofRecords(residentId);
  const index = queue.findIndex((item) => item.clientGeneratedId === clientGeneratedId);
  if (index < 0) return null;
  const next = { ...queue[index], ...update, ownerResidentId: residentId } as OfflineProofRecord;
  queue[index] = next;
  await writeJson(queueFile(residentId), queue);
  return next;
}
