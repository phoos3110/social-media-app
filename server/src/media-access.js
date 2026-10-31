import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { z } from 'zod';
import { adminUser } from './accounts.js';
const fail = (status, message) => Object.assign(new Error(message), { status });
export function mediaAccess(app, db) {
  async function serve(req, res, asset) {
    const admin = adminUser(req.user);
    if (!asset) throw fail(404, 'Tệp không tồn tại.');
    if (
      !admin &&
      (
        await db.query(
          'SELECT 1 FROM blocks WHERE (user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1)',
          [req.user.id, asset.user_id],
        )
      ).rows.length
    )
      throw fail(404, 'Tệp không tồn tại.');
    const owner = (
      await db.query('SELECT * FROM users WHERE id=$1 AND (banned=FALSE OR $2)', [
        asset.user_id,
        admin,
      ])
    ).rows[0];
    if (!owner) throw fail(404, 'Tệp không tồn tại.');
    if (
      !admin &&
      asset.user_id !== req.user.id &&
      owner.is_private &&
      owner.avatar !== asset.url &&
      owner.cover !== asset.url
    ) {
      const allowed = (
        await db.query(
          `SELECT 1 WHERE EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2)
        OR EXISTS(SELECT 1 FROM messages WHERE image=$3 AND recalled_at IS NULL AND (sender_id=$1 OR recipient_id=$1))`,
          [req.user.id, asset.user_id, asset.url],
        )
      ).rows[0];
      if (!allowed) throw fail(403, 'Bạn không có quyền xem tệp này.');
    }
    res.set('Cache-Control', 'private, no-store');
    const source = asset.source_url || asset.url;
    if (/^\/uploads\/[a-f0-9-]+\.(webp|mp4|webm)$/.test(source))
      return res.sendFile(fileURLToPath(new URL(`..${source}`, import.meta.url)));
    const sourceUrl = new URL(source);
    if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'res.cloudinary.com')
      throw fail(404, 'Nguồn tệp không hợp lệ.');
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const url =
      asset.delivery_type === 'authenticated'
        ? cloudinary.url(asset.public_id, {
            resource_type: asset.kind,
            type: 'authenticated',
            sign_url: true,
            secure: true,
            format: sourceUrl.pathname.match(/\.([a-z0-9]+)$/i)?.[1],
          })
        : source;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60000),
      headers: req.headers.range ? { Range: req.headers.range } : {},
    });
    if (!response.ok || !response.body) throw fail(502, 'Không tải được tệp.');
    res.status(response.status);
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges'])
      if (response.headers.get(key)) res.set(key, response.headers.get(key));
    Readable.fromWeb(response.body)
      .on('error', () => res.destroy())
      .pipe(res);
  }
  app.get('/api/media/:id', async (req, res) =>
    serve(
      req,
      res,
      (await db.query('SELECT * FROM uploads WHERE id=$1', [z.uuid().parse(req.params.id)]))
        .rows[0],
    ),
  );
  return async function legacy(req, res) {
    const source = '/uploads' + req.path;
    const asset = (await db.query('SELECT * FROM uploads WHERE url=$1 OR source_url=$1', [source]))
      .rows[0];
    return serve(req, res, asset);
  };
}
export async function storeAsset(db, { id, userId, url, publicId, kind = 'image' }) {
  const endpoint = `/api/media/${id}`;
  await db.query(
    'INSERT INTO uploads(id,user_id,url,public_id,kind,source_url,delivery_type) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, userId, endpoint, publicId, kind, url, publicId ? 'authenticated' : 'upload'],
  );
  return endpoint;
}

export async function protectLegacyMedia(db, userId) {
  const assets = (
    await db.query(
      "SELECT * FROM uploads WHERE user_id=$1 AND (url NOT LIKE '/api/media/%' OR (public_id IS NOT NULL AND delivery_type='upload'))",
      [userId],
    )
  ).rows;
  for (const asset of assets) {
    let source = asset.source_url || asset.url;
    if (asset.public_id) {
      if (!process.env.CLOUDINARY_API_SECRET)
        throw fail(503, 'Cần cấu hình Cloudinary để bảo vệ ảnh cũ trước khi bật riêng tư.');
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      let result;
      try {
        result = await cloudinary.uploader.rename(asset.public_id, asset.public_id, {
          resource_type: asset.kind,
          type: 'upload',
          to_type: 'authenticated',
          overwrite: true,
          invalidate: true,
        });
      } catch (e) {
        if (e.http_code !== 404) throw fail(503, 'Chưa thể bảo vệ tệp cũ. Vui lòng thử lại sau.');
        result = await cloudinary.api.resource(asset.public_id, {
          resource_type: asset.kind,
          type: 'authenticated',
        });
      }
      source = result.secure_url;
    }
    const endpoint = `/api/media/${asset.id}`;
    await db.query(
      `WITH asset AS (UPDATE uploads SET url=$1,source_url=$2,delivery_type=$3 WHERE id=$4 RETURNING id),
      profiles AS (UPDATE users SET avatar=CASE WHEN avatar=$5 THEN $1 ELSE avatar END,cover=CASE WHEN cover=$5 THEN $1 ELSE cover END WHERE avatar=$5 OR cover=$5 RETURNING id),
      images AS (UPDATE posts SET image=CASE WHEN image=$5 THEN $1 ELSE image END,
        media=COALESCE((SELECT jsonb_agg(CASE WHEN item->>'url'=$5 THEN jsonb_set(item,'{url}',to_jsonb($1::text)) ELSE item END ORDER BY ord) FROM jsonb_array_elements(media) WITH ORDINALITY AS entries(item,ord)),'[]'::jsonb)
        WHERE image=$5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(media) item WHERE item->>'url'=$5) RETURNING id),
      messages_updated AS (UPDATE messages SET image=$1 WHERE image=$5 RETURNING id) SELECT COUNT(*) FROM asset`,
      [endpoint, source, asset.public_id ? 'authenticated' : 'upload', asset.id, asset.url],
    );
  }
}
