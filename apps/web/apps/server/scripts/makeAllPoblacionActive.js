const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const res = await mongoose.connection.collection('distributions').updateMany(
    { barangay: 'Poblacion', archivedAt: null },
    { $set: { scheduled: tenMinutesAgo, endsAt: twoHoursLater } }
  );
  console.log('Updated', res.modifiedCount, 'Poblacion distribution(s) to LIVE.');

  const dists = await mongoose.connection.collection('distributions').find({ barangay: 'Poblacion', archivedAt: null }).toArray();
  console.log('Active Poblacion distributions:', dists.map(d => ({
    id: d._id,
    scheduled: d.scheduled,
    endsAt: d.endsAt,
    requiresBeneficiaryApproval: d.requiresBeneficiaryApproval
  })));
  process.exit(0);
}
main().catch(console.error);
