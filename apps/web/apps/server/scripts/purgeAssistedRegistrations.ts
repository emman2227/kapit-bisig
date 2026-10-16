import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import mongoose from 'mongoose';
import Resident from '../models/Resident';
import HouseholdToken from '../models/HouseholdToken';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';

async function main() {
  console.log('\n--- PURGING ASSISTED REGISTRATION DATA & BIOMETRICS ---');
  await mongoose.connect(MONGODB_URI);

  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection failed');
    }

    // 1. Find all assisted residents
    const assistedResidents = await Resident.find({
      $or: [
        { registrationMethod: 'assisted' },
        { assistedBy: { $exists: true, $ne: null } },
      ],
    }).lean();

    console.log(`Found ${assistedResidents.length} assisted resident registration(s):`);
    assistedResidents.forEach((r) => {
      console.log(` - [${r._id}] ${r.firstName} ${r.lastName} (${r.residentCode || 'no-code'}) - Status: ${r.status}`);
    });

    if (assistedResidents.length === 0) {
      console.log('No assisted residents found to purge.');
      return;
    }

    const residentIds = assistedResidents.map((r) => r._id);
    const residentIdStrings = residentIds.map((id) => id.toString());
    const residentCodes = assistedResidents.map((r) => r.residentCode).filter(Boolean) as string[];
    const mobileNumbers = assistedResidents.map((r) => r.mobileNumber).filter(Boolean) as string[];

    // 2. Remove matching face embeddings from MongoDB
    const faceQueries: any[] = [
      { resident_id: { $in: [...residentIdStrings, ...residentCodes] } },
    ];
    if (mobileNumbers.length > 0) {
      faceQueries.push({ mobile_number: { $in: mobileNumbers } });
    }

    const deletedEmbeddings = await db.collection('face_embeddings').deleteMany({
      $or: faceQueries,
    });
    console.log(`Removed ${deletedEmbeddings.deletedCount} face embedding(s) from MongoDB.`);

    // 3. Clear Python AI backend in-memory cache if running
    const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
    for (const id of [...residentIdStrings, ...residentCodes, ...mobileNumbers]) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        await fetch(`${pythonUrl}/api/face/user/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          signal: controller.signal,
        }).catch(() => {});
        clearTimeout(timeout);
      } catch {
        // Non-fatal if Python server is not reachable
      }
    }

    // 4. Release linked HouseholdTokens back to UNUSED
    const tokenResult = await HouseholdToken.updateMany(
      { 'usedBy.residentId': { $in: residentIds } },
      {
        $set: {
          status: 'UNUSED',
          usedAt: null,
          'usedBy.residentId': null,
          'usedBy.ipAddress': null,
          'usedBy.userAgent': null,
        },
      }
    );
    console.log(`Reset ${tokenResult.modifiedCount} household token(s) back to UNUSED.`);

    // 5. Delete assisted residents
    const deleteResidentsResult = await Resident.deleteMany({
      _id: { $in: residentIds },
    });
    console.log(`Deleted ${deleteResidentsResult.deletedCount} assisted resident record(s) from database.`);

    console.log('\n✅ Completed: All assisted registration records and biometrics have been cleanly removed.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Purge error:', err);
  process.exit(1);
});
