/**
 * Seed Scenario Demos Script
 *
 * Populates realistic distribution examples representing each lifecycle and claim scenario:
 *  1. Active (In Progress): Uyong (4/10 claimed) -> Active tab
 *  2. Completed (100% Claimed): Poblacion (11/11 claimed) -> Completed tab
 *  3. Completed (Time Expired, Partial): Dulig (3/10 claimed) -> Completed tab
 *  4. Completed (Time Expired, Zero): Capandanan (0/10 claimed) -> Completed tab
 *  5. Archived: San Jose (2/10 claimed) -> Archived tab
 *  6. Upcoming: Bongalon (0/10 claimed) -> Upcoming tab
 *
 * All demo records are tagged with `isScenarioDemo: true` for clean 1-click removal.
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

  // Find or create a disaster event
  let event = await Events.findOne({});
  if (!event) {
    const res = await Events.insertOne({
      name: 'Typhoon Relief Operation 2026',
      type: 'Typhoon',
      status: 'Active',
      createdAt: new Date(),
    });
    event = { _id: res.insertedId };
  }

  const staff = await Staff.findOne({});
  const staffId = staff ? staff._id : new mongoose.Types.ObjectId();

  const now = new Date();
  const pastStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h ago
  const pastEnd = new Date(now.getTime() - 12 * 60 * 60 * 1000);   // 12h ago
  const activeStart = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago
  const activeEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000);  // 6h from now

  // Remove previous demo records first if any
  const previousDemos = await Dist.find({ isScenarioDemo: true }).toArray();
  for (const prev of previousDemos) {
    await Claims.deleteMany({ distributionId: prev._id });
  }
  await Dist.deleteMany({ isScenarioDemo: true });

  // 1. Uyong - Active In Progress (4 claims)
  const uyongTotal = await Residents.countDocuments({ barangay: 'Uyong', status: 'Approved' });
  const uyongResidents = await Residents.find({ barangay: 'Uyong', status: 'Approved' }).limit(4).toArray();
  const uyongDistId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: uyongDistId,
    disasterEventId: event._id,
    barangay: 'Uyong',
    assignedBarangays: [],
    assignedStaffIds: [staffId],
    scheduled: activeStart,
    endsAt: activeEnd,
    households: uyongTotal || 9,
    status: 'Partially Claimed',
    notes: '[SCENARIO_DEMO] Active distribution with in-progress claims',
    isScenarioDemo: true,
    createdAt: new Date(),
  });
  for (const r of uyongResidents) {
    await Claims.insertOne({
      distributionId: uyongDistId,
      householdId: r._id,
      claimedAt: new Date(now.getTime() - 30 * 60 * 1000),
      claimedBy: { id: staffId, name: 'Volunteer Staff' },
      proofMethod: 'QR',
      isScenarioDemo: true,
    });
  }
  console.log(`✓ Created Uyong: Active (4/${uyongTotal || 9} claims in progress)`);

  // 2. Dulig - Completed (Time expired with 3 partial claims)
  const duligTotal = await Residents.countDocuments({ barangay: 'Dulig', status: 'Approved' });
  const duligResidents = await Residents.find({ barangay: 'Dulig', status: 'Approved' }).limit(3).toArray();
  const duligDistId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: duligDistId,
    disasterEventId: event._id,
    barangay: 'Dulig',
    assignedBarangays: [],
    assignedStaffIds: [staffId],
    scheduled: pastStart,
    endsAt: pastEnd,
    households: duligTotal || 10,
    status: 'Partially Claimed',
    notes: '[SCENARIO_DEMO] Time expired with partial attendance',
    isScenarioDemo: true,
    createdAt: new Date(),
  });
  for (const r of duligResidents) {
    await Claims.insertOne({
      distributionId: duligDistId,
      householdId: r._id,
      claimedAt: new Date(pastStart.getTime() + 60 * 60 * 1000),
      claimedBy: { id: staffId, name: 'Volunteer Staff' },
      proofMethod: 'QR',
      isScenarioDemo: true,
    });
  }
  console.log(`✓ Created Dulig: Completed (Time expired, 3/${duligTotal || 10} claims logged)`);

  // 3. Capandanan - Completed (Time expired with 0 claims / Unclaimed)
  const capandananTotal = await Residents.countDocuments({ barangay: 'Capandanan', status: 'Approved' });
  const capandananDistId = new mongoose.Types.ObjectId();
  await Dist.insertOne({
    _id: capandananDistId,
    disasterEventId: event._id,
    barangay: 'Capandanan',
    assignedBarangays: [],
    assignedStaffIds: [staffId],
    scheduled: pastStart,
    endsAt: pastEnd,
    households: capandananTotal || 10,
    status: 'Unclaimed',
    notes: '[SCENARIO_DEMO] Time expired with zero claims recorded',
    isScenarioDemo: true,
    createdAt: new Date(),
  });
  console.log(`✓ Created Capandanan: Completed (Time expired, 0/${capandananTotal || 10} claims logged)`);

  console.log('\nDemo scenarios seeded successfully!');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed to seed scenario demos:', err);
  process.exit(1);
});
