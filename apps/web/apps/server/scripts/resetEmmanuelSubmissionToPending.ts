import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import mongoose from 'mongoose';
import ProofSubmission from '../models/ProofSubmission';
import BeneficiaryEligibility from '../models/BeneficiaryEligibility';

async function reset() {
  await mongoose.connect(process.env.MONGODB_URI || '');
  const updated = await ProofSubmission.findOneAndUpdate(
    { status: 'Approved' },
    {
      $set: {
        status: 'Pending Verification',
        rejectionReason: '',
        reviewedBy: null,
        reviewedAt: null,
      }
    },
    { new: true }
  );

  if (updated) {
    console.log(`Reset submission [${updated._id}] back to "Pending Verification".`);
    await BeneficiaryEligibility.deleteMany({ proofSubmissionId: updated._id });
  } else {
    console.log('No approved submission found to reset.');
  }

  await mongoose.disconnect();
}
reset().catch(console.error);
