import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Typography } from './ui/Typography';
import { residentTheme, theme } from '../theme';
import {
  discardQueuedResidentProofSubmission,
  fetchActiveBeneficiaryEvent,
  fetchResidentProofSubmissionStatus,
  formatSyncErrorMessage,
  getQueuedResidentProofSubmissions,
  getResidentSession,
  ResidentDisasterEvent,
  ResidentProofSubmissionStatus,
  retryQueuedResidentProofSubmission,
  submitResidentProofSubmission,
  takeQueuedResidentProofSubmissionForEditing,
} from '../services/api/ResidentQrService';
import { saveProofDraft, loadProofDraft, clearProofDraft } from '../services/sync/ProofDraftService';
import {
  isCachedEventUsable,
  listOfflineProofRecords,
  loadResidentOfflineCache,
  persistProofPhoto,
  updateResidentOfflineCache,
  type OfflineProofRecord,
} from '../services/sync/ResidentOfflineStore';
import {
  subscribeToProofSync,
  syncCurrentResidentProofs,
} from '../services/sync/ProofSyncCoordinator';
import {
  WatermarkOverlay,
  captureWatermarkedPhoto,
  buildWatermarkLabel,
  getScaledWatermarkDimensions,
} from '../services/sync/photoWatermark';

const residentColors = residentTheme.colors;

type DamageType = 'Flood' | 'House Damage' | 'Storm Surge' | 'Landslide' | 'Livelihood Loss' | 'Other';
type RequirementTone = 'ready' | 'pending' | 'warning';

type ProofPhoto = {
  id: string;
  uri: string;
  watermarked?: boolean;
};

const DAMAGE_TYPES: DamageType[] = [
  'Flood',
  'House Damage',
  'Storm Surge',
  'Landslide',
  'Livelihood Loss',
  'Other',
];

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 5;

function buildClientId(): string {
  return `resident-proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function RequirementPill({ label, tone }: { label: string; tone: RequirementTone }) {
  return (
    <View
      style={[
        styles.requirementPill,
        tone === 'ready' && styles.requirementPillReady,
        tone === 'pending' && styles.requirementPillPending,
        tone === 'warning' && styles.requirementPillWarning,
      ]}
    >
      <Text
        style={[
          styles.requirementPillText,
          tone === 'ready' && styles.requirementPillTextReady,
          tone === 'pending' && styles.requirementPillTextPending,
          tone === 'warning' && styles.requirementPillTextWarning,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function FormSectionHeader({ step, icon, title, description, badge }: {
  step: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionStepIcon}>
        <Ionicons name={icon} size={18} color={residentColors.inverse} />
      </View>
      <View style={styles.sectionHeaderCopy}>
        <Text style={styles.sectionEyebrow}>STEP {step}</Text>
        <Typography variant="body" weight="semiBold">{title}</Typography>
        <Typography variant="caption" color={theme.colors.textSecondary}>{description}</Typography>
      </View>
      <View style={styles.sectionBadge}><Text style={styles.sectionBadgeText}>{badge}</Text></View>
    </View>
  );
}

function formatSchedule(value?: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return 'Schedule to be announced';
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface TargetDistributionInfo {
  id: string;
  barangay?: string;
  name?: string;
  scheduled?: string;
}

interface ResidentProofRequestScreenProps {
  onBack: () => void;
  onSignInRequired: () => void;
  targetDistribution?: TargetDistributionInfo | null;
}

export default function ResidentProofRequestScreen({
  onBack,
  onSignInRequired,
  targetDistribution,
}: ResidentProofRequestScreenProps) {
  const insets = useSafeAreaInsets();
  const [activeEvent, setActiveEvent] = useState<ResidentDisasterEvent | null>(null);
  const [proofStatus, setProofStatus] = useState<ResidentProofSubmissionStatus | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDamageType, setSelectedDamageType] = useState<DamageType>('Flood');
  const [description, setDescription] = useState('');
  const [supportingInfo, setSupportingInfo] = useState('');
  const [showSupportingInfo, setShowSupportingInfo] = useState(false);
  const [photos, setPhotos] = useState<ProofPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [queuedRecords, setQueuedRecords] = useState<OfflineProofRecord[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncAuthRequired, setSyncAuthRequired] = useState(false);
  const [draftRestoredBanner, setDraftRestoredBanner] = useState(false);
  const [residentBarangay, setResidentBarangay] = useState('');
  const [watermarkUri, setWatermarkUri] = useState<string | null>(null);
  const [watermarkBarangay, setWatermarkBarangay] = useState('');
  const [watermarkDateLabel, setWatermarkDateLabel] = useState('');
  const [watermarkDimensions, setWatermarkDimensions] = useState<{ width: number; height: number }>({ width: 720, height: 960 });
  const watermarkViewRef = useRef<View | null>(null);
  const imageLoadedResolveRef = useRef<(() => void) | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const residentTokenRef = useRef<string | null>(null);
  const residentIdRef = useRef<string | null>(null);
  const draftLoadedRef = useRef(false);

  const trimmedDescriptionLength = description.trim().length;
  const descriptionReady = trimmedDescriptionLength >= 10;
  const photosReady = photos.length >= MIN_PHOTOS;
  const eventReady = Boolean(targetDistribution || activeEvent);
  const completedRequirementCount = [eventReady, descriptionReady, photosReady].filter(Boolean).length;
  const remainingPhotos = Math.max(0, MIN_PHOTOS - photos.length);
  const proofLocked = proofStatus?.status === 'Approved' || proofStatus?.status === 'Pending Verification';
  const canEditProof = !proofLocked;
  const submitDisabled = submitting || eventLoading || (!activeEvent && !targetDistribution) || proofLocked;
  const footerPadding = Math.max(insets.bottom, theme.spacing.md);
  const hasSupportingInfo = supportingInfo.trim().length > 0;
  const showingSupportingInfo = showSupportingInfo || hasSupportingInfo;

  const missingItems = [
    !eventReady ? 'wait for an active disaster event' : null,
    !descriptionReady ? 'add a short description' : null,
    !photosReady ? `attach ${remainingPhotos} more photo${remainingPhotos === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];

  const footerMessage = missingItems.length === 0
      ? 'Everything looks ready for admin review.'
      : `Before sending, ${missingItems.join(', ')}.`;

  const loadScreenData = useCallback(async () => {
    setEventLoading(true);
    try {
      const session = await getResidentSession();
      if (!session) {
        setActiveEvent(null);
        setQueuedCount(0);
        return;
      }
      residentTokenRef.current = session.token;
      residentIdRef.current = session.residentId;

      const cache = await loadResidentOfflineCache();
      const cachedForResident = cache?.residentId === session.residentId ? cache : null;
      const cachedEvent = cachedForResident && isCachedEventUsable(cachedForResident)
        ? cachedForResident.activeEvent
        : null;
      if (cachedEvent) {
        setActiveEvent(cachedEvent);
        setProofStatus(cachedForResident?.proofStatus ?? null);
      }

      await syncCurrentResidentProofs();
      const [eventResult, queue] = await Promise.all([
        fetchActiveBeneficiaryEvent(session.token),
        getQueuedResidentProofSubmissions(session.residentId),
      ]);

      const currentEvent = eventResult.success ? eventResult.data ?? null : cachedEvent;
      setActiveEvent(currentEvent);
      setQueuedCount(queue.length);
      setQueuedRecords(queue);

      if (eventResult.success) {
        await updateResidentOfflineCache(session.residentId, {
          activeEvent: eventResult.data ?? null,
          activeEventFetchedAt: new Date().toISOString(),
        });
      }

      const currentEventId = currentEvent?.id || currentEvent?._id;
      if (targetDistribution?.id) {
        const statusResult = await fetchResidentProofSubmissionStatus(session.token, null, targetDistribution.id);
        if (statusResult.success) {
          setProofStatus(statusResult.data ?? null);
        } else {
          setProofStatus(null);
        }
      } else if (currentEventId) {
        const statusResult = await fetchResidentProofSubmissionStatus(session.token, currentEventId, null);
        if (statusResult.success) {
          setProofStatus(statusResult.data ?? null);
          await updateResidentOfflineCache(session.residentId, { proofStatus: statusResult.data ?? null });
        } else if (!cachedForResident) {
          setProofStatus(null);
        }
      } else {
        setProofStatus(null);
      }
    } finally {
      setEventLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScreenData().catch(() => {
      setEventLoading(false);
    });

    // Load resident session for barangay (watermark) and draft restore
    (async () => {
      const session = await getResidentSession();
      if (!session) return;
      residentTokenRef.current = session.token;
      residentIdRef.current = session.residentId;
      if (session?.barangay) {
        setResidentBarangay(session.barangay);
      }

      // Restore draft if one exists
      const draft = await loadProofDraft(session.residentId, session.token);
      if (draft && !draftLoadedRef.current) {
        draftLoadedRef.current = true;
        setSelectedDamageType(draft.damageType as DamageType);
        setDescription(draft.description);
        setSupportingInfo(draft.supportingInfo);
        setShowSupportingInfo(draft.showSupportingInfo);
        if (draft.photoUris.length > 0) {
          setPhotos(draft.photoUris.map((uri, idx) => ({
            id: `draft-${idx}-${Date.now()}`,
            uri,
            watermarked: true,
          })));
        }
        setDraftRestoredBanner(true);
      }
    })().catch(() => undefined);
  }, [loadScreenData]);

  useEffect(() => subscribeToProofSync((next) => {
    setIsOnline(next.online);
    setIsSyncing(next.syncing);
    setSyncAuthRequired(next.authRequired);
    setQueuedRecords(next.records);
    setQueuedCount(next.records.length);
  }), []);

  // Debounced draft auto-save
  useEffect(() => {
    if (!draftLoadedRef.current && !description && photos.length === 0) return;

    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
    }

    draftSaveTimerRef.current = setTimeout(() => {
      const residentId = residentIdRef.current;
      if (!residentId) return;

      saveProofDraft(residentId, {
        damageType: selectedDamageType,
        description,
        supportingInfo,
        showSupportingInfo,
        selectedDistributionId: null,
        photoUris: photos.map((p) => p.uri),
      }).catch(() => undefined);
    }, 500);

    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [selectedDamageType, description, supportingInfo, showSupportingInfo, photos]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadScreenData();
    } finally {
      setRefreshing(false);
    }
  }, [loadScreenData]);

  const handleWatermarkImageLoad = useCallback(() => {
    if (imageLoadedResolveRef.current) {
      imageLoadedResolveRef.current();
      imageLoadedResolveRef.current = null;
    }
  }, []);

  const appendAssets = useCallback(async (uris: string[]) => {
    // Apply watermark to each photo before adding
    const barangay = residentBarangay || 'Unknown';
    const dateLabel = buildWatermarkLabel();

    for (const uri of uris) {
      // Determine original image aspect ratio
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        Image.getSize(
          uri,
          (w, h) => resolve(getScaledWatermarkDimensions(w, h)),
          () => resolve({ width: 720, height: 960 }),
        );
      });

      setWatermarkDimensions(dims);
      setWatermarkUri(uri);
      setWatermarkBarangay(barangay);
      setWatermarkDateLabel(dateLabel);

      // Wait for image to load with fadeDuration={0} (eliminates Android 300ms fade-in darkening)
      await Promise.race([
        new Promise<void>((resolve) => {
          imageLoadedResolveRef.current = resolve;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 600)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 60));

      let finalUri = uri;
      try {
        if (watermarkViewRef.current) {
          finalUri = await captureWatermarkedPhoto(watermarkViewRef, dims.width, dims.height);
        }
      } catch {
        // Watermark failed — use original photo
      }

      const residentId = residentIdRef.current;
      if (!residentId) {
        Alert.alert('Login required', 'Please sign in again before adding proof photos.');
        return;
      }
      try {
        finalUri = (await persistProofPhoto(residentId, finalUri)).uri;
      } catch {
        Alert.alert('Photo not saved', 'The photo could not be stored safely on this device. Please try again.');
        continue;
      }

      setPhotos((current) => {
        if (current.length >= MAX_PHOTOS) return current;
        if (current.some((item) => item.uri === finalUri || item.uri === uri)) return current;
        return [
          ...current,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            uri: finalUri,
            watermarked: finalUri !== uri,
          },
        ];
      });
    }

    setWatermarkUri(null);
  }, [residentBarangay]);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow media library access to attach proof photos.');
      return;
    }

    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert('Photo limit reached', `You can only upload up to ${MAX_PHOTOS} proof photos.`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.9,
    });

    if (!result.canceled) {
      void appendAssets(result.assets.map((asset) => asset.uri));
    }
  }, [appendAssets, photos.length]);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access to capture proof photos.');
      return;
    }

    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Photo limit reached', `You can only upload up to ${MAX_PHOTOS} proof photos.`);
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      void appendAssets([result.assets[0].uri]);
    }
  }, [appendAssets, photos.length]);

  const removePhoto = useCallback((id: string) => {
    setPhotos((current) => current.filter((item) => item.id !== id));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!activeEvent) {
      Alert.alert('No active disaster', 'There is no active disaster event accepting proof submissions right now.');
      return;
    }

    if (description.trim().length < 10) {
      Alert.alert('Description required', 'Please describe the damage in at least 10 characters.');
      return;
    }

    if (photos.length < MIN_PHOTOS) {
      Alert.alert('More photos needed', `Please attach at least ${MIN_PHOTOS} proof photos.`);
      return;
    }

    const session = await getResidentSession();
    if (!session) {
      Alert.alert('Login required', 'Please log in again before submitting a proof request.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitResidentProofSubmission(session.token, session.residentId, {
        distributionId: targetDistribution?.id || null,
        disasterEventId: targetDistribution?.id ? null : (activeEvent?.id || activeEvent?._id || ''),
        eventSnapshot: activeEvent ? {
          name: activeEvent.name,
          disasterType: activeEvent.disasterType,
          submissionDeadline: activeEvent.submissionDeadline,
        } : null,
        damageType: selectedDamageType,
        description: description.trim(),
        supportingInfo: supportingInfo.trim(),
        dateSubmitted: new Date().toISOString(),
        photoUris: photos.map((item) => item.uri),
        clientGeneratedId: buildClientId(),
      });

      if (!result.success) {
        Alert.alert('Submission failed', result.message || 'Unable to submit proof right now.');
        return;
      }

      const updatedQueue = await getQueuedResidentProofSubmissions(session.residentId);
      setQueuedCount(updatedQueue.length);
      setQueuedRecords(updatedQueue);

      Alert.alert(
        result.needsAttention ? 'Saved — attention needed' : result.queued ? 'Saved offline' : 'Submitted',
        result.message || (result.queued
          ? 'Your request was saved offline and will sync automatically.'
          : 'Your proof submission is now pending admin verification.'),
      );

      setDescription('');
      setSupportingInfo('');
      setShowSupportingInfo(false);
      setPhotos([]);
      setSelectedDamageType('Flood');

      // Clear draft after successful submission
      clearProofDraft(session.residentId).catch(() => undefined);

      if (!result.queued) {
        await loadScreenData();
      }
    } catch (error) {
      Alert.alert('Submission failed', error instanceof Error ? error.message : 'Unable to submit proof right now.');
    } finally {
      setSubmitting(false);
    }
  }, [activeEvent, description, loadScreenData, photos, selectedDamageType, supportingInfo]);

  const handleManualSync = useCallback(async () => {
    await syncCurrentResidentProofs();
    await loadScreenData();
  }, [loadScreenData]);

  const handleRetryQueued = useCallback(async (record: OfflineProofRecord) => {
    await retryQueuedResidentProofSubmission(record.ownerResidentId, record.clientGeneratedId);
    await handleManualSync();
  }, [handleManualSync]);

  const handleEditQueued = useCallback(async (record: OfflineProofRecord) => {
    await takeQueuedResidentProofSubmissionForEditing(record.ownerResidentId, record.clientGeneratedId);
    setSelectedDamageType(record.damageType);
    setDescription(record.description);
    setSupportingInfo(record.supportingInfo || '');
    setShowSupportingInfo(Boolean(record.supportingInfo));
    setPhotos(record.photos.map((photo, index) => ({
      id: `queued-edit-${index}-${Date.now()}`,
      uri: photo.uri,
      watermarked: true,
    })));
    setProofStatus(null);
    draftLoadedRef.current = true;
    await loadScreenData();
  }, [loadScreenData]);

  const handleDiscardQueued = useCallback((record: OfflineProofRecord) => {
    Alert.alert(
      'Discard saved proof?',
      'This permanently removes the saved request and its photos from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            discardQueuedResidentProofSubmission(record.ownerResidentId, record.clientGeneratedId)
              .then(loadScreenData)
              .catch(() => Alert.alert('Unable to discard', 'Please try again.'));
          },
        },
      ],
    );
  }, [loadScreenData]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={residentColors.icon}
              colors={[residentColors.icon]}
            />
          )}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <TouchableOpacity style={styles.backButton} onPress={onBack}>
              <Ionicons name="arrow-back" size={20} color={residentColors.inverse} />
            </TouchableOpacity>

            <View style={styles.headerTextWrap}>
              <Text style={styles.heroEyebrow}>DAMAGE ASSESSMENT</Text>
              <Text style={styles.heroTitle}>Submit Proof of Damage</Text>
              <Text style={styles.heroDescription}>Upload photos and details of property or calamity damage to qualify for targeted relief distributions.</Text>
            </View>
            <View style={styles.heroIcon}>
              <Ionicons name="document-attach-outline" size={22} color={residentColors.inverse} />
            </View>
          </View>

          {!isOnline ? (
            <View style={styles.offlineBanner}>
              <Ionicons name="cloud-offline-outline" size={17} color="#92400E" />
              <Text style={styles.offlineBannerText}>Offline mode — drafts and proof photos stay on this device.</Text>
            </View>
          ) : null}

          {syncAuthRequired ? (
            <Pressable style={styles.authBanner} onPress={onSignInRequired}>
              <Ionicons name="lock-closed-outline" size={17} color="#991B1B" />
              <Text style={styles.authBannerText}>Sign in again before saved proofs can sync.</Text>
              <Text style={styles.authBannerAction}>Sign in</Text>
            </Pressable>
          ) : null}

          {draftRestoredBanner ? (
            <Pressable
              style={styles.draftBanner}
              onPress={() => setDraftRestoredBanner(false)}
            >
              <Ionicons name="document-text-outline" size={16} color={residentColors.icon} />
              <Text style={styles.draftBannerText}>Draft restored from your last session</Text>
              <Ionicons name="close-outline" size={16} color={residentColors.icon} />
            </Pressable>
          ) : null}

          {queuedRecords.length > 0 ? (
            <Card variant="outlined" padding="md" style={styles.savedProofsCard}>
              <View style={styles.savedProofsHeader}>
                <View>
                  <Typography variant="body" weight="semiBold">Saved submissions</Typography>
                  <Typography variant="caption" color={theme.colors.textSecondary}>
                    These proofs remain on this device until the server confirms them.
                  </Typography>
                </View>
                <Button
                  title={isSyncing ? 'Syncing...' : 'Sync now'}
                  size="sm"
                  variant="outline"
                  appearance="resident"
                  disabled={!isOnline || isSyncing || syncAuthRequired}
                  onPress={() => void handleManualSync()}
                />
              </View>

              {queuedRecords.map((record) => (
                <View key={record.clientGeneratedId} style={styles.savedProofRow}>
                  <View style={styles.savedProofCopy}>
                    <Text style={styles.savedProofTitle}>{record.eventSnapshot?.name || 'Targeted Proof Submission'}</Text>
                    <Text style={styles.savedProofMeta}>
                      {record.status === 'SYNCING'
                        ? 'Syncing now'
                        : record.status === 'NEEDS_ATTENTION'
                          ? 'Needs attention'
                          : syncAuthRequired
                            ? 'Sign in required'
                            : 'Waiting to sync'} · {record.photos.length} photos
                    </Text>
                    {record.lastError ? <Text style={styles.savedProofError}>{formatSyncErrorMessage(record.lastError)}</Text> : null}
                  </View>
                  <View style={styles.savedProofActions}>
                    {record.status === 'NEEDS_ATTENTION' ? (
                      <>
                        <Pressable onPress={() => void handleRetryQueued(record)} style={styles.savedProofAction}>
                          <Text style={styles.savedProofActionText}>Retry</Text>
                        </Pressable>
                        <Pressable onPress={() => void handleEditQueued(record)} style={styles.savedProofAction}>
                          <Text style={styles.savedProofActionText}>Edit</Text>
                        </Pressable>
                      </>
                    ) : null}
                    <Pressable onPress={() => handleDiscardQueued(record)} style={styles.savedProofAction}>
                      <Text style={[styles.savedProofActionText, styles.savedProofDiscardText]}>Discard</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}

          <Card variant="outlined" padding="md" style={styles.summaryCard}>
            <View style={styles.summaryTopRow}>
              <View style={styles.summaryIcon}>
                <Ionicons name="shield-checkmark-outline" size={18} color={residentColors.icon} />
              </View>
              <View style={styles.summaryCopy}>
                <Typography variant="label" color={theme.colors.textMuted}>Target Beneficiary</Typography>
                <Typography variant="body" weight="semiBold">One verified proof per disaster</Typography>
                <Typography variant="caption" color={theme.colors.textSecondary}>
                  Once approved, you will be enrolled automatically in matching barangay distributions.
                </Typography>
              </View>
              <View style={styles.progressBubble}>
                <Text style={styles.progressBubbleText}>{completedRequirementCount}/3</Text>
              </View>
            </View>

            <View style={styles.progressTrack} accessibilityLabel={`${completedRequirementCount} of 3 requirements complete`}>
              <View style={[styles.progressFill, { width: `${(completedRequirementCount / 3) * 100}%` }]} />
            </View>

            {queuedCount > 0 ? (
              <View style={styles.queueInline}>
                <Ionicons name="cloud-upload-outline" size={16} color={theme.colors.warning} />
                <Typography variant="caption" color={theme.colors.textSecondary} style={styles.queueInlineText}>
                  {queuedCount} saved request{queuedCount === 1 ? '' : 's'} waiting to sync.
                </Typography>
              </View>
            ) : null}

            <View style={styles.requirementWrap}>
              <RequirementPill
                label={activeEvent ? 'Disaster event found' : eventLoading ? 'Checking active event' : 'No active event'}
                tone={activeEvent ? 'ready' : eventLoading ? 'pending' : 'warning'}
              />
              <RequirementPill
                label={`${Math.min(trimmedDescriptionLength, 10)}/10 description`}
                tone={descriptionReady ? 'ready' : 'pending'}
              />
              <RequirementPill
                label={`${photos.length}/${MIN_PHOTOS} photos`}
                tone={photosReady ? 'ready' : 'pending'}
              />
            </View>

            <View style={styles.selectionBlock}>
              <View style={styles.selectionHeaderRow}>
                <Typography variant="caption" color={theme.colors.textSecondary}>Relief Program / Disaster Event</Typography>
              </View>

              {eventLoading && !activeEvent && !targetDistribution ? (
                <Typography variant="caption" color={theme.colors.textSecondary}>
                  Checking active relief distributions...
                </Typography>
              ) : targetDistribution ? (
                <View style={styles.selectedDistributionCard}>
                  <View style={styles.selectedDistributionHeader}>
                    <View style={styles.selectedDistributionIcon}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={residentColors.icon} />
                    </View>
                    <View style={styles.selectedDistributionCopy}>
                      <Typography variant="body" weight="semiBold">
                        {targetDistribution.name || (targetDistribution.barangay ? `${targetDistribution.barangay} Relief Distribution` : 'Targeted Distribution')}
                      </Typography>
                      <Typography variant="caption" color={theme.colors.textSecondary}>
                        {targetDistribution.barangay ? `Barangay ${targetDistribution.barangay} • ` : ''}Targeted Relief Distribution
                      </Typography>
                    </View>
                  </View>
                  <Typography variant="caption" color={theme.colors.textSecondary}>
                    Submitting proof for this specific relief distribution. Once verified by the admin, your claim pass for this distribution will unlock.
                  </Typography>
                </View>
              ) : !activeEvent ? (
                <View style={styles.emptyState}>
                  <Ionicons name="calendar-clear-outline" size={20} color={residentColors.icon} />
                  <Typography variant="caption" color={theme.colors.textSecondary} style={styles.emptyStateText}>
                    No active disaster event is accepting proof submissions right now.
                  </Typography>
                </View>
              ) : (
                <View style={styles.selectedDistributionCard}>
                  <View style={styles.selectedDistributionHeader}>
                    <View style={styles.selectedDistributionIcon}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={residentColors.icon} />
                    </View>
                    <View style={styles.selectedDistributionCopy}>
                      <Typography variant="body" weight="semiBold">Calamity Damage Assessment</Typography>
                      <Typography variant="caption" color={theme.colors.textSecondary}>
                        {residentBarangay ? `Barangay ${residentBarangay} • ` : ''}Targeted Relief Assistance
                      </Typography>
                    </View>
                  </View>
                  <Typography variant="caption" color={theme.colors.textSecondary}>
                    Your approved damage assessment qualifies your household for targeted relief distributions in {residentBarangay || 'your barangay'}.
                  </Typography>
                </View>
              )}
            </View>
          </Card>

          {proofStatus ? (
            <View style={[
              styles.statusCard,
              proofStatus.status === 'Approved' && styles.statusCardApproved,
              proofStatus.status === 'Rejected' && styles.statusCardRejected,
            ]}>
              <View style={styles.statusIcon}>
                <Ionicons
                  name={proofStatus.status === 'Approved' ? 'checkmark-circle' : proofStatus.status === 'Rejected' ? 'alert-circle' : 'time'}
                  size={24}
                  color={proofStatus.status === 'Approved' ? '#15803D' : proofStatus.status === 'Rejected' ? '#B91C1C' : '#A16207'}
                />
              </View>
              <View style={styles.statusCopy}>
                <Text style={styles.statusEyebrow}>SUBMISSION STATUS</Text>
                <Text style={styles.statusTitle}>
                  {proofStatus.status === 'Approved' ? 'Proof approved' : proofStatus.status === 'Rejected' ? 'Changes are needed' : 'Under admin review'}
                </Text>
                <Text style={styles.statusMessage}>
                  {proofStatus.status === 'Approved'
                    ? `You are eligible for this event. Any matching distribution created for ${residentBarangay || 'your barangay'} will enroll you automatically.`
                    : proofStatus.status === 'Rejected'
                      ? (proofStatus.rejectionReason || 'Review the proof details and submit clearer information.')
                      : 'You do not need to submit again. We will notify you after the admin completes the review.'}
                </Text>
                <View style={styles.statusMetaRow}>
                  <Text style={styles.statusMeta}>{proofStatus.photoCount} photos</Text>
                  <Text style={styles.statusMeta}>Version {proofStatus.submissionVersion}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {canEditProof ? (
          <>
          <Card variant="outlined" padding="md" style={styles.sectionCard}>
            <FormSectionHeader
              step={1}
              icon="alert-circle-outline"
              title="Damage details"
              description="Choose the damage type and describe what was affected."
              badge={`${trimmedDescriptionLength}/10`}
            />

            <View style={styles.fieldGroup}>
              <Typography variant="caption" color={theme.colors.textSecondary}>Damage type</Typography>
              <View style={styles.chipWrap}>
                {DAMAGE_TYPES.map((type) => {
                  const selected = type === selectedDamageType;
                  return (
                    <Pressable
                      key={type}
                      onPress={() => setSelectedDamageType(type)}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{type}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.fieldHeadingRow}>
                <Typography variant="caption" color={theme.colors.textSecondary}>Damage description</Typography>
                <Typography variant="caption" color={descriptionReady ? theme.colors.success : theme.colors.textMuted}>
                  Minimum 10 characters
                </Typography>
              </View>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Example: Knee-high flood water damaged our floor, bed, and school supplies."
                placeholderTextColor={theme.colors.textMuted}
                multiline
                style={styles.textArea}
              />
            </View>

            {showingSupportingInfo ? (
              <View style={styles.fieldGroup}>
                <View style={styles.fieldHeadingRow}>
                  <Typography variant="caption" color={theme.colors.textSecondary}>Extra note</Typography>
                  {!hasSupportingInfo ? (
                    <Pressable onPress={() => setShowSupportingInfo(false)} style={styles.inlineAction}>
                      <Ionicons name="close-outline" size={16} color={residentColors.icon} />
                      <Text style={styles.inlineActionText}>Hide</Text>
                    </Pressable>
                  ) : null}
                </View>
                <TextInput
                  value={supportingInfo}
                  onChangeText={setSupportingInfo}
                  placeholder="Optional details like water level, evacuation, or affected family members."
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  style={[styles.textArea, styles.secondaryTextArea]}
                />
              </View>
            ) : (
              <Pressable style={styles.optionalToggle} onPress={() => setShowSupportingInfo(true)}>
                <Ionicons name="add-circle-outline" size={16} color={residentColors.icon} />
                <Text style={styles.optionalToggleText}>Add optional note</Text>
              </Pressable>
            )}
          </Card>

          <Card variant="outlined" padding="md" style={styles.sectionCard}>
            <FormSectionHeader
              step={2}
              icon="camera-outline"
              title="Photo evidence"
              description="Add 3 to 5 clear photos showing the visible damage."
              badge={`${photos.length}/${MAX_PHOTOS}`}
            />

            <Typography variant="caption" color={remainingPhotos === 0 ? theme.colors.success : theme.colors.textSecondary}>
              {remainingPhotos === 0
                ? 'Enough photos attached for review.'
                : `${remainingPhotos} more photo${remainingPhotos === 1 ? '' : 's'} needed to send.`}
            </Typography>

            <View style={styles.actionRow}>
              <Button
                title="Gallery"
                icon="images-outline"
                variant="secondary"
                appearance="resident"
                size="sm"
                onPress={pickFromGallery}
                style={styles.actionButton}
              />
              <Button
                title="Camera"
                icon="camera-outline"
                variant="outline"
                appearance="resident"
                size="sm"
                onPress={takePhoto}
                style={styles.actionButton}
              />
            </View>

            <View style={styles.photoGrid}>
              {photos.map((photo) => (
                <View key={photo.id} style={styles.photoTile}>
                  <Image source={{ uri: photo.uri }} style={styles.photoImage} />
                  {photo.watermarked ? (
                    <View style={styles.watermarkBadge}>
                      <Ionicons name="shield-checkmark" size={10} color="#FFFFFF" />
                      <Text style={styles.watermarkBadgeText}>Stamped</Text>
                    </View>
                  ) : null}
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => removePhoto(photo.id)}>
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}

              {Array.from({ length: Math.max(0, MIN_PHOTOS - photos.length) }).map((_, index) => (
                <View key={`placeholder-${index}`} style={styles.photoPlaceholder}>
                  <Ionicons name="image-outline" size={18} color={residentColors.icon} />
                  <Text style={styles.photoPlaceholderText}>Required</Text>
                </View>
              ))}
            </View>
          </Card>
          </>
          ) : null}
        </ScrollView>

        {canEditProof ? <View style={[styles.footer, { paddingBottom: footerPadding }]}>
          <View style={styles.footerCopy}>
            <Typography
              variant="caption"
              color={theme.colors.textSecondary}
            >
              {footerMessage}
            </Typography>
          </View>
          <Button
            title={submitting ? 'Submitting...' : 'Send proof'}
            onPress={() => {
              void handleSubmit();
            }}
            disabled={submitDisabled}
            icon="send-outline"
            appearance="resident"
            style={styles.submitButton}
          />
        </View> : null}
      </KeyboardAvoidingView>

      {/* Off-screen watermark overlay for photo capture */}
      {watermarkUri ? (
        <WatermarkOverlay
          uri={watermarkUri}
          barangay={watermarkBarangay}
          dateLabel={watermarkDateLabel}
          viewRef={watermarkViewRef}
          width={watermarkDimensions.width}
          height={watermarkDimensions.height}
          onLoad={handleWatermarkImageLoad}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: residentColors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  statusCard: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, backgroundColor: residentColors.accentSoft, borderWidth: 1, borderColor: residentColors.accent },
  statusCardApproved: { backgroundColor: residentColors.surface, borderColor: residentColors.border },
  statusCardRejected: { backgroundColor: '#FFF1F2', borderColor: '#F4C2C7' },
  statusIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.72)', alignItems: 'center', justifyContent: 'center' },
  statusCopy: { flex: 1 },
  statusEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: residentColors.secondary },
  statusTitle: { marginTop: 2, fontSize: 16, fontWeight: '800', color: residentColors.ink },
  statusMessage: { marginTop: 5, fontSize: 12.5, lineHeight: 18, color: residentColors.secondary },
  statusMetaRow: { marginTop: 9, flexDirection: 'row', gap: 8 },
  statusMeta: { fontSize: 10, fontWeight: '700', color: '#60736A', backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: 24,
    backgroundColor: residentColors.brand,
    shadowColor: residentColors.brandDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 5,
  },
  heroEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: 'rgba(255,255,255,0.72)' },
  heroTitle: { marginTop: 4, fontSize: 26, lineHeight: 31, fontWeight: '800', color: residentColors.inverse },
  heroDescription: { marginTop: 5, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.82)' },
  heroIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  headerTextWrap: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  summaryCard: {
    gap: theme.spacing.md,
    borderColor: residentColors.border,
    backgroundColor: residentColors.surface,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: residentColors.surfaceMuted,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
  progressBubble: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
    backgroundColor: residentColors.surfaceMuted,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  progressBubbleText: {
    fontSize: 12,
    fontWeight: '700',
    color: residentColors.ink,
  },
  progressTrack: { height: 7, overflow: 'hidden', borderRadius: 99, backgroundColor: '#E7ECE9' },
  progressFill: { height: '100%', borderRadius: 99, backgroundColor: residentColors.brand },
  queueInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: residentColors.accentSoft,
    borderWidth: 1,
    borderColor: residentColors.accent,
  },
  queueInlineText: {
    flex: 1,
  },
  requirementWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  requirementPill: {
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  requirementPillReady: {
    backgroundColor: residentColors.surfaceMuted,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  requirementPillPending: {
    backgroundColor: '#F3F4F6',
  },
  requirementPillWarning: {
    backgroundColor: '#FEF2F2',
  },
  requirementPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  requirementPillTextReady: {
    color: residentColors.ink,
  },
  requirementPillTextPending: {
    color: theme.colors.textSecondary,
  },
  requirementPillTextWarning: {
    color: theme.colors.error,
  },
  selectionBlock: {
    gap: theme.spacing.sm,
  },
  selectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  distributionChipRow: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.sm,
  },
  distributionChip: {
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#FAFAF9',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  distributionChipSelected: {
    borderColor: residentColors.brand,
    backgroundColor: residentColors.brand,
  },
  distributionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  distributionChipTextSelected: {
    color: residentColors.inverse,
  },
  selectedDistributionCard: {
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: residentColors.surface,
    borderWidth: 1,
    borderColor: residentColors.border,
  },
  rejectionReasonBox: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.warningBg,
    borderWidth: 1,
    borderColor: '#F5D487',
    gap: 4,
  },
  rejectionReasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectedDistributionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  selectedDistributionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: residentColors.surfaceMuted,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedDistributionCopy: {
    flex: 1,
    gap: 2,
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: '#FAFAF9',
    borderWidth: 1,
    borderColor: residentColors.border,
  },
  emptyStateText: {
    flex: 1,
  },
  sectionCard: {
    gap: theme.spacing.md,
    borderColor: residentColors.border,
    backgroundColor: residentColors.surface,
    borderRadius: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sectionStepIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: residentColors.brand },
  sectionEyebrow: { fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 1, color: residentColors.icon },
  sectionHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  sectionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: residentColors.surface,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  sectionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  fieldGroup: {
    gap: theme.spacing.sm,
  },
  fieldHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
    backgroundColor: residentColors.surface,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipSelected: {
    borderColor: residentColors.brand,
    backgroundColor: residentColors.brand,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  chipTextSelected: {
    color: residentColors.inverse,
  },
  textArea: {
    minHeight: 92,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
    backgroundColor: residentColors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: theme.colors.textPrimary,
    textAlignVertical: 'top',
  },
  secondaryTextArea: {
    minHeight: 76,
  },
  optionalToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 4,
  },
  optionalToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: residentColors.icon,
  },
  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  actionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  photoTile: {
    position: 'relative',
    width: '31%',
    aspectRatio: 1,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  removePhotoButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(17,24,39,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholder: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: residentColors.surface,
  },
  photoPlaceholderText: {
    fontSize: 11,
    color: theme.colors.textMuted,
    fontWeight: '600',
  },
  footer: {
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: 'rgba(246,251,247,0.98)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,24,39,0.08)',
    gap: theme.spacing.sm,
  },
  footerCopy: {
    minHeight: 18,
  },
  submitButton: {
    width: '100%',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.md,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  offlineBannerText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: '#92400E', fontWeight: '600' },
  authBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.md,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  authBannerText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: '#991B1B', fontWeight: '600' },
  authBannerAction: { fontSize: 12.5, color: '#991B1B', fontWeight: '800', textDecorationLine: 'underline' },
  savedProofsCard: { gap: 12, backgroundColor: '#FFFFFF' },
  savedProofsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  savedProofRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  savedProofCopy: { flex: 1 },
  savedProofTitle: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  savedProofMeta: { marginTop: 3, fontSize: 11, color: '#6B7280' },
  savedProofError: { marginTop: 5, fontSize: 11, lineHeight: 16, color: '#B45309' },
  savedProofActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7 },
  savedProofAction: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#F3F4F6' },
  savedProofActionText: { fontSize: 10.5, fontWeight: '700', color: residentColors.ink },
  savedProofDiscardText: { color: '#B91C1C' },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.md,
    backgroundColor: residentColors.surface,
    borderWidth: 1,
    borderColor: residentColors.border,
  },
  draftBannerText: {
    flex: 1,
    fontSize: 13,
    color: residentColors.ink,
    fontWeight: '500',
  },
  watermarkBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(17,24,39,0.82)',
  },
  watermarkBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
