import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { checkDuplicateFace } from '../services/duplicateFaceService';

async function testDuplicateCheck() {
  console.log('--- Testing checkDuplicateFace integration ---');

  // Find a test image file
  const testDir = path.resolve(__dirname, '../../public/uploads/resident-verification');
  const files = fs.readdirSync(testDir).filter((f) => f.startsWith('face-') && f.endsWith('.jpg'));

  if (files.length === 0) {
    console.log('No test face files found in uploads');
    return;
  }

  const testFile = path.join(testDir, files[0]);
  console.log('Testing with image:', files[0]);
  const imgBuffer = fs.readFileSync(testFile);
  const base64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;

  const result = await checkDuplicateFace(base64);
  console.log('checkDuplicateFace Result:', {
    isDuplicate: result.isDuplicate,
    matchedResident: result.matchedResident,
    similarity: result.similarity,
    totalCompared: result.totalCompared,
    processingTime: result.processingTime,
  });

  console.log('--- Test Completed Successfully ---');
}

testDuplicateCheck().catch(console.error);
