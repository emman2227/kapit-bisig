import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Vibration,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { mobileAuthService } from '../services/auth/MobileAuthService';
import { parseQrToken } from '../services/sync/QrTokenParser';
import {
  saveDistributionRoster,
  loadDistributionRoster,
  isResidentClaimedLocally,
  addOfflineClaim,
  listOfflineClaims,
  saveScannerAssignments,
  loadScannerAssignments,
  listDownloadedRosters,
  type OfflineRosterData,
} from '../services/sync/ScannerOfflineStore';
import {
  getClaimSyncSnapshot,
  subscribeToClaimSync,
  refreshClaimSyncSnapshot,
  syncPendingClaims,
  type ClaimSyncSnapshot,
} from '../services/sync/ClaimSyncCoordinator';
import BottomNavigation, { BottomTab } from './ui/BottomNavigation';

interface VolunteerQRScannerScreenProps {
  onBack: () => void;
  onNavigate?: (screen: BottomTab) => void;
}

interface ResolvedResident {
  residentId: string;
  fullName?: string;
  maskedName?: string;
  alreadyClaimed?: boolean;
  justClaimed?: boolean;
  fromCache?: boolean;
}

interface ResolveQrPayload {
  success: boolean;
  message?: string;
  data?: ResolvedResident;
}

interface ScannerDistribution {
  id: string;
  barangay: string;
  assignedBarangays?: string[];
  scheduled?: string;
  endsAt?: string;
  status?: string;
  lifecycleStatus?: 'Upcoming' | 'Active' | 'Completed' | 'Archived';
  registeredHouseholds?: number;
  claimedHouseholds?: number;
}
type ScannerTone = 'ready' | 'working' | 'success' | 'warning' | 'error';

function formatScheduleLabel(value?: string): string {
  if (!value) return 'No schedule yet';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getToneStyles(tone: ScannerTone) {
  if (tone === 'success') {
    return {
      chipBg: '#DCFCE7',
      chipText: '#166534',
      panelBg: '#F4FFF7',
      panelBorder: '#BBF7D0',
      icon: 'checkmark-circle' as const,
      iconColor: '#16A34A',
    };
  }

  if (tone === 'warning') {
    return {
      chipBg: '#FEF3C7',
      chipText: '#92400E',
      panelBg: '#FFFDF6',
      panelBorder: '#FCD34D',
      icon: 'alert-circle' as const,
      iconColor: '#D97706',
    };
  }

  if (tone === 'error') {
    return {
      chipBg: '#FEE2E2',
      chipText: '#B91C1C',
      panelBg: '#FFF8F8',
      panelBorder: '#FECACA',
      icon: 'close-circle' as const,
      iconColor: '#DC2626',
    };
  }

  if (tone === 'working') {
    return {
      chipBg: '#DBEAFE',
      chipText: '#1D4ED8',
      panelBg: '#F8FBFF',
      panelBorder: '#BFDBFE',
      icon: 'scan-circle' as const,
      iconColor: '#2563EB',
    };
  }

  return {
    chipBg: '#E2E8F0',
    chipText: '#334155',
    panelBg: '#FFFFFF',
    panelBorder: '#E2E8F0',
    icon: 'qr-code-outline' as const,
    iconColor: '#475569',
  };
}

export default function VolunteerQRScannerScreen({ onBack, onNavigate }: VolunteerQRScannerScreenProps) {
  const SCAN_COOLDOWN_MS = 1500;
  const [permission, requestPermission] = useCameraPermissions();
  const [isResolving, setIsResolving] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedResident, setResolvedResident] = useState<ResolvedResident | null>(null);
  const [resolveLatencyMs, setResolveLatencyMs] = useState<number | null>(null);
  const [activeDistribution, setActiveDistribution] = useState<ScannerDistribution | null>(null);
  const [activeDistributions, setActiveDistributions] = useState<ScannerDistribution[]>([]);
  const [nearestUpcoming, setNearestUpcoming] = useState<ScannerDistribution | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [claimStatusText, setClaimStatusText] = useState<string | null>(null);
  const lastScanRef = useRef<{ data: string; at: number } | null>(null);
  const toMaskedName = (rawName?: string): string => {
    const parts = String(rawName || '')
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
  };

  const [syncSnapshot, setSyncSnapshot] = useState<ClaimSyncSnapshot>(getClaimSyncSnapshot());
  const [hasRoster, setHasRoster] = useState(false);
  const [isDownloadingRoster, setIsDownloadingRoster] = useState(false);
  const [rosterStats, setRosterStats] = useState<{ total: number; claimed: number } | null>(null);
  const [offlineClaimsCount, setOfflineClaimsCount] = useState(0);

  useEffect(() => {
    return subscribeToClaimSync(setSyncSnapshot);
  }, []);

  const targetDistId = activeDistribution?.id || nearestUpcoming?.id;

  useEffect(() => {
    const checkRoster = async () => {
      if (!targetDistId) {
        setHasRoster(false);
        setRosterStats(null);
        setOfflineClaimsCount(0);
        return;
      }
      const user = await mobileAuthService.getCurrentUser();
      if (!user?.id) return;

      const [roster, localClaims] = await Promise.all([
        loadDistributionRoster(user.id, targetDistId),
        listOfflineClaims(user.id, targetDistId),
      ]);

      if (roster) {
        setHasRoster(true);
        setRosterStats({ total: roster.totalCount, claimed: roster.claimedCount });
      } else {
        setHasRoster(false);
        setRosterStats(null);
      }
      setOfflineClaimsCount(localClaims.length);
    };

    checkRoster().catch(() => undefined);
  }, [targetDistId, activeDistribution?.id, nearestUpcoming?.id]);

  const handleDownloadOfflineRoster = async () => {
    const dist = activeDistribution || nearestUpcoming;
    if (!dist?.id) return;
    setIsDownloadingRoster(true);
    try {
      const user = await mobileAuthService.getCurrentUser();
      if (!user?.id) {
        Alert.alert('Error', 'Please log in again.');
        return;
      }

      const response = await mobileAuthService.authenticatedRequest<{
        success: boolean;
        data?: OfflineRosterData;
        message?: string;
      }>(`/distributions/scanner/roster/${dist.id}`, { method: 'GET' });

      if (response.success && response.data?.success && response.data.data) {
        const rosterData = response.data.data;
        await saveDistributionRoster(user.id, dist.id, rosterData);
        setHasRoster(true);
        setRosterStats({ total: rosterData.totalCount, claimed: rosterData.claimedCount });
        Alert.alert('Ready for Offline', `Downloaded ${rosterData.totalCount} eligible residents. You can now scan without internet!`);
      } else {
        Alert.alert('Download Failed', response.error || response.data?.message || 'Unable to download roster.');
      }
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || 'Network error downloading roster.');
    } finally {
      setIsDownloadingRoster(false);
    }
  };

  const handleManualSync = async () => {
    if (syncSnapshot.syncing) return;
    try {
      const result = await syncPendingClaims(targetDistId);
      if (result.syncedCount > 0 || result.duplicateCount > 0) {
        Alert.alert(
          'Sync Complete',
          `Successfully synced ${result.syncedCount} claim(s)${result.duplicateCount > 0 ? ` (${result.duplicateCount} duplicate)` : ''}.${result.failedCount > 0 ? `\n${result.failedCount} claim(s) failed.` : ''}`
        );
      } else if (result.failedCount > 0) {
        Alert.alert('Sync Failed', `${result.failedCount} claim(s) failed to sync with the server.`);
      }
      if (targetDistId) {
        const user = await mobileAuthService.getCurrentUser();
        if (user?.id) {
          const localClaims = await listOfflineClaims(user.id, targetDistId);
          setOfflineClaimsCount(localClaims.length);
        }
      }
    } catch (err: any) {
      Alert.alert('Sync Error', err?.message || 'Failed to sync offline claims.');
    }
  };

  useEffect(() => {
    return () => {
      lastScanRef.current = null;
    };
  }, []);

  const loadActiveDistributions = useCallback(async () => {
    const user = await mobileAuthService.getCurrentUser();
    const staffId = user?.id;

    const response = await mobileAuthService.authenticatedRequest<{
      success: boolean;
      data?: {
        active: Array<ScannerDistribution & { _id?: string }>;
        nearestUpcoming?: (ScannerDistribution & { _id?: string }) | null;
      };
    }>('/distributions/scanner/active', { method: 'GET' });

    const normalize = (item: ScannerDistribution & { _id?: string }): ScannerDistribution => ({
      ...item,
      id: item.id || item._id || '',
      assignedBarangays: item.assignedBarangays || [],
    });

    if (response.success && response.data?.success && response.data.data) {
      const active = (response.data.data.active || []).map(normalize).filter((item) => item.id);
      const upcoming = response.data.data.nearestUpcoming
        ? normalize(response.data.data.nearestUpcoming)
        : null;

      if (staffId) {
        await saveScannerAssignments(staffId, { active, nearestUpcoming: upcoming }).catch(() => undefined);
      }

      setActiveDistributions(active);
      setNearestUpcoming(upcoming);
      setActiveDistribution(active.length === 1 ? active[0] : null);
      setAssignmentMessage(
        active.length > 1
          ? 'Choose which active distribution this scanner should record claims against.'
          : active.length === 0 && upcoming
            ? `No active distribution. Your nearest assignment starts ${formatScheduleLabel(upcoming.scheduled)}.`
            : active.length === 0
              ? 'No active or upcoming distribution is explicitly assigned to this account.'
              : null,
      );
      return;
    }

    // Offline / Network Failure Fallback
    if (staffId) {
      const cached = await loadScannerAssignments(staffId).catch(() => null);
      const downloadedRosters = await listDownloadedRosters(staffId).catch(() => []);

      if (cached && (cached.active.length > 0 || cached.nearestUpcoming)) {
        const active = (cached.active || []).map(normalize).filter((item) => item.id);
        const upcoming = cached.nearestUpcoming ? normalize(cached.nearestUpcoming) : null;
        setActiveDistributions(active);
        setNearestUpcoming(upcoming);
        setActiveDistribution(active.length === 1 ? active[0] : (active[0] || upcoming || null));
        setAssignmentMessage(
          active.length > 0
            ? `Offline Mode: Using cached assignments (${active.length} active).`
            : 'Offline Mode: Upcoming assignment cached.'
        );
        return;
      }

      if (downloadedRosters.length > 0) {
        const offlineFromRosters: ScannerDistribution[] = downloadedRosters.map((r) => ({
          id: r.distributionId,
          barangay: r.barangay,
          assignedBarangays: r.assignedBarangays,
          status: 'Active',
          lifecycleStatus: 'Active',
          registeredHouseholds: r.totalCount,
          claimedHouseholds: r.claimedCount,
        }));
        setActiveDistributions(offlineFromRosters);
        setNearestUpcoming(null);
        setActiveDistribution(offlineFromRosters[0] || null);
        setAssignmentMessage(`Offline Mode: Loaded ${offlineFromRosters.length} downloaded roster distribution(s).`);
        return;
      }
    }

    setAssignmentMessage(response.error || 'Unable to load scanner assignments. Connect online once or download roster.');
  }, []);

  useEffect(() => {
    loadActiveDistributions().catch(() => {
      setAssignmentMessage('Unable to load scanner assignments.');
    });
  }, [loadActiveDistributions]);

  const playSuccessFeedback = async () => {    Vibration.vibrate(80);
  };

  const handleQrScanned = async ({ data }: { data: string }) => {
    if (!data || isResolving || hasScanned) {
      return;
    }

    const now = Date.now();
    if (
      lastScanRef.current &&
      lastScanRef.current.data === data &&
      now - lastScanRef.current.at < SCAN_COOLDOWN_MS
    ) {
      return;
    }

    lastScanRef.current = { data, at: now };
    Vibration.vibrate(40);

    setHasScanned(true);
    setIsResolving(true);
    setError(null);
    setResolvedResident(null);
    setResolveLatencyMs(null);
    setClaimStatusText(null);
    const startedAt = Date.now();

    const resolveOfflineScan = async (targetDist: ScannerDistribution, isNetworkFallback = false): Promise<boolean> => {
      const user = await mobileAuthService.getCurrentUser();
      if (!user?.id) {
        setError('Session not found. Please log in.');
        setResolveLatencyMs(Date.now() - startedAt);
        setIsResolving(false);
        return false;
      }

      const rosterData = await loadDistributionRoster(user.id, targetDist.id);
      if (!rosterData || !rosterData.roster || rosterData.roster.length === 0) {
        if (!isNetworkFallback) {
          setError('Offline mode: No downloaded roster found for this distribution. Please connect to internet to download the roster first.');
        }
        return false;
      }

      const parsed = parseQrToken(data);
      if (!parsed || !parsed.residentCode) {
        setError('Invalid or unrecognized QR code format.');
        setResolveLatencyMs(Date.now() - startedAt);
        setIsResolving(false);
        return true;
      }

      const resident = rosterData.roster.find(
        (r) => r.residentCode.toUpperCase() === parsed.residentCode.toUpperCase()
      );

      if (!resident) {
        setError(`Resident (${parsed.residentCode}) is not in this distribution's eligible roster.`);
        setResolveLatencyMs(Date.now() - startedAt);
        setIsResolving(false);
        return true;
      }

      setResolvedResident({
        residentId: resident.residentId,
        fullName: resident.maskedName,
        maskedName: resident.maskedName,
        fromCache: true,
      });

      // Check if already claimed locally or in roster
      const alreadyClaimedLocally = await isResidentClaimedLocally(user.id, targetDist.id, resident.residentId);
      if (resident.alreadyClaimed || alreadyClaimedLocally) {
        setClaimStatusText('Resident already claimed for this distribution.');
        setResolvedResident((prev) => (prev ? { ...prev, alreadyClaimed: true, justClaimed: false } : prev));
        await playSuccessFeedback();
        setResolveLatencyMs(Date.now() - startedAt);
        setIsResolving(false);
        return true;
      }

      if (!activeDistribution?.id) {
        // Upcoming distribution pre-check only
        setClaimStatusText(
          `Pre-check verified for Barangay ${targetDist.barangay}. Distribution starts at ${formatScheduleLabel(targetDist.scheduled)}. Supplies cannot be claimed yet.`
        );
        await playSuccessFeedback();
        setResolveLatencyMs(Date.now() - startedAt);
        setIsResolving(false);
        return true;
      }

      // Record offline claim
      await addOfflineClaim(user.id, activeDistribution.id, {
        clientGeneratedId: `off-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        distributionId: activeDistribution.id,
        residentId: resident.residentId,
        residentCode: resident.residentCode,
        maskedName: resident.maskedName,
        scannedAt: new Date().toISOString(),
      });

      setOfflineClaimsCount((prev) => prev + 1);
      setActiveDistribution((prev) => (prev ? { ...prev, claimedHouseholds: (prev.claimedHouseholds || 0) + 1 } : prev));
      setActiveDistributions((prev) =>
        prev.map((d) => (d.id === activeDistribution.id ? { ...d, claimedHouseholds: (d.claimedHouseholds || 0) + 1 } : d))
      );

      setClaimStatusText(
        isNetworkFallback
          ? 'Network unstable: Claim recorded offline in local roster. Relief can be released.'
          : 'Claim recorded offline. Relief can now be released. (Will sync when reconnected)'
      );
      setResolvedResident((prev) => (prev ? { ...prev, alreadyClaimed: false, justClaimed: true } : prev));
      await playSuccessFeedback();
      setResolveLatencyMs(Date.now() - startedAt);
      setIsResolving(false);
      refreshClaimSyncSnapshot().catch(() => undefined);
      return true;
    };

    if (!syncSnapshot.online) {
      // OFFLINE MODE SCANNING
      const targetDistribution = activeDistribution || nearestUpcoming;
      if (!targetDistribution?.id) {
        setError('No distribution selected to record claims against.');
        setResolveLatencyMs(Date.now() - startedAt);
        setIsResolving(false);
        return;
      }

      const resolved = await resolveOfflineScan(targetDistribution, false);
      if (resolved) return;
      setResolveLatencyMs(Date.now() - startedAt);
      setIsResolving(false);
      return;
    }

    const targetDistribution = activeDistribution || nearestUpcoming;
    const targetDistributionId = targetDistribution?.id;

    let response;
    try {
      response = await mobileAuthService.authenticatedRequest<ResolveQrPayload>('/household/qr/resolve', {
        method: 'POST',
        body: JSON.stringify({
          qrData: data,
          distributionId: targetDistributionId,
        }),
      });
    } catch {
      response = null;
    }

    if (!response || !response.success || !response.data) {
      // Network error occurred during online resolution — try falling back to local downloaded roster
      if (targetDistribution?.id) {
        const fellBack = await resolveOfflineScan(targetDistribution, true);
        if (fellBack) return;
      }

      setError(response?.error || 'Network error resolving QR code. Please check connection or download roster.');
      setResolveLatencyMs(Date.now() - startedAt);
      setIsResolving(false);
      return;
    }

    if (!response.data.success || !response.data.data) {
      setError(response.data.message || 'Invalid resident QR.');
      setResolveLatencyMs(Date.now() - startedAt);
      setIsResolving(false);
      return;
    }

    const resident = response.data.data;
    setResolvedResident(resident);
    await playSuccessFeedback();
    setResolveLatencyMs(Date.now() - startedAt);

    if (activeDistribution?.id && resident.residentId && !resident.alreadyClaimed) {
      const claimResponse = await mobileAuthService.authenticatedRequest<{
        success: boolean;
        message?: string;
        alreadyClaimed?: boolean;
      }>('/household/qr/claim', {
        method: 'POST',
        body: JSON.stringify({
          residentId: resident.residentId,
          distributionId: activeDistribution.id,
        }),
      });

      if (claimResponse.success && claimResponse.data?.success) {
        if (claimResponse.data.alreadyClaimed) {
          setClaimStatusText('Resident already claimed for this distribution.');
          setResolvedResident((prev) => (prev ? { ...prev, alreadyClaimed: true, justClaimed: false } : prev));
        } else {
          setClaimStatusText('Claim recorded. Relief can now be released.');
          setResolvedResident((prev) => (prev ? { ...prev, alreadyClaimed: false, justClaimed: true } : prev));
          setActiveDistribution((prev) => (prev ? { ...prev, claimedHouseholds: (prev.claimedHouseholds || 0) + 1 } : prev));
          setActiveDistributions((prev) =>
            prev.map((d) => (d.id === activeDistribution.id ? { ...d, claimedHouseholds: (d.claimedHouseholds || 0) + 1 } : d))
          );
        }
      } else {
        setClaimStatusText(claimResponse.error || claimResponse.data?.message || 'Claim record failed.');
      }
    } else if (resident.alreadyClaimed) {
      setClaimStatusText('Resident already claimed for this distribution.');
      setResolvedResident((prev) => (prev ? { ...prev, alreadyClaimed: true, justClaimed: false } : prev));
    } else if (!activeDistribution?.id) {
      if (nearestUpcoming) {
        setClaimStatusText(
          `Pre-check verified for Barangay ${nearestUpcoming.barangay}. Distribution starts at ${formatScheduleLabel(nearestUpcoming.scheduled)}. Supplies cannot be claimed yet.`,
        );
      } else {
        setClaimStatusText('Resident is verified, but you are not assigned to an active distribution. No claim was recorded.');
      }
    }

    setIsResolving(false);
  };

  const handleScanAgain = () => {
    setHasScanned(false);
    setError(null);
    setResolvedResident(null);
    setResolveLatencyMs(null);
    setClaimStatusText(null);
  };

  const handleRefresh = async () => {
    handleScanAgain();
    await loadActiveDistributions().catch(() => {
      setAssignmentMessage('Unable to load scanner assignments.');
    });
  };

  const displayedDistribution = activeDistribution || nearestUpcoming;
  const isLive = Boolean(activeDistribution);
  const isUpcoming = !activeDistribution && Boolean(nearestUpcoming);

  const registeredCount = displayedDistribution?.registeredHouseholds || 0;
  const claimedCount = displayedDistribution?.claimedHouseholds || 0;
  const progressPercent = registeredCount > 0
    ? Math.min(100, Math.round((claimedCount / registeredCount) * 100))
    : 0;

  const statusBadge = isLive
    ? {
        label: 'Live Distribution',
        icon: 'radio-button-on' as const,
        bg: '#ECFDF5',
        border: '#A7F3D0',
        text: '#047857',
        iconColor: '#059669',
      }
    : isUpcoming
      ? {
          label: 'Scheduled',
          icon: 'calendar-outline' as const,
          bg: '#EFF6FF',
          border: '#BFDBFE',
          text: '#1D4ED8',
          iconColor: '#2563EB',
        }
      : {
          label: 'No Assignment',
          icon: 'information-circle-outline' as const,
          bg: '#F1F5F9',
          border: '#CBD5E1',
          text: '#64748B',
          iconColor: '#64748B',
        };

  let scannerTone: ScannerTone = 'ready';
  if (isResolving) scannerTone = 'working';
  else if (error) scannerTone = 'error';
  else if (resolvedResident?.alreadyClaimed) scannerTone = 'warning';
  else if (resolvedResident?.justClaimed) scannerTone = 'success';
  else if (resolvedResident) {
    if (!activeDistribution?.id) {
      scannerTone = 'warning';
    } else {
      scannerTone = 'success';
    }
  }

  const tone = getToneStyles(scannerTone);

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBlock}>
          <ActivityIndicator color="#0F766E" />
          <Text style={styles.loadingText}>Preparing scanner...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.roundButton}>
            <Ionicons name="arrow-back" size={20} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Claim Scanner</Text>
          <View style={styles.roundButtonGhost} />
        </View>

        <View style={styles.permissionWrap}>
          <View style={styles.permissionIcon}>
            <Ionicons name="camera-outline" size={30} color="#0F766E" />
          </View>
          <Text style={styles.permissionTitle}>Camera access is needed</Text>
          <Text style={styles.permissionText}>
            Allow camera access so volunteer accounts can scan resident QR codes during distribution.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.roundButton}>
          <Ionicons name="arrow-back" size={20} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Claim Scanner</Text>
        <TouchableOpacity onPress={handleRefresh} style={styles.roundButton}>
          <Ionicons name="refresh-outline" size={20} color="#0F172A" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {!syncSnapshot.online && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={20} color="#9A3412" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.offlineBannerTitle}>Offline Scanner Mode</Text>
              <Text style={styles.offlineBannerSubtitle}>
                {hasRoster
                  ? `Scanning offline using local roster (${rosterStats?.total || 0} residents)`
                  : 'No local roster downloaded yet. Connect to internet to download.'}
              </Text>
            </View>
            {syncSnapshot.pendingCount > 0 && (
              <View style={styles.offlineBadge}>
                <Text style={styles.offlineBadgeText}>{syncSnapshot.pendingCount} pending</Text>
              </View>
            )}
          </View>
        )}

        {syncSnapshot.online && syncSnapshot.pendingCount > 0 && (
          <View style={styles.syncBanner}>
            <Ionicons name="cloud-upload-outline" size={20} color="#047857" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.syncBannerTitle}>Ready to Sync</Text>
              <Text style={styles.syncBannerSubtitle}>
                {syncSnapshot.pendingCount} offline claim(s) waiting to sync.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.syncButton}
              onPress={handleManualSync}
              disabled={syncSnapshot.syncing}
            >
              {syncSnapshot.syncing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.syncButtonText}>Sync Now</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.eyebrow}>Distribution Scanning</Text>
            <View style={[styles.stateChip, { backgroundColor: tone.chipBg }]}>
              <Text style={[styles.stateChipText, { color: tone.chipText }]}>
                {scannerTone === 'working'
                  ? 'Checking'
                  : scannerTone === 'success'
                    ? 'Claim Recorded'
                    : scannerTone === 'warning'
                      ? resolvedResident?.alreadyClaimed
                        ? 'Already Claimed'
                        : !activeDistribution?.id && nearestUpcoming
                          ? 'Pre-Check Only'
                          : 'No Active Drive'
                      : scannerTone === 'error'
                        ? 'Needs Retry'
                        : 'Ready'}
              </Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>Scan resident QR and confirm release</Text>

          <Text style={styles.heroSubtext}>
            Keep the QR inside the frame. Claims are recorded automatically when the resident is eligible for the active distribution.
          </Text>
        </View>

        <View style={styles.distributionCard}>
          <View style={styles.distributionTopRow}>
            <View style={styles.distributionHostBlock}>
              <View style={styles.eyebrowRow}>
                <Ionicons name="location-sharp" size={12} color="#0F766E" />
                <Text style={styles.distributionLabel}>Assigned Barangay</Text>
              </View>
              <Text style={styles.distributionHost}>
                {displayedDistribution?.barangay ? `Barangay ${displayedDistribution.barangay}` : 'No assigned distribution'}
              </Text>
            </View>
            <View style={[styles.distributionModePill, { backgroundColor: statusBadge.bg, borderColor: statusBadge.border }]}>
              <Ionicons name={statusBadge.icon} size={13} color={statusBadge.iconColor} />
              <Text style={[styles.distributionModeText, { color: statusBadge.text }]}>
                {statusBadge.label}
              </Text>
            </View>
          </View>

          {activeDistributions.length > 1 && (
            <View style={styles.assignmentChooser}>
              <Text style={styles.assignmentChooserTitle}>Choose target barangay</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assignmentChips}>
                {activeDistributions.map((distribution) => {
                  const isSelected = activeDistribution?.id === distribution.id;
                  return (
                    <TouchableOpacity
                      key={distribution.id}
                      style={[
                        styles.assignmentChoice,
                        isSelected && styles.assignmentChoiceSelected,
                      ]}
                      onPress={() => {
                        setActiveDistribution(distribution);
                        setAssignmentMessage(null);
                        handleScanAgain();
                      }}
                    >
                      <Ionicons
                        name={isSelected ? 'checkmark-circle' : 'location-outline'}
                        size={14}
                        color={isSelected ? '#0F766E' : '#64748B'}
                      />
                      <Text style={[
                        styles.assignmentChoiceTitle,
                        isSelected && styles.assignmentChoiceTitleSelected,
                      ]}>
                        Barangay {distribution.barangay}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {isLive ? (
            <View style={styles.liveNotice}>
              <Ionicons name="checkmark-circle" size={16} color="#059669" />
              <Text style={styles.liveNoticeText}>
                Active distribution. QR scans verify eligibility and record claims automatically.
              </Text>
            </View>
          ) : isUpcoming ? (
            <View style={styles.upcomingNotice}>
              <Ionicons name="time-outline" size={16} color="#1D4ED8" />
              <Text style={styles.upcomingNoticeText}>
                {assignmentMessage || `Starts ${formatScheduleLabel(displayedDistribution?.scheduled)}. Pre-check resident eligibility ahead of distribution.`}
              </Text>
            </View>
          ) : !!assignmentMessage ? (
            <TouchableOpacity onPress={handleRefresh} style={styles.assignmentNotice} activeOpacity={0.7}>
              <Ionicons name="information-circle-outline" size={16} color="#B45309" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.assignmentNoticeText}>{assignmentMessage}</Text>
                <Text style={[styles.assignmentNoticeText, { fontWeight: '600', marginTop: 2 }]}>Tap here to retry</Text>
              </View>
              <Ionicons name="refresh" size={16} color="#B45309" />
            </TouchableOpacity>
          ) : null}

          <View style={styles.distributionMetaRow}>
            <View style={styles.metaItem}>
              <View style={styles.metaLabelRow}>
                <Ionicons name="calendar-outline" size={12} color="#64748B" />
                <Text style={styles.metaLabel}>Schedule</Text>
              </View>
              <Text style={styles.metaValue}>{formatScheduleLabel(displayedDistribution?.scheduled)}</Text>
              <Text style={styles.metaSubtext}>
                {isLive ? 'Live relief drive' : isUpcoming ? 'Upcoming event' : 'No active schedule'}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <View style={styles.metaLabelRow}>
                <Ionicons name="people-outline" size={12} color="#64748B" />
                <Text style={styles.metaLabel}>Claims & Target</Text>
              </View>
              <Text style={styles.metaValue}>
                {registeredCount > 0
                  ? `${claimedCount} / ${registeredCount}`
                  : claimedCount > 0
                    ? `${claimedCount} claimed`
                    : '0 claimed'}
              </Text>
              {registeredCount > 0 ? (
                <View style={styles.progressWrap}>
                  <View style={styles.progressBarTrack}>
                    <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
                  </View>
                  <Text style={styles.metaSubtext}>{progressPercent}% completed</Text>
                </View>
              ) : (
                <Text style={styles.metaSubtext}>Per-barangay relief</Text>
              )}
            </View>
          </View>

          {displayedDistribution?.id && (
            <View style={styles.offlineSection}>
              <View style={styles.offlineRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.offlineSectionTitleRow}>
                    <Ionicons
                      name={hasRoster ? 'shield-checkmark-outline' : 'cloud-offline-outline'}
                      size={15}
                      color={hasRoster ? '#059669' : '#D97706'}
                    />
                    <Text style={styles.offlineSectionTitle}>Offline Scanner Mode</Text>
                  </View>
                  <Text style={styles.offlineSectionSubtitle}>
                    {hasRoster
                      ? `Ready: ${rosterStats?.total || 0} residents loaded on this phone`
                      : 'Download roster ahead of time to scan without internet'}
                  </Text>
                  {offlineClaimsCount > 0 && (
                    <Text style={styles.offlineClaimsCountText}>
                      📦 {offlineClaimsCount} claim(s) recorded locally on this device
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.downloadRosterButton, isDownloadingRoster && { opacity: 0.7 }]}
                  onPress={handleDownloadOfflineRoster}
                  disabled={isDownloadingRoster}
                >
                  {isDownloadingRoster ? (
                    <ActivityIndicator size="small" color="#0F766E" />
                  ) : (
                    <>
                      <Ionicons
                        name={hasRoster ? 'refresh-outline' : 'download-outline'}
                        size={14}
                        color="#0F766E"
                      />
                      <Text style={styles.downloadRosterButtonText}>
                        {hasRoster ? 'Update' : 'Download'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.scannerCard}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>Live QR Frame</Text>
              <Text style={styles.scannerHint}>
                {hasScanned ? 'Scanner is paused until you reset.' : 'Position the code inside the frame for fast validation.'}
              </Text>
            </View>
            <View style={styles.scannerBadge}>
              <Text style={styles.scannerBadgeText}>{hasScanned ? 'Paused' : 'Scanning'}</Text>
            </View>
          </View>

          <View style={styles.cameraShell}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={hasScanned ? undefined : handleQrScanned}
            />

            <View style={styles.cameraShadeTop} />
            <View style={styles.cameraShadeBottom}>
              <Text style={styles.overlayCaption}>Align permanent resident QR inside the scan area</Text>
            </View>

            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
              {!hasScanned && <View style={styles.scanLine} />}
            </View>
          </View>
        </View>

        <View style={[styles.feedbackCard, { backgroundColor: tone.panelBg, borderColor: tone.panelBorder }]}>
          <View style={styles.feedbackHeader}>
            <View style={[styles.feedbackIconWrap, { backgroundColor: tone.chipBg }]}>
              {isResolving ? (
                <ActivityIndicator size="small" color={tone.iconColor} />
              ) : (
                <Ionicons name={tone.icon} size={22} color={tone.iconColor} />
              )}
            </View>
            <View style={styles.feedbackTextWrap}>
              <Text style={styles.feedbackTitle}>
                {isResolving
                  ? 'Checking resident eligibility'
                  : error
                    ? 'Scanner needs another try'
                    : resolvedResident?.alreadyClaimed
                      ? 'Resident already claimed'
                      : resolvedResident?.justClaimed
                        ? 'Resident Verified & Claim Recorded'
                        : resolvedResident
                          ? !activeDistribution?.id
                            ? nearestUpcoming
                              ? 'Pre-Check Verified (Upcoming)'
                              : 'Resident Found (No Active Distribution)'
                            : 'Resident Verified & Claim Recorded'
                          : 'Ready for the next scan'}
              </Text>
              <Text style={styles.feedbackSubtitle}>
                {isResolving
                  ? 'We are resolving the QR and validating the active distribution.'
                  : error
                    ? error
                    : resolvedResident
                      ? claimStatusText || 'Resident record resolved successfully.'
                      : isLive
                        ? 'Scanner is linked to this live distribution. Claims will be recorded.'
                        : 'Distribution is scheduled. Scans will verify resident eligibility ahead of release.'}
              </Text>
            </View>
          </View>

          {!isResolving && resolvedResident && (
            <View style={styles.personCard}>
              <View style={styles.personAvatar}>
                <Text style={styles.personAvatarText}>
                  {(resolvedResident.maskedName || toMaskedName(resolvedResident.fullName)).slice(0, 1)}
                </Text>
              </View>
              <View style={styles.personBody}>
                <Text style={styles.personName}>
                  {resolvedResident.maskedName || toMaskedName(resolvedResident.fullName)}
                </Text>
                <Text style={styles.personMeta}>
                  {resolvedResident.fromCache ? 'Resolved from offline cache' : 'Resolved from live server'}
                </Text>
                {resolveLatencyMs !== null && (
                  <Text style={styles.personMeta}>Response time: {resolveLatencyMs} ms</Text>
                )}
              </View>
            </View>
          )}

          {!isResolving && (
            <TouchableOpacity style={styles.primaryButton} onPress={handleScanAgain}>
              <Text style={styles.primaryButtonText}>
                {resolvedResident || error ? 'Scan Next Resident' : 'Reset Scanner'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tipsCard}>
          <View style={styles.tipRow}>
            <Ionicons name="checkmark-circle-outline" size={18} color="#0F766E" />
            <Text style={styles.tipText}>Use good lighting and hold the device steady for faster reads.</Text>
          </View>
          <View style={styles.tipRow}>
            <Ionicons name="location-outline" size={18} color="#0F766E" />
            <Text style={styles.tipText}>
              Relief distribution is conducted per barangay. Ensure the resident is registered under Barangay {displayedDistribution?.barangay || 'the target area'}.
            </Text>
          </View>
        </View>
      </ScrollView>
      <BottomNavigation
        activeTab="qr"
        onNavigate={onNavigate || ((screen) => (screen === 'home' ? onBack() : undefined))}
        showDistributions={false}
        showScan={true}
        appearance="resident"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F7F3',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#F4F7F3',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  roundButtonGhost: {
    width: 40,
    height: 40,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingBottom: 88,
    gap: 14,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: '#0F766E',
    letterSpacing: 1.1,
    flexShrink: 1,
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.6,
  },
  heroSubtext: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  stateChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  stateChipText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  distributionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 14,
  },
  distributionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  distributionHostBlock: {
    flex: 1,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distributionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#0F766E',
    letterSpacing: 0.8,
  },
  distributionHost: {
    marginTop: 5,
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  distributionModePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  distributionModeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  assignmentChooser: {
    gap: 8,
  },
  assignmentChooserTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  assignmentChips: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  assignmentChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
  },
  assignmentChoiceSelected: {
    borderColor: '#0F766E',
    backgroundColor: '#F0FDFA',
  },
  assignmentChoiceTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  assignmentChoiceTitleSelected: {
    color: '#0F766E',
    fontWeight: '800',
  },
  liveNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 14,
    padding: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  liveNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#065F46',
    fontWeight: '600',
  },
  upcomingNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 14,
    padding: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  upcomingNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#1E40AF',
    fontWeight: '600',
  },
  assignmentNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 14,
    padding: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  assignmentNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#92400E',
    fontWeight: '600',
  },
  distributionMetaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metaItem: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  metaLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metaValue: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: '#0F172A',
  },
  metaSubtext: {
    marginTop: 3,
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  progressWrap: {
    marginTop: 6,
    gap: 3,
  },
  progressBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0F766E',
    borderRadius: 2,
  },
  scannerCard: {
    backgroundColor: '#0F172A',
    borderRadius: 28,
    padding: 16,
    gap: 14,
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start',
  },
  scannerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  scannerHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: '#CBD5E1',
    maxWidth: 220,
  },
  scannerBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  scannerBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F8FAFC',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cameraShell: {
    width: '100%',
    aspectRatio: 0.92,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#020617',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  cameraShadeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 76,
    backgroundColor: 'rgba(2,6,23,0.28)',
  },
  cameraShadeBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 18,
    paddingHorizontal: 20,
    paddingTop: 30,
    alignItems: 'center',
    backgroundColor: 'rgba(2,6,23,0.36)',
  },
  overlayCaption: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  scanFrame: {
    position: 'absolute',
    left: '12%',
    right: '12%',
    top: '18%',
    bottom: '22%',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  scanLine: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: '46%',
    height: 3,
    borderRadius: 999,
    backgroundColor: '#34D399',
    opacity: 0.95,
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#34D399',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 22,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 22,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 22,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 22,
  },
  feedbackCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  feedbackIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackTextWrap: {
    flex: 1,
  },
  feedbackTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  feedbackSubtitle: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  personCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  personAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personAvatarText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  personBody: {
    flex: 1,
  },
  personName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  personMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748B',
  },
  tipsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  loadingBlock: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#0F766E',
    fontSize: 14,
    fontWeight: '600',
  },
  permissionWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  permissionIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  permissionTitle: {
    marginTop: 14,
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
  },
  permissionText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    color: '#475569',
  },
  primaryButton: {
    backgroundColor: '#0F766E',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.2,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEDD5',
    borderColor: '#FED7AA',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  offlineBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9A3412',
  },
  offlineBannerSubtitle: {
    fontSize: 12,
    color: '#C2410C',
    marginTop: 2,
  },
  offlineBadge: {
    backgroundColor: '#EA580C',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  offlineBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  syncBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  syncBannerSubtitle: {
    fontSize: 12,
    color: '#15803D',
    marginTop: 2,
  },
  syncButton: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  offlineSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  offlineSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  offlineSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  offlineSectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  offlineClaimsCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F766E',
    marginTop: 4,
  },
  downloadRosterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  downloadRosterButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
  },
});
