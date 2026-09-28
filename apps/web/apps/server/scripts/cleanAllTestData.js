const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function cleanAllTestData() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  console.log('Connected to database for full test cleanup.');

  // 1. Delete all distributions created for tests (or all current active/completed test distributions)
  const distDel = await db.collection('distributions').deleteMany({});
  console.log('Deleted distributions:', distDel.deletedCount);

  // 2. Delete test claims
  const claimsDel = await db.collection('claims').deleteMany({});
  console.log('Deleted claims:', claimsDel.deletedCount);

  // 3. Delete distribution claims (if any in separate collection)
  const distClaimsDel = await db.collection('distributionclaims').deleteMany({});
  console.log('Deleted distribution claims:', distClaimsDel.deletedCount);

  // 4. Delete proof submissions
  const proofsDel = await db.collection('proofsubmissions').deleteMany({});
  console.log('Deleted proof submissions:', proofsDel.deletedCount);

  // 5. Delete beneficiary proofs (legacy collection if any)
  const benProofsDel = await db.collection('beneficiaryproofs').deleteMany({});
  console.log('Deleted beneficiary proofs:', benProofsDel.deletedCount);

  // 6. Delete beneficiary eligibilities
  const benEligDel = await db.collection('beneficiaryeligibilities').deleteMany({});
  console.log('Deleted beneficiary eligibilities:', benEligDel.deletedCount);

  // 7. Delete relief eligibilities
  const reliefEligDel = await db.collection('reliefeligibilities').deleteMany({});
  console.log('Deleted relief eligibilities:', reliefEligDel.deletedCount);

  // 8. Delete scan logs
  const scanLogsDel = await db.collection('residentqrscanlogs').deleteMany({});
  console.log('Deleted scan logs:', scanLogsDel.deletedCount);

  // Verify resident accounts and QR codes are intact
  const residentCount = await db.collection('residents').countDocuments({});
  console.log('RETAINED Residents in database:', residentCount);

  const emmanuel = await db.collection('residents').findOne({ mobileNumber: '09766532401' });
  console.log('RETAINED Emmanuel De Vera QR info:', {
    id: emmanuel?._id,
    name: emmanuel?.fullName,
    code: emmanuel?.residentCode,
    qrVersion: emmanuel?.qrVersion,
    qrStatus: emmanuel?.qrStatus
  });

  console.log('Cleanup finished successfully.');
  process.exit(0);
}

cleanAllTestData().catch(console.error);
