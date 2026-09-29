import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mobileAuthService } from '../services/auth/MobileAuthService';
import { validateEmail, cleanEmailInput, MAX_EMAIL_LENGTH } from '../utils/emailValidation';

type RecoveryStep = 'email' | 'otp' | 'password' | 'done';

interface Props {
  initialEmail?: string;
  onBack: () => void;
}

function validateStrongPassword(value: string): string | null {
  if (value.length < 8) return 'Use at least 8 characters.';
  if (/\s/.test(value)) return 'Password cannot contain spaces.';
  if (!/[A-Z]/.test(value)) return 'Add an uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Add a lowercase letter.';
  if (!/[0-9]/.test(value)) return 'Add a number.';
  if (!/[!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~\\]/.test(value)) return 'Add a special character.';
  return null;
}

export default function StaffForgotPasswordScreen({ initialEmail = '', onBack }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<RecoveryStep>('email');
  const [email, setEmail] = useState(initialEmail.trim().toLowerCase());
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (step === 'email') {
      const emailCheck = validateEmail(email);
      if (!emailCheck.isValid) {
        setError(emailCheck.error || 'Please enter a valid email address.');
        return;
      }
      setLoading(true);
      const response = await mobileAuthService.requestPasswordReset(email);
      setLoading(false);
      if (!response.success) return setError(response.message || 'Unable to send reset code.');
      setStep('otp');
      return;
    }

    if (step === 'otp') {
      if (!/^\d{6}$/.test(otp)) {
        setError('Enter the 6-digit code from your email.');
        return;
      }
      setLoading(true);
      const response = await mobileAuthService.verifyPasswordResetOtp(email, otp);
      setLoading(false);
      if (!response.success || !response.resetToken) {
        const isExpired = response.code === 'OTP_EXPIRED' || response.message?.toLowerCase().includes('expired');
        const isMaxAttempts = response.code === 'MAX_ATTEMPTS' || response.message?.toLowerCase().includes('too many');

        if (isExpired) {
          setOtp('');
          return setError('Verification code has expired. Please request a new code.');
        }
        if (isMaxAttempts) {
          setOtp('');
          return setError('Too many incorrect attempts. Please request a new code.');
        }
        return setError(response.message || 'Incorrect verification code. Please try again.');
      }
      setResetToken(response.resetToken);
      setStep('password');
      return;
    }

    if (step === 'password') {
      const passwordError = validateStrongPassword(password);
      if (passwordError) return setError(passwordError);
      if (password !== confirmPassword) return setError('Passwords do not match.');
      setLoading(true);
      const response = await mobileAuthService.resetPassword(resetToken, password);
      setLoading(false);
      if (!response.success) return setError(response.message || 'Unable to reset password.');
      setStep('done');
    }
  };

  const resend = async () => {
    setLoading(true);
    setError(null);
    const response = await mobileAuthService.requestPasswordReset(email);
    setLoading(false);
    if (!response.success) setError(response.message || 'Unable to resend code.');
  };

  const illustration = step === 'email'
    ? require('../assets/forgot.png')
    : step === 'otp'
      ? require('../assets/forgotp.png')
      : require('../assets/forgotpa.png');

  const illustrationSize = Math.min(screenWidth * 0.52, screenHeight * 0.22, 170);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top + 16, 24),
            paddingBottom: Math.max(insets.bottom + 20, 24),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <TouchableOpacity
            onPress={onBack}
            disabled={loading}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color="#226538" />
          </TouchableOpacity>

          <Image
            source={illustration}
            style={[styles.illustration, { width: illustrationSize, height: illustrationSize }]}
            resizeMode="contain"
          />

          <Text style={styles.title}>
            <Text style={styles.titleGreen}>{step === 'done' ? 'Password ' : 'Reset '}</Text>
            <Text style={styles.titleYellow}>{step === 'done' ? 'Updated' : 'Password'}</Text>
          </Text>

          <Text style={styles.subtitle}>
            {step === 'email' && 'Enter the email address connected to your staff account.'}
            {step === 'otp' && ('Enter the 6-digit code sent to ' + email + '.')}
            {step === 'password' && 'Create a new password for your staff mobile account.'}
            {step === 'done' && 'You can now sign in with your new password.'}
          </Text>

          {step === 'email' && (
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={18} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                maxLength={MAX_EMAIL_LENGTH}
                onChangeText={(text) => setEmail(cleanEmailInput(text))}
                placeholder="Email Address"
                placeholderTextColor="#888"
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!loading}
              />
            </View>
          )}
          {step === 'otp' && (
            <View style={styles.inputContainer}>
              <Ionicons name="key-outline" size={18} color="#888" style={styles.inputIcon} />
              <TextInput
                style={[styles.input, styles.otp]}
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit OTP"
                placeholderTextColor="#888"
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
              />
            </View>
          )}
          {step === 'password' && (
            <>
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={18} color="#888" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="New Password"
                  placeholderTextColor="#888"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowPassword((value) => !value)} style={styles.eye}>
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={18} color="#888" />
                </TouchableOpacity>
              </View>
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={18} color="#888" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm Password"
                  placeholderTextColor="#888"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!loading}
                />
              </View>
              <Text style={styles.hint}>8+ characters with uppercase, lowercase, number, and special character.</Text>
            </>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          {step !== 'done' && (
            <TouchableOpacity style={[styles.primary, loading && styles.disabled]} onPress={submit} disabled={loading}>
              {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{step === 'email' ? 'Send OTP' : step === 'otp' ? 'Verify OTP' : 'Reset Password'}</Text>}
            </TouchableOpacity>
          )}

          {step === 'otp' && (
            <TouchableOpacity onPress={resend} disabled={loading} style={styles.linkButton}>
              <Text style={styles.link}>Resend code</Text>
            </TouchableOpacity>
          )}
          {step === 'done' ? (
            <TouchableOpacity onPress={onBack} disabled={loading} style={styles.primary}>
              <Text style={styles.primaryText}>Return to Login</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onBack} disabled={loading} style={styles.backToLoginLink}>
              <Text style={styles.backToLoginText}>
                Back to <Text style={styles.backToLoginStrong}>Login</Text>
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 40,
    paddingBottom: 30,
  },
  card: {
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
  backButton: {
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  illustration: {
    marginBottom: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  titleGreen: { color: '#2E7D32' },
  titleYellow: { color: '#ECC323' },
  subtitle: {
    marginBottom: 18,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  inputContainer: {
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
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: '#333333',
    fontSize: 16,
  },
  otp: { letterSpacing: 2, fontWeight: '600' },
  eye: { padding: 5 },
  hint: {
    width: '100%',
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 16,
  },
  error: { color: '#B00020', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  primary: {
    backgroundColor: '#226538',
    borderRadius: 10,
    width: '100%',
    minHeight: 46,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.6 },
  linkButton: { alignItems: 'center', paddingVertical: 12 },
  link: { color: '#226538', fontWeight: '700', fontSize: 13 },
  backToLoginLink: { marginTop: 12, paddingVertical: 4 },
  backToLoginText: { fontSize: 13, color: '#6B7280' },
  backToLoginStrong: { color: '#226538', fontWeight: '700' },
});
