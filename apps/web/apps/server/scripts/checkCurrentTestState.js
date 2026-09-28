const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const resident = await db.collection('residents').findOne({ mobileNumber: '09766532401' });
  console.log('RESIDENT:', resident ? { id: resident._id, name: resident.fullName, mobile: resident.mobileNumber, qr: resident.qrCode, barangay: resident.barangay } : 'null');

  const household = await db.collection('households').findOne({
    $or: [{ contactNumber: '09766532401' }, { headOfFamily: /Emmanuel/i }]
  });
  console.log('HOUSEHOLD:', household ? { id: household._id, head: household.headOfFamily, contact: household.contactNumber, qrCode: household.qrCode, barangay: household.barangay } : 'null');

  const dists = await db.collection('distributions').find({ barangay: 'Poblacion', archivedAt: null }).toArray();
  console.log('DISTRIBUTIONS:', dists.map(d => ({ id: d._id, name: d.name, scheduled: d.scheduled, endsAt: d.endsAt, requiresBeneficiaryApproval: d.requiresBeneficiaryApproval })));

  const proofs = await db.collection('beneficiaryproofs').find({}).toArray();
  console.log('BENEFICIARY_PROOFS:', proofs.map(p => ({ id: p._id, residentId: p.residentHouseholdId, status: p.status })));

  const proofSubs = await db.collection('proofsubmissions').find({}).toArray();
  console.log('PROOF_SUBMISSIONS:', proofSubs.map(p => ({ id: p._id, residentId: p.residentId, status: p.status })));

  const elig = await db.collection('reliefeligibilities').find({}).toArray();
  console.log('RELIEF_ELIGIBILITIES:', elig.map(e => ({ id: e._id, householdId: e.householdId, isEligible: e.isEligible })));

  const benElig = await db.collection('beneficiaryeligibilities').find({}).toArray();
  console.log('BENEFICIARY_ELIGIBILITIES:', benElig.map(e => ({ id: e._id, residentId: e.residentId, distId: e.distributionId, status: e.status, proofStatus: e.proofStatus, regStatus: e.registrationStatus })));

  const claims = await db.collection('claims').find({}).toArray();
  console.log('CLAIMS:', claims.map(c => ({ id: c._id, residentId: c.residentId, distId: c.distributionId, status: c.status })));

  await mongoose.disconnect();
}
main().catch(console.error);
