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

export interface AssistedRevisionPayload {
  idType?: string;
  idNumber?: string;
  frontIdImage?: string;
  backIdImage?: string;
  faceImage?: string;
  attestationReason?: string;
  staffNote?: string;
}

export async function submitAssistedRevision(
  residentId: string,
  payload: AssistedRevisionPayload
): Promise<AssistedResult> {
  const token = await mobileAuthService.getToken();
  if (!token) {
    return {
      success: false,
      message: 'Not authenticated. Please log in as a staff member or volunteer.',
    };
  }

  try {
    const response = await fetch(`${BASE_URL}/residents/${residentId}/assisted-revision`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      return {
        success: false,
        message: json.message || 'Revision resubmission failed.',
      };
    }

    return {
      success: true,
      message: json.message || 'Revision resubmitted successfully.',
      residentCode: json.data?.residentCode,
      residentId: json.data?.id,
    };
  } catch (error) {
    console.error('[AssistedRegistrationService] Revision network error:', error);
    return {
      success: false,
      message: 'Network error. Please check your connection and try again.',
    };
  }
}

export interface ReturnedAssistedResident {
  id: string;
  _id?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  residentCode?: string;
  householdToken?: string;
  barangay: string;
  mobileNumber?: string;
  idType?: string;
  idNumber?: string;
  rejectionReason?: string;
  frontIdImage?: string;
  backIdImage?: string;
  faceImage?: string;
  createdAt?: string;
  assistedByName?: string;
}

export async function getReturnedAssistedRegistrations(
  barangay?: string
): Promise<{ success: boolean; data: ReturnedAssistedResident[]; message?: string }> {
  const token = await mobileAuthService.getToken();
  if (!token) {
    return { success: false, data: [], message: 'Not authenticated.' };
  }

  try {
    const query = new URLSearchParams({
      status: 'Needs Revision',
      limit: '50',
      myOnly: 'true',
    });
    if (barangay && barangay !== 'All Barangays') {
      query.append('barangay', barangay);
    }

    const response = await fetch(`${BASE_URL}/residents?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      return { success: false, data: [], message: json.message || 'Failed to fetch registrations.' };
    }

    const rawList = Array.isArray(json.data) ? json.data : [];
    const assistedOnly: ReturnedAssistedResident[] = rawList
      .filter((r: any) => r.registrationMethod === 'assisted' || Boolean(r.assistedBy))
      .map((r: any) => ({
        id: r._id || r.id,
        _id: r._id || r.id,
        fullName: r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Resident',
        firstName: r.firstName,
        lastName: r.lastName,
        residentCode: r.residentCode,
        householdToken: r.householdToken,
        barangay: r.barangay,
        mobileNumber: r.mobileNumber,
        idType: r.idType,
        idNumber: r.idNumber,
        rejectionReason: r.rejectionReason,
        frontIdImage: r.frontIdImage,
        backIdImage: r.backIdImage,
        faceImage: r.faceImage,
        createdAt: r.createdAt,
        assistedByName: r.assistedByName,
      }));

    return { success: true, data: assistedOnly };
  } catch (error) {
    console.error('[AssistedRegistrationService] Fetch returned error:', error);
    return { success: false, data: [], message: 'Network error loading returned registrations.' };
  }
}
