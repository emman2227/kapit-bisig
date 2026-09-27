import { createHash } from 'crypto';
import {
  SUPPORTED_ID_TYPES,
  SupportedIdType,
  normalizeIdNumber,
  validateIdNumberFormat,
  validateIdType,
} from '../utils/idVerification';
import { validateBase64Image } from '../validation/imageValidation';
import { OCRServiceResult, performOCRFromBase64Image } from './ocrService';

export type IdScreeningDecision = 'PASS' | 'REVIEW' | 'BLOCK';

export interface IdScreeningResult {
  decision: IdScreeningDecision;
  screeningConfidence: number;
  requiresManualReview: boolean;
  enteredIdType: string;
  enteredIdNumber: string;
  detectedIdType: string | null;
  typeMatch: boolean | null;
  typeConfidence: number;
  extractedIdNumber: string | null;
  extractedIdNumberMasked: string | null;
  idNumberMatch: boolean | null;
  ocrConfidence: number;
  qualityScore: number;
  reasons: string[];
  warnings: string[];
  reviewFlags: string[];
  limitations: string[];
  rawTextPreview: string;
  ocrEngine?: string;
  isLegitimateGovernmentId?: boolean;
  detectedKeywords?: string[];
}

export interface AnalyzeIdScreeningInput {
  enteredIdType: string;
  enteredIdNumber: string;
  frontText: string;
  backText: string;
  frontOcrConfidence: number;
  backOcrConfidence: number;
  frontWidth?: number;
  frontHeight?: number;
  backWidth?: number;
  backHeight?: number;
  ocrEngine?: string;
  isLegitimateGovernmentId?: boolean;
  detectedKeywords?: string[];
  verificationReasons?: string[];
}

interface TypeRule {
  keywords: string[];
  numberPattern: RegExp;
}

interface NumberCandidate {
  raw: string;
  normalized: string;
  isFormatValid: boolean;
}

// ============================================
// OCR-aware character substitution and fuzzy matching
// ============================================

/**
 * Common OCR misread characters.
 * Tesseract frequently confuses visually similar characters, especially
 * on low-contrast ID card backgrounds.
 */
const OCR_CHAR_SUBSTITUTIONS: Record<string, string> = {
  O: '0',
  D: '0',
  I: '1',
  l: '1',
  S: '5',
  B: '8',
  Z: '2',
  G: '6',
  T: '7',
  A: '4',
};

/**
 * Apply common OCR character corrections to a digit string.
 * Replaces frequently mis-recognized letters with their digit equivalents.
 */
function applyOcrCharCorrections(value: string): string {
  return value
    .split('')
    .map((ch) => OCR_CHAR_SUBSTITUTIONS[ch] || ch)
    .join('');
}

/**
 * Calculate Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Compare two ID numbers with OCR-error tolerance.
 *
 * 1. Try exact match first.
 * 2. Apply OCR character corrections and retry.
 * 3. If still no exact match and the number is 8+ digits, allow
 *    a Levenshtein distance of 1 (for single-character OCR errors).
 *    For 12+ digits, allow a distance of 2.
 */
function fuzzyIdNumberMatch(extracted: string, entered: string): boolean {
  if (extracted === entered) return true;

  const corrected = applyOcrCharCorrections(extracted);
  if (corrected === entered) return true;

  // For very short IDs, don't allow fuzzy matching — too risky
  if (entered.length < 8) return false;

  const maxDistance = entered.length >= 12 ? 2 : 1;
  return levenshteinDistance(corrected, entered) <= maxDistance;
}

/**
 * Fuzzy keyword matching that tolerates 1-2 OCR character errors per word.
 * E.g., "PHIUPPINE" matches "PHILIPPINE", "LI0ENSE" matches "LICENSE".
 */
function fuzzyKeywordMatch(text: string, keyword: string): boolean {
  if (text.includes(keyword)) return true;

  // For short keywords (≤4 chars), require exact match
  if (keyword.length <= 4) return false;

  // Check if any word in the text is within edit distance 2 of the keyword
  const words = text.split(/\s+/);
  const maxDistance = keyword.length >= 8 ? 2 : 1;
  for (const word of words) {
    // Only compare words of roughly similar length to the keyword
    if (Math.abs(word.length - keyword.length) > maxDistance) continue;
    if (levenshteinDistance(word, keyword) <= maxDistance) return true;
  }

  return false;
}

const DEFAULT_LIMITATIONS = [
  'Automated screening does not prove official issuer authenticity.',
  'OCR can fail on glare, blur, crop, compression, or damaged IDs.',
  'Final acceptance still requires admin review.',
];

interface CachedIdScreening {
  expiresAt: number;
  result: IdScreeningResult;
}

const ID_SCREENING_CACHE_TTL_MS = 30 * 60 * 1000;
const ID_SCREENING_CACHE_MAX_ENTRIES = 250;
const idScreeningCache = new Map<string, CachedIdScreening>();

function cloneScreeningResult(result: IdScreeningResult): IdScreeningResult {
  return {
    ...result,
    reasons: [...result.reasons],
    warnings: [...result.warnings],
    reviewFlags: [...result.reviewFlags],
    limitations: [...result.limitations],
  };
}

function buildScreeningCacheKey(input: {
  idType: string;
  idNumber: string;
  frontIdImage: string;
  backIdImage: string;
}): string {
  return createHash('sha256')
    .update(input.idType)
    .update('\0' + input.idNumber)
    .update('\0' + input.frontIdImage)
    .update('\0' + input.backIdImage)
    .digest('hex');
}

function getCachedScreening(key: string): IdScreeningResult | null {
  const cached = idScreeningCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    idScreeningCache.delete(key);
    return null;
  }
  return cloneScreeningResult(cached.result);
}

function cacheScreening(key: string, result: IdScreeningResult): void {
  const now = Date.now();
  for (const [cachedKey, value] of idScreeningCache) {
    if (value.expiresAt <= now) idScreeningCache.delete(cachedKey);
  }

  if (idScreeningCache.size >= ID_SCREENING_CACHE_MAX_ENTRIES) {
    const oldestKey = idScreeningCache.keys().next().value;
    if (oldestKey) idScreeningCache.delete(oldestKey);
  }

  idScreeningCache.set(key, {
    expiresAt: now + ID_SCREENING_CACHE_TTL_MS,
    result: cloneScreeningResult(result),
  });
}

const TYPE_RULES: Record<SupportedIdType, TypeRule> = {
  'PhilSys ID': {
    keywords: [
      'PHILIPPINE',
      'NATIONAL',
      'IDENTIFICATION',
      'PHILSYS',
      'PCN',
      'PAMBANSANG',
      'PAGKAKAKILANLAN',
      'REPUBLIKA',
      'PILIPINAS',
    ],
    numberPattern: /\d{4}[-\s]?\d{4}[-\s]?\d{4}(?:[-\s]?\d{4})?/g,
  },
  'Philippine National ID': {
    keywords: [
      'PHILIPPINE',
      'NATIONAL',
      'IDENTIFICATION',
      'PHILSYS',
      'PCN',
      'PAMBANSANG',
      'PAGKAKAKILANLAN',
      'REPUBLIKA',
      'PILIPINAS',
    ],
    numberPattern: /\d{4}[-\s]?\d{4}[-\s]?\d{4}(?:[-\s]?\d{4})?/g,
  },
  "Driver's License": {
    keywords: ['DRIVER', 'LICENSE', 'LTO', 'LAND', 'TRANSPORTATION'],
    numberPattern: /[A-Z]\d{2}[-\s]?\d{2}[-\s]?\d{6}/g,
  },
  Passport: {
    keywords: ['PASSPORT', 'PHILIPPINES', 'REPUBLIC', 'DFA'],
    numberPattern: /[A-Z]\d{7}/g,
  },
  'SSS ID': {
    keywords: ['SSS', 'SOCIAL', 'SECURITY', 'SYSTEM'],
    numberPattern: /\d{2}[-\s]?\d{7}[-\s]?\d{1}/g,
  },
  'PhilHealth ID': {
    keywords: ['PHILHEALTH', 'HEALTH', 'INSURANCE'],
    numberPattern: /\d{4}[-\s]?\d{4}[-\s]?\d{4}/g,
  },
  "Voter's ID": {
    keywords: ['VOTER', 'COMELEC', 'COMMISSION', 'ELECTIONS'],
    // Tightened: require at least one digit to avoid matching random text
    // like "REPUBLIC" or "COMMISSION" as ID numbers
    numberPattern: /(?=[A-Z0-9]*\d)[A-Z0-9]{6,25}/g,
  },
};

function canonicalizeIdType(idType: string): SupportedIdType | null {
  if (idType === 'Philippine National ID') {
    return 'PhilSys ID';
  }
  return SUPPORTED_ID_TYPES.includes(idType as SupportedIdType)
    ? (idType as SupportedIdType)
    : null;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(clamp(value) * 100) / 100;
}

function collapseWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function maskIdNumber(value: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) {
    return `****${trimmed}`;
  }
  return `${'*'.repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

function computeAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeImageDimensionScore(width?: number, height?: number): number {
  if (!width || !height) return 0.5;
  const normalizedWidth = clamp(width / 1200);
  const normalizedHeight = clamp(height / 800);
  return roundScore((normalizedWidth + normalizedHeight) / 2);
}

function computeQualityScore(input: AnalyzeIdScreeningInput): number {
  const dimensionScore = computeAverage([
    computeImageDimensionScore(input.frontWidth, input.frontHeight),
    computeImageDimensionScore(input.backWidth, input.backHeight),
  ]);
  const ocrScore = clamp(
    computeAverage([
      clamp(input.frontOcrConfidence),
      clamp(input.backOcrConfidence),
    ]),
  );

  return roundScore(dimensionScore * 0.45 + ocrScore * 0.55);
}

function scoreIdType(text: string, idType: SupportedIdType): number {
  const canonicalType = canonicalizeIdType(idType) || idType;
  const rule = TYPE_RULES[canonicalType];
  if (!rule) return 0;

  const upperText = String(text || '').toUpperCase();
  if (!upperText) return 0;

  // Use fuzzy keyword matching to tolerate OCR misreadings
  // (e.g., "PHIUPPINE" → "PHILIPPINE", "LI0ENSE" → "LICENSE")
  const keywordHits = rule.keywords.filter((keyword) =>
    fuzzyKeywordMatch(upperText, keyword),
  ).length;
  const keywordScore = keywordHits / rule.keywords.length;

  const patternMatches = Array.from(upperText.matchAll(rule.numberPattern))
    .map((match) => normalizeIdNumber(canonicalType, match[0]))
    .filter((candidate) => validateIdNumberFormat(canonicalType, candidate));
  const patternScore = patternMatches.length > 0 ? 1 : 0;

  return roundScore(keywordScore * 0.65 + patternScore * 0.35);
}

function detectLikelyIdType(text: string): { detectedIdType: string | null; confidence: number } {
  let bestType: string | null = null;
  let bestScore = 0;

  for (const idType of SUPPORTED_ID_TYPES) {
    const score = scoreIdType(text, idType);
    if (score > bestScore) {
      bestType = canonicalizeIdType(idType) || idType;
      bestScore = score;
    }
  }

  if (!bestType || bestScore < 0.35) {
    return { detectedIdType: null, confidence: roundScore(bestScore) };
  }

  return {
    detectedIdType: bestType,
    confidence: roundScore(bestScore),
  };
}

function extractNumberCandidates(text: string, idType: SupportedIdType): NumberCandidate[] {
  const canonicalType = canonicalizeIdType(idType) || idType;
  const rule = TYPE_RULES[canonicalType];
  if (!rule) return [];

  const seen = new Set<string>();
  const upperText = String(text || '').toUpperCase();
  const correctedText = applyOcrCharCorrections(upperText);

  // Search in both raw OCR text and OCR-corrected text
  const rawMatches = Array.from(upperText.matchAll(rule.numberPattern));
  const correctedMatches = Array.from(correctedText.matchAll(rule.numberPattern));
  const allMatches = [...rawMatches, ...correctedMatches];

  const candidates: NumberCandidate[] = [];

  for (const match of allMatches) {
    const raw = String(match[0] || '').trim();
    if (!raw) continue;

    const normalized = normalizeIdNumber(canonicalType, raw);
    if (!normalized) continue;
    if (canonicalType === "Voter's ID" && !/\d/.test(normalized)) {
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    candidates.push({
      raw,
      normalized,
      isFormatValid: validateIdNumberFormat(canonicalType, normalized),
    });
  }

  return candidates;
}

function pickBestCandidate(
  candidates: NumberCandidate[],
  enteredNormalizedIdNumber: string,
): NumberCandidate | null {
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((left, right) => {
    const leftMatch = fuzzyIdNumberMatch(left.normalized, enteredNormalizedIdNumber);
    const rightMatch = fuzzyIdNumberMatch(right.normalized, enteredNormalizedIdNumber);

    const leftScore =
      (leftMatch ? 100 : 0) +
      (left.isFormatValid ? 25 : 0) +
      left.normalized.length;
    const rightScore =
      (rightMatch ? 100 : 0) +
      (right.isFormatValid ? 25 : 0) +
      right.normalized.length;
    return rightScore - leftScore;
  });

  return ranked[0] || null;
}

function buildReasonsAndWarnings(params: {
  enteredIdType: SupportedIdType;
  detectedIdType: string | null;
  typeConfidence: number;
  extractedCandidate: NumberCandidate | null;
  idNumberMatch: boolean | null;
  ocrConfidence: number;
  qualityScore: number;
  ocrEngine?: string;
  isLegitimateGovernmentId?: boolean;
  verificationReasons?: string[];
}): Pick<IdScreeningResult, 'decision' | 'reasons' | 'warnings' | 'reviewFlags'> {
  const {
    enteredIdType,
    detectedIdType,
    typeConfidence,
    extractedCandidate,
    idNumberMatch,
    ocrConfidence,
    qualityScore,
    ocrEngine,
    isLegitimateGovernmentId,
    verificationReasons,
  } = params;

  const reasons: string[] = [];
  const warnings: string[] = [];
  const reviewFlags: string[] = [];

  if (isLegitimateGovernmentId === false) {
    reviewFlags.push('AI_LEGITIMACY_FAILED');
    const note =
      verificationReasons?.find((r) => {
        const lower = r.toLowerCase();
        return !lower.includes('ratio') && !lower.includes('aspect') && !lower.includes('dimension');
      }) ||
      'The document type could not be confirmed with high confidence.';
    reasons.push(note);
    warnings.push(note);
  }

  const strongTypeMismatch =
    !!detectedIdType &&
    detectedIdType !== enteredIdType &&
    typeConfidence >= 0.78;

  // A number mismatch is only safe to block when the OCR also identified the
  // selected document type with strong confidence and the source image was
  // clear. Otherwise a valid ID can be rejected because OCR selected another
  // number printed on the card or misread several characters. Those cases are
  // sent to the existing admin review queue instead.
  const strongIdMismatch =
    detectedIdType === enteredIdType &&
    typeConfidence >= 0.7 &&
    extractedCandidate?.isFormatValid === true &&
    idNumberMatch === false &&
    ocrConfidence >= 0.7 &&
    qualityScore >= 0.65;

  const uncertainIdMismatch =
    extractedCandidate?.isFormatValid === true &&
    idNumberMatch === false &&
    !strongIdMismatch;

  if (strongTypeMismatch) {
    reviewFlags.push('TYPE_MISMATCH');
    reasons.push(`The uploaded ID appears to be ${detectedIdType}, not ${enteredIdType}.`);
  }

  if (strongIdMismatch) {
    reviewFlags.push('ID_NUMBER_MISMATCH');
    reasons.push('The ID number read from the uploaded ID does not match the ID number entered.');
  }

  if (uncertainIdMismatch) {
    reviewFlags.push('ID_NUMBER_UNCERTAIN');
    warnings.push('The ID number could not be matched reliably. Staff will compare the uploaded ID during review.');
  }

  if (ocrConfidence < 0.3) {
    reviewFlags.push('LOW_OCR_CONFIDENCE');
    warnings.push('OCR confidence is low. Please avoid glare, blur, or cropped images.');
  }

  if (!detectedIdType || typeConfidence < 0.45) {
    reviewFlags.push('DOCUMENT_TYPE_LOW_CONFIDENCE');
    warnings.push('The document type could not be confirmed with high confidence.');
  }

  if (!extractedCandidate) {
    reviewFlags.push('OCR_ID_NUMBER_UNREADABLE');
    warnings.push('The system could not confidently read the ID number from the upload.');
  }

  if (qualityScore < 0.45) {
    reviewFlags.push('LOW_IMAGE_QUALITY');
    warnings.push('The uploaded ID images may be too small or unclear for reliable screening.');
  }

  if (strongTypeMismatch || strongIdMismatch) {
    return {
      decision: 'BLOCK',
      reasons,
      warnings,
      reviewFlags,
    };
  }

  if (
    detectedIdType === enteredIdType &&
    typeConfidence >= 0.45 &&
    idNumberMatch === true &&
    qualityScore >= 0.45 &&
    ocrConfidence >= 0.25
  ) {
    reasons.push('The uploaded ID passed automated screening.');
    return {
      decision: 'PASS',
      reasons,
      warnings,
      reviewFlags,
    };
  }

  reasons.push(
    'Some ID details could not be verified automatically. Don’t worry—our barangay staff will review your ID card during validation.',
  );
  return {
    decision: 'REVIEW',
    reasons,
    warnings,
    reviewFlags,
  };
}

function computeScreeningConfidence(params: {
  typeMatch: boolean | null;
  typeConfidence: number;
  idNumberMatch: boolean | null;
  extractedCandidate: NumberCandidate | null;
  ocrConfidence: number;
  qualityScore: number;
}): number {
  const {
    typeMatch,
    typeConfidence,
    idNumberMatch,
    extractedCandidate,
    ocrConfidence,
    qualityScore,
  } = params;

  const typeScore =
    typeMatch === true
      ? Math.max(0.5, typeConfidence)
      : typeMatch === false
        ? 0
        : 0.35;
  const idNumberScore =
    idNumberMatch === true
      ? 1
      : idNumberMatch === false
        ? extractedCandidate?.isFormatValid
          ? 0
          : 0.2
        : 0.25;

  return roundScore(
    typeScore * 0.25 +
    idNumberScore * 0.45 +
    clamp(ocrConfidence) * 0.15 +
    clamp(qualityScore) * 0.15,
  );
}

function buildRawTextPreview(frontText: string, backText: string): string {
  return collapseWhitespace(`${frontText}\n${backText}`).slice(0, 180);
}

export function analyzeIdScreeningFromOcr(
  input: AnalyzeIdScreeningInput,
): IdScreeningResult {
  const canonicalEnteredIdType = canonicalizeIdType(input.enteredIdType);
  if (!canonicalEnteredIdType) {
    throw new Error('Unsupported ID type selected.');
  }

  const enteredNormalizedIdNumber = normalizeIdNumber(
    canonicalEnteredIdType,
    input.enteredIdNumber,
  );

  if (!validateIdNumberFormat(canonicalEnteredIdType, enteredNormalizedIdNumber)) {
    throw new Error('Entered ID number format is invalid for the selected ID type.');
  }

  const combinedText = collapseWhitespace(`${input.frontText}\n${input.backText}`);
  const { detectedIdType, confidence: typeConfidence } = detectLikelyIdType(combinedText);
  const typeMatch = detectedIdType ? detectedIdType === canonicalEnteredIdType : null;

  const extractedCandidate = pickBestCandidate(
    extractNumberCandidates(combinedText, canonicalEnteredIdType),
    enteredNormalizedIdNumber,
  );

  // Use fuzzy matching with OCR error correction instead of strict ===
  // This handles common OCR misreads like O↔0, I↔1, S↔5, B↔8
  const idNumberMatch = extractedCandidate
    ? fuzzyIdNumberMatch(extractedCandidate.normalized, enteredNormalizedIdNumber)
    : null;
  const ocrConfidence = roundScore(
    computeAverage([
      clamp(input.frontOcrConfidence),
      clamp(input.backOcrConfidence),
    ]),
  );
  const qualityScore = computeQualityScore(input);

  const { decision, reasons, warnings, reviewFlags } = buildReasonsAndWarnings({
    enteredIdType: canonicalEnteredIdType,
    detectedIdType,
    typeConfidence,
    extractedCandidate,
    idNumberMatch,
    ocrConfidence,
    qualityScore,
    ocrEngine: input.ocrEngine,
    isLegitimateGovernmentId: input.isLegitimateGovernmentId,
    verificationReasons: input.verificationReasons,
  });

  return {
    decision,
    ocrEngine: input.ocrEngine || 'RapidOCR PP-OCRv4 (AI)',
    isLegitimateGovernmentId: input.isLegitimateGovernmentId,
    detectedKeywords: input.detectedKeywords || [],
    screeningConfidence: computeScreeningConfidence({
      typeMatch,
      typeConfidence,
      idNumberMatch,
      extractedCandidate,
      ocrConfidence,
      qualityScore,
    }),
    requiresManualReview: decision !== 'PASS',
    enteredIdType: canonicalEnteredIdType,
    enteredIdNumber: enteredNormalizedIdNumber,
    detectedIdType,
    typeMatch,
    typeConfidence,
    extractedIdNumber: extractedCandidate?.normalized || null,
    extractedIdNumberMasked: maskIdNumber(extractedCandidate?.normalized || null),
    idNumberMatch,
    ocrConfidence,
    qualityScore,
    reasons,
    warnings,
    reviewFlags,
    limitations: DEFAULT_LIMITATIONS,
    rawTextPreview: buildRawTextPreview(input.frontText, input.backText),
  };
}

function buildScreeningInputFromOcr(params: {
  idType: string;
  idNumber: string;
  frontValidation: { width: number; height: number };
  backValidation: { width: number; height: number };
  frontOcr: OCRServiceResult;
  backOcr: OCRServiceResult;
}): AnalyzeIdScreeningInput {
  const ocrEngine = params.frontOcr.languageUsed === 'rapidocr-onnx' ? 'RapidOCR PP-OCRv4 (AI)' : 'Tesseract (Fallback)';
  return {
    enteredIdType: params.idType,
    enteredIdNumber: params.idNumber,
    frontText: params.frontOcr.text,
    backText: params.backOcr.text,
    frontOcrConfidence: params.frontOcr.confidence,
    backOcrConfidence: params.backOcr.confidence,
    frontWidth: params.frontValidation.width,
    frontHeight: params.frontValidation.height,
    backWidth: params.backValidation.width,
    backHeight: params.backValidation.height,
    ocrEngine,
    isLegitimateGovernmentId: params.frontOcr.isLegitimateId,
    detectedKeywords: params.frontOcr.detectedKeywords,
    verificationReasons: params.frontOcr.verificationReasons,
  };
}

export async function screenSubmittedId(input: {
  idType: string;
  idNumber: string;
  frontIdImage: string;
  backIdImage: string;
}): Promise<IdScreeningResult> {
  if (!validateIdType(input.idType)) {
    throw new Error('Unsupported ID type selected.');
  }

  const normalizedEnteredIdNumber = normalizeIdNumber(input.idType, input.idNumber || '');
  if (!validateIdNumberFormat(input.idType, normalizedEnteredIdNumber)) {
    throw new Error('Entered ID number format is invalid for the selected ID type.');
  }

  const cacheKey = buildScreeningCacheKey({
    idType: input.idType,
    idNumber: normalizedEnteredIdNumber,
    frontIdImage: input.frontIdImage,
    backIdImage: input.backIdImage,
  });
  const cachedScreening = getCachedScreening(cacheKey);
  if (cachedScreening) {
    return cachedScreening;
  }

  const [frontValidation, backValidation] = await Promise.all([
    validateBase64Image(input.frontIdImage, {
      fieldName: 'Front ID image',
      maxBytes: 2 * 1024 * 1024,
      minWidth: 200,
      minHeight: 200,
      maxWidth: 4096,
      maxHeight: 4096,
    }),
    validateBase64Image(input.backIdImage, {
      fieldName: 'Back ID image',
      maxBytes: 2 * 1024 * 1024,
      minWidth: 200,
      minHeight: 200,
      maxWidth: 4096,
      maxHeight: 4096,
    }),
  ]);

  if (!frontValidation.ok) {
    throw new Error(frontValidation.message);
  }
  if (!backValidation.ok) {
    throw new Error(backValidation.message);
  }

  const [frontOcr, backOcr] = await Promise.all([
    performOCRFromBase64Image(input.frontIdImage, 'eng+fil', input.idType),
    performOCRFromBase64Image(input.backIdImage, 'eng+fil', input.idType),
  ]);

  const activeEngine = frontOcr.languageUsed === 'rapidocr-onnx' ? 'RapidOCR PP-OCRv4 (AI)' : 'Tesseract (Fallback)';
  console.log(`\n========================================`);
  console.log(`[ID-Screening] Active Engine: ${activeEngine}`);
  console.log(`[ID-Screening] Valid Govt ID: ${frontOcr.isLegitimateId}`);
  console.log(`[ID-Screening] Keywords: ${JSON.stringify(frontOcr.detectedKeywords || [])}`);
  console.log(`[ID-Screening] AI Reasons: ${JSON.stringify(frontOcr.verificationReasons || [])}`);
  console.log(`========================================\n`);

  const screening = analyzeIdScreeningFromOcr(
    buildScreeningInputFromOcr({
      idType: input.idType,
      idNumber: normalizedEnteredIdNumber,
      frontValidation,
      backValidation,
      frontOcr,
      backOcr,
    }),
  );

  cacheScreening(cacheKey, screening);
  return screening;
}
