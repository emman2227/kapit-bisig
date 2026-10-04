const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

async function testHouseholdsRoute() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'kapit-bisig' });
  const db = mongoose.connection.db;

  const distId = '6ac243a15bb4ab712607a311';
  const distribution = await db.collection('distributions').findOne({ _id: new mongoose.Types.ObjectId(distId) });
  console.log('Distribution found:', distribution ? 'YES' : 'NO');

  const targetBarangays = [distribution.barangay, ...(distribution.assignedBarangays || [])];
  const uniqueTargets = [...new Set(targetBarangays)];
  console.log('uniqueTargets:', uniqueTargets);

  const registeredHouseholds = await db.collection('residents').find({
    barangay: { $in: uniqueTargets },
    status: 'Approved'
  }).toArray();
  console.log('registeredHouseholds count:', registeredHouseholds.length);

  // Check claims
  const distLookupIds = [new mongoose.Types.ObjectId(distId), distId];
  const claims = await db.collection('distributionclaims').find({
    distributionId: { $in: distLookupIds }
  }).toArray();
  console.log('claims count:', claims.length);

  await mongoose.disconnect();
}
testHouseholdsRoute();
