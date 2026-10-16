import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Resident from '../models/Resident';
import AuditLog from '../models/AuditLog';
import { registerAssistedResident } from '../services/assistedRegistrationService';
import { householdTokenService } from '../services/householdTokenService';

export async function runAssistedRevisionTests(): Promise<void> {
  console.log('Running Assisted Registration & Revision Flow Integration Tests...');

  process.env.JWT_SECRET = 'super-secret-jwt-key-minimum-32-chars-long';
  process.env.RESIDENT_QR_SECRET = 'super-secret-qr-key-minimum-32-chars-long';

  const originalFetch = global.fetch;
  global.fetch = (async (url: any, options: any) => {
    if (typeof url === 'string' && (url.includes('/api/face/check-duplicate') || url.includes('/api/face/enroll'))) {
      return new Response(
        JSON.stringify({
          success: true,
          face_detected: true,
          decision: 'ALLOW',
          similarity: 0.1,
          threshold: 0.65,
          processing_time_ms: 10,
          message: 'No duplicate face found',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    return originalFetch ? originalFetch(url, options) : Promise.reject(new Error('No fetch'));
  }) as typeof fetch;

  const mongoServer = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  await mongoose.connect(mongoServer.getUri());

  try {
    const staffUser = {
      userId: 'staff_123',
      name: 'Barangay Staff Officer',
      role: 'LGU_STAFF',
    };

    // 1. Generate household token
    const batch = await householdTokenService.generateBatch({
      barangay: 'San Jose',
      quantity: 1,
      issuedBy: 'staff_123',
    });
    assert.strictEqual(batch.success, true);
    const token = batch.tokens![0].code;

    // 2. Register resident as assisted
    const regResult = await registerAssistedResident(
      {
        firstName: 'Elena',
        lastName: 'Reyes',
        dateOfBirth: '1975-08-14',
        gender: 'Female',
        barangay: 'San Jose',
        streetAddress: '123 Bamboo Lane',
        householdToken: token,
        householdSize: 2,
        idType: 'STAFF_ATTESTATION',
        attestationReason: 'Senior resident without formal digital credentials',
        faceImage: 'data:image/jpeg;base64,mockfaceimage123',
      },
      staffUser
    );

    assert.strictEqual(regResult.success, true);
    const residentId = regResult.residentId;
    assert.ok(residentId);

    // Verify initial status is Pending
    let resident = await Resident.findById(residentId);
    assert.ok(resident);
    assert.strictEqual(resident.status, 'Pending');
    assert.strictEqual(resident.registrationMethod, 'assisted');
    assert.strictEqual(resident.assistedBy, 'staff_123');
    assert.strictEqual(resident.assistedByName, 'Barangay Staff Officer');

    // 3. Mark for revision with note
    resident.status = 'Needs Revision';
    resident.rejectionReason = 'Front ID is too blurry to read address.';
    await resident.save();

    resident = await Resident.findById(residentId);
    assert.strictEqual(resident?.status, 'Needs Revision');
    assert.strictEqual(resident?.rejectionReason, 'Front ID is too blurry to read address.');

    // 4. Test Assisted Revision submission
    // Simulate what the PATCH /api/residents/:id/assisted-revision route does:
    assert.strictEqual(resident?.registrationMethod, 'assisted');
    assert.strictEqual(resident?.status, 'Needs Revision');

    resident.status = 'Pending';
    resident.rejectionReason = undefined;
    resident.idType = 'PhilSys ID';
    resident.idNumber = '1234-5678-9012';
    resident.frontIdImage = '/uploads/resident-verification/front-revised.jpg';
    resident.faceImage = '/uploads/resident-verification/face-revised.jpg';
    await resident.save();

    await AuditLog.create({
      actorId: staffUser.userId,
      actorRole: staffUser.role,
      actorName: staffUser.name,
      action: 'RESIDENT_ASSISTED_REVISED',
      entityType: 'RESIDENT',
      entityId: String(resident._id),
      metadata: {
        residentCode: resident.residentCode,
        barangay: resident.barangay,
        staffNote: 'Retook clear front ID photo in daylight.',
      },
      ip: '127.0.0.1',
      userAgent: 'KapitBisig-TestRunner',
    });

    // 5. Verification checks
    const revisedResident = await Resident.findById(residentId);
    assert.ok(revisedResident);
    assert.strictEqual(revisedResident.status, 'Pending');
    assert.strictEqual(revisedResident.rejectionReason, undefined);
    assert.strictEqual(revisedResident.idType, 'PhilSys ID');
    assert.strictEqual(revisedResident.idNumber, '1234-5678-9012');

    // Verify audit log
    const auditLogs = await AuditLog.find({ action: 'RESIDENT_ASSISTED_REVISED', entityId: String(resident._id) });
    assert.strictEqual(auditLogs.length, 1);
    assert.strictEqual(auditLogs[0].action, 'RESIDENT_ASSISTED_REVISED');
    assert.strictEqual(auditLogs[0].actorId, 'staff_123');

    console.log('Assisted Registration & Revision Flow Integration Tests Passed Successfully! ✓');
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

if (require.main === module) {
  runAssistedRevisionTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Assisted Revision Test Failed:', err);
      process.exit(1);
    });
}
