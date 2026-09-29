/**
 * Mobile Login Screen
 *
 * Login screen for volunteers and LGU staff to access the mobile app.
 * Supports:
 * - Direct password login for volunteers and established LGU staff (no OTP required)
 * - First-time staff OTP activation and initial password setup
 * - Password recovery / reset
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mobileAuthService, User } from '../services/auth/MobileAuthService';
import { validateEmail as validateEmailHelper, cleanEmailInput, MAX_EMAIL_LENGTH } from '../utils/emailValidation';
import { theme } from '../theme';
import StaffForgotPasswordScreen from './StaffForgotPasswordScreen';

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
  onBack?: () => void;
}

type AuthMode = 'login' | 'activation_otp' | 'activation_password';

function validateStrongPassword(value: string): string | null {
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (/\s/.test(value)) return 'Password cannot contain spaces or whitespace.';
  if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must include at least one lowercase letter.';
  if (!/[0-9]/.test(value)) return 'Password must include at least one number.';
  if (!/[!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~\\]/.test(value)) return 'Password must include at least one special character.';
  return null;
}

export default function LoginScreen({ onLoginSuccess, onBack }: LoginScreenProps) {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const otpInputRef = useRef<TextInput | null>(null);
  const otpScales = useRef(Array.from({ length: 6 }, () => new Animated.Value(1))).current;
  const prevOtpRef = useRef('');

  // Mode state
  const [mode, setMode] = useState<AuthMode>('login');

  // Input states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpToken, setOtpToken] = useState<string | null>(null); // For legacy 2FA if ever challenged
  const [activationToken, setActivationToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Visibility and UI states
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus states
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isNewPasswordFocused, setIsNewPasswordFocused] = useState(false);
  const [isConfirmPasswordFocused, setIsConfirmPasswordFocused] = useState(false);
  const [isOtpFocused, setIsOtpFocused] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  // Field validation errors
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);

  const isOtpChallenge = !!otpToken;
  const isCompactScreen = screenWidth < 380;
  const otpBoxSize = Math.max(40, Math.min(52, Math.floor((screenWidth - 150) / 6)));

  // Password requirement checklist for activation
  const passwordRequirements = useMemo(() => ({
    minLength: newPassword.length >= 8,
    hasUpper: /[A-Z]/.test(newPassword),
    hasLower: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~\\]/.test(newPassword),
    noSpaces: newPassword.length > 0 && !/\s/.test(newPassword),
    passwordsMatch: newPassword.length > 0 && newPassword === confirmPassword,
  }), [newPassword, confirmPassword]);

  const isActivationPasswordReady =
    passwordRequirements.minLength &&
    passwordRequirements.hasUpper &&
    passwordRequirements.hasLower &&
    passwordRequirements.hasNumber &&
    passwordRequirements.hasSpecial &&
    passwordRequirements.noSpaces &&
    passwordRequirements.passwordsMatch;

  const isLoginReady = useMemo(() => {
    if (mode === 'activation_password') {
      return isActivationPasswordReady;
    }
    if (mode === 'activation_otp' || isOtpChallenge) {
      return email.trim().length > 0 && otp.trim().length === 6;
    }
    return email.trim().length > 0 && password.trim().length > 0;
  }, [mode, isOtpChallenge, email, otp, password, isActivationPasswordReady]);

  useEffect(() => {
    const previous = prevOtpRef.current;
    prevOtpRef.current = otp;

    // Animate only when a new OTP digit is entered.
    if (otp.length > previous.length) {
      const index = otp.length - 1;
      const scale = otpScales[index];
      if (!scale) return;

      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.12,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 110,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [otp, otpScales]);

  const validateEmail = (value: string): boolean => {
    const result = validateEmailHelper(value);
    if (!result.isValid) {
      setEmailError(result.error || 'Please enter a valid email');
      return false;
    }
    setEmailError(null);
    return true;
  };

  const validatePasswordInput = (value: string): boolean => {
    if (!value) {
      setPasswordError('Password is required');
      return false;
    }
    setPasswordError(null);
    return true;
  };

  const validateOtpInput = (value: string): boolean => {
    if (!/^\d{6}$/.test(value)) {
      setOtpError('Enter the 6-digit verification code');
      return false;
    }
    setOtpError(null);
    return true;
  };

  const resetOtpChallenge = () => {
    setOtpToken(null);
    setOtp('');
    setOtpError(null);
  };

  const handleSwitchToActivation = () => {
    setError(null);
    setPassword('');
    setOtp('');
    setOtpError(null);
    setPasswordError(null);
    setMode('activation_otp');
  };

  const handleSwitchToLogin = () => {
    setError(null);
    setOtp('');
    setActivationToken(null);
    setNewPassword('');
    setConfirmPassword('');
    setOtpError(null);
    setNewPasswordError(null);
    setConfirmPasswordError(null);
    resetOtpChallenge();
    setMode('login');
  };

  // Standard Login Handler
  const handleStandardLogin = async () => {
    const isEmailValid = validateEmail(email);
    if (!isEmailValid) return;

    if (isOtpChallenge) {
      if (!validateOtpInput(otp)) return;
    } else {
      const isPasswordValid = validatePasswordInput(password);
      if (!isPasswordValid) return;
    }

    setIsLoading(true);

    try {
      const response = isOtpChallenge
        ? await mobileAuthService.verifyLoginOtp(otpToken!, otp)
        : await mobileAuthService.login(email, password);

      if (response.success && response.data) {
        onLoginSuccess(response.data.user);
      } else if (response.success && response.otpRequired && response.otpToken) {
        setOtpToken(response.otpToken);
        setOtp('');
        setPassword('');
        setOtpError(null);
        Alert.alert('Verification Required', response.message || 'Enter the code sent to your Gmail address.');
      } else {
        if (response.code === 'INVALID_ROLE') {
          Alert.alert(
            'Access Denied',
            'This account is not allowed to use the mobile app.',
            [{ text: 'OK' }]
          );
        } else if (response.code === 'ACCOUNT_INACTIVE') {
          Alert.alert(
            'Account Inactive',
            response.message || 'Your account is not active. Please contact an administrator.',
            [{ text: 'OK' }]
          );
        } else if (response.code === 'FIRST_LOGIN_REQUIRED') {
          Alert.alert(
            'Activation Required',
            'This staff account is awaiting first-time activation. Would you like to activate now with your 6-digit OTP code?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Activate Now',
                onPress: () => {
                  setMode('activation_otp');
                  setError(null);
                },
              },
            ]
          );
        } else if (response.code === 'OTP_SEND_FAILED') {
          setError(response.message || 'Unable to send the verification code.');
        } else if (response.code === 'ACCOUNT_LOCKED') {
          setError(response.message || 'Too many failed attempts. Please wait before trying again, or reset your password.');
        } else if (response.code === 'INVALID_CREDENTIALS') {
          setError('The email or password is incorrect. You can reset your password below.');
        } else {
          setError(response.message || 'Login failed. Please try again.');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // First-Login OTP Verification Handler
  const handleVerifyActivationOtp = async () => {
    const isEmailValid = validateEmail(email);
    if (!isEmailValid) return;

    if (!validateOtpInput(otp)) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await mobileAuthService.verifyFirstLoginOtp(email, otp);
      if (response.success && response.activationToken) {
        setActivationToken(response.activationToken);
        setMode('activation_password');
        setOtp('');
      } else {
        const isExpired = response.code === 'OTP_EXPIRED' || response.message?.toLowerCase().includes('expired');
        const isMaxAttempts = response.code === 'MAX_ATTEMPTS' || response.message?.toLowerCase().includes('too many');

        if (isExpired) {
          setOtp('');
          setError('Verification code has expired. Please request a new code.');
        } else if (isMaxAttempts) {
          setOtp('');
          setError('Too many incorrect attempts. Please request a new code.');
        } else {
          setError(response.message || 'Incorrect verification code. Please try again.');
        }
      }
    } catch (err) {
      console.error('Activation OTP verification error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // First-Login Set Password Handler
  const handleSetActivationPassword = async () => {
    if (!activationToken) {
      setError('Session expired. Please verify your OTP code again.');
      setMode('activation_otp');
      return;
    }

    const strengthError = validateStrongPassword(newPassword);
    if (strengthError) {
      setNewPasswordError(strengthError);
      return;
    }
    setNewPasswordError(null);

    if (newPassword !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match.');
      return;
    }
    setConfirmPasswordError(null);

    setIsLoading(true);
    setError(null);

    try {
      const response = await mobileAuthService.firstLoginSetPassword(activationToken, newPassword);
      if (response.success && response.data) {
        Alert.alert(
          'Account Activated!',
          'Your password has been successfully created. Welcome to Kapit-Bisig!',
          [
            {
              text: 'Go to Dashboard',
              onPress: () => onLoginSuccess(response.data!.user),
            },
          ]
        );
      } else {
        setError(response.message || 'Failed to set password. Please try again.');
      }
    } catch (err) {
      console.error('Set password error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Main Submit Router
  const handleSubmit = async () => {
    setError(null);
    if (mode === 'activation_otp') {
      await handleVerifyActivationOtp();
    } else if (mode === 'activation_password') {
      await handleSetActivationPassword();
    } else {
      await handleStandardLogin();
    }
  };

  const handleResendActivationOtp = async () => {
    const isEmailValid = validateEmail(email);
    if (!isEmailValid) return;

    setError(null);
    setIsResendingOtp(true);
    try {
      const response = await mobileAuthService.resendFirstLoginOtp(email);
      if (response.success) {
        Alert.alert('Code Sent', response.message || 'A new verification code has been sent to your email.');
      } else {
        setError(response.message || 'Failed to resend activation code.');
      }
    } finally {
      setIsResendingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpToken) return;

    setError(null);
    setIsResendingOtp(true);
    try {
      const response = await mobileAuthService.resendLoginOtp(otpToken);
      if (response.success) {
        Alert.alert('Code Sent', response.message || 'A new verification code has been sent.');
      } else {
        setError(response.message || 'Failed to resend verification code.');
      }
    } finally {
      setIsResendingOtp(false);
    }
  };

  // Render: Standard Email + Password Inputs
  const renderPasswordLogin = () => (
    <>
      <View style={[styles.inputContainer, emailError && styles.inputContainerError, isEmailFocused && styles.inputContainerFocused]}>
        <Ionicons name="mail-outline" size={20} color="#888" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Email Address"
          placeholderTextColor="#888"
          value={email}
          maxLength={MAX_EMAIL_LENGTH}
          onChangeText={(text) => {
            const cleaned = cleanEmailInput(text);
            setEmail(cleaned);
            if (emailError) validateEmail(cleaned);
          }}
          onFocus={() => setIsEmailFocused(true)}
          onBlur={() => setIsEmailFocused(false)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
        />
      </View>
      {emailError && <Text style={styles.fieldError}>{emailError}</Text>}

      <View style={[styles.inputContainer, passwordError && styles.inputContainerError, isPasswordFocused && styles.inputContainerFocused]}>
        <Ionicons name="lock-closed-outline" size={20} color="#888" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#888"
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            if (passwordError) validatePasswordInput(text);
          }}
          onFocus={() => setIsPasswordFocused(true)}
          onBlur={() => setIsPasswordFocused(false)}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          editable={!isLoading}
        />
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
          <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#888" />
        </TouchableOpacity>
      </View>
      {passwordError && <Text style={styles.fieldError}>{passwordError}</Text>}
    </>
  );

  // Render: 6-Digit OTP Box Entry
  const renderOtpInputs = (descriptionText: string, isActivation: boolean) => (
    <View style={[styles.otpSection, isCompactScreen && styles.otpSectionCompact]}>
      <Text style={styles.otpScreenTitle}>{isActivation ? 'Activate Staff Account' : 'OTP Verification'}</Text>
      <Text style={styles.otpDescription}>{descriptionText}</Text>
      <Text style={styles.otpEmailText} numberOfLines={1} ellipsizeMode="middle">{email}</Text>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          setIsOtpFocused(true);
          otpInputRef.current?.focus();
        }}
        style={[
          styles.otpBoxesContainer,
          otpError && styles.otpBoxesContainerError,
        ]}
      >
        {Array.from({ length: 6 }).map((_, index) => {
          const digit = otp[index] || '';
          const isActiveBox = otp.length === index && otp.length < 6;
          return (
            <Animated.View
              key={index}
              style={[
                styles.otpBox,
                { width: otpBoxSize, height: Math.round(otpBoxSize * 1.2) },
                { transform: [{ scale: otpScales[index] }] },
                digit && styles.otpBoxFilled,
                isActiveBox && styles.otpBoxActive,
              ]}
            >
              <Text style={styles.otpBoxText}>{digit}</Text>
            </Animated.View>
          );
        })}
      </TouchableOpacity>
      <TextInput
        ref={otpInputRef}
        style={styles.otpHiddenInput}
        value={otp}
        onChangeText={(text) => {
          const sanitized = text.replace(/\D/g, '').slice(0, 6);
          setOtp(sanitized);
          if (otpError) validateOtpInput(sanitized);
        }}
        onFocus={() => setIsOtpFocused(true)}
        onBlur={() => setIsOtpFocused(false)}
        keyboardType="number-pad"
        autoCapitalize="none"
        editable={!isLoading}
        maxLength={6}
        autoFocus
      />
    </View>
  );

  // Render: Step 1 of Activation (Email & OTP)
  const renderActivationOtp = () => (
    <>
      <View style={[styles.inputContainer, emailError && styles.inputContainerError, isEmailFocused && styles.inputContainerFocused]}>
        <Ionicons name="mail-outline" size={20} color="#888" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Registered Staff Email"
          placeholderTextColor="#888"
          value={email}
          maxLength={MAX_EMAIL_LENGTH}
          onChangeText={(text) => {
            const cleaned = cleanEmailInput(text);
            setEmail(cleaned);
            if (emailError) validateEmail(cleaned);
          }}
          onFocus={() => setIsEmailFocused(true)}
          onBlur={() => setIsEmailFocused(false)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
        />
      </View>
      {emailError && <Text style={styles.fieldError}>{emailError}</Text>}

      {renderOtpInputs('Enter the 6-digit code sent when your account was created:', true)}
      {otpError && <Text style={styles.fieldErrorCentered}>{otpError}</Text>}

      <View style={styles.challengeActions}>
        <TouchableOpacity
          onPress={handleResendActivationOtp}
          disabled={isLoading || isResendingOtp}
          style={styles.challengeLinkButton}
        >
          <Text style={styles.challengeLinkText}>
            {isResendingOtp ? 'Sending code...' : 'Resend activation code'}
          </Text>
        </TouchableOpacity>
        <View style={styles.challengeActionDivider} />
        <TouchableOpacity
          onPress={handleSwitchToLogin}
          disabled={isLoading || isResendingOtp}
          style={styles.challengeLinkButton}
        >
          <Text style={styles.challengeLinkTextMuted}>Back to password login</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // Render: Step 2 of Activation (Set Initial Password)
  const renderActivationPassword = () => (
    <>
      <View style={styles.setPasswordHeader}>
        <View style={styles.lockBadge}>
          <Ionicons name="shield-checkmark" size={24} color="#2E7D32" />
        </View>
        <Text style={styles.setPasswordTitle}>Create Your Password</Text>
        <Text style={styles.setPasswordSubtitle}>
          Choose a secure password for future logins.
        </Text>
      </View>

      <View style={[styles.inputContainer, newPasswordError && styles.inputContainerError, isNewPasswordFocused && styles.inputContainerFocused]}>
        <Ionicons name="lock-closed-outline" size={20} color="#888" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="New Password"
          placeholderTextColor="#888"
          value={newPassword}
          onChangeText={(text) => {
            setNewPassword(text);
            if (newPasswordError) setNewPasswordError(null);
          }}
          onFocus={() => setIsNewPasswordFocused(true)}
          onBlur={() => setIsNewPasswordFocused(false)}
          secureTextEntry={!showNewPassword}
          autoCapitalize="none"
          editable={!isLoading}
        />
        <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)} style={styles.eyeIcon}>
          <Ionicons name={showNewPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#888" />
        </TouchableOpacity>
      </View>
      {newPasswordError && <Text style={styles.fieldError}>{newPasswordError}</Text>}

      <View style={[styles.inputContainer, confirmPasswordError && styles.inputContainerError, isConfirmPasswordFocused && styles.inputContainerFocused]}>
        <Ionicons name="lock-closed-outline" size={20} color="#888" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Confirm Password"
          placeholderTextColor="#888"
          value={confirmPassword}
          onChangeText={(text) => {
            setConfirmPassword(text);
            if (confirmPasswordError) setConfirmPasswordError(null);
          }}
          onFocus={() => setIsConfirmPasswordFocused(true)}
          onBlur={() => setIsConfirmPasswordFocused(false)}
          secureTextEntry={!showConfirmPassword}
          autoCapitalize="none"
          editable={!isLoading}
        />
        <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeIcon}>
          <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#888" />
        </TouchableOpacity>
      </View>
      {confirmPasswordError && <Text style={styles.fieldError}>{confirmPasswordError}</Text>}

      {/* Password Checklist */}
      <View style={styles.requirementsContainer}>
        <Text style={styles.requirementsTitle}>Password Requirements:</Text>
        <View style={styles.requirementRow}>
          <Ionicons
            name={passwordRequirements.minLength ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={passwordRequirements.minLength ? '#2E7D32' : '#888'}
          />
          <Text style={[styles.requirementText, passwordRequirements.minLength && styles.requirementMet]}>
            At least 8 characters
          </Text>
        </View>
        <View style={styles.requirementRow}>
          <Ionicons
            name={passwordRequirements.hasUpper && passwordRequirements.hasLower ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={passwordRequirements.hasUpper && passwordRequirements.hasLower ? '#2E7D32' : '#888'}
          />
          <Text style={[styles.requirementText, passwordRequirements.hasUpper && passwordRequirements.hasLower && styles.requirementMet]}>
            Upper & lowercase letters
          </Text>
        </View>
        <View style={styles.requirementRow}>
          <Ionicons
            name={passwordRequirements.hasNumber ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={passwordRequirements.hasNumber ? '#2E7D32' : '#888'}
          />
          <Text style={[styles.requirementText, passwordRequirements.hasNumber && styles.requirementMet]}>
            At least one number (0-9)
          </Text>
        </View>
        <View style={styles.requirementRow}>
          <Ionicons
            name={passwordRequirements.hasSpecial ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={passwordRequirements.hasSpecial ? '#2E7D32' : '#888'}
          />
          <Text style={[styles.requirementText, passwordRequirements.hasSpecial && styles.requirementMet]}>
            At least one special symbol (!@#$%^&*)
          </Text>
        </View>
        <View style={styles.requirementRow}>
          <Ionicons
            name={passwordRequirements.passwordsMatch ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={passwordRequirements.passwordsMatch ? '#2E7D32' : '#888'}
          />
          <Text style={[styles.requirementText, passwordRequirements.passwordsMatch && styles.requirementMet]}>
            Passwords match
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={handleSwitchToLogin}
        disabled={isLoading}
        style={styles.cancelActivationLink}
      >
        <Text style={styles.challengeLinkTextMuted}>Cancel and return to login</Text>
      </TouchableOpacity>
    </>
  );

  // Render: Legacy 2FA OTP Challenge
  const renderLegacyOtpChallenge = () => (
    <>
      {renderOtpInputs('Enter the 6-digit verification code sent to:', false)}
      {otpError && <Text style={styles.fieldErrorCentered}>{otpError}</Text>}

      <View style={styles.challengeActions}>
        <TouchableOpacity
          onPress={handleResendOtp}
          disabled={isLoading || isResendingOtp}
          style={styles.challengeLinkButton}
        >
          <Text style={styles.challengeLinkText}>
            {isResendingOtp ? 'Sending...' : 'Resend code'}
          </Text>
        </TouchableOpacity>
        <View style={styles.challengeActionDivider} />
        <TouchableOpacity
          onPress={resetOtpChallenge}
          disabled={isLoading || isResendingOtp}
          style={styles.challengeLinkButton}
        >
          <Text style={styles.challengeLinkTextMuted}>Use different email</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  if (showRecovery) {
    return (
      <StaffForgotPasswordScreen
        initialEmail={email}
        onBack={() => setShowRecovery(false)}
      />
    );
  }

  // Button Action Label
  const getButtonText = () => {
    if (isLoading) {
      if (mode === 'activation_otp') return 'Verifying Code...';
      if (mode === 'activation_password') return 'Saving Password...';
      if (isOtpChallenge) return 'Verifying...';
      return 'Signing In...';
    }
    if (mode === 'activation_otp') return 'Verify & Continue';
    if (mode === 'activation_password') return 'Save Password & Sign In';
    if (isOtpChallenge) return 'Verify Code';
    return 'Login';
  };

  return (
    <KeyboardAvoidingView
      style={styles.loginKeyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.loginScrollContent,
          {
            paddingTop: Math.max(insets.top + 20, 40),
            paddingBottom: Math.max(insets.bottom + 20, 30),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={[
              styles.loginBackButton,
              { top: Math.max(insets.top + 8, Platform.OS === 'ios' ? 44 : 20) },
            ]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color="#2E7D32" />
          </TouchableOpacity>
        )}

        {mode === 'login' && !isOtpChallenge && (
          <View style={styles.welcomeContainer}>
            <Text style={styles.welcomeText}>
              <Text style={styles.welcomeGreen}>Welcome </Text>
              <Text style={styles.welcomeYellow}>Back!</Text>
            </Text>
            <Text style={styles.brandTagline}>LGU Staff Portal</Text>
          </View>
        )}

        <View style={[styles.formContainer, (mode !== 'login' || isOtpChallenge) && styles.otpFormContainer]}>
          {mode === 'activation_otp' && renderActivationOtp()}
          {mode === 'activation_password' && renderActivationPassword()}
          {mode === 'login' && isOtpChallenge && renderLegacyOtpChallenge()}
          {mode === 'login' && !isOtpChallenge && renderPasswordLogin()}

          {!!error && <Text style={styles.loginErrorText}>{error}</Text>}

          {mode === 'login' && !isOtpChallenge && (
            <View style={styles.optionsContainer}>
              <TouchableOpacity
                onPress={handleSwitchToActivation}
                disabled={isLoading}
              >
                <Text style={styles.activateLinkText}>First-time staff? Activate with OTP</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setError(null);
                  setShowRecovery(true);
                }}
                disabled={isLoading}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={[styles.loginButtonMain, (!isLoginReady || isLoading) && styles.loginButtonMainDisabled]}
            onPress={handleSubmit}
            disabled={!isLoginReady || isLoading}
          >
            <Text style={styles.loginButtonMainText}>{getButtonText()}</Text>
          </TouchableOpacity>

          {mode === 'login' && !isOtpChallenge && (
            <View style={styles.infoContainer}>
              <Text style={styles.infoText}>
                Don't have an account? Contact your barangay administrator.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  loginKeyboardView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loginScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 40,
    paddingBottom: 30,
  },
  loginBackButton: {
    position: 'absolute',
    left: 20,
    top: Platform.OS === 'ios' ? 50 : 30,
    zIndex: 10,
    padding: 5,
  },
  welcomeContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 32,
    fontWeight: 'bold',
    fontStyle: 'italic',
  },
  welcomeGreen: {
    color: '#2E7D32',
  },
  welcomeYellow: {
    color: '#ECC323',
  },
  brandTagline: {
    marginTop: 8,
    fontSize: 13,
    color: '#6B7280',
    letterSpacing: 0.2,
  },
  formContainer: {
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    paddingTop: 22,
    paddingBottom: 18,
  },
  otpFormContainer: {
    paddingTop: 24,
    paddingBottom: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 15,
    backgroundColor: '#FFFFFF',
  },
  inputContainerError: {
    borderColor: theme.colors.error,
  },
  inputContainerFocused: {
    borderColor: '#2E7D32',
    borderWidth: 2,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: '#333',
  },
  eyeIcon: {
    padding: theme.spacing.xs,
  },
  otpSection: {
    width: '100%',
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  otpSectionCompact: {
    marginBottom: theme.spacing.sm,
  },
  otpScreenTitle: {
    fontSize: theme.typography.size.lg,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  otpDescription: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  otpEmailText: {
    fontSize: theme.typography.size.sm,
    fontWeight: '700',
    color: theme.colors.primary,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
    width: '100%',
  },
  otpBoxesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.sm,
    width: '100%',
    marginTop: theme.spacing.xs,
  },
  otpBoxesContainerError: {},
  otpBox: {
    minWidth: 40,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxFilled: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  otpBoxActive: {
    borderColor: theme.colors.primary,
    borderWidth: 2,
  },
  otpBoxText: {
    fontSize: theme.typography.size.xl,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  otpHiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  fieldError: {
    color: theme.colors.error,
    fontSize: 13,
    marginBottom: theme.spacing.sm,
    marginLeft: 2,
  },
  fieldErrorCentered: {
    color: theme.colors.error,
    fontSize: 13,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  loginErrorText: {
    color: theme.colors.error,
    fontSize: 13,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 8,
  },
  activateLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2E7D32',
  },
  forgotText: {
    fontSize: 13,
    color: '#6B7280',
  },
  loginButtonMain: {
    width: '100%',
    backgroundColor: '#2E7D32',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  loginButtonMainDisabled: {
    opacity: 0.6,
  },
  loginButtonMainText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  challengeActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 8,
    marginBottom: theme.spacing.md,
  },
  challengeActionDivider: {
    width: 1,
    height: 14,
    backgroundColor: theme.colors.divider,
    marginHorizontal: theme.spacing.sm,
  },
  challengeLinkButton: {
    paddingVertical: 4,
  },
  challengeLinkText: {
    color: theme.colors.primary,
    fontSize: theme.typography.size.sm,
    fontWeight: '600',
  },
  challengeLinkTextMuted: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.size.sm,
    fontWeight: '600',
  },
  setPasswordHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  lockBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  setPasswordTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  setPasswordSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  requirementsContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  requirementsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4B5563',
    marginBottom: 8,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  requirementText: {
    fontSize: 12,
    color: '#6B7280',
  },
  requirementMet: {
    color: '#2E7D32',
    fontWeight: '600',
  },
  cancelActivationLink: {
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 10,
  },
  infoContainer: {
    alignItems: 'center',
  },
  infoText: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textPrimary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
