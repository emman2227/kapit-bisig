import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  deleteAllResidentNotifications,
  fetchActiveBeneficiaryEvent,
  fetchResidentNotifications,
  fetchResidentProofSubmissionStatus,
  getResidentSession,
  getResidentToken,
  markAllResidentNotificationsRead,
  markResidentNotificationRead,
  type ResidentDisasterEvent,
  type ResidentDistributionItem,
  type ResidentNotificationItem,
  type ResidentProofSubmissionStatus,
  type ResidentQrData,
} from '../services/api/ResidentQrService';
import {
  isCachedEventUsable,
  loadResidentOfflineCache,
  updateResidentOfflineCache,
} from '../services/sync/ResidentOfflineStore';
import { residentTheme } from '../theme';
import BottomNavigation from './ui/BottomNavigation';
import ResidentBrandLockup from './ui/ResidentBrandLockup';
import VirtualResidentIdCard from './VirtualResidentIdCard';
import { DistributionCardSkeleton } from './ui/Skeleton';

const residentColors = residentTheme.colors;

interface ResidentHomeDashboardScreenProps {
  userName?: string;
  barangayName?: string;
  residentStatus?: string;
  residentNote?: string;
  virtualIdData?: ResidentQrData | null;
  isVirtualIdLoading?: boolean;
  virtualIdError?: string | null;
  virtualIdWarning?: string | null;
  onRefreshVirtualId?: (force?: boolean) => Promise<void>;
  onRefreshProfile?: () => Promise<boolean | void>;
  distributionItems?: ResidentDistributionItem[];
  isDistributionLoading?: boolean;
  distributionWarning?: string | null;
  onRefreshDistributions?: (force?: boolean) => Promise<void>;
  onNavigate?: (
    screen: 'home' | 'distributions' | 'qr' | 'profile' | 'proof-request' | 'registration-revision'
  ) => void;
}

interface NotificationView {
  id: string;
  title: string;
  message: string;
  date: string;
  screen?: string;
  isRead: boolean;
}

function scheduleText(value?: string): string {
  if (!value) return 'Schedule to be announced';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })} • ${parsed.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
}

function notificationDate(value?: string): string {
  if (!value) return 'Just now';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Recently';
  return parsed.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export default function ResidentHomeDashboardScreen({
  userName = 'Resident',
  barangayName,
  residentStatus,
  residentNote,
  virtualIdData = null,
  isVirtualIdLoading = false,
  virtualIdError = null,
  virtualIdWarning = null,
  onRefreshVirtualId,
  onRefreshProfile,
  distributionItems = [],
  isDistributionLoading = false,
  distributionWarning = null,
  onRefreshDistributions,
  onNavigate,
}: ResidentHomeDashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [activeEvent, setActiveEvent] = useState<ResidentDisasterEvent | null>(null);
  const [proofStatus, setProofStatus] = useState<ResidentProofSubmissionStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const needsRevision = residentStatus === 'Needs Revision';
  const isPending = residentStatus === 'Pending' || needsRevision;
  const nextDistribution = distributionItems[0] || null;
  const distributionCount = distributionItems.length;

  const loadNotifications = useCallback(async () => {
    if (isPending) {
      setNotifications([]);
      return;
    }
    const token = await getResidentToken();
    if (!token) return;
    const result = await fetchResidentNotifications(token);
    if (!result.success || !result.data) return;
    setNotifications(result.data.notifications.map((item: ResidentNotificationItem) => ({
      id: item._id || item.id || `${item.title}-${item.createdAt || Date.now()}`,
      title: item.title,
      message: item.message,
      date: notificationDate(item.createdAt),
      screen: typeof item.meta?.screen === 'string' ? item.meta.screen : undefined,
      isRead: Boolean(item.isRead),
    })));
  }, [isPending]);

  const loadAssistanceStatus = useCallback(async () => {
    if (isPending) {
      setActiveEvent(null);
      setProofStatus(null);
      return;
    }
    const session = await getResidentSession();
    if (!session) return;
    const cache = await loadResidentOfflineCache();
    const cachedForResident = cache?.residentId === session.residentId ? cache : null;
    if (cachedForResident && isCachedEventUsable(cachedForResident)) {
      setActiveEvent(cachedForResident.activeEvent);
      setProofStatus(cachedForResident.proofStatus);
    }

    const eventResult = await fetchActiveBeneficiaryEvent(session.token);
    if (!eventResult.success) return;
    const event = eventResult.data || null;
    setActiveEvent(event);
    await updateResidentOfflineCache(session.residentId, {
      activeEvent: event,
      activeEventFetchedAt: new Date().toISOString(),
    });

    const eventId = event?.id || event?._id;
    if (!eventId) {
      setProofStatus(null);
      await updateResidentOfflineCache(session.residentId, { proofStatus: null });
      return;
    }
    const statusResult = await fetchResidentProofSubmissionStatus(session.token, eventId);
    if (statusResult.success) {
      const nextStatus = statusResult.data || null;
      setProofStatus(nextStatus);
      await updateResidentOfflineCache(session.residentId, { proofStatus: nextStatus });
    }
  }, [isPending]);

  useEffect(() => {
    loadNotifications().catch(() => undefined);
    loadAssistanceStatus().catch(() => undefined);
  }, [loadAssistanceStatus, loadNotifications]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefreshProfile?.();
      await Promise.all([
        onRefreshDistributions?.(true),
        loadNotifications(),
        loadAssistanceStatus(),
        onRefreshVirtualId?.(true),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadAssistanceStatus, loadNotifications, onRefreshDistributions, onRefreshProfile, onRefreshVirtualId]);

  const openNotification = useCallback(async (item: NotificationView) => {
    // 1. Immediately close modal so notification vanishes from view
    setShowNotifications(false);

    // 2. Mark as read immediately
    if (!item.isRead) {
      setNotifications((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, isRead: true } : entry
      )));
      const token = await getResidentToken();
      if (token) {
        markResidentNotificationRead(token, item.id).catch(() => undefined);
      }
    }

    // 3. Navigate to specific screen stated in notif
    if (item.screen === 'registration-revision') {
      onNavigate?.('registration-revision');
    } else if (item.screen === 'proof-request') {
      onNavigate?.('proof-request');
    } else if (item.screen === 'qr') {
      onNavigate?.('qr');
    } else if (item.screen === 'profile') {
      onNavigate?.('profile');
    } else if (item.screen === 'home') {
      onNavigate?.('home');
    } else if (item.screen === 'distributions') {
      onNavigate?.('distributions');
    } else {
      // Default fallback
      onNavigate?.('distributions');
    }
  }, [onNavigate]);

  const handleMarkAllAsRead = useCallback(async () => {
    setNotifications((current) => current.map((entry) => ({ ...entry, isRead: true })));
    const token = await getResidentToken();
    if (!token) return;
    await markAllResidentNotificationsRead(token);
  }, []);

  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      'Delete All Notifications',
      'Are you sure you want to delete all notifications? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            setNotifications([]);
            const token = await getResidentToken();
            if (!token) return;
            await deleteAllResidentNotifications(token);
          },
        },
      ]
    );
  }, []);

  const unreadCount = notifications.filter((item) => !item.isRead).length;
  const proofTitle = proofStatus?.status === 'Approved'
    ? 'Damage assessment verified'
    : proofStatus?.status === 'Pending Verification'
      ? 'Proof is under review'
      : proofStatus?.status === 'Rejected'
        ? 'Proof needs changes'
        : 'Submit Proof of Damage';
  const proofDescription = proofStatus?.status === 'Approved'
    ? 'Your damage assessment was verified by the admin.'
    : proofStatus?.status === 'Pending Verification'
      ? 'No need to submit again. Check your review status.'
      : proofStatus?.status === 'Rejected'
        ? 'Open your request to review the admin note.'
        : activeEvent?.name
          ? `Upload damage photos for ${activeEvent.name} relief.`
          : 'Submit damage photos to qualify for targeted relief.';
  const proofPresentation = proofStatus?.status === 'Approved'
    ? { icon: 'shield-checkmark-outline' as const, label: 'APPROVED', color: '#DCFCE7' }
    : proofStatus?.status === 'Pending Verification'
      ? { icon: 'time-outline' as const, label: 'IN REVIEW', color: '#FDE68A' }
      : proofStatus?.status === 'Rejected'
        ? { icon: 'alert-circle-outline' as const, label: 'ACTION NEEDED', color: '#FDBA74' }
        : { icon: 'camera-outline' as const, label: 'OPEN REQUEST', color: residentColors.accent };

  const requiresAccountAttention = needsRevision || residentStatus === 'Rejected';
  const bannerStatus = requiresAccountAttention
    ? { label: 'ACTION NEEDED', icon: 'alert-circle' as const, color: '#F6C56E' }
    : residentStatus === 'Pending'
      ? { label: 'UNDER REVIEW', icon: 'time' as const, color: '#F6C56E' }
      : { label: 'VERIFIED', icon: 'checkmark-circle' as const, color: residentColors.accent };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 82 }]}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={residentColors.icon}
            colors={[residentColors.icon]}
          />
        )}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <ResidentBrandLockup />
          <TouchableOpacity
            style={styles.notificationButton}
            onPress={() => setShowNotifications(true)}
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
          >
            <Ionicons name="notifications-outline" size={22} color={residentColors.icon} />
            {unreadCount > 0 ? (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        <LinearGradient
          colors={[residentColors.brandDark, residentColors.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.premiumBanner}
          accessibilityLabel={`Resident dashboard. Hello, ${userName}. ${bannerStatus.label}.`}
        >
          <View style={styles.bannerGoldAccent} />
          <View style={styles.bannerWatermark} pointerEvents="none">
            <Ionicons name="people" size={132} color="rgba(255, 255, 255, 0.055)" />
          </View>
          <View style={styles.bannerTopRow}>
            <Text style={styles.bannerEyebrow}>RESIDENT DASHBOARD</Text>
            <View style={styles.bannerStatusPill}>
              <Ionicons name={bannerStatus.icon} size={13} color={bannerStatus.color} />
              <Text style={[styles.bannerStatusText, { color: bannerStatus.color }]}>{bannerStatus.label}</Text>
            </View>
          </View>
          <Text style={styles.bannerGreeting} numberOfLines={1}>Hello, {userName}</Text>
          <Text style={styles.bannerSubtitle} numberOfLines={2}>
            {requiresAccountAttention ? 'Your registration needs attention.' : isPending ? 'Your registration is being reviewed.' : 'Here’s what matters today.'}
          </Text>
          {barangayName ? (
            <View style={styles.bannerLocationPill}>
              <Ionicons name="location-outline" size={14} color={residentColors.accent} />
              <Text style={styles.bannerLocationText} numberOfLines={1}>{barangayName}</Text>
            </View>
          ) : null}
        </LinearGradient>

        {isPending ? (
          <View style={styles.pendingCard}>
            <View style={styles.pendingIcon}>
              <Ionicons name={needsRevision ? 'create-outline' : 'time-outline'} size={23} color={residentColors.icon} />
            </View>
            <View style={styles.pendingCopy}>
              <Text style={styles.cardEyebrow}>{needsRevision ? 'ACTION NEEDED' : 'REGISTRATION STATUS'}</Text>
              <Text style={styles.pendingTitle}>{needsRevision ? 'Update your registration' : 'Approval in progress'}</Text>
              <Text style={styles.cardDescription} numberOfLines={3}>
                {needsRevision
                  ? residentNote?.trim() || 'Review the admin note and upload corrected registration files.'
                  : 'Distribution access will become available after barangay approval.'}
              </Text>
            </View>
            {needsRevision ? (
              <TouchableOpacity style={styles.roundAction} onPress={() => onNavigate?.('registration-revision')}>
                <Ionicons name="arrow-forward" size={19} color={residentColors.inverse} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.virtualIdSection}>
              <VirtualResidentIdCard
                idData={virtualIdData}
                isLoading={isVirtualIdLoading}
                error={virtualIdError}
                warning={virtualIdWarning}
                onRefresh={onRefreshVirtualId}
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionLabelRow}>
                <View>
                  <Text style={styles.sectionEyebrow}>YOUR RELIEF JOURNEY</Text>
                  <Text style={styles.sectionTitle}>Assistance status</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.premiumCardShadow} activeOpacity={0.86} onPress={() => onNavigate?.('proof-request')}>
                <LinearGradient
                  colors={[residentColors.brandDark, residentColors.brand]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.statusCard}
                >
                  <View style={styles.cardGoldAccent} />
                  <View style={styles.statusWatermark} pointerEvents="none">
                    <Ionicons name="shield-checkmark-outline" size={92} color="rgba(255, 255, 255, 0.045)" />
                  </View>
                  <View style={styles.darkIconTile}>
                    <Ionicons name={proofPresentation.icon} size={23} color={proofPresentation.color} />
                  </View>
                  <View style={styles.premiumCardCopy}>
                    <View style={styles.statusMetaRow}>
                      <Text style={styles.darkCardEyebrow}>{activeEvent?.disasterType?.toUpperCase() || 'DISASTER PROOF'}</Text>
                      <View style={styles.darkStatusPill}>
                        <View style={[styles.statusDot, { backgroundColor: proofPresentation.color }]} />
                        <Text style={[styles.darkStatusText, { color: proofPresentation.color }]}>{proofPresentation.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.darkCardTitle} numberOfLines={1}>{proofTitle}</Text>
                    <Text style={styles.darkCardDescription} numberOfLines={2}>{proofDescription}</Text>
                  </View>
                  <View style={styles.darkArrowButton}>
                    <Ionicons name="arrow-forward" size={18} color={residentColors.accent} />
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>DISTRIBUTION UPDATE</Text>
                  <Text style={styles.sectionTitle}>
                    {nextDistribution?.lifecycleStatus === 'Active' ? 'Current distribution' : 'Next distribution'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onNavigate?.('distributions')}>
                  <Text style={styles.sectionLink}>View all{distributionCount > 0 ? ` (${distributionCount})` : ''}</Text>
                </TouchableOpacity>
              </View>

              {distributionWarning ? (
                <View style={styles.distributionWarning}>
                  <Ionicons name="cloud-offline-outline" size={16} color="#9A6700" />
                  <Text style={styles.distributionWarningText}>{distributionWarning}</Text>
                </View>
              ) : null}

              {isDistributionLoading && !nextDistribution ? (
                <DistributionCardSkeleton />
              ) : nextDistribution ? (
                <TouchableOpacity style={styles.premiumCardShadow} activeOpacity={0.86} onPress={() => onNavigate?.('distributions')}>
                  <LinearGradient colors={[residentColors.surface, residentColors.surfaceMuted]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.distributionCard}>
                    <View style={styles.cardGoldAccent} />
                    <View style={styles.distributionWatermark} pointerEvents="none">
                      <Ionicons name="calendar-outline" size={90} color="rgba(15, 46, 34, 0.035)" />
                    </View>
                    <View style={styles.calendarIcon}>
                      <Ionicons name="calendar-outline" size={23} color={residentColors.accent} />
                    </View>
                    <View style={styles.premiumCardCopy}>
                      <View style={styles.statusMetaRow}>
                        <Text style={styles.lightCardEyebrow}>RELIEF SCHEDULE</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          {nextDistribution.requiresBeneficiaryApproval ? (
                            nextDistribution.isBeneficiaryApproved ? (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                <Ionicons name="checkmark-circle" size={9} color="#065F46" />
                                <Text style={{ fontSize: 7.5, fontWeight: '800', color: '#065F46' }}>ENROLLED</Text>
                              </View>
                            ) : nextDistribution.beneficiaryProofStatus === 'Pending Verification' ? (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FEF9C3', borderWidth: 1, borderColor: '#FDE047' }}>
                                <Text style={{ fontSize: 7.5, fontWeight: '800', color: '#854D0E' }}>PROOF IN REVIEW</Text>
                              </View>
                            ) : (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D' }}>
                                <Text style={{ fontSize: 7.5, fontWeight: '800', color: '#92400E' }}>PROOF REQUIRED</Text>
                              </View>
                            )
                          ) : null}
                          <View style={styles.lightStatusPill}>
                            <Text style={styles.lightStatusText}>
                              {nextDistribution.residentClaimed ? 'CLAIMED' : nextDistribution.lifecycleStatus === 'Active' ? 'OPEN NOW' : 'UPCOMING'}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <Text style={styles.lightCardTitle} numberOfLines={1}>
                        {nextDistribution.residentClaimed
                          ? 'Relief distribution claimed'
                          : nextDistribution.lifecycleStatus === 'Active'
                            ? 'Distribution is open'
                            : 'Upcoming relief distribution'}
                      </Text>
                      <Text style={styles.lightCardDescription} numberOfLines={1}>{scheduleText(nextDistribution.scheduled)}</Text>
                      <View style={styles.metaRow}>
                        <Ionicons name="location-outline" size={14} color={residentColors.brandDark} />
                        <Text style={styles.metaText} numberOfLines={1}>{nextDistribution.location?.trim() || `${nextDistribution.barangay} Covered Court`}</Text>
                      </View>
                    </View>
                    <View style={styles.lightArrowButton}>
                      <Ionicons name="arrow-forward" size={18} color={residentColors.accent} />
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.premiumCardShadow} activeOpacity={0.86} onPress={() => onNavigate?.('distributions')}>
                  <LinearGradient colors={[residentColors.surface, residentColors.surfaceMuted]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.distributionCard}>
                    <View style={styles.cardGoldAccent} />
                    <View style={styles.distributionWatermark} pointerEvents="none">
                      <Ionicons name="calendar-clear-outline" size={90} color="rgba(15, 46, 34, 0.035)" />
                    </View>
                    <View style={styles.calendarIcon}>
                      <Ionicons name="calendar-clear-outline" size={23} color={residentColors.accent} />
                    </View>
                    <View style={styles.premiumCardCopy}>
                      <View style={styles.statusMetaRow}>
                        <Text style={styles.lightCardEyebrow}>RELIEF SCHEDULE</Text>
                        <View style={styles.lightStatusPill}><Text style={styles.lightStatusText}>STAY TUNED</Text></View>
                      </View>
                      <Text style={styles.lightCardTitle}>No active schedule</Text>
                      <Text style={styles.lightCardDescription} numberOfLines={2}>We’ll notify you when the next distribution is available.</Text>
                    </View>
                    <View style={styles.lightArrowButton}>
                      <Ionicons name="arrow-forward" size={18} color={residentColors.accent} />
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <Modal transparent animationType="fade" visible={showNotifications} onRequestClose={() => setShowNotifications(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowNotifications(false)}>
          <Pressable style={styles.notificationSheet} onPress={() => undefined}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetEyebrow}>RECENT UPDATES</Text>
                <Text style={styles.sheetTitle}>Notifications</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setShowNotifications(false)}>
                <Ionicons name="close" size={20} color={residentColors.icon} />
              </TouchableOpacity>
            </View>

            {notifications.length > 0 && (
              <View style={styles.sheetActionBar}>
                <TouchableOpacity
                  style={[styles.sheetActionBtn, unreadCount === 0 && styles.sheetActionBtnDisabled]}
                  onPress={handleMarkAllAsRead}
                  disabled={unreadCount === 0}
                >
                  <Ionicons
                    name="checkmark-done-outline"
                    size={16}
                    color={unreadCount === 0 ? residentColors.secondary : residentColors.brandDark}
                  />
                  <Text style={[styles.sheetActionText, unreadCount === 0 && styles.sheetActionTextDisabled]}>
                    Mark all as read
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.sheetActionBtn} onPress={handleDeleteAll}>
                  <Ionicons name="trash-outline" size={15} color="#EF4444" />
                  <Text style={[styles.sheetActionText, { color: '#EF4444' }]}>Delete all</Text>
                </TouchableOpacity>
              </View>
            )}
            {notifications.length === 0 ? (
              <View style={styles.notificationEmpty}>
                <Ionicons name="notifications-outline" size={25} color={residentColors.icon} />
                <Text style={styles.notificationEmptyText}>No new notifications</Text>
              </View>
            ) : (
              <ScrollView style={styles.notificationList}>
                {notifications.map((item) => (
                  <TouchableOpacity key={item.id} style={styles.notificationItem} onPress={() => openNotification(item)}>
                    <View style={[styles.unreadDot, item.isRead && styles.readDot]} />
                    <View style={styles.notificationCopy}>
                      <Text style={styles.notificationTitle}>{item.title}</Text>
                      <Text style={styles.notificationMessage} numberOfLines={2}>{item.message}</Text>
                      <Text style={styles.notificationDate}>{item.date}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={residentColors.icon} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <BottomNavigation activeTab="home" onNavigate={onNavigate} appearance="resident" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: residentColors.background },
  content: { paddingHorizontal: 20, paddingTop: 12 },
  topBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notificationButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  notificationBadge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: residentColors.brand, borderWidth: 2, borderColor: residentColors.background },
  notificationBadgeText: { color: residentColors.inverse, fontSize: 8, fontWeight: '900' },
  premiumBanner: { minHeight: 158, marginTop: 18, marginBottom: 22, padding: 16, borderRadius: 22, overflow: 'hidden', shadowColor: residentColors.brandDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.19, shadowRadius: 16, elevation: 5 },
  bannerGoldAccent: { position: 'absolute', top: 0, right: 0, left: 0, height: 3, backgroundColor: residentColors.accent },
  bannerWatermark: { position: 'absolute', right: -24, bottom: -34, transform: [{ rotate: '-10deg' }] },
  bannerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerEyebrow: { fontSize: 8.5, fontWeight: '900', letterSpacing: 1.25, color: residentColors.accent },
  bannerStatusPill: { minHeight: 25, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.38)' },
  bannerStatusText: { fontSize: 7.5, fontWeight: '900', letterSpacing: 0.65 },
  bannerGreeting: { maxWidth: '82%', marginTop: 10, fontSize: 25, lineHeight: 30, fontWeight: '800', color: '#FFFFFF' },
  bannerSubtitle: { maxWidth: '78%', marginTop: 3, fontSize: 11.5, lineHeight: 15, color: '#E6F6EA' },
  bannerLocationPill: { alignSelf: 'flex-start', maxWidth: '76%', minHeight: 26, marginTop: 8, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.32)' },
  bannerLocationText: { flexShrink: 1, fontSize: 10.5, fontWeight: '700', color: residentColors.inverse },
  virtualIdSection: { marginHorizontal: -20, marginBottom: -22 },
  idCard: { minHeight: 112, padding: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: residentColors.surface, borderWidth: 1, borderColor: residentColors.borderAccent, ...residentTheme.shadow },
  idIcon: { width: 50, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  cardCopy: { flex: 1, marginHorizontal: 13 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 0.85, color: residentColors.secondary },
  cardTitle: { marginTop: 5, fontSize: 14, lineHeight: 18, fontWeight: '800', color: residentColors.ink },
  cardDescription: { marginTop: 4, fontSize: 11.5, lineHeight: 17, color: residentColors.secondary },
  savedNote: { marginTop: 4, fontSize: 9.5, color: residentColors.secondary },
  readyPill: { marginLeft: 'auto', paddingHorizontal: 7, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: residentColors.surfaceMuted },
  readyDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: residentColors.brand },
  readyText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.6, color: residentColors.ink },
  section: { marginTop: 22 },
  sectionHeader: { marginBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionLabelRow: { marginBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionEyebrow: { marginBottom: 2, fontSize: 7.5, fontWeight: '900', letterSpacing: 1.15, color: residentColors.accentInk },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800', color: residentColors.ink },
  sectionLink: { fontSize: 11.5, fontWeight: '800', color: residentColors.brandDark },
  premiumCardShadow: { borderRadius: 20, shadowColor: residentColors.brandDark, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.15, shadowRadius: 14, elevation: 5 },
  cardGoldAccent: { position: 'absolute', top: 0, right: 0, left: 0, height: 3, backgroundColor: residentColors.accent },
  statusCard: { minHeight: 126, padding: 15, flexDirection: 'row', alignItems: 'center', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.52)' },
  statusWatermark: { position: 'absolute', right: 32, bottom: -26, transform: [{ rotate: '-10deg' }] },
  darkIconTile: { width: 48, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.42)' },
  premiumCardCopy: { flex: 1, minWidth: 0, marginHorizontal: 13 },
  statusMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  darkCardEyebrow: { flexShrink: 1, fontSize: 7.5, fontWeight: '900', letterSpacing: 1, color: residentColors.accent },
  darkStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.32)' },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  darkStatusText: { fontSize: 6.7, fontWeight: '900', letterSpacing: 0.55 },
  darkCardTitle: { marginTop: 7, fontSize: 15, lineHeight: 19, fontWeight: '800', color: '#FFFFFF' },
  darkCardDescription: { marginTop: 4, fontSize: 11, lineHeight: 16, color: '#E6F6EA' },
  darkArrowButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.4)' },
  distributionCard: { minHeight: 126, padding: 15, flexDirection: 'row', alignItems: 'center', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: residentColors.borderAccent, shadowColor: residentColors.brandDark, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.1, shadowRadius: 14, elevation: 4 },
  distributionWatermark: { position: 'absolute', right: 34, bottom: -24, transform: [{ rotate: '-8deg' }] },
  calendarIcon: { width: 48, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: residentColors.brandDark, borderWidth: 1, borderColor: residentColors.accent },
  lightCardEyebrow: { flexShrink: 1, fontSize: 7.5, fontWeight: '900', letterSpacing: 1, color: residentColors.accentInk },
  lightStatusPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, backgroundColor: residentColors.brandSoft, borderWidth: 1, borderColor: residentColors.borderAccent },
  lightStatusText: { fontSize: 6.7, fontWeight: '900', letterSpacing: 0.5, color: residentColors.brandDark },
  lightCardTitle: { marginTop: 7, fontSize: 15, lineHeight: 19, fontWeight: '800', color: residentColors.ink },
  lightCardDescription: { marginTop: 4, fontSize: 11, lineHeight: 16, color: residentColors.secondary },
  lightArrowButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: residentColors.brandDark, borderWidth: 1, borderColor: residentColors.accent },
  metaRow: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { flex: 1, fontSize: 10.5, color: residentColors.secondary },
  distributionWarning: { marginBottom: 10, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, backgroundColor: '#FFF8E1', borderWidth: 1, borderColor: '#F4D58D' },
  distributionWarningText: { flex: 1, fontSize: 10.5, lineHeight: 15, color: '#76520A' },
  pendingCard: { minHeight: 130, padding: 15, flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: residentColors.surface, borderWidth: 1, borderColor: residentColors.borderAccent, ...residentTheme.shadow },
  pendingIcon: { width: 50, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  pendingCopy: { flex: 1, marginHorizontal: 13 },
  pendingTitle: { marginTop: 5, fontSize: 15, fontWeight: '800', color: residentColors.ink },
  roundAction: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: residentColors.brand },
  modalOverlay: { flex: 1, padding: 20, justifyContent: 'flex-end', backgroundColor: residentColors.overlay },
  notificationSheet: { maxHeight: '72%', padding: 20, paddingBottom: 24, borderRadius: 24, backgroundColor: residentColors.surface },
  sheetHandle: { width: 42, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: residentColors.border },
  sheetHeader: { marginTop: 17, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: residentColors.secondary },
  sheetTitle: { marginTop: 3, fontSize: 20, fontWeight: '800', color: residentColors.ink },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  notificationList: { maxHeight: 390 },
  notificationItem: { minHeight: 86, paddingVertical: 13, flexDirection: 'row', alignItems: 'flex-start', borderTopWidth: 1, borderTopColor: residentColors.divider },
  unreadDot: { width: 7, height: 7, marginTop: 6, marginRight: 10, borderRadius: 4, backgroundColor: residentColors.brand },
  readDot: { backgroundColor: residentColors.border },
  notificationCopy: { flex: 1, paddingRight: 8 },
  notificationTitle: { fontSize: 13, fontWeight: '800', color: residentColors.ink },
  notificationMessage: { marginTop: 4, fontSize: 11.5, lineHeight: 16, color: residentColors.secondary },
  notificationDate: { marginTop: 5, fontSize: 9.5, fontWeight: '700', color: residentColors.secondary },
  notificationEmpty: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  notificationEmptyText: { marginTop: 10, fontSize: 13, color: residentColors.secondary },
  sheetActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: residentColors.divider,
  },
  sheetActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  sheetActionBtnDisabled: {
    opacity: 0.45,
  },
  sheetActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: residentColors.brandDark,
  },
  sheetActionTextDisabled: {
    color: residentColors.secondary,
  },
});
