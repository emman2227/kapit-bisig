/**
 * Setup Poblacion Test Script
 *
 * Configures the Poblacion distribution for testing:
 *  - Default mode: Upcoming (starts in 2 hours) -> Tests Pre-Check Mode
 *  - Live mode (--live): Currently active -> Tests Happy Path (Claim Recording)
 *
 * Usage:
 *   node server/scripts/setupPoblacionTest.js          # Sets to Upcoming (Pre-Check test)
 *   node server/scripts/setupPoblacionTest.js --live   # Switches to Live (Happy Path test)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';
const isLiveMode = process.argv.includes('--live');

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to database.');

  const Res = mongoose.connection.collection('residents');
  const Dist = mongoose.connection.collection('distributions');
  const Staff = mongoose.connection.collection('staffusers');
  const Claim = mongoose.connection.collection('claims');

  // 1. Ensure all Poblacion residents have residentCode and active QR
  const allCodes = await Res.distinct('residentCode', { residentCode: { $ne: null } });
  const existingSet = new Set(allCodes.map((c) => String(c).toUpperCase()));

  const poblacionResidents = await Res.find({ barangay: 'Poblacion' }).sort({ createdAt: 1 }).toArray();
  let counter = 1;

  for (const r of poblacionResidents) {
    if (!r.residentCode) {
      let candidate = `PO-2026-${String(counter).padStart(6, '0')}`;
      while (existingSet.has(candidate)) {
        counter++;
        candidate = `PO-2026-${String(counter).padStart(6, '0')}`;
      }
      existingSet.add(candidate);
      await Res.updateOne(
        { _id: r._id },
        {
          $set: {
            residentCode: candidate,
            qrVersion: 1,
            qrStatus: 'ACTIVE',
            status: 'Approved',
          },
        }
      );
      console.log(`Assigned code ${candidate} to ${r.fullName}`);
      counter++;
    } else {
      await Res.updateOne(
        { _id: r._id },
        {
          $set: {
            qrVersion: 1,
            qrStatus: 'ACTIVE',
            status: 'Approved',
          },
        }
      );
      console.log(`Verified active code ${r.residentCode} for ${r.fullName}`);
    }
  }

  // 2. Find staff accounts to assign
  const staffAccounts = await Staff.find({
    $or: [
      { email: 'pulanamanok123@gmail.com' },
      { email: 'demmanueljesse@gmail.com' },
      { email: 'staff.poblacion1@kapitbisig.gov.ph' },
    ],
  }).toArray();
  const assignedStaffIds = staffAccounts.map((s) => s._id);

  console.log(`\nAssigning ${staffAccounts.length} staff account(s):`);
  staffAccounts.forEach((s) => console.log(` - ${s.firstName} ${s.lastName} (${s.email})`));

  // 3. Make sure other distributions (e.g. San Jose) don't override active status if testing Upcoming
  const now = new Date();
  if (!isLiveMode) {
    // Put San Jose into completed state so Poblacion is the only relevant upcoming distribution
    await Dist.updateOne(
      { barangay: 'San Jose', archivedAt: null },
      {
        $set: {
          scheduled: new Date(now.getTime() - 24 * 3600 * 1000),
          endsAt: new Date(now.getTime() - 12 * 3600 * 1000),
          status: 'Claimed',
        },
      }
    );
  }

  // 4. Configure Poblacion distribution
  let scheduled, endsAt, statusLabel;
  if (isLiveMode) {
    // Happy Path: Currently Live
    scheduled = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    endsAt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 8 hours from now
    statusLabel = 'ACTIVE (Live Drive - Happy Path)';
  } else {
    // Pre-Check Mode: Starts in 2 hours
    scheduled = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    endsAt = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6 hours from now
    statusLabel = 'UPCOMING (Scheduled - Pre-Check Mode)';
  }

  const existingDist = await Dist.findOne({ barangay: 'Poblacion', archivedAt: null });
  let distId;

  if (existingDist) {
    distId = existingDist._id;
    await Dist.updateOne(
      { _id: distId },
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
    const insertRes = await Dist.insertOne({
      name: 'Relief Drive - Poblacion',
      barangay: 'Poblacion',
      assignedBarangays: ['Poblacion'],
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
    distId = insertRes.insertedId;
  }

  // Reset claims for Poblacion if entering Live mode
  if (isLiveMode) {
    const deleted = await Claim.deleteMany({ distributionId: distId.toString() });
    if (deleted.deletedCount > 0) {
      console.log(`Reset ${deleted.deletedCount} previous claims for Poblacion.`);
    }
  }

  console.log('\n=============================================');
  console.log(`POBLACION DISTRIBUTION IS SET TO: ${statusLabel}`);
  console.log('=============================================');
  console.log(`Distribution ID: ${distId}`);
  console.log(`Barangay       : Poblacion`);
  console.log(`Scheduled Start: ${scheduled.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`);
  console.log(`Scheduled End  : ${endsAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`);
  console.log(`Assigned Staff : ${staffAccounts.map((s) => s.email).join(', ')}`);
  console.log('=============================================\n');

  if (!isLiveMode) {
    console.log('👉 STEP 1 (CURRENT): Test Pre-Check Mode on mobile app.');
    console.log('   Scan a Poblacion resident QR code from qr_test_sheet.html.');
    console.log('   Expected: "Pre-Check Verified (Upcoming)" - Supplies cannot be claimed yet.');
    console.log('\n👉 STEP 2 (WHEN READY FOR HAPPY PATH):');
    console.log('   Run: node server/scripts/setupPoblacionTest.js --live');
  } else {
    console.log('👉 HAPPY PATH IS NOW ACTIVE!');
    console.log('   Scan a Poblacion resident QR code on mobile app.');
    console.log('   Expected: "Resident Verified & Claim Recorded" (Green Checkmark).');
  }
}

main()
  .catch((err) => {
    console.error('Failed to setup Poblacion test:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
