import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { storeAsset } from './media-access.js';
export function videoRoutes(app, db) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });
  app.post('/api/videos', upload.single('video'), async (req, res) => {
    const file = req.file;
    const mp4 = file?.buffer.subarray(4, 8).toString() === 'ftyp';
    const webm = file?.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (
      !file ||
      !((mp4 && file.mimetype === 'video/mp4') || (webm && file.mimetype === 'video/webm'))
    )
      throw Object.assign(new Error('Chọn video MP4 hoặc WebM hợp lệ, tối đa 25 MB.'), {
        status: 400,
      });
    const id = randomUUID();
    let url,
      publicId = null;
    if (process.env.MEDIA_DRIVER === 'cloudinary') {
      const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET)
        throw Object.assign(new Error('Chưa cấu hình Cloudinary.'), { status: 503 });
      cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
      });
      const result = await new Promise((resolve, reject) =>
        cloudinary.uploader
          .upload_stream(
            { folder: 'po', resource_type: 'video', type: 'authenticated', public_id: id },
            (e, result) => (e ? reject(e) : resolve(result)),
          )
          .end(file.buffer),
      );
      url = result.secure_url;
      publicId = result.public_id;
    } else {
      const directory = fileURLToPath(new URL('../uploads/', import.meta.url));
      await mkdir(directory, { recursive: true });
      const filename = `${id}.${mp4 ? 'mp4' : 'webm'}`;
      await writeFile(`${directory}/${filename}`, file.buffer);
      url = `/uploads/${filename}`;
    }
    url = await storeAsset(db, { id, userId: req.user.id, url, publicId, kind: 'video' });
    res.status(201).json({ id, url, kind: 'video' });
  });
}
