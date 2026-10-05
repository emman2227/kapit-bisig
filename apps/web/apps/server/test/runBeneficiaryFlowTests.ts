process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-chars-long-123456';
process.env.RESIDENT_QR_SECRET = process.env.RESIDENT_QR_SECRET || 'unit-test-secret-at-least-32-chars-long-123456';

import { runBeneficiaryFlowUnitTests } from './beneficiaryFlow.unit';

async function main(): Promise<void> {
  try {
    await runBeneficiaryFlowUnitTests();
    console.log('beneficiary-flow unit tests passed successfully');
    process.exit(0);
  } catch (err) {
    console.error('beneficiary-flow unit tests failed:', err);
    process.exit(1);
  }
}

void main();
