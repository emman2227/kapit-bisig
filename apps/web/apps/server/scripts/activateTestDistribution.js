/**
 * Activate Test Distribution Script
 *
 * Sets up a distribution to be LIVE right now with assigned staff accounts
 * so you can test real QR claim scanning immediately.
 *
 * Usage:
 *   node server/scripts/activateTestDistribution.js
 *   node server/scripts/activateTestDistribution.js --barangay "San Jose"
 *   node server/scripts/activateTestDistribution.js --barangay "Poblacion" --resetClaims
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const hasFlag = (flag) => process.argv.includes(flag);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to database.');

  const targetBarangay = getArg('--barangay') || 'San Jose';
  const shouldResetClaims = hasFlag('--resetClaims');

  const Distribution = mongoose.connection.collection('distributions');
  const StaffUser = mongoose.connection.collection('staffusers');
  const Claim = mongoose.connection.collection('claims');

  // Find staff users to assign
  const staffAccounts = await StaffUser.find({
    $or: [
      { email: 'pulanamanok123@gmail.com' },
      { email: 'demmanueljesse@gmail.com' },
      { email: `staff.${targetBarangay.toLowerCase().replace(/\s+/g, '')}1@kapitbisig.gov.ph` },
    ],
  }).toArray();

  const assignedStaffIds = staffAccounts.map((s) => s._id);

  console.log(`Found ${staffAccounts.length} staff account(s) to assign:`);
  staffAccounts.forEach((s) => console.log(` - ${s.firstName} ${s.lastName} (${s.email})`));

  // Find or create distribution
  let dist = await Distribution.findOne({
    barangay: targetBarangay,
    archivedAt: null,
  });

  const now = new Date();
  const scheduled = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
  const endsAt = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours from now

  if (dist) {
    console.log(`\nFound existing distribution for ${targetBarangay} (ID: ${dist._id}). Updating to LIVE...`);
    await Distribution.updateOne(
      { _id: dist._id },
      {
        $set: {
          scheduled,
          endsAt,
          status: 'Unclaimed',
          archivedAt: null,
          requiresBeneficiaryApproval: false,
        },
        $addToSet: {
          assignedStaffIds: { $each: assignedStaffIds },
        },
      }
    );
  } else {
    console.log(`\nCreating new LIVE distribution for ${targetBarangay}...`);
    const insertResult = await Distribution.insertOne({
      name: `Relief Drive - ${targetBarangay}`,
      barangay: targetBarangay,
      assignedBarangays: [targetBarangay],
      assignedStaffIds,
      scheduled,
      endsAt,
      status: 'Unclaimed',
      requiresBeneficiaryApproval: false,
      allocatedPackages: 100,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    dist = { _id: insertResult.insertedId };
  }

  if (shouldResetClaims && dist) {
    const deleted = await Claim.deleteMany({ distributionId: dist._id.toString() });
    console.log(`Reset ${deleted.deletedCount} existing claims for this distribution.`);
  }

  console.log('\n=============================================');
  console.log('DISTRIBUTION IS NOW LIVE FOR TESTING');
  console.log('=============================================');
  console.log(`Barangay       : ${targetBarangay}`);
  console.log(`Distribution ID: ${dist._id}`);
  console.log(`Status         : Active (Live)`);
  console.log(`Scheduled Start: ${scheduled.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`);
  console.log(`Scheduled End  : ${endsAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`);
  console.log(`Assigned Staff : ${staffAccounts.map((s) => s.email).join(', ')}`);
  console.log('=============================================\n');
}

main()
  .catch((err) => {
    console.error('Failed to activate test distribution:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
