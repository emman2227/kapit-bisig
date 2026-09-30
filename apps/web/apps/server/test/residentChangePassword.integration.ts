import assert from 'assert';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';

export async function runResidentChangePasswordIntegrationTests(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-123456789012345678901234567890';

  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  try {
    const { default: Resident } = await import('../models/Resident');
    const { default: ResidentPasswordResetOtp } = await import('../models/ResidentPasswordResetOtp');
    const { default: Notification } = await import('../models/Notification');
    const { default: residentAuthRoutes } = await import('../routes/residentAuthRoutes');
    const { generateToken } = await import('../middleware/authMiddleware');

    const initialHashedPassword = await bcrypt.hash('InitialPass#2026', 12);
    const testResident = await Resident.create({
      residentCode: 'RES-PW-001',
      firstName: 'Maria',
      lastName: 'Santos',
      fullName: 'Maria Santos',
      dateOfBirth: '1990-01-01',
      gender: 'Female',
      mobileNumber: '09181112233',
      email: 'maria.santos@example.com',
      barangay: 'San Jose',
      city: 'Antipolo',
      streetAddress: '123 Acacia St',
      householdSize: 4,
      idType: 'UMID',
      idNumber: 'RES-ID-12345',
      frontIdImage: 'front.jpg',
      backIdImage: 'back.jpg',
      faceImage: 'face.jpg',
      verification: {
        overallConfidence: 95,
        idConfidence: 95,
        faceMatchConfidence: 95,
        livenessConfidence: 95,
        dataMatchScore: 95,
        riskScore: 5,
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
      'maria.santos@example.com',
      'Resident',
    );

    const app = express();
    app.use(express.json());
    app.use('/api/household', residentAuthRoutes);

    // 1. Unauthenticated test
    const unauth = await request(app)
      .post('/api/household/auth/me/change-password/request-otp')
      .send({
        currentPassword: 'InitialPass#2026',
        newPassword: 'UpdatedPass#2026',
      });
    assert.strictEqual(unauth.status, 401);

    // 2. Wrong current password for request-otp
    const wrongCurrent = await request(app)
      .post('/api/household/auth/me/change-password/request-otp')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        currentPassword: 'WrongPassword#2026',
        newPassword: 'UpdatedPass#2026',
      });
    assert.strictEqual(wrongCurrent.status, 400);
    assert.match(wrongCurrent.body.message, /Current password is incorrect/i);

    // 3. Step 1: Successful request-otp
    const requestOtpRes = await request(app)
      .post('/api/household/auth/me/change-password/request-otp')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        currentPassword: 'InitialPass#2026',
        newPassword: 'UpdatedPass#2026',
      });
    assert.strictEqual(requestOtpRes.status, 200);
    assert.strictEqual(requestOtpRes.body.success, true);
    assert.match(requestOtpRes.body.message, /Verification code sent/i);

    // Verify OTP record created in MongoDB
    const identifier = `change_pw_${testResident._id.toString()}`;
    const otpRecord = await ResidentPasswordResetOtp.findOne({ identifier });
    assert.ok(otpRecord);
    assert.strictEqual(otpRecord.attemptsLeft, 5);

    // 4. Step 2: Confirm with wrong OTP
    const wrongOtpRes = await request(app)
      .post('/api/household/auth/me/change-password/confirm')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        otp: '000000',
        newPassword: 'UpdatedPass#2026',
      });
    assert.strictEqual(wrongOtpRes.status, 400);
    assert.match(wrongOtpRes.body.message, /Invalid verification code/i);

    // 5. Step 2: Confirm with valid OTP (we can inject a known hash to test clean validation)
    const testKnownOtp = '123456';
    otpRecord.otpHash = await bcrypt.hash(testKnownOtp, 10);
    await otpRecord.save();

    const confirmSuccess = await request(app)
      .post('/api/household/auth/me/change-password/confirm')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        otp: testKnownOtp,
        newPassword: 'UpdatedPass#2026',
      });
    assert.strictEqual(confirmSuccess.status, 200);
    assert.strictEqual(confirmSuccess.body.success, true);
    assert.match(confirmSuccess.body.message, /Password updated successfully/i);

    // Verify OTP record was deleted upon successful password change
    const deletedOtpRecord = await ResidentPasswordResetOtp.findOne({ identifier });
    assert.strictEqual(deletedOtpRecord, null);

    // Verify updated password in DB
    const updated = await Resident.findById(testResident._id).select('+password');
    assert.ok(updated);
    const match = await bcrypt.compare('UpdatedPass#2026', updated.password!);
    assert.strictEqual(match, true);

    // Verify in-app security notification
    const notif = await Notification.findOne({
      userId: testResident._id,
      type: 'security',
    });
    assert.ok(notif);
    assert.match(notif.title, /Password Changed Successfully/i);

    // 6. Test Email Channel OTP for Change Password
    const emailOtpRes = await request(app)
      .post('/api/household/auth/me/change-password/request-otp')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        currentPassword: 'UpdatedPass#2026',
        newPassword: 'FinalPass#2026',
        channel: 'email',
      });
    assert.strictEqual(emailOtpRes.status, 200);
    assert.strictEqual(emailOtpRes.body.success, true);
    assert.match(emailOtpRes.body.message, /recovery email/i);

    const emailOtpRecord = await ResidentPasswordResetOtp.findOne({ identifier });
    assert.ok(emailOtpRecord);
    assert.strictEqual(emailOtpRecord.emailLower, 'maria.santos@example.com');

    // Confirm via the email-generated OTP
    const testKnownEmailOtp = '654321';
    emailOtpRecord.otpHash = await bcrypt.hash(testKnownEmailOtp, 10);
    await emailOtpRecord.save();

    const confirmEmailSuccess = await request(app)
      .post('/api/household/auth/me/change-password/confirm')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        otp: testKnownEmailOtp,
        newPassword: 'FinalPass#2026',
      });
    assert.strictEqual(confirmEmailSuccess.status, 200);
    assert.strictEqual(confirmEmailSuccess.body.success, true);

    const finalResident = await Resident.findById(testResident._id).select('+password');
    assert.ok(finalResident);
    const finalMatch = await bcrypt.compare('FinalPass#2026', finalResident.password!);
    assert.strictEqual(finalMatch, true);

    console.log('✓ All SMS & Email OTP resident change password tests passed successfully!');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

if (require.main === module) {
  runResidentChangePasswordIntegrationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
