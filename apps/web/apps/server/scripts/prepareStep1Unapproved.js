const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const resident = await db.collection('residents').findOne({ mobileNumber: '09766532401' });
  const dist = await db.collection('distributions').findOne({ _id: new mongoose.Types.ObjectId('6aba184e651189db745b6f3a') });

  // Update distribution to be live right now
  const now = new Date();
  const startTime = new Date(now.getTime() - 15 * 60 * 1000);
  const endTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  await db.collection('distributions').updateOne(
    { _id: dist._id },
    { $set: { scheduled: startTime, endsAt: endTime, status: 'Active' } }
  );
  console.log('Distribution updated to Active window.');

  // Delete any proofs and beneficiary eligibilities for Emmanuel to simulate UNAPPROVED state
  const delProofs = await db.collection('proofsubmissions').deleteMany({ residentId: resident._id });
  const delElig = await db.collection('beneficiaryeligibilities').deleteMany({ residentId: resident._id });
  const delClaims = await db.collection('claims').deleteMany({
    residentId: resident._id.toString(),
    distributionId: dist._id.toString()
  });

  console.log('RESET FOR STEP 1 (UNAPPROVED):', {
    deletedProofs: delProofs.deletedCount,
    deletedEligibilities: delElig.deletedCount,
    deletedClaims: delClaims.deletedCount
  });

  process.exit(0);
}
main().catch(console.error);
