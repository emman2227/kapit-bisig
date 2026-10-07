import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import {
  submitAssistedRegistration,
  AssistedRegistrationPayload,
} from '../services/api/AssistedRegistrationService';

const BARANGAYS = [
  'Bolo',
  'Bongalon',
  'Dulig',
  'Laois',
  'Magsaysay',
  'Poblacion',
  'San Gonzalo',
  'San Jose',
  'Tobuan',
  'Uyong',
] as const;

const STANDARD_ID_TYPES = [
  'PhilSys ID',
  "Driver's License",
  'Passport',
  'SSS ID',
  'PhilHealth ID',
  "Voter's ID",
];

const ALTERNATIVE_ID_TYPES = [
  'Barangay Certification',
  'Certificate of Indigency',
  'Tribal / NCIP Endorsement',
  'STAFF_ATTESTATION',
];

const DRAFT_FILE = `${FileSystem.documentDirectory || ''}assisted_registration_draft.json`;
const OPEN_FLAG_KEY = 'kapit_bisig_assisted_open';

const VULNERABLE_MEMBER_OPTIONS = [
  { id: 'senior', label: 'Senior Citizen', icon: 'walk-outline' },
  { id: 'pwd', label: 'PWD', icon: 'accessibility-outline' },
  { id: 'pregnant', label: 'Pregnant', icon: 'woman-outline' },
  { id: 'children', label: 'Children (0-5)', icon: 'people-outline' },
] as const;

interface AssistedRegistrationScreenProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (residentCode: string) => void;
}

export default function AssistedRegistrationScreen({
  visible,
  onClose,
  onSuccess,
}: AssistedRegistrationScreenProps) {
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Personal Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female'>('Male');
  const [hasPhone, setHasPhone] = useState(false);
  const [mobileNumber, setMobileNumber] = useState('');
  const [email, setEmail] = useState('');

  // Step 2: Address & Household
  const [barangay, setBarangay] = useState<string>(BARANGAYS[0]);
  const [streetAddress, setStreetAddress] = useState('');
  const [householdSize, setHouseholdSize] = useState('1');
  const [vulnerableMembers, setVulnerableMembers] = useState<string[]>([]);
  const [vulnerableCounts, setVulnerableCounts] = useState<{ [key: string]: number }>({});

  // Step 3: ID Verification
  const [idType, setIdType] = useState<string>('STAFF_ATTESTATION');
  const [idNumber, setIdNumber] = useState('');
  const [frontIdImage, setFrontIdImage] = useState<string>('');
  const [backIdImage, setBackIdImage] = useState<string>('');
  const [attestationReason, setAttestationReason] = useState(
    'Resident does not possess a mobile phone, SIM card, or standard government-issued identification.'
  );

  // Step 4: Face Photo
  const [faceImage, setFaceImage] = useState<string>('');

  // State
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Load draft from disk when modal opens
  useEffect(() => {
    if (!visible) return;
    const loadDraft = async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(DRAFT_FILE);
        if (fileInfo.exists) {
          const raw = await FileSystem.readAsStringAsync(DRAFT_FILE);
          const draft = JSON.parse(raw);
          if (draft) {
            if (draft.currentStep) setCurrentStep(draft.currentStep);
            if (draft.firstName) setFirstName(draft.firstName);
            if (draft.lastName) setLastName(draft.lastName);
            if (draft.dateOfBirth) setDateOfBirth(draft.dateOfBirth);
            if (draft.gender) setGender(draft.gender);
            if (typeof draft.hasPhone === 'boolean') setHasPhone(draft.hasPhone);
            if (draft.mobileNumber) setMobileNumber(draft.mobileNumber);
            if (draft.email) setEmail(draft.email);
            if (draft.barangay) setBarangay(draft.barangay);
            if (draft.streetAddress) setStreetAddress(draft.streetAddress);
            if (draft.householdSize) setHouseholdSize(draft.householdSize);
            if (Array.isArray(draft.vulnerableMembers)) setVulnerableMembers(draft.vulnerableMembers);
            if (draft.vulnerableCounts) setVulnerableCounts(draft.vulnerableCounts);
            if (draft.idType) setIdType(draft.idType);
            if (draft.idNumber) setIdNumber(draft.idNumber);
            if (draft.frontIdImage) setFrontIdImage(draft.frontIdImage);
            if (draft.backIdImage) setBackIdImage(draft.backIdImage);
            if (draft.attestationReason) setAttestationReason(draft.attestationReason);
            if (draft.faceImage) setFaceImage(draft.faceImage);
          }
        }
        await SecureStore.setItemAsync(OPEN_FLAG_KEY, 'true');
      } catch (e) {
        console.warn('[AssistedRegistration] Could not restore draft:', e);
      }
    };
    loadDraft();
  }, [visible]);

  // Persist draft whenever inputs change while visible
  useEffect(() => {
    if (!visible) return;
    const saveDraft = async () => {
      try {
        const data = {
          currentStep,
          firstName,
          lastName,
          dateOfBirth,
          gender,
          hasPhone,
          mobileNumber,
          email,
          barangay,
          streetAddress,
          householdSize,
          vulnerableMembers,
          vulnerableCounts,
          idType,
          idNumber,
          frontIdImage,
          backIdImage,
          attestationReason,
          faceImage,
        };
        await FileSystem.writeAsStringAsync(DRAFT_FILE, JSON.stringify(data));
        await SecureStore.setItemAsync(OPEN_FLAG_KEY, 'true');
      } catch (e) {
        console.warn('[AssistedRegistration] Failed to save draft:', e);
      }
    };
    const t = setTimeout(saveDraft, 500);
    return () => clearTimeout(t);
  }, [
    visible,
    currentStep,
    firstName,
    lastName,
    dateOfBirth,
    gender,
    hasPhone,
    mobileNumber,
    email,
    barangay,
    streetAddress,
    householdSize,
    vulnerableMembers,
    vulnerableCounts,
    idType,
    idNumber,
    frontIdImage,
    backIdImage,
    attestationReason,
    faceImage,
  ]);

  const toggleVulnerableMember = (id: string) => {
    setVulnerableMembers((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((m) => m !== id);
        const nextCounts = { ...vulnerableCounts };
        delete nextCounts[id];
        setVulnerableCounts(nextCounts);
        return next;
      } else {
        setVulnerableCounts((counts) => ({ ...counts, [id]: counts[id] || 1 }));
        return [...prev, id];
      }
    });
  };

  const updateVulnerableCount = (id: string, delta: number) => {
    setVulnerableCounts((counts) => {
      const current = counts[id] || 1;
      const nextVal = Math.max(1, current + delta);
      return { ...counts, [id]: nextVal };
    });
  };

  const resetForm = async () => {
    setCurrentStep(1);
    setFirstName('');
    setLastName('');
    setDateOfBirth('');
    setGender('Male');
    setHasPhone(false);
    setMobileNumber('');
    setEmail('');
    setBarangay(BARANGAYS[0]);
    setStreetAddress('');
    setHouseholdSize('1');
    setVulnerableMembers([]);
    setVulnerableCounts({});
    setIdType('STAFF_ATTESTATION');
    setIdNumber('');
    setFrontIdImage('');
    setBackIdImage('');
    setAttestationReason(
      'Resident does not possess a mobile phone, SIM card, or standard government-issued identification.'
    );
    setFaceImage('');
    setErrorMessage('');
    setSubmitting(false);

    try {
      await FileSystem.deleteAsync(DRAFT_FILE, { idempotent: true });
      await SecureStore.deleteItemAsync(OPEN_FLAG_KEY);
    } catch (_) {}
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const pickImage = async (setter: (base64: string) => void, useCamera: boolean) => {
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      };

      let result;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Camera permission is required to capture photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Media library permission is required.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync(options);
      }

      if (!result.canceled && result.assets && result.assets[0].base64) {
        setter(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (err) {
      console.error('[AssistedRegistration] Image pick error:', err);
      Alert.alert('Error', 'Failed to capture or select image.');
    }
  };

  const validateStep = (step: number): boolean => {
    setErrorMessage('');
    if (step === 1) {
      if (!firstName.trim() || !lastName.trim()) {
        setErrorMessage('First and last name are required.');
        return false;
      }
      if (!dateOfBirth.trim()) {
        setErrorMessage('Date of birth is required (YYYY-MM-DD).');
        return false;
      }
      if (hasPhone) {
        const cleanMobile = mobileNumber.replace(/\D/g, '');
        if (!/^09\d{9}$/.test(cleanMobile) && !/^9\d{9}$/.test(cleanMobile)) {
          setErrorMessage('Please enter a valid Philippine mobile number (09XXXXXXXXX).');
          return false;
        }
      }
      return true;
    }

    if (step === 2) {
      if (!streetAddress.trim()) {
        setErrorMessage('Street address is required.');
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (idType === 'STAFF_ATTESTATION') {
        if (!attestationReason.trim()) {
          setErrorMessage('Please specify an attestation reason for residents without ID.');
          return false;
        }
      } else {
        if (!idNumber.trim()) {
          setErrorMessage('ID number is required for the selected ID type.');
          return false;
        }
      }
      return true;
    }

    if (step === 4) {
      if (!faceImage) {
        setErrorMessage('Face photo scan is mandatory for identity verification.');
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 5));
    }
  };

  const handleBack = () => {
    setErrorMessage('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) {
      setCurrentStep(4);
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    const payload: AssistedRegistrationPayload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth: dateOfBirth.trim(),
      gender,
      mobileNumber: hasPhone && mobileNumber.trim() ? mobileNumber.trim() : undefined,
      email: email.trim() ? email.trim() : undefined,
      barangay,
      streetAddress: streetAddress.trim(),
      city: 'Labrador',
      householdSize: parseInt(householdSize, 10) || 1,
      vulnerableMembers,
      vulnerableCounts,
      idType,
      idNumber: idType !== 'STAFF_ATTESTATION' ? idNumber.trim() : undefined,
      frontIdImage: frontIdImage || undefined,
      backIdImage: backIdImage || undefined,
      faceImage,
      attestationReason: idType === 'STAFF_ATTESTATION' ? attestationReason.trim() : undefined,
    };

    const result = await submitAssistedRegistration(payload);
    setSubmitting(false);

    if (!result.success) {
      setErrorMessage(result.message || 'Failed to complete registration.');
      return;
    }

    const code = result.residentCode || 'Generated';
    const tempPass = result.tempPassword || 'Auto-generated';

    Alert.alert(
      'Registration Complete! 🎉',
      `Resident Code: ${code}\nTemporary Password: ${tempPass}\n\nPlease take note of these credentials for the resident.`,
      [
        {
          text: 'Done',
          onPress: () => {
            resetForm();
            onSuccess(code);
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handleClose}>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#1E293B" />
            </TouchableOpacity>
            <View style={styles.headerTextWrapper}>
              <Text style={styles.headerTitle}>Walk-In Assisted Registration</Text>
              <Text style={styles.headerSubtitle}>Step {currentStep} of 5</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* Stepper Progress Bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${(currentStep / 5) * 100}%` }]} />
          </View>

          {/* Error Banner */}
          {!!errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color="#DC2626" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {/* STEP 1: Personal Info */}
            {currentStep === 1 && (
              <View style={styles.stepContainer}>
                <Text style={styles.stepTitle}>👤 Personal Information</Text>
                <Text style={styles.stepDesc}>
                  Enter the resident's basic personal details. Mobile phone is completely optional.
                </Text>

                <Text style={styles.inputLabel}>First Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Maria"
                  value={firstName}
                  onChangeText={setFirstName}
                />

                <Text style={styles.inputLabel}>Last Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Santos"
                  value={lastName}
                  onChangeText={setLastName}
                />

                <Text style={styles.inputLabel}>Date of Birth (YYYY-MM-DD) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 1970-05-15"
                  value={dateOfBirth}
                  onChangeText={setDateOfBirth}
                />

                <Text style={styles.inputLabel}>Gender *</Text>
                <View style={styles.segmentedRow}>
                  <TouchableOpacity
                    style={[styles.segmentedBtn, gender === 'Male' && styles.segmentedBtnActive]}
                    onPress={() => setGender('Male')}
                  >
                    <Ionicons
                      name="male"
                      size={16}
                      color={gender === 'Male' ? '#FFFFFF' : '#475569'}
                    />
                    <Text
                      style={[
                        styles.segmentedBtnText,
                        gender === 'Male' && styles.segmentedBtnTextActive,
                      ]}
                    >
                      Male
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentedBtn, gender === 'Female' && styles.segmentedBtnActive]}
                    onPress={() => setGender('Female')}
                  >
                    <Ionicons
                      name="female"
                      size={16}
                      color={gender === 'Female' ? '#FFFFFF' : '#475569'}
                    />
                    <Text
                      style={[
                        styles.segmentedBtnText,
                        gender === 'Female' && styles.segmentedBtnTextActive,
                      ]}
                    >
                      Female
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Mobile Phone Toggle */}
                <TouchableOpacity
                  style={styles.toggleRow}
                  activeOpacity={0.8}
                  onPress={() => setHasPhone(!hasPhone)}
                >
                  <Ionicons
                    name={hasPhone ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={hasPhone ? '#059669' : '#64748B'}
                  />
                  <Text style={styles.toggleLabel}>Resident has an active mobile phone</Text>
                </TouchableOpacity>

                {hasPhone ? (
                  <>
                    <Text style={styles.inputLabel}>Mobile Number *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="09XXXXXXXXX"
                      keyboardType="phone-pad"
                      value={mobileNumber}
                      onChangeText={setMobileNumber}
                      maxLength={11}
                    />
                  </>
                ) : (
                  <View style={styles.infoBanner}>
                    <Ionicons name="information-circle-outline" size={18} color="#059669" />
                    <Text style={styles.infoText}>
                      No phone number required. The resident will be issued a unique Resident Code for logins and distributions.
                    </Text>
                  </View>
                )}

                <Text style={styles.inputLabel}>Email (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="resident@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>
            )}

            {/* STEP 2: Address */}
            {currentStep === 2 && (
              <View style={styles.stepContainer}>
                <Text style={styles.stepTitle}>📍 Barangay & Address</Text>
                <Text style={styles.stepDesc}>Specify the resident's home location and household size.</Text>

                <Text style={styles.inputLabel}>Barangay *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {BARANGAYS.map((b) => (
                    <TouchableOpacity
                      key={b}
                      style={[styles.chip, barangay === b && styles.chipActive]}
                      onPress={() => setBarangay(b)}
                    >
                      <Text style={[styles.chipText, barangay === b && styles.chipTextActive]}>
                        {b}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.inputLabel}>Street Address / Sitio *</Text>
                <TextInput
                  style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
                  placeholder="House #, Street name, Sitio"
                  multiline
                  value={streetAddress}
                  onChangeText={setStreetAddress}
                />

                <Text style={styles.inputLabel}>Municipality</Text>
                <View style={styles.municipalityBadgeContainer}>
                  <Text style={styles.municipalityText}>Labrador, Pangasinan</Text>
                  <View style={styles.dedicatedTag}>
                    <Text style={styles.dedicatedTagText}>Sole Dedicated LGU</Text>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Household Size</Text>
                <TextInput
                  style={styles.input}
                  placeholder="1"
                  keyboardType="numeric"
                  value={householdSize}
                  onChangeText={setHouseholdSize}
                />

                {/* Vulnerable Sector Cards */}
                <Text style={styles.inputLabel}>Vulnerable Members (Optional)</Text>
                <Text style={styles.subLabel}>Tap to select special needs categories present in this household:</Text>
                <View style={styles.vulnerableGrid}>
                  {VULNERABLE_MEMBER_OPTIONS.map((item) => {
                    const isSelected = vulnerableMembers.includes(item.id);
                    const count = vulnerableCounts[item.id] || 1;
                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.vulnerableCard,
                          isSelected && styles.vulnerableCardActive,
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.vulnerableCardHeader}
                          onPress={() => toggleVulnerableMember(item.id)}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name={item.icon as any}
                            size={20}
                            color={isSelected ? '#059669' : '#64748B'}
                          />
                          <Text
                            style={[
                              styles.vulnerableCardText,
                              isSelected && styles.vulnerableCardTextActive,
                            ]}
                          >
                            {item.label}
                          </Text>
                        </TouchableOpacity>

                        {isSelected && (
                          <View style={styles.vulnerableCounterRow}>
                            <Text style={styles.vulnerableCounterLabel}>Count:</Text>
                            <View style={styles.vulnerableStepper}>
                              <TouchableOpacity
                                style={styles.stepperBtn}
                                onPress={() => updateVulnerableCount(item.id, -1)}
                              >
                                <Text style={styles.stepperBtnText}>-</Text>
                              </TouchableOpacity>
                              <Text style={styles.stepperValue}>{count}</Text>
                              <TouchableOpacity
                                style={styles.stepperBtn}
                                onPress={() => updateVulnerableCount(item.id, 1)}
                              >
                                <Text style={styles.stepperBtnText}>+</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* STEP 3: Identification */}
            {currentStep === 3 && (
              <View style={styles.stepContainer}>
                <Text style={styles.stepTitle}>🪪 Identity & Documentation</Text>
                <Text style={styles.stepDesc}>
                  Select government ID or Staff Attestation for indigent/tribal residents without IDs.
                </Text>

                <Text style={styles.inputLabel}>Document / ID Type *</Text>
                <Text style={styles.subLabel}>Alternative / Assisted Types:</Text>
                <View style={styles.idChipGroup}>
                  {ALTERNATIVE_ID_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.idChip, idType === type && styles.idChipActive]}
                      onPress={() => setIdType(type)}
                    >
                      <Text style={[styles.idChipText, idType === type && styles.idChipTextActive]}>
                        {type === 'STAFF_ATTESTATION' ? 'Staff Attestation (No ID)' : type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.subLabel}>Standard Government IDs:</Text>
                <View style={styles.idChipGroup}>
                  {STANDARD_ID_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.idChip, idType === type && styles.idChipActive]}
                      onPress={() => setIdType(type)}
                    >
                      <Text style={[styles.idChipText, idType === type && styles.idChipTextActive]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {idType === 'STAFF_ATTESTATION' ? (
                  <View style={styles.attestationCard}>
                    <View style={styles.attestationHeader}>
                      <Ionicons name="shield-checkmark" size={20} color="#059669" />
                      <Text style={styles.attestationTitle}>Staff Attestation Mode Active</Text>
                    </View>
                    <Text style={styles.attestationDesc}>
                      A surrogate identifier (e.g. ATTEST-SJ-2026-XXXXXX) will automatically be assigned. No physical ID card required.
                    </Text>

                    <Text style={styles.inputLabel}>Attestation Reason / Notes *</Text>
                    <TextInput
                      style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                      placeholder="Explain why the resident lacks formal documents..."
                      multiline
                      value={attestationReason}
                      onChangeText={setAttestationReason}
                    />
                  </View>
                ) : (
                  <>
                    <Text style={styles.inputLabel}>ID Number *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 1234-5678-9012"
                      value={idNumber}
                      onChangeText={setIdNumber}
                    />

                    <Text style={styles.inputLabel}>Front ID Photo (Optional)</Text>
                    <View style={styles.imageActionRow}>
                      <TouchableOpacity
                        style={styles.imageBtn}
                        onPress={() => pickImage(setFrontIdImage, true)}
                      >
                        <Ionicons name="camera" size={18} color="#059669" />
                        <Text style={styles.imageBtnText}>Camera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.imageBtn}
                        onPress={() => pickImage(setFrontIdImage, false)}
                      >
                        <Ionicons name="images" size={18} color="#059669" />
                        <Text style={styles.imageBtnText}>Gallery</Text>
                      </TouchableOpacity>
                    </View>
                    {!!frontIdImage && (
                      <Image source={{ uri: frontIdImage }} style={styles.imagePreview} />
                    )}

                    <Text style={styles.inputLabel}>Back ID Photo (Optional)</Text>
                    <View style={styles.imageActionRow}>
                      <TouchableOpacity
                        style={styles.imageBtn}
                        onPress={() => pickImage(setBackIdImage, true)}
                      >
                        <Ionicons name="camera" size={18} color="#059669" />
                        <Text style={styles.imageBtnText}>Camera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.imageBtn}
                        onPress={() => pickImage(setBackIdImage, false)}
                      >
                        <Ionicons name="images" size={18} color="#059669" />
                        <Text style={styles.imageBtnText}>Gallery</Text>
                      </TouchableOpacity>
                    </View>
                    {!!backIdImage && (
                      <Image source={{ uri: backIdImage }} style={styles.imagePreview} />
                    )}
                  </>
                )}
              </View>
            )}

            {/* STEP 4: Face Capture */}
            {currentStep === 4 && (
              <View style={styles.stepContainer}>
                <Text style={styles.stepTitle}>📸 Face Scan & Biometrics</Text>
                <View style={styles.mandatoryBadge}>
                  <Ionicons name="lock-closed" size={16} color="#B45309" />
                  <Text style={styles.mandatoryBadgeText}>Mandatory for all registrations</Text>
                </View>
                <Text style={styles.stepDesc}>
                  Face capture is required to prevent double-claiming and ensure relief goods reach the genuine individual.
                </Text>

                {faceImage ? (
                  <View style={styles.facePreviewWrapper}>
                    <Image source={{ uri: faceImage }} style={styles.facePreviewImage} />
                    <TouchableOpacity
                      style={styles.retakeBtn}
                      onPress={() => pickImage(setFaceImage, true)}
                    >
                      <Ionicons name="camera-reverse" size={18} color="#FFFFFF" />
                      <Text style={styles.retakeBtnText}>Retake Photo</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.cameraPromptWrapper}>
                    <View style={styles.cameraIconCircle}>
                      <Ionicons name="person" size={54} color="#94A3B8" />
                    </View>
                    <Text style={styles.cameraPromptTitle}>Capture Resident Portrait</Text>
                    <Text style={styles.cameraPromptDesc}>
                      Position resident's face inside good lighting without sunglasses or mask.
                    </Text>

                    <TouchableOpacity
                      style={styles.captureMainBtn}
                      onPress={() => pickImage(setFaceImage, true)}
                    >
                      <Ionicons name="camera" size={20} color="#FFFFFF" />
                      <Text style={styles.captureMainBtnText}>Take Face Photo Now</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.gallerySecondaryBtn}
                      onPress={() => pickImage(setFaceImage, false)}
                    >
                      <Ionicons name="images-outline" size={18} color="#059669" />
                      <Text style={styles.gallerySecondaryBtnText}>Choose from Gallery</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* STEP 5: Review & Submit */}
            {currentStep === 5 && (
              <View style={styles.stepContainer}>
                <Text style={styles.stepTitle}>📝 Review & Submit</Text>
                <Text style={styles.stepDesc}>Confirm beneficiary information before finalizing registration.</Text>

                <View style={styles.reviewCard}>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Full Name</Text>
                    <Text style={styles.reviewValue}>{`${firstName} ${lastName}`}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Date of Birth</Text>
                    <Text style={styles.reviewValue}>{dateOfBirth}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Gender</Text>
                    <Text style={styles.reviewValue}>{gender}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Phone</Text>
                    <Text style={styles.reviewValue}>
                      {hasPhone && mobileNumber ? mobileNumber : 'None (Assisted Walk-In)'}
                    </Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Mode</Text>
                    <Text style={[styles.reviewValue, { color: '#7C3AED', fontWeight: 'bold' }]}>
                      Assisted Walk-In (Staff)
                    </Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Municipality</Text>
                    <Text style={styles.reviewValue}>Labrador, Pangasinan</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Barangay</Text>
                    <Text style={styles.reviewValue}>{barangay}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Address</Text>
                    <Text style={styles.reviewValue}>{streetAddress}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Household Size</Text>
                    <Text style={styles.reviewValue}>{householdSize} Member(s)</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Vulnerable</Text>
                    <Text style={styles.reviewValue}>
                      {vulnerableMembers.length > 0
                        ? vulnerableMembers
                            .map((m) => {
                              const opt = VULNERABLE_MEMBER_OPTIONS.find((o) => o.id === m);
                              const count = vulnerableCounts[m] || 1;
                              return `${opt?.label || m} (${count})`;
                            })
                            .join(', ')
                        : 'None'}
                    </Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>ID Type</Text>
                    <Text style={styles.reviewValue}>
                      {idType === 'STAFF_ATTESTATION' ? 'Staff Attestation' : idType}
                    </Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>ID Number</Text>
                    <Text style={styles.reviewValue}>
                      {idType === 'STAFF_ATTESTATION' ? 'Auto-generated Surrogate ID' : idNumber}
                    </Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Face Photo</Text>
                    <Text style={[styles.reviewValue, { color: faceImage ? '#059669' : '#DC2626' }]}>
                      {faceImage ? 'Captured ✓' : 'Missing ✗'}
                    </Text>
                  </View>
                </View>

                {faceImage ? (
                  <View style={styles.miniFaceRow}>
                    <Image source={{ uri: faceImage }} style={styles.miniFaceImage} />
                    <Text style={styles.miniFaceText}>Biometric photo ready for verification</Text>
                  </View>
                ) : null}
              </View>
            )}
          </ScrollView>

          {/* Footer Controls */}
          <View style={styles.footer}>
            {currentStep > 1 && (
              <TouchableOpacity
                style={styles.backBtn}
                onPress={handleBack}
                disabled={submitting}
              >
                <Ionicons name="arrow-back" size={18} color="#475569" />
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
            )}

            {currentStep < 5 ? (
              <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
                <Text style={styles.nextBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Submit Registration</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  closeBtn: {
    padding: 6,
  },
  headerTextWrapper: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#E2E8F0',
    width: '100%',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#059669',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  stepContainer: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  stepDesc: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 16,
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    marginTop: 12,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 8,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0F172A',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 12,
  },
  segmentedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  segmentedBtnActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  segmentedBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  segmentedBtnTextActive: {
    color: '#FFFFFF',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    marginBottom: 6,
  },
  toggleLabel: {
    fontSize: 14,
    color: '#1E293B',
    fontWeight: '500',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  infoText: {
    fontSize: 13,
    color: '#065F46',
    flex: 1,
    lineHeight: 18,
  },
  chipScroll: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  chipText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  idChipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  idChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  idChipActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  idChipText: {
    fontSize: 13,
    color: '#334155',
  },
  idChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  attestationCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
  },
  attestationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  attestationTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#166534',
  },
  attestationDesc: {
    fontSize: 13,
    color: '#15803D',
    lineHeight: 18,
    marginBottom: 10,
  },
  imageActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  imageBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  imageBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
  },
  imagePreview: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    marginTop: 8,
    resizeMode: 'cover',
  },
  mandatoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  mandatoryBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B45309',
  },
  cameraPromptWrapper: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    marginTop: 8,
  },
  cameraIconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cameraPromptTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  cameraPromptDesc: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  captureMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 8,
    marginBottom: 10,
  },
  captureMainBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  gallerySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  gallerySecondaryBtnText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
  },
  facePreviewWrapper: {
    alignItems: 'center',
    marginTop: 10,
  },
  facePreviewImage: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 4,
    borderColor: '#059669',
  },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#334155',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 16,
  },
  retakeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  reviewLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  reviewValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  miniFaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 8,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  miniFaceImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  miniFaceText: {
    fontSize: 13,
    color: '#065F46',
    fontWeight: '500',
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  nextBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 8,
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  submitBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  municipalityBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  municipalityText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  dedicatedTag: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dedicatedTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
  },
  vulnerableGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
    marginBottom: 16,
  },
  vulnerableCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
  },
  vulnerableCardActive: {
    borderColor: '#059669',
    backgroundColor: '#F0FDF4',
  },
  vulnerableCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vulnerableCardText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    flexShrink: 1,
  },
  vulnerableCardTextActive: {
    color: '#065F46',
  },
  vulnerableCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#DCFCE7',
  },
  vulnerableCounterLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#065F46',
  },
  vulnerableStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  stepperBtn: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#059669',
  },
  stepperValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
    minWidth: 18,
    textAlign: 'center',
  },
});
