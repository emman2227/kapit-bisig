import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Resident from '../models/Resident';
import { registerAssistedResident } from '../services/assistedRegistrationService';
import bcrypt from 'bcrypt';

export async function runAssistedRegistrationTests(): Promise<void> {
  console.log('Running Assisted Registration Integration Tests...');

  process.env.JWT_SECRET = 'super-secret-jwt-key-minimum-32-chars-long';
  process.env.RESIDENT_QR_SECRET = 'super-secret-qr-key-minimum-32-chars-long';

  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  try {
    const staffUser = {
      userId: 'staff_123',
      name: 'Barangay Staff Officer',
      role: 'LGU_STAFF',
    };

    // 1. Successful assisted registration without phone number (STAFF_ATTESTATION)
    const result1 = await registerAssistedResident(
      {
        firstName: 'Maria',
        lastName: 'Santos',
        dateOfBirth: '1960-03-20',
        gender: 'Female',
        barangay: 'San Jose',
        streetAddress: 'Sitio Pulo, Purok 2',
        idType: 'STAFF_ATTESTATION',
        attestationReason: 'Elderly indigent resident without civil documents or mobile phone.',
        faceImage: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
      },
      staffUser
    );

    assert.strictEqual(result1.success, true, 'Registration 1 should succeed');
    assert.ok(result1.residentCode, 'Resident code should be returned');
    assert.ok(result1.residentId, 'Resident ID should be returned');
    assert.ok(result1.qrToken, 'QR Token should be generated');
    assert.ok(result1.tempPassword, 'Temporary password should be generated');

    const resident1 = await Resident.findById(result1.residentId).select('+password');
    assert.ok(resident1, 'Resident document should exist in DB');
    assert.strictEqual(resident1.mobileNumber, '', 'Mobile number should be empty string');
    assert.strictEqual(resident1.registrationMethod, 'assisted', 'Registration method should be assisted');
    assert.strictEqual(resident1.assistedBy, 'staff_123');
    assert.strictEqual(resident1.status, 'Pending');
    assert.ok(resident1.idNumber.startsWith('ATTEST-'), `Surrogate ID should start with ATTEST-, got: ${resident1.idNumber}`);

    // 2. Register second phoneless resident to verify sparse unique index allows multiple empty mobile numbers
    const result2 = await registerAssistedResident(
      {
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        dateOfBirth: '1975-08-12',
        gender: 'Male',
        barangay: 'San Jose',
        streetAddress: 'Sitio Pulo, Purok 4',
        idType: 'STAFF_ATTESTATION',
        attestationReason: 'Indigenous family member without civil registration.',
        faceImage: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
      },
      staffUser
    );

    assert.strictEqual(result2.success, true, 'Registration 2 should succeed without unique constraint error');
    assert.notStrictEqual(result1.residentCode, result2.residentCode, 'Resident codes must be unique');

    // 3. Test resident code login lookup
    const lookup = await Resident.findOne({ residentCode: result1.residentCode }).select('+password');
    assert.ok(lookup, 'Should find resident by resident code');
    const isPasswordValid = await bcrypt.compare(result1.tempPassword!, lookup.password);
    assert.strictEqual(isPasswordValid, true, 'Temp password must match resident password');

    // 4. Test missing attestation reason rejection
    const invalidAttestation = await registerAssistedResident(
      {
        firstName: 'Pedro',
        lastName: 'Penduko',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        barangay: 'Bolo',
        streetAddress: 'Main St',
        idType: 'STAFF_ATTESTATION',
        attestationReason: '', // Empty reason
        faceImage: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
      },
      staffUser
    );
    assert.strictEqual(invalidAttestation.success, false, 'Missing attestation reason must fail');
    assert.strictEqual(invalidAttestation.errorCode, 'MISSING_ATTESTATION_REASON');

    // 5. Test missing face image rejection
    const missingFace = await registerAssistedResident(
      {
        firstName: 'Ana',
        lastName: 'Reyes',
        dateOfBirth: '1995-02-02',
        gender: 'Female',
        barangay: 'Bolo',
        streetAddress: 'Main St',
        idType: 'STAFF_ATTESTATION',
        attestationReason: 'Valid reason',
        faceImage: '', // Empty face
      },
      staffUser
    );
    assert.strictEqual(missingFace.success, false, 'Missing face image must fail');

    console.log('Assisted Registration Integration Tests Passed Successfully! ✓');
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

if (require.main === module) {
  runAssistedRegistrationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Assisted registration tests failed:', err);
      process.exit(1);
    });
}
