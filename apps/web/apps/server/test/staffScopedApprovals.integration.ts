import assert from 'assert';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';

async function run(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'super-secret-jwt-key-with-at-least-32-characters-for-testing';

  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  try {
    const { default: residentRoutes } = await import('../routes/residentRoutes');
    const { default: beneficiaryRoutes } = await import('../routes/beneficiaryRoutes');
    const { default: Resident } = await import('../models/Resident');
    const { default: DisasterEvent } = await import('../models/DisasterEvent');
    const { default: ProofSubmission } = await import('../models/ProofSubmission');
    const { default: StaffUser } = await import('../models/StaffUser');

    // Create staff users
    const staffBolo = await StaffUser.create({
      email: 'staff.bolo@lingayen.gov.ph',
      emailLower: 'staff.bolo@lingayen.gov.ph',
      firstName: 'Bolo',
      lastName: 'Staff',
      role: 'LGU_STAFF',
      assignedBarangays: ['Bolo'],
      isActive: true,
    });

    const tokenBoloStaff = jwt.sign(
      {
        sub: staffBolo.emailLower,
        role: 'LGU_STAFF',
        userId: staffBolo._id.toString(),
        assignedBarangays: ['Bolo'],
      },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' },
    );

    // Create residents in Bolo and Poblacion
    const residentBolo = await Resident.create({
      residentCode: 'RES-BOLO-001',
      firstName: 'Bolo',
      lastName: 'Resident',
      fullName: 'Bolo Resident',
      password: 'password123',
      dateOfBirth: '1995-01-01',
      gender: 'Female',
      streetAddress: 'Purok 1',
      barangay: 'Bolo',
      mobileNumber: '09170000001',
      idType: 'National ID',
      idNumber: 'ID-BOLO-001',
      frontIdImage: '/uploads/front1.jpg',
      backIdImage: '/uploads/back1.jpg',
      faceImage: '/uploads/face1.jpg',
      verification: {
        overallConfidence: 90,
      },
      status: 'Pending',
      qrStatus: 'REVOKED',
    });

    const residentPoblacion = await Resident.create({
      residentCode: 'RES-POB-001',
      firstName: 'Poblacion',
      lastName: 'Resident',
      fullName: 'Poblacion Resident',
      password: 'password123',
      dateOfBirth: '1992-05-10',
      gender: 'Male',
      streetAddress: 'Purok 2',
      barangay: 'Poblacion',
      mobileNumber: '09170000002',
      idType: 'National ID',
      idNumber: 'ID-POB-001',
      frontIdImage: '/uploads/front2.jpg',
      backIdImage: '/uploads/back2.jpg',
      faceImage: '/uploads/face2.jpg',
      verification: {
        overallConfidence: 90,
      },
      status: 'Pending',
      qrStatus: 'REVOKED',
    });

    // Create disaster event & proof submissions
    const event = await DisasterEvent.create({
      name: 'Monsoon Relief',
      disasterType: 'Flood',
      description: 'Flood Relief in Lingayen',
      barangays: ['Bolo', 'Poblacion'],
      eventDate: new Date(),
      submissionDeadline: new Date(Date.now() + 86400000),
      status: 'Active',
      createdBy: 'admin',
      updatedBy: 'admin',
    });

    const proofBolo = await ProofSubmission.create({
      residentId: residentBolo._id,
      disasterEventId: event._id,
      damageType: 'Flood',
      description: 'Roof leak and yard flood in Bolo',
      dateSubmitted: new Date(),
      photoProofUrl: '/uploads/proof1.jpg',
      photoProofUrls: ['/uploads/proof1.jpg'],
      status: 'Pending Verification',
      syncSource: 'ONLINE',
    });

    const proofPoblacion = await ProofSubmission.create({
      residentId: residentPoblacion._id,
      disasterEventId: event._id,
      damageType: 'Flood',
      description: 'Wall damage in Poblacion',
      dateSubmitted: new Date(),
      photoProofUrl: '/uploads/proof2.jpg',
      photoProofUrls: ['/uploads/proof2.jpg'],
      status: 'Pending Verification',
      syncSource: 'ONLINE',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/residents', residentRoutes);
    app.use('/api/beneficiaries', beneficiaryRoutes);

    console.log('--- TEST 1: Staff CAN approve resident in their assigned barangay (Bolo) ---');
    const approveBoloRes = await request(app)
      .patch(`/api/residents/${residentBolo._id}/status`)
      .set('Authorization', `Bearer ${tokenBoloStaff}`)
      .send({ status: 'Approved' });

    assert.strictEqual(approveBoloRes.status, 200, `Expected 200, got ${approveBoloRes.status}: ${JSON.stringify(approveBoloRes.body)}`);
    assert.strictEqual(approveBoloRes.body.success, true);
    assert.strictEqual(approveBoloRes.body.data.status, 'Approved');

    const updatedBoloResident = await Resident.findById(residentBolo._id);
    assert.strictEqual(updatedBoloResident?.status, 'Approved');
    assert.strictEqual(updatedBoloResident?.qrStatus, 'ACTIVE');

    console.log('--- TEST 2: Staff CANNOT approve resident outside their assigned barangay (Poblacion) ---');
    const approvePobRes = await request(app)
      .patch(`/api/residents/${residentPoblacion._id}/status`)
      .set('Authorization', `Bearer ${tokenBoloStaff}`)
      .send({ status: 'Approved' });

    assert.strictEqual(approvePobRes.status, 403, `Expected 403, got ${approvePobRes.status}`);
    assert.strictEqual(approvePobRes.body.success, false);
    assert.match(approvePobRes.body.message, /do not have access/i);

    const untouchedPobResident = await Resident.findById(residentPoblacion._id);
    assert.strictEqual(untouchedPobResident?.status, 'Pending');

    console.log('--- TEST 3: Staff CAN review beneficiary proof in their assigned barangay (Bolo) ---');
    const reviewBoloRes = await request(app)
      .patch(`/api/beneficiaries/admin/proof-submissions/${proofBolo._id}/review`)
      .set('Authorization', `Bearer ${tokenBoloStaff}`)
      .send({ decision: 'Approved' });

    assert.strictEqual(reviewBoloRes.status, 200, `Expected 200, got ${reviewBoloRes.status}: ${JSON.stringify(reviewBoloRes.body)}`);
    assert.strictEqual(reviewBoloRes.body.success, true);

    const updatedBoloProof = await ProofSubmission.findById(proofBolo._id);
    assert.strictEqual(updatedBoloProof?.status, 'Approved');

    console.log('--- TEST 4: Staff CANNOT review beneficiary proof outside their assigned barangay (Poblacion) ---');
    const reviewPobRes = await request(app)
      .patch(`/api/beneficiaries/admin/proof-submissions/${proofPoblacion._id}/review`)
      .set('Authorization', `Bearer ${tokenBoloStaff}`)
      .send({ decision: 'Approved' });

    assert.strictEqual(reviewPobRes.status, 403, `Expected 403, got ${reviewPobRes.status}`);
    assert.strictEqual(reviewPobRes.body.success, false);
    assert.match(reviewPobRes.body.message, /do not have access/i);

    console.log('--- TEST 5: Staff querying proof submissions outside their scope receives 403 ---');
    const queryForbiddenBrgy = await request(app)
      .get('/api/beneficiaries/admin/proof-submissions?barangay=Poblacion')
      .set('Authorization', `Bearer ${tokenBoloStaff}`);

    assert.strictEqual(queryForbiddenBrgy.status, 403);
    assert.strictEqual(queryForbiddenBrgy.body.success, false);

    console.log('--- TEST 6: Staff querying proof submissions without barangay filter only gets their scope ---');
    const queryDefaultScope = await request(app)
      .get('/api/beneficiaries/admin/proof-submissions')
      .set('Authorization', `Bearer ${tokenBoloStaff}`);

    assert.strictEqual(queryDefaultScope.status, 200);
    assert.strictEqual(queryDefaultScope.body.success, true);
    const returnedItems = queryDefaultScope.body.data;
    assert.ok(returnedItems.length >= 1);
    returnedItems.forEach((item: any) => {
      assert.strictEqual(item.resident.barangay, 'Bolo');
    });

    console.log('ALL STAFF SCOPED APPROVAL TESTS PASSED SUCCESSFULLY!');
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

void run();
