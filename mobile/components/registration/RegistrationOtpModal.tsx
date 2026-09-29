import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { smsVerificationService } from '../../services/auth/SmsVerificationService';

interface RegistrationOtpModalProps {
  visible: boolean;
  mobileNumber: string;
  initialOtpToken?: string | null;
  onSuccess: (verifiedToken: string) => void;
  onClose: () => void;
}

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export default function RegistrationOtpModal({
  visible,
  mobileNumber,
  initialOtpToken,
  onSuccess,
  onClose,
}: RegistrationOtpModalProps) {
  const [otpToken, setOtpToken] = useState<string | null>(initialOtpToken || null);
  const [otp, setOtp] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isResending, setIsResending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendSuccessMessage, setResendSuccessMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState<number>(RESEND_COOLDOWN_SECONDS);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  const inputRef = useRef<TextInput>(null);

  // Sync initial otpToken
  useEffect(() => {
    if (initialOtpToken) {
      setOtpToken(initialOtpToken);
    }
  }, [initialOtpToken]);

  // Reset states when modal is opened
  useEffect(() => {
    if (visible) {
      setOtp('');
      setErrorMessage(null);
      setResendSuccessMessage(null);
      setAttemptsLeft(null);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);

      // Auto focus input
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // Resend cooldown timer
  useEffect(() => {
    if (!visible || resendCooldown <= 0) return;

    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [visible, resendCooldown]);

  // Format mobile number for display: 0917 123 4567
  const formatMobileNumber = (num: string): string => {
    const cleaned = num.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
    }
    return num;
  };

  const handleVerify = async (codeToVerify?: string) => {
    const code = (codeToVerify ?? otp).trim();
    if (code.length !== OTP_LENGTH) {
      setErrorMessage(`Please enter all ${OTP_LENGTH} digits.`);
      return;
    }

    if (!otpToken) {
      setErrorMessage('Verification session expired. Please request a new code.');
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);
    setResendSuccessMessage(null);

    try {
      const result = await smsVerificationService.verifyOtp(otpToken, code);

      if (result.success && result.verifiedToken) {
        onSuccess(result.verifiedToken);
      } else {
        const isExpired = result.code === 'OTP_EXPIRED' || result.message?.toLowerCase().includes('expired');
        const isMaxAttempts = result.code === 'MAX_ATTEMPTS' || result.message?.toLowerCase().includes('too many');

        if (isExpired) {
          setErrorMessage('Verification code has expired. Please request a new code.');
          setOtp('');
          setAttemptsLeft(null);
          setResendCooldown(0); // Immediately unlock Resend button
        } else if (isMaxAttempts) {
          setErrorMessage('Too many incorrect attempts. Please request a new code.');
          setOtp('');
          setAttemptsLeft(0);
          setResendCooldown(0); // Immediately unlock Resend button
        } else {
          setErrorMessage(result.message || 'Incorrect verification code. Please try again.');
          if (typeof result.attemptsLeft === 'number') {
            setAttemptsLeft(result.attemptsLeft);
          }
        }
      }
    } catch (err) {
      setErrorMessage('Verification failed. Please check your connection and try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;

    setIsResending(true);
    setErrorMessage(null);
    setResendSuccessMessage(null);
    setOtp('');

    try {
      let result;
      if (otpToken) {
        result = await smsVerificationService.resendOtp(otpToken);
      } else {
        result = await smsVerificationService.sendOtp(mobileNumber);
      }

      if (result.success && result.otpToken) {
        setOtpToken(result.otpToken);
        setResendCooldown(result.expiresInSeconds ? Math.min(60, result.expiresInSeconds) : RESEND_COOLDOWN_SECONDS);
        setResendSuccessMessage('A new verification code has been sent to your number.');
        setAttemptsLeft(null);
      } else {
        setErrorMessage(result.message || 'Failed to resend verification code. Please try again.');
        if ('retryAfterSeconds' in result && typeof result.retryAfterSeconds === 'number') {
          setResendCooldown(result.retryAfterSeconds);
        }
      }
    } catch (err) {
      setErrorMessage('Failed to send new code. Please check your internet connection.');
    } finally {
      setIsResending(false);
      inputRef.current?.focus();
    }
  };

  const handleOtpChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(cleaned);
    setErrorMessage(null);

    // Auto-verify when all digits are entered
    if (cleaned.length === OTP_LENGTH) {
      handleVerify(cleaned);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        inputRef.current?.focus();
      }}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoid}
          >
            <View style={styles.modalCard}>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.iconCircle}>
                  <Ionicons name="chatbubble-ellipses-outline" size={28} color="#2E7D32" />
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="close" size={22} color="#666" />
                </TouchableOpacity>
              </View>

              {/* Title & Description */}
              <Text style={styles.title}>Verify Mobile Number</Text>
              <Text style={styles.description}>
                We sent a 6-digit verification code via SMS to{' '}
                <Text style={styles.phoneNumberHighlight}>{formatMobileNumber(mobileNumber)}</Text>
              </Text>

              {/* OTP Input Section: Visual boxes with direct native TextInput overlay */}
              <View style={styles.otpInputWrapper}>
                {/* 6 Digit Input Boxes Display (underneath, pointerEvents="none") */}
                <View
                  style={styles.otpContainer}
                  pointerEvents="none"
                >
                  {Array.from({ length: OTP_LENGTH }).map((_, index) => {
                    const digit = otp[index] || '';
                    const isCurrent = index === otp.length;
                    const isFilled = index < otp.length;

                    return (
                      <View
                        key={index}
                        style={[
                          styles.otpBox,
                          isFilled && styles.otpBoxFilled,
                          isCurrent && styles.otpBoxActive,
                          errorMessage && styles.otpBoxError,
                        ]}
                      >
                        <Text style={styles.otpDigit}>{digit}</Text>
                      </View>
                    );
                  })}
                </View>

                {/* Real TextInput directly overlaying the boxes */}
                <TextInput
                  ref={inputRef}
                  value={otp}
                  onChangeText={handleOtpChange}
                  keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
                  maxLength={OTP_LENGTH}
                  style={styles.otpOverlayInput}
                  textContentType="oneTimeCode"
                  autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
                  caretHidden={true}
                  selectionColor="transparent"
                />
              </View>

              {/* Status / Error Messages */}
              {errorMessage && (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={18} color="#D32F2F" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}

              {resendSuccessMessage && !errorMessage && (
                <View style={styles.successContainer}>
                  <Ionicons name="checkmark-circle" size={18} color="#2E7D32" />
                  <Text style={styles.successText}>{resendSuccessMessage}</Text>
                </View>
              )}

              {attemptsLeft !== null && attemptsLeft > 0 && !resendSuccessMessage && (
                <Text style={styles.attemptsText}>
                  {attemptsLeft} attempt{attemptsLeft > 1 ? 's' : ''} remaining
                </Text>
              )}

              {/* Verify Button */}
              <TouchableOpacity
                style={[
                  styles.verifyButton,
                  (otp.length !== OTP_LENGTH || isVerifying) && styles.verifyButtonDisabled,
                ]}
                onPress={() => handleVerify()}
                disabled={otp.length !== OTP_LENGTH || isVerifying}
              >
                {isVerifying ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Text style={styles.verifyButtonText}>Verify & Continue</Text>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
                  </>
                )}
              </TouchableOpacity>

              {/* Resend & Edit Number Actions */}
              <View style={styles.footerActions}>
                <TouchableOpacity
                  style={styles.resendButton}
                  onPress={handleResend}
                  disabled={resendCooldown > 0 || isResending}
                >
                  {isResending ? (
                    <ActivityIndicator size="small" color="#2E7D32" />
                  ) : (
                    <Text
                      style={[
                        styles.resendText,
                        resendCooldown > 0 && styles.resendTextDisabled,
                      ]}
                    >
                      {resendCooldown > 0
                        ? `Resend code in ${resendCooldown}s`
                        : "Didn't receive code? Resend"}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.changeNumberButton}
                  onPress={onClose}
                >
                  <Text style={styles.changeNumberText}>Change mobile number</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  keyboardAvoid: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 20,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    padding: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  phoneNumberHighlight: {
    fontWeight: '700',
    color: '#1A1A1A',
  },
  otpInputWrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 18,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
  },
  otpOverlayInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.01,
    color: 'transparent',
  },
  otpBox: {
    flex: 1,
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpBoxFilled: {
    borderColor: '#81C784',
    backgroundColor: '#F1F8E9',
  },
  otpBoxActive: {
    borderColor: '#2E7D32',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
  },
  otpBoxError: {
    borderColor: '#E53935',
    backgroundColor: '#FFEBEE',
  },
  otpDigit: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 14,
    width: '100%',
    gap: 6,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 14,
    width: '100%',
    gap: 6,
  },
  successText: {
    color: '#2E7D32',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  attemptsText: {
    fontSize: 12,
    color: '#D32F2F',
    marginBottom: 12,
    fontWeight: '600',
  },
  verifyButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#2E7D32',
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  verifyButtonDisabled: {
    backgroundColor: '#A5D6A7',
  },
  verifyButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  footerActions: {
    alignItems: 'center',
    gap: 12,
  },
  resendButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  resendText: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '600',
  },
  resendTextDisabled: {
    color: '#9E9E9E',
  },
  changeNumberButton: {
    paddingVertical: 4,
  },
  changeNumberText: {
    fontSize: 13,
    color: '#666666',
    textDecorationLine: 'underline',
  },
});
