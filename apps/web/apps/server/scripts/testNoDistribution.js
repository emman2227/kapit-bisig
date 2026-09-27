const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to database.');

  const Dist = mongoose.connection.collection('distributions');
  const Staff = mongoose.connection.collection('staffusers');

  const staff = await Staff.find({
    $or: [
      { email: 'pulanamanok123@gmail.com' },
      { email: 'demmanueljesse@gmail.com' },
    ],
  }).toArray();
  const staffIds = staff.map((s) => s._id);

  // Remove staff from all distributions
  await Dist.updateMany(
    {},
    {
      $pull: {
        assignedStaffIds: { $in: staffIds },
      },
    }
  );

  console.log('\n=============================================');
  console.log('TEST CASE 2 ACTIVE: NO DISTRIBUTION ASSIGNED');
  console.log('=============================================');
  console.log('Staff accounts have been unassigned from all active & upcoming distributions.');
  console.log('In the mobile app, you should now see:');
  console.log(' - Gray badge: "No Assignment"');
  console.log(' - Notice: "No active or upcoming distribution is explicitly assigned to this account."');
  console.log('\nTo restore Poblacion active distribution afterwards, run:');
  console.log(' node server/scripts/setupPoblacionTest.js --live');
  console.log('=============================================\n');

  await mongoose.disconnect();
}

main().catch(console.error);
