/**
 * Duplicate Face Detection Service
 * 
 * Checks if a face already exists in the database to prevent
 * duplicate resident registrations using the unified Python AI
 * backend (FaceNet 512-d embeddings in db.face_embeddings).
 */

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

export default {
  checkDuplicateFace,
  DUPLICATE_THRESHOLD,
};
