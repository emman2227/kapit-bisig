import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import mongoose from 'mongoose';

async function syncEmbeddings() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not found');
  }

  const rootDir = path.resolve(__dirname, '../../../../..');
  const bakPath = path.join(rootDir, 'backend', 'face_embeddings.json.bak');
  const jsonPath = path.join(rootDir, 'backend', 'face_embeddings.json');

  if (fs.existsSync(bakPath)) {
    fs.copyFileSync(bakPath, jsonPath);
    console.log('[Sync] Restored backend/face_embeddings.json from bak');
  } else {
    console.warn('[Sync] bakPath not found at:', bakPath);
  }

  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);

  await mongoose.connect(uri);
  console.log('[Sync] Connected to MongoDB:', mongoose.connection.name);

  const col = mongoose.connection.db!.collection('face_embeddings');

  for (const [id, rec] of Object.entries(data)) {
    const r = rec as any;
    const nameParts = (r.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    await col.updateOne(
      { resident_id: id },
      {
        $set: {
          resident_id: id,
          name: r.name,
          first_name: firstName,
          last_name: lastName,
          embedding_vector: r.embedding,
          created_at: new Date(r.registered_at || Date.now()),
        },
      },
      { upsert: true }
    );
    console.log(`[Sync] Upserted face embedding: ${r.name} (${id})`);
  }

  const count = await col.countDocuments();
  console.log(`[Sync] Total embeddings in MongoDB face_embeddings: ${count}`);

  await mongoose.disconnect();
}

syncEmbeddings().catch((err) => {
  console.error('[Sync] Error:', err);
  process.exit(1);
});
