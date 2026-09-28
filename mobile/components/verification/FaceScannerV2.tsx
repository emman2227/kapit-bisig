/**
 * FaceScannerV2 Component
 * 
 * Camera and Face Verification Workflow:
 * 
 * 1. Camera preview is shown to user
 * 2. User taps "Capture" button to take photo
 * 3. Camera preview is hidden, captured image is displayed
 * 4. Loading indicator shown ("Analyzing face...")
 * 5. Image sent to backend (OpenCV)
 * 6. Backend analyzes:
 *    - Face detected?
 *    - Only one face?
 *    - Image quality acceptable?
 *    - Face matches registered data? (verify mode)
 * 7. Result displayed (Verified / Not Recognized / Invalid)
 * 8. User can retry if needed
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
  Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { resolveOptionalApiBaseUrl } from '../../services/config/apiSecurity';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FACE_FRAME_SIZE = SCREEN_WIDTH * 0.75;

// ============================================
// TYPES
// ============================================

interface FaceVerifyResponse {
  verified: boolean;
  user_id?: string;
  name?: string;
  confidence: number;
  message: string;
}

interface FaceAnalysisResult {
  success: boolean;
  has_face: boolean;
  face_count: number;
  is_centered: boolean;
  face_size_ok: boolean;
  is_real_image: boolean;
  image_quality: 'good' | 'blurry' | 'too_dark' | 'too_bright' | 'error';
  is_valid: boolean;
  message: string;
  validation_details?: {
    blur_score?: number;
    brightness?: number;
    liveness?: {
      confidence: number;
      liveness_score: number;
    };
  };
}

interface FaceScannerV2Props {
  visible: boolean;
  mode: 'register' | 'verify';
  onComplete: (result: FaceVerifyResponse, imageUri?: string) => void;
  onCancel: () => void;
  apiBaseUrl?: string;
  // For registration mode
  userId?: string;
  userName?: string;
}

// Workflow phases:
// 'camera'    - Live camera preview shown, waiting for capture
// 'captured'  - Photo taken, showing captured image + analyzing
// 'verified'  - Backend returned success (face matched/registered)
// 'not_recognized' - Backend returned face not in database (verify mode)
// 'invalid'   - Backend returned invalid image (no face, multiple faces, bad quality)
type WorkflowPhase = 'camera' | 'captured' | 'verified' | 'not_recognized' | 'invalid';

// ============================================
// MAIN COMPONENT
// ============================================

export default function FaceScannerV2({
  visible,
  mode,
  onComplete,
  onCancel,
  apiBaseUrl = resolveOptionalApiBaseUrl(
    process.env.EXPO_PUBLIC_FACE_API_URL,
    'https://kapit-bisig.onrender.com',
    'FaceScannerV2',
  ) ?? undefined,
  userId,
  userName,
}: FaceScannerV2Props) {
  // Camera permission
  const [permission, requestPermission] = useCameraPermissions();

  // Workflow state
  const [phase, setPhase] = useState<WorkflowPhase>('camera');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBase64, setCapturedBase64] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [result, setResult] = useState<FaceVerifyResponse | null>(null);

  // Refs
  const cameraRef = useRef<CameraView>(null);

  // ============================================
  // RESET WORKFLOW
  // ============================================

  const resetWorkflow = useCallback(() => {
    setPhase('camera');
    setIsAnalyzing(false);
    setCapturedImage(null);
    setCapturedBase64(null);
    setErrorMessage('');
    setResult(null);
  }, []);

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      resetWorkflow();
    }
  }, [visible, resetWorkflow]);

  // Request camera permission
  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission();
    }
  }, [visible, permission]);

  // ============================================
  // STEP 2: CAPTURE PHOTO
  // ============================================

  const handleCapture = async () => {
    if (!cameraRef.current || isAnalyzing) return;

    try {
      // Take photo
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
        skipProcessing: Platform.OS === 'android',
      });

      if (!photo || !photo.base64) {
        throw new Error('Failed to capture photo');
      }

      // STEP 3: Show captured image (hide camera)
      setCapturedImage(photo.uri);
      setCapturedBase64(photo.base64);
      setPhase('captured');

      // STEP 4-5: Start backend analysis
      setIsAnalyzing(true);
      await analyzeWithBackend(photo.base64, photo.uri);

    } catch (error: any) {
      console.error('Capture error:', error);
      setPhase('invalid');
      setErrorMessage(error.message || 'Failed to capture photo');
      setIsAnalyzing(false);
    }
  };

  // ============================================
  // STEP 5-7: BACKEND ANALYSIS (OpenCV)
  // ============================================

  const analyzeWithBackend = async (base64Image: string, imageUri: string) => {
    try {
      if (!apiBaseUrl) {
        setPhase('invalid');
        setErrorMessage('Face recognition service is not configured or currently unavailable.');
        setIsAnalyzing(false);
        return;
      }

      // STEP 6a: Send to backend for face detection & quality check
      const detectResponse = await fetch(`${apiBaseUrl}/api/face/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
      });

      if (!detectResponse.ok) {
        const errorData = await detectResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Server error during face analysis');
      }

      const detectResult: FaceAnalysisResult = await detectResponse.json();

      // STEP 6b: Check detection results - Invalid Image cases
      if (!detectResult.has_face) {
        setPhase('invalid');
        setErrorMessage('No face detected in the image');
        setIsAnalyzing(false);
        return;
      }

      if (detectResult.face_count > 1) {
        setPhase('invalid');
        setErrorMessage(`Multiple faces detected (${detectResult.face_count}). Only one face allowed.`);
        setIsAnalyzing(false);
        return;
      }

      // Check image quality
      if (detectResult.image_quality === 'blurry') {
        setPhase('invalid');
        setErrorMessage('Image is too blurry. Please hold steady.');
        setIsAnalyzing(false);
        return;
      }

      if (detectResult.image_quality === 'too_dark') {
        setPhase('invalid');
        setErrorMessage('Image is too dark. Move to better lighting.');
        setIsAnalyzing(false);
        return;
      }

      if (detectResult.image_quality === 'too_bright') {
        setPhase('invalid');
        setErrorMessage('Image is too bright. Avoid direct light.');
        setIsAnalyzing(false);
        return;
      }

      // Check face centering inside oval indicator
      if (!detectResult.is_centered) {
        setPhase('invalid');
        setErrorMessage(detectResult.message || 'Please align and center your face inside the oval indicator.');
        setIsAnalyzing(false);
        return;
      }

      // Check face size inside oval indicator
      if (!detectResult.face_size_ok) {
        setPhase('invalid');
        setErrorMessage(detectResult.message || 'Please adjust your distance so your face fits inside the oval.');
        setIsAnalyzing(false);
        return;
      }

      // Check liveness (anti-spoofing)
      if (!detectResult.is_real_image || !detectResult.is_valid) {
        setPhase('invalid');
        setErrorMessage(detectResult.message || 'Spoofing detected: please use your real face, not a photo or screen.');
        setIsAnalyzing(false);
        return;
      }

      // STEP 6c: Face detected & quality OK - now verify/register
      const endpoint = mode === 'verify'
        ? `${apiBaseUrl}/api/face/verify`
        : `${apiBaseUrl}/api/face/register`;

      const body = mode === 'verify'
        ? { image: base64Image }
        : { image: base64Image, user_id: userId, name: userName };

      const processResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!processResponse.ok) {
        const errorData = await processResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Verification failed');
      }

      const data = await processResponse.json();

      // STEP 7: Handle result
      if (mode === 'verify') {
        if (data.verified) {
          // VERIFIED - Face matched
          setPhase('verified');
          setResult(data);

          // Auto-complete after showing result
          setTimeout(() => {
            onComplete(data, imageUri);
          }, 2500);
        } else {
          // NOT RECOGNIZED - Face not in database
          setPhase('not_recognized');
          setResult(data);
        }
      } else {
        // REGISTRATION mode
        const regResult: FaceVerifyResponse = {
          verified: data.success,
          user_id: data.user_id,
          confidence: 100,
          message: data.message || 'Face registered successfully',
        };

        if (data.success) {
          setPhase('verified');
          setResult(regResult);

          setTimeout(() => {
            onComplete(regResult, imageUri);
          }, 2500);
        } else {
          setPhase('invalid');
          setErrorMessage(data.message || 'Registration failed');
        }
      }

    } catch (error: any) {
      console.error('Backend analysis error:', error);
      setPhase('invalid');
      setErrorMessage(error.message || 'Analysis failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ============================================
  // STEP 8: RETRY
  // ============================================

  const handleRetry = () => {
    resetWorkflow();
  };

  // ============================================
  // RENDER: Permission Request
  // ============================================

  if (!permission?.granted) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color="#2E7D32" />
          <Text style={styles.permissionTitle}>Camera Permission Required</Text>
          <Text style={styles.permissionText}>
            Please allow camera access for face {mode === 'verify' ? 'verification' : 'registration'}
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // ============================================
  // GET STATUS INFO
  // ============================================

  const getStatusInfo = () => {
    switch (phase) {
      case 'camera':
        return {
          text: 'Position your face in the frame',
          color: 'rgba(255, 255, 255, 0.6)',
          icon: null,
          bgColor: 'rgba(0,0,0,0.7)',
        };
      case 'captured':
        return {
          text: 'Analyzing face...',
          color: '#FFC107',
          icon: 'hourglass',
          bgColor: 'rgba(255, 193, 7, 0.9)',
        };
      case 'verified':
        return {
          text: mode === 'verify'
            ? `Verified${result?.name ? `: ${result.name}` : '!'}`
            : 'Face captured successfully!',
          color: '#00C853',
          icon: 'checkmark-circle',
          bgColor: 'rgba(0, 200, 83, 0.9)',
        };
      case 'not_recognized':
        return {
          text: 'Face not recognized',
          color: '#FF9800',
          icon: 'help-circle',
          bgColor: 'rgba(255, 152, 0, 0.9)',
        };
      case 'invalid':
        return {
          text: errorMessage || 'Invalid image',
          color: '#FF5252',
          icon: 'close-circle',
          bgColor: 'rgba(255, 82, 82, 0.9)',
        };
      default:
        return {
          text: '',
          color: '#FFF',
          icon: null,
          bgColor: 'rgba(0,0,0,0.7)',
        };
    }
  };

  const statusInfo = getStatusInfo();

  // ============================================
  // RENDER: Main UI
  // ============================================

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>

        {/* ===== STEP 1 & 3: Camera Preview OR Captured Image ===== */}
        {phase === 'camera' ? (
          // STEP 1: Live camera preview
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="front"
            mirror={true}
          />
        ) : (
          // STEP 3: Captured image displayed (camera hidden)
          <Image
            source={{ uri: capturedImage || '' }}
            style={styles.capturedImage}
          />
        )}

        {/* Overlay */}
        <View style={styles.overlay}>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onCancel}
              disabled={isAnalyzing}
            >
              <Ionicons name="close" size={28} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {mode === 'verify' ? 'Face Verification' : 'Face Capture'}
            </Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Face Frame Guide */}
          <View style={styles.faceFrameContainer}>
            <View style={[styles.faceFrame, { borderColor: statusInfo.color }]}>
              {/* Corner indicators */}
              <View style={[styles.corner, styles.topLeft, { borderColor: statusInfo.color }]} />
              <View style={[styles.corner, styles.topRight, { borderColor: statusInfo.color }]} />
              <View style={[styles.corner, styles.bottomLeft, { borderColor: statusInfo.color }]} />
              <View style={[styles.corner, styles.bottomRight, { borderColor: statusInfo.color }]} />

              {/* ===== STEP 4: Loading indicator while analyzing ===== */}
              {phase === 'captured' && isAnalyzing && (
                <View style={styles.analyzingContainer}>
                  <ActivityIndicator size="large" color="#FFF" />
                  <Text style={styles.analyzingText}>Analyzing face...</Text>
                </View>
              )}

              {/* STEP 7: Result icons */}
              {phase === 'verified' && (
                <Ionicons name="checkmark-circle" size={80} color="#00C853" />
              )}
              {phase === 'not_recognized' && (
                <Ionicons name="help-circle" size={80} color="#FF9800" />
              )}
              {phase === 'invalid' && (
                <Ionicons name="close-circle" size={80} color="#FF5252" />
              )}
            </View>
          </View>

          {/* Status Badge */}
          <View style={styles.statusContainer}>
            <View style={[styles.statusBadge, { backgroundColor: statusInfo.bgColor }]}>
              {phase === 'captured' && isAnalyzing && (
                <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 8 }} />
              )}
              {statusInfo.icon && phase !== 'captured' && (
                <Ionicons
                  name={statusInfo.icon as any}
                  size={20}
                  color="#FFF"
                  style={{ marginRight: 8 }}
                />
              )}
              <Text style={styles.statusText}>{statusInfo.text}</Text>
            </View>
          </View>

          {/* Tips - only when camera is active */}
          {phase === 'camera' && (
            <View style={styles.tipsContainer}>
              <Text style={styles.tipTitle}>Tips for best results:</Text>
              <Text style={styles.tipText}>• Face the camera directly</Text>
              <Text style={styles.tipText}>• Good lighting on your face</Text>
              <Text style={styles.tipText}>• Remove glasses or hats</Text>
            </View>
          )}

          {/* ===== STEP 2: Capture Button ===== */}
          <View style={styles.buttonContainer}>
            {phase === 'camera' && (
              <TouchableOpacity
                style={styles.captureButton}
                onPress={handleCapture}
                activeOpacity={0.7}
              >
                <View style={styles.captureButtonOuter}>
                  <View style={styles.captureButtonInner}>
                    <Ionicons name="camera" size={32} color="#FFF" />
                  </View>
                </View>
                <Text style={styles.captureButtonLabel}>Capture</Text>
              </TouchableOpacity>
            )}

            {/* ===== STEP 8: Retry Button ===== */}
            {(phase === 'invalid' || phase === 'not_recognized') && (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetry}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh" size={24} color="#FFF" />
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            )}

            {/* Result details */}
            {phase === 'verified' && result && (
              <View style={styles.resultContainer}>
                {result.name && (
                  <Text style={styles.resultName}>{result.name}</Text>
                )}
                {result.confidence > 0 && (
                  <Text style={styles.resultConfidence}>
                    {result.confidence.toFixed(0)}% confidence
                  </Text>
                )}
                <Text style={styles.resultNote}>Closing automatically...</Text>
              </View>
            )}

            {phase === 'not_recognized' && (
              <View style={styles.resultContainer}>
                <Text style={styles.resultNote}>
                  This face is not registered in our system.
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  capturedImage: {
    flex: 1,
    resizeMode: 'cover',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingHorizontal: 16,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },

  // Face Frame
  faceFrameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceFrame: {
    width: FACE_FRAME_SIZE,
    height: FACE_FRAME_SIZE * 1.2,
    borderRadius: FACE_FRAME_SIZE * 0.4,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
  },
  topLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: 20,
  },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 20,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 20,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: 20,
  },

  // Analyzing state
  analyzingContainer: {
    alignItems: 'center',
  },
  analyzingText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 12,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },

  // Status Badge
  statusContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    maxWidth: SCREEN_WIDTH - 40,
  },
  statusText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    flexShrink: 1,
  },

  // Tips
  tipsContainer: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    marginHorizontal: 30,
    marginBottom: 20,
    padding: 15,
    borderRadius: 12,
  },
  tipTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  tipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginVertical: 2,
  },

  // Buttons
  buttonContainer: {
    alignItems: 'center',
    marginBottom: 40,
    minHeight: 120,
  },
  captureButton: {
    alignItems: 'center',
  },
  captureButtonOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#2E7D32',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonLabel: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2E7D32',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 30,
  },
  retryButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },

  // Result
  resultContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  resultName: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    marginBottom: 8,
  },
  resultConfidence: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
  },
  resultNote: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },

  // Permission Screen
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    padding: 30,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginTop: 20,
    marginBottom: 10,
  },
  permissionText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  permissionButton: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  permissionButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: 30,
    paddingVertical: 15,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
});



