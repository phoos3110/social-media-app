import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { storeAsset } from './media-access.js';
import { z } from 'zod';
const fail = (status, message) => Object.assign(new Error(message), { status });
export function attachmentRoutes(app, db) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });
  app.post('/api/attachments', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file || !file.size) throw fail(400, 'Chọn tệp hợp lệ, tối đa 25 MB.');
    const extension = file.originalname.split('.').pop().toLowerCase();
    const buffer = file.buffer;
    const audio = req.body.kind === 'audio';
    const mime = {
      pdf: 'application/pdf',
      txt: 'text/plain',
      zip: 'application/zip',
      webm: 'audio/webm',
      ogg: 'audio/ogg',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
    }[extension];
    const valid = {
      pdf: () => buffer.subarray(0, 5).toString() === '%PDF-',
      zip: () => buffer.subarray(0, 2).toString() === 'PK',
      txt: () =>
        !buffer.includes(0) &&
        !new TextDecoder('utf-8', { fatal: true }).decode(buffer).includes('\u0000'),
      webm: () => buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
      ogg: () => buffer.subarray(0, 4).toString() === 'OggS',
      mp3: () =>
        buffer.subarray(0, 3).toString() === 'ID3' ||
        (buffer[0] === 255 && (buffer[1] & 224) === 224),
      m4a: () => buffer.subarray(4, 8).toString() === 'ftyp',
      wav: () =>
        buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE',
    };
    let ok = false;
    try {
      ok = Boolean(mime && valid[extension]?.());
    } catch {}
    if (!ok || (audio && !['webm', 'ogg', 'mp3', 'm4a', 'wav'].includes(extension)))
      throw fail(400, 'Hỗ trợ PDF, TXT, ZIP và âm thanh WebM/OGG/MP3/M4A/WAV.');
    const id = randomUUID();
    const kind = audio ? 'audio' : 'file';
    let url,
      publicId = null;
    if (process.env.MEDIA_DRIVER === 'cloudinary') {
      if (!process.env.CLOUDINARY_API_SECRET) throw fail(503, 'Chưa cấu hình Cloudinary.');
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const asset = await new Promise((resolve, reject) =>
        cloudinary.uploader
          .upload_stream(
            {
              folder: 'po',
              resource_type: audio ? 'video' : 'raw',
              type: 'authenticated',
              public_id: audio ? id : `${id}.${extension}`,
            },
            (e, result) => (e ? reject(e) : resolve(result)),
          )
          .end(buffer),
      );
      url = asset.secure_url;
      publicId = asset.public_id;
    } else {
      const directory = fileURLToPath(new URL('../uploads/', import.meta.url));
      await mkdir(directory, { recursive: true });
      await writeFile(`${directory}/${id}.${extension}`, buffer);
      url = `/uploads/${id}.${extension}`;
    }
    url = await storeAsset(db, { id, userId: req.user.id, url, publicId, kind });
    const name =
      file.originalname.replace(/[\x00-\x1f\x7f/\\]/g, '').slice(0, 200) || `file.${extension}`;
    await db.query('UPDATE uploads SET original_name=$1,content_type=$2 WHERE id=$3', [
      name,
      mime,
      id,
    ]);
    res.status(201).json({ id, url, kind, name });
  });
}
export async function ownedAttachment(db, userId, uploadId) {
  if (!uploadId) return null;
  const asset = (
    await db.query(
      "SELECT * FROM uploads WHERE id=$1 AND user_id=$2 AND kind IN ('file','audio')",
      [z.uuid().parse(uploadId), userId],
    )
  ).rows[0];
  if (!asset) throw fail(400, 'Tệp không hợp lệ hoặc không thuộc tài khoản này.');
  return { id: asset.id, url: asset.url, kind: asset.kind, name: asset.original_name };
}
