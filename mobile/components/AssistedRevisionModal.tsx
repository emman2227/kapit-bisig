import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { staffTheme } from '../theme';
import {
  getReturnedAssistedRegistrations,
  ReturnedAssistedResident,
  submitAssistedRevision,
} from '../services/api/AssistedRegistrationService';

const sc = staffTheme.colors;

const ID_TYPES = [
  'STAFF_ATTESTATION',
  'Barangay Certification',
  'Certificate of Indigency',
  'Tribal / NCIP Endorsement',
  'PhilSys ID',
  "Driver's License",
  'Passport',
  'SSS ID',
  'PhilHealth ID',
  "Voter's ID",
];

async function imageUriToDataUrl(uri: string): Promise<string> {
  const extensionMatch = uri.match(/\.(png|webp)$/i);
  const mimeType =
    extensionMatch?.[1]?.toLowerCase() === 'png'
      ? 'image/png'
      : extensionMatch?.[1]?.toLowerCase() === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return `data:${mimeType};base64,${base64}`;
}

interface AssistedRevisionModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialResident?: ReturnedAssistedResident | null;
}

export default function AssistedRevisionModal({
  visible,
  onClose,
  onSuccess,
  initialResident,
}: AssistedRevisionModalProps) {
  const [loadingList, setLoadingList] = useState(false);
  const [returnedList, setReturnedList] = useState<ReturnedAssistedResident[]>([]);
  const [selectedResident, setSelectedResident] = useState<ReturnedAssistedResident | null>(null);

  // Form states
  const [idType, setIdType] = useState('STAFF_ATTESTATION');
  const [idNumber, setIdNumber] = useState('');
  const [attestationReason, setAttestationReason] = useState('');
  const [staffNote, setStaffNote] = useState('');

  // Replacement images (local file URIs)
  const [faceImageUri, setFaceImageUri] = useState<string | null>(null);
  const [frontIdUri, setFrontIdUri] = useState<string | null>(null);
  const [backIdUri, setBackIdUri] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [showIdPicker, setShowIdPicker] = useState(false);

  // Load returned registrations when modal opens
  const fetchReturned = useCallback(async () => {
    setLoadingList(true);
    const result = await getReturnedAssistedRegistrations();
    setLoadingList(false);
    if (result.success) {
      setReturnedList(result.data);
      if (initialResident) {
        selectResident(initialResident);
      } else if (result.data.length === 1) {
        selectResident(result.data[0]);
      }
    } else {
      Alert.alert('Error', result.message || 'Failed to fetch returned registrations.');
    }
  }, [initialResident]);

  useEffect(() => {
    if (visible) {
      if (initialResident) {
        selectResident(initialResident);
      } else {
        setSelectedResident(null);
        fetchReturned();
      }
    } else {
      resetForm();
    }
  }, [visible, initialResident, fetchReturned]);

  const selectResident = (resident: ReturnedAssistedResident) => {
    setSelectedResident(resident);
    setIdType(resident.idType || 'STAFF_ATTESTATION');
    setIdNumber(resident.idNumber || '');
    setAttestationReason('');
    setStaffNote('');
    setFaceImageUri(null);
    setFrontIdUri(null);
    setBackIdUri(null);
  };

  const resetForm = () => {
    setSelectedResident(null);
    setFaceImageUri(null);
    setFrontIdUri(null);
    setBackIdUri(null);
    setIdNumber('');
    setStaffNote('');
    setAttestationReason('');
    setSubmitting(false);
  };

  const pickImage = async (
    target: 'face' | 'frontId' | 'backId',
    source: 'camera' | 'library'
  ) => {
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permission.status !== 'granted') {
        Alert.alert('Permission required', `Please grant ${source} access to continue.`);
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              allowsEditing: false,
              quality: 0.85,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: false,
              quality: 0.85,
            });

      if (result.canceled || !result.assets[0]?.uri) return;

      const uri = result.assets[0].uri;
      if (target === 'face') setFaceImageUri(uri);
      else if (target === 'frontId') setFrontIdUri(uri);
      else if (target === 'backId') setBackIdUri(uri);
    } catch (err: any) {
      console.error('Image picking error:', err);
      Alert.alert('Error', 'Failed to capture or select photo.');
    }
  };

  const promptImageSource = (target: 'face' | 'frontId' | 'backId') => {
    Alert.alert(
      'Update Photo',
      'Choose how to provide the replacement image:',
      [
        { text: 'Take Camera Photo', onPress: () => pickImage(target, 'camera') },
        { text: 'Choose from Gallery', onPress: () => pickImage(target, 'library') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  const handleSubmit = async () => {
    if (!selectedResident) return;

    const hasAnyChange =
      faceImageUri ||
      frontIdUri ||
      backIdUri ||
      idType !== selectedResident.idType ||
      idNumber !== selectedResident.idNumber ||
      staffNote.trim() ||
      attestationReason.trim();

    if (!hasAnyChange) {
      Alert.alert(
        'No changes detected',
        'Please replace at least one photo, update ID credentials, or add an audit note before resubmitting.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const [faceBase64, frontIdBase64, backIdBase64] = await Promise.all([
        faceImageUri ? imageUriToDataUrl(faceImageUri) : Promise.resolve(undefined),
        frontIdUri ? imageUriToDataUrl(frontIdUri) : Promise.resolve(undefined),
        backIdUri ? imageUriToDataUrl(backIdUri) : Promise.resolve(undefined),
      ]);

      const result = await submitAssistedRevision(selectedResident.id, {
        idType,
        idNumber: idNumber.trim() || undefined,
        faceImage: faceBase64,
        frontIdImage: frontIdBase64,
        backIdImage: backIdBase64,
        attestationReason: attestationReason.trim() || undefined,
        staffNote: staffNote.trim() || undefined,
      });

      setSubmitting(false);

      if (result.success) {
        Alert.alert(
          'Revision Submitted',
          'The walk-in registration has been updated and routed to Pending Review.',
          [
            {
              text: 'OK',
              onPress: () => {
                resetForm();
                onSuccess();
                onClose();
              },
            },
          ]
        );
      } else {
        Alert.alert('Submission Failed', result.message || 'Failed to submit revision.');
      }
    } catch (err: any) {
      setSubmitting(false);
      console.error('Submit revision error:', err);
      Alert.alert('Error', err.message || 'A network error occurred while resubmitting revision.');
    }
  };

  const isAttestation =
    idType === 'STAFF_ATTESTATION' ||
    idType.toLowerCase().includes('certification') ||
    idType.toLowerCase().includes('endorsement');

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={selectedResident && returnedList.length > 1 ? () => setSelectedResident(null) : onClose}
            disabled={submitting}
          >
            <Ionicons
              name={selectedResident && returnedList.length > 1 ? 'arrow-back' : 'close'}
              size={22}
              color={sc.ink}
            />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerEyebrow}>STAFF REVISION</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {selectedResident ? `Revise: ${selectedResident.fullName}` : 'My Returned Walk-Ins'}
            </Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {!selectedResident ? (
          /* List of Returned Registrations */
          <ScrollView contentContainerStyle={styles.listContainer}>
            <View style={styles.listHero}>
              <Ionicons name="alert-circle-outline" size={32} color={sc.accent} />
              <Text style={styles.listHeroTitle}>Registrations You Assisted</Text>
              <Text style={styles.listHeroSub}>
                These walk-in applications you registered were reviewed and returned for corrections. Select a resident to retake photos or update information.
              </Text>
            </View>

            {loadingList ? (
              <ActivityIndicator size="large" color={sc.brand} style={{ marginTop: 40 }} />
            ) : returnedList.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-done-circle-outline" size={48} color={sc.brand} />
                <Text style={styles.emptyTitle}>All Clear!</Text>
                <Text style={styles.emptySub}>No walk-in registrations you assisted are currently awaiting revision.</Text>
              </View>
            ) : (
              returnedList.map((resident) => (
                <TouchableOpacity
                  key={resident.id}
                  style={styles.residentCard}
                  activeOpacity={0.8}
                  onPress={() => selectResident(resident)}
                >
                  <View style={styles.residentCardHeader}>
                    <Text style={styles.residentName}>{resident.fullName}</Text>
                    <View style={styles.walkInBadge}>
                      <Text style={styles.walkInBadgeText}>Walk-In</Text>
                    </View>
                  </View>
                  <Text style={styles.residentMeta}>
                    {resident.barangay} • Code: {resident.residentCode || resident.householdToken || 'Pending'}
                  </Text>
                  {resident.rejectionReason ? (
                    <View style={styles.returnNoteBanner}>
                      <Text style={styles.returnNoteLabel}>Reviewer Note:</Text>
                      <Text style={styles.returnNoteText}>{resident.rejectionReason}</Text>
                    </View>
                  ) : null}
                  <View style={styles.actionPrompt}>
                    <Text style={styles.actionPromptText}>Tap to Update & Resubmit</Text>
                    <Ionicons name="chevron-forward" size={16} color={sc.brand} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        ) : (
          /* Form for Selected Resident */
          <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
            {/* Rejection Note Banner */}
            <View style={styles.reviewerAlert}>
              <Ionicons name="alert-circle" size={20} color="#D97706" style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewerAlertTitle}>Reviewer's Note</Text>
                <Text style={styles.reviewerAlertText}>
                  {selectedResident.rejectionReason || 'Please review and retake clear photos or fix ID details.'}
                </Text>
              </View>
            </View>

            {/* Photos Section */}
            <Text style={styles.sectionHeader}>Replace Photos / Biometrics</Text>
            <View style={styles.photosGrid}>
              {/* 1. Face Selfie */}
              <View style={styles.photoBox}>
                <Text style={styles.photoBoxTitle}>Face Photo</Text>
                <View style={styles.imagePreviewWrap}>
                  {faceImageUri ? (
                    <Image source={{ uri: faceImageUri }} style={styles.imagePreview} />
                  ) : selectedResident.faceImage ? (
                    <Image source={{ uri: selectedResident.faceImage }} style={[styles.imagePreview, { opacity: 0.6 }]} />
                  ) : (
                    <Ionicons name="person-outline" size={36} color={sc.secondary} />
                  )}
                  {faceImageUri && <View style={styles.replacedPill}><Text style={styles.replacedPillText}>Replaced</Text></View>}
                </View>
                <TouchableOpacity
                  style={styles.retakeBtn}
                  onPress={() => promptImageSource('face')}
                >
                  <Ionicons name="camera-outline" size={14} color={sc.inverse} />
                  <Text style={styles.retakeBtnText}>Retake Face</Text>
                </TouchableOpacity>
              </View>

              {/* 2. Front ID */}
              <View style={styles.photoBox}>
                <Text style={styles.photoBoxTitle}>Front ID</Text>
                <View style={styles.imagePreviewWrap}>
                  {frontIdUri ? (
                    <Image source={{ uri: frontIdUri }} style={styles.imagePreview} />
                  ) : selectedResident.frontIdImage ? (
                    <Image source={{ uri: selectedResident.frontIdImage }} style={[styles.imagePreview, { opacity: 0.6 }]} />
                  ) : (
                    <Ionicons name="id-card-outline" size={36} color={sc.secondary} />
                  )}
                  {frontIdUri && <View style={styles.replacedPill}><Text style={styles.replacedPillText}>Replaced</Text></View>}
                </View>
                <TouchableOpacity
                  style={styles.retakeBtn}
                  onPress={() => promptImageSource('frontId')}
                >
                  <Ionicons name="camera-outline" size={14} color={sc.inverse} />
                  <Text style={styles.retakeBtnText}>Retake Front</Text>
                </TouchableOpacity>
              </View>

              {/* 3. Back ID */}
              <View style={styles.photoBox}>
                <Text style={styles.photoBoxTitle}>Back ID (Opt)</Text>
                <View style={styles.imagePreviewWrap}>
                  {backIdUri ? (
                    <Image source={{ uri: backIdUri }} style={styles.imagePreview} />
                  ) : selectedResident.backIdImage ? (
                    <Image source={{ uri: selectedResident.backIdImage }} style={[styles.imagePreview, { opacity: 0.6 }]} />
                  ) : (
                    <Ionicons name="id-card-outline" size={36} color={sc.secondary} />
                  )}
                  {backIdUri && <View style={styles.replacedPill}><Text style={styles.replacedPillText}>Replaced</Text></View>}
                </View>
                <TouchableOpacity
                  style={styles.retakeBtn}
                  onPress={() => promptImageSource('backId')}
                >
                  <Ionicons name="camera-outline" size={14} color={sc.inverse} />
                  <Text style={styles.retakeBtnText}>Retake Back</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Identification Details */}
            <Text style={styles.sectionHeader}>Identification Details</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>ID Type</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setShowIdPicker(!showIdPicker)}
              >
                <Text style={styles.dropdownBtnText}>{idType}</Text>
                <Ionicons name="chevron-down" size={18} color={sc.icon} />
              </TouchableOpacity>

              {showIdPicker && (
                <View style={styles.idOptionsList}>
                  {ID_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.idOptionItem, idType === type && styles.idOptionItemActive]}
                      onPress={() => {
                        setIdType(type);
                        setShowIdPicker(false);
                      }}
                    >
                      <Text style={[styles.idOptionText, idType === type && styles.idOptionTextActive]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {!isAttestation && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>ID Number</Text>
                <TextInput
                  value={idNumber}
                  onChangeText={setIdNumber}
                  placeholder="Enter corrected ID number"
                  placeholderTextColor={sc.secondary}
                  style={styles.input}
                />
              </View>
            )}

            {isAttestation && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Attestation Justification</Text>
                <TextInput
                  value={attestationReason}
                  onChangeText={setAttestationReason}
                  placeholder="Reason resident lacks physical ID..."
                  placeholderTextColor={sc.secondary}
                  style={[styles.input, styles.textArea]}
                  multiline
                  numberOfLines={2}
                />
              </View>
            )}

            {/* Staff Audit Note */}
            <Text style={styles.sectionHeader}>Staff Revision Summary</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Audit Note</Text>
              <TextInput
                value={staffNote}
                onChangeText={setStaffNote}
                placeholder="Explain what was corrected (e.g. 'Retook front ID photo in bright lighting')."
                placeholderTextColor={sc.secondary}
                style={[styles.input, styles.textArea]}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Submit Action */}
            <TouchableOpacity
              style={[styles.submitButton, submitting && { opacity: 0.6 }]}
              disabled={submitting}
              onPress={handleSubmit}
            >
              {submitting ? (
                <ActivityIndicator color={sc.inverse} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={sc.inverse} />
                  <Text style={styles.submitButtonText}>Update & Resubmit</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.footerHelp}>
              Resubmission clears the rejection status and places this record back in Pending Review.
            </Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: sc.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: sc.border,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: sc.iconSurface,
  },
  headerTitleWrap: { alignItems: 'center' },
  headerEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, color: sc.brand },
  headerTitle: { fontSize: 16, fontWeight: '800', color: sc.ink, maxWidth: 220 },

  listContainer: { padding: 16 },
  listHero: {
    alignItems: 'center',
    backgroundColor: sc.surface,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: sc.borderAccent,
    marginBottom: 16,
  },
  listHeroTitle: { fontSize: 16, fontWeight: '800', color: sc.ink, marginTop: 8 },
  listHeroSub: { fontSize: 12, color: sc.secondary, textAlign: 'center', marginTop: 4, lineHeight: 16 },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: sc.ink, marginTop: 12 },
  emptySub: { fontSize: 13, color: sc.secondary, textAlign: 'center', marginTop: 4, paddingHorizontal: 32 },

  residentCard: {
    backgroundColor: sc.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: sc.border,
    marginBottom: 12,
  },
  residentCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  residentName: { fontSize: 16, fontWeight: '700', color: sc.ink },
  walkInBadge: { backgroundColor: '#DEF7EC', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  walkInBadgeText: { fontSize: 10, fontWeight: '700', color: '#03543F' },
  residentMeta: { fontSize: 12, color: sc.secondary, marginTop: 4 },
  returnNoteBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 8,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#D97706',
  },
  returnNoteLabel: { fontSize: 11, fontWeight: '700', color: '#92400E' },
  returnNoteText: { fontSize: 12, color: '#78350F', marginTop: 2 },
  actionPrompt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 12 },
  actionPromptText: { fontSize: 12, fontWeight: '700', color: sc.brand },

  formContainer: { padding: 16, paddingBottom: 40 },
  reviewerAlert: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 16,
  },
  reviewerAlertTitle: { fontSize: 11, fontWeight: '800', color: '#92400E', textTransform: 'uppercase' },
  reviewerAlertText: { fontSize: 13, color: '#78350F', marginTop: 2, lineHeight: 18 },

  sectionHeader: { fontSize: 14, fontWeight: '800', color: sc.ink, marginTop: 14, marginBottom: 8 },
  photosGrid: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  photoBox: { flex: 1, backgroundColor: sc.surface, borderRadius: 12, padding: 8, borderWidth: 1, borderColor: sc.border, alignItems: 'center' },
  photoBoxTitle: { fontSize: 11, fontWeight: '700', color: sc.secondary, marginBottom: 6 },
  imagePreviewWrap: { width: '100%', aspectRatio: 1, backgroundColor: sc.iconSurface, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  imagePreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  replacedPill: { position: 'absolute', bottom: 4, backgroundColor: '#059669', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  replacedPillText: { fontSize: 9, fontWeight: '800', color: '#FFF' },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: sc.brand,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
    width: '100%',
    justifyContent: 'center',
  },
  retakeBtnText: { fontSize: 10, fontWeight: '700', color: sc.inverse },

  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: sc.secondary, textTransform: 'uppercase', marginBottom: 4 },
  input: {
    backgroundColor: sc.surface,
    borderWidth: 1,
    borderColor: sc.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: sc.ink,
  },
  textArea: { minHeight: 64, textAlignVertical: 'top' },
  dropdownBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: sc.surface,
    borderWidth: 1,
    borderColor: sc.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dropdownBtnText: { fontSize: 14, color: sc.ink, fontWeight: '600' },
  idOptionsList: {
    backgroundColor: sc.surface,
    borderWidth: 1,
    borderColor: sc.border,
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
  },
  idOptionItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: sc.border },
  idOptionItemActive: { backgroundColor: sc.iconSurface },
  idOptionText: { fontSize: 13, color: sc.ink },
  idOptionTextActive: { fontWeight: '700', color: sc.brand },

  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: sc.brand,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    shadowColor: sc.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  submitButtonText: { fontSize: 15, fontWeight: '800', color: sc.inverse },
  footerHelp: { fontSize: 11, color: sc.secondary, textAlign: 'center', marginTop: 10, lineHeight: 16 },
});
