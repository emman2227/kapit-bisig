/**
 * Seed Dynamic Distributions Script
 *
 * Populates realistic, dynamic distributions across barangays designed for end-to-end
 * live mobile scanning, pre-check verification, and lifecycle management testing.
 *
 * Distributions created:
 *  - ACTIVE:
 *      1. Bolo (0/10 claims) -> Ready for fresh live QR scanning from 0 to 10
 *      2. Uyong (4/9 claims) -> In-progress live event (5 remaining to scan or mark complete)
 *  - UPCOMING:
 *      3. Tobuan (starts in 2 hours) -> Nearest upcoming (tests mobile Pre-Check mode)
 *      4. Bongalon (starts tomorrow) -> Standard upcoming
 *  - COMPLETED:
 *      5. Poblacion (11/11 claims) -> 100% full turnout (tests Archive with global modal)
 *      6. Dulig (3/10 claims, ended yesterday) -> Partial turnout historical
 *      7. Capandanan (0/10 claims, ended yesterday) -> Zero turnout historical
 *  - ARCHIVED:
 *      8. San Jose (archived) -> Tests Restore flow
 *
 * All demo records are tagged with `isDynamicDemo: true`.
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
  const Residents = mongoose.connection.collection('residents');
  const Events = mongoose.connection.collection('disasterevents');
  const Staff = mongoose.connection.collection('staffusers');

  // 1. Get or create DisasterEvent
  let event = await Events.findOne({});
  if (!event) {
    const res = await Events.insertOne({
      name: 'Oplan Kapit-Bisig Relief 2026',
      type: 'Typhoon',
      status: 'Active',
      createdAt: new Date(),
    });
    event = { _id: res.insertedId };
  }

  // 2. Fetch all staff IDs to assign to distributions so any logged-in staff/volunteer can scan them
  const allStaff = await Staff.find({}).toArray();
  const staffIds = allStaff.map((s) => s._id);

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const sixHoursLater = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const eightHoursLater = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(now.getTime() + 30 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayEnd = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  // Clean previous dynamic & scenario demos
  const prevDemos = await Dist.find({
    $or: [{ isDynamicDemo: true }, { isScenarioDemo: true }, { barangay: 'Capandanan' }],
  }).toArray();
  for (const prev of prevDemos) {
    await Claims.deleteMany({ distributionId: prev._id });
  }
  await Dist.deleteMany({
    $or: [{ isDynamicDemo: true }, { isScenarioDemo: true }, { barangay: 'Capandanan' }],
  });

  console.log('\n--- Seeding Dynamic Distributions ---');

  // Helper to get residents
  async function getResidents(barangay, limit = 0) {
    const query = { barangay, status: 'Approved' };
    const total = await Residents.countDocuments(query);
    const docs = limit > 0
      ? await Residents.find(query).limit(limit).toArray()
      : await Residents.find(query).toArray();
    return { total, docs };
  }

  // 1. ACTIVE: Bolo (0/10 claims - completely fresh for live scanning)
  const bolo = await getResidents('Bolo');
  const boloId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: boloId,
    disasterEventId: event._id,
    barangay: 'Bolo',
    assignedBarangays: [],
    assignedStaffIds: staffIds,
    scheduled: twoHoursAgo,
    endsAt: sixHoursLater,
    households: bolo.total || 10,
    status: 'Unclaimed',
    notes: '[DYNAMIC_DEMO] Active distribution with 0/10 claims - Ready for live mobile scanning',
    isDynamicDemo: true,
    createdAt: new Date(),
  });
  console.log(`✓ [ACTIVE] Bolo (0/${bolo.total} claims) - Ready for live scanning from qr_test_sheet.html!`);

  // 2. ACTIVE: Uyong (4/9 claims - in progress)
  const uyong = await getResidents('Uyong', 4);
  const uyongId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: uyongId,
    disasterEventId: event._id,
    barangay: 'Uyong',
    assignedBarangays: [],
    assignedStaffIds: staffIds,
    scheduled: twoHoursAgo,
    endsAt: sixHoursLater,
    households: uyong.total || 9,
    status: 'Partially Claimed',
    notes: '[DYNAMIC_DEMO] Active distribution with in-progress claims (5 remaining to scan)',
    isDynamicDemo: true,
    createdAt: new Date(),
  });
  for (const r of uyong.docs) {
    await Claims.insertOne({
      distributionId: uyongId,
      householdId: r._id,
      claimedAt: new Date(now.getTime() - 25 * 60 * 1000),
      claimedBy: { id: String(staffIds[0]), name: 'Volunteer Staff' },
      proofMethod: 'QR',
      isDynamicDemo: true,
    });
  }
  console.log(`✓ [ACTIVE] Uyong (4/${uyong.total} claims) - 5 remaining to scan or mark complete!`);

  // 3. UPCOMING: Tobuan (starts in 2 hours - nearest upcoming for Pre-Check testing)
  const tobuan = await getResidents('Tobuan');
  const tobuanId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: tobuanId,
    disasterEventId: event._id,
    barangay: 'Tobuan',
    assignedBarangays: [],
    assignedStaffIds: staffIds,
    scheduled: twoHoursLater,
    endsAt: eightHoursLater,
    households: tobuan.total || 10,
    status: 'Unclaimed',
    notes: '[DYNAMIC_DEMO] Nearest upcoming distribution - Tests mobile Pre-Check mode',
    isDynamicDemo: true,
    createdAt: new Date(),
  });
  console.log(`✓ [UPCOMING] Tobuan (starts in 2h) - Tests mobile Pre-Check mode when scanning Tobuan QRs!`);

  // 4. UPCOMING: Bongalon (starts tomorrow)
  const bongalon = await getResidents('Bongalon');
  const existingBongalon = await Dist.findOne({ barangay: 'Bongalon', isDynamicDemo: { $ne: true } });
  if (!existingBongalon) {
    await Dist.insertOne({
      disasterEventId: event._id,
      barangay: 'Bongalon',
      assignedBarangays: [],
      assignedStaffIds: staffIds,
      scheduled: tomorrow,
      endsAt: tomorrowEnd,
      households: bongalon.total || 9,
      status: 'Unclaimed',
      notes: '[DYNAMIC_DEMO] Scheduled for tomorrow',
      isDynamicDemo: true,
      createdAt: new Date(),
    });
    console.log(`✓ [UPCOMING] Bongalon (starts tomorrow)`);
  } else {
    console.log(`✓ [UPCOMING] Bongalon (existing record maintained)`);
  }

  // 5. COMPLETED: Dulig (3/10 claims - time expired yesterday)
  const dulig = await getResidents('Dulig', 3);
  const duligId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: duligId,
    disasterEventId: event._id,
    barangay: 'Dulig',
    assignedBarangays: [],
    assignedStaffIds: staffIds,
    scheduled: yesterday,
    endsAt: yesterdayEnd,
    households: dulig.total || 10,
    status: 'Partially Claimed',
    notes: '[DYNAMIC_DEMO] Ended yesterday with partial turnout',
    isDynamicDemo: true,
    createdAt: new Date(),
  });
  for (const r of dulig.docs) {
    await Claims.insertOne({
      distributionId: duligId,
      householdId: r._id,
      claimedAt: new Date(yesterday.getTime() + 45 * 60 * 1000),
      claimedBy: { id: String(staffIds[0]), name: 'Volunteer Staff' },
      proofMethod: 'QR',
      isDynamicDemo: true,
    });
  }
  console.log(`✓ [COMPLETED] Dulig (3/${dulig.total} claims, ended yesterday) - Tests Archive option on partial runs`);

  // 6. COMPLETED: Magsaysay (0/10 claims - zero turnout, ended yesterday)
  const magsaysay = await getResidents('Magsaysay');
  const magsaysayId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: magsaysayId,
    disasterEventId: event._id,
    barangay: 'Magsaysay',
    assignedBarangays: [],
    assignedStaffIds: staffIds,
    scheduled: yesterday,
    endsAt: yesterdayEnd,
    households: magsaysay.total || 10,
    status: 'Unclaimed',
    notes: '[DYNAMIC_DEMO] Ended yesterday with zero claims (missed event)',
    isDynamicDemo: true,
    createdAt: new Date(),
  });
  console.log(`✓ [COMPLETED] Magsaysay (0/${magsaysay.total} claims, ended yesterday) - Tests zero-turnout historical`);

  console.log('\nDynamic distributions seeded successfully! All staff accounts assigned.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed to seed dynamic distributions:', err);
  process.exit(1);
});
