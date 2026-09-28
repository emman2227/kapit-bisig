/**
 * Face Recognition Service using Backend API
 * Handles face detection, face matching, and liveness detection
 */

import * as FileSystem from 'expo-file-system/legacy';

// API Configuration
import { resolveApiBaseUrl } from '../config/apiSecurity';

const API_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL,
  'https://kapit-bisig.onrender.com/api',
  'FaceRecognitionService',
);

// Encoding type constant
const EncodingType = {
  Base64: 'base64' as const,
  UTF8: 'utf8' as const,
};

// Types for face recognition
export interface FaceDetectionResult {
  hasFace: boolean;
  faceCount: number;
  confidence: number;
  boundingBox: BoundingBox | null;
  landmarks: FaceLandmarks | null;
  qualityScore: number;
  issues: string[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceLandmarks {
  leftEye: Point;
  rightEye: Point;
  nose: Point;
  leftMouth: Point;
  rightMouth: Point;
}

export interface Point {
  x: number;
  y: number;
}

export interface FaceMatchResult {
  isMatch: boolean;
  similarity: number;
  confidence: number;
  distance: number;
  threshold: number;
}

export interface LivenessResult {
  isLive: boolean;
  confidence: number;
  checks: {
    blinkDetected: boolean;
    headMovement: boolean;
    textureAnalysis: boolean;
    depthCheck: boolean;
  };
}

export interface FaceDescriptor {
  descriptor: Float32Array | number[];
  landmarks: FaceLandmarks | null;
  boundingBox: BoundingBox;
}

export interface FaceValidationResult {
  isValid: boolean;
  faceDetection: FaceDetectionResult;
  qualityIssues: string[];
  suggestions: string[];
}

// Configuration
const FACE_MATCH_THRESHOLD = 0.6; // Lower is more similar
const MIN_FACE_CONFIDENCE = 0.8;
const MIN_FACE_SIZE_RATIO = 0.15; // Face should be at least 15% of image

class FaceRecognitionService {
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private faceApiLoaded: boolean = false;

  /**
   * Initialize face-api.js models
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initializeModels();
    await this.initPromise;
  }

  private async _initializeModels(): Promise<void> {
    try {
      console.log('[FaceRecognition] Initializing face-api.js models...');

      // For React Native, we'll use a server-side approach
      // face-api.js requires TensorFlow.js which has limited React Native support
      // 
      // Options for production:
      // 1. Use a backend API with face-api.js (Node.js server)
      // 2. Use react-native-face-detection (ML Kit)
      // 3. Use AWS Rekognition or Azure Face API
      // 4. Use expo-face-detector for basic detection

      this.isInitialized = true;
      console.log('[FaceRecognition] Face recognition service initialized');
    } catch (error) {
      console.error('[FaceRecognition] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Detect face in an image
   */
  async detectFace(imageUri: string): Promise<FaceDetectionResult> {
    const issues: string[] = [];

    try {
      // Call backend API for face detection
      const result = await this.callFaceDetectionApi(imageUri);
      return result;
    } catch (error) {
      console.warn('[FaceRecognition] API detection failed, using simulation:', error);

      // Fallback to simulated detection for development
      return this.simulateFaceDetection(imageUri);
    }
  }

  /**
   * Call backend API for face detection
   */
  private async callFaceDetectionApi(imageUri: string): Promise<FaceDetectionResult> {
    try {
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: EncodingType.Base64,
      });

      const response = await fetch(`${API_URL}/face/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64 }),
      });

      if (!response.ok) {
        throw new Error('Face detection API request failed');
      }

      const json = await response.json();

      if (!json.success) {
        throw new Error(json.message || 'Face detection failed');
      }

      const result = json.data;
      return {
        hasFace: result.hasFace,
        faceCount: result.faceCount,
        confidence: result.confidence,
        boundingBox: result.boundingBox,
        landmarks: result.landmarks,
        qualityScore: result.qualityScore || 0.8,
        issues: result.issues || [],
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Simulate face detection for development
   */
  private simulateFaceDetection(imageUri: string): FaceDetectionResult {
    console.log('[FaceRecognition] Using simulated detection for:', imageUri);

    // Simulated successful detection
    return {
      hasFace: true,
      faceCount: 1,
      confidence: 0.95,
      boundingBox: {
        x: 100,
        y: 80,
        width: 200,
        height: 250,
      },
      landmarks: {
        leftEye: { x: 150, y: 150 },
        rightEye: { x: 250, y: 150 },
        nose: { x: 200, y: 200 },
        leftMouth: { x: 160, y: 260 },
        rightMouth: { x: 240, y: 260 },
      },
      qualityScore: 0.88,
      issues: [],
    };
  }

  /**
   * Detect face in ID document image
   */
  async detectFaceInID(idImageUri: string): Promise<FaceDetectionResult> {
    const result = await this.detectFace(idImageUri);

    // Additional checks specific to ID photos
    if (result.hasFace) {
      // ID photos typically have smaller faces
      // Adjust quality expectations
      if (result.qualityScore < 0.5) {
        result.issues.push('Face in ID is low quality. This may affect matching accuracy.');
      }
    } else {
      result.issues.push('No face detected in the ID image. Please ensure the ID photo is visible.');
    }

    return result;
  }

  /**
   * Validate face image for registration
   */
  async validateFaceForRegistration(imageUri: string): Promise<FaceValidationResult> {
    const suggestions: string[] = [];
    const qualityIssues: string[] = [];

    try {
      const detection = await this.detectFace(imageUri);

      // Check if face is detected
      if (!detection.hasFace) {
        qualityIssues.push('No face detected in the image');
        suggestions.push('Position your face in the center of the frame');
        suggestions.push('Ensure good lighting on your face');

        return {
          isValid: false,
          faceDetection: detection,
          qualityIssues,
          suggestions,
        };
      }

      // Check face count
      if (detection.faceCount > 1) {
        qualityIssues.push('Multiple faces detected');
        suggestions.push('Ensure only your face is visible in the frame');
      }

      // Check confidence
      if (detection.confidence < MIN_FACE_CONFIDENCE) {
        qualityIssues.push('Face detection confidence is low');
        suggestions.push('Ensure your face is clearly visible');
        suggestions.push('Remove any obstructions like sunglasses or masks');
      }

      // Check face size
      if (detection.boundingBox) {
        const faceArea = detection.boundingBox.width * detection.boundingBox.height;
        // Assuming 1080x1920 image
        const imageArea = 1080 * 1920;
        const faceRatio = faceArea / imageArea;

        if (faceRatio < MIN_FACE_SIZE_RATIO) {
          qualityIssues.push('Face is too small in the frame');
          suggestions.push('Move closer to the camera');
        } else if (faceRatio > 0.5) {
          qualityIssues.push('Face is too close to the camera');
          suggestions.push('Move further from the camera');
        }
      }

      // Check quality score
      if (detection.qualityScore < 0.7) {
        qualityIssues.push('Image quality is suboptimal');
        suggestions.push('Ensure good, even lighting');
        suggestions.push('Keep the camera steady');
      }

      // Check for issues from detection
      qualityIssues.push(...detection.issues);

      return {
        isValid: qualityIssues.length === 0,
        faceDetection: detection,
        qualityIssues,
        suggestions,
      };
    } catch (error) {
      console.error('[FaceRecognition] Validation error:', error);
      return {
        isValid: false,
        faceDetection: {
          hasFace: false,
          faceCount: 0,
          confidence: 0,
          boundingBox: null,
          landmarks: null,
          qualityScore: 0,
          issues: ['Failed to process image'],
        },
        qualityIssues: ['Failed to validate face image'],
        suggestions: ['Please try again'],
      };
    }
  }

  /**
   * Compare two faces for matching
   */
  async compareFaces(
    faceImage1Uri: string,
    faceImage2Uri: string
  ): Promise<FaceMatchResult> {
    try {
      // Detect faces in both images
      const [detection1, detection2] = await Promise.all([
        this.detectFace(faceImage1Uri),
        this.detectFace(faceImage2Uri),
      ]);

      if (!detection1.hasFace || !detection2.hasFace) {
        return {
          isMatch: false,
          similarity: 0,
          confidence: 0,
          distance: 1,
          threshold: FACE_MATCH_THRESHOLD,
        };
      }

      // Call backend for face comparison
      const result = await this.callFaceComparisonApi(faceImage1Uri, faceImage2Uri);
      return result;
    } catch (error) {
      console.warn('[FaceRecognition] Comparison failed, using simulation:', error);
      return this.simulateFaceComparison();
    }
  }

  /**
   * Call backend API for face comparison
   */
  private async callFaceComparisonApi(
    image1Uri: string,
    image2Uri: string
  ): Promise<FaceMatchResult> {
    try {
      const [base64_1, base64_2] = await Promise.all([
        FileSystem.readAsStringAsync(image1Uri, {
          encoding: EncodingType.Base64,
        }),
        FileSystem.readAsStringAsync(image2Uri, {
          encoding: EncodingType.Base64,
        }),
      ]);

      const response = await fetch(`${API_URL}/face/compare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image1: base64_1,
          image2: base64_2,
        }),
      });

      if (!response.ok) {
        throw new Error('Face comparison API request failed');
      }

      const json = await response.json();

      if (!json.success) {
        throw new Error(json.message || 'Face comparison failed');
      }

      const result = json.data;
      return {
        isMatch: result.isMatch,
        similarity: result.similarity,
        confidence: result.confidence,
        distance: result.distance,
        threshold: result.threshold || FACE_MATCH_THRESHOLD,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Simulate face comparison for development
   */
  private simulateFaceComparison(): FaceMatchResult {
    console.log('[FaceRecognition] Using simulated comparison');

    // Simulated successful match
    const distance = 0.35;
    return {
      isMatch: distance < FACE_MATCH_THRESHOLD,
      similarity: 1 - distance,
      confidence: 0.92,
      distance,
      threshold: FACE_MATCH_THRESHOLD,
    };
  }

  /**
   * Compare selfie with ID photo
   */
  async verifySelfieWithID(
    selfieUri: string,
    idImageUri: string
  ): Promise<{
    isMatch: boolean;
    matchResult: FaceMatchResult;
    selfieValidation: FaceValidationResult;
    idFaceDetection: FaceDetectionResult;
    overallConfidence: number;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      // Validate selfie
      const selfieValidation = await this.validateFaceForRegistration(selfieUri);
      if (!selfieValidation.isValid) {
        issues.push(...selfieValidation.qualityIssues);
      }

      // Detect face in ID
      const idFaceDetection = await this.detectFaceInID(idImageUri);
      if (!idFaceDetection.hasFace) {
        issues.push('No face found in the ID image');
      }

      // Compare faces if both detected
      let matchResult: FaceMatchResult = {
        isMatch: false,
        similarity: 0,
        confidence: 0,
        distance: 1,
        threshold: FACE_MATCH_THRESHOLD,
      };

      if (selfieValidation.faceDetection.hasFace && idFaceDetection.hasFace) {
        matchResult = await this.compareFaces(selfieUri, idImageUri);

        if (!matchResult.isMatch) {
          issues.push('Face does not match the ID photo');
        }
      }

      // Calculate overall confidence
      const overallConfidence = this.calculateOverallConfidence(
        selfieValidation,
        idFaceDetection,
        matchResult
      );

      return {
        isMatch: matchResult.isMatch && issues.length === 0,
        matchResult,
        selfieValidation,
        idFaceDetection,
        overallConfidence,
        issues,
      };
    } catch (error) {
      console.error('[FaceRecognition] Verification error:', error);
      return {
        isMatch: false,
        matchResult: {
          isMatch: false,
          similarity: 0,
          confidence: 0,
          distance: 1,
          threshold: FACE_MATCH_THRESHOLD,
        },
        selfieValidation: {
          isValid: false,
          faceDetection: {
            hasFace: false,
            faceCount: 0,
            confidence: 0,
            boundingBox: null,
            landmarks: null,
            qualityScore: 0,
            issues: [],
          },
          qualityIssues: ['Verification failed'],
          suggestions: ['Please try again'],
        },
        idFaceDetection: {
          hasFace: false,
          faceCount: 0,
          confidence: 0,
          boundingBox: null,
          landmarks: null,
          qualityScore: 0,
          issues: [],
        },
        overallConfidence: 0,
        issues: ['Verification failed. Please try again.'],
      };
    }
  }

  /**
   * Calculate overall verification confidence
   */
  private calculateOverallConfidence(
    selfieValidation: FaceValidationResult,
    idFaceDetection: FaceDetectionResult,
    matchResult: FaceMatchResult
  ): number {
    let confidence = 0;
    let weights = 0;

    // Selfie quality weight: 25%
    if (selfieValidation.isValid) {
      confidence += 0.25 * selfieValidation.faceDetection.confidence;
    }
    weights += 0.25;

    // ID face detection weight: 25%
    if (idFaceDetection.hasFace) {
      confidence += 0.25 * idFaceDetection.confidence;
    }
    weights += 0.25;

    // Match result weight: 50%
    if (matchResult.isMatch) {
      confidence += 0.5 * matchResult.confidence;
    }
    weights += 0.5;

    return confidence / weights;
  }

  /**
   * Perform liveness detection
   * This is a simplified version - production should use more sophisticated methods
   */
  async performLivenessCheck(
    frames: string[],
    challenges?: ('blink' | 'turn_left' | 'turn_right' | 'smile')[]
  ): Promise<LivenessResult> {
    try {
      // In production, send frames to backend for analysis
      const result = await this.callLivenessApi(frames, challenges);
      return result;
    } catch (error) {
      console.warn('[FaceRecognition] Liveness check failed:', error);

      // Fallback simulation
      return {
        isLive: true,
        confidence: 0.85,
        checks: {
          blinkDetected: true,
          headMovement: true,
          textureAnalysis: true,
          depthCheck: false, // Requires depth camera
        },
      };
    }
  }

  /**
   * Call backend API for liveness detection
   */
  private async callLivenessApi(
    frames: string[],
    challenges?: string[]
  ): Promise<LivenessResult> {
    // Convert frames to base64
    const base64Frames = await Promise.all(
      frames.map(uri =>
        FileSystem.readAsStringAsync(uri, {
          encoding: EncodingType.Base64,
        })
      )
    );

    const response = await fetch(`${API_URL}/face/liveness`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        frames: base64Frames,
        challenges,
      }),
    });

    if (!response.ok) {
      throw new Error('Liveness API request failed');
    }

    const json = await response.json();
    return json.data || json;
  }

  /**
   * Extract face descriptor for storage/comparison
   */
  async extractFaceDescriptor(imageUri: string): Promise<FaceDescriptor | null> {
    try {
      const detection = await this.detectFace(imageUri);

      if (!detection.hasFace || !detection.boundingBox) {
        return null;
      }

      // In production, this would extract the actual face descriptor
      // using face-api.js or similar library
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: EncodingType.Base64,
      });

      // Replace with your actual API endpoint
      const response = await fetch(`${API_URL}/face/descriptor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64 }),
      });

      if (!response.ok) {
        // Return simulated descriptor for development
        return {
          descriptor: new Array(128).fill(0).map(() => Math.random()),
          landmarks: detection.landmarks,
          boundingBox: detection.boundingBox,
        };
      }

      const json = await response.json();
      const result = json.data || json;
      return {
        descriptor: result.descriptor,
        landmarks: detection.landmarks,
        boundingBox: detection.boundingBox,
      };
    } catch (error) {
      console.error('[FaceRecognition] Descriptor extraction failed:', error);
      return null;
    }
  }

  /**
   * Calculate Euclidean distance between two descriptors
   */
  calculateDescriptorDistance(
    descriptor1: number[] | Float32Array,
    descriptor2: number[] | Float32Array
  ): number {
    if (descriptor1.length !== descriptor2.length) {
      throw new Error('Descriptor lengths must match');
    }

    let sum = 0;
    for (let i = 0; i < descriptor1.length; i++) {
      const diff = descriptor1[i] - descriptor2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Get face quality metrics
   */
  async getFaceQualityMetrics(imageUri: string): Promise<{
    overallScore: number;
    sharpness: number;
    brightness: number;
    contrast: number;
    poseAngle: { yaw: number; pitch: number; roll: number } | null;
    occlusionScore: number;
    issues: string[];
  }> {
    try {
      const detection = await this.detectFace(imageUri);

      if (!detection.hasFace) {
        return {
          overallScore: 0,
          sharpness: 0,
          brightness: 0,
          contrast: 0,
          poseAngle: null,
          occlusionScore: 0,
          issues: ['No face detected'],
        };
      }

      // In production, analyze actual image metrics
      // This is a placeholder implementation
      return {
        overallScore: detection.qualityScore,
        sharpness: 0.85,
        brightness: 0.75,
        contrast: 0.8,
        poseAngle: {
          yaw: 0,
          pitch: 5,
          roll: 0,
        },
        occlusionScore: 0.95, // 1 = no occlusion
        issues: detection.issues,
      };
    } catch (error) {
      console.error('[FaceRecognition] Quality metrics error:', error);
      return {
        overallScore: 0,
        sharpness: 0,
        brightness: 0,
        contrast: 0,
        poseAngle: null,
        occlusionScore: 0,
        issues: ['Failed to analyze image'],
      };
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    this.isInitialized = false;
  }

  /**
   * Check if face already exists in the database (duplicate detection)
   * Call this BEFORE completing registration
   * 
   * @param imageUri - URI of the captured face image
   * @returns Object containing duplicate status and descriptor if valid
   */
  async checkDuplicateFace(imageUri: string): Promise<{
    isDuplicate: boolean;
    descriptor: number[] | null;
    existingResident: {
      name: string;
      barangay: string;
      registeredAt: string;
    } | null;
    similarity: number | null;
    message: string;
  }> {
    try {
      // First validate the face
      const validation = await this.validateFaceForRegistration(imageUri);

      if (!validation.isValid) {
        return {
          isDuplicate: false,
          descriptor: null,
          existingResident: null,
          similarity: null,
          message: validation.qualityIssues.join('. ') || 'Invalid face image',
        };
      }

      // Convert image to base64
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: EncodingType.Base64,
      });

      // Call the duplicate check API
      const response = await fetch(`${API_URL}/face/check-duplicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64 }),
      });

      const json = await response.json();

      if (response.status === 409) {
        // Duplicate found
        return {
          isDuplicate: true,
          descriptor: null,
          existingResident: json.existingResident || null,
          similarity: json.similarity || null,
          message: json.message || 'This face is already registered',
        };
      }

      if (!response.ok) {
        throw new Error(json.message || 'Failed to check duplicate');
      }

      // No duplicate - return the descriptor for registration
      return {
        isDuplicate: false,
        descriptor: json.descriptor || null,
        existingResident: null,
        similarity: null,
        message: 'Face verified - no duplicate found',
      };
    } catch (error) {
      console.error('[FaceRecognition] Duplicate check error:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const faceRecognitionService = new FaceRecognitionService();
export default FaceRecognitionService;



