import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import Resident from '../models/Resident';
import DisasterEvent from '../models/DisasterEvent';
import ProofSubmission from '../models/ProofSubmission';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';
const PLACEHOLDER_FLOOD = 'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=600&q=80';
const PLACEHOLDER_ROOF = 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=600&q=80';
const PLACEHOLDER_LIVELIHOOD = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80';

async function main() {
  console.log('\n--- SEEDING REAL DYNAMIC TARGET BENEFICIARY DATA ---');
  await mongoose.connect(MONGODB_URI);

  try {
    // 1. Ensure Active Disaster Event
    const eventName = 'Typhoon Aghon Relief Operation';
    let event = await DisasterEvent.findOne({ name: eventName });
    if (!event) {
      event = await DisasterEvent.create({
        name: eventName,
        disasterType: 'Typhoon',
        description: 'Municipal-wide relief operation for households affected by severe tropical storm winds and flooding.',
        barangays: ['Bolo', 'San Jose', 'Poblacion', 'Bongalon', 'Dulig', 'Laois'],
        eventDate: new Date(),
        submissionDeadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        status: 'Active',
        createdBy: 'dynamic-seeder',
        updatedBy: 'dynamic-seeder',
      });
      console.log(`Created event: ${event.name}`);
    } else {
      event.status = 'Active';
      event.submissionDeadline = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
      await event.save();
      console.log(`Using existing event: ${event.name}`);
    }

    // 2. Remove old dynamic submissions for this event if any
    await ProofSubmission.deleteMany({ disasterEventId: event._id });

    // 3. Find verified residents in Bolo, San Jose, and Poblacion
    const passwordHash = await bcrypt.hash('Password123!', 12);

    const residentConfigs = [
      {
        residentCode: 'DYN-RES-BOLO-01',
        fullName: 'Eduardo M. Bautista',
        firstName: 'Eduardo',
        lastName: 'Bautista',
        barangay: 'Bolo',
        mobileNumber: '09173000001',
        emailLower: 'eduardo.bautista@kapitbisig.local',
        damageType: 'Flood' as const,
        description: 'Living quarters and food pantry submerged by 1.2m flood water following the river surge.',
        supportingInfo: 'Barangay Calamity Certificate issued on Purok 3 riverside sector.',
        photos: [PLACEHOLDER_FLOOD, PLACEHOLDER_ROOF],
        status: 'Pending Verification' as const,
      },
      {
        residentCode: 'DYN-RES-SJ-01',
        fullName: 'Leticia D. Corpuz',
        firstName: 'Leticia',
        lastName: 'Corpuz',
        barangay: 'San Jose',
        mobileNumber: '09173000002',
        emailLower: 'leticia.corpuz@kapitbisig.local',
        damageType: 'House Damage' as const,
        description: 'GI Sheet roofing completely ripped away during high wind gusts. Structural wood beam split.',
        supportingInfo: 'Purok 5 hillside community. Family currently sheltering in barangay evacuation center.',
        photos: [PLACEHOLDER_ROOF],
        status: 'Pending Verification' as const,
      },
      {
        residentCode: 'DYN-RES-POB-01',
        fullName: 'Danilo P. Soriano',
        firstName: 'Danilo',
        lastName: 'Soriano',
        barangay: 'Poblacion',
        mobileNumber: '09173000003',
        emailLower: 'danilo.soriano@kapitbisig.local',
        damageType: 'Livelihood Loss' as const,
        description: 'Sari-sari store inventory and refrigerator damaged by flash flood overflow.',
        supportingInfo: 'Registered micro-merchant along coastal access road.',
        photos: [PLACEHOLDER_LIVELIHOOD, PLACEHOLDER_FLOOD],
        status: 'Pending Verification' as const,
      },
      {
        residentCode: 'DYN-RES-BOLO-02',
        fullName: 'Rowena T. Villanueva',
        firstName: 'Rowena',
        lastName: 'Villanueva',
        barangay: 'Bolo',
        mobileNumber: '09173000004',
        emailLower: 'rowena.villanueva@kapitbisig.local',
        damageType: 'House Damage' as const,
        description: 'Front porch collapsed due to saturated soil foundation.',
        supportingInfo: 'Indigency certificate verified by Barangay Captain.',
        photos: [PLACEHOLDER_ROOF],
        status: 'Approved' as const,
      },
    ];

    let createdProofs = 0;

    for (const cfg of residentConfigs) {
      const resident = await Resident.findOneAndUpdate(
        { residentCode: cfg.residentCode },
        {
          $set: {
            residentCode: cfg.residentCode,
            fullName: cfg.fullName,
            firstName: cfg.firstName,
            lastName: cfg.lastName,
            barangay: cfg.barangay,
            mobileNumber: cfg.mobileNumber,
            email: cfg.emailLower,
            emailLower: cfg.emailLower,
            password: passwordHash,
            gender: 'Female',
            dateOfBirth: '1988-06-12',
            streetAddress: `Purok 2, ${cfg.barangay}`,
            householdSize: 4,
            idType: 'National ID',
            idNumber: `ID-${cfg.residentCode}`,
            frontIdImage: PLACEHOLDER_FLOOD,
            backIdImage: PLACEHOLDER_FLOOD,
            faceImage: PLACEHOLDER_FLOOD,
            verification: { overallConfidence: 95, isVerified: true, aiVerificationStatus: 'High Match' },
            status: 'Approved',
            qrStatus: 'ACTIVE',
          },
        },
        { upsert: true, new: true },
      );

      const submission = await ProofSubmission.create({
        residentId: resident._id,
        disasterEventId: event._id,
        damageType: cfg.damageType,
        description: cfg.description,
        supportingInfo: cfg.supportingInfo,
        dateSubmitted: new Date(Date.now() - Math.floor(Math.random() * 3600000 * 24)),
        photoProofUrl: cfg.photos[0],
        photoProofUrls: cfg.photos,
        status: cfg.status,
        syncSource: 'ONLINE',
        submissionVersion: 1,
        reviewedBy: cfg.status === 'Approved' ? 'Superadmin' : undefined,
        reviewedAt: cfg.status === 'Approved' ? new Date() : undefined,
      });

      createdProofs++;
      console.log(`Created proof: [${cfg.barangay}] ${cfg.fullName} -> ${cfg.damageType} (${cfg.status})`);
    }

    console.log(`\n✅ Successfully seeded ${createdProofs} dynamic proof submissions into MongoDB.`);
  } finally {
    await mongoose.disconnect();
  }
}

void main();
