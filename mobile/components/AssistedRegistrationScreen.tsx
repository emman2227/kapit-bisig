import React, { useState, useEffect, useRef } from 'react';
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
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import {
  submitAssistedRegistration,
  AssistedRegistrationPayload,
} from '../services/api/AssistedRegistrationService';
import { resolveApiBaseUrl } from '../services/config/apiSecurity';

const API_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL,
  'https://kapit-bisig.onrender.com/api',
  'AssistedRegistrationScreen API'
);

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
  { id: 'senior', label: 'Senior Citizen', desc: '60+ years old', icon: 'walk-outline' },
  { id: 'pwd', label: 'PWD', desc: 'Person with Disability', icon: 'accessibility-outline' },
  { id: 'pregnant', label: 'Pregnant', desc: 'Expecting / Nursing', icon: 'woman-outline' },
  { id: 'children', label: 'Children (0-5)', desc: 'Infant or Toddler', icon: 'people-outline' },
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
  const totalSteps = 5;

  // Step 1: Personal Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | null>('Male');
  const [hasPhone, setHasPhone] = useState(false);
  const [mobileNumber, setMobileNumber] = useState('');
  const [email, setEmail] = useState('');

  // Step 2: Address & Household
  const [barangay, setBarangay] = useState<string>(BARANGAYS[0]);
  const [householdToken, setHouseholdToken] = useState('');
  const [tokenValidating, setTokenValidating] = useState(false);
  const [tokenValidated, setTokenValidated] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenHouseholdInfo, setTokenHouseholdInfo] = useState<{
    headOfHousehold?: string;
    address?: string;
    barangay?: string;
    expectedMembers?: number;
  } | null>(null);
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
    'Resident lacks formal civil registration or standard government identification.'
  );

  // Step 4: Face Photo (Live CameraView)
  const [faceImage, setFaceImage] = useState<string>('');
  const [showFaceScanner, setShowFaceScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scanStatus, setScanStatus] = useState<'idle' | 'capturing' | 'success' | 'failed'>('idle');
  const [faceInstructions, setFaceInstructions] = useState('Position face inside the oval');
  const cameraRef = useRef<CameraView>(null);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);

  // Scroll to top on step transition
  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [currentStep]);

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
            if (draft.householdToken) {
              setHouseholdToken(draft.householdToken);
              if (draft.tokenValidated) setTokenValidated(true);
              if (draft.tokenHouseholdInfo) setTokenHouseholdInfo(draft.tokenHouseholdInfo);
            }
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
          householdToken,
          tokenValidated,
          tokenHouseholdInfo,
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
    householdToken,
    tokenValidated,
    tokenHouseholdInfo,
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

  // -------------------------------------------------------------
  // Date of Birth Formatting (MM-DD-YYYY, numbers only)
  // -------------------------------------------------------------
  const formatDateInput = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 8);
    let formatted = '';
    if (cleaned.length > 0) {
      formatted = cleaned.substring(0, 2);
      if (cleaned.length > 2) {
        formatted += '-' + cleaned.substring(2, 4);
      }
      if (cleaned.length > 4) {
        formatted += '-' + cleaned.substring(4, 8);
      }
    }
    return formatted;
  };

  const validateDateOfBirth = (dob: string): { valid: boolean; error?: string } => {
    if (!dob || dob.trim().length !== 10) {
      return { valid: false, error: 'Complete Date of Birth is required (MM-DD-YYYY).' };
    }
    const parts = dob.split('-');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid date format. Expected MM-DD-YYYY.' };
    }
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (isNaN(month) || month < 1 || month > 12) {
      return { valid: false, error: 'Invalid month in Date of Birth (01-12).' };
    }
    if (isNaN(day) || day < 1 || day > 31) {
      return { valid: false, error: 'Invalid day in Date of Birth (01-31).' };
    }
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > currentYear) {
      return { valid: false, error: `Invalid year in Date of Birth (1900-${currentYear}).` };
    }
    const birthDate = new Date(year, month - 1, day);
    if (birthDate > new Date()) {
      return { valid: false, error: 'Date of Birth cannot be in the future.' };
    }
    return { valid: true };
  };

  // -------------------------------------------------------------
  // Household Token Handling (XXXX-XXXX-XXXX)
  // -------------------------------------------------------------
  const handleTokenChange = (raw: string) => {
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const parts: string[] = [];
    for (let i = 0; i < cleaned.length; i += 4) {
      parts.push(cleaned.slice(i, i + 4));
    }
    setHouseholdToken(parts.join('-'));
    setTokenValidated(false);
    setTokenError(null);
    setTokenHouseholdInfo(null);
  };

  const handleBarangayChange = (b: string) => {
    setBarangay(b);
    setTokenValidated(false);
    setTokenError(null);
    setTokenHouseholdInfo(null);
  };

  const validateHouseholdToken = async () => {
    const code = householdToken.trim().toUpperCase();
    if (!code || code.length !== 14) {
      setTokenError('Please enter a valid household code (XXXX-XXXX-XXXX).');
      return false;
    }
    if (!barangay.trim()) {
      setTokenError('Please select a barangay first.');
      return false;
    }

    setTokenValidating(true);
    setTokenError(null);
    setTokenValidated(false);
    setTokenHouseholdInfo(null);

    try {
      const response = await fetch(`${API_URL}/household/validate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code, barangay }),
      });
      const data = await response.json();
      setTokenValidating(false);

      if (data.success && data.valid) {
        if (
          data.householdInfo?.barangay &&
          data.householdInfo.barangay.toLowerCase() !== barangay.toLowerCase()
        ) {
          setTokenValidated(false);
          setTokenError(
            `This household code belongs to Barangay ${data.householdInfo.barangay}, not ${barangay}.`
          );
          return false;
        }
        setTokenValidated(true);
        setTokenHouseholdInfo(data.householdInfo || null);
        setTokenError(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        return true;
      } else {
        setTokenValidated(false);
        if (data.errorCode === 'TOKEN_ALREADY_USED') {
          setTokenError('This household registration code has already been claimed.');
        } else if (data.errorCode === 'TOKEN_EXPIRED') {
          setTokenError('This household registration code has expired.');
        } else {
          setTokenError(data.message || 'Invalid household code.');
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return false;
      }
    } catch (err: any) {
      setTokenValidating(false);
      setTokenValidated(false);
      setTokenError('Network error while validating household code.');
      return false;
    }
  };

  // -------------------------------------------------------------
  // Vulnerable Members Assessment
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // Reset & Discard
  // -------------------------------------------------------------
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
    setHouseholdToken('');
    setTokenValidating(false);
    setTokenValidated(false);
    setTokenError(null);
    setTokenHouseholdInfo(null);
    setStreetAddress('');
    setHouseholdSize('1');
    setVulnerableMembers([]);
    setVulnerableCounts({});
    setIdType('STAFF_ATTESTATION');
    setIdNumber('');
    setFrontIdImage('');
    setBackIdImage('');
    setAttestationReason(
      'Resident lacks formal civil registration or standard government identification.'
    );
    setFaceImage('');
    setErrorMessage('');
    setSubmitting(false);

    try {
      await FileSystem.deleteAsync(DRAFT_FILE, { idempotent: true });
      await SecureStore.deleteItemAsync(OPEN_FLAG_KEY);
    } catch (_) {}
  };

  const hasUnsavedChanges = (): boolean => {
    return (
      currentStep > 1 ||
      firstName.trim().length > 0 ||
      lastName.trim().length > 0 ||
      dateOfBirth.trim().length > 0 ||
      householdToken.trim().length > 0 ||
      streetAddress.trim().length > 0 ||
      faceImage.length > 0 ||
      frontIdImage.length > 0 ||
      mobileNumber.trim().length > 0
    );
  };

  const handlePressClose = () => {
    if (hasUnsavedChanges()) {
      Alert.alert(
        'Discard Registration?',
        'You have unsaved beneficiary details. Are you sure you want to exit? Your progress will be discarded.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard & Exit',
            style: 'destructive',
            onPress: () => {
              resetForm();
              onClose();
            },
          },
        ]
      );
    } else {
      resetForm();
      onClose();
    }
  };

  // -------------------------------------------------------------
  // ID Image Picker (Step 3)
  // -------------------------------------------------------------
  const pickIdImage = async (setter: (base64: string) => void, useCamera: boolean) => {
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
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
      console.error('[AssistedRegistration] ID Image pick error:', err);
      Alert.alert('Error', 'Failed to capture or select document image.');
    }
  };

  // -------------------------------------------------------------
  // Face Scanner Controls (Step 4)
  // -------------------------------------------------------------
  const startFaceScan = async () => {
    if (!cameraPermission?.granted) {
      const perm = await requestCameraPermission();
      if (!perm.granted) {
        Alert.alert('Camera Permission Required', 'Camera access is required to take the resident portrait.');
        return;
      }
    }
    setScanStatus('idle');
    setFaceInstructions('Position face inside the oval');
    setShowFaceScanner(true);
  };

  const handleCaptureFacePhoto = async () => {
    if (!cameraRef.current || scanStatus === 'capturing') return;
    try {
      setScanStatus('capturing');
      setFaceInstructions('Capturing portrait...');

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });

      if (!photo?.base64) {
        throw new Error('Failed to capture face photo from camera.');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setFaceImage(`data:image/jpeg;base64,${photo.base64}`);
      setScanStatus('success');

      setTimeout(() => {
        setShowFaceScanner(false);
        setScanStatus('idle');
      }, 700);
    } catch (err: any) {
      console.warn('[AssistedRegistration] Face capture error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setScanStatus('failed');
      setFaceInstructions(err.message || 'Failed to capture photo. Please try again.');
    }
  };

  // -------------------------------------------------------------
  // Step Validation & Navigation
  // -------------------------------------------------------------
  const validateStep = (step: number): boolean => {
    setErrorMessage('');
    if (step === 1) {
      if (!firstName.trim() || !lastName.trim()) {
        setErrorMessage('First and last name are required.');
        return false;
      }
      const dobCheck = validateDateOfBirth(dateOfBirth);
      if (!dobCheck.valid) {
        setErrorMessage(dobCheck.error || 'Valid Date of Birth is required.');
        return false;
      }
      if (!gender) {
        setErrorMessage('Please select gender.');
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
      if (!householdToken.trim() || householdToken.length !== 14) {
        setErrorMessage('Unique Household Code (XXXX-XXXX-XXXX) is required.');
        return false;
      }
      if (!tokenValidated) {
        setErrorMessage('Please validate the household registration code before proceeding.');
        return false;
      }
      if (!streetAddress.trim()) {
        setErrorMessage('Street address or Sitio is required.');
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (idType === 'STAFF_ATTESTATION') {
        if (!attestationReason.trim()) {
          setErrorMessage('Please specify an attestation reason for residents without formal ID.');
          return false;
        }
      } else {
        if (!idNumber.trim()) {
          setErrorMessage('ID number is required for the selected document type.');
          return false;
        }
      }
      return true;
    }

    if (step === 4) {
      if (!faceImage) {
        setErrorMessage('Face photo capture is mandatory for identity verification.');
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
    }
  };

  const handleBack = () => {
    setErrorMessage('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // -------------------------------------------------------------
  // Final Submission
  // -------------------------------------------------------------
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
      gender: gender || 'Male',
      mobileNumber: hasPhone && mobileNumber.trim() ? mobileNumber.trim() : undefined,
      email: email.trim() ? email.trim() : undefined,
      barangay,
      householdToken: householdToken.trim(),
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
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handlePressClose}>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handlePressClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={26} color="#333" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Walk-In Assisted Registration</Text>
            <View style={{ width: 34 }} />
          </View>

          {/* Progress Section (Identical to Self-Registration) */}
          <View style={styles.progressSection}>
            <View style={styles.progressTextContainer}>
              <Text style={styles.stepText}>Step {currentStep} of {totalSteps}</Text>
            </View>
            <View style={styles.progressSegmentsRow}>
              {Array.from({ length: totalSteps }).map((_, index) => {
                const stepNumber = index + 1;
                const isCompleted = stepNumber < currentStep;
                const isCurrent = stepNumber === currentStep;

                return (
                  <View
                    key={`progress-segment-${stepNumber}`}
                    style={[
                      styles.progressSegment,
                      index !== totalSteps - 1 && styles.progressSegmentSpacing,
                      isCompleted && styles.progressSegmentCompleted,
                      isCurrent && styles.progressSegmentCurrent,
                    ]}
                  />
                );
              })}
            </View>
          </View>

          {/* Error Banner */}
          {!!errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color="#D32F2F" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* STEP 1: Personal Info */}
            {currentStep === 1 && (
              <View style={styles.formContent}>
                <View style={styles.headerSection}>
                  <Text style={styles.title}>
                    <Text style={styles.titleBlack}>Let's get you </Text>
                    <Text style={styles.titleGreen}>registered</Text>
                  </Text>
                  <Text style={styles.subtitle}>
                    Please enter your details exactly as they appear on your valid ID to ensure smooth relief distribution.
                  </Text>
                </View>

                <View style={styles.formFields}>
                  {/* First Name */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>First Name</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        placeholder="Juan"
                        placeholderTextColor="#999"
                        value={firstName}
                        onChangeText={setFirstName}
                      />
                      <Ionicons name="person" size={20} color="#2E7D32" style={styles.inputIconRight} />
                    </View>
                  </View>

                  {/* Last Name */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Last Name</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        placeholder="dela Cruz"
                        placeholderTextColor="#999"
                        value={lastName}
                        onChangeText={setLastName}
                      />
                      <Ionicons name="person" size={20} color="#2E7D32" style={styles.inputIconRight} />
                    </View>
                  </View>

                  {/* Date of Birth */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Date of Birth</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        placeholder="mm/dd/yyyy"
                        placeholderTextColor="#999"
                        keyboardType="number-pad"
                        value={dateOfBirth}
                        onChangeText={(text) => setDateOfBirth(formatDateInput(text))}
                        maxLength={10}
                      />
                      <Ionicons name="calendar" size={20} color="#2E7D32" style={styles.inputIconRight} />
                    </View>
                  </View>

                  {/* Gender (Radio buttons) */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Gender</Text>
                    <View style={styles.genderRadioContainer}>
                      <TouchableOpacity
                        style={styles.genderRadioOption}
                        onPress={() => setGender('Male')}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.radioOuter, gender === 'Male' && styles.radioOuterActive]}>
                          {gender === 'Male' && <View style={styles.radioInner} />}
                        </View>
                        <Text style={[styles.genderRadioText, gender === 'Male' && styles.genderRadioTextActive]}>
                          Male
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.genderRadioOption}
                        onPress={() => setGender('Female')}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.radioOuter, gender === 'Female' && styles.radioOuterActive]}>
                          {gender === 'Female' && <View style={styles.radioInner} />}
                        </View>
                        <Text style={[styles.genderRadioText, gender === 'Female' && styles.genderRadioTextActive]}>
                          Female
                        </Text>
                      </TouchableOpacity>
                    </View>
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
                      color={hasPhone ? '#2E7D32' : '#888'}
                    />
                    <Text style={styles.toggleLabel}>Resident has an active mobile phone</Text>
                  </TouchableOpacity>

                  {hasPhone ? (
                    <View style={styles.fieldContainer}>
                      <Text style={styles.fieldLabel}>Mobile Number</Text>
                      <View style={styles.inputContainer}>
                        <TextInput
                          style={styles.input}
                          placeholder="09XXXXXXXXX"
                          placeholderTextColor="#999"
                          keyboardType="phone-pad"
                          value={mobileNumber}
                          onChangeText={setMobileNumber}
                          maxLength={11}
                        />
                        <Ionicons name="call" size={20} color="#2E7D32" style={styles.inputIconRight} />
                      </View>
                      <Text style={styles.fieldHelperText}>Use 09XXXXXXXXX.</Text>
                    </View>
                  ) : (
                    <View style={styles.credentialsInfoBox}>
                      <Ionicons name="information-circle" size={20} color="#2E7D32" />
                      <Text style={styles.credentialsInfoText}>
                        No mobile number required. The resident will be issued a unique Resident Code for verification and relief collection.
                      </Text>
                    </View>
                  )}

                  {/* Email */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Email (Optional)</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        placeholder="resident@example.com"
                        placeholderTextColor="#999"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        value={email}
                        onChangeText={setEmail}
                      />
                      <Ionicons name="mail" size={20} color="#2E7D32" style={styles.inputIconRight} />
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* STEP 2: Address & Household */}
            {currentStep === 2 && (
              <View style={styles.formContent}>
                <View style={styles.headerSection}>
                  <Text style={styles.title}>
                    <Text style={styles.titleBlack}>Barangay & </Text>
                    <Text style={styles.titleGreen}>Household</Text>
                  </Text>
                  <Text style={styles.subtitle}>
                    Select the resident's home location and enter their unique household registration code.
                  </Text>
                </View>

                <View style={styles.formFields}>
                  {/* Barangay */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Barangay</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                      {BARANGAYS.map((b) => (
                        <TouchableOpacity
                          key={b}
                          style={[styles.chip, barangay === b && styles.chipActive]}
                          onPress={() => handleBarangayChange(b)}
                        >
                          <Text style={[styles.chipText, barangay === b && styles.chipTextActive]}>
                            {b}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  {/* Unique Household Registration Code */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Household Registration Code (XXXX-XXXX-XXXX)</Text>
                    <View style={styles.tokenInputRow}>
                      <View style={[
                        styles.inputContainer,
                        styles.tokenInput,
                        tokenValidated && styles.inputSuccess,
                        !!tokenError && styles.inputError,
                      ]}>
                        <TextInput
                          style={[styles.input, styles.tokenInputText]}
                          placeholder="XXXX-XXXX-XXXX"
                          placeholderTextColor="#999"
                          autoCapitalize="characters"
                          autoCorrect={false}
                          value={householdToken}
                          onChangeText={handleTokenChange}
                          maxLength={14}
                        />
                        <Ionicons name="key" size={20} color="#2E7D32" style={styles.inputIconRight} />
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.validateButton,
                          tokenValidating && styles.validateButtonDisabled,
                          tokenValidated && styles.validateButtonSuccess,
                        ]}
                        onPress={validateHouseholdToken}
                        disabled={tokenValidating}
                        activeOpacity={0.8}
                      >
                        {tokenValidating ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : tokenValidated ? (
                          <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                        ) : (
                          <Text style={styles.validateButtonText}>Validate</Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    {tokenError && (
                      <View style={styles.tokenErrorContainer}>
                        <Ionicons name="alert-circle" size={16} color="#D32F2F" />
                        <Text style={styles.tokenErrorText}>{tokenError}</Text>
                      </View>
                    )}

                    {tokenValidated && tokenHouseholdInfo && (
                      <View style={styles.tokenSuccessContainer}>
                        <View style={styles.tokenSuccessHeader}>
                          <Ionicons name="checkmark-circle" size={20} color="#2E7D32" />
                          <Text style={styles.tokenSuccessTitle}>Household Verified</Text>
                        </View>
                        {tokenHouseholdInfo.headOfHousehold && (
                          <Text style={styles.tokenInfoRow}>
                            <Text style={styles.tokenInfoLabel}>Head of Household: </Text>
                            <Text style={styles.tokenInfoValue}>{tokenHouseholdInfo.headOfHousehold}</Text>
                          </Text>
                        )}
                        {tokenHouseholdInfo.address && (
                          <Text style={styles.tokenInfoRow}>
                            <Text style={styles.tokenInfoLabel}>Registered Address: </Text>
                            <Text style={styles.tokenInfoValue}>{tokenHouseholdInfo.address}</Text>
                          </Text>
                        )}
                      </View>
                    )}
                  </View>

                  {/* Street Address / Sitio */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Street Address / Sitio</Text>
                    <View style={[styles.inputContainer, { alignItems: 'flex-start' }]}>
                      <TextInput
                        style={[styles.input, { minHeight: 65, textAlignVertical: 'top' }]}
                        placeholder="House #, Street name, Sitio"
                        placeholderTextColor="#999"
                        multiline
                        value={streetAddress}
                        onChangeText={setStreetAddress}
                      />
                      <Ionicons name="location" size={20} color="#2E7D32" style={[styles.inputIconRight, { marginTop: 14 }]} />
                    </View>
                  </View>

                  {/* Household Size */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Household Size</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        placeholder="1"
                        placeholderTextColor="#999"
                        keyboardType="number-pad"
                        value={householdSize}
                        onChangeText={setHouseholdSize}
                      />
                      <Ionicons name="people" size={20} color="#2E7D32" style={styles.inputIconRight} />
                    </View>
                  </View>

                  {/* The 4 Priority Assessment Cards */}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Priority Assessment</Text>
                    <Text style={styles.fieldHint}>
                      Select any special sectors present in this household:
                    </Text>
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
                                size={22}
                                color={isSelected ? '#2E7D32' : '#666'}
                              />
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={[
                                    styles.vulnerableCardText,
                                    isSelected && styles.vulnerableCardTextActive,
                                  ]}
                                >
                                  {item.label}
                                </Text>
                                <Text style={styles.vulnerableCardDesc}>{item.desc}</Text>
                              </View>
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
                </View>
              </View>
            )}

            {/* STEP 3: Identification */}
            {currentStep === 3 && (
              <View style={styles.formContent}>
                <View style={styles.headerSection}>
                  <Text style={styles.title}>
                    <Text style={styles.titleBlack}>Identity & </Text>
                    <Text style={styles.titleGreen}>Documentation</Text>
                  </Text>
                  <Text style={styles.subtitle}>
                    Select government ID or Staff Attestation for indigent/tribal residents without IDs.
                  </Text>
                </View>

                <View style={styles.formFields}>
                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Assisted / Alternative Options</Text>
                    <View style={styles.idChipGroup}>
                      {ALTERNATIVE_ID_TYPES.map((type) => (
                        <TouchableOpacity
                          key={type}
                          style={[styles.idChip, idType === type && styles.idChipActive]}
                          onPress={() => setIdType(type)}
                        >
                          <Text
                            style={[styles.idChipText, idType === type && styles.idChipTextActive]}
                          >
                            {type === 'STAFF_ATTESTATION' ? 'Staff Attestation (No Physical ID)' : type}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Standard Government IDs</Text>
                    <View style={styles.idChipGroup}>
                      {STANDARD_ID_TYPES.map((type) => (
                        <TouchableOpacity
                          key={type}
                          style={[styles.idChip, idType === type && styles.idChipActive]}
                          onPress={() => setIdType(type)}
                        >
                          <Text
                            style={[styles.idChipText, idType === type && styles.idChipTextActive]}
                          >
                            {type}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {idType === 'STAFF_ATTESTATION' ? (
                    <View style={styles.attestationCard}>
                      <View style={styles.attestationHeader}>
                        <Ionicons name="shield-checkmark" size={22} color="#2E7D32" />
                        <Text style={styles.attestationTitle}>Staff Attestation Mode</Text>
                      </View>
                      <Text style={styles.attestationDesc}>
                        The resident will receive an auto-generated Surrogate ID code backed by staff vouching.
                      </Text>
                      <Text style={styles.fieldLabel}>Attestation Justification</Text>
                      <View style={[styles.inputContainer, { alignItems: 'flex-start', minHeight: 75 }]}>
                        <TextInput
                          style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                          multiline
                          value={attestationReason}
                          onChangeText={setAttestationReason}
                          placeholder="e.g. Resident lacks formal civil registration or government ID"
                          placeholderTextColor="#999"
                        />
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.fieldContainer}>
                        <Text style={styles.fieldLabel}>ID / Card Number</Text>
                        <View style={styles.inputContainer}>
                          <TextInput
                            style={styles.input}
                            placeholder="e.g. 1234-5678-9012"
                            placeholderTextColor="#999"
                            value={idNumber}
                            onChangeText={setIdNumber}
                          />
                          <Ionicons name="card" size={20} color="#2E7D32" style={styles.inputIconRight} />
                        </View>
                      </View>

                      <View style={styles.fieldContainer}>
                        <Text style={styles.fieldLabel}>Front ID Photo (Optional)</Text>
                        <View style={styles.imageActionRow}>
                          <TouchableOpacity
                            style={styles.imageBtn}
                            onPress={() => pickIdImage(setFrontIdImage, true)}
                          >
                            <Ionicons name="camera" size={18} color="#2E7D32" />
                            <Text style={styles.imageBtnText}>Camera</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.imageBtn}
                            onPress={() => pickIdImage(setFrontIdImage, false)}
                          >
                            <Ionicons name="images" size={18} color="#2E7D32" />
                            <Text style={styles.imageBtnText}>Gallery</Text>
                          </TouchableOpacity>
                        </View>
                        {!!frontIdImage && (
                          <Image source={{ uri: frontIdImage }} style={styles.imagePreview} />
                        )}
                      </View>

                      <View style={styles.fieldContainer}>
                        <Text style={styles.fieldLabel}>Back ID Photo (Optional)</Text>
                        <View style={styles.imageActionRow}>
                          <TouchableOpacity
                            style={styles.imageBtn}
                            onPress={() => pickIdImage(setBackIdImage, true)}
                          >
                            <Ionicons name="camera" size={18} color="#2E7D32" />
                            <Text style={styles.imageBtnText}>Camera</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.imageBtn}
                            onPress={() => pickIdImage(setBackIdImage, false)}
                          >
                            <Ionicons name="images" size={18} color="#2E7D32" />
                            <Text style={styles.imageBtnText}>Gallery</Text>
                          </TouchableOpacity>
                        </View>
                        {!!backIdImage && (
                          <Image source={{ uri: backIdImage }} style={styles.imagePreview} />
                        )}
                      </View>
                    </>
                  )}
                </View>
              </View>
            )}

            {/* STEP 4: Face Photo (Identical to Self-Registration) */}
            {currentStep === 4 && (
              <View style={styles.formContent}>
                <View style={styles.headerSection}>
                  <Text style={styles.title}>
                    <Text style={styles.titleBlack}>Face </Text>
                    <Text style={styles.titleGreen}>Photo</Text>
                  </Text>
                  <Text style={styles.subtitle}>
                    Take a clear photo of the resident's face for biometric identity verification.
                  </Text>
                </View>

                <View style={styles.formFields}>
                  {/* Face Photo Card */}
                  <View style={styles.faceScanCard}>
                    {faceImage ? (
                      <View style={styles.faceImageContainer}>
                        <Image source={{ uri: faceImage }} style={styles.faceImage} resizeMode="cover" />
                        <View style={styles.faceVerifiedBadge}>
                          <Ionicons name="checkmark-circle" size={24} color="#2E7D32" />
                          <Text style={styles.faceVerifiedText}>Photo Captured</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.faceScanPlaceholder}>
                        <View style={styles.faceScanIconContainer}>
                          <Ionicons name="camera" size={60} color="#2E7D32" />
                        </View>
                        <Text style={styles.faceScanTitle}>Take Resident Photo</Text>
                        <Text style={styles.faceScanSubtitle}>
                          Tap the button below to snap a photo
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Snap Photo Button */}
                  <TouchableOpacity
                    style={[
                      styles.scanButton,
                      faceImage ? styles.scanButtonComplete : null,
                    ]}
                    onPress={startFaceScan}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={faceImage ? 'refresh' : 'camera'}
                      size={24}
                      color="#FFFFFF"
                    />
                    <Text style={styles.scanButtonText}>
                      {faceImage ? 'Retake Photo' : 'Snap a Photo'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* STEP 5: Review & Submit */}
            {currentStep === 5 && (
              <View style={styles.formContent}>
                <View style={styles.headerSection}>
                  <Text style={styles.title}>
                    <Text style={styles.titleBlack}>Review & </Text>
                    <Text style={styles.titleGreen}>Submit</Text>
                  </Text>
                  <Text style={styles.subtitle}>Confirm beneficiary details before finalizing registration.</Text>
                </View>

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
                    <Text style={[styles.reviewValue, { color: '#2E7D32', fontWeight: 'bold' }]}>
                      Assisted Walk-In (Staff)
                    </Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Barangay</Text>
                    <Text style={styles.reviewValue}>{barangay}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Household Code</Text>
                    <Text style={[styles.reviewValue, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
                      {householdToken}
                    </Text>
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
                    <Text style={styles.reviewLabel}>Priority Assessment</Text>
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
                    <Text style={[styles.reviewValue, { color: faceImage ? '#2E7D32' : '#D32F2F' }]}>
                      {faceImage ? 'Captured ✓' : 'Missing ✗'}
                    </Text>
                  </View>
                </View>

                {faceImage ? (
                  <View style={styles.miniFaceRow}>
                    <Image source={{ uri: faceImage }} style={styles.miniFaceImage} />
                    <Text style={styles.miniFaceText}>Biometric face portrait attached and verified</Text>
                  </View>
                ) : null}
              </View>
            )}
          </ScrollView>

          {/* Bottom Dual Pill Action Buttons (Identical to Self-Registration) */}
          <View style={styles.bottomActions}>
            <View style={styles.bottomButtonsRow}>
              <TouchableOpacity
                style={[
                  styles.bottomButtonCancel,
                  currentStep > 1 && styles.bottomButtonBack,
                ]}
                onPress={currentStep === 1 ? handlePressClose : handleBack}
                disabled={submitting}
              >
                <Text style={styles.bottomButtonCancelText}>
                  {currentStep === 1 ? 'Cancel' : 'Back'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bottomButtonNext, submitting && styles.bottomButtonNextDisabled]}
                onPress={currentStep === 5 ? handleSubmit : handleNext}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Text style={styles.bottomButtonNextText}>
                      {currentStep === 5 ? 'Submit Registration' : 'Next Step'}
                    </Text>
                    <Ionicons
                      name={currentStep === 5 ? 'checkmark-circle' : 'arrow-forward'}
                      size={20}
                      color="#FFF"
                    />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* Full-Screen Face Scanner Modal (Identical to Self-Registration) */}
        <Modal
          visible={showFaceScanner}
          animationType="slide"
          onRequestClose={() => setShowFaceScanner(false)}
        >
          <SafeAreaView style={styles.faceScannerContainer}>
            {/* Scanner Header */}
            <View style={styles.scannerHeader}>
              <TouchableOpacity
                onPress={() => setShowFaceScanner(false)}
                style={styles.scannerCloseButton}
              >
                <Ionicons name="close" size={28} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.scannerTitle}>Face Verification</Text>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>Live Scan</Text>
              </View>
            </View>

            {/* Camera View with Face Oval Overlay */}
            <View style={styles.cameraContainer}>
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="front"
                mirror={true}
              />

              {/* Face Frame Overlay */}
              <View style={styles.faceFrameOverlay} pointerEvents="none">
                <View style={styles.faceFrameTop} />
                <View style={styles.faceFrameMiddle}>
                  <View style={styles.faceFrameSide} />
                  <View
                    style={[
                      styles.faceFrameOval,
                      scanStatus === 'success' && styles.faceFrameOvalDetected,
                      scanStatus === 'failed' && styles.faceFrameOvalNoFace,
                    ]}
                  >
                    {scanStatus === 'capturing' && (
                      <View style={styles.faceDetectionIndicator}>
                        <ActivityIndicator size="large" color="#FFFFFF" />
                        <Text style={styles.faceDetectionText}>{faceInstructions}</Text>
                      </View>
                    )}

                    {scanStatus === 'failed' && (
                      <View style={styles.noFaceWarning}>
                        <Ionicons name="close-circle" size={36} color="#EF4444" />
                        <Text style={styles.noFaceText}>{faceInstructions}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.faceFrameSide} />
                </View>
                <View style={styles.faceFrameBottom} />
              </View>

              {/* Success Overlay */}
              {scanStatus === 'success' && (
                <View style={styles.scanSuccessOverlay}>
                  <View style={styles.scanSuccessIcon}>
                    <Ionicons name="checkmark-circle" size={80} color="#2ECC71" />
                  </View>
                  <Text style={styles.scanSuccessText}>Photo Captured!</Text>
                </View>
              )}
            </View>

            {/* Bottom Actions */}
            <View style={styles.scannerBottom}>
              <Text style={styles.scannerInstructions}>
                {scanStatus === 'capturing'
                  ? faceInstructions
                  : scanStatus === 'failed'
                  ? 'Please retry centering the face in good lighting'
                  : 'Center resident\'s face inside the oval and tap capture'}
              </Text>

              <TouchableOpacity
                style={[
                  styles.startScanButton,
                  scanStatus === 'capturing' && styles.startScanButtonDisabled,
                ]}
                onPress={handleCaptureFacePhoto}
                disabled={scanStatus === 'capturing'}
              >
                <Ionicons name="camera" size={24} color="#FFFFFF" />
                <Text style={styles.startScanButtonText}>Capture Photo</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  closeBtn: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  progressSection: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  progressTextContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
  },
  progressSegmentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressSegment: {
    flex: 1,
    height: 10,
    backgroundColor: '#D7E7D9',
    borderRadius: 999,
  },
  progressSegmentSpacing: {
    marginRight: 6,
  },
  progressSegmentCompleted: {
    backgroundColor: '#66A96B',
  },
  progressSegmentCurrent: {
    backgroundColor: '#2E7D32',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#D32F2F',
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 30,
  },
  formContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  headerSection: {
    marginBottom: 25,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  titleBlack: {
    color: '#333',
  },
  titleGreen: {
    color: '#2E7D32',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
  },
  formFields: {
    gap: 20,
  },
  fieldContainer: {
    marginBottom: 5,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  fieldHint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    marginTop: -6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: '#333',
  },
  inputIconRight: {
    marginLeft: 10,
  },
  inputSuccess: {
    borderColor: '#2E7D32',
    borderWidth: 2,
  },
  inputError: {
    borderColor: '#E53935',
    borderWidth: 2,
  },
  fieldHelperText: {
    fontSize: 12,
    color: '#5F6B62',
    marginTop: 6,
    marginLeft: 5,
  },
  genderRadioContainer: {
    flexDirection: 'row',
    gap: 32,
    paddingVertical: 8,
  },
  genderRadioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E8E8E8',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterActive: {
    borderColor: '#2E7D32',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2E7D32',
  },
  genderRadioText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  genderRadioTextActive: {
    color: '#2E7D32',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 6,
  },
  toggleLabel: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  credentialsInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  credentialsInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#2E7D32',
    lineHeight: 18,
  },
  chipScroll: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  chipActive: {
    backgroundColor: '#2E7D32',
    borderColor: '#2E7D32',
  },
  chipText: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  tokenInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tokenInput: {
    flex: 1,
  },
  tokenInputText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  validateButton: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validateButtonDisabled: {
    backgroundColor: '#9E9E9E',
  },
  validateButtonSuccess: {
    backgroundColor: '#2E7D32',
  },
  validateButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  tokenErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  tokenErrorText: {
    color: '#D32F2F',
    fontSize: 13,
    flex: 1,
  },
  tokenSuccessContainer: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  tokenSuccessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  tokenSuccessTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
  },
  tokenInfoRow: {
    fontSize: 13,
    marginTop: 4,
  },
  tokenInfoLabel: {
    color: '#666',
  },
  tokenInfoValue: {
    color: '#333',
    fontWeight: '600',
  },
  vulnerableGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  vulnerableCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 12,
    padding: 12,
  },
  vulnerableCardActive: {
    borderColor: '#2E7D32',
    backgroundColor: '#F3FBF4',
  },
  vulnerableCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  vulnerableCardText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  vulnerableCardTextActive: {
    color: '#2E7D32',
  },
  vulnerableCardDesc: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  vulnerableCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
  },
  vulnerableCounterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
  },
  vulnerableStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  stepperBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  stepperValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2E7D32',
    minWidth: 20,
    textAlign: 'center',
  },
  idChipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  idChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  idChipActive: {
    backgroundColor: '#2E7D32',
    borderColor: '#2E7D32',
  },
  idChipText: {
    fontSize: 13,
    color: '#555',
  },
  idChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  attestationCard: {
    backgroundColor: '#F3FBF4',
    borderWidth: 1,
    borderColor: '#C8E6C9',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
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
    color: '#2E7D32',
  },
  attestationDesc: {
    fontSize: 13,
    color: '#388E3C',
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
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  imageBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
  },
  imagePreview: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    marginTop: 8,
    resizeMode: 'cover',
  },
  faceScanCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    minHeight: 280,
  },
  faceScanPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceScanIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  faceScanTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  faceScanSubtitle: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
  },
  faceImageContainer: {
    alignItems: 'center',
    width: '100%',
  },
  faceImage: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 4,
    borderColor: '#2E7D32',
  },
  faceVerifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 14,
  },
  faceVerifiedText: {
    color: '#2E7D32',
    fontWeight: '700',
    fontSize: 13,
  },
  scanButton: {
    backgroundColor: '#2E7D32',
    paddingVertical: 16,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  scanButtonComplete: {
    backgroundColor: '#555',
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  reviewLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  reviewValue: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  miniFaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  miniFaceImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  miniFaceText: {
    fontSize: 13,
    color: '#2E7D32',
    fontWeight: '500',
    flex: 1,
  },

  // Dual Pill Bottom Action Buttons
  bottomActions: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: '#F5F7F5',
    borderTopWidth: 1,
    borderTopColor: '#E3E9E5',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bottomButtonCancel: {
    flex: 0.4,
    paddingVertical: 16,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FECDD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomButtonBack: {
    borderColor: '#E8E8E8',
  },
  bottomButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  bottomButtonNext: {
    flex: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2ECC71',
    paddingVertical: 16,
    borderRadius: 30,
    gap: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  bottomButtonNextDisabled: {
    opacity: 0.7,
  },
  bottomButtonNextText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Face Scanner Modal Styles
  faceScannerContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    zIndex: 10,
  },
  scannerCloseButton: {
    padding: 5,
  },
  scannerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  stepBadge: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stepBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  faceFrameOverlay: {
    ...StyleSheet.absoluteFill,
  },
  faceFrameTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  faceFrameMiddle: {
    flexDirection: 'row',
    height: 320,
  },
  faceFrameSide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  faceFrameBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  faceFrameOval: {
    width: 250,
    height: 320,
    borderRadius: 125,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceFrameOvalDetected: {
    borderColor: '#2ECC71',
    borderWidth: 4,
  },
  faceFrameOvalNoFace: {
    borderColor: '#F39C12',
    borderWidth: 4,
  },
  faceDetectionIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceDetectionText: {
    fontSize: 14,
    color: '#FFFFFF',
    marginTop: 10,
    textAlign: 'center',
  },
  noFaceWarning: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    marginHorizontal: 12,
  },
  noFaceText: {
    fontSize: 13,
    color: '#FFFFFF',
    marginTop: 8,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 18,
  },
  scanSuccessOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanSuccessIcon: {
    marginBottom: 15,
  },
  scanSuccessText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2ECC71',
  },
  scannerBottom: {
    paddingHorizontal: 30,
    paddingVertical: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    alignItems: 'center',
  },
  scannerInstructions: {
    fontSize: 15,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  startScanButton: {
    backgroundColor: '#2ECC71',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
  },
  startScanButtonDisabled: {
    opacity: 0.6,
  },
  startScanButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
