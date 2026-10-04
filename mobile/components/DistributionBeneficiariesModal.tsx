import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { staffTheme } from '../theme';
import { mobileAuthService } from '../services/auth/MobileAuthService';

const sc = staffTheme.colors;

export interface ClaimedBeneficiary {
  householdId: string;
  householdCode: string | null;
  householdName: string;
  barangay: string;
  address: string;
  claimId: string | null;
  claimedAt: string | null;
  claimedBy: { id?: string; name?: string } | null;
  scanner?: { id?: string; name?: string } | null;
  proofMethod?: string | null;
  source?: string | null;
}

export interface NotClaimedBeneficiary {
  householdId: string;
  householdCode: string | null;
  householdName: string;
  barangay: string;
  address: string;
}

export interface DistributionHouseholdsPayload {
  distributionId: string;
  barangay: string;
  assignedBarangays: string[];
  requiresBeneficiaryApproval: boolean;
  totals: {
    registered: number;
    claimed: number;
    notYetClaimed: number;
  };
  claimed: ClaimedBeneficiary[];
  notYetClaimed: NotClaimedBeneficiary[];
}

export interface DistributionBeneficiariesModalProps {
  visible: boolean;
  onClose: () => void;
  distribution: {
    id: string;
    title: string;
    barangay: string;
    coverage?: string[];
    schedule?: string;
  } | null;
}

type TabType = 'all' | 'notYetClaimed' | 'claimed';

interface BeneficiaryListItem {
  id: string;
  type: 'claimed' | 'notYetClaimed';
  householdCode: string | null;
  householdName: string;
  barangay: string;
  address: string;
  claimId?: string | null;
  claimedAt?: string | null;
  claimedBy?: { id?: string; name?: string } | null;
  proofMethod?: string | null;
}

function formatClaimTime(isoDate?: string | null): string {
  if (!isoDate) return 'Recently';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Recently';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'R';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

export default function DistributionBeneficiariesModal({
  visible,
  onClose,
  distribution,
}: DistributionBeneficiariesModalProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<DistributionHouseholdsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchHouseholds = useCallback(async (distributionId: string, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await mobileAuthService.authenticatedRequest<{
        success: boolean;
        data?: DistributionHouseholdsPayload;
        message?: string;
      }>(`/distributions/${distributionId}/households`, { method: 'GET' });

      const resData = response.data?.data || (response.data as unknown as DistributionHouseholdsPayload);
      if (response.success && resData && resData.totals) {
        setData(resData);
      } else {
        setError(response.error || response.data?.message || 'Failed to load beneficiaries.');
      }
    } catch (err: unknown) {
      console.error('[BENEFICIARIES_MODAL]', err);
      setError('Unable to load beneficiary list. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (visible && distribution?.id) {
      setData(null);
      setSearchQuery('');
      setActiveTab('all');
      fetchHouseholds(distribution.id);
    }
  }, [visible, distribution?.id, fetchHouseholds]);

  const onRefresh = useCallback(() => {
    if (distribution?.id) {
      fetchHouseholds(distribution.id, true);
    }
  }, [distribution?.id, fetchHouseholds]);

  const allItems: BeneficiaryListItem[] = useMemo(() => {
    if (!data) return [];
    const claimedItems: BeneficiaryListItem[] = (data.claimed || []).map((c) => ({
      id: `claimed-${c.householdId}`,
      type: 'claimed',
      householdCode: c.householdCode,
      householdName: c.householdName,
      barangay: c.barangay,
      address: c.address,
      claimId: c.claimId,
      claimedAt: c.claimedAt,
      claimedBy: c.claimedBy || c.scanner,
      proofMethod: c.proofMethod,
    }));

    const notClaimedItems: BeneficiaryListItem[] = (data.notYetClaimed || []).map((nc) => ({
      id: `pending-${nc.householdId}`,
      type: 'notYetClaimed',
      householdCode: nc.householdCode,
      householdName: nc.householdName,
      barangay: nc.barangay,
      address: nc.address,
    }));

    return [...claimedItems, ...notClaimedItems];
  }, [data]);

  const filteredItems = useMemo(() => {
    let list = allItems;

    if (activeTab === 'claimed') {
      list = list.filter((item) => item.type === 'claimed');
    } else if (activeTab === 'notYetClaimed') {
      list = list.filter((item) => item.type === 'notYetClaimed');
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter((item) => {
      const name = item.householdName.toLowerCase();
      const code = (item.householdCode || '').toLowerCase();
      const address = item.address.toLowerCase();
      const barangay = item.barangay.toLowerCase();
      return name.includes(q) || code.includes(q) || address.includes(q) || barangay.includes(q);
    });
  }, [allItems, activeTab, searchQuery]);

  const totalRegistered = data?.totals.registered ?? 0;
  const totalClaimed = data?.totals.claimed ?? 0;
  const totalNotClaimed = data?.totals.notYetClaimed ?? 0;
  const progressPercent = totalRegistered > 0 ? Math.round((totalClaimed / totalRegistered) * 100) : 0;

  const renderBeneficiaryItem = ({ item }: { item: BeneficiaryListItem }) => {
    const isClaimed = item.type === 'claimed';
    return (
      <View style={styles.cardItem}>
        <View style={[styles.avatar, isClaimed ? styles.avatarClaimed : styles.avatarPending]}>
          <Text style={[styles.avatarText, isClaimed ? styles.avatarTextClaimed : styles.avatarTextPending]}>
            {getInitials(item.householdName)}
          </Text>
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <Text style={styles.residentName} numberOfLines={1}>
              {item.householdName}
            </Text>
            <View style={[styles.statusBadge, isClaimed ? styles.badgeClaimed : styles.badgePending]}>
              <Ionicons
                name={isClaimed ? 'checkmark-circle' : 'time-outline'}
                size={12}
                color={isClaimed ? '#059669' : '#D97706'}
                style={{ marginRight: 3 }}
              />
              <Text style={[styles.badgeText, isClaimed ? styles.badgeTextClaimed : styles.badgeTextPending]}>
                {isClaimed ? 'CLAIMED' : 'NOT CLAIMED'}
              </Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            {item.householdCode ? (
              <View style={styles.codeTag}>
                <Text style={styles.codeTagText}>{item.householdCode}</Text>
              </View>
            ) : null}
            <Text style={styles.addressText} numberOfLines={1}>
              {item.address || item.barangay}
            </Text>
          </View>

          {isClaimed && (
            <View style={styles.claimDetailRow}>
              <Ionicons name="receipt-outline" size={12} color={sc.muted} />
              <Text style={styles.claimDetailText} numberOfLines={1}>
                Claimed {formatClaimTime(item.claimedAt)}
                {item.claimedBy?.name ? ` by ${item.claimedBy.name}` : ''}
                {item.proofMethod ? ` (${item.proofMethod})` : ''}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (!visible || !distribution) return null;

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.backdropPressable} onPress={onClose} />
        <View style={styles.sheetContainer}>
          {/* Handle */}
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <View style={styles.eyebrowRow}>
                <Text style={styles.headerEyebrow}>DISTRIBUTION BENEFICIARIES</Text>
                <View style={styles.scopePill}>
                  <Ionicons name="location-sharp" size={11} color={sc.accent} />
                  <Text style={styles.scopePillText} numberOfLines={1}>
                    {distribution.barangay}
                  </Text>
                </View>
              </View>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {distribution.title}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => fetchHouseholds(distribution.id, true)}
                disabled={loading || refreshing}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color={sc.accent} />
                ) : (
                  <Ionicons name="refresh" size={18} color={sc.brandDark} />
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={onClose}>
                <Ionicons name="close" size={20} color={sc.brandDark} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Metrics Card */}
          <View style={styles.metricsCard}>
            <View style={styles.metricsRow}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>TOTAL REGISTERED</Text>
                <Text style={styles.metricValue}>{totalRegistered}</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>CLAIMED</Text>
                <Text style={[styles.metricValue, { color: '#059669' }]}>{totalClaimed}</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>NOT CLAIMED</Text>
                <Text style={[styles.metricValue, { color: '#D97706' }]}>{totalNotClaimed}</Text>
              </View>
            </View>

            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={['#10B981', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.progressBar, { width: `${Math.max(progressPercent, 0)}%` }]}
              />
            </View>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressLabel}>Claim Completion Rate</Text>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
            </View>
          </View>

          {/* Search Box */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color={sc.muted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, household code, or address..."
              placeholderTextColor={sc.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
                <Ionicons name="close-circle" size={16} color={sc.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Tabs */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
              onPress={() => setActiveTab('all')}
            >
              <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
                All ({totalRegistered})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'notYetClaimed' && styles.tabButtonActive]}
              onPress={() => setActiveTab('notYetClaimed')}
            >
              <Text style={[styles.tabText, activeTab === 'notYetClaimed' && styles.tabTextActive]}>
                Not Claimed ({totalNotClaimed})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'claimed' && styles.tabButtonActive]}
              onPress={() => setActiveTab('claimed')}
            >
              <Text style={[styles.tabText, activeTab === 'claimed' && styles.tabTextActive]}>
                Claimed ({totalClaimed})
              </Text>
            </TouchableOpacity>
          </View>

          {/* List Content */}
          {loading && !refreshing ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={sc.accent} />
              <Text style={styles.loadingText}>Loading beneficiaries...</Text>
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => fetchHouseholds(distribution.id)}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : filteredItems.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="people-outline" size={44} color={sc.muted} />
              <Text style={styles.emptyTitle}>
                {searchQuery ? 'No matching beneficiaries' : 'No beneficiaries found'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? 'Try adjusting your search terms or filter.'
                  : 'There are no registered households for this distribution yet.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              keyExtractor={(item) => item.id}
              renderItem={renderBeneficiaryItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  colors={[sc.accent]}
                  tintColor={sc.accent}
                />
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 20, 14, 0.58)',
    justifyContent: 'flex-end',
  },
  backdropPressable: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '88%',
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 20,
  },
  dragHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleWrap: {
    flex: 1,
    paddingRight: 10,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: sc.accent,
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 3,
  },
  scopePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: sc.brandDark,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: sc.brandDark,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#E2E8F0',
  },
  metricLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: sc.muted,
    marginBottom: 3,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: sc.brandDark,
  },
  progressTrack: {
    height: 7,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 5,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: sc.muted,
  },
  progressPercent: {
    fontSize: 11,
    fontWeight: '800',
    color: sc.brandDark,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: sc.ink,
    paddingVertical: 0,
  },
  clearSearchBtn: {
    padding: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: sc.brandDark,
  },
  tabText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: sc.muted,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 8,
  },
  cardItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarClaimed: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  avatarPending: {
    backgroundColor: '#F1F5F9',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '800',
  },
  avatarTextClaimed: {
    color: '#059669',
  },
  avatarTextPending: {
    color: sc.muted,
  },
  cardContent: {
    flex: 1,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  residentName: {
    fontSize: 14,
    fontWeight: '800',
    color: sc.brandDark,
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeClaimed: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  badgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  badgeTextClaimed: {
    color: '#059669',
  },
  badgeTextPending: {
    color: '#D97706',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeTag: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  codeTagText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: sc.brandDark,
  },
  addressText: {
    fontSize: 11.5,
    color: sc.muted,
    flex: 1,
  },
  claimDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  claimDetailText: {
    fontSize: 10.5,
    color: sc.muted,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: sc.muted,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    fontWeight: '600',
  },
  retryButton: {
    marginTop: 14,
    paddingHorizontal: 20,
    paddingVertical: 9,
    backgroundColor: sc.brandDark,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: sc.brandDark,
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: 12,
    color: sc.muted,
    textAlign: 'center',
    marginTop: 4,
  },
});
