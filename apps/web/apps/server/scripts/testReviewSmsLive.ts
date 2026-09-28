import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { sendBeneficiaryReviewSms } from '../utils/beneficiaryReviewSms';

async function main() {
  console.log('Testing Approved SMS without links...');
  const resApproved = await sendBeneficiaryReviewSms({
    mobileNumber: '09766532401',
    decision: 'Approved',
    scopeName: 'Typhoon Aghon Relief Operation',
    residentName: 'Emmanuel',
  });
  console.log('Approved SMS Result:', resApproved);

  console.log('\nTesting Rejected / Needs Update SMS without links...');
  const resRejected = await sendBeneficiaryReviewSms({
    mobileNumber: '09766532401',
    decision: 'Rejected',
    scopeName: 'Typhoon Aghon Relief Operation',
    residentName: 'Emmanuel',
    rejectionReason: 'Photo is blurry. Please attach a clearer certificate.',
  });
  console.log('Rejected SMS Result:', resRejected);
}

main().catch(console.error);
