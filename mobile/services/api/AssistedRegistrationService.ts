/**
 * Assisted Registration API Service (Mobile)
 *
 * Calls the assisted walk-in registration endpoint on behalf of
 * authenticated staff or volunteer users.
 */

import { resolveApiBaseUrl } from '../config/apiSecurity';
import { mobileAuthService } from '../auth/MobileAuthService';

const BASE_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL,
  'https://kapit-bisig.onrender.com/api',
  'AssistedRegistrationService'
);

export interface AssistedRegistrationPayload {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female';
  mobileNumber?: string;
  email?: string;
  password?: string;
  barangay: string;
  householdToken: string;
  streetAddress: string;
  city?: string;
  householdSize?: number;
  vulnerableMembers?: string[];
  vulnerableCounts?: Record<string, number>;
  idType: string;
  idNumber?: string;
  frontIdImage?: string;
  backIdImage?: string;
  faceImage: string;
  faceDescriptor?: number[];
  attestationReason?: string;
}

export interface AssistedResult {
  success: boolean;
  message: string;
  errors?: Array<{ field?: string; message: string }>;
  residentCode?: string;
  residentId?: string;
  qrToken?: string;
  tempPassword?: string;
}

export async function submitAssistedRegistration(
  payload: AssistedRegistrationPayload
): Promise<AssistedResult> {
  const token = await mobileAuthService.getToken();
  if (!token) {
    return {
      success: false,
      message: 'Not authenticated. Please log in as a staff member or volunteer.',
    };
  }

  try {
    const response = await fetch(`${BASE_URL}/assisted-registration/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      let displayMessage = json.message || 'Registration failed.';
      if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
        const errorDetails = json.errors
          .map((e: { field?: string; message: string }) => e.message || `${e.field}: Invalid input`)
          .join('\n• ');
        displayMessage = `${json.message || 'Validation failed'}:\n• ${errorDetails}`;
      }
      return {
        success: false,
        message: displayMessage,
        errors: json.errors,
      };
    }

    return {
      success: true,
      message: json.message || 'Registration successful.',
      residentCode: json.data?.residentCode,
      residentId: json.data?.residentId,
      qrToken: json.data?.qrToken,
      tempPassword: json.data?.tempPassword,
    };
  } catch (error) {
    console.error('[AssistedRegistrationService] Network error:', error);
    return {
      success: false,
      message: 'Network error. Please check your connection and try again.',
    };
  }
}
