const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function approveEmmanuelClean() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const resident = await db.collection('residents').findOne({ mobileNumber: '09766532401' });
  const dist = await db.collection('distributions').findOne({ _id: new mongoose.Types.ObjectId('6aba184e651189db745b6f3a') });
  const activeEvent = await db.collection('disasterevents').findOne({ status: 'Active' });

  console.log('Target Resident:', resident._id, resident.fullName);
  console.log('Target Distribution:', dist._id);

  // Clean out any conflicting existing records first
  await db.collection('proofsubmissions').deleteMany({ residentId: resident._id });
  await db.collection('beneficiaryeligibilities').deleteMany({ residentId: resident._id });
  await db.collection('claims').deleteMany({
    residentId: resident._id.toString(),
    distributionId: dist._id.toString()
  });

  const now = new Date();

  // Insert Approved Proof Submission
  const proofRes = await db.collection('proofsubmissions').insertOne({
    residentId: resident._id,
    disasterEventId: activeEvent ? activeEvent._id : null,
    distributionId: dist._id,
    photoUrl: 'https://res.cloudinary.com/dummy/image/upload/sample.jpg',
    notes: 'Approved calamity damage proof for testing',
    status: 'Approved',
    reviewedBy: 'superadmin',
    reviewedAt: now,
    createdAt: now,
    updatedAt: now
  });
  console.log('Inserted ProofSubmission:', proofRes.insertedId);

  // Insert Distribution Eligibility
  const distEligRes = await db.collection('beneficiaryeligibilities').insertOne({
    residentId: resident._id,
    distributionId: dist._id,
    disasterEventId: null,
    proofSubmissionId: proofRes.insertedId,
    status: 'Eligible',
    registrationStatus: 'Approved',
    proofStatus: 'Approved',
    rejectionReason: '',
    reviewedBy: 'superadmin',
    reviewedAt: now,
    createdAt: now,
    updatedAt: now
  });
  console.log('Inserted Distribution BeneficiaryEligibility:', distEligRes.insertedId);

  // Insert Event Eligibility if active event exists
  if (activeEvent) {
    const eventEligRes = await db.collection('beneficiaryeligibilities').insertOne({
      residentId: resident._id,
      distributionId: null,
      disasterEventId: activeEvent._id,
      proofSubmissionId: proofRes.insertedId,
      status: 'Eligible',
      registrationStatus: 'Approved',
      proofStatus: 'Approved',
      rejectionReason: '',
      reviewedBy: 'superadmin',
      reviewedAt: now,
      createdAt: now,
      updatedAt: now
    });
    console.log('Inserted Event BeneficiaryEligibility:', eventEligRes.insertedId);
  }

  console.log('SUCCESS: Emmanuel De Vera is now fully set up as APPROVED.');
  process.exit(0);
}

approveEmmanuelClean().catch(console.error);
