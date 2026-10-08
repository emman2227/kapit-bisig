/**
 * Duplicate Face Detection Service
 * 
 * Checks if a face already exists in the database to prevent
 * duplicate resident registrations.
 */

import Resident from '../models/Resident';
import { faceRecognitionService, FaceCompareResult } from './faceRecognitionService';

// Configuration
const DUPLICATE_THRESHOLD = 0.6;  // Euclidean distance threshold

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

export interface FaceDescriptorRecord {
  _id: string;
  firstName: string;
  lastName: string;
  barangay: string;
  streetAddress?: string;
  faceDescriptor: number[];
  createdAt: Date;
}

/**
 * Calculate Euclidean distance between two face descriptors
 * Formula: √Σ(a[i] - b[i])²
 */
function euclideanDistance(descriptor1: number[], descriptor2: number[]): number {
  if (descriptor1.length !== 128 || descriptor2.length !== 128) {
    throw new Error('Face descriptors must be 128-dimensional');
  }
  
  let sum = 0;
  for (let i = 0; i < 128; i++) {
    const diff = descriptor1[i] - descriptor2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Check with unified Python AI backend (FastAPI / FaceNet / db.face_embeddings)
 */
async function checkWithPythonAiBackend(base64Image: string): Promise<DuplicateCheckResult | null> {
  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(`${pythonUrl}/api/face/check-duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (shouldLogDebug()) {
        console.warn(`[DuplicateCheck] Python AI service returned status ${res.status}`);
      }
      return null;
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

    return null;
  } catch (err: any) {
    clearTimeout(timeout);
    if (shouldLogDebug()) {
      console.log(`[DuplicateCheck] Python AI backend not reachable (${err.message}), falling back to local face-api`);
    }
    return null;
  }
}

/**
 * Check if a face already exists in the database
 * 
 * @param base64Image - Base64 encoded face image
 * @returns DuplicateCheckResult with match information
 */
export async function checkDuplicateFace(base64Image: string): Promise<DuplicateCheckResult> {
  const startTime = Date.now();

  // Step 0: Query unified Python AI service (FaceNet 512-d / db.face_embeddings)
  const pythonResult = await checkWithPythonAiBackend(base64Image);
  if (pythonResult) {
    return pythonResult;
  }
  
  try {
    // Step 1: Generate face descriptor for the new image
    if (shouldLogDebug()) console.log('[DuplicateCheck] Generating descriptor...');
    const newDescriptorData = await faceRecognitionService.generateDescriptor(base64Image);
    
    if (!newDescriptorData) {
      throw new Error('No face detected in the provided image');
    }
    
    const newDescriptor = newDescriptorData.descriptor;
    if (shouldLogDebug()) console.log('[DuplicateCheck] Descriptor generated');
    
    // Step 2: Fetch all existing residents with face descriptors
    if (shouldLogDebug()) console.log('[DuplicateCheck] Fetching resident descriptors...');
    const existingResidents = await Resident.find({
      faceDescriptor: { $exists: true, $ne: null }
    }).select('firstName lastName barangay streetAddress faceDescriptor createdAt').lean();
    
    if (shouldLogDebug()) {
      console.log(`[DuplicateCheck] Candidate descriptor count: ${existingResidents.length}`);
    }
    
    // Step 3: Compare against each existing resident
    let closestMatch: FaceDescriptorRecord | null = null;
    let smallestDistance = Infinity;
    
    for (const resident of existingResidents) {
      if (!resident.faceDescriptor || !Array.isArray(resident.faceDescriptor)) {
        continue;  // Skip residents without valid descriptors
      }
      
      const distance = euclideanDistance(
        newDescriptor,
        resident.faceDescriptor
      );
      
      // Track closest match
      if (distance < smallestDistance) {
        smallestDistance = distance;
        closestMatch = resident as unknown as FaceDescriptorRecord;
      }
      
      // Early exit if duplicate found
      if (distance < DUPLICATE_THRESHOLD) {
        const processingTime = Date.now() - startTime;
        if (shouldLogDebug()) {
          // [RISK-2 MITIGATION] Avoid logging resident identity during biometric comparison.
          console.log(`[DuplicateCheck] Duplicate detected at distance=${distance.toFixed(4)}`);
        }
        
        return {
          isDuplicate: true,
          descriptor: null,  // Don't return descriptor if duplicate
          matchedResident: {
            id: resident._id.toString(),
            name: `${resident.firstName} ${resident.lastName}`,
            barangay: resident.barangay,
            streetAddress: resident.streetAddress,
            registeredAt: resident.createdAt
          },
          distance: Math.round(distance * 1000) / 1000,
          similarity: Math.round((1 - distance) * 100),  // Convert to percentage
          totalCompared: existingResidents.length,
          processingTime
        };
      }
    }
    
    // Step 4: No duplicate found - return the descriptor for storage
    const processingTime = Date.now() - startTime;
    if (shouldLogDebug()) {
      console.log(
        `[DuplicateCheck] No duplicate found. Closest distance=${smallestDistance.toFixed(4)}`,
      );
    }
    
    return {
      isDuplicate: false,
      descriptor: newDescriptor,
      matchedResident: null,
      distance: closestMatch ? Math.round(smallestDistance * 1000) / 1000 : null,
      similarity: closestMatch ? Math.round((1 - smallestDistance) * 100) : null,
      totalCompared: existingResidents.length,
      processingTime
    };
    
  } catch (error) {
    console.error('[DuplicateCheck] Error:', (error as Error).message);
    throw error;
  }
}

/**
 * Compare a face descriptor against a stored descriptor
 * Used for verification during login or benefit distribution
 */
export async function verifyFaceDescriptor(
  base64Image: string,
  storedDescriptor: number[]
): Promise<FaceCompareResult> {
  return faceRecognitionService.compareWithDescriptor(base64Image, storedDescriptor);
}

export default {
  checkDuplicateFace,
  verifyFaceDescriptor,
  euclideanDistance,
  DUPLICATE_THRESHOLD
};
