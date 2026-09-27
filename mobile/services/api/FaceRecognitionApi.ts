/**
 * Face Recognition API Service
 * 
 * Handles communication between mobile app and Python backend
 * 
 * Backend Endpoints:
 * - POST /api/face/detect    - Detect face in image
 * - POST /api/face/register  - Register new face
 * - POST /api/face/verify    - Verify face (1:N matching)
 * - GET  /api/face/registered-users - List registered users
 * - DELETE /api/face/user/:id - Delete user
 */

import * as FileSystem from 'expo-file-system/legacy';
import { resolveOptionalApiBaseUrl } from '../config/apiSecurity';

// ============================================
// CONFIGURATION
// ============================================

// Default API URL - Update this with your server IP in development
const DEFAULT_API_URL = 'http://192.168.1.4:8000';

// Get API URL from environment or use default (null in production if unset)
const API_BASE_URL = resolveOptionalApiBaseUrl(
  process.env.EXPO_PUBLIC_FACE_API_URL,
  DEFAULT_API_URL,
  'FaceRecognitionApi',
);

// Request timeout (30 seconds for face processing)
const REQUEST_TIMEOUT = 30000;

// ============================================
// TYPES
// ============================================

export interface FaceDetectionResult {
  has_face: boolean;
  face_count: number;
  is_centered: boolean;
  face_size_ok: boolean;
  message: string;
  bounding_box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FaceRegisterRequest {
  image: string;  // Base64 encoded
  user_id: string;
  name: string;
}

export interface FaceRegisterResponse {
  success: boolean;
  message: string;
  user_id?: string;
}

export interface FaceVerifyResponse {
  verified: boolean;
  user_id?: string;
  name?: string;
  confidence: number;
  message: string;
}

export interface RegisteredUser {
  user_id: string;
  name: string;
  registered_at: string;
}

export interface ApiError {
  detail: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Convert image URI to Base64 string
 */
export async function imageUriToBase64(uri: string): Promise<string> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64',
    });
    return base64;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw new Error('Failed to process image file');
  }
}

/**
 * Make API request with timeout and error handling
 */
async function apiRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: object
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('Face recognition service is not configured or currently unavailable.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('Request timeout. Please check your connection.');
    }

    if (error.message?.includes('Network request failed')) {
      throw new Error('Unable to connect to server. Please check if the backend is running.');
    }

    throw error;
  }
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Health check - verify backend is running
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await apiRequest<{ status: string }>('/api/health');
    return response.status === 'healthy';
  } catch (error) {
    console.error('API health check failed:', error);
    return false;
  }
}

/**
 * Detect face in image
 * Used for real-time feedback on mobile
 * 
 * @param imageBase64 - Base64 encoded image
 * @returns Detection result with face position and status
 */
export async function detectFace(imageBase64: string): Promise<FaceDetectionResult> {
  return apiRequest<FaceDetectionResult>('/api/face/detect', 'POST', {
    image: imageBase64,
  });
}

/**
 * Detect face from image URI
 * Convenience function that handles base64 conversion
 */
export async function detectFaceFromUri(imageUri: string): Promise<FaceDetectionResult> {
  const base64 = await imageUriToBase64(imageUri);
  return detectFace(base64);
}

/**
 * Register a new face
 * 
 * @param imageBase64 - Base64 encoded face image
 * @param userId - Unique user identifier
 * @param name - User's display name
 * @returns Registration result
 */
export async function registerFace(
  imageBase64: string,
  userId: string,
  name: string
): Promise<FaceRegisterResponse> {
  return apiRequest<FaceRegisterResponse>('/api/face/register', 'POST', {
    image: imageBase64,
    user_id: userId,
    name: name,
  });
}

/**
 * Register face from image URI
 * Convenience function that handles base64 conversion
 */
export async function registerFaceFromUri(
  imageUri: string,
  userId: string,
  name: string
): Promise<FaceRegisterResponse> {
  const base64 = await imageUriToBase64(imageUri);
  return registerFace(base64, userId, name);
}

/**
 * Verify face against all registered faces (1:N matching)
 * 
 * @param imageBase64 - Base64 encoded face image
 * @returns Verification result with matched user info
 */
export async function verifyFace(imageBase64: string): Promise<FaceVerifyResponse> {
  return apiRequest<FaceVerifyResponse>('/api/face/verify', 'POST', {
    image: imageBase64,
  });
}

/**
 * Verify face from image URI
 * Convenience function that handles base64 conversion
 */
export async function verifyFaceFromUri(imageUri: string): Promise<FaceVerifyResponse> {
  const base64 = await imageUriToBase64(imageUri);
  return verifyFace(base64);
}

/**
 * Get list of all registered users
 */
export async function getRegisteredUsers(): Promise<{ users: RegisteredUser[]; count: number }> {
  return apiRequest<{ users: RegisteredUser[]; count: number }>('/api/face/registered-users');
}

/**
 * Delete a registered user
 * 
 * @param userId - User ID to delete
 */
export async function deleteUser(userId: string): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(`/api/face/user/${userId}`, 'DELETE');
}

/**
 * Clear all registered users (for testing)
 */
export async function clearAllUsers(): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>('/api/face/clear-all', 'DELETE');
}

// ============================================
// SERVICE CLASS (Alternative OOP Style)
// ============================================

class FaceRecognitionApiService {
  private baseUrl: string | null;

  constructor(baseUrl: string | null = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  setBaseUrl(url: string | null) {
    this.baseUrl = url;
  }

  async healthCheck(): Promise<boolean> {
    return checkApiHealth();
  }

  async detect(imageBase64: string): Promise<FaceDetectionResult> {
    return detectFace(imageBase64);
  }

  async register(imageBase64: string, userId: string, name: string): Promise<FaceRegisterResponse> {
    return registerFace(imageBase64, userId, name);
  }

  async verify(imageBase64: string): Promise<FaceVerifyResponse> {
    return verifyFace(imageBase64);
  }

  async listUsers(): Promise<RegisteredUser[]> {
    const result = await getRegisteredUsers();
    return result.users;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const result = await deleteUser(userId);
    return result.success;
  }
}

// Export singleton instance
export const faceApi = new FaceRecognitionApiService();

// Export all functions as default
export default {
  checkApiHealth,
  detectFace,
  detectFaceFromUri,
  registerFace,
  registerFaceFromUri,
  verifyFace,
  verifyFaceFromUri,
  getRegisteredUsers,
  deleteUser,
  clearAllUsers,
  imageUriToBase64,
};



