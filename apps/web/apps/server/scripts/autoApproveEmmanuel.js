const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function approveEmmanuel() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const resident = await db.collection('residents').findOne({ mobileNumber: '09766532401' });
  const dist = await db.collection('distributions').findOne({ _id: new mongoose.Types.ObjectId('6aba184e651189db745b6f3a') });
  const activeEvent = await db.collection('disasterevents').findOne({ status: 'Active' });

  console.log('Target Resident:', resident._id, resident.fullName);
  console.log('Target Distribution:', dist._id, dist.name || 'Poblacion Relief');
  console.log('Target Disaster Event:', activeEvent ? activeEvent._id : 'None');

  // 1. Upsert an Approved ProofSubmission
  const proofSubmission = {
    residentId: resident._id,
    disasterEventId: activeEvent ? activeEvent._id : null,
    distributionId: dist._id,
    photoUrl: 'https://res.cloudinary.com/dummy/image/upload/sample.jpg',
    notes: 'Approved calamity damage proof for testing',
    status: 'Approved',
    reviewedBy: 'superadmin',
    reviewedAt: new Date(),
    updatedAt: new Date()
  };

  const proofRes = await db.collection('proofsubmissions').findOneAndUpdate(
    { residentId: resident._id, distributionId: dist._id },
    { $set: proofSubmission },
    { upsert: true, returnDocument: 'after' }
  );
  const proofId = proofRes?._id || proofRes?.value?._id;
  console.log('Upserted ProofSubmission:', proofId);

  // 2. Create BeneficiaryEligibility for this distribution
  const now = new Date();
  const distEligibility = {
    residentId: resident._id,
    distributionId: dist._id,
    disasterEventId: activeEvent ? activeEvent._id : null,
    proofSubmissionId: proofId,
    status: 'Eligible',
    registrationStatus: 'Approved',
    proofStatus: 'Approved',
    rejectionReason: '',
    reviewedBy: 'superadmin',
    reviewedAt: now,
    updatedAt: now
  };

  const updateDistRes = await db.collection('beneficiaryeligibilities').updateOne(
    { residentId: resident._id, distributionId: dist._id },
    { $set: distEligibility },
    { upsert: true }
  );
  console.log('Upserted BeneficiaryEligibility for distribution:', updateDistRes);

  if (activeEvent) {
    const eventEligibility = {
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
      updatedAt: now
    };
    await db.collection('beneficiaryeligibilities').updateOne(
      { residentId: resident._id, disasterEventId: activeEvent._id },
      { $set: eventEligibility },
      { upsert: true }
    );
    console.log('Upserted BeneficiaryEligibility for disaster event.');
  }

  // 3. Ensure any old claim is cleared so scanning can claim fresh
  const delClaims = await db.collection('claims').deleteMany({
    residentId: resident._id.toString(),
    distributionId: dist._id.toString()
  });
  console.log('Cleared claims for this distribution:', delClaims.deletedCount);

  console.log('SUCCESS: Emmanuel De Vera is now fully APPROVED for distribution 6aba184e651189db745b6f3a.');
  process.exit(0);
}

approveEmmanuel().catch(console.error);
