import assert from 'assert';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';

export async function runResidentProfileUpdateIntegrationTests(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-123456789012345678901234567890';

  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  try {
    const { default: Resident } = await import('../models/Resident');
    const { default: ProfileUpdateOtp } = await import('../models/ProfileUpdateOtp');
    const { default: residentAuthRoutes } = await import('../routes/residentAuthRoutes');
    const { generateToken } = await import('../middleware/authMiddleware');

    const initialHashedPassword = await bcrypt.hash('SecurePassword#123', 12);
    const testResident = await Resident.create({
      residentCode: 'RES-PRF-001',
      firstName: 'Juana',
      lastName: 'Dela Cruz',
      fullName: 'Juana Dela Cruz',
      dateOfBirth: '1992-05-15',
      gender: 'Female',
      mobileNumber: '09170001111',
      email: 'juana.delacruz@example.com',
      barangay: 'San Jose',
      city: 'Antipolo',
      streetAddress: '45 Emerald St',
      householdSize: 3,
      idType: 'UMID',
      idNumber: 'RES-ID-67890',
      frontIdImage: 'front.jpg',
      backIdImage: 'back.jpg',
      faceImage: 'face.jpg',
      verification: {
        overallConfidence: 96,
        idConfidence: 96,
        faceMatchConfidence: 96,
        livenessConfidence: 96,
        dataMatchScore: 96,
        riskScore: 4,
        isVerified: true,
        aiVerificationStatus: 'High Match',
        warnings: [],
        riskFactors: [],
      },
      status: 'Approved',
      password: initialHashedPassword,
    });

    const testToken = generateToken(
      testResident._id.toString(),
      'juana.delacruz@example.com',
      'Resident'
    );


    const app = express();
    app.use(express.json());
    app.use('/api/household', residentAuthRoutes);

    console.log('1. Testing GET /api/household/auth/me returns lastProfileUpdateAt');
    const getRes = await request(app)
      .get('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.success, true);
    assert.strictEqual(getRes.body.data.lastProfileUpdateAt, null);

    console.log('2. Testing rejection of locked fields (firstName, lastName, city)');
    const firstNameAttempt = await request(app)
      .patch('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        firstName: 'Maria',
        password: 'SecurePassword#123',
      });
    assert.strictEqual(firstNameAttempt.status, 400);
    assert.match(firstNameAttempt.body.message, /First name cannot be changed/i);

    const cityAttempt = await request(app)
      .patch('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        city: 'Manila',
        password: 'SecurePassword#123',
      });
    assert.strictEqual(cityAttempt.status, 400);
    assert.match(cityAttempt.body.message, /City\/Municipality cannot be changed/i);

    console.log('3. Testing password requirement and rejection on wrong password');
    const noPasswordAttempt = await request(app)
      .patch('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        streetAddress: '99 New Address St',
      });
    assert.strictEqual(noPasswordAttempt.status, 400);
    assert.match(noPasswordAttempt.body.message, /Password is required/i);

    const wrongPasswordAttempt = await request(app)
      .patch('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        streetAddress: '99 New Address St',
        password: 'WrongPassword#999',
      });
    assert.strictEqual(wrongPasswordAttempt.status, 400);
    assert.match(wrongPasswordAttempt.body.message, /Incorrect password/i);

    console.log('4. Testing mobile number change requires OTP verification token');
    const unverifiedMobileAttempt = await request(app)
      .patch('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        mobileNumber: '09192223344',
        password: 'SecurePassword#123',
      });
    assert.strictEqual(unverifiedMobileAttempt.status, 400);
    assert.match(unverifiedMobileAttempt.body.message, /Mobile number change requires OTP/i);

    console.log('5. Testing request and confirm OTP for mobile number change');
    const requestOtpRes = await request(app)
      .post('/api/household/auth/me/profile-update/request-otp')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        target: 'mobileNumber',
        value: '09192223344',
      });
    assert.strictEqual(requestOtpRes.status, 200);
    assert.strictEqual(requestOtpRes.body.success, true);

    // Grab OTP from DB for testing
    const otpRecord = await ProfileUpdateOtp.findOne({
      userId: testResident._id,
      target: 'mobileNumber',
    });
    assert.ok(otpRecord);

    // Simulate OTP test verification by setting known hash
    const testOtp = '654321';
    otpRecord.otpHash = await bcrypt.hash(testOtp, 10);
    await otpRecord.save();

    const confirmOtpRes = await request(app)
      .post('/api/household/auth/me/profile-update/confirm-otp')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        target: 'mobileNumber',
        value: '09192223344',
        otp: testOtp,
      });
    assert.strictEqual(confirmOtpRes.status, 200);
    assert.strictEqual(confirmOtpRes.body.success, true);
    assert.ok(confirmOtpRes.body.verificationToken);
    const verificationToken = confirmOtpRes.body.verificationToken;

    console.log('6. Testing successful profile update with password + OTP token');
    const successfulUpdate = await request(app)
      .patch('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        streetAddress: '99 New Address St',
        mobileNumber: '09192223344',
        mobileVerificationToken: verificationToken,
        password: 'SecurePassword#123',
      });
    assert.strictEqual(successfulUpdate.status, 200);
    assert.strictEqual(successfulUpdate.body.success, true);
    assert.strictEqual(successfulUpdate.body.data.streetAddress, '99 New Address St');
    assert.strictEqual(successfulUpdate.body.data.mobileNumber, '09192223344');
    assert.ok(successfulUpdate.body.data.lastProfileUpdateAt);

    console.log('7. Testing 30-day cooldown enforcement');
    const cooldownAttempt = await request(app)
      .patch('/api/household/auth/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        streetAddress: '100 Another St',
        password: 'SecurePassword#123',
      });
    assert.strictEqual(cooldownAttempt.status, 429);
    assert.match(cooldownAttempt.body.message, /once every 30 days/i);
    assert.ok(cooldownAttempt.body.remainingDays >= 1);

    console.log('✓ All secure profile editing integration tests passed successfully!');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

if (require.main === module) {
  runResidentProfileUpdateIntegrationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
