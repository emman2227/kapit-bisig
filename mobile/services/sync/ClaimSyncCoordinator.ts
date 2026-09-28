import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import { mobileAuthService } from '../auth/MobileAuthService';
import {
  countTotalPendingClaims,
  getStableScannerDeviceId,
  listOfflineClaims,
  removeOfflineClaims,
  updateOfflineClaimStatus,
  type QueuedOfflineClaim,
} from './ScannerOfflineStore';

export interface ClaimSyncSnapshot {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt?: string;
  error?: string;
}

export interface SyncClaimsResult {
  syncedCount: number;
  duplicateCount: number;
  failedCount: number;
}

type Listener = (snapshot: ClaimSyncSnapshot) => void;

let snapshot: ClaimSyncSnapshot = {
  online: true,
  syncing: false,
  pendingCount: 0,
};

let syncPromise: Promise<SyncClaimsResult> | null = null;
const listeners = new Set<Listener>();
let unsubscribeNetInfo: (() => void) | null = null;

function isOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

function publish(update: Partial<ClaimSyncSnapshot>): ClaimSyncSnapshot {
  snapshot = { ...snapshot, ...update };
  listeners.forEach((listener) => listener(snapshot));
  return snapshot;
}

export function getClaimSyncSnapshot(): ClaimSyncSnapshot {
  return snapshot;
}

export function subscribeToClaimSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export async function refreshClaimSyncSnapshot(): Promise<ClaimSyncSnapshot> {
  const [user, network] = await Promise.all([
    mobileAuthService.getCurrentUser(),
    NetInfo.fetch(),
  ]);

  const pendingCount = user?.id ? await countTotalPendingClaims(user.id) : 0;
  return publish({
    online: isOnline(network),
    pendingCount,
  });
}

/**
 * Scan all pending claims across distributions or for a specific distribution,
 * and batch-upload to the server.
 */
export async function syncPendingClaims(targetDistributionId?: string): Promise<SyncClaimsResult> {
  if (syncPromise) return syncPromise;

  syncPromise = (async (): Promise<SyncClaimsResult> => {
    const emptyResult: SyncClaimsResult = { syncedCount: 0, duplicateCount: 0, failedCount: 0 };
    const user = await mobileAuthService.getCurrentUser();
    if (!user?.id) {
      publish({ syncing: false });
      return emptyResult;
    }

    const network = await NetInfo.fetch();
    if (!isOnline(network)) {
      const pendingCount = await countTotalPendingClaims(user.id);
      publish({ online: false, syncing: false, pendingCount });
      return emptyResult;
    }

    publish({ online: true, syncing: true, error: undefined });

    const deviceId = await getStableScannerDeviceId();
    const staffId = user.id;

    // Collect distribution IDs to sync
    const distributionIdsToSync = new Set<string>();
    if (targetDistributionId) {
      distributionIdsToSync.add(targetDistributionId);
    } else {
      // Find all claim files for this staff member
      const staffFolder = `${FileSystem.documentDirectory || ''}scanner-offline/${staffId.replace(/[^a-zA-Z0-9_-]/g, '_')}/`;
      const dirInfo = await FileSystem.getInfoAsync(staffFolder);
      if (dirInfo.exists) {
        const files = await FileSystem.readDirectoryAsync(staffFolder);
        for (const file of files) {
          if (file.startsWith('claims-') && file.endsWith('.json')) {
            const distId = file.slice('claims-'.length, -'.json'.length);
            if (distId) distributionIdsToSync.add(distId);
          }
        }
      }
    }

    let totalSynced = 0;
    let totalDuplicate = 0;
    let totalFailed = 0;

    for (const distId of distributionIdsToSync) {
      const claims = await listOfflineClaims(staffId, distId);
      const pending = claims.filter((c) => c.status === 'PENDING' || c.status === 'FAILED');
      if (pending.length === 0) continue;

      // Mark as syncing
      for (const item of pending) {
        await updateOfflineClaimStatus(staffId, distId, item.clientGeneratedId, 'SYNCING');
      }

      // Batch in chunks of 50
      const BATCH_SIZE = 50;
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);

        try {
          const response = await mobileAuthService.authenticatedRequest<{
            success: boolean;
            data?: {
              synced: Array<{
                clientGeneratedId: string;
                syncStatus: 'Synced' | 'Duplicate' | 'Failed';
                claimId?: string;
                residentId: string;
                residentCode?: string;
                error?: string;
              }>;
            };
            message?: string;
          }>('/distributions/scanner/sync-claims', {
            method: 'POST',
            body: JSON.stringify({
              deviceId,
              distributionId: distId,
              claims: batch.map((c) => ({
                clientGeneratedId: c.clientGeneratedId,
                residentId: c.residentId,
                residentCode: c.residentCode,
                scannedAt: c.scannedAt,
              })),
            }),
          });

          if (response.success && response.data?.success && response.data.data?.synced) {
            const syncedResults = response.data.data.synced;
            const toRemove: string[] = [];

            for (const res of syncedResults) {
              if (res.syncStatus === 'Synced' || res.syncStatus === 'Duplicate') {
                toRemove.push(res.clientGeneratedId);
                if (res.syncStatus === 'Synced') totalSynced += 1;
                else totalDuplicate += 1;
              } else {
                totalFailed += 1;
                await updateOfflineClaimStatus(
                  staffId,
                  distId,
                  res.clientGeneratedId,
                  'FAILED',
                  res.error || 'Server rejected claim',
                );
              }
            }

            if (toRemove.length > 0) {
              await removeOfflineClaims(staffId, distId, toRemove);
            }
          } else {
            // Whole batch failed
            const errMsg = response.error || response.data?.message || 'Failed to sync batch';
            for (const item of batch) {
              totalFailed += 1;
              await updateOfflineClaimStatus(staffId, distId, item.clientGeneratedId, 'FAILED', errMsg);
            }
          }
        } catch (err: any) {
          const errMsg = err?.message || 'Network error syncing offline claims';
          for (const item of batch) {
            totalFailed += 1;
            await updateOfflineClaimStatus(staffId, distId, item.clientGeneratedId, 'FAILED', errMsg);
          }
        }
      }
    }

    const pendingCount = await countTotalPendingClaims(staffId);
    publish({
      online: true,
      syncing: false,
      pendingCount,
      lastSyncedAt: totalSynced > 0 || totalDuplicate > 0 ? new Date().toISOString() : snapshot.lastSyncedAt,
      error: totalFailed > 0 ? `${totalFailed} claim(s) failed to sync` : undefined,
    });

    return {
      syncedCount: totalSynced,
      duplicateCount: totalDuplicate,
      failedCount: totalFailed,
    };
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

/**
 * Start network monitoring coordinator for automatic sync on reconnection.
 */
export function startClaimSyncCoordinator(): () => void {
  if (!unsubscribeNetInfo) {
    let wasOnline: boolean | null = null;
    unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const online = isOnline(state);
      publish({ online });
      if (online && wasOnline === false) {
        // Just reconnected to the internet! Automatically sync pending claims.
        syncPendingClaims().catch(() => undefined);
      }
      wasOnline = online;
    });
  }

  refreshClaimSyncSnapshot().catch(() => undefined);
  return () => {
    unsubscribeNetInfo?.();
    unsubscribeNetInfo = null;
  };
}
