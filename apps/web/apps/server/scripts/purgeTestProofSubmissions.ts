import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import mongoose from 'mongoose';
import ProofSubmission from '../models/ProofSubmission';
import BeneficiaryEligibility from '../models/BeneficiaryEligibility';
import DisasterEvent from '../models/DisasterEvent';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';

async function main() {
  console.log('\n--- PURGING ALL PROOF SUBMISSIONS & PREPARING CLEAN SLATE ---');
  await mongoose.connect(MONGODB_URI);

  try {
    // 1. Delete all proof submissions
    const resProofs = await ProofSubmission.deleteMany({});
    console.log(`Deleted ${resProofs.deletedCount} proof submissions.`);

    // 2. Delete all beneficiary eligibility records
    const resElig = await BeneficiaryEligibility.deleteMany({});
    console.log(`Deleted ${resElig.deletedCount} beneficiary eligibility records.`);

    // 3. Ensure Disaster Events are active and include Poblacion
    await DisasterEvent.updateMany(
      { status: 'Active' },
      { $addToSet: { barangays: 'Poblacion' } }
    );
    const events = await DisasterEvent.find({ status: 'Active' }).lean();
    console.log(`Active disaster events count: ${events.length}`);
    for (const ev of events) {
      console.log(`- Event: "${ev.name}" (ID: ${ev._id}) includes: ${ev.barangays.join(', ')}`);
    }

    console.log('\n✅ READY: All proof submissions have been wiped clean. Database is ready for resident mobile submissions.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(console.error);
