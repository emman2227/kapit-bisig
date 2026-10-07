import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import RegisterScreen from './RegisterScreen';
import LoginScreen from './LoginScreen';
import { mobileAuthService, User } from '../services/auth/MobileAuthService';
import {
  clearResidentSession,
  residentForgotPasswordReset,
  residentForgotPasswordSendOtp,
  residentForgotPasswordVerifyOtp,
  residentLogin,
  saveResidentSession,
} from '../services/api/ResidentQrService';
import {
  hasCompletedOnboarding,
  setCompletedOnboarding,
} from '../services/storage/OnboardingStorage';

interface SplashScreenProps {
  onGetStarted: () => void;
  onLogin?: () => void;
  onRegister?: () => void;
  onVolunteerLogin?: (user: User) => void;
  initialView?: 'landing' | 'login';
}

const slides = [
  {
    id: '1',
    image: require('../assets/graphics1.png'),
    text: 'Register your household and upload your IDs for instant, AI-powered verification to skip the manual paperwork.',
  },
  {
    id: '2',
    image: require('../assets/graphics2.png'),
    text: 'Get a unique Family QR code to ensure a fast, contactless, and organized experience at relief distribution center.',
  },
  {
    id: '3',
    image: require('../assets/graphics3.png'),
    text: 'Receive real-time announcements from your LGU and easily track your family\'s relief claim history in one place.',
  },
];

export default function SplashScreen({
  onGetStarted,
  onLogin,
  onRegister,
  onVolunteerLogin,
  initialView = 'landing',
}: SplashScreenProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [showLandingScreen, setShowLandingScreen] = useState(initialView === 'landing');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showInitialSplash, setShowInitialSplash] = useState(false);
  const [showLoginScreen, setShowLoginScreen] = useState(initialView === 'login');
  const [showVolunteerLoginScreen, setShowVolunteerLoginScreen] = useState(false);
  const [showRegisterScreen, setShowRegisterScreen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isMobileInputFocused, setIsMobileInputFocused] = useState(false);
  const [isPasswordInputFocused, setIsPasswordInputFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showForgotPasswordScreen, setShowForgotPasswordScreen] = useState(false);
  const [forgotStep, setForgotStep] = useState<'mobile' | 'verification' | 'reset'>('mobile');
  const [forgotMethod, setForgotMethod] = useState<'mobile' | 'email'>('mobile');
  const [forgotMobile, setForgotMobile] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotVerificationCode, setForgotVerificationCode] = useState('');
  const [forgotResetToken, setForgotResetToken] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);
  const [showForgotConfirmPassword, setShowForgotConfirmPassword] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    let isMounted = true;

    if (initialView === 'login') {
      setShowLandingScreen(false);
      setShowOnboarding(false);
      setShowInitialSplash(false);
      setShowRegisterScreen(false);
      setShowVolunteerLoginScreen(false);
      setShowForgotPasswordScreen(false);
      setForgotStep('mobile');
      setLoginError('');
      setShowLoginScreen(true);
      return;
    }

    hasCompletedOnboarding()
      .then((completed) => {
        if (!isMounted) return;
        if (completed) {
          setShowLandingScreen(false);
          setShowOnboarding(false);
          setShowInitialSplash(false);
          setShowRegisterScreen(false);
          setShowVolunteerLoginScreen(false);
          setShowForgotPasswordScreen(false);
          setForgotStep('mobile');
          setLoginError('');
          setShowLoginScreen(true);
        } else {
          setShowLandingScreen(true);
          setShowOnboarding(false);
          setShowInitialSplash(false);
          setShowLoginScreen(false);
          setShowVolunteerLoginScreen(false);
          setShowRegisterScreen(false);
          setShowForgotPasswordScreen(false);
          setForgotStep('mobile');
          setLoginError('');
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [initialView]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const slideIndex = Math.round(event.nativeEvent.contentOffset.x / windowWidth);
    if (slideIndex >= 0 && slideIndex < slides.length) {
      setCurrentIndex(slideIndex);
    }
  };

  const handleGetStarted = () => {
    setShowLandingScreen(false);
    setShowOnboarding(true);
  };

  const handleLogin = async () => {
    setLoginError('');

    if (!loginIdentifier.trim() || !password.trim()) {
      setLoginError('Enter your mobile number or resident code and password.');
      return;
    }

    setIsLoggingIn(true);
    try {
      // Ensure resident login is the only active session type.
      await mobileAuthService.logout();
      await clearResidentSession();

      const response = await residentLogin(loginIdentifier.trim(), password);
      if (!response.success || !response.data) {
        setLoginError(response.message || 'Login failed. Please try again.');
        return;
      }

      await saveResidentSession(response.data);
      await setCompletedOnboarding(true);

      if (onLogin) {
        onLogin();
      } else {
        onGetStarted();
      }
    } catch (error) {
      console.error('[SplashScreen] Resident login error:', error);
      setLoginError('Unable to connect to server. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = () => {
    setShowLoginScreen(false);
    setShowInitialSplash(false);
    setShowRegisterScreen(true);
  };

  const openVolunteerLoginFromResidentLogin = () => {
    setShowLoginScreen(false);
    setShowVolunteerLoginScreen(true);
  };

  const handleSendResetCode = async () => {
    let identifier = '';
    if (forgotMethod === 'mobile') {
      const rawDigits = forgotMobile.replace(/\D/g, '');
      if (!rawDigits || rawDigits.length < 10) {
        Alert.alert('Invalid Mobile Number', 'Please enter a valid 11-digit mobile number (e.g. 09171234567).');
        return;
      }
      identifier = forgotMobile.trim();
    } else {
      const email = forgotEmail.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        Alert.alert('Invalid Email', 'Please enter a valid recovery email address (e.g. name@example.com).');
        return;
      }
      identifier = email;
    }

    setIsSendingOtp(true);
    try {
      const result = await residentForgotPasswordSendOtp(identifier);
      if (!result.success) {
        Alert.alert('Send Failed', result.message || 'Failed to send verification code.');
        return;
      }

      setForgotVerificationCode('');
      setForgotResetToken('');
      setForgotStep('verification');
      Alert.alert(
        'Code Sent',
        forgotMethod === 'mobile'
          ? 'If the mobile number is registered, a 6-digit verification code was sent via SMS.'
          : 'If the recovery email is registered, a 6-digit verification code was sent to your inbox.'
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Failed to send verification code.';
      Alert.alert('Send Failed', messageText);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!forgotVerificationCode.trim() || forgotVerificationCode.trim().length !== 6) {
      Alert.alert('Missing Code', 'Please enter the 6-digit verification code.');
      return;
    }

    const identifier = forgotMethod === 'mobile' ? forgotMobile.trim() : forgotEmail.trim().toLowerCase();
    if (!identifier) {
      Alert.alert(
        forgotMethod === 'mobile' ? 'Missing Mobile Number' : 'Missing Recovery Email',
        `Please go back and enter your ${forgotMethod === 'mobile' ? 'mobile number' : 'recovery email'}.`
      );
      return;
    }

    setIsVerifyingOtp(true);
    try {
      const result = await residentForgotPasswordVerifyOtp(
        identifier,
        forgotVerificationCode.trim(),
      );
      if (!result.success || !result.resetToken) {
        Alert.alert('Verification Failed', result.message || 'Invalid or expired code.');
        return;
      }

      setForgotResetToken(result.resetToken);
      setForgotStep('reset');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleChangePassword = async () => {
    if (!forgotNewPassword.trim() || !forgotConfirmPassword.trim()) {
      Alert.alert('Missing Password', 'Please enter and confirm your new password.');
      return;
    }

    if (forgotNewPassword !== forgotConfirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    // Password complexity checks
    if (/\s/.test(forgotNewPassword)) {
      Alert.alert('Invalid Password', 'Password must not contain spaces.');
      return;
    }
    const commonPatterns = [
      'password', 'admin', '123456', 'qwerty', 'letmein', 'welcome',
      'monkey', 'dragon', 'master', 'login', 'abc123', 'trustno1',
      'iloveyou', 'sunshine', 'princess', 'kapitbisig', 'changeme',
    ];
    if (commonPatterns.some((p) => forgotNewPassword.toLowerCase().includes(p))) {
      Alert.alert('Weak Password', 'This password is too common. Please choose a stronger one.');
      return;
    }
    const hasUpper = /[A-Z]/.test(forgotNewPassword);
    const hasLower = /[a-z]/.test(forgotNewPassword);
    const hasDigit = /[0-9]/.test(forgotNewPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;':",./<>?`~\\]/.test(forgotNewPassword);
    if (forgotNewPassword.length < 8 || !hasUpper || !hasLower || !hasDigit || !hasSpecial) {
      Alert.alert(
        'Weak Password',
        'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
      );
      return;
    }

    if (!forgotResetToken) {
      Alert.alert('Session Expired', 'Please verify your code again.');
      setForgotStep('verification');
      return;
    }

    setIsResettingPassword(true);
    try {
      const result = await residentForgotPasswordReset(forgotResetToken, forgotNewPassword);
      if (!result.success) {
        Alert.alert('Reset Failed', result.message || 'Failed to change password.');
        return;
      }

      Alert.alert('Password Updated', result.message || 'Your password has been changed successfully. You can now log in.');
      setShowForgotPasswordScreen(false);
      setForgotStep('mobile');
      setForgotMobile('');
      setForgotVerificationCode('');
      setForgotResetToken('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleRegisterBack = () => {
    setShowRegisterScreen(false);
    setShowInitialSplash(true);
  };

  const handleRegisterComplete = () => {
    setCompletedOnboarding(true).catch(() => undefined);
    setShowRegisterScreen(false);
    setShowLoginScreen(true);
    if (onRegister) {
      onRegister();
    }
  };

  const handleRegisterCancel = () => {
    setShowRegisterScreen(false);
    setShowInitialSplash(true);
  };

  const renderSlide = ({ item }: { item: typeof slides[0] }) => {
    const imageSize = Math.min(windowWidth * 0.75, windowHeight * 0.35, 280);
    return (
      <View style={[styles.slide, { width: windowWidth }]}>
        <View style={styles.slideImageWrapper}>
          <Image
            source={item.image}
            style={{ width: imageSize, height: imageSize }}
            resizeMode="contain"
          />
        </View>
        <View style={styles.slideTextWrapper}>
          <Text style={styles.slideText}>{item.text}</Text>
        </View>
      </View>
    );
  };

  // Landing Screen with Logo and Get Started button
  if (showLandingScreen) {
    const logoSize = Math.min(windowWidth * 0.72, windowHeight * 0.35, 260);
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: Math.max(insets.top, 24),
            paddingBottom: Math.max(insets.bottom, 28),
          },
        ]}
      >
        <View style={styles.logoContainer}>
          <Image
            source={require('../assets/logo.png')}
            style={{ width: logoSize, height: logoSize }}
            resizeMode="contain"
          />
        </View>
        <TouchableOpacity
          style={styles.getStartedButton}
          onPress={handleGetStarted}
          activeOpacity={0.85}
        >
          <Text style={styles.getStartedButtonText}>Get Started</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Registration Screen
  if (showRegisterScreen) {
    return (
      <RegisterScreen
        onBack={handleRegisterBack}
        onComplete={handleRegisterComplete}
        onCancel={handleRegisterCancel}
      />
    );
  }

  // Volunteer Login Screen
  if (showVolunteerLoginScreen) {
    return (
      <LoginScreen
        onBack={() => {
          setShowVolunteerLoginScreen(false);
          setShowLoginScreen(true);
        }}
        onLoginSuccess={(user) => {
          setCompletedOnboarding(true).catch(() => undefined);
          if (onVolunteerLogin) {
            onVolunteerLogin(user);
          } else {
            onGetStarted();
          }
        }}
      />
    );
  }

  // Resident Login Screen
  if (showLoginScreen) {
    if (showForgotPasswordScreen) {
      const illustrationSize = Math.min(windowWidth * 0.5, windowHeight * 0.22, 170);
      return (
        <KeyboardAvoidingView
          style={styles.loginKeyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={[
              styles.forgotScrollContent,
              {
                paddingTop: Math.max(insets.top + 12, 24),
                paddingBottom: Math.max(insets.bottom + 16, 24),
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.forgotCard}>
              <TouchableOpacity
                style={styles.forgotBackButton}
                onPress={() => {
                  if (forgotStep === 'reset') {
                    setForgotStep('verification');
                    return;
                  }
                  if (forgotStep === 'verification') {
                    setForgotStep('mobile');
                    return;
                  }
                  setShowForgotPasswordScreen(false);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="arrow-back" size={22} color="#226538" />
              </TouchableOpacity>

              {forgotStep === 'mobile' ? (
                <>
                  <Image
                    source={require('../assets/forgot.png')}
                    style={[styles.forgotIllustration, { width: illustrationSize, height: illustrationSize }]}
                    resizeMode="contain"
                  />

                  <Text style={styles.forgotTitle}>
                    <Text style={styles.welcomeGreen}>Reset </Text>
                    <Text style={styles.welcomeYellow}>Password</Text>
                  </Text>

                  <Text style={styles.forgotSubtitle}>
                    {forgotMethod === 'mobile'
                      ? 'Enter your registered mobile number to receive a 6-digit verification code via SMS.'
                      : 'Enter your registered recovery email to receive a 6-digit verification code.'}
                  </Text>

                  {/* Method Selector */}
                  <View style={styles.forgotMethodContainer}>
                    <TouchableOpacity
                      style={[styles.forgotMethodButton, forgotMethod === 'mobile' && styles.forgotMethodButtonActive]}
                      onPress={() => setForgotMethod('mobile')}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="call-outline"
                        size={15}
                        color={forgotMethod === 'mobile' ? '#226538' : '#6B7280'}
                      />
                      <Text style={[styles.forgotMethodText, forgotMethod === 'mobile' && styles.forgotMethodTextActive]}>
                        Mobile SMS
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.forgotMethodButton, forgotMethod === 'email' && styles.forgotMethodButtonActive]}
                      onPress={() => setForgotMethod('email')}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="mail-outline"
                        size={15}
                        color={forgotMethod === 'email' ? '#226538' : '#6B7280'}
                      />
                      <Text style={[styles.forgotMethodText, forgotMethod === 'email' && styles.forgotMethodTextActive]}>
                        Recovery Email
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {forgotMethod === 'mobile' ? (
                    <View style={styles.forgotInputContainer}>
                      <Ionicons name="call-outline" size={18} color="#888" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="09XXXXXXXXX"
                        placeholderTextColor="#888"
                        value={forgotMobile}
                        onChangeText={(text) => setForgotMobile(text.replace(/\D/g, '').slice(0, 11))}
                        keyboardType="phone-pad"
                        autoCapitalize="none"
                        maxLength={11}
                      />
                    </View>
                  ) : (
                    <View style={styles.forgotInputContainer}>
                      <Ionicons name="mail-outline" size={18} color="#888" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="name@example.com"
                        placeholderTextColor="#888"
                        value={forgotEmail}
                        onChangeText={setForgotEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        maxLength={100}
                      />
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.forgotSendButton, isSendingOtp && styles.forgotSendButtonDisabled]}
                    onPress={handleSendResetCode}
                    disabled={isSendingOtp}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.forgotSendButtonText}>
                      {isSendingOtp
                        ? (forgotMethod === 'mobile' ? 'Sending SMS...' : 'Sending Email...')
                        : (forgotMethod === 'mobile' ? 'Send OTP via SMS' : 'Send OTP via Email')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.forgotBackToLoginLink}
                    onPress={() => setShowForgotPasswordScreen(false)}
                    hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                  >
                    <Text style={styles.forgotBackToLoginText}>
                      Back to <Text style={styles.forgotBackToLoginStrong}>Login</Text>
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {forgotStep === 'verification' ? (
                <>
                  <Image
                    source={require('../assets/forgotp.png')}
                    style={[styles.forgotIllustration, { width: illustrationSize, height: illustrationSize }]}
                    resizeMode="contain"
                  />

                  <Text style={styles.forgotTitle}>
                    <Text style={styles.welcomeGreen}>Reset </Text>
                    <Text style={styles.welcomeYellow}>Password</Text>
                  </Text>

                  <Text style={styles.forgotSubtitle}>
                    {forgotMethod === 'mobile'
                      ? `Enter the 6-digit code sent via SMS to ${forgotMobile}.`
                      : `Enter the 6-digit code sent to your recovery email: ${forgotEmail}.`}
                  </Text>

                  <View style={styles.forgotInputContainer}>
                    <Ionicons name="key-outline" size={18} color="#888" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Enter 6-digit OTP"
                      placeholderTextColor="#888"
                      value={forgotVerificationCode}
                      onChangeText={(text) => setForgotVerificationCode(text.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoCapitalize="none"
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.forgotSendButton, isVerifyingOtp && styles.forgotSendButtonDisabled]}
                    onPress={handleVerifyCode}
                    disabled={isVerifyingOtp}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.forgotSendButtonText}>{isVerifyingOtp ? 'Verifying...' : 'Verify OTP'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ paddingVertical: 8, alignItems: 'center' }}
                    onPress={handleSendResetCode}
                    disabled={isSendingOtp}
                    hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                  >
                    <Text style={{ color: '#226538', fontSize: 13, fontWeight: '600' }}>
                      {isSendingOtp ? 'Resending...' : 'Resend code'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.forgotBackToLoginLink}
                    onPress={() => setShowForgotPasswordScreen(false)}
                    hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                  >
                    <Text style={styles.forgotBackToLoginText}>
                      Back to <Text style={styles.forgotBackToLoginStrong}>Login</Text>
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {forgotStep === 'reset' ? (
                <>
                  <Image
                    source={require('../assets/forgotpa.png')}
                    style={[styles.forgotIllustration, { width: illustrationSize, height: illustrationSize }]}
                    resizeMode="contain"
                  />

                  <Text style={styles.forgotTitle}>
                    <Text style={styles.welcomeGreen}>Reset </Text>
                    <Text style={styles.welcomeYellow}>Password</Text>
                  </Text>

                  <View style={styles.forgotInputContainer}>
                    <Ionicons name="lock-closed-outline" size={18} color="#888" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Enter New Password"
                      placeholderTextColor="#888"
                      value={forgotNewPassword}
                      onChangeText={setForgotNewPassword}
                      secureTextEntry={!showForgotNewPassword}
                      autoCapitalize="none"
                      maxLength={128}
                    />
                    <TouchableOpacity onPress={() => setShowForgotNewPassword(!showForgotNewPassword)} style={styles.eyeIcon}>
                      <Ionicons name={showForgotNewPassword ? 'eye-outline' : 'eye-off-outline'} size={18} color="#888" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.forgotInputContainer}>
                    <Ionicons name="lock-closed-outline" size={18} color="#888" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Confirm Password"
                      placeholderTextColor="#888"
                      value={forgotConfirmPassword}
                      onChangeText={setForgotConfirmPassword}
                      secureTextEntry={!showForgotConfirmPassword}
                      autoCapitalize="none"
                      maxLength={128}
                    />
                    <TouchableOpacity onPress={() => setShowForgotConfirmPassword(!showForgotConfirmPassword)} style={styles.eyeIcon}>
                      <Ionicons name={showForgotConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={18} color="#888" />
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.forgotSendButton, isResettingPassword && styles.forgotSendButtonDisabled]}
                    onPress={handleChangePassword}
                    disabled={isResettingPassword}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.forgotSendButtonText}>
                      {isResettingPassword ? 'Updating...' : 'Change Password'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.forgotBackToLoginLink}
                    onPress={() => setShowForgotPasswordScreen(false)}
                    hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                  >
                    <View style={styles.forgotBackToLoginRow}>
                      <Ionicons name="time-outline" size={13} color="#6B7280" />
                      <Text style={styles.forgotBackToLoginText}>
                        {' '}Back to <Text style={styles.forgotBackToLoginStrong}>Login</Text>
                      </Text>
                    </View>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }

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
          <TouchableOpacity
            style={[
              styles.loginBackButton,
              { top: Math.max(insets.top + 8, Platform.OS === 'ios' ? 44 : 20) },
            ]}
            onPress={() => {
              setShowLoginScreen(false);
              setShowInitialSplash(true);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color="#2E7D32" />
          </TouchableOpacity>

          <View style={styles.welcomeContainer}>
            <Text style={styles.welcomeText}>
              <Text style={styles.welcomeGreen}>Welcome </Text>
              <Text style={styles.welcomeYellow}>Back!</Text>
            </Text>
            <Text style={styles.brandTagline}>Community Relief Platform</Text>
          </View>

          <View style={styles.formContainer}>
            <View style={[styles.inputContainer, isMobileInputFocused && styles.inputContainerFocused]}>
              <Ionicons name="call-outline" size={20} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Mobile (09XXXXXXXXX) or Resident Code"
                placeholderTextColor="#888"
                value={loginIdentifier}
                onChangeText={setLoginIdentifier}
                onFocus={() => setIsMobileInputFocused(true)}
                onBlur={() => setIsMobileInputFocused(false)}
                keyboardType="default"
                autoCapitalize="characters"
                maxLength={30}
              />
            </View>

            <View style={[styles.inputContainer, isPasswordInputFocused && styles.inputContainerFocused]}>
              <Ionicons name="lock-closed-outline" size={20} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#888"
                value={password}
                onChangeText={setPassword}
                onFocus={() => setIsPasswordInputFocused(true)}
                onBlur={() => setIsPasswordInputFocused(false)}
                secureTextEntry={!showPassword}
                maxLength={128}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#888" />
              </TouchableOpacity>
            </View>

            {!!loginError && (
              <Text style={styles.loginErrorText}>{loginError}</Text>
            )}

            <View style={styles.optionsContainer}>
              <View />
              <TouchableOpacity
                onPress={() => {
                  setForgotStep('mobile');
                  setForgotMobile(loginIdentifier);
                  setForgotResetToken('');
                  setForgotVerificationCode('');
                  setForgotNewPassword('');
                  setForgotConfirmPassword('');
                  setShowForgotPasswordScreen(true);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.loginButtonMain, isLoggingIn && styles.loginButtonMainDisabled]}
              onPress={handleLogin}
              disabled={isLoggingIn}
              activeOpacity={0.85}
            >
              <Text style={styles.loginButtonMainText}>{isLoggingIn ? 'Signing In...' : 'Login'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.volunteerLoginSwitch}
              onPress={openVolunteerLoginFromResidentLogin}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Text style={styles.volunteerLoginSwitchText}>Staff account? Sign in here</Text>
            </TouchableOpacity>

            <View style={styles.registerContainer}>
              <Text style={styles.registerPrompt}>Don't have an account? </Text>
              <TouchableOpacity onPress={handleRegister} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.registerLink}>Register</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Initial Login/Registration Screen (shows after onboarding slides)
  if (showInitialSplash) {
    const logoWidth = Math.min(windowWidth * 0.9, 360);
    const logoHeight = Math.min(windowHeight * 0.28, 220);
    return (
      <View
        style={[
          styles.initialSplashContainer,
          {
            paddingTop: Math.max(insets.top, 24),
            paddingBottom: Math.max(insets.bottom, 28),
          },
        ]}
      >
        <View style={styles.initialLogoWrapper}>
          <Image
            source={require('../assets/textual.png')}
            style={{ width: logoWidth, height: logoHeight }}
            resizeMode="contain"
          />
          <Text style={styles.initialSubtitle}>Choose how you want to continue</Text>
        </View>
        <View style={styles.initialButtonsContainer}>
          <TouchableOpacity
            style={styles.initialLoginButton}
            onPress={() => {
              setShowInitialSplash(false);
              setShowLoginScreen(true);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.initialLoginButtonText}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.initialRegisterButton}
            onPress={() => {
              setShowInitialSplash(false);
              setShowRegisterScreen(true);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.initialRegisterButtonText}>Register</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Onboarding Slider (shows after clicking Get Started)
  if (showOnboarding) {
    const isLastSlide = currentIndex === slides.length - 1;

    const handleSkip = () => {
      setCompletedOnboarding(true).catch(() => undefined);
      setShowOnboarding(false);
      setShowInitialSplash(true);
    };

    const handleNext = () => {
      if (currentIndex < slides.length - 1) {
        const nextIndex = currentIndex + 1;
        setCurrentIndex(nextIndex);
        flatListRef.current?.scrollToIndex({
          index: nextIndex,
          animated: true,
        });
      } else {
        handleSkip();
      }
    };

    return (
      <View
        style={[
          styles.onboardingContainer,
          {
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        {/* Top Header with Skip Button */}
        <View style={styles.onboardingHeader}>
          <View style={styles.onboardingHeaderSpacer} />
          {!isLastSlide ? (
            <TouchableOpacity
              style={styles.onboardingSkipButton}
              onPress={handleSkip}
              accessibilityLabel="Skip onboarding"
              hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
            >
              <Text style={styles.onboardingSkipText}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.onboardingSkipPlaceholder} />
          )}
        </View>

        {/* Carousel Slider */}
        <View style={styles.sliderContainer}>
          <FlatList
            ref={flatListRef}
            data={slides}
            renderItem={renderSlide}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews={false}
            getItemLayout={(_, index) => ({
              length: windowWidth,
              offset: windowWidth * index,
              index,
            })}
            snapToInterval={windowWidth}
            snapToAlignment="start"
            decelerationRate="fast"
            style={{ width: windowWidth, flex: 1 }}
          />
        </View>

        {/* Bottom Controls Area (Page Indicator + Action Button) */}
        <View style={styles.onboardingBottomContainer}>
          {/* Pagination Indicators */}
          <View style={styles.pagination}>
            {slides.map((_, index) => {
              const isActive = currentIndex === index;
              return (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    isActive ? styles.activeDot : styles.inactiveDot,
                  ]}
                />
              );
            })}
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={[
              styles.onboardingActionButton,
              isLastSlide && styles.onboardingGetStartedButton,
            ]}
            onPress={handleNext}
            activeOpacity={0.85}
            accessibilityLabel={isLastSlide ? 'Get Started' : 'Next slide'}
          >
            <Text style={styles.onboardingActionButtonText}>
              {isLastSlide ? 'Get Started' : 'Next'}
            </Text>
            <Ionicons
              name={isLastSlide ? 'arrow-forward' : 'chevron-forward'}
              size={18}
              color="#FFFFFF"
              style={styles.onboardingActionIcon}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Fallback
  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loginKeyboardView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loginScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loginBackButton: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
    padding: 6,
  },
  loginContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  onboardingContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  onboardingHeader: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  onboardingHeaderSpacer: {
    width: 48,
  },
  onboardingSkipButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
  },
  onboardingSkipText: {
    color: '#4B5563',
    fontSize: 14,
    fontWeight: '600',
  },
  onboardingSkipPlaceholder: {
    width: 48,
  },
  logoContainer: {
    marginBottom: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  slideImageWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  slideTextWrapper: {
    maxWidth: 340,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideText: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '400',
  },
  onboardingBottomContainer: {
    paddingHorizontal: 32,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  activeDot: {
    width: 26,
    backgroundColor: '#16A34A',
  },
  inactiveDot: {
    width: 8,
    backgroundColor: '#D1D5DB',
  },
  onboardingActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A',
    width: '100%',
    maxWidth: 320,
    paddingVertical: 14,
    borderRadius: 25,
    elevation: 3,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  onboardingGetStartedButton: {
    backgroundColor: '#15803D',
  },
  onboardingActionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  onboardingActionIcon: {
    marginLeft: 6,
  },
  getStartedContainer: {
    paddingHorizontal: 32,
    paddingBottom: 40,
    paddingTop: 20,
    width: '100%',
    alignItems: 'center',
  },
  getStartedButton: {
    backgroundColor: '#16A34A',
    paddingVertical: 15,
    paddingHorizontal: 64,
    borderRadius: 30,
    elevation: 3,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
  },
  getStartedButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
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
    padding: 5,
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: 25,
  },
  forgotText: {
    fontSize: 14,
    color: '#2E7D32',
  },
  forgotScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  forgotCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    alignItems: 'center',
  },
  forgotBackButton: {
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  forgotIllustration: {
    marginBottom: 10,
  },
  forgotTitle: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  forgotSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  forgotInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D8D8D8',
    borderRadius: 8,
    paddingHorizontal: 12,
    width: '100%',
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  forgotMethodContainer: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  forgotMethodButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 7,
    gap: 6,
  },
  forgotMethodButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  forgotMethodText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  forgotMethodTextActive: {
    color: '#226538',
    fontWeight: '700',
  },
  forgotSendButton: {
    backgroundColor: '#226538',
    borderRadius: 10,
    width: '100%',
    paddingVertical: 13,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  forgotSendButtonDisabled: {
    opacity: 0.7,
  },
  forgotSendButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  forgotBackToLoginLink: {
    marginTop: 12,
    paddingVertical: 4,
  },
  forgotBackToLoginRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  forgotBackToLoginText: {
    fontSize: 13,
    color: '#6B7280',
  },
  forgotBackToLoginStrong: {
    color: '#226538',
    fontWeight: '700',
  },
  loginErrorText: {
    color: '#B00020',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  loginButtonMain: {
    backgroundColor: '#2E7D32',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 25,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  loginButtonMainDisabled: {
    opacity: 0.7,
  },
  loginButtonMainText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  volunteerLoginSwitch: {
    alignItems: 'center',
    marginTop: -10,
    marginBottom: 20,
  },
  volunteerLoginSwitchText: {
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerPrompt: {
    fontSize: 14,
    color: '#333',
  },
  registerLink: {
    fontSize: 14,
    color: '#333',
    fontWeight: 'bold',
  },
  initialSplashContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  initialLogoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  initialSubtitle: {
    marginTop: 8,
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
  },
  initialButtonsContainer: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    gap: 12,
  },
  initialLoginButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#2E7D32',
    width: '100%',
    alignItems: 'center',
  },
  initialLoginButtonText: {
    color: '#2E7D32',
    fontSize: 16,
    fontWeight: '700',
  },
  initialRegisterButton: {
    backgroundColor: '#2E7D32',
    paddingVertical: 14,
    borderRadius: 25,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  initialRegisterButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
