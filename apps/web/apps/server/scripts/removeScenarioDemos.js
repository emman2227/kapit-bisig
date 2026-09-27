/**
 * Remove Scenario Demos Script
 *
 * Removes all demo distributions and demo claims created by seedScenarioDemos.js.
 * Preserves all original database records.
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

  const demoDists = await Dist.find({ isScenarioDemo: true }).toArray();
  const demoDistIds = demoDists.map((d) => d._id);

  if (demoDistIds.length > 0) {
    const claimsRes = await Claims.deleteMany({
      $or: [
        { distributionId: { $in: demoDistIds } },
        { isScenarioDemo: true },
      ],
    });
    console.log(`Deleted ${claimsRes.deletedCount} demo claims.`);

    const distsRes = await Dist.deleteMany({ isScenarioDemo: true });
    console.log(`Deleted ${distsRes.deletedCount} demo distributions.`);
  } else {
    console.log('No demo distributions found to remove.');
  }

  console.log('Cleanup complete. Original distributions preserved.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed to remove demo distributions:', err);
  process.exit(1);
});
