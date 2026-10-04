const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

async function seedActiveDistribution() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not found');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri, { dbName: 'kapit-bisig' });
  console.log('Connected!');

  const db = mongoose.connection.db;

  // Find staff users (including Emmanuel De Vera)
  const staffUsers = await db.collection('staffusers').find({}).toArray();
  console.log(`Found ${staffUsers.length} staff users:`);
  staffUsers.forEach(s => {
    console.log(` - ${s._id} | ${s.firstName} ${s.lastName} | role: ${s.role} | barangays: ${s.assignedBarangays?.join(', ')}`);
  });

  const staffIds = staffUsers.map(s => s._id);

  // Check approved residents in Poblacion
  const residentsInPoblacion = await db.collection('residents').find({
    barangay: 'Poblacion',
    status: 'Approved'
  }).toArray();
  console.log(`Found ${residentsInPoblacion.length} approved residents in Poblacion.`);

  // Create a distribution with NO time restriction (scheduled way in past, endsAt far in future)
  const now = new Date();
  const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year from now

  const newDist = {
    barangay: 'Poblacion',
    assignedBarangays: ['Poblacion'],
    assignedStaffIds: staffIds,
    scheduled: pastDate.toISOString(),
    endsAt: futureDate.toISOString(),
    status: 'Unclaimed',
    notes: 'Active live distribution test (no time window constraints)',
    households: residentsInPoblacion.length,
    claimedHouseholds: 0,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const insertResult = await db.collection('distributions').insertOne(newDist);
  console.log(`\nSuccessfully created active distribution!`);
  console.log(`ID: ${insertResult.insertedId}`);
  console.log(`Title: Poblacion Relief Drive`);
  console.log(`Status: Unclaimed`);
  console.log(`Starts: ${pastDate.toISOString()}`);
  console.log(`Ends: ${futureDate.toISOString()}`);
  console.log(`Registered households: ${residentsInPoblacion.length}`);
  console.log(`Assigned staff count: ${staffIds.length}`);

  await mongoose.disconnect();
}

seedActiveDistribution().catch(err => {
  console.error(err);
  process.exit(1);
});
