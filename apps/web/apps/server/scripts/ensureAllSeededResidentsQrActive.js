const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

const BARANGAY_PREFIXES = {
  'San Jose': 'SJ',
  'Poblacion': 'PO',
  'Bolo': 'BL',
  'Bongalon': 'BG',
  'Dulig': 'DL',
  'Laois': 'LS',
  'Magsaysay': 'MG',
  'San Gonzalo': 'SG',
  'Tobuan': 'TB',
  'Uyong': 'UY',
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const Res = mongoose.connection.collection('residents');
  const allResidents = await Res.find({ status: 'Approved' }).sort({ barangay: 1, createdAt: 1 }).toArray();

  const allCodes = await Res.distinct('residentCode', { residentCode: { $ne: null } });
  const existingSet = new Set(allCodes.map((c) => String(c).toUpperCase()));

  const brgyCounters = {};

  for (const r of allResidents) {
    const brgy = r.barangay || 'General';
    const prefix = BARANGAY_PREFIXES[brgy] || brgy.slice(0, 2).toUpperCase();

    if (!brgyCounters[brgy]) brgyCounters[brgy] = 1;

    let residentCode = r.residentCode;
    if (!residentCode) {
      let candidate = `${prefix}-2026-${String(brgyCounters[brgy]).padStart(6, '0')}`;
      while (existingSet.has(candidate)) {
        brgyCounters[brgy]++;
        candidate = `${prefix}-2026-${String(brgyCounters[brgy]).padStart(6, '0')}`;
      }
      residentCode = candidate;
      existingSet.add(candidate);
      brgyCounters[brgy]++;
    }

    await Res.updateOne(
      { _id: r._id },
      {
        $set: {
          residentCode,
          qrVersion: r.qrVersion || 1,
          qrStatus: 'ACTIVE',
          status: 'Approved',
        },
      }
    );
  }

  console.log(`Successfully ensured active QR codes for all ${allResidents.length} approved residents.`);
  await mongoose.disconnect();
}

main().catch(console.error);
