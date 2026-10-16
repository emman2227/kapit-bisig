import assert from 'assert';
import { analyzeIdScreeningFromOcr } from '../services/idScreeningService';

function run(): void {
  // ==================================================
  // Original tests (must continue to pass)
  // ==================================================

  const passResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'PHILIPPINE IDENTIFICATION CARD PHILSYS PCN 1234 5678 9012 JUAN DELA CRUZ',
    backText: 'REPUBLIC OF THE PHILIPPINES',
    frontOcrConfidence: 0.88,
    backOcrConfidence: 0.52,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(passResult.decision, 'PASS');
  assert.strictEqual(passResult.idNumberMatch, true);
  assert.strictEqual(passResult.typeMatch, true);

  const typeMismatchResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'PASSPORT REPUBLIC OF THE PHILIPPINES P1234567 MANILA',
    backText: 'DEPARTMENT OF FOREIGN AFFAIRS',
    frontOcrConfidence: 0.83,
    backOcrConfidence: 0.71,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(typeMismatchResult.decision, 'BLOCK');
  assert.strictEqual(typeMismatchResult.detectedIdType, 'Passport');
  assert.ok(typeMismatchResult.reviewFlags.includes('TYPE_MISMATCH'));

  // A lower-confidence type mismatch must not PASS just because the number matches.
  const uncertainTypeMismatchResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'Passport',
    enteredIdNumber: 'P1234567',
    frontText: 'DRIVER LICENSE LTO P1234567',
    backText: '',
    frontOcrConfidence: 0.82,
    backOcrConfidence: 0.55,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(uncertainTypeMismatchResult.typeMatch, false);
  assert.strictEqual(
    uncertainTypeMismatchResult.decision,
    'REVIEW',
    'A document-type mismatch must never receive PASS',
  );

  const idMismatchResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'Passport',
    enteredIdNumber: 'P1234567',
    frontText: 'PASSPORT REPUBLIC OF THE PHILIPPINES P7654321',
    backText: 'DEPARTMENT OF FOREIGN AFFAIRS',
    frontOcrConfidence: 0.91,
    backOcrConfidence: 0.64,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(idMismatchResult.decision, 'BLOCK');
  assert.strictEqual(idMismatchResult.idNumberMatch, false);
  assert.ok(idMismatchResult.reviewFlags.includes('ID_NUMBER_MISMATCH'));

  const reviewResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilHealth ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'CARD HOLDER NAME',
    backText: 'USE FOR BENEFITS',
    frontOcrConfidence: 0.12,
    backOcrConfidence: 0.1,
    frontWidth: 640,
    frontHeight: 420,
    backWidth: 640,
    backHeight: 420,
  });
  assert.strictEqual(reviewResult.decision, 'REVIEW');
  assert.strictEqual(reviewResult.idNumberMatch, null);
  assert.ok(reviewResult.reviewFlags.includes('OCR_ID_NUMBER_UNREADABLE'));

  console.log('  ✓ Original tests passed');

  // ==================================================
  // NEW: Fuzzy ID number matching (OCR error correction)
  // ==================================================

  // Test: OCR reads "O" instead of "0" in PhilSys ID → should still PASS
  const ocrO0Result = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'PHILIPPINE IDENTIFICATION PHILSYS PCN 1234 5678 9O12 JUAN DELA CRUZ',
    backText: 'REPUBLIC OF THE PHILIPPINES',
    frontOcrConfidence: 0.75,
    backOcrConfidence: 0.52,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(ocrO0Result.decision, 'PASS', 'O↔0 OCR correction should result in PASS');
  assert.strictEqual(ocrO0Result.idNumberMatch, true, 'O↔0 should be treated as a match');
  console.log('  ✓ O↔0 OCR correction test passed');

  // Test: OCR reads "I" instead of "1" → should still PASS
  const ocrI1Result = analyzeIdScreeningFromOcr({
    enteredIdType: 'SSS ID',
    enteredIdNumber: '12-3456789-0',
    frontText: 'SSS SOCIAL SECURITY SYSTEM I2 3456789 0 MEMBER',
    backText: '',
    frontOcrConfidence: 0.68,
    backOcrConfidence: 0.1,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(ocrI1Result.decision, 'PASS', 'I↔1 OCR correction should result in PASS');
  assert.strictEqual(ocrI1Result.idNumberMatch, true, 'I↔1 should be treated as a match');
  console.log('  ✓ I↔1 OCR correction test passed');

  // Test: Single digit OCR error in 12-digit ID → should still PASS (Levenshtein ≤ 2)
  const ocrSingleDigitResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'PHILIPPINE IDENTIFICATION PHILSYS PCN 1234 5678 9013',
    backText: 'REPUBLIC OF THE PHILIPPINES',
    frontOcrConfidence: 0.70,
    backOcrConfidence: 0.52,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(ocrSingleDigitResult.decision, 'PASS', 'Single digit error should still PASS for 12-digit ID');
  assert.strictEqual(ocrSingleDigitResult.idNumberMatch, true);
  console.log('  ✓ Single digit Levenshtein tolerance test passed');

  // Test: Completely wrong ID number → should still BLOCK
  const wrongIdResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'PHILIPPINE IDENTIFICATION PHILSYS PCN 9999 8888 7777',
    backText: 'REPUBLIC OF THE PHILIPPINES',
    frontOcrConfidence: 0.88,
    backOcrConfidence: 0.52,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(wrongIdResult.decision, 'BLOCK', 'Completely wrong ID number should BLOCK');
  assert.strictEqual(wrongIdResult.idNumberMatch, false);
  console.log('  ✓ Wrong ID number still blocked');

  // A moderate-confidence OCR mismatch must not reject a resident. The same
  // valid ID can produce a noisier read depending on OCR and image quality,
  // so this is routed to the admin review queue instead.
  const noisyReadResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'PHILIPPINE IDENTIFICATION PHILSYS PCN 1234 6688 9912',
    backText: 'REPUBLIC OF THE PHILIPPINES',
    frontOcrConfidence: 0.62,
    backOcrConfidence: 0.48,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(noisyReadResult.idNumberMatch, false);
  assert.strictEqual(noisyReadResult.decision, 'REVIEW');
  assert.ok(noisyReadResult.reviewFlags.includes('ID_NUMBER_UNCERTAIN'));
  console.log('  ✓ Moderate-confidence OCR mismatch routed to review');

  // ==================================================
  // NEW: Fuzzy keyword matching (OCR misread tolerance)
  // ==================================================

  // Test: OCR misreads "PHILIPPINE" as "PHIUPPINE" → should still detect PhilSys ID
  const fuzzyKeywordResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'PHIUPPINE IDENTIFICATION PHILSYS PCN 1234 5678 9012',
    backText: 'REPUBLIC OF THE PHIUPPINES',
    frontOcrConfidence: 0.65,
    backOcrConfidence: 0.50,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(fuzzyKeywordResult.typeMatch, true, 'Fuzzy keyword matching should detect PhilSys ID');
  assert.strictEqual(fuzzyKeywordResult.decision, 'PASS');
  console.log('  ✓ Fuzzy keyword matching test passed');

  // Test: OCR misreads "LICENSE" as "LI0ENSE" → should still detect Driver's License
  const fuzzyDriverResult = analyzeIdScreeningFromOcr({
    enteredIdType: "Driver's License",
    enteredIdNumber: 'N01-23-456789',
    frontText: "DRIVER'S LI0ENSE LTO LAND N01 23 456789",
    backText: 'TRANSPORTATION',
    frontOcrConfidence: 0.60,
    backOcrConfidence: 0.40,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  assert.strictEqual(fuzzyDriverResult.typeMatch, true, 'Fuzzy keyword should detect Driver License');
  console.log('  ✓ Fuzzy keyword for Driver License test passed');

  // ==================================================
  // NEW: Voter's ID regex tightening
  // ==================================================

  // Test: Pure text should NOT match as Voter's ID number
  const voterFalsePositiveResult = analyzeIdScreeningFromOcr({
    enteredIdType: "Voter's ID",
    enteredIdNumber: 'VIN123456',
    frontText: 'VOTER COMELEC COMMISSION ELECTIONS REPUBLIC MANILA',
    backText: '',
    frontOcrConfidence: 0.75,
    backOcrConfidence: 0.10,
    frontWidth: 1280,
    frontHeight: 820,
    backWidth: 1280,
    backHeight: 820,
  });
  // The extracted candidate should not match "REPUBLIC" or "COMMISSION"
  // as valid Voter's ID numbers because the regex now requires digits
  assert.ok(
    voterFalsePositiveResult.idNumberMatch !== true ||
    voterFalsePositiveResult.decision !== 'PASS',
    "Pure text words should not pass as Voter's ID numbers",
  );
  console.log('  ✓ Voter ID regex tightening test passed');

  // ==================================================
  // NEW: Non-ID / Unrecognized Document Fast Block
  // ==================================================
  const nonIdResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'alt space enter shift control',
    backText: '',
    frontOcrConfidence: 0.1,
    backOcrConfidence: 0.0,
    frontWidth: 900,
    frontHeight: 600,
    backWidth: 900,
    backHeight: 600,
    isLegitimateGovernmentId: false,
    detectedKeywords: [],
  });
  assert.strictEqual(nonIdResult.decision, 'BLOCK', 'Non-ID photo should immediately BLOCK');
  assert.ok(nonIdResult.reviewFlags.includes('UNRECOGNIZED_DOCUMENT'), 'Should set UNRECOGNIZED_DOCUMENT flag');
  assert.ok(nonIdResult.reasons[0].includes('Unrecognized Document'), 'Reason should explain unrecognized document');
  console.log('  ✓ Non-ID fast BLOCK test passed');

  // Test: Screen photo with SMS messages / chat text
  const smsScreenResult = analyzeIdScreeningFromOcr({
    enteredIdType: 'PhilSys ID',
    enteredIdNumber: '1234-5678-9012',
    frontText: 'alt space enter shift control',
    backText: '[KapitBisig] Your registration verification code is: 208880. This code expires in 5 minutes. Do not share this code with anyone.',
    frontOcrConfidence: 0.1,
    backOcrConfidence: 0.85,
    frontWidth: 900,
    frontHeight: 600,
    backWidth: 900,
    backHeight: 600,
    isLegitimateGovernmentId: false,
    detectedKeywords: [],
  });
  assert.strictEqual(smsScreenResult.decision, 'BLOCK', 'SMS screen photo should immediately BLOCK');
  assert.ok(smsScreenResult.reviewFlags.includes('UNRECOGNIZED_DOCUMENT'), 'Should set UNRECOGNIZED_DOCUMENT flag');
  assert.ok(smsScreenResult.reasons[0].includes('Unrecognized Document'), 'Reason should explain unrecognized document');
  console.log('  ✓ Screen with SMS texts fast BLOCK test passed');
}

run();
console.log('\n✅ All idScreening unit tests passed');
