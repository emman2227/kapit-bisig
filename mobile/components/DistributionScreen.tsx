import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { type ResidentDistributionItem } from '../services/api/ResidentQrService';
import { residentTheme } from '../theme';
import BottomNavigation from './ui/BottomNavigation';
import { DistributionListSkeleton } from './ui/Skeleton';

const residentColors = residentTheme.colors;

interface DistributionScreenProps {
  barangayName?: string;
  distributionItems?: ResidentDistributionItem[];
  isDistributionLoading?: boolean;
  isDistributionRefreshing?: boolean;
  distributionError?: string | null;
  distributionWarning?: string | null;
  distributionFetchedAt?: string | null;
  onRefreshDistributions?: (force?: boolean) => Promise<void>;
  onNavigate?: (
    screen: 'home' | 'distributions' | 'profile' | 'proof-request' | 'qr',
    options?: { distribution?: { id: string; name?: string; barangay?: string; scheduled?: string } | null }
  ) => void;
}

interface DistributionView extends ResidentDistributionItem {
  key: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  monthLabel: string;
  dayLabel: string;
  location: string;
  coverage: string;
}

function formatDistribution(item: ResidentDistributionItem, index: number): DistributionView {
  const rawSchedule = item.scheduled?.trim() || '';
  const parsed = rawSchedule ? new Date(rawSchedule) : null;
  const validDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const dateLabel = validDate
    ? validDate.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
    : rawSchedule || 'Schedule to be announced';
  const parsedEnd = item.endsAt ? new Date(item.endsAt) : null;
  const validEnd = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : null;
  const timeLabel = validDate
    ? [
        validDate.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
        validEnd?.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
      ].filter(Boolean).join(' – ')
    : '';
  const coverageList = Array.from(new Set([item.barangay, ...(item.assignedBarangays || [])])).filter(Boolean);

  return {
    ...item,
    key: item.id || `${item.barangay}-${item.createdAt || index}`,
    title: item.residentClaimed
      ? 'Relief distribution claimed'
      : item.lifecycleStatus === 'Active'
        ? 'Distribution is open'
        : item.lifecycleStatus === 'Completed'
          ? 'Distribution concluded'
          : 'Upcoming relief distribution',
    dateLabel,
    timeLabel,
    monthLabel: validDate ? validDate.toLocaleDateString('en-PH', { month: 'short' }).toUpperCase() : 'DATE',
    dayLabel: validDate ? String(validDate.getDate()) : '—',
    location: item.location?.trim() || `${item.barangay} Covered Court`,
    coverage: coverageList.join(', '),
  };
}

export default function DistributionScreen({
  barangayName,
  distributionItems = [],
  isDistributionLoading = false,
  isDistributionRefreshing = false,
  distributionError = null,
  distributionWarning = null,
  distributionFetchedAt = null,
  onRefreshDistributions,
  onNavigate,
}: DistributionScreenProps) {
  const insets = useSafeAreaInsets();
  const items = useMemo(
    () => distributionItems.map(formatDistribution),
    [distributionItems],
  );
  const [selected, setSelected] = useState<DistributionView | null>(null);
  const activeCount = items.filter((item) => item.lifecycleStatus === 'Active').length;
  const upcomingCount = items.filter((item) => item.lifecycleStatus !== 'Active' && item.lifecycleStatus !== 'Completed').length;
  const completedCount = items.filter((item) => item.lifecycleStatus === 'Completed').length;

  const onRefresh = useCallback(async () => {
    if (isDistributionRefreshing || !onRefreshDistributions) return;
    await onRefreshDistributions(true);
  }, [isDistributionRefreshing, onRefreshDistributions]);

  const updatedLabel = useMemo(() => {
    if (!distributionFetchedAt) return 'UPDATED';
    const parsed = new Date(distributionFetchedAt);
    if (Number.isNaN(parsed.getTime())) return 'UPDATED';
    return `UPDATED ${parsed.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
  }, [distributionFetchedAt]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 84 }]}
        refreshControl={(
          <RefreshControl
            refreshing={isDistributionRefreshing}
            onRefresh={onRefresh}
            tintColor={residentColors.icon}
            colors={[residentColors.icon]}
          />
        )}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>RELIEF SCHEDULES</Text>
            <Text style={styles.title}>Distributions</Text>
            <Text style={styles.subtitle}>
              {barangayName ? `Available for ${barangayName}` : 'Schedules available for your registered area'}
            </Text>
          </View>
          <View style={styles.headerIcon}>
            <Ionicons name="calendar-outline" size={24} color={residentColors.icon} />
          </View>
        </View>

        {!isDistributionLoading && !distributionError ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryText}>
              {activeCount > 0 ? `${activeCount} active` : upcomingCount > 0 ? `${upcomingCount} upcoming` : `${completedCount} completed`}
              {activeCount > 0 && upcomingCount > 0 ? ` • ${upcomingCount} upcoming` : ''}
            </Text>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{updatedLabel}</Text>
            </View>
          </View>
        ) : null}

        {distributionWarning ? (
          <View style={styles.warningCard}>
            <Ionicons name="cloud-offline-outline" size={18} color="#9A6700" />
            <Text style={styles.warningText}>{distributionWarning}</Text>
          </View>
        ) : null}

        {isDistributionLoading && items.length === 0 ? (
          <DistributionListSkeleton count={3} />
        ) : isDistributionLoading && items.length > 0 ? null : distributionError ? (
          <View style={styles.stateCard}>
            <View style={styles.stateIcon}>
              <Ionicons name="cloud-offline-outline" size={24} color={residentColors.icon} />
            </View>
            <Text style={styles.stateTitle}>Schedules unavailable</Text>
            <Text style={styles.stateText}>{distributionError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={onRefresh}
              disabled={isDistributionRefreshing || !onRefreshDistributions}
            >
              <Ionicons name="refresh" size={16} color={residentColors.inverse} />
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.stateCard}>
            <View style={styles.stateIcon}>
              <Ionicons name="calendar-clear-outline" size={24} color={residentColors.icon} />
            </View>
            <Text style={styles.stateTitle}>No active schedules</Text>
            <Text style={styles.stateText}>We’ll notify you when a relief distribution is announced.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.distributionCard}
                activeOpacity={0.78}
                onPress={() => setSelected(item)}
              >
                <View style={styles.dateTile}>
                  <Text style={styles.dateMonth}>{item.monthLabel}</Text>
                  <Text style={styles.dateDay}>{item.dayLabel}</Text>
                </View>
                <View style={styles.cardCopy}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    {item.lifecycleStatus === 'Active' ? (
                      <View style={styles.claimedPill}>
                        <View style={styles.liveDot} />
                        <Text style={styles.claimedText}>ACTIVE</Text>
                      </View>
                    ) : item.residentClaimed ? (
                      <View style={styles.claimedPill}>
                        <Ionicons name="checkmark" size={11} color={residentColors.icon} />
                        <Text style={styles.claimedText}>CLAIMED</Text>
                      </View>
                    ) : item.lifecycleStatus === 'Completed' ? (
                      <View style={styles.endedPill}>
                        <Ionicons name="time-outline" size={10} color="#6B7280" />
                        <Text style={styles.endedText}>ENDED</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.tagRow}>
                    {item.lifecycleStatus === 'Completed' && !item.residentClaimed ? (
                      <View style={styles.unclaimedPill}>
                        <Ionicons name="close-circle-outline" size={11} color="#6B7280" />
                        <Text style={styles.unclaimedPillText}>UNCLAIMED</Text>
                      </View>
                    ) : item.requiresBeneficiaryApproval ? (
                      item.isBeneficiaryApproved ? (
                        <View style={styles.approvedPill}>
                          <Ionicons name="checkmark-circle" size={11} color="#065F46" />
                          <Text style={styles.approvedPillText}>ENROLLED</Text>
                        </View>
                      ) : item.beneficiaryProofStatus === 'Pending Verification' ? (
                        <View style={styles.underReviewPill}>
                          <Ionicons name="time" size={10} color="#854D0E" />
                          <Text style={styles.underReviewPillText}>PROOF IN REVIEW</Text>
                        </View>
                      ) : (
                        <View style={styles.targetedPill}>
                          <Ionicons name="shield-outline" size={10} color="#92400E" />
                          <Text style={styles.targetedText}>PROOF REQUIRED</Text>
                        </View>
                      )
                    ) : (
                      <View style={styles.openPill}>
                        <Ionicons name="people-outline" size={10} color="#065F46" />
                        <Text style={styles.openText}>OPEN TO ALL</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={14} color={residentColors.icon} />
                    <Text style={styles.metaText}>{item.timeLabel || item.dateLabel}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={14} color={residentColors.icon} />
                    <Text style={styles.metaText} numberOfLines={1}>{item.location}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={19} color={residentColors.icon} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        transparent
        animationType="fade"
        visible={selected !== null}
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleCopy}>
                <Text style={styles.modalEyebrow}>DISTRIBUTION DETAILS</Text>
                <Text style={styles.modalTitle}>{selected?.title}</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setSelected(null)}>
                <Ionicons name="close" size={20} color={residentColors.icon} />
              </TouchableOpacity>
            </View>

            {[
              { icon: 'calendar-outline' as const, label: 'Schedule', value: `${selected?.dateLabel || ''}${selected?.timeLabel ? ` • ${selected.timeLabel}` : ''}` },
              { icon: 'location-outline' as const, label: 'Location', value: selected?.location || 'To be announced' },
              { icon: 'map-outline' as const, label: 'Covered barangays', value: selected?.coverage || 'Not specified' },
            ].map((detail) => (
              <View key={detail.label} style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name={detail.icon} size={18} color={residentColors.icon} />
                </View>
                <View style={styles.detailCopy}>
                  <Text style={styles.detailLabel}>{detail.label}</Text>
                  <Text style={styles.detailValue}>{detail.value}</Text>
                </View>
              </View>
            ))}

            {selected?.notes ? (
              <View style={styles.notesBox}>
                <Text style={styles.detailLabel}>Important note</Text>
                <Text style={styles.notesText}>{selected.notes}</Text>
              </View>
            ) : null}

            {selected?.residentClaimed ? (
              <View style={styles.claimedBanner}>
                <View style={styles.claimedHeader}>
                  <Ionicons name="checkmark-circle" size={19} color="#059669" />
                  <Text style={styles.claimedBannerTitle}>Relief Aid Claimed</Text>
                </View>
                <Text style={styles.claimedBannerDescription}>
                  You have successfully claimed your relief package for this distribution event.
                </Text>
              </View>
            ) : selected?.lifecycleStatus === 'Completed' ? (
              <View style={styles.proofEndedBanner}>
                <View style={styles.proofEndedHeader}>
                  <Ionicons name="information-circle" size={19} color="#4B5563" />
                  <Text style={styles.proofEndedTitle}>Distribution Concluded • Unclaimed</Text>
                </View>
                <Text style={styles.proofEndedDescription}>
                  {selected?.isBeneficiaryApproved
                    ? 'This distribution event has concluded. Your damage assessment was verified, but relief aid was not claimed during the scheduled window.'
                    : 'This distribution event has concluded and is no longer accepting claims or proof submissions.'}
                </Text>
                <View style={styles.windowClosedBadge}>
                  <Ionicons name="lock-closed-outline" size={14} color="#6B7280" />
                  <Text style={styles.windowClosedText}>Claim Window Closed</Text>
                </View>
              </View>
            ) : selected?.requiresBeneficiaryApproval ? (
              selected.isBeneficiaryApproved ? (
                <View style={styles.proofApprovedBanner}>
                  <View style={styles.proofApprovedHeader}>
                    <Ionicons name="checkmark-circle" size={19} color="#059669" />
                    <Text style={styles.proofApprovedTitle}>Verified Beneficiary • Enrolled</Text>
                  </View>
                  <Text style={styles.proofApprovedDescription}>
                    Your damage assessment has been verified. You are enrolled for this distribution. Present your QR claim pass at the venue to claim relief aid.
                  </Text>
                  <TouchableOpacity
                    style={styles.qrActionButton}
                    onPress={() => {
                      setSelected(null);
                      onNavigate?.('qr');
                    }}
                  >
                    <Ionicons name="qr-code-outline" size={16} color={residentColors.inverse} />
                    <Text style={styles.proofActionText}>View QR Claim Pass</Text>
                  </TouchableOpacity>
                </View>
              ) : selected.beneficiaryProofStatus === 'Pending Verification' ? (
                <View style={styles.proofReviewBanner}>
                  <View style={styles.proofReviewHeader}>
                    <Ionicons name="time" size={18} color="#854D0E" />
                    <Text style={styles.proofReviewTitle}>Damage Proof Under Review</Text>
                  </View>
                  <Text style={styles.proofReviewDescription}>
                    Your submitted damage assessment is currently under review by the admin. We will notify you once approved.
                  </Text>
                  <TouchableOpacity
                    style={styles.reviewActionButton}
                    onPress={() => {
                      const distPayload = selected ? {
                        id: selected.id,
                        name: selected.title,
                        barangay: selected.barangay,
                        scheduled: selected.scheduled,
                      } : null;
                      setSelected(null);
                      onNavigate?.('proof-request', { distribution: distPayload });
                    }}
                  >
                    <Ionicons name="document-text-outline" size={16} color="#854D0E" />
                    <Text style={styles.reviewActionText}>Check Review Status</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.proofRequiredBanner}>
                  <View style={styles.proofRequiredHeader}>
                    <Ionicons name="alert-circle" size={18} color="#B45309" />
                    <Text style={styles.proofRequiredTitle}>Damage Assessment Required</Text>
                  </View>
                  <Text style={styles.proofRequiredDescription}>
                    This distribution is restricted to residents with verified damage assessments. Submit your proof of damage to qualify and be enrolled.
                  </Text>
                  <TouchableOpacity
                    style={styles.proofActionButton}
                    onPress={() => {
                      const distPayload = selected ? {
                        id: selected.id,
                        name: selected.title,
                        barangay: selected.barangay,
                        scheduled: selected.scheduled,
                      } : null;
                      setSelected(null);
                      onNavigate?.('proof-request', { distribution: distPayload });
                    }}
                  >
                    <Ionicons name="camera-outline" size={16} color={residentColors.inverse} />
                    <Text style={styles.proofActionText}>Submit Proof of Damage</Text>
                  </TouchableOpacity>
                </View>
              )
            ) : (
              <View style={styles.openBanner}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#065F46" />
                <Text style={styles.openBannerText}>Open to all verified residents in the covered area.</Text>
              </View>
            )}

            <TouchableOpacity style={styles.doneButton} onPress={() => setSelected(null)}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <BottomNavigation activeTab="distributions" onNavigate={onNavigate} appearance="resident" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: residentColors.background },
  content: { paddingHorizontal: 20, paddingTop: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerCopy: { flex: 1, paddingRight: 16 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: residentColors.secondary },
  title: { marginTop: 5, fontSize: 28, lineHeight: 34, fontWeight: '800', color: residentColors.ink },
  subtitle: { marginTop: 5, fontSize: 13, lineHeight: 19, color: residentColors.secondary },
  headerIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  summaryRow: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryText: { fontSize: 14, fontWeight: '700', color: residentColors.ink },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: residentColors.accentSoft, borderWidth: 1, borderColor: residentColors.accent },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: residentColors.brand },
  liveText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8, color: residentColors.ink },
  warningCard: { marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#FFF8E1', borderWidth: 1, borderColor: '#F4D58D' },
  warningText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: '#76520A' },
  list: { gap: 10 },
  distributionCard: { minHeight: 104, padding: 13, flexDirection: 'row', alignItems: 'center', borderRadius: 16, backgroundColor: residentColors.surface, borderWidth: 1, borderColor: residentColors.borderAccent, ...residentTheme.shadow },
  dateTile: { width: 58, height: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: residentColors.accentSoft, borderWidth: 1, borderColor: residentColors.accent },
  dateMonth: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, color: residentColors.accentInk },
  dateDay: { marginTop: 2, fontSize: 24, lineHeight: 28, fontWeight: '800', color: residentColors.ink },
  cardCopy: { flex: 1, marginLeft: 13, marginRight: 8 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: residentColors.ink },
  claimedPill: { paddingHorizontal: 6, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 999, backgroundColor: residentColors.surfaceMuted },
  claimedText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.4, color: residentColors.ink },
  endedPill: { paddingHorizontal: 6, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  endedText: { fontSize: 7.5, fontWeight: '900', letterSpacing: 0.4, color: '#6B7280' },
  metaRow: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { flex: 1, fontSize: 11.5, color: residentColors.secondary },
  stateCard: { marginTop: 24, minHeight: 260, padding: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: residentColors.surface, borderWidth: 1, borderColor: residentColors.borderAccent, ...residentTheme.shadow },
  stateIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  stateTitle: { marginTop: 14, fontSize: 17, fontWeight: '800', color: residentColors.ink },
  stateText: { marginTop: 7, fontSize: 13, lineHeight: 19, color: residentColors.secondary, textAlign: 'center' },
  retryButton: { marginTop: 16, minHeight: 42, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: residentColors.brand },
  retryText: { color: residentColors.inverse, fontSize: 13, fontWeight: '800' },
  modalOverlay: { flex: 1, padding: 20, justifyContent: 'flex-end', backgroundColor: residentColors.overlay },
  modalCard: { padding: 20, paddingBottom: 24, borderRadius: 24, backgroundColor: residentColors.surface, borderWidth: 1, borderColor: residentColors.borderAccent },
  modalHandle: { width: 42, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: residentColors.border },
  modalHeader: { marginTop: 17, marginBottom: 20, flexDirection: 'row', alignItems: 'flex-start' },
  modalTitleCopy: { flex: 1, paddingRight: 12 },
  modalEyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: residentColors.secondary },
  modalTitle: { marginTop: 4, fontSize: 20, lineHeight: 25, fontWeight: '800', color: residentColors.ink },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  detailRow: { paddingVertical: 11, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: residentColors.divider },
  detailIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent },
  detailCopy: { flex: 1, marginLeft: 11 },
  detailLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: residentColors.secondary },
  detailValue: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '600', color: residentColors.ink },
  notesBox: { marginTop: 10, padding: 13, borderRadius: 12, backgroundColor: residentColors.surfaceMuted },
  notesText: { marginTop: 5, fontSize: 12, lineHeight: 18, color: residentColors.secondary },
  tagRow: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 6 },
  targetedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D' },
  targetedText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4, color: '#92400E' },
  approvedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  approvedPillText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4, color: '#065F46' },
  underReviewPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999, backgroundColor: '#FEF9C3', borderWidth: 1, borderColor: '#FDE047' },
  underReviewPillText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4, color: '#854D0E' },
  unclaimedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  unclaimedPillText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4, color: '#6B7280' },
  openPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  openText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4, color: '#065F46' },
  claimedBanner: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  claimedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  claimedBannerTitle: { fontSize: 13, fontWeight: '800', color: '#065F46' },
  claimedBannerDescription: { marginTop: 5, fontSize: 11.5, lineHeight: 16.5, color: '#047857' },
  proofEndedBanner: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB' },
  proofEndedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proofEndedTitle: { fontSize: 13, fontWeight: '800', color: '#374151' },
  proofEndedDescription: { marginTop: 5, fontSize: 11.5, lineHeight: 16.5, color: '#4B5563' },
  windowClosedBadge: { marginTop: 12, minHeight: 38, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: '#E5E7EB' },
  windowClosedText: { color: '#4B5563', fontSize: 12, fontWeight: '800' },
  proofApprovedBanner: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  proofApprovedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proofApprovedTitle: { fontSize: 13, fontWeight: '800', color: '#065F46' },
  proofApprovedDescription: { marginTop: 5, fontSize: 11.5, lineHeight: 16.5, color: '#047857' },
  qrActionButton: { marginTop: 11, minHeight: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: residentColors.brand },
  proofReviewBanner: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: '#FEF9C3', borderWidth: 1, borderColor: '#FDE047' },
  proofReviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proofReviewTitle: { fontSize: 13, fontWeight: '800', color: '#854D0E' },
  proofReviewDescription: { marginTop: 5, fontSize: 11.5, lineHeight: 16.5, color: '#713F12' },
  reviewActionButton: { marginTop: 11, minHeight: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: '#FEF08A', borderWidth: 1, borderColor: '#FACC15' },
  reviewActionText: { color: '#713F12', fontSize: 12.5, fontWeight: '800' },
  proofRequiredBanner: { marginTop: 14, padding: 13, borderRadius: 14, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  proofRequiredHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proofRequiredTitle: { fontSize: 13, fontWeight: '800', color: '#92400E' },
  proofRequiredDescription: { marginTop: 5, fontSize: 11.5, lineHeight: 16.5, color: '#78350F' },
  proofActionButton: { marginTop: 11, minHeight: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: residentColors.brand },
  proofActionText: { color: residentColors.inverse, fontSize: 12.5, fontWeight: '800' },
  openBanner: { marginTop: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  openBannerText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: '#065F46', fontWeight: '600' },
  doneButton: { marginTop: 18, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: residentColors.brand },
  doneText: { color: residentColors.inverse, fontSize: 14, fontWeight: '800' },
});
