/**
 * Duplicate Face Detection Service
 * 
 * Checks if a face already exists in the database to prevent
 * duplicate resident registrations using the unified Python AI
 * backend (FaceNet 512-d embeddings in db.face_embeddings).
 */

import mongoose from 'mongoose';

// Configuration
const DUPLICATE_THRESHOLD = 0.6;

function shouldLogDebug(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_SECURITY_CONSOLE_LOGS === 'true';
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  descriptor: number[] | null;
  matchedResident: {
    id: string;
    name: string;
    barangay: string;
    streetAddress?: string;
    registeredAt: Date;
  } | null;
  distance: number | null;
  similarity: number | null;
  totalCompared: number;
  processingTime: number;
}

/**
 * Check with unified Python AI backend (FastAPI / FaceNet / db.face_embeddings)
 */
async function checkWithPythonAiBackend(
  base64Image: string,
  residentData?: Record<string, any>
): Promise<DuplicateCheckResult> {
  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  let res: Response;
  try {
    const payload: { image: string; resident_data?: Record<string, any>; enroll?: boolean } = {
      image: base64Image,
      enroll: false,
    };
    if (residentData) {
      payload.resident_data = residentData;
    }

    res = await fetch(`${pythonUrl}/api/face/check-duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err: any) {
    clearTimeout(timeout);
    if (shouldLogDebug()) {
      console.error(`[DuplicateCheck] Python AI backend call failed (${err.message})`);
    }
    throw new Error(`Face verification backend unavailable: ${err.message}`);
  }

  if (!res.ok) {
    if (shouldLogDebug()) {
      console.warn(`[DuplicateCheck] Python AI service returned status ${res.status}`);
    }
    throw new Error(`Face verification backend returned error status: ${res.status}`);
  }

  const data = (await res.json()) as any;
  if (data.decision === 'BLOCK') {
    return {
      isDuplicate: true,
      descriptor: null,
      matchedResident: {
        id: data.best_match_id || 'duplicate-face',
        name: data.best_match_name || 'Registered Resident',
        barangay: '',
        registeredAt: new Date(),
      },
      distance: null,
      similarity: typeof data.similarity === 'number' ? Math.round(data.similarity * 100) : 88,
      totalCompared: 1,
      processingTime: data.processing_time_ms || 0,
    };
  }

  if (data.decision === 'ALLOW') {
    return {
      isDuplicate: false,
      descriptor: null,
      matchedResident: null,
      distance: null,
      similarity: null,
      totalCompared: 1,
      processingTime: data.processing_time_ms || 0,
    };
  }

  throw new Error(data.message || 'No face detected. Please ensure your face is clearly visible.');
}

/**
 * Check if a face already exists in the database
 * 
 * @param base64Image - Base64 encoded face image
 * @param residentData - Optional resident details to enroll on ALLOW
 * @returns DuplicateCheckResult with match information
 */
export async function checkDuplicateFace(
  base64Image: string,
  residentData?: Record<string, any>
): Promise<DuplicateCheckResult> {
  return checkWithPythonAiBackend(base64Image, residentData);
}

/**
 * Explicitly enroll a resident's face embedding into MongoDB and Python cache upon successful registration/approval.
 */
export async function enrollResidentFaceEmbedding(data: {
  image: string;
  residentId: string;
  residentCode?: string;
  householdToken?: string;
  firstName?: string;
  lastName?: string;
  mobileNumber?: string;
  barangay?: string;
  dateOfBirth?: string;
  gender?: string;
  streetAddress?: string;
}): Promise<boolean> {
  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const payload = {
      image: data.image,
      resident_id: data.residentId,
      resident_code: data.residentCode,
      household_token: data.householdToken,
      first_name: data.firstName,
      last_name: data.lastName,
      mobile_number: data.mobileNumber,
      barangay: data.barangay,
      date_of_birth: data.dateOfBirth,
      gender: data.gender,
      street_address: data.streetAddress,
    };

    const res = await fetch(`${pythonUrl}/api/face/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (shouldLogDebug()) {
        console.warn(`[FaceEnroll] Python AI service returned status ${res.status}`);
      }
      return false;
    }

    const resData = (await res.json()) as any;
    return Boolean(resData.success);
  } catch (err: any) {
    clearTimeout(timeout);
    if (shouldLogDebug()) {
      console.warn(`[FaceEnroll] Python AI enrollment call failed (${err.message})`);
    }
    return false;
  }
}

/**
 * Remove a resident's face embedding from MongoDB face_embeddings and Python cache
 * when their registration is rejected or returned for revision.
 */
export async function removeResidentFaceEmbedding(identifiers: {
  residentId?: string;
  residentCode?: string;
  mobileNumber?: string;
  householdToken?: string;
}): Promise<number> {
  const { residentId, residentCode, mobileNumber, householdToken } = identifiers;
  const queries: any[] = [];

  if (residentCode) {
    queries.push({ resident_id: residentCode });
  }
  if (residentId) {
    queries.push({ resident_id: residentId });
  }
  if (mobileNumber && mobileNumber.trim()) {
    queries.push({ mobile_number: mobileNumber.trim() });
  }
  if (householdToken && householdToken.trim()) {
    queries.push({ household_token: householdToken.trim() });
  }

  if (queries.length === 0) {
    return 0;
  }

  let deletedCount = 0;
  try {
    const db = mongoose.connection.db;
    if (db) {
      const result = await db.collection('face_embeddings').deleteMany({
        $or: queries,
      });
      deletedCount = result.deletedCount || 0;
      if (shouldLogDebug()) {
        console.log(`[FaceBiometrics] Removed ${deletedCount} face embedding(s) for resident:`, identifiers);
      }
    }
  } catch (err: any) {
    console.error('[FaceBiometrics] Error removing face embedding from MongoDB:', err.message);
  }

  // Also call Python backend to remove from in-memory cache
  const targets = [residentCode, residentId, householdToken, mobileNumber].filter(Boolean) as string[];
  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
  for (const targetId of targets) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      await fetch(`${pythonUrl}/api/face/user/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
        signal: controller.signal,
      }).catch(() => {});
      clearTimeout(timeout);
    } catch {
      // Non-fatal if Python backend is offline
    }
  }

  return deletedCount;
}

export default {
  checkDuplicateFace,
  enrollResidentFaceEmbedding,
  removeResidentFaceEmbedding,
  DUPLICATE_THRESHOLD,
};
