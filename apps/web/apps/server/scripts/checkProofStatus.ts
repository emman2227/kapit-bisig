import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import mongoose from 'mongoose';
import ProofSubmission from '../models/ProofSubmission';
import DisasterEvent from '../models/DisasterEvent';

async function check() {
  await mongoose.connect(process.env.MONGODB_URI || '');
  const proofs = await ProofSubmission.find().populate('disasterEventId', 'name').lean();
  console.log('Proof submissions count:', proofs.length);
  for (const p of proofs) {
    console.log(`- ID: ${p._id}, Status: ${p.status}, Event: ${(p.disasterEventId as any)?.name}, Damage: ${p.damageType}`);
  }
  const events = await DisasterEvent.find({ status: 'Active' }, 'name barangays').lean();
  console.log('Active Events:');
  for (const ev of events) {
    console.log(`- "${ev.name}" (ID: ${ev._id}) Barangays: ${ev.barangays.join(', ')}`);
  }
  await mongoose.disconnect();
}
check().catch(console.error);
