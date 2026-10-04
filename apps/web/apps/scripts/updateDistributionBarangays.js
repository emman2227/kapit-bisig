const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

async function updateDist() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri, { dbName: 'kapit-bisig' });
  const db = mongoose.connection.db;

  const allBarangays = [
    'Bolo',
    'Bongalon',
    'Dulig',
    'Laois',
    'Magsaysay',
    'Poblacion',
    'San Gonzalo',
    'San Jose',
    'Tobuan',
    'Uyong'
  ];

  const totalResidents = await db.collection('residents').countDocuments({
    barangay: { $in: allBarangays },
    status: 'Approved'
  });
  console.log('Total approved residents across all 10 barangays:', totalResidents);

  // Update the distribution to cover ALL 10 barangays and all staff
  const staffUsers = await db.collection('staffusers').find({}).toArray();
  const staffIds = staffUsers.map(s => s._id);

  const res = await db.collection('distributions').updateOne(
    { _id: new mongoose.Types.ObjectId('6ac243a15bb4ab712607a311') },
    {
      $set: {
        barangay: 'Poblacion',
        assignedBarangays: allBarangays,
        assignedStaffIds: staffIds,
        households: totalResidents,
        claimedHouseholds: 0,
        status: 'Unclaimed',
        notes: 'Live distribution covering all 10 municipal barangays for QR scanner testing',
        scheduled: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date()
      }
    }
  );

  console.log('Distribution updated:', res.modifiedCount);

  const updated = await db.collection('distributions').findOne({ _id: new mongoose.Types.ObjectId('6ac243a15bb4ab712607a311') });
  console.log('Updated distribution assignedBarangays:', updated.assignedBarangays);

  // Verify residents count for each barangay
  for (const b of allBarangays) {
    const c = await db.collection('residents').countDocuments({ barangay: b, status: 'Approved' });
    console.log(` - ${b}: ${c} approved residents`);
  }

  await mongoose.disconnect();
}

updateDist().catch(err => {
  console.error(err);
  process.exit(1);
});
