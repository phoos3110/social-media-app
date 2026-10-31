import 'dotenv/config';
import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { processMediaCleanup } from './cleanup.js';

if (process.env.RENDER === 'true') {
  for (const key of [
    'DATABASE_URL',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ]) {
    if (!process.env[key]) throw new Error(`Render deployment requires ${key}`);
  }
  if (process.env.MEDIA_DRIVER !== 'cloudinary') {
    throw new Error('Render deployment requires MEDIA_DRIVER=cloudinary');
  }
}

const db = await createDatabase();
const { http, io } = createApp(db);
void processMediaCleanup(db).catch(() => console.error('Media cleanup will retry later.'));
const cleanupTimer = setInterval(
  () => void processMediaCleanup(db).catch(() => console.error('Media cleanup will retry later.')),
  60000,
);
cleanupTimer.unref();
const port = Number(process.env.PORT || 4180);
http.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Po API listening on port ${port}`);
  console.log(
    `Database: ${process.env.DATABASE_URL ? 'PostgreSQL server' : 'embedded PostgreSQL (server/data/postgres)'}`,
  );
});
async function stop() {
  clearInterval(cleanupTimer);
  io.close();
  http.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
