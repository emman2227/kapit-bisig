/**
 * Backend API Service for AI Verification
 * Handles communication with the backend for OCR, face recognition, and process ID verification
 */

import * as FileSystem from 'expo-file-system/legacy';
import { resolveApiBaseUrl } from '../config/apiSecurity';

// Encoding type constant
const EncodingType = {
  Base64: 'base64' as const,
  UTF8: 'utf8' as const,
};

// Configuration
const API_CONFIG = {
  baseUrl: resolveApiBaseUrl(
    process.env.EXPO_PUBLIC_API_URL,
    'https://kapit-bisig.onrender.com/api',
    'VerificationAPIService',
  ),
  timeout: 30000, // 30 seconds for AI processing
  retryAttempts: 2,
};

// Types
export interface OCRResult {
  success: boolean;
  text: string;
  confidence: number;
  blocks: TextBlock[];
  error?: string;
}

export interface TextBlock {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FaceDetectionAPIResult {
  success: boolean;
  hasFace: boolean;
  faceCount: number;
  faces: DetectedFace[];
  error?: string;
}

export interface DetectedFace {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  landmarks: {
    leftEye: { x: number; y: number };
    rightEye: { x: number; y: number };
    nose: { x: number; y: number };
    leftMouth: { x: number; y: number };
    rightMouth: { x: number; y: number };
  };
  descriptor?: number[];
}

export interface FaceComparisonAPIResult {
  success: boolean;
  isMatch: boolean;
  distance: number;
  confidence: number;
  error?: string;
}

export interface LivenessAPIResult {
  success: boolean;
  isLive: boolean;
  confidence: number;
  checks: {
    blinkDetected: boolean;
    headMovement: boolean;
    textureAnalysis: boolean;
    depthCheck: boolean;
  };
  error?: string;
}

class VerificationAPIService {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
    this.timeout = API_CONFIG.timeout;
  }

  /**
   * Update API configuration
   */
  configure(config: Partial<typeof API_CONFIG>): void {
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    if (config.timeout) this.timeout = config.timeout;
  }

  /**
   * Perform OCR on an image
   */
  async performOCR(imageUri: string, language: string = 'eng+fil'): Promise<OCRResult> {
    try {
      const base64 = await this.imageToBase64(imageUri);

      const response = await this.fetchWithTimeout(`${this.baseUrl}/verification/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: base64,
          language,
        }),
      });

      if (!response.ok) {
        throw new Error(`OCR request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[VerificationAPI] OCR error:', error);
      return {
        success: false,
        text: '',
        confidence: 0,
        blocks: [],
        error: error instanceof Error ? error.message : 'OCR failed',
      };
    }
  }

  /**
   * Detect faces in an image
   */
  async detectFaces(imageUri: string): Promise<FaceDetectionAPIResult> {
    try {
      const base64 = await this.imageToBase64(imageUri);

      const response = await this.fetchWithTimeout(`${this.baseUrl}/face/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64 }),
      });

      if (!response.ok) {
        throw new Error(`Face detection request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[VerificationAPI] Face detection error:', error);
      return {
        success: false,
        hasFace: false,
        faceCount: 0,
        faces: [],
        error: error instanceof Error ? error.message : 'Face detection failed',
      };
    }
  }

  /**
   * Compare two face images
   */
  async compareFaces(image1Uri: string, image2Uri: string): Promise<FaceComparisonAPIResult> {
    try {
      const [base64_1, base64_2] = await Promise.all([
        this.imageToBase64(image1Uri),
        this.imageToBase64(image2Uri),
      ]);

      const response = await this.fetchWithTimeout(`${this.baseUrl}/face/compare`, {
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
        throw new Error(`Face comparison request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[VerificationAPI] Face comparison error:', error);
      return {
        success: false,
        isMatch: false,
        distance: 1,
        confidence: 0,
        error: error instanceof Error ? error.message : 'Face comparison failed',
      };
    }
  }

  /**
   * Perform liveness check
   */
  async checkLiveness(frames: string[]): Promise<LivenessAPIResult> {
    try {
      const base64Frames = await Promise.all(
        frames.map(uri => this.imageToBase64(uri))
      );

      const response = await this.fetchWithTimeout(`${this.baseUrl}/face/liveness`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ frames: base64Frames }),
      });

      if (!response.ok) {
        throw new Error(`Liveness check request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[VerificationAPI] Liveness check error:', error);
      return {
        success: false,
        isLive: false,
        confidence: 0,
        checks: {
          blinkDetected: false,
          headMovement: false,
          textureAnalysis: false,
          depthCheck: false,
        },
        error: error instanceof Error ? error.message : 'Liveness check failed',
      };
    }
  }

  /**
   * Process ID verification with client quality, OCR, fuzzy matching, and decision engine
   */
  async processIDVerification(data: {
    frontIdImage: string;
    backIdImage?: string;
    idType: string;
    userEnteredIdNumber: string;
    userEnteredFullName?: string;
    clientQualityScore?: number;
  }): Promise<{
    success: boolean;
    decision: 'PASS' | 'REVIEW' | 'BLOCK';
    finalScore: number;
    scoreBreakdown: {
      imageQualityScore: number;
      ocrConfidenceScore: number;
      documentMatchScore: number;
      idNumberMatchScore: number;
    };
    extractedData: any;
    feedbackMessage: string;
    warnings: string[];
    errors: string[];
  }> {
    try {
      const frontBase64 = await this.imageToBase64(data.frontIdImage);
      const backBase64 = data.backIdImage ? await this.imageToBase64(data.backIdImage) : undefined;

      const response = await this.fetchWithTimeout(`${this.baseUrl}/verification/process-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          frontIdImage: frontBase64,
          backIdImage: backBase64,
          idType: data.idType,
          userEnteredIdNumber: data.userEnteredIdNumber,
          userEnteredFullName: data.userEnteredFullName,
          clientQualityScore: data.clientQualityScore ?? 100,
        }),
      });

      if (!response.ok) {
        throw new Error(`Process ID verification request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[VerificationAPI] Process ID verification error:', error);
      return {
        success: false,
        decision: 'REVIEW',
        finalScore: 50,
        scoreBreakdown: {
          imageQualityScore: data.clientQualityScore ?? 50,
          ocrConfidenceScore: 0,
          documentMatchScore: 50,
          idNumberMatchScore: 50,
        },
        extractedData: null,
        feedbackMessage: 'Verification requires manual administrative review due to connection or image issues.',
        warnings: ['Failed to reach automated OCR server. Relegated to manual review queue.'],
        errors: [],
      };
    }
  }

  /**
   * Full verification request
   */
  async performFullVerification(data: {
    frontIdImage: string;
    backIdImage: string;
    selfieImage: string;
    idType: string;
    userData: {
      fullName: string;
      dateOfBirth: string;
      idNumber: string;
    };
  }): Promise<{
    success: boolean;
    isVerified: boolean;
    confidence: number;
    details: any;
    error?: string;
  }> {
    try {
      const [frontBase64, backBase64, selfieBase64] = await Promise.all([
        this.imageToBase64(data.frontIdImage),
        this.imageToBase64(data.backIdImage),
        this.imageToBase64(data.selfieImage),
      ]);

      const response = await this.fetchWithTimeout(`${this.baseUrl}/verify/full`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          frontIdImage: frontBase64,
          backIdImage: backBase64,
          selfieImage: selfieBase64,
          idType: data.idType,
          userData: data.userData,
        }),
      });

      if (!response.ok) {
        throw new Error(`Verification request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[VerificationAPI] Full verification error:', error);
      return {
        success: false,
        isVerified: false,
        confidence: 0,
        details: null,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Convert image URI to base64
   */
  private async imageToBase64(imageUri: string): Promise<string> {
    try {
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: EncodingType.Base64,
      });
      return base64;
    } catch (error) {
      console.error('[VerificationAPI] Base64 conversion error:', error);
      throw new Error('Failed to process image');
    }
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check API health
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const verificationAPI = new VerificationAPIService();
export default VerificationAPIService;
