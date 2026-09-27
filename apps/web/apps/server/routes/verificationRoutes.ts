import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBase64Image } from '../validation/imageValidation';
import {
  normalizeIdNumber,
  validateIdNumberFormat,
  validateIdType,
} from '../utils/idVerification';
import { screenSubmittedId } from '../services/idScreeningService';
import { performOCRFromBase64Image, verifyIDDocumentDetailed } from '../services/ocrService';

const router = Router();

const ocrBodySchema = z.object({
  image: z.string().min(1, 'Image is required'),
  language: z.string().optional(),
});

const idCheckBodySchema = z.object({
  idType: z.string().min(1, 'ID type is required'),
  idNumber: z.string().min(1, 'ID number is required'),
  frontIdImage: z.string().min(1, 'Front ID image is required'),
  backIdImage: z.string().min(1, 'Back ID image is required'),
});

function toDataUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('data:image')) {
    return trimmed;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}

router.post('/ocr', async (req: Request, res: Response) => {
  const parsed = ocrBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      text: '',
      confidence: 0,
      blocks: [],
      error: parsed.error.issues[0]?.message || 'Invalid OCR payload',
      errorCode: 'OCR_INVALID_PAYLOAD',
    });
  }

  const image = toDataUrl(parsed.data.image);
  const language = (parsed.data.language || 'eng').trim() || 'eng';

  const imageValidation = await validateBase64Image(image, {
    fieldName: 'OCR image',
    maxBytes: 4 * 1024 * 1024,
    minWidth: 160,
    minHeight: 80,
    maxWidth: 5000,
    maxHeight: 5000,
  });

  if (!imageValidation.ok) {
    return res.status(400).json({
      success: false,
      text: '',
      confidence: 0,
      blocks: [],
      error: imageValidation.message,
      errorCode: 'OCR_IMAGE_INVALID',
    });
  }

  try {
    const result = await performOCRFromBase64Image(image, language);

    return res.json({
      success: true,
      text: result.text,
      confidence: result.confidence,
      blocks: result.blocks,
      languageUsed: result.languageUsed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      text: '',
      confidence: 0,
      blocks: [],
      error: error instanceof Error ? error.message : 'OCR failed',
      errorCode: 'OCR_PROCESSING_FAILED',
    });
  }
});

router.post('/verify-document', async (req: Request, res: Response) => {
  const { image, idType, expectedIdNumber } = req.body;
  if (!image) {
    return res.status(400).json({ success: false, message: 'Image is required' });
  }

  const result = await verifyIDDocumentDetailed(image, idType, expectedIdNumber);
  if (result) {
    return res.json({ success: true, verification: result });
  }

  // Graceful fallback to OCR text analysis
  const ocrResult = await performOCRFromBase64Image(image, 'eng+fil', idType);
  return res.json({
    success: true,
    verification: {
      isValidId: ocrResult.confidence > 0.35 && ocrResult.text.length > 15,
      confidence: Math.round(ocrResult.confidence * 100),
      hasPortraitFace: true,
      aspectRatioValid: true,
      extractedIdNumber: null,
      detectedKeywords: [],
      reasons: ['Processed using fallback OCR engine.'],
      rawText: ocrResult.text,
    },
  });
});

router.post('/id-check', async (req: Request, res: Response) => {
  const parsed = idCheckBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message || 'Invalid ID screening payload',
      errorCode: 'ID_SCREENING_INVALID_PAYLOAD',
    });
  }

  const { idType, idNumber, frontIdImage, backIdImage } = parsed.data;
  const normalizedIdNumber = normalizeIdNumber(idType, idNumber);

  if (!validateIdType(idType)) {
    return res.status(400).json({
      success: false,
      message: 'Unsupported ID type selected.',
      errorCode: 'ID_TYPE_UNSUPPORTED',
      field: 'idType',
    });
  }

  if (!validateIdNumberFormat(idType, normalizedIdNumber)) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid ID number for the selected ID type.',
      errorCode: 'ID_NUMBER_INVALID_FORMAT',
      field: 'idNumber',
    });
  }

  try {
    const screening = await screenSubmittedId({
      idType,
      idNumber: normalizedIdNumber,
      frontIdImage,
      backIdImage,
    });

    return res.json({
      success: true,
      screening,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ID screening failed';
    const normalized = message.toLowerCase();
    const field = normalized.includes('front')
      ? 'frontIdImage'
      : normalized.includes('back')
        ? 'backIdImage'
        : normalized.includes('type')
          ? 'idType'
          : normalized.includes('number')
            ? 'idNumber'
            : undefined;

    return res.status(400).json({
      success: false,
      message,
      errorCode: 'ID_SCREENING_FAILED',
      field,
    });
  }
});

const processIdBodySchema = z.object({
  frontIdImage: z.string().min(1, 'Front ID image is required'),
  backIdImage: z.string().optional(),
  idType: z.string().min(1, 'ID type is required'),
  userEnteredIdNumber: z.string().min(1, 'User entered ID number is required'),
  userEnteredFullName: z.string().optional(),
  clientQualityScore: z.number().optional(),
});

router.post('/process-id', async (req: Request, res: Response) => {
  const parsed = processIdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      decision: 'REVIEW',
      finalScore: 0,
      scoreBreakdown: {
        imageQualityScore: 0,
        ocrConfidenceScore: 0,
        documentMatchScore: 0,
        idNumberMatchScore: 0,
      },
      extractedData: null,
      feedbackMessage: parsed.error.issues[0]?.message || 'Invalid payload provided for ID process verification.',
      warnings: [],
      errors: [parsed.error.issues[0]?.message || 'Invalid payload'],
    });
  }

  const { frontIdImage, backIdImage, idType, userEnteredIdNumber, clientQualityScore } = parsed.data;
  const normalizedIdNumber = normalizeIdNumber(idType, userEnteredIdNumber);

  try {
    const formattedFront = toDataUrl(frontIdImage);
    const formattedBack = backIdImage ? toDataUrl(backIdImage) : formattedFront;

    const screening = await screenSubmittedId({
      idType,
      idNumber: normalizedIdNumber,
      frontIdImage: formattedFront,
      backIdImage: formattedBack,
    });

    // Multi-factor confidence calculation (Quality: 25%, OCR: 30%, Document: 20%, ID Match: 25%)
    const qualityFactor = Math.min(100, Math.max(0, (clientQualityScore ?? (screening.qualityScore * 100))));
    const ocrFactor = Math.min(100, Math.max(0, Math.round(screening.ocrConfidence * 100)));
    const docMatchFactor = screening.typeMatch === false ? 0 : Math.min(100, Math.max(0, Math.round(screening.typeConfidence * 100)));
    const idMatchFactor = screening.idNumberMatch === true ? 100 : (screening.idNumberMatch === false ? 10 : 50);

    const weightedScore = Math.round(
      (0.25 * qualityFactor) +
      (0.30 * ocrFactor) +
      (0.20 * docMatchFactor) +
      (0.25 * idMatchFactor)
    );

    // Decision Logic
    let decision: 'PASS' | 'REVIEW' | 'BLOCK' = screening.decision;
    let feedbackMessage = 'ID verified successfully!';

    if (decision === 'PASS' && weightedScore < 75) {
      decision = 'REVIEW';
    }

    if (decision === 'PASS') {
      feedbackMessage = 'ID successfully verified and matched!';
    } else if (decision === 'REVIEW') {
      feedbackMessage = screening.warnings[0] || 'Image quality or OCR confidence is moderate. ID uploaded for manual administrative review.';
    } else {
      feedbackMessage = screening.reasons[0] || 'Document screening failed due to mismatched ID details.';
    }

    return res.json({
      success: true,
      decision,
      finalScore: weightedScore,
      scoreBreakdown: {
        imageQualityScore: qualityFactor,
        ocrConfidenceScore: ocrFactor,
        documentMatchScore: docMatchFactor,
        idNumberMatchScore: idMatchFactor,
      },
      extractedData: {
        fullName: null,
        idNumber: screening.extractedIdNumber,
        idTypeDetected: screening.detectedIdType,
        rawText: screening.rawTextPreview,
      },
      feedbackMessage,
      warnings: screening.warnings,
      errors: screening.reasons,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[VerificationRoute] /process-id error:', error);
    return res.status(200).json({
      success: true,
      decision: 'REVIEW',
      finalScore: 50,
      scoreBreakdown: {
        imageQualityScore: clientQualityScore ?? 50,
        ocrConfidenceScore: 30,
        documentMatchScore: 50,
        idNumberMatchScore: 50,
      },
      extractedData: null,
      feedbackMessage: 'Your ID has been submitted for manual administrative review.',
      warnings: ['OCR processing warning: Image submitted for manual verification.'],
      errors: [],
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'verification',
    ocr: 'ready',
    idCheck: 'ready',
    timestamp: new Date().toISOString(),
  });
});

export default router;
