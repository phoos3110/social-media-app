import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
const running = new WeakSet();
export async function processMediaCleanup(db) {
  if (running.has(db)) return;
  running.add(db);
  try {
    const rows = (
      await db.query('SELECT * FROM media_cleanup ORDER BY attempts,created_at LIMIT 20')
    ).rows;
    for (const row of rows) {
      try {
        if (row.public_id) {
          if (!process.env.CLOUDINARY_API_SECRET) continue;
          cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
          });
          await cloudinary.uploader.destroy(row.public_id, {
            resource_type: row.kind === 'video' ? 'video' : 'image',
            type: row.delivery_type === 'authenticated' ? 'authenticated' : 'upload',
            invalidate: true,
          });
        } else if (/^\/uploads\/[a-f0-9-]+\.(webp|mp4|webm)$/.test(row.source_url)) {
          await unlink(fileURLToPath(new URL(`..${row.source_url}`, import.meta.url))).catch(
            (e) => {
              if (e.code !== 'ENOENT') throw e;
            },
          );
        }
        await db.query('DELETE FROM media_cleanup WHERE id=$1', [row.id]);
      } catch {
        await db.query('UPDATE media_cleanup SET attempts=attempts+1 WHERE id=$1', [row.id]);
      }
    }
  } finally {
    running.delete(db);
  }
}
