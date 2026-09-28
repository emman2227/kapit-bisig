import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';

export interface OCRWordBlock {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OCRServiceResult {
  text: string;
  confidence: number;
  blocks: OCRWordBlock[];
  languageUsed: string;
  isLegitimateId?: boolean;
  detectedKeywords?: string[];
  verificationReasons?: string[];
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

const workerPromises = new Map<string, Promise<OcrWorker>>();

/**
 * Normalize language string for Tesseract.
 *
 * Previously this converted 'eng+fil' → 'eng', silently dropping Filipino
 * support. Philippine IDs contain Filipino words ("REPUBLIKA NG PILIPINAS",
 * "PANGALAN", etc.) so keeping 'fil' is important for keyword recognition.
 *
 * If the 'fil' trained data is not available Tesseract will fall back to 'eng'
 * automatically, so there's no harm in requesting it.
 */
function normalizeLanguage(language?: string): string {
  const value = String(language || 'eng').trim();
  if (!value) return 'eng';
  return value;
}

function stripDataUrlPrefix(input: string): string {
  const marker = 'base64,';
  const index = input.indexOf(marker);
  if (index === -1) return input;
  return input.slice(index + marker.length);
}

/**
 * Pre-process the raw image buffer for significantly better OCR accuracy.
 *
 * Mobile phone photos of IDs typically have:
 *  - Colored/patterned backgrounds that confuse character segmentation
 *  - Uneven lighting and shadows
 *  - JPEG compression blur
 *  - Glare and reflections
 *
 * This pipeline addresses each of those problems.
 */
async function preprocessImageForOCR(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer)
      // 1. Convert to grayscale — removes background color/pattern noise
      .grayscale()
      // 2. Auto-normalize contrast — handles uneven lighting
      .normalize()
      // 3. Sharpen to counteract JPEG compression blur
      .sharpen({ sigma: 1.2 })
      // 4. Ensure minimum DPI for Tesseract accuracy (at least ~2000px wide)
      //    without enlarging small images that would only amplify noise
      .resize({
        width: 2400,
        height: 2400,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // 5. Output as lossless PNG to avoid re-introducing JPEG artifacts
      .png()
      .toBuffer();
  } catch (err) {
    // If sharp fails (corrupt image, unsupported format), return the original
    // buffer so Tesseract can still attempt recognition.
    console.warn('[ocrService] Image pre-processing failed, using raw image:', err);
    return buffer;
  }
}

async function getWorker(language: string): Promise<OcrWorker> {
  const normalizedLanguage = normalizeLanguage(language);
  const existing = workerPromises.get(normalizedLanguage);
  if (existing) {
    return existing;
  }

  const workerPromise = (async () => {
    let worker: OcrWorker;

    try {
      worker = await createWorker(normalizedLanguage);
    } catch (err) {
      // If the requested language pack (e.g. 'eng+fil') is unavailable,
      // fall back to English-only.
      if (normalizedLanguage !== 'eng') {
        console.warn(
          `[ocrService] Failed to create worker for '${normalizedLanguage}', falling back to 'eng':`,
          err,
        );
        worker = await createWorker('eng');
      } else {
        throw err;
      }
    }

    // Tuned for ID card recognition:
    // - SINGLE_BLOCK works better for structured ID card layouts than AUTO
    // - Character whitelist prevents garbage from decorative backgrounds
    // - Preserving interword spaces helps pattern matching for ID numbers
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      tessedit_char_whitelist:
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-.:,() ',
      preserve_interword_spaces: '1',
    });

    return worker;
  })();

  workerPromises.set(normalizedLanguage, workerPromise);
  return workerPromise;
}

const PYTHON_AI_URL = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000').replace('localhost', '127.0.0.1');

async function tryPythonDeepLearningOCR(
  base64Payload: string,
  idType?: string,
): Promise<OCRServiceResult | null> {
  try {
    let payload = base64Payload;
    try {
      const rawBuffer = Buffer.from(base64Payload, 'base64');
      const resized = await sharp(rawBuffer)
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      payload = resized.toString('base64');
    } catch {
      // If sharp resize fails, use original payload
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(`${PYTHON_AI_URL}/api/id/verify-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: payload,
        id_type: idType,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[RapidOCR] Python backend returned status ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();
    if (!data.success) {
      console.warn(`[RapidOCR] Python backend returned success: false - reasons: ${JSON.stringify(data.reasons || [])}`);
      return null;
    }

    return {
      text: String(data.raw_text || '').trim(),
      confidence: Math.max(0.1, Number(data.confidence || 0) / 100),
      blocks: (data.blocks || []).map((b: any) => ({
        text: String(b.text || ''),
        confidence: Number(b.confidence || 0),
        boundingBox: b.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
      })),
      languageUsed: 'rapidocr-onnx',
      isLegitimateId: Boolean(data.is_valid_id),
      detectedKeywords: Array.isArray(data.detected_keywords) ? data.detected_keywords : [],
      verificationReasons: Array.isArray(data.reasons) ? data.reasons : [],
    };
  } catch (err: any) {
    console.error(`[RapidOCR] Failed to contact Python OCR at ${PYTHON_AI_URL}:`, err.message || err);
    // Graceful fallback to local Tesseract
    return null;
  }
}

export interface DeepLearningIDVerificationResult {
  isValidId: boolean;
  confidence: number;
  hasPortraitFace: boolean;
  aspectRatioValid: boolean;
  extractedIdNumber: string | null;
  detectedKeywords: string[];
  reasons: string[];
  rawText: string;
}

export async function verifyIDDocumentDetailed(
  image: string,
  idType?: string,
  expectedIdNumber?: string,
): Promise<DeepLearningIDVerificationResult | null> {
  try {
    let payload = stripDataUrlPrefix(String(image || '').trim());
    try {
      const rawBuffer = Buffer.from(payload, 'base64');
      const resized = await sharp(rawBuffer)
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      payload = resized.toString('base64');
    } catch {
      // fallback to original payload
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(`${PYTHON_AI_URL}/api/id/verify-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: payload,
        id_type: idType,
        expected_id_number: expectedIdNumber,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data: any = await response.json();
    if (!data.success) return null;

    return {
      isValidId: Boolean(data.is_valid_id),
      confidence: Number(data.confidence || 0),
      hasPortraitFace: Boolean(data.has_portrait_face),
      aspectRatioValid: Boolean(data.aspect_ratio_valid),
      extractedIdNumber: data.extracted_id_number || null,
      detectedKeywords: data.detected_keywords || [],
      reasons: data.reasons || [],
      rawText: data.raw_text || '',
    };
  } catch {
    return null;
  }
}

export async function performOCRFromBase64Image(
  image: string,
  language = 'eng',
  idType?: string,
): Promise<OCRServiceResult> {
  const payload = stripDataUrlPrefix(String(image || '').trim());

  // 1. Try RapidOCR (PP-OCRv4) deep-learning service from Python backend
  const pythonResult = await tryPythonDeepLearningOCR(payload, idType);
  if (pythonResult && pythonResult.text.length > 0) {
    return pythonResult;
  }

  // 2. Fallback to local Tesseract worker with crash guard
  const normalizedLanguage = normalizeLanguage(language);
  try {
    const rawBuffer = Buffer.from(payload, 'base64');

    // Pre-process the image for significantly better OCR accuracy
    const processedBuffer = await preprocessImageForOCR(rawBuffer);

    const worker = await getWorker(normalizedLanguage);
    const result = await worker.recognize(processedBuffer);
    const data = result.data;

    return {
      text: String(data.text || '').trim(),
      confidence: Number(data.confidence || 0) / 100,
      blocks: (data.words || []).map((word) => ({
        text: word.text || '',
        confidence: Number(word.confidence || 0) / 100,
        boundingBox: {
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: Math.max(0, word.bbox.x1 - word.bbox.x0),
          height: Math.max(0, word.bbox.y1 - word.bbox.y0),
        },
      })),
      languageUsed: normalizedLanguage,
    };
  } catch (err: any) {
    console.error('[ocrService] Tesseract worker failed safely:', err.message || err);
    return {
      text: '',
      confidence: 0,
      blocks: [],
      languageUsed: normalizedLanguage,
    };
  }
}
