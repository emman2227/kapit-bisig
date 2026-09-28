const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function makeActiveForStaff() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const allStaff = await db.collection('staffusers').find({}).toArray();
  const allStaffIds = allStaff.map(s => s._id);

  // Give all staff Poblacion in assignedBarangays so scope check passes
  await db.collection('staffusers').updateMany(
    {},
    { $addToSet: { assignedBarangays: 'Poblacion' } }
  );

  const now = new Date();
  const startTime = new Date(now.getTime() - 30 * 60 * 1000);
  const endTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  const updateRes = await db.collection('distributions').updateMany(
    { barangay: 'Poblacion', archivedAt: null },
    {
      $set: {
        scheduled: startTime,
        endsAt: endTime,
        status: 'Active',
        assignedStaffIds: allStaffIds
      }
    }
  );

  console.log('Distributions updated to Active:', updateRes.modifiedCount);
  console.log('Assigned all', allStaffIds.length, 'staff accounts and added Poblacion to their scope.');
  process.exit(0);
}

makeActiveForStaff().catch(console.error);
