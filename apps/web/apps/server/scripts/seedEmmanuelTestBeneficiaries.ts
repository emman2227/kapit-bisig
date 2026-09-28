import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import mongoose from 'mongoose';
import Resident from '../models/Resident';
import DisasterEvent from '../models/DisasterEvent';
import ProofSubmission from '../models/ProofSubmission';
import BeneficiaryEligibility from '../models/BeneficiaryEligibility';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';

const PHOTO_ROOF_DAMAGE = 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=800&q=80';
const PHOTO_FLOOD_DAMAGE = 'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=800&q=80';
const PHOTO_BARANGAY_CERT = 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=800&q=80';

async function main() {
  console.log('\n--- SEEDING REAL TEST BENEFICIARY DATA FOR EMMANUEL DE VERA ---');
  await mongoose.connect(MONGODB_URI);

  try {
    // 1. Delete all previous dynamic test dummy submissions and dummy residents
    const deletedProofs = await ProofSubmission.deleteMany({
      $or: [
        { residentId: { $in: await Resident.find({ residentCode: { $regex: /^DYN-RES-/ } }).distinct('_id') } },
        { description: { $regex: /DYN-RES|living quarters and food pantry/i } },
      ]
    });
    console.log(`Deleted ${deletedProofs.deletedCount} old test dummy submissions.`);

    const deletedResidents = await Resident.deleteMany({
      residentCode: { $regex: /^DYN-RES-/ },
    });
    console.log(`Deleted ${deletedResidents.deletedCount} old test dummy residents.`);

    // 2. Find Emmanuel De Vera's resident account
    const emmanuel = await Resident.findOne({
      $or: [
        { mobileNumber: { $regex: '9766532401' } },
        { firstName: { $regex: 'Emmanuel', $options: 'i' }, lastName: { $regex: 'Vera', $options: 'i' } }
      ]
    });

    if (!emmanuel) {
      throw new Error('Resident Emmanuel De Vera not found in database!');
    }

    console.log(`Target Resident: ${emmanuel.fullName || (emmanuel.firstName + ' ' + emmanuel.lastName)}`);
    console.log(`ID: ${emmanuel._id}, Mobile: ${emmanuel.mobileNumber}, Barangay: ${emmanuel.barangay}`);

    // Ensure status is approved and mobile number is exactly 09766532401
    emmanuel.mobileNumber = '09766532401';
    emmanuel.status = 'Approved';
    emmanuel.qrStatus = 'ACTIVE';
    await emmanuel.save();

    // 3. Setup Disaster Event 1: Typhoon Aghon Relief Operation
    let event1 = await DisasterEvent.findOne({ name: 'Typhoon Aghon Relief Operation' });
    if (!event1) {
      event1 = await DisasterEvent.create({
        name: 'Typhoon Aghon Relief Operation',
        disasterType: 'Typhoon',
        description: 'Municipal-wide relief operation for households affected by severe tropical storm winds and flooding.',
        barangays: ['Bolo', 'San Jose', 'Poblacion', 'Bongalon', 'Dulig', 'Laois'],
        eventDate: new Date(),
        submissionDeadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        status: 'Active',
        createdBy: 'system-seeder',
        updatedBy: 'system-seeder',
      });
    } else {
      event1.status = 'Active';
      event1.submissionDeadline = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
      if (!event1.barangays.includes('Poblacion')) {
        event1.barangays.push('Poblacion');
      }
      await event1.save();
    }

    // 4. Setup Disaster Event 2: Habagat Monsoon Flooding Relief
    let event2 = await DisasterEvent.findOne({ name: 'Habagat Monsoon Emergency Relief' });
    if (!event2) {
      event2 = await DisasterEvent.create({
        name: 'Habagat Monsoon Emergency Relief',
        disasterType: 'Flood',
        description: 'Targeted food pack and financial assistance for riverside households in low-lying barangays.',
        barangays: ['Poblacion', 'Bolo', 'San Jose', 'San Gonzalo'],
        eventDate: new Date(),
        submissionDeadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        status: 'Active',
        createdBy: 'system-seeder',
        updatedBy: 'system-seeder',
      });
    } else {
      event2.status = 'Active';
      event2.submissionDeadline = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
      if (!event2.barangays.includes('Poblacion')) {
        event2.barangays.push('Poblacion');
      }
      await event2.save();
    }

    // Clean up existing proofs and eligibilities for Emmanuel on these events
    await ProofSubmission.deleteMany({
      residentId: emmanuel._id,
      disasterEventId: { $in: [event1._id, event2._id] }
    });
    await BeneficiaryEligibility.deleteMany({
      residentId: emmanuel._id,
      disasterEventId: { $in: [event1._id, event2._id] }
    });

    // 5. Seed Submission 1 (Typhoon Aghon - House Damage) -> Ready for Accept testing
    const sub1 = await ProofSubmission.create({
      residentId: emmanuel._id,
      disasterEventId: event1._id,
      damageType: 'House Damage',
      description: 'Roofing panels and support beams torn off by strong gale-force winds during Typhoon Aghon landfall.',
      supportingInfo: 'Barangay Certificate of Disaster Damage #POB-2026-088 attached. Family currently repairing temporary shelter.',
      dateSubmitted: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
      photoProofUrl: PHOTO_ROOF_DAMAGE,
      photoProofUrls: [PHOTO_ROOF_DAMAGE, PHOTO_BARANGAY_CERT],
      status: 'Pending Verification',
    });
    console.log(`Created Submission 1: [${sub1._id}] Typhoon Aghon (House Damage) - Pending Verification`);

    // 6. Seed Submission 2 (Habagat Monsoon - Flood Damage) -> Ready for Reject testing
    const sub2 = await ProofSubmission.create({
      residentId: emmanuel._id,
      disasterEventId: event2._id,
      damageType: 'Flood',
      description: 'Ground floor submerged in 0.8m waist-deep flood water from continuous torrential rains.',
      supportingInfo: 'Barangay Poblacion Purok 4 riverside assessment report pending validation.',
      dateSubmitted: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5 hours ago
      photoProofUrl: PHOTO_FLOOD_DAMAGE,
      photoProofUrls: [PHOTO_FLOOD_DAMAGE],
      status: 'Pending Verification',
    });
    console.log(`Created Submission 2: [${sub2._id}] Habagat Monsoon (Flood Damage) - Pending Verification`);

    console.log('\n✅ DONE! Seeded 2 clean pending submissions for Emmanuel De Vera (09766532401).');
  } catch (error) {
    console.error('Seeding error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(console.error);
