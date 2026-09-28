import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import mongoose from 'mongoose';
import Resident from '../models/Resident';
import ProofSubmission from '../models/ProofSubmission';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || '');
  console.log('Connected to MongoDB');

  const residents = await Resident.find({
    $or: [
      { mobileNumber: { $regex: '9766532401' } },
      { fullName: { $regex: 'Emmanuel', $options: 'i' } },
      { firstName: { $regex: 'Emmanuel', $options: 'i' } },
    ]
  }).lean();

  console.log(`Found ${residents.length} matching residents:`);
  for (const r of residents) {
    console.log(`- ID: ${r._id}, Name: ${r.fullName || (r.firstName + ' ' + r.lastName)}, Mobile: ${r.mobileNumber}, Barangay: ${r.barangay}, Status: ${r.status}, ResidentCode: ${r.residentCode}`);
  }

  const existingProofs = await ProofSubmission.find({}).lean();
  console.log(`Total ProofSubmissions currently in DB: ${existingProofs.length}`);

  await mongoose.disconnect();
}

main().catch(console.error);
