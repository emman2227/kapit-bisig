const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to database for cleanup.');

  const emmanuel = await mongoose.connection.collection('residents').findOne({ mobileNumber: '09766532401' });
  if (emmanuel) {
    const proofRes = await mongoose.connection.collection('proofsubmissions').deleteMany({ residentId: emmanuel._id });
    console.log('Deleted proof submissions for Emmanuel De Vera:', proofRes.deletedCount);
  } else {
    console.log('Resident Emmanuel De Vera not found.');
  }

  // Remove newly created test distribution
  const distId = new mongoose.Types.ObjectId('6aba0c8dc880318557e7f0a1');
  const distRes = await mongoose.connection.collection('distributions').deleteOne({ _id: distId });
  console.log('Deleted test distribution 6aba0c8dc880318557e7f0a1:', distRes.deletedCount);

  // Also remove any claims associated with that test distribution
  const claimRes = await mongoose.connection.collection('claims').deleteMany({ distributionId: distId });
  console.log('Deleted claims for test distribution:', claimRes.deletedCount);

  console.log('Cleanup complete.');
  process.exit(0);
}

main().catch(console.error);
