const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

async function fixDistribution() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri, { dbName: 'kapit-bisig' });
  const db = mongoose.connection.db;

  const staffUsers = await db.collection('staffusers').find({}).toArray();
  const staffIds = staffUsers.map(s => s._id);

  const poblacionCount = await db.collection('residents').countDocuments({
    barangay: 'Poblacion',
    status: 'Approved'
  });
  console.log('Approved residents in Poblacion:', poblacionCount);

  await db.collection('distributions').updateOne(
    { _id: new mongoose.Types.ObjectId('6ac243a15bb4ab712607a311') },
    {
      $set: {
        barangay: 'Poblacion',
        assignedBarangays: ['Poblacion'],
        assignedStaffIds: staffIds,
        requiresBeneficiaryApproval: false,
        households: poblacionCount,
        claimedHouseholds: 0,
        status: 'Unclaimed',
        notes: 'Active Poblacion relief distribution',
        scheduled: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date()
      }
    }
  );

  console.log('Updated distribution successfully with requiresBeneficiaryApproval = false and barangay = Poblacion');

  // Verify
  const dist = await db.collection('distributions').findOne({ _id: new mongoose.Types.ObjectId('6ac243a15bb4ab712607a311') });
  console.log('Dist in DB:', {
    _id: dist._id,
    barangay: dist.barangay,
    assignedBarangays: dist.assignedBarangays,
    requiresBeneficiaryApproval: dist.requiresBeneficiaryApproval,
    households: dist.households
  });

  await mongoose.disconnect();
}

fixDistribution().catch(err => {
  console.error(err);
  process.exit(1);
});
