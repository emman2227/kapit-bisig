import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import mongoose from 'mongoose';
import Resident from '../models/Resident';

async function main() {
  const uri = process.env.MONGODB_URI || '';
  if (!uri) {
    console.error('No MONGODB_URI found');
    return;
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB:', mongoose.connection.name);

  const emmanuels = await Resident.find({ firstName: /Emmanuel/i });
  console.log(`Found ${emmanuels.length} record(s) matching Emmanuel:`);
  for (const e of emmanuels) {
    console.log({
      id: e._id,
      name: e.fullName,
      status: e.status,
      registrationMethod: e.registrationMethod,
      faceImageLength: (e.faceImage || '').length,
      faceImagePreview: (e.faceImage || '').slice(0, 50),
      hasDescriptor: Boolean(e.faceDescriptor),
      descLength: (e.faceDescriptor || []).length,
    });
  }

  const allResidents = await Resident.find({}).select('fullName faceImage faceDescriptor status');
  let withImage = 0;
  let withDesc = 0;
  for (const r of allResidents) {
    if (r.faceImage && r.faceImage.length > 0) withImage++;
    if (r.faceDescriptor && Array.isArray(r.faceDescriptor) && r.faceDescriptor.length > 0) withDesc++;
  }
  console.log({
    totalResidents: allResidents.length,
    withImage,
    withDesc,
  });

  await mongoose.disconnect();
}

main().catch(console.error);
