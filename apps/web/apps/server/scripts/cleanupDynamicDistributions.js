/**
 * Cleanup Dynamic Distributions Script
 *
 * Safely removes all distributions and claims tagged with `isDynamicDemo: true`.
 * Leaves original baseline data untouched.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const Dist = mongoose.connection.collection('distributions');
  const Claims = mongoose.connection.collection('distributionclaims');

  const demoDists = await Dist.find({
    $or: [{ isDynamicDemo: true }, { isScenarioDemo: true }],
  }).toArray();
  const demoDistIds = demoDists.map((d) => d._id);

  if (demoDistIds.length > 0) {
    const claimsRes = await Claims.deleteMany({
      $or: [
        { distributionId: { $in: demoDistIds } },
        { isDynamicDemo: true },
        { isScenarioDemo: true },
      ],
    });
    console.log(`Deleted ${claimsRes.deletedCount} dynamic demo claims.`);

    const distsRes = await Dist.deleteMany({
      $or: [{ isDynamicDemo: true }, { isScenarioDemo: true }],
    });
    console.log(`Deleted ${distsRes.deletedCount} dynamic demo distributions.`);
  } else {
    console.log('No dynamic demo distributions found.');
  }

  console.log('Cleanup complete. Real baseline data preserved.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed to cleanup dynamic distributions:', err);
  process.exit(1);
});
