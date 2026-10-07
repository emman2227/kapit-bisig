import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  DashboardSummary,
  mobileAuthService,
  User as VolunteerUser,
} from '../services/auth/MobileAuthService';
import { staffTheme } from '../theme';
import BottomNavigation, { BottomTab } from './ui/BottomNavigation';
import ResidentBrandLockup from './ui/ResidentBrandLockup';
import { DistributionCardSkeleton, VolunteerDashboardSkeleton } from './ui/Skeleton';
import DistributionBeneficiariesModal from './DistributionBeneficiariesModal';
import AssistedRegistrationScreen from './AssistedRegistrationScreen';

const sc = staffTheme.colors;

interface VolunteerDashboardScreenProps {
  volunteerUser?: VolunteerUser | null;
  onNavigate?: (screen: BottomTab) => void;
  onLogout?: () => void;
}

interface DistributionData {
  id: string;
  title: string;
  barangay: string;
  coverage: string[];
  schedule: string;
  startTime: string;
  isLive: boolean;
  isUrgent: boolean;
  registeredHouseholds: number;
  claimedHouseholds: number;
  lifecycleStatus?: 'Upcoming' | 'Active' | 'Completed' | 'Archived';
}

interface DashboardStats {
  totalHouseholds: number;
  verifiedHouseholds: number;
  pendingQueue: number;
  scansToday: number;
  scansTrend: number;
  activeDistributions: number;
  confirmedClaimsToday: number;
  scopedBarangays: string[];
}

interface VolunteerNotificationItem {
  _id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt?: string;
  meta?: {
    screen?: string;
    distributionId?: string;
    [key: string]: unknown;
  };
}

function notificationDate(value?: string): string {
  if (!value) return 'Just now';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Recently';
  return parsed.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export default function VolunteerDashboardScreen({
  volunteerUser,
  onNavigate,
  onLogout,
}: VolunteerDashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [distributions, setDistributions] = useState<DistributionData[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalHouseholds: 0,
    verifiedHouseholds: 0,
    pendingQueue: 0,
    scansToday: 0,
    scansTrend: 0,
    activeDistributions: 0,
    confirmedClaimsToday: 0,
    scopedBarangays: [],
  });
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifications, setNotifications] = useState<VolunteerNotificationItem[]>([]);
  const [selectedDistributionForModal, setSelectedDistributionForModal] = useState<DistributionData | null>(null);
  const [showAssistedRegistration, setShowAssistedRegistration] = useState(false);

  const displayName = volunteerUser
    ? `${volunteerUser.firstName || ''} ${volunteerUser.lastName || ''}`.trim() || 'Staff Member'
    : 'Staff Member';

  const progressPercentage = stats.totalHouseholds > 0
    ? Math.round((stats.verifiedHouseholds / stats.totalHouseholds) * 100)
    : 0;

  const loadDashboardData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [distributionResult, summaryResult] = await Promise.all([
        mobileAuthService.authenticatedRequest<{
          success: boolean;
          data?: Array<{
            id?: string;
            _id?: string;
            barangay: string;
            assignedBarangays?: string[];
            scheduled?: string;
            notes?: string;
            registeredHouseholds?: number;
            claimedHouseholds?: number;
            lifecycleStatus?: 'Upcoming' | 'Active' | 'Completed' | 'Archived';
          }>;
        }>('/distributions', { method: 'GET' }),
        mobileAuthService.getDashboardSummary(),
      ]);

      if (summaryResult.success && summaryResult.data) {
        const summary: DashboardSummary = summaryResult.data;
        setStats({
          totalHouseholds: summary.residents.total,
          verifiedHouseholds: summary.residents.approved,
          pendingQueue: summary.residents.pending,
          scansToday: summary.scans.today,
          scansTrend: summary.scans.trend,
          activeDistributions: summary.distributions.active,
          confirmedClaimsToday: summary.claims.confirmedToday,
          scopedBarangays: summary.scopedBarangays,
        });
      }

      if (
        distributionResult.success &&
        distributionResult.data?.success &&
        Array.isArray(distributionResult.data.data)
      ) {
        // Exclude Completed and Archived distributions from live/upcoming card
        const activeOrUpcoming = distributionResult.data.data.filter(
          (item) => item.lifecycleStatus === 'Active' || item.lifecycleStatus === 'Upcoming'
        );

        // Prioritize Active distributions first, then Upcoming
        const sorted = [...activeOrUpcoming].sort((a, b) => {
          if (a.lifecycleStatus === 'Active' && b.lifecycleStatus !== 'Active') return -1;
          if (a.lifecycleStatus !== 'Active' && b.lifecycleStatus === 'Active') return 1;
          return 0;
        });

        const mappedDistributions: DistributionData[] = sorted
          .slice(0, 3)
          .map((item, idx) => ({
            id: item.id || item._id || `dist-${idx}`,
            title: `${item.barangay} Relief Drive`,
            barangay: item.barangay,
            coverage: item.assignedBarangays || [item.barangay],
            schedule: item.scheduled || '09:00 AM - 12:30 PM',
            startTime: '08:30 AM',
            isLive: item.lifecycleStatus === 'Active',
            isUrgent: idx === 0,
            registeredHouseholds: Number(item.registeredHouseholds || 0),
            claimedHouseholds: Number(item.claimedHouseholds || 0),
            lifecycleStatus: item.lifecycleStatus,
          }));
        setDistributions(mappedDistributions);
      } else {
        setDistributions([]);
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDashboardData();
    } finally {
      setRefreshing(false);
    }
  }, [loadDashboardData]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const featuredDistribution = distributions[0];
  const unreadCount = notifications.filter((item) => !item.isRead).length;

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const result = await mobileAuthService.authenticatedRequest<{
        success: boolean;
        data?: { notifications?: VolunteerNotificationItem[] };
      }>('/notifications?limit=30', { method: 'GET' });

      if (result.success && result.data?.success && Array.isArray(result.data.data?.notifications)) {
        setNotifications(result.data.data.notifications);
      } else {
        setNotifications([]);
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  const handleOpenNotifications = async () => {
    setShowNotifications(true);
    await loadNotifications();
  };

  const handleNotificationPress = async (notification: VolunteerNotificationItem) => {
    // 1. Immediately close notifications modal sheet
    setShowNotifications(false);

    // 2. Mark as read
    if (!notification.isRead) {
      setNotifications((prev) =>
        prev.map((item) => (item._id === notification._id ? { ...item, isRead: true } : item)),
      );
      try {
        await mobileAuthService.authenticatedRequest(`/notifications/${notification._id}/read`, {
          method: 'PATCH',
        });
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }

    // 3. Navigate to specific screen stated in notif
    const screen = notification.meta?.screen;
    if (screen === 'qr') {
      onNavigate?.('qr');
    } else if (screen === 'profile') {
      onNavigate?.('profile');
    } else if (screen === 'home') {
      onNavigate?.('home');
    } else {
      const text = `${notification.title} ${notification.message}`.toLowerCase();
      if (text.includes('distribution') || text.includes('claim') || text.includes('scan') || text.includes('roster') || text.includes('relief')) {
        onNavigate?.('qr');
      }
    }
  };

  const handleMarkAllAsRead = async () => {
    setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    try {
      await mobileAuthService.authenticatedRequest('/notifications/mark-all-read', {
        method: 'PATCH',
      });
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  };

  const handleDeleteAll = () => {
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
            try {
              await mobileAuthService.authenticatedRequest('/notifications', {
                method: 'DELETE',
              });
            } catch (error) {
              console.error('Failed to delete notifications:', error);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    if (!mobileAuthService.isLoggedIn()) return;

    loadDashboardData(false);
    loadNotifications().catch(() => undefined);

    const refreshIfActive = () => {
      if (AppState.currentState === 'active') {
        loadDashboardData(true);
      }
    };

    const intervalId = setInterval(refreshIfActive, 5000);
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        loadDashboardData(true);
      }
    });

    return () => {
      clearInterval(intervalId);
      subscription.remove();
    };
  }, [loadDashboardData, loadNotifications]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 82 }]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={sc.icon}
            colors={[sc.icon]}
          />
        )}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top Bar ── */}
        <View style={styles.topBar}>
          <ResidentBrandLockup />
          <TouchableOpacity
            style={styles.notificationButton}
            onPress={handleOpenNotifications}
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
          >
            <Ionicons name="notifications-outline" size={22} color={sc.icon} />
            {unreadCount > 0 ? (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* ── Premium Gradient Banner ── */}
        <LinearGradient
          colors={[sc.brandDark, sc.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.premiumBanner}
          accessibilityLabel={`Staff dashboard. Hello, ${displayName}.`}
        >
          <View style={styles.bannerGoldAccent} />
          <View style={styles.bannerWatermark} pointerEvents="none">
            <Ionicons name="shield-checkmark" size={132} color="rgba(255, 255, 255, 0.055)" />
          </View>
          <View style={styles.bannerTopRow}>
            <Text style={styles.bannerEyebrow}>STAFF DASHBOARD</Text>
            <View style={styles.bannerStatusPill}>
              <View style={styles.syncDot} />
              <Text style={styles.bannerStatusText}>
                {formatTime(lastUpdated)}
              </Text>
            </View>
          </View>
          <Text style={styles.bannerGreeting} numberOfLines={1}>Hello, {displayName}</Text>
          <Text style={styles.bannerSubtitle} numberOfLines={2}>Here's your operations overview.</Text>
          {stats.scopedBarangays.length > 0 ? (
            <View style={styles.bannerLocationPill}>
              <Ionicons name="location-outline" size={14} color={sc.accent} />
              <Text style={styles.bannerLocationText} numberOfLines={1}>
                {stats.scopedBarangays.join(', ')}
              </Text>
            </View>
          ) : null}
        </LinearGradient>

        {/* ── QR Scanner Action ── */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.premiumCardShadow} activeOpacity={0.86} onPress={() => onNavigate?.('qr')}>
            <LinearGradient
              colors={[sc.brandDark, sc.brand]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.qrActionCard}
            >
              <View style={styles.cardGoldAccent} />
              <View style={styles.qrWatermark} pointerEvents="none">
                <Ionicons name="qr-code-outline" size={92} color="rgba(255, 255, 255, 0.045)" />
              </View>
              <View style={styles.darkIconTile}>
                <Ionicons name="qr-code-outline" size={23} color={sc.accent} />
              </View>
              <View style={styles.premiumCardCopy}>
                <Text style={styles.darkCardEyebrow}>VERIFICATION</Text>
                <Text style={styles.darkCardTitle}>Scan resident QR</Text>
                <Text style={styles.darkCardDescription}>Open the scanner to verify resident identity.</Text>
              </View>
              <View style={styles.darkArrowButton}>
                <Ionicons name="arrow-forward" size={18} color={sc.accent} />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Walk-In Registration Card ── */}
          <TouchableOpacity
            style={[styles.premiumCardShadow, { marginTop: 12 }]}
            activeOpacity={0.86}
            onPress={() => setShowAssistedRegistration(true)}
          >
            <LinearGradient
              colors={['#18452D', '#123723', '#0E291B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.qrActionCard}
            >
              <View style={styles.cardGoldAccent} />
              <View style={styles.qrWatermark} pointerEvents="none">
                <Ionicons name="person-add-outline" size={92} color="rgba(255, 255, 255, 0.045)" />
              </View>
              <View style={styles.darkIconTile}>
                <Ionicons name="person-add-outline" size={23} color={sc.accent} />
              </View>
              <View style={styles.premiumCardCopy}>
                <Text style={styles.darkCardEyebrow}>WALK-IN BENEFICIARY</Text>
                <Text style={styles.darkCardTitle}>Register resident</Text>
                <Text style={styles.darkCardDescription}>For residents without a phone or government ID.</Text>
              </View>
              <View style={styles.darkArrowButton}>
                <Ionicons name="arrow-forward" size={18} color={sc.accent} />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ── Progress Card ── */}
        {loading && stats.totalHouseholds === 0 ? (
          <VolunteerDashboardSkeleton />
        ) : (
          <>
            {/* ── Progress Card ── */}
            <View style={styles.section}>
              <View style={styles.sectionLabelRow}>
                <View>
                  <Text style={styles.sectionEyebrow}>CURRENT OBJECTIVE</Text>
                  <Text style={styles.sectionTitle}>Relief Goods Phase 1</Text>
                </View>
                <View style={styles.activePill}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeText}>ACTIVE</Text>
                </View>
              </View>
              <View style={styles.progressCard}>
                <View style={styles.cardGoldAccent} />
                <View style={styles.progressWatermark} pointerEvents="none">
                  <Ionicons name="people" size={92} color="rgba(15, 46, 34, 0.035)" />
                </View>
                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>
                    <Text style={styles.progressBold}>{stats.verifiedHouseholds}</Text>
                    {' / '}{stats.totalHouseholds} Households Verified
                  </Text>
                  <Text style={styles.progressPercent}>{progressPercentage}%</Text>
                </View>
                <View style={styles.progressBarOuter}>
                  <View style={[styles.progressBarFill, { width: `${progressPercentage}%` }]} />
                </View>
              </View>
            </View>

            {/* ── Stats Row ── */}
            <View style={styles.statsRow}>
              <View style={styles.statsCard}>
                <View style={styles.cardGoldAccent} />
                <View style={styles.statsHeader}>
                  <View style={styles.pendingDot} />
                  <Text style={styles.statsLabel}>PENDING</Text>
                </View>
                <Text style={styles.statsValue}>{stats.pendingQueue}</Text>
                <Text style={styles.statsSubtext}>Verification Queue</Text>
              </View>

              <View style={styles.statsCard}>
                <View style={styles.cardGoldAccent} />
                <View style={styles.statsHeader}>
                  <Text style={styles.statsLabel}>SCANS TODAY</Text>
                  <View style={styles.trendBadge}>
                    <Ionicons
                      name={stats.scansTrend >= 0 ? 'arrow-up' : 'arrow-down'}
                      size={12}
                      color={stats.scansTrend >= 0 ? sc.brand : '#EF4444'}
                    />
                    <Text style={[styles.trendText, stats.scansTrend < 0 && styles.trendTextNeg]}>
                      {stats.scansTrend}
                    </Text>
                  </View>
                </View>
                <Text style={styles.statsValue}>{stats.scansToday}</Text>
                <Text style={styles.statsSubtext}>Processed Scans</Text>
              </View>
            </View>
          </>
        )}

        {/* ── Operational Status ── */}
        <View style={styles.statusStrip}>
          <View style={styles.statusItem}>
            <Ionicons name="layers-outline" size={15} color={sc.brand} />
            <Text style={styles.statusText}>ACTIVE: {stats.activeDistributions}</Text>
          </View>
          <View style={styles.statusItem}>
            <Ionicons name="checkmark-done-outline" size={15} color={sc.brand} />
            <Text style={styles.statusText}>CONFIRMED: {stats.confirmedClaimsToday}</Text>
          </View>
          <View style={styles.statusItem}>
            <Ionicons name="checkmark-circle-outline" size={15} color={sc.brand} />
            <Text style={styles.statusText}>ONLINE</Text>
          </View>
        </View>

        {/* ── Live Distributions ── */}
        <View style={styles.section}>
          <View style={styles.sectionLabelRow}>
            <View>
              <Text style={styles.sectionEyebrow}>DISTRIBUTION UPDATE</Text>
              <Text style={styles.sectionTitle}>Live distributions</Text>
            </View>
          </View>

          {loading && !featuredDistribution ? (
            <DistributionCardSkeleton />
          ) : featuredDistribution ? (
            <TouchableOpacity
              style={styles.premiumCardShadow}
              activeOpacity={0.86}
              onPress={() => setSelectedDistributionForModal(featuredDistribution)}
            >
              <LinearGradient
                colors={[sc.surface, sc.surfaceMuted]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.distributionCard}
              >
                <View style={styles.cardGoldAccent} />
                <View style={styles.distributionWatermark} pointerEvents="none">
                  <Ionicons name="calendar-outline" size={90} color="rgba(15, 46, 34, 0.035)" />
                </View>
                <View style={styles.calendarIcon}>
                  <Ionicons name="calendar-outline" size={23} color={sc.accent} />
                </View>
                <View style={styles.premiumCardCopy}>
                  <View style={styles.statusMetaRow}>
                    <Text style={styles.lightCardEyebrow}>RELIEF DISTRIBUTION</Text>
                    <View style={styles.lightStatusPill}>
                      <Text style={styles.lightStatusText}>
                        {featuredDistribution.isLive ? 'LIVE NOW' : 'UPCOMING'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.lightCardTitle} numberOfLines={1}>{featuredDistribution.title}</Text>
                  <Text style={styles.lightCardDescription} numberOfLines={1}>
                    {featuredDistribution.claimedHouseholds} claimed / {featuredDistribution.registeredHouseholds} registered
                  </Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={14} color={sc.brandDark} />
                    <Text style={styles.metaText} numberOfLines={1}>
                      {featuredDistribution.coverage.join(', ')}
                    </Text>
                  </View>
                </View>
                <View style={styles.lightArrowButton}>
                  <Ionicons name="arrow-forward" size={18} color={sc.accent} />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.premiumCardShadow} activeOpacity={0.86}>
              <LinearGradient
                colors={[sc.surface, sc.surfaceMuted]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.distributionCard}
              >
                <View style={styles.cardGoldAccent} />
                <View style={styles.distributionWatermark} pointerEvents="none">
                  <Ionicons name="calendar-clear-outline" size={90} color="rgba(15, 46, 34, 0.035)" />
                </View>
                <View style={styles.calendarIcon}>
                  <Ionicons name="calendar-clear-outline" size={23} color={sc.accent} />
                </View>
                <View style={styles.premiumCardCopy}>
                  <View style={styles.statusMetaRow}>
                    <Text style={styles.lightCardEyebrow}>RELIEF DISTRIBUTION</Text>
                    <View style={styles.lightStatusPill}>
                      <Text style={styles.lightStatusText}>STAY TUNED</Text>
                    </View>
                  </View>
                  <Text style={styles.lightCardTitle}>No live distributions</Text>
                  <Text style={styles.lightCardDescription} numberOfLines={2}>
                    Distributions will appear here when they go live.
                  </Text>
                </View>
                <View style={styles.lightArrowButton}>
                  <Ionicons name="arrow-forward" size={18} color={sc.accent} />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* ── Beneficiaries & Claims Modal ── */}
      <DistributionBeneficiariesModal
        visible={Boolean(selectedDistributionForModal)}
        onClose={() => setSelectedDistributionForModal(null)}
        distribution={selectedDistributionForModal}
      />

      {/* ── Notification Bottom Sheet ── */}
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
                <Ionicons name="close" size={20} color={sc.icon} />
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
                    color={unreadCount === 0 ? sc.secondary : sc.accent}
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
            {notificationsLoading ? (
              <View style={styles.notificationEmpty}>
                <ActivityIndicator color={sc.icon} />
              </View>
            ) : notifications.length === 0 ? (
              <View style={styles.notificationEmpty}>
                <Ionicons name="notifications-outline" size={25} color={sc.icon} />
                <Text style={styles.notificationEmptyText}>No new notifications</Text>
              </View>
            ) : (
              <ScrollView style={styles.notificationList}>
                {notifications.map((item) => (
                  <TouchableOpacity
                    key={item._id}
                    style={styles.notificationItem}
                    onPress={() => handleNotificationPress(item)}
                  >
                    <View style={[styles.unreadDot, item.isRead && styles.readDot]} />
                    <View style={styles.notificationCopy}>
                      <Text style={styles.notificationTitle}>{item.title || 'Notification'}</Text>
                      <Text style={styles.notificationMessage} numberOfLines={2}>
                        {item.message || 'You have an update.'}
                      </Text>
                      <Text style={styles.notificationDateText}>
                        {notificationDate(item.createdAt)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={sc.icon} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Assisted Registration Modal ── */}
      <AssistedRegistrationScreen
        visible={showAssistedRegistration}
        onClose={() => setShowAssistedRegistration(false)}
        onSuccess={(_code) => {
          setShowAssistedRegistration(false);
          loadDashboardData(true);
        }}
      />

      {/* ── Bottom Navigation ── */}
      <BottomNavigation
        activeTab="home"
        onNavigate={onNavigate}
        showDistributions={false}
        showScan={true}
        appearance="resident"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /* ── Layout ── */
  container: { flex: 1, backgroundColor: sc.background },
  content: { paddingHorizontal: 20, paddingTop: 12 },
  topBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  /* ── Notification Button ── */
  notificationButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: sc.iconSurface, borderWidth: 1, borderColor: sc.borderAccent },
  notificationBadge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: sc.brand, borderWidth: 2, borderColor: sc.background },
  notificationBadgeText: { color: sc.inverse, fontSize: 8, fontWeight: '900' },

  /* ── Premium Banner ── */
  premiumBanner: { minHeight: 158, marginTop: 18, marginBottom: 22, padding: 16, borderRadius: 22, overflow: 'hidden', shadowColor: sc.brandDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.19, shadowRadius: 16, elevation: 5 },
  bannerGoldAccent: { position: 'absolute', top: 0, right: 0, left: 0, height: 3, backgroundColor: sc.accent },
  bannerWatermark: { position: 'absolute', right: -24, bottom: -34, transform: [{ rotate: '-10deg' }] },
  bannerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerEyebrow: { fontSize: 8.5, fontWeight: '900', letterSpacing: 1.25, color: sc.accent },
  bannerStatusPill: { minHeight: 25, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.38)' },
  bannerStatusText: { fontSize: 7.5, fontWeight: '900', letterSpacing: 0.65, color: '#E6F6EA' },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' },
  bannerGreeting: { maxWidth: '82%', marginTop: 10, fontSize: 25, lineHeight: 30, fontWeight: '800', color: '#FFFFFF' },
  bannerSubtitle: { maxWidth: '78%', marginTop: 3, fontSize: 11.5, lineHeight: 15, color: '#E6F6EA' },
  bannerLocationPill: { alignSelf: 'flex-start', maxWidth: '76%', minHeight: 26, marginTop: 8, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.32)' },
  bannerLocationText: { flexShrink: 1, fontSize: 10.5, fontWeight: '700', color: sc.inverse },

  /* ── Sections ── */
  section: { marginTop: 22 },
  sectionLabelRow: { marginBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionEyebrow: { marginBottom: 2, fontSize: 7.5, fontWeight: '900', letterSpacing: 1.15, color: sc.accentInk },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800', color: sc.ink },

  /* ── Premium Card Utilities ── */
  premiumCardShadow: { borderRadius: 20, shadowColor: sc.brandDark, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.15, shadowRadius: 14, elevation: 5 },
  cardGoldAccent: { position: 'absolute', top: 0, right: 0, left: 0, height: 3, backgroundColor: sc.accent },
  premiumCardCopy: { flex: 1, minWidth: 0, marginHorizontal: 13 },
  statusMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  /* ── Dark Card Tokens ── */
  darkIconTile: { width: 48, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.42)' },
  darkCardEyebrow: { flexShrink: 1, fontSize: 7.5, fontWeight: '900', letterSpacing: 1, color: sc.accent },
  darkCardTitle: { marginTop: 7, fontSize: 15, lineHeight: 19, fontWeight: '800', color: '#FFFFFF' },
  darkCardDescription: { marginTop: 4, fontSize: 11, lineHeight: 16, color: '#E6F6EA' },
  darkArrowButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.4)' },

  /* ── QR Action ── */
  qrActionCard: { minHeight: 126, padding: 15, flexDirection: 'row', alignItems: 'center', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(236, 195, 35, 0.52)' },
  qrWatermark: { position: 'absolute', right: 32, bottom: -26, transform: [{ rotate: '-10deg' }] },

  /* ── Progress Card ── */
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: sc.brandSoft, borderWidth: 1, borderColor: sc.borderAccent },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: sc.brand },
  activeText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.55, color: sc.brandDark },
  progressCard: { minHeight: 100, padding: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: sc.surface, borderWidth: 1, borderColor: sc.borderAccent, ...staffTheme.shadow },
  progressWatermark: { position: 'absolute', right: 20, bottom: -24, transform: [{ rotate: '-10deg' }] },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  progressLabel: { fontSize: 13, color: sc.secondary },
  progressBold: { fontWeight: '800', color: sc.ink },
  progressPercent: { fontSize: 15, fontWeight: '800', color: sc.brandDark },
  progressBarOuter: { height: 10, backgroundColor: sc.surfaceMuted, borderRadius: 5, overflow: 'hidden', borderWidth: 1, borderColor: sc.borderAccent },
  progressBarFill: { height: '100%', backgroundColor: sc.brand, borderRadius: 5 },

  /* ── Stats Row ── */
  statsRow: { flexDirection: 'row', marginTop: 16, gap: 12 },
  statsCard: { flex: 1, minHeight: 110, padding: 15, borderRadius: 18, overflow: 'hidden', backgroundColor: sc.surface, borderWidth: 1, borderColor: sc.borderAccent, ...staffTheme.shadow },
  statsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  pendingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#F59E0B', marginRight: 5 },
  statsLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.85, color: sc.secondary },
  statsValue: { fontSize: 30, fontWeight: '800', color: sc.ink, marginBottom: 4 },
  statsSubtext: { fontSize: 11, color: sc.secondary },
  trendBadge: { flexDirection: 'row', alignItems: 'center' },
  trendText: { fontSize: 11, fontWeight: '700', color: sc.brand, marginLeft: 2 },
  trendTextNeg: { color: '#EF4444' },

  /* ── Status Strip ── */
  statusStrip: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 16, paddingVertical: 13, paddingHorizontal: 8, borderRadius: 14, backgroundColor: sc.surfaceMuted, borderWidth: 1, borderColor: sc.borderAccent },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.45, color: sc.secondary },

  /* ── Light Card Tokens (Distributions) ── */
  distributionCard: { minHeight: 126, padding: 15, flexDirection: 'row', alignItems: 'center', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: sc.borderAccent, ...staffTheme.shadow },
  distributionWatermark: { position: 'absolute', right: 34, bottom: -24, transform: [{ rotate: '-8deg' }] },
  calendarIcon: { width: 48, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: sc.brandDark, borderWidth: 1, borderColor: sc.accent },
  lightCardEyebrow: { flexShrink: 1, fontSize: 7.5, fontWeight: '900', letterSpacing: 1, color: sc.accentInk },
  lightStatusPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, backgroundColor: sc.brandSoft, borderWidth: 1, borderColor: sc.borderAccent },
  lightStatusText: { fontSize: 6.7, fontWeight: '900', letterSpacing: 0.5, color: sc.brandDark },
  lightCardTitle: { marginTop: 7, fontSize: 15, lineHeight: 19, fontWeight: '800', color: sc.ink },
  lightCardDescription: { marginTop: 4, fontSize: 11, lineHeight: 16, color: sc.secondary },
  lightArrowButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: sc.brandDark, borderWidth: 1, borderColor: sc.accent },
  metaRow: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { flex: 1, fontSize: 10.5, color: sc.secondary },

  /* ── Notification Sheet ── */
  modalOverlay: { flex: 1, padding: 20, justifyContent: 'flex-end', backgroundColor: sc.overlay },
  notificationSheet: { maxHeight: '72%', padding: 20, paddingBottom: 24, borderRadius: 24, backgroundColor: sc.surface },
  sheetHandle: { width: 42, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: sc.border },
  sheetHeader: { marginTop: 17, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: sc.secondary },
  sheetTitle: { marginTop: 3, fontSize: 20, fontWeight: '800', color: sc.ink },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: sc.iconSurface, borderWidth: 1, borderColor: sc.borderAccent },
  notificationList: { maxHeight: 390 },
  notificationItem: { minHeight: 86, paddingVertical: 13, flexDirection: 'row', alignItems: 'flex-start', borderTopWidth: 1, borderTopColor: sc.divider },
  unreadDot: { width: 7, height: 7, marginTop: 6, marginRight: 10, borderRadius: 4, backgroundColor: sc.brand },
  readDot: { backgroundColor: sc.border },
  notificationCopy: { flex: 1, paddingRight: 8 },
  notificationTitle: { fontSize: 13, fontWeight: '800', color: sc.ink },
  notificationMessage: { marginTop: 4, fontSize: 11.5, lineHeight: 16, color: sc.secondary },
  notificationDateText: { marginTop: 5, fontSize: 9.5, fontWeight: '700', color: sc.secondary },
  notificationEmpty: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  notificationEmptyText: { marginTop: 10, fontSize: 13, color: sc.secondary },
  sheetActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: sc.divider,
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
    color: sc.accent,
  },
  sheetActionTextDisabled: {
    color: sc.secondary,
  },
});
