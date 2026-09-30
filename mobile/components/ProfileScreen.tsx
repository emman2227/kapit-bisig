import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  changeResidentPassword,
  confirmResidentChangePassword,
  getResidentToken,
  requestResidentChangePasswordOtp,
  ResidentProfile,
  updateResidentProfile,
  uploadResidentAvatar,
} from '../services/api/ResidentQrService';
import {
  mobileAuthService,
  User as VolunteerUser,
} from '../services/auth/MobileAuthService';
import { residentTheme, theme } from '../theme';
import { formatResidentFullName } from '../utils/residentName';
import { validateEmail, cleanEmailInput } from '../utils/emailValidation';
import PendingAccessBanner from './PendingAccessBanner';
import BottomNavigation from './ui/BottomNavigation';
import { Typography } from './ui/Typography';

interface ProfileScreenProps {
  onNavigate?: (screen: 'home' | 'distributions' | 'qr' | 'profile' | 'registration-revision') => void;
  onLogout?: () => void;
  accountType?: 'resident' | 'volunteer';
  residentStatus?: string;
  residentNote?: string;
  residentProfile?: ResidentProfile | null;
  volunteerUser?: VolunteerUser | null;
  onResidentProfileUpdated?: (profile: ResidentProfile) => void;
  onVolunteerProfileUpdated?: (user: VolunteerUser | null) => void;
}

interface DetailItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}

interface DetailRowProps extends DetailItem {
  showDivider?: boolean;
  isResident?: boolean;
}

interface ActionItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  onPress: () => void;
  isResident?: boolean;
}

const residentColors = residentTheme.colors;

interface StatusPresentation {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  foreground: string;
  background: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'KB';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatRole(role?: string): string {
  if (!role) return 'Volunteer';
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function joinUniqueParts(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
}

function resolveStatusPresentation(
  isVolunteer: boolean,
  residentStatus?: string,
  volunteerStatus?: string,
): StatusPresentation {
  if (isVolunteer) {
    if (volunteerStatus === 'Active') {
      return {
        label: 'Active staff',
        icon: 'checkmark-circle',
        foreground: '#15803D',
        background: '#ECFDF3',
      };
    }

    if (volunteerStatus === 'Suspended') {
      return {
        label: 'Suspended',
        icon: 'alert-circle',
        foreground: '#B91C1C',
        background: '#FEF2F2',
      };
    }

    return {
      label: volunteerStatus || 'Status unavailable',
      icon: 'information-circle',
      foreground: '#4B5563',
      background: '#F3F4F6',
    };
  }

  switch (residentStatus) {
    case 'Approved':
      return {
        label: 'Verified household',
        icon: 'checkmark-circle',
        foreground: '#15803D',
        background: '#ECFDF3',
      };
    case 'Pending':
      return {
        label: 'Pending verification',
        icon: 'time',
        foreground: '#A16207',
        background: '#FFFBEB',
      };
    case 'Needs Revision':
      return {
        label: 'Needs revision',
        icon: 'alert-circle',
        foreground: '#B45309',
        background: '#FFF7ED',
      };
    case 'Rejected':
      return {
        label: 'Registration rejected',
        icon: 'close-circle',
        foreground: '#B91C1C',
        background: '#FEF2F2',
      };
    default:
      return {
        label: 'Status unavailable',
        icon: 'information-circle',
        foreground: '#4B5563',
        background: '#F3F4F6',
      };
  }
}

function DetailRow({ icon, label, value, showDivider = true }: DetailRowProps) {
  const iconColor = residentColors.icon;
  return (
    <View>
      <View style={styles.detailRow}>
        <View style={[styles.detailIcon, styles.residentIconSurface]}>
          <Ionicons name={icon} size={19} color={iconColor} />
        </View>
        <View style={styles.detailCopy}>
          <Typography variant="caption" color={theme.colors.textSecondary}>
            {label}
          </Typography>
          <Typography variant="body" weight="medium" style={styles.detailValue}>
            {value}
          </Typography>
        </View>
      </View>
      {showDivider ? <View style={styles.divider} /> : null}
    </View>
  );
}

function ActionItem({ icon, label, description, onPress }: ActionItemProps) {
  const iconColor = residentColors.icon;
  return (
    <TouchableOpacity
      style={styles.actionItem}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.actionIcon, styles.residentIconSurface]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.actionCopy}>
        <Typography variant="body" weight="medium">{label}</Typography>
        {description ? (
          <Typography variant="caption" color={theme.colors.textSecondary} style={styles.actionDescription}>
            {description}
          </Typography>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={residentColors.secondary} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen({
  onNavigate,
  onLogout,
  accountType = 'resident',
  residentStatus,
  residentNote,
  residentProfile,
  volunteerUser,
  onResidentProfileUpdated,
  onVolunteerProfileUpdated,
}: ProfileScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const isVolunteer = accountType === 'volunteer';
  const needsRevisionResident = !isVolunteer && residentStatus === 'Needs Revision';
  const isPendingResident = !isVolunteer && (residentStatus === 'Pending' || needsRevisionResident);

  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height || 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const dynamicSheetMaxHeight = useMemo(() => {
    if (keyboardHeight > 0) {
      if (Platform.OS === 'ios') {
        // iOS: windowHeight is full screen; subtract keyboard + status bar
        return Math.max(260, windowHeight - keyboardHeight - insets.top - 16);
      }
      // Android adjustResize: windowHeight is already reduced by the keyboard,
      // so just use most of it. No subtraction needed.
      return Math.max(260, windowHeight - insets.top - 16);
    }
    return '90%';
  }, [keyboardHeight, windowHeight, insets.top]);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [changePasswordStep, setChangePasswordStep] = useState<'input' | 'otp'>('input');
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [changePasswordOtpInput, setChangePasswordOtpInput] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isRequestingChangePasswordOtp, setIsRequestingChangePasswordOtp] = useState(false);
  const [isConfirmingChangePassword, setIsConfirmingChangePassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [firstNameInput, setFirstNameInput] = useState('');
  const [lastNameInput, setLastNameInput] = useState('');
  const [mobileInput, setMobileInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [streetAddressInput, setStreetAddressInput] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(
    residentProfile?.avatarUrl?.trim() || null,
  );

  const residentName = useMemo(() => {
    return formatResidentFullName({
      firstName: residentProfile?.firstName,
      lastName: residentProfile?.lastName,
      fullName: residentProfile?.fullName,
    });
  }, [residentProfile?.firstName, residentProfile?.fullName, residentProfile?.lastName]);

  const volunteerName = useMemo(
    () => joinUniqueParts([volunteerUser?.firstName, volunteerUser?.lastName]).replace(', ', ' '),
    [volunteerUser?.firstName, volunteerUser?.lastName],
  );

  const displayName = isVolunteer
    ? volunteerName || 'Volunteer'
    : residentName || 'Resident';
  const initials = getInitials(displayName);
  const statusPresentation = resolveStatusPresentation(
    isVolunteer,
    residentStatus,
    volunteerUser?.status,
  );

  const residentAddress = joinUniqueParts([
    residentProfile?.streetAddress,
    residentProfile?.barangay,
    residentProfile?.city,
  ]);

  const detailItems = useMemo<DetailItem[]>(() => {
    if (isVolunteer) {
      return [
        { icon: 'briefcase-outline', label: 'Role', value: formatRole(volunteerUser?.role) },
        { icon: 'location-outline', label: 'Barangay', value: volunteerUser?.barangay?.trim() || 'Not provided' },
        {
          icon: 'map-outline',
          label: 'Assigned areas',
          value: volunteerUser?.assignedBarangays?.filter(Boolean).join(', ') || 'Not assigned',
        },
        { icon: 'call-outline', label: 'Phone number', value: volunteerUser?.phoneNumber?.trim() || 'Not provided' },
        { icon: 'mail-outline', label: 'Email', value: volunteerUser?.email?.trim() || 'Not provided' },
      ];
    }

    const residentItems: DetailItem[] = [
      { icon: 'home-outline', label: 'Full address', value: residentAddress || 'Not provided' },
      { icon: 'call-outline', label: 'Mobile number', value: residentProfile?.mobileNumber?.trim() || 'Not provided' },
      { icon: 'mail-outline', label: 'Recovery email', value: residentProfile?.email?.trim() || 'Not linked' },
      {
        icon: 'people-outline',
        label: 'Household size',
        value: residentProfile?.householdSize && residentProfile.householdSize > 0
          ? `${residentProfile.householdSize} ${residentProfile.householdSize === 1 ? 'member' : 'members'}`
          : 'Not provided',
      },
    ];

    return residentItems;
  }, [isVolunteer, residentAddress, residentProfile, volunteerUser]);

  const initialFields = useMemo(() => {
    if (isVolunteer) {
      return {
        firstName: volunteerUser?.firstName || '',
        lastName: volunteerUser?.lastName || '',
        mobileNumber: volunteerUser?.phoneNumber || '',
        email: volunteerUser?.email || '',
        streetAddress: '',
        city: '',
      };
    }

    return {
      firstName: residentProfile?.firstName || '',
      lastName: residentProfile?.lastName || '',
      mobileNumber: residentProfile?.mobileNumber || '',
      email: residentProfile?.email || '',
      streetAddress: residentProfile?.streetAddress || '',
      city: residentProfile?.city || '',
    };
  }, [isVolunteer, residentProfile, volunteerUser]);

  useEffect(() => {
    setAvatarUri(isVolunteer ? null : residentProfile?.avatarUrl?.trim() || null);
  }, [isVolunteer, residentProfile?.avatarUrl]);

  const openEditModal = () => {
    setFirstNameInput(initialFields.firstName);
    setLastNameInput(initialFields.lastName);
    setMobileInput(initialFields.mobileNumber);
    setEmailInput(initialFields.email);
    setStreetAddressInput(initialFields.streetAddress);
    setCityInput(initialFields.city);
    setIsEditOpen(true);
  };

  const closeEditModal = () => {
    if (!isSaving) {
      Keyboard.dismiss();
      setIsEditOpen(false);
    }
  };

  const closeChangePasswordModal = () => {
    if (!isRequestingChangePasswordOtp && !isConfirmingChangePassword) {
      Keyboard.dismiss();
      setIsChangePasswordOpen(false);
    }
  };

  const handleResidentAvatarPick = async () => {
    if (isVolunteer || isUploadingAvatar) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to update your profile photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets?.length) return;

    const previousAvatarUri = avatarUri;
    const selectedUri = result.assets[0].uri;
    setAvatarUri(selectedUri);
    setIsUploadingAvatar(true);

    try {
      const token = await getResidentToken();
      if (!token) {
        setAvatarUri(previousAvatarUri);
        Alert.alert('Session expired', 'Please log in again.');
        return;
      }

      const uploadResult = await uploadResidentAvatar(token, selectedUri);
      if (!uploadResult.success || !uploadResult.avatarUrl) {
        setAvatarUri(previousAvatarUri);
        Alert.alert('Upload failed', uploadResult.message || 'Unable to save profile photo.');
        return;
      }

      setAvatarUri(uploadResult.avatarUrl);
      if (residentProfile) {
        onResidentProfileUpdated?.({ ...residentProfile, avatarUrl: uploadResult.avatarUrl });
      }
      Alert.alert('Photo updated', 'Your profile photo was saved successfully.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    if (isSaving) return;

    const firstName = firstNameInput.trim();
    const lastName = lastNameInput.trim();
    if (!firstName || !lastName) {
      Alert.alert('Missing fields', 'First name and last name are required.');
      return;
    }

    const trimmedEmail = emailInput.trim();
    if (!isVolunteer && trimmedEmail) {
      const emailCheck = validateEmail(trimmedEmail);
      if (!emailCheck.isValid) {
        Alert.alert('Invalid email', emailCheck.error || 'Please enter a valid email address.');
        return;
      }
    }

    setIsSaving(true);
    try {
      if (isVolunteer) {
        const result = await mobileAuthService.updateProfile({
          firstName,
          lastName,
          phoneNumber: mobileInput.trim(),
        });

        if (!result.success || !result.data) {
          Alert.alert('Update failed', result.error || 'Unable to update profile.');
          return;
        }

        onVolunteerProfileUpdated?.(result.data);
        setIsEditOpen(false);
        Alert.alert('Profile updated', 'Your changes were saved successfully.');
        return;
      }

      const token = await getResidentToken();
      if (!token) {
        Alert.alert('Session expired', 'Please log in again.');
        return;
      }

      const result = await updateResidentProfile(token, {
        firstName,
        lastName,
        mobileNumber: mobileInput.trim() || undefined,
        email: trimmedEmail ? trimmedEmail.toLowerCase() : '',
        streetAddress: streetAddressInput.trim() || undefined,
        city: cityInput.trim() || undefined,
      });

      if (!result.success || !result.data) {
        Alert.alert('Update failed', result.message || 'Unable to update profile.');
        return;
      }

      onResidentProfileUpdated?.(result.data);
      Keyboard.dismiss();
      setIsEditOpen(false);
      Alert.alert('Profile updated', 'Your changes were saved successfully.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestChangePasswordOtp = async () => {
    if (isRequestingChangePasswordOtp) return;

    const currentPassword = currentPasswordInput.trim();
    const newPassword = newPasswordInput.trim();
    const confirmPassword = confirmPasswordInput.trim();

    if (!currentPassword) {
      Alert.alert('Missing field', 'Please enter your current password.');
      return;
    }
    if (!newPassword) {
      Alert.alert('Missing field', 'Please enter a new password.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords mismatch', 'New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      Alert.alert('Invalid password', 'New password cannot be the same as your current password.');
      return;
    }

    setIsRequestingChangePasswordOtp(true);
    try {
      const token = await getResidentToken();
      if (!token) {
        Alert.alert('Session expired', 'Please log in again.');
        return;
      }

      const result = await requestResidentChangePasswordOtp(token, {
        currentPassword,
        newPassword,
      });

      if (!result.success) {
        const errorDetail = result.errors && result.errors.length > 0 ? `\n\n• ${result.errors.join('\n• ')}` : '';
        Alert.alert('Request failed', `${result.message || 'Unable to send verification code.'}${errorDetail}`);
        return;
      }

      setChangePasswordStep('otp');
      setChangePasswordOtpInput('');
      Alert.alert('Verification code sent', 'A 6-digit verification code was sent via SMS to your registered mobile number.');
    } finally {
      setIsRequestingChangePasswordOtp(false);
    }
  };

  const handleConfirmChangePassword = async () => {
    if (isConfirmingChangePassword) return;

    const otp = changePasswordOtpInput.trim();
    const newPassword = newPasswordInput.trim();

    if (!otp || otp.length !== 6) {
      Alert.alert('Invalid code', 'Please enter the 6-digit verification code sent via SMS.');
      return;
    }

    setIsConfirmingChangePassword(true);
    try {
      const token = await getResidentToken();
      if (!token) {
        Alert.alert('Session expired', 'Please log in again.');
        return;
      }

      const result = await confirmResidentChangePassword(token, {
        otp,
        newPassword,
      });

      if (!result.success) {
        const isExpired = result.message?.toLowerCase().includes('expired');
        const isMaxAttempts = result.message?.toLowerCase().includes('too many');

        if (isExpired) {
          setChangePasswordOtpInput('');
          Alert.alert('Code Expired', 'Verification code has expired. Please tap Resend OTP to request a new code.');
          return;
        }
        if (isMaxAttempts) {
          setChangePasswordOtpInput('');
          Alert.alert('Too Many Attempts', 'Too many failed attempts. Please tap Resend OTP to request a new code.');
          return;
        }

        const errorDetail = result.errors && result.errors.length > 0 ? `\n\n• ${result.errors.join('\n• ')}` : '';
        Alert.alert('Verification failed', `${result.message || 'Unable to update password.'}${errorDetail}`);
        return;
      }

      Keyboard.dismiss();
      setIsChangePasswordOpen(false);
      setChangePasswordStep('input');
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setChangePasswordOtpInput('');
      Alert.alert('Password updated', 'Your password has been changed successfully.');
    } finally {
      setIsConfirmingChangePassword(false);
    }
  };

  const handleConfirmLogout = () => {
    setIsLogoutConfirmOpen(false);
    onLogout?.();
  };

  return (
    <SafeAreaView style={[styles.container, styles.residentContainer]} edges={['top']}>
      <View style={styles.header}>
        <Typography variant="h2" weight="semiBold" color={residentColors.ink}>Profile</Typography>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 104 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.profileCard, styles.residentCard]}>
          <View style={styles.identityAccent} />
          <View style={styles.avatarContainer}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={[styles.avatar, styles.residentAvatar]} accessibilityLabel={`${displayName}'s profile photo`} />
            ) : (
              <View style={[styles.avatarFallback, styles.residentAvatarFallback]} accessibilityLabel={`${displayName}'s initials`}>
                <Typography variant="h2" weight="bold" color={residentColors.ink}>{initials}</Typography>
              </View>
            )}

            {!isVolunteer ? (
              <TouchableOpacity
                style={[styles.cameraButton, styles.residentCameraButton]}
                onPress={handleResidentAvatarPick}
                disabled={isUploadingAvatar}
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
              >
                {isUploadingAvatar ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="camera" size={15} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.identityCopy}>
            <Typography variant="h3" weight="semiBold" numberOfLines={2}>{displayName}</Typography>
            {!isVolunteer && residentProfile?.residentCode?.trim() ? (
              <Typography variant="caption" weight="semiBold" color={residentColors.secondary} style={styles.residentCode}>
                {residentProfile.residentCode.trim()}
              </Typography>
            ) : null}
            <View style={[styles.statusBadge, { backgroundColor: statusPresentation.background }]}>
              <Ionicons name={statusPresentation.icon} size={15} color={statusPresentation.foreground} />
              <Typography
                variant="caption"
                weight="semiBold"
                color={statusPresentation.foreground}
                style={styles.statusText}
              >
                {statusPresentation.label}
              </Typography>
            </View>
            <TouchableOpacity
              style={[styles.editProfileButton, styles.residentEditProfileButton]}
              onPress={openEditModal}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <Ionicons name="create-outline" size={17} color={residentColors.icon} />
              <Typography variant="caption" weight="semiBold" color={residentColors.icon}>
                Edit profile
              </Typography>
            </TouchableOpacity>
          </View>
        </View>

        {isPendingResident ? (
          <PendingAccessBanner
            style={styles.pendingBanner}
            message={
              needsRevisionResident
                ? 'Your registration needs revision. Review the admin note below. QR and announcements will unlock after approval.'
                : 'Your account is pending admin review. QR and announcements will unlock after approval.'
            }
          />
        ) : null}

        {needsRevisionResident && residentNote?.trim() ? (
          <View style={styles.adminNoteCard}>
            <View style={styles.adminNoteHeader}>
              <Ionicons name="document-text-outline" size={18} color="#B45309" />
              <Typography variant="caption" weight="bold" color="#B45309">Admin note</Typography>
            </View>
            <Typography variant="body" color="#92400E" style={styles.adminNoteText}>
              {residentNote.trim()}
            </Typography>
          </View>
        ) : null}

        {needsRevisionResident ? (
          <TouchableOpacity
            style={[styles.revisionCard, styles.residentRevisionCard]}
            onPress={() => onNavigate?.('registration-revision')}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel="Upload corrected files"
          >
            <View style={[styles.revisionIcon, styles.residentRevisionIcon]}>
              <Ionicons name="cloud-upload-outline" size={21} color={residentColors.icon} />
            </View>
            <View style={styles.revisionCopy}>
              <Typography variant="body" weight="semiBold">Upload corrected files</Typography>
              <Typography variant="caption" color={theme.colors.textSecondary} style={styles.actionDescription}>
                Send updated ID images and selfie for admin review.
              </Typography>
            </View>
            <Ionicons name="chevron-forward" size={18} color={residentColors.icon} />
          </TouchableOpacity>
        ) : null}

        <Typography variant="label" weight="semiBold" color={residentColors.inkSoft} style={styles.sectionLabel}>
          Account details
        </Typography>
        <View style={[styles.card, styles.residentDetailCard]}>
          {detailItems.map((item, index) => (
            <DetailRow
              key={item.label}
              {...item}
              showDivider={index < detailItems.length - 1}
              isResident
            />
          ))}
        </View>

        {!isVolunteer ? (
          <>
            <Typography variant="label" weight="semiBold" color={residentColors.inkSoft} style={styles.sectionLabel}>
              Security
            </Typography>
            <View style={[styles.card, styles.residentDetailCard]}>
              <ActionItem
                icon="lock-closed-outline"
                label="Change password"
                description="Update your account login password with SMS OTP."
                onPress={() => {
                  setChangePasswordStep('input');
                  setCurrentPasswordInput('');
                  setNewPasswordInput('');
                  setConfirmPasswordInput('');
                  setChangePasswordOtpInput('');
                  setShowCurrentPassword(false);
                  setShowNewPassword(false);
                  setShowConfirmPassword(false);
                  setIsChangePasswordOpen(true);
                }}
                isResident
              />
            </View>
          </>
        ) : null}

        <Typography variant="label" weight="semiBold" color={residentColors.inkSoft} style={styles.sectionLabel}>
          Support
        </Typography>
        <View style={[styles.card, styles.residentDetailCard]}>
          <ActionItem
            icon="help-circle-outline"
            label="Help & Support"
            description="Contact your barangay office for account assistance."
            onPress={() => Alert.alert('Help & Support', 'Please contact your barangay office for support.')}
            isResident
          />
        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => setIsLogoutConfirmOpen(true)}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <View style={styles.logoutIcon}>
            <Ionicons name="log-out-outline" size={20} color="#B91C1C" />
          </View>
          <Typography variant="body" weight="semiBold" color="#B91C1C" style={styles.logoutText}>
            Log out
          </Typography>
        </TouchableOpacity>
      </ScrollView>

      <BottomNavigation
        activeTab="profile"
        onNavigate={onNavigate}
        showDistributions={!isVolunteer}
        appearance="resident"
      />

      <Modal
        visible={isEditOpen}
        transparent
        animationType="slide"
        onRequestClose={closeEditModal}
      >
        <View
          style={[
            styles.sheetOverlay,
            Platform.OS === 'ios' && keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null,
          ]}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View
            style={[
              styles.editSheet,
              {
                maxHeight: dynamicSheetMaxHeight,
                paddingBottom: keyboardHeight > 0 ? 16 : Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Typography variant="h3" weight="semiBold">Edit profile</Typography>
                <Typography variant="caption" color={theme.colors.textSecondary}>
                  Keep your account information up to date.
                </Typography>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={closeEditModal}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel="Close edit profile"
              >
                <Ionicons name="close" size={21} color={residentColors.icon} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.formScroll}
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled={true}
              showsVerticalScrollIndicator={true}
            >
              <Text style={styles.inputLabel}>First name</Text>
              <TextInput
                style={styles.input}
                value={firstNameInput}
                onChangeText={setFirstNameInput}
                editable={!isSaving}
                autoCapitalize="words"
                returnKeyType="next"
              />

              <Text style={styles.inputLabel}>Last name</Text>
              <TextInput
                style={styles.input}
                value={lastNameInput}
                onChangeText={setLastNameInput}
                editable={!isSaving}
                autoCapitalize="words"
                returnKeyType="next"
              />

              <Text style={styles.inputLabel}>{isVolunteer ? 'Phone number' : 'Mobile number'}</Text>
              <TextInput
                style={styles.input}
                value={mobileInput}
                onChangeText={setMobileInput}
                keyboardType="phone-pad"
                editable={!isSaving}
                returnKeyType="next"
              />

              {!isVolunteer ? (
                <>
                  <Text style={styles.inputLabel}>Recovery email (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={emailInput}
                    onChangeText={(text) => setEmailInput(cleanEmailInput(text))}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="e.g. name@example.com"
                    placeholderTextColor="#9CA3AF"
                    editable={!isSaving}
                    returnKeyType="next"
                  />

                  <Text style={styles.inputLabel}>Street address</Text>
                  <TextInput
                    style={styles.input}
                    value={streetAddressInput}
                    onChangeText={setStreetAddressInput}
                    editable={!isSaving}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />

                  <Text style={styles.inputLabel}>City / Municipality</Text>
                  <TextInput
                    style={styles.input}
                    value={cityInput}
                    onChangeText={setCityInput}
                    editable={!isSaving}
                    autoCapitalize="words"
                    returnKeyType="done"
                  />
                </>
              ) : null}
            </ScrollView>

            <View style={styles.formActions}>
              <TouchableOpacity
                style={[styles.formButton, styles.cancelButton]}
                onPress={closeEditModal}
                disabled={isSaving}
              >
                <Typography variant="body" weight="semiBold" color={theme.colors.textSecondary}>Cancel</Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.formButton, styles.saveButton, styles.residentSaveButton, isSaving && styles.disabledButton]}
                onPress={handleSaveProfile}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={theme.colors.textInverse} />
                ) : (
                  <Typography variant="body" weight="bold" color={theme.colors.textInverse}>Save changes</Typography>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isLogoutConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsLogoutConfirmOpen(false)}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogCard}>
            <View style={styles.dialogIcon}>
              <Ionicons name="log-out-outline" size={24} color="#B91C1C" />
            </View>
            <Typography variant="h3" weight="semiBold" align="center">Log out?</Typography>
            <Typography variant="body" color={theme.colors.textSecondary} align="center" style={styles.dialogMessage}>
              You’ll need to sign in again to access your account.
            </Typography>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.formButton, styles.cancelButton]}
                onPress={() => setIsLogoutConfirmOpen(false)}
              >
                <Typography variant="body" weight="semiBold" color={theme.colors.textSecondary}>Cancel</Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.formButton, styles.confirmLogoutButton]}
                onPress={handleConfirmLogout}
              >
                <Typography variant="body" weight="bold" color={theme.colors.textInverse}>Log out</Typography>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isChangePasswordOpen}
        transparent
        animationType="slide"
        onRequestClose={closeChangePasswordModal}
      >
        <View
          style={[
            styles.sheetOverlay,
            Platform.OS === 'ios' && keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null,
          ]}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View
            style={[
              styles.editSheet,
              {
                maxHeight: dynamicSheetMaxHeight,
                paddingBottom: keyboardHeight > 0 ? 16 : Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Typography variant="h3" weight="semiBold">
                  {changePasswordStep === 'input' ? 'Change password' : 'Enter verification code'}
                </Typography>
                <Typography variant="caption" color={theme.colors.textSecondary}>
                  {changePasswordStep === 'input'
                    ? 'Enter your current password and choose a strong new password.'
                    : 'We sent a 6-digit SMS verification code to your registered mobile number.'}
                </Typography>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={closeChangePasswordModal}
                disabled={isRequestingChangePasswordOtp || isConfirmingChangePassword}
                accessibilityRole="button"
                accessibilityLabel="Close change password"
              >
                <Ionicons name="close" size={21} color={residentColors.icon} />
              </TouchableOpacity>
            </View>

            {changePasswordStep === 'input' ? (
              <>
                <ScrollView
                  style={styles.formScroll}
                  contentContainerStyle={styles.formContent}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                >
                  <Text style={styles.inputLabel}>Current password</Text>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.passwordInput}
                      value={currentPasswordInput}
                      onChangeText={setCurrentPasswordInput}
                      secureTextEntry={!showCurrentPassword}
                      autoCapitalize="none"
                      editable={!isRequestingChangePasswordOtp}
                      placeholder="Enter current password"
                      placeholderTextColor="#9CA3AF"
                    />
                    <TouchableOpacity
                      onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                      style={styles.passwordEyeButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                    >
                      <Ionicons
                        name={showCurrentPassword ? 'eye-outline' : 'eye-off-outline'}
                        size={19}
                        color={residentColors.icon}
                      />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputLabel}>New password</Text>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.passwordInput}
                      value={newPasswordInput}
                      onChangeText={setNewPasswordInput}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      editable={!isRequestingChangePasswordOtp}
                      placeholder="Enter new password (min. 8 characters)"
                      placeholderTextColor="#9CA3AF"
                    />
                    <TouchableOpacity
                      onPress={() => setShowNewPassword(!showNewPassword)}
                      style={styles.passwordEyeButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={showNewPassword ? 'Hide new password' : 'Show new password'}
                    >
                      <Ionicons
                        name={showNewPassword ? 'eye-outline' : 'eye-off-outline'}
                        size={19}
                        color={residentColors.icon}
                      />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputLabel}>Confirm new password</Text>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.passwordInput}
                      value={confirmPasswordInput}
                      onChangeText={setConfirmPasswordInput}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      editable={!isRequestingChangePasswordOtp}
                      placeholder="Re-enter new password"
                      placeholderTextColor="#9CA3AF"
                    />
                    <TouchableOpacity
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      style={styles.passwordEyeButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      <Ionicons
                        name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'}
                        size={19}
                        color={residentColors.icon}
                      />
                    </TouchableOpacity>
                  </View>
                </ScrollView>

                <View style={styles.formActions}>
                  <TouchableOpacity
                    style={[styles.formButton, styles.cancelButton]}
                    onPress={closeChangePasswordModal}
                    disabled={isRequestingChangePasswordOtp}
                  >
                    <Typography variant="body" weight="semiBold" color={theme.colors.textSecondary}>Cancel</Typography>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formButton, styles.saveButton, styles.residentSaveButton, isRequestingChangePasswordOtp && styles.disabledButton]}
                    onPress={handleRequestChangePasswordOtp}
                    disabled={isRequestingChangePasswordOtp}
                  >
                    {isRequestingChangePasswordOtp ? (
                      <ActivityIndicator size="small" color={theme.colors.textInverse} />
                    ) : (
                      <Typography variant="body" weight="bold" color={theme.colors.textInverse}>Send OTP code</Typography>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <ScrollView
                  style={styles.formScroll}
                  contentContainerStyle={styles.formContent}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.otpCardContainer}>
                    <View style={styles.otpNoticeBox}>
                      <Ionicons name="chatbox-ellipses-outline" size={24} color={residentColors.brand} style={styles.otpNoticeIcon} />
                      <Typography variant="body" color={residentColors.ink} style={styles.otpNoticeText}>
                        Please check your SMS inbox for the 6-digit code.
                      </Typography>
                    </View>

                    <Text style={styles.inputLabel}>6-Digit SMS Verification Code</Text>
                    <TextInput
                      style={[styles.input, styles.otpInputField]}
                      value={changePasswordOtpInput}
                      onChangeText={setChangePasswordOtpInput}
                      keyboardType="number-pad"
                      maxLength={6}
                      placeholder="123456"
                      placeholderTextColor="#9CA3AF"
                      autoFocus
                      editable={!isConfirmingChangePassword}
                    />

                    <TouchableOpacity
                      style={styles.resendOtpButton}
                      onPress={handleRequestChangePasswordOtp}
                      disabled={isRequestingChangePasswordOtp || isConfirmingChangePassword}
                    >
                      <Typography variant="caption" weight="semiBold" color={residentColors.brand}>
                        {isRequestingChangePasswordOtp ? 'Resending code...' : "Didn't receive code? Resend OTP"}
                      </Typography>
                    </TouchableOpacity>
                  </View>
                </ScrollView>

                <View style={styles.formActions}>
                  <TouchableOpacity
                    style={[styles.formButton, styles.cancelButton]}
                    onPress={() => {
                      Keyboard.dismiss();
                      setChangePasswordStep('input');
                    }}
                    disabled={isConfirmingChangePassword}
                  >
                    <Typography variant="body" weight="semiBold" color={theme.colors.textSecondary}>Back</Typography>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formButton, styles.saveButton, styles.residentSaveButton, isConfirmingChangePassword && styles.disabledButton]}
                    onPress={handleConfirmChangePassword}
                    disabled={isConfirmingChangePassword}
                  >
                    {isConfirmingChangePassword ? (
                      <ActivityIndicator size="small" color={theme.colors.textInverse} />
                    ) : (
                      <Typography variant="body" weight="bold" color={theme.colors.textInverse}>Confirm & update</Typography>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  residentContainer: {
    backgroundColor: residentColors.background,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: 20,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  profileCard: {
    padding: 16,
    marginBottom: 16,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  residentCard: {
    borderColor: residentColors.borderAccent,
    backgroundColor: residentColors.surface,
    shadowColor: residentColors.brandDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
    overflow: 'hidden',
  },
  identityAccent: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: 3,
    backgroundColor: residentColors.accent,
  },
  avatarContainer: {
    width: 92,
    height: 92,
    marginRight: 16,
    position: 'relative',
  },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: theme.colors.primaryLight,
    backgroundColor: theme.colors.divider,
  },
  residentAvatar: {
    borderColor: residentColors.accent,
  },
  avatarFallback: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: '#BBF7D0',
    backgroundColor: theme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  residentAvatarFallback: {
    borderColor: residentColors.accent,
    backgroundColor: residentColors.iconSurface,
  },
  cameraButton: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: theme.colors.surface,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  residentCameraButton: {
    borderColor: residentColors.surface,
    backgroundColor: residentColors.brand,
  },
  identityCopy: {
    flex: 1,
    alignItems: 'flex-start',
  },
  residentCode: {
    marginTop: 4,
    letterSpacing: 0.55,
  },
  statusBadge: {
    minHeight: 28,
    marginTop: 7,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    marginLeft: 4,
    fontSize: 12,
    lineHeight: 16,
  },
  editProfileButton: {
    minHeight: 36,
    marginTop: 8,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: '#F0FDF4',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  residentEditProfileButton: {
    backgroundColor: residentColors.iconSurface,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  pendingBanner: {
    marginHorizontal: 0,
    marginBottom: 16,
  },
  adminNoteCard: {
    padding: 14,
    marginBottom: 12,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
  },
  adminNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  adminNoteText: {
    marginTop: 8,
  },
  revisionCard: {
    minHeight: 72,
    padding: 14,
    marginBottom: 16,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    flexDirection: 'row',
    alignItems: 'center',
  },
  revisionIcon: {
    width: 42,
    height: 42,
    marginRight: 12,
    borderRadius: 21,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  residentRevisionCard: {
    borderColor: residentColors.borderAccent,
    backgroundColor: residentColors.surface,
  },
  residentRevisionIcon: {
    backgroundColor: residentColors.iconSurface,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  revisionCopy: {
    flex: 1,
    marginRight: 8,
  },
  sectionLabel: {
    marginTop: 4,
    marginBottom: 8,
  },
  card: {
    marginBottom: 20,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  residentDetailCard: {
    borderColor: residentColors.borderAccent,
    backgroundColor: residentColors.surface,
    shadowColor: residentColors.brandDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.035,
    shadowRadius: 9,
    elevation: 1,
  },
  detailRow: {
    minHeight: 64,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailIcon: {
    width: 36,
    height: 36,
    marginRight: 12,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  residentIconSurface: {
    backgroundColor: residentColors.iconSurface,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  detailCopy: {
    flex: 1,
  },
  detailValue: {
    marginTop: 1,
  },
  divider: {
    height: 1,
    marginLeft: 48,
    backgroundColor: theme.colors.divider,
  },
  actionItem: {
    minHeight: 68,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: {
    flex: 1,
    marginRight: 8,
  },
  actionDescription: {
    marginTop: 2,
  },
  logoutButton: {
    minHeight: 58,
    paddingHorizontal: 14,
    marginBottom: 24,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FFF7F7',
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoutIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    flex: 1,
    marginLeft: 12,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
  },
  editSheet: {
    maxHeight: '90%',
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.colors.surface,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    marginBottom: 14,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
  },
  sheetHeader: {
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 44,
    height: 44,
    marginTop: -6,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  formContent: {
    paddingBottom: 8,
  },
  inputLabel: {
    marginTop: 10,
    marginBottom: 6,
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.fontFamily.medium,
    fontSize: 13,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: theme.colors.surface,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.regular,
    fontSize: 15,
  },
  passwordInputContainer: {
    minHeight: 48,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
  },
  passwordInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 13,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.regular,
    fontSize: 15,
  },
  passwordEyeButton: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpCardContainer: {
    paddingVertical: 12,
  },
  otpNoticeBox: {
    padding: 12,
    marginBottom: 14,
    borderRadius: theme.borderRadius.md,
    backgroundColor: residentColors.surfaceMuted,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
    flexDirection: 'row',
    alignItems: 'center',
  },
  otpNoticeIcon: {
    marginRight: 10,
  },
  otpNoticeText: {
    flex: 1,
    fontSize: 13,
  },
  otpInputField: {
    textAlign: 'center',
    fontSize: 22,
    letterSpacing: 8,
    fontFamily: theme.typography.fontFamily.bold,
  },
  resendOtpButton: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 6,
  },
  sheetHeaderCopy: {
    flex: 1,
    paddingRight: 12,
  },
  formActions: {
    paddingTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  formButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: theme.borderRadius.md,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  saveButton: {
    backgroundColor: theme.colors.primary,
  },
  residentSaveButton: {
    backgroundColor: residentColors.brand,
  },
  disabledButton: {
    opacity: 0.7,
  },
  dialogOverlay: {
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogCard: {
    width: '100%',
    maxWidth: 360,
    padding: 20,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface,
  },
  dialogIcon: {
    width: 48,
    height: 48,
    marginBottom: 12,
    borderRadius: 24,
    backgroundColor: '#FEE2E2',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogMessage: {
    marginTop: 6,
  },
  dialogActions: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 10,
  },
  confirmLogoutButton: {
    backgroundColor: '#B91C1C',
  },
});
