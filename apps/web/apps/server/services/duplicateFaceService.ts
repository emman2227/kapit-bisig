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

  try {
    const payload: { image: string; resident_data?: Record<string, any> } = {
      image: base64Image,
    };
    if (residentData) {
      payload.resident_data = residentData;
    }

    const res = await fetch(`${pythonUrl}/api/face/check-duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

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

    throw new Error(data.message || 'Face verification returned unexpected decision');
  } catch (err: any) {
    clearTimeout(timeout);
    if (shouldLogDebug()) {
      console.error(`[DuplicateCheck] Python AI backend call failed (${err.message})`);
    }
    throw new Error(`Face verification backend unavailable: ${err.message}`);
  }
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
 * Remove a resident's face embedding from MongoDB face_embeddings and Python cache
 * when their registration is rejected or returned for revision.
 */
export async function removeResidentFaceEmbedding(identifiers: {
  residentId?: string;
  residentCode?: string;
  mobileNumber?: string;
}): Promise<number> {
  const { residentId, residentCode, mobileNumber } = identifiers;
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

  // Also call Python backend to remove from in-memory cache if targetId exists
  const targetId = residentCode || residentId;
  if (targetId) {
    try {
      const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      await fetch(`${pythonUrl}/api/face/user/${targetId}`, {
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
  removeResidentFaceEmbedding,
  DUPLICATE_THRESHOLD,
};
