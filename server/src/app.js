import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { parse as parseCookie } from 'cookie';
import { z } from 'zod';
import multer from 'multer';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { accountRoutes } from './accounts.js';
import { communityRoutes, visiblePost } from './community.js';
import { pushRoutes } from './push.js';
import { messagingRoutes } from './messaging.js';
import { youtubeId } from './youtube.js';
import { videoRoutes } from './media.js';
import { mediaAccess, storeAsset } from './media-access.js';
import { socialRoutes } from './social.js';
import { protectLegacyMedia } from './media-access.js';
import { attachmentRoutes } from './attachments.js';
import { groupRoutes } from './groups.js';
import { callRoutes } from './calls.js';

const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const hash = (token) => createHash('sha256').update(token).digest('hex');
const uuid = z.uuid();
const text = (max) => z.string().trim().min(1, 'Vui lòng nhập nội dung.').max(max);
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  bio: u.bio,
  avatar: u.avatar,
  createdAt: u.created_at,
  cover: u.cover || '',
  isPrivate: Boolean(u.is_private),
});
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp(db, { testing = false, sendMail, sendPush } = {}) {
  const app = express();
  const http = createServer(app);
  const allowedOrigins = (
    process.env.CLIENT_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:5180,http://127.0.0.1:5180,http://localhost:4180,http://127.0.0.1:4180'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const io = new Server(http, {
    cors: { origin: allowedOrigins, credentials: true },
    maxHttpBufferSize: 65_536,
  });
  const uploadDir = fileURLToPath(new URL('../uploads/', import.meta.url));
  const production = process.env.NODE_ENV === 'production';
  const secureCookies = production && process.env.COOKIE_SECURE !== 'false';
  if (process.env.TRUST_PROXY_HOPS === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
          mediaSrc: ["'self'", 'blob:', 'https://res.cloudinary.com'],
          frameSrc: ['https://www.youtube-nocookie.com'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
    }),
  );
  // Browser writes must come from the configured app origin, including multipart uploads.
  app.use('/api', (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      !allowedOrigins.includes(req.headers.origin)
    ) {
      return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    }
    next();
  });
  if (!testing)
    app.use(
      '/api',
      rateLimit({
        windowMs: 60_000,
        limit: 240,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Bạn thao tác quá nhanh. Thử lại sau một phút.' },
      }),
    );
  app.use(express.json({ limit: '32kb' }));
  const authLimit = testing
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 15 * 60_000,
        limit: 30,
        message: { error: 'Quá nhiều lần đăng nhập. Hãy thử lại sau 15 phút.' },
      });
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0];
  const id = (value) => uuid.parse(value);
  async function sessionFromCookie(cookie) {
    const token = parseCookie(cookie || '').session;
    if (!token) return null;
    return one(
      `SELECT u.*,s.token_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at > NOW() AND u.banned=FALSE`,
      [hash(token)],
    );
  }
  async function auth(req, _res, next) {
    const user = await sessionFromCookie(req.headers.cookie);
    if (!user) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    req.user = user;
    next();
  }
  async function startSession(res, userId) {
    const token = randomBytes(32).toString('hex');
    await db.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [
      hash(token),
      userId,
      new Date(Date.now() + SESSION_AGE),
    ]);
    res.cookie('session', token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      maxAge: SESSION_AGE,
      path: '/',
    });
  }
  async function notify(userId, actorId, kind, postId = null, commentId = null) {
    const settings = await one('SELECT notification_preferences FROM users WHERE id=$1', [userId]);
    if (settings?.notification_preferences?.[kind] === false) return;
    if (
      postId &&
      (await one('SELECT 1 FROM post_preferences WHERE user_id=$1 AND post_id=$2 AND muted', [
        userId,
        postId,
      ]))
    )
      return;
    if (
      userId === actorId ||
      (await one(
        'SELECT 1 FROM blocks WHERE (user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1)',
        [userId, actorId],
      ))
    )
      return;
    const inserted = await q(
      'INSERT INTO notifications(id,user_id,actor_id,kind,post_id,comment_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',
      [randomUUID(), userId, actorId, kind, postId, commentId],
    );
    if (inserted.length) {
      io.to(`user:${userId}`).emit('notification:new');
      void push(userId, {
        body: 'Bạn có thông báo mới trên Po.',
        url: postId ? `/#post=${postId}${commentId ? '&comment=' + commentId : ''}` : '/',
        tag: 'notice-' + inserted[0].id,
      });
    }
  }
  async function mentions(content, actorId, postId, commentId = null) {
    const usernames = [
      ...new Set(
        [...content.matchAll(/(?:^|\s)@([A-Za-z0-9_]{3,30})/g)].map((m) => m[1].toLowerCase()),
      ),
    ].slice(0, 20);
    if (!usernames.length) return;
    const users = await q(
      'SELECT id FROM users WHERE lower(username)=ANY($1::text[]) AND banned=FALSE',
      [usernames],
    );
    for (const user of users) {
      const allowed = await one(`SELECT 1 FROM posts p WHERE p.id=$2 AND ${visiblePost()}`, [
        user.id,
        postId,
      ]);
      if (allowed) await notify(user.id, actorId, 'mention', postId, commentId);
    }
  }
  async function requirePost(postId, viewerId) {
    const post = await one(`SELECT p.* FROM posts p WHERE p.id=$2 AND ${visiblePost()}`, [
      viewerId,
      id(postId),
    ]);
    if (!post) throw new HttpError(404, 'Bài viết không còn tồn tại.');
    return post;
  }
  const postSelect = `SELECT p.*,row_to_json(u) AS author,
    (SELECT COUNT(*)::int FROM likes l WHERE l.post_id=p.id) AS like_count,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS is_liked,
    (SELECT reaction FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS my_reaction,
    (SELECT json_object_agg(reaction,total) FROM (SELECT reaction,COUNT(*)::int AS total FROM likes WHERE post_id=p.id GROUP BY reaction) counts) AS reactions,
    EXISTS(SELECT 1 FROM post_preferences pref WHERE pref.post_id=p.id AND pref.user_id=$1 AND pref.muted) AS is_muted,
    (SELECT COUNT(*)::int FROM comments c WHERE c.post_id=p.id) AS comment_count,
    EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id=p.id AND b.user_id=$1) AS is_saved
    FROM posts p JOIN (SELECT id,username,name,bio,avatar,cover,is_private,banned,created_at FROM users) u ON u.id=p.user_id`;
  function postJSON(p) {
    return {
      id: p.id,
      author: publicUser(p.author),
      content: p.content,
      audience: p.audience,
      kind: p.kind,
      expiresAt: p.expires_at,
      songTitle: p.song_title,
      songArtist: p.song_artist,
      myReaction: p.my_reaction || null,
      reactions: p.reactions || {},
      isMuted: p.is_muted,
      image: p.image,
      media: p.media?.length ? p.media : p.image ? [{ url: p.image, kind: 'image' }] : [],
      youtubeId: p.youtube_id || null,
      sharedPostId: p.shared_post_id,
      isSaved: p.is_saved,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      likeCount: p.like_count,
      isLiked: p.is_liked,
      commentCount: p.comment_count,
    };
  }
  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const input = z
      .object({
        name: text(80),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_]{3,30}$/, 'Tên người dùng gồm 3–30 chữ thường, số hoặc dấu gạch dưới.'),
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        password: z
          .string()
          .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
          .max(72)
          .refine(
            (value) => Buffer.byteLength(value, 'utf8') <= 72,
            'Mật khẩu tối đa 72 byte UTF-8.',
          ),
      })
      .parse(req.body);
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await one(
      `INSERT INTO users(id,username,email,name,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [userId, input.username, input.email, input.name, passwordHash],
    );
    await startSession(res, userId);
    res.status(201).json({ user: publicUser(user) });
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const input = z
      .object({ email: z.string().trim().toLowerCase().max(254), password: z.string().max(72) })
      .parse(req.body);
    const user = await one('SELECT * FROM users WHERE email=$1 AND banned=FALSE', [input.email]);
    // A valid fixed hash keeps password checking work similar for unknown accounts.
    const valid = await bcrypt.compare(
      input.password,
      user?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW',
    );
    if (!user || !valid) throw new HttpError(401, 'Email hoặc mật khẩu không đúng.');
    await startSession(res, user.id);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/auth/logout', auth, async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [req.user.token_hash]);
    io.in(`session:${req.user.token_hash}`).disconnectSockets();
    res.clearCookie('session', {
      path: '/',
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
    });
    res.json({ ok: true });
  });
  app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
  accountRoutes({ app, db, auth, authLimit, io, startSession, allowedOrigins, sendMail });
  app.use('/api', auth);
  videoRoutes(app, db);
  attachmentRoutes(app, db);
  const legacyMedia = mediaAccess(app, db);
  const { blocked, peer, changed } = communityRoutes({
    app,
    db,
    io,
    publicUser,
    postSelect,
    postJSON,
    requirePost,
    ownedImage,
    mentions,
  });
  const push = pushRoutes({ app, db, sendPush });
  messagingRoutes({ app, db, io, peer, ownedImage, push });
  socialRoutes({ app, db, io, requirePost, postSelect, postJSON, notify });
  groupRoutes({ app, db, io, peer, publicUser, push });
  callRoutes({ app, db, io, peer, publicUser });

  app.get('/api/users', async (req, res) => {
    const search = z
      .string()
      .max(100)
      .parse(req.query.search || '');
    const users = await q(
      `SELECT u.*,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=u.id) AS is_following,
      EXISTS(SELECT 1 FROM follow_requests r WHERE r.user_id=$1 AND r.target_id=u.id) AS requested,
      (SELECT COUNT(*)::int FROM follows f WHERE f.following_id=u.id) AS followers
      FROM users u WHERE u.id <> $1 AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$1 AND b.target_id=u.id) OR (b.target_id=$1 AND b.user_id=u.id)) AND (u.name ILIKE $2 OR u.username ILIKE $2)
      ORDER BY followers DESC,u.created_at DESC LIMIT 40`,
      [req.user.id, `%${search}%`],
    );
    res.json({
      users: users.map((u) => ({
        ...publicUser(u),
        isFollowing: u.is_following,
        requested: u.requested,
        followers: u.followers,
      })),
    });
  });
  app.get('/api/users/:id', async (req, res) => {
    await peer(req.user.id, id(req.params.id));
    const user = await one(
      `SELECT u.*,
      (SELECT COUNT(*)::int FROM follows WHERE following_id=u.id) AS followers,
      (SELECT COUNT(*)::int FROM follows WHERE follower_id=u.id) AS following,
      (SELECT COUNT(*)::int FROM posts WHERE user_id=u.id) AS post_count,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=u.id) AS is_following,
      EXISTS(SELECT 1 FROM follow_requests WHERE user_id=$1 AND target_id=u.id) AS requested
      FROM users u WHERE u.id=$2`,
      [req.user.id, id(req.params.id)],
    );
    if (!user) throw new HttpError(404, 'Không tìm thấy người dùng.');
    res.json({
      user: {
        ...publicUser(user),
        followers: user.followers,
        following: user.following,
        postCount: user.post_count,
        isFollowing: user.is_following,
        requested: user.requested,
      },
    });
  });
  app.get('/api/users/:id/:relationship', async (req, res, next) => {
    if (!['followers', 'following'].includes(req.params.relationship)) return next();
    const target = id(req.params.id);
    await peer(req.user.id, target);
    const owner = await one('SELECT is_private FROM users WHERE id=$1', [target]);
    if (
      owner?.is_private &&
      target !== req.user.id &&
      !(await one('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [
        req.user.id,
        target,
      ]))
    )
      throw new HttpError(403, 'Danh sách thuộc tài khoản riêng tư.');
    if (!(await one('SELECT id FROM users WHERE id=$1', [target])))
      throw new HttpError(404, 'Không tìm thấy người dùng.');
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const followers = req.params.relationship === 'followers';
    const rows = await q(
      `SELECT u.*, EXISTS(SELECT 1 FROM follows mine WHERE mine.follower_id=$1 AND mine.following_id=u.id) AS is_following
      FROM follows f JOIN users u ON u.id=f.${followers ? 'follower_id' : 'following_id'}
      WHERE f.${followers ? 'following_id' : 'follower_id'}=$2 AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$1 AND b.target_id=u.id) OR (b.target_id=$1 AND b.user_id=u.id)) ORDER BY u.name,u.id LIMIT 31 OFFSET $3`,
      [req.user.id, target, (page - 1) * 30],
    );
    res.json({
      users: rows.slice(0, 30).map((u) => ({ ...publicUser(u), isFollowing: u.is_following })),
      hasMore: rows.length > 30,
    });
  });
  async function ownedImage(userId, uploadId) {
    if (!uploadId) return '';
    const asset = await one('SELECT url,kind FROM uploads WHERE id=$1 AND user_id=$2', [
      id(uploadId),
      userId,
    ]);
    if (asset && asset.kind !== undefined && asset.kind !== 'image')
      throw new HttpError(400, 'Vui lòng chọn một ảnh hợp lệ.');
    if (!asset) throw new HttpError(400, 'Ảnh tải lên không hợp lệ.');
    return asset.url;
  }
  app.patch('/api/users/me', async (req, res) => {
    const input = z
      .object({ name: text(80), bio: z.string().trim().max(300), avatarUploadId: uuid.optional() })
      .parse(req.body);
    const avatar = input.avatarUploadId
      ? await ownedImage(req.user.id, input.avatarUploadId)
      : req.user.avatar;
    const user = await one('UPDATE users SET name=$1,bio=$2,avatar=$3 WHERE id=$4 RETURNING *', [
      input.name,
      input.bio,
      avatar,
      req.user.id,
    ]);
    res.json({ user: publicUser(user) });
  });
  app.put('/api/users/:id/follow', async (req, res) => {
    const target = id(req.params.id);
    const { following } = z.object({ following: z.boolean() }).parse(req.body);
    if (target === req.user.id) throw new HttpError(400, 'Bạn không thể tự theo dõi mình.');
    if (!(await one('SELECT id FROM users WHERE id=$1', [target])))
      throw new HttpError(404, 'Không tìm thấy người dùng.');
    await peer(req.user.id, target);
    const targetUser = await one('SELECT is_private FROM users WHERE id=$1', [target]);
    if (
      following &&
      targetUser.is_private &&
      !(await one('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [
        req.user.id,
        target,
      ]))
    ) {
      const insertedRequest = await q(
        'INSERT INTO follow_requests(user_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',
        [req.user.id, target],
      );
      if (insertedRequest.length) await notify(target, req.user.id, 'request');
      io.to(`user:${target}`).emit('permissions:changed');
      return res.json({ following: false, requested: true });
    }
    if (!following)
      await db.query('DELETE FROM follow_requests WHERE user_id=$1 AND target_id=$2', [
        req.user.id,
        target,
      ]);
    if (following) {
      const inserted = await q(
        'INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING *',
        [req.user.id, target],
      );
      if (inserted.length) await notify(target, req.user.id, 'follow');
    } else
      await db.query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [
        req.user.id,
        target,
      ]);
    res.json({ following });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.post('/api/uploads', upload.single('image'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Vui lòng chọn ảnh, tối đa 5 MB.');
    let buffer;
    try {
      buffer = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new HttpError(400, 'File không phải ảnh hợp lệ hoặc ảnh quá lớn.');
    }
    const uploadId = randomUUID();
    let url,
      publicId = null;
    if (process.env.MEDIA_DRIVER === 'cloudinary') {
      const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET)
        throw new HttpError(503, 'Chưa cấu hình Cloudinary trên server.');
      cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
      });
      const asset = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            { folder: 'po', resource_type: 'image', type: 'authenticated', public_id: uploadId },
            (error, result) => (error ? reject(error) : resolve(result)),
          )
          .end(buffer);
      });
      url = asset.secure_url;
      publicId = asset.public_id;
    } else {
      await mkdir(uploadDir, { recursive: true });
      await writeFile(`${uploadDir}/${uploadId}.webp`, buffer);
      url = `/uploads/${uploadId}.webp`;
    }
    url = await storeAsset(db, { id: uploadId, userId: req.user.id, url, publicId });
    res.status(201).json({ id: uploadId, url });
  });
  app.get('/api/posts', async (req, res) => {
    const input = z
      .object({
        search: z.string().max(100).default(''),
        author: uuid.optional(),
        feed: z.enum(['all', 'following']).default('all'),
        kind: z.enum(['post', 'story', 'reel']).default('post'),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    const rows = await q(
      `${postSelect} WHERE (p.content ILIKE $2 OR u.name ILIKE $2 OR u.username ILIKE $2)
      AND ${visiblePost()}
      AND p.kind=$6 AND NOT EXISTS(SELECT 1 FROM post_preferences pref WHERE pref.user_id=$1 AND pref.post_id=p.id AND pref.hidden)
      AND ($3::uuid IS NULL OR p.user_id=$3)
      AND ($4='all' OR p.user_id=$1 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.user_id))
      ORDER BY p.created_at DESC,p.id DESC LIMIT 21 OFFSET $5`,
      [
        req.user.id,
        `%${input.search}%`,
        input.author || null,
        input.feed,
        (input.page - 1) * 20,
        input.kind,
      ],
    );
    res.json({ posts: rows.slice(0, 20).map(postJSON), hasMore: rows.length > 20 });
  });
  app.get('/api/posts/:id', async (req, res) => {
    await requirePost(req.params.id, req.user.id);
    const post = await one(`${postSelect} WHERE p.id=$2`, [req.user.id, id(req.params.id)]);
    if (!post) throw new HttpError(404, 'Bài viết không còn tồn tại.');
    res.json({ post: postJSON(post) });
  });
  async function ownedMedia(userId, ids) {
    if (!ids.length) return [];
    if (new Set(ids).size !== ids.length)
      throw new HttpError(400, 'Không chọn trùng cùng một tệp.');
    const rows = await q(
      'SELECT id,url,kind FROM uploads WHERE id=ANY($1::uuid[]) AND user_id=$2',
      [ids, userId],
    );
    if (rows.length !== ids.length)
      throw new HttpError(400, 'Tệp tải lên không hợp lệ hoặc không thuộc tài khoản này.');
    if (rows.some((row) => !['image', 'video'].includes(row.kind)))
      throw new HttpError(400, 'Bài viết chỉ nhận ảnh/video.');
    return ids.map((id) => {
      const item = rows.find((row) => row.id === id);
      return { url: item.url, kind: item.kind };
    });
  }
  app.post('/api/posts', async (req, res) => {
    const input = z
      .object({
        content: z.string().trim().max(5000).default(''),
        uploadId: uuid.optional(),
        uploadIds: z.array(uuid).max(10).optional(),
        sharedPostId: uuid.optional(),
        audience: z.enum(['public', 'followers', 'private']).default('public'),
        kind: z.enum(['post', 'story', 'reel']).default('post'),
        songTitle: z.string().trim().max(200).default(''),
        songArtist: z.string().trim().max(200).default(''),
        youtubeUrl: z
          .string()
          .trim()
          .max(2048)
          .refine((url) => !url || Boolean(youtubeId(url)), 'Link YouTube không hợp lệ.')
          .optional(),
      })
      .parse(req.body);
    const media = await ownedMedia(
      req.user.id,
      input.uploadIds || (input.uploadId ? [input.uploadId] : []),
    );
    if (input.sharedPostId) await requirePost(input.sharedPostId, req.user.id);
    if (input.kind === 'reel' && !media.some((m) => m.kind === 'video'))
      throw new HttpError(400, 'Reel cần ít nhất một video.');
    if (input.audience !== 'public') await protectLegacyMedia(db, req.user.id);
    if (!input.content && !media.length && !input.sharedPostId && !input.youtubeUrl)
      throw new HttpError(400, 'Hãy nhập nội dung hoặc chọn ảnh/video.');
    const postId = randomUUID();
    await db.query(
      'INSERT INTO posts(id,user_id,content,image,media,shared_post_id,youtube_id,audience,kind,expires_at,song_title,song_artist) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        postId,
        req.user.id,
        input.content,
        media.find((m) => m.kind === 'image')?.url || '',
        JSON.stringify(media),
        input.sharedPostId || null,
        input.youtubeUrl ? youtubeId(input.youtubeUrl) : null,
        input.audience,
        input.kind,
        input.kind === 'story' ? new Date(Date.now() + 86400000) : null,
        input.songTitle,
        input.songArtist,
      ],
    );
    io.emit('feed:changed');
    await mentions(input.content, req.user.id, postId);
    res
      .status(201)
      .json({ post: postJSON(await one(`${postSelect} WHERE p.id=$2`, [req.user.id, postId])) });
  });
  app.patch('/api/posts/:id', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    if (post.user_id !== req.user.id)
      throw new HttpError(403, 'Bạn chỉ được sửa bài viết của mình.');
    const input = z
      .object({
        content: z.string().trim().max(5000),
        uploadIds: z.array(uuid).max(10).optional(),
        retainedMedia: z.array(z.string().max(2048)).max(10).optional(),
        audience: z.enum(['public', 'followers', 'private']).optional(),
        youtubeUrl: z
          .string()
          .trim()
          .max(2048)
          .refine((url) => !url || Boolean(youtubeId(url)), 'Link YouTube không hợp lệ.')
          .optional(),
        songTitle: z.string().trim().max(200).optional(),
        songArtist: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    const previousMedia = post.media?.length
      ? post.media
      : post.image
        ? [{ url: post.image, kind: 'image' }]
        : [];
    if (input.retainedMedia?.some((url) => !previousMedia.some((m) => m.url === url)))
      throw new HttpError(400, 'Tệp giữ lại không thuộc bài viết.');
    const media = input.retainedMedia
      ? [
          ...previousMedia.filter((m) => input.retainedMedia.includes(m.url)),
          ...(await ownedMedia(req.user.id, input.uploadIds || [])),
        ]
      : input.uploadIds
        ? await ownedMedia(req.user.id, input.uploadIds)
        : previousMedia;
    if (media.length > 10) throw new HttpError(400, 'Tối đa 10 ảnh/video.');
    if (post.kind === 'reel' && !media.some((m) => m.kind === 'video'))
      throw new HttpError(400, 'Reel cần ít nhất một video.');
    const song =
      input.youtubeUrl === undefined
        ? post.youtube_id
        : input.youtubeUrl
          ? youtubeId(input.youtubeUrl)
          : null;
    if (!input.content && !media.length && !post.shared_post_id && !song)
      throw new HttpError(400, 'Hãy nhập nội dung hoặc chọn ảnh/video.');
    if (input.audience && input.audience !== 'public') {
      await protectLegacyMedia(db, req.user.id);
      for (const item of media) {
        const asset = await one(
          'SELECT url FROM uploads WHERE user_id=$1 AND (url=$2 OR source_url=$2)',
          [req.user.id, item.url],
        );
        if (asset) item.url = asset.url;
      }
    }
    await db.query(
      'UPDATE posts SET content=$1,media=$2,image=$3,updated_at=NOW(),youtube_id=$5,audience=$6,song_title=$7,song_artist=$8 WHERE id=$4',
      [
        input.content,
        JSON.stringify(media),
        media.find((m) => m.kind === 'image')?.url || '',
        post.id,
        song,
        input.audience || post.audience,
        input.songTitle ?? post.song_title,
        input.songArtist ?? post.song_artist,
      ],
    );
    await mentions(input.content, req.user.id, post.id);
    changed(post.id);
    res.json({ post: postJSON(await one(`${postSelect} WHERE p.id=$2`, [req.user.id, post.id])) });
  });
  app.delete('/api/posts/:id', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    if (post.user_id !== req.user.id)
      throw new HttpError(403, 'Bạn chỉ được xóa bài viết của mình.');
    await db.query('DELETE FROM posts WHERE id=$1', [post.id]);
    io.emit('post:deleted', { id: post.id });
    res.json({ ok: true });
  });
  app.put('/api/posts/:id/like', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
    if (liked) {
      const inserted = await q(
        'INSERT INTO likes(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING *',
        [req.user.id, post.id],
      );
      if (inserted.length) await notify(post.user_id, req.user.id, 'like', post.id);
    } else
      await db.query('DELETE FROM likes WHERE user_id=$1 AND post_id=$2', [req.user.id, post.id]);
    changed(post.id);
    res.json({ post: postJSON(await one(`${postSelect} WHERE p.id=$2`, [req.user.id, post.id])) });
  });
  app.get('/api/posts/:id/comments', async (req, res) => {
    await requirePost(req.params.id, req.user.id);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const rows = await q(
      `SELECT c.*,row_to_json(u) AS author,
      (SELECT COUNT(*)::int FROM comments replies WHERE replies.parent_id=c.id) AS reply_count,
      (SELECT COUNT(*)::int FROM comment_likes cl WHERE cl.comment_id=c.id) AS like_count,
      EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id=c.id AND cl.user_id=$3) AS is_liked FROM comments c
      JOIN (SELECT id,username,name,bio,avatar,cover,is_private,banned,created_at FROM users) u ON u.id=c.user_id
      WHERE c.post_id=$1 AND c.parent_id IS NULL AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$3 AND b.target_id=c.user_id) OR (b.target_id=$3 AND b.user_id=c.user_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT 21 OFFSET $2`,
      [req.params.id, (page - 1) * 20, req.user.id],
    );
    res.json({
      comments: rows.slice(0, 20).map((c) => ({
        id: c.id,
        content: c.content,
        author: publicUser(c.author),
        createdAt: c.created_at,
        parentId: c.parent_id,
        replyCount: c.reply_count,
        likeCount: c.like_count,
        isLiked: c.is_liked,
      })),
      hasMore: rows.length > 20,
    });
  });
  app.get('/api/posts/:postId/comments/:id/replies', async (req, res) => {
    await requirePost(req.params.postId, req.user.id);
    const parent = await one('SELECT id FROM comments WHERE id=$1 AND post_id=$2', [
      id(req.params.id),
      id(req.params.postId),
    ]);
    if (!parent) throw new HttpError(404, 'Bình luận không tồn tại.');
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const rows = await q(
      `SELECT c.*,row_to_json(u) AS author,(SELECT COUNT(*)::int FROM comments child WHERE child.parent_id=c.id) AS reply_count,(SELECT COUNT(*)::int FROM comment_likes cl WHERE cl.comment_id=c.id) AS like_count,EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id=c.id AND cl.user_id=$3) AS is_liked FROM comments c
      JOIN (SELECT id,username,name,bio,avatar,cover,is_private,banned,created_at FROM users) u ON u.id=c.user_id
      WHERE c.parent_id=$1 AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$3 AND b.target_id=c.user_id) OR (b.target_id=$3 AND b.user_id=c.user_id)) ORDER BY c.created_at,c.id LIMIT 21 OFFSET $2`,
      [parent.id, (page - 1) * 20, req.user.id],
    );
    res.json({
      comments: rows.slice(0, 20).map((c) => ({
        id: c.id,
        content: c.content,
        author: publicUser(c.author),
        createdAt: c.created_at,
        parentId: c.parent_id,
        replyCount: c.reply_count,
        likeCount: c.like_count,
        isLiked: c.is_liked,
      })),
      hasMore: rows.length > 20,
    });
  });
  app.post('/api/posts/:id/comments', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    const { content, parentId } = z
      .object({ content: text(2000), parentId: uuid.nullable().optional() })
      .parse(req.body);
    const parent = parentId
      ? await one('SELECT * FROM comments WHERE id=$1 AND post_id=$2', [parentId, post.id])
      : null;
    if (parentId && !parent)
      throw new HttpError(404, 'Bình luận gốc không tồn tại trong bài viết này.');
    if (parent) {
      await peer(req.user.id, parent.user_id);
      const depth = await one(
        'WITH RECURSIVE chain AS (SELECT id,parent_id,1 AS depth FROM comments WHERE id=$1 UNION ALL SELECT c.id,c.parent_id,chain.depth+1 FROM comments c JOIN chain ON c.id=chain.parent_id WHERE chain.depth<11) SELECT MAX(depth)::int AS depth FROM chain',
        [parent.id],
      );
      if (depth.depth >= 10) throw new HttpError(400, 'Nhóm trả lời đã đạt giới hạn 10 cấp.');
    }
    const commentId = randomUUID();
    const created = await one(
      'INSERT INTO comments(id,post_id,user_id,content,parent_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [commentId, post.id, req.user.id, content, parentId || null],
    );
    if (parent) await notify(parent.user_id, req.user.id, 'reply', post.id, created.id);
    if (!parent || parent.user_id !== post.user_id)
      await notify(post.user_id, req.user.id, 'comment', post.id, created.id);
    await mentions(content, req.user.id, post.id, created.id);
    changed(post.id);
    res.status(201).json({
      ok: true,
      comment: {
        id: created.id,
        content: created.content,
        author: publicUser(req.user),
        createdAt: created.created_at,
        parentId: created.parent_id,
        replyCount: 0,
      },
    });
  });
  app.delete('/api/posts/:postId/comments/:id', async (req, res) => {
    await requirePost(req.params.postId, req.user.id);
    const comment = await one('SELECT * FROM comments WHERE id=$1 AND post_id=$2', [
      id(req.params.id),
      id(req.params.postId),
    ]);
    if (!comment) throw new HttpError(404, 'Bình luận không tồn tại.');
    if (comment.user_id !== req.user.id)
      throw new HttpError(403, 'Bạn chỉ được xóa bình luận của mình.');
    await db.query('DELETE FROM comments WHERE id=$1', [comment.id]);
    const count = await one('SELECT COUNT(*)::int AS count FROM comments WHERE post_id=$1', [
      comment.post_id,
    ]);
    changed(comment.post_id, { deletedCommentId: comment.id });
    res.json({ ok: true, commentCount: count.count });
  });
  app.get('/api/notifications', async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const rows = await q(
      `SELECT n.*,row_to_json(u) AS actor FROM notifications n
      JOIN (SELECT id,username,name,bio,avatar,cover,is_private,banned,created_at FROM users) u ON u.id=n.actor_id
      WHERE n.user_id=$1 AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$1 AND b.target_id=n.actor_id) OR (b.target_id=$1 AND b.user_id=n.actor_id)) ORDER BY n.created_at DESC,n.id DESC LIMIT 31 OFFSET $2`,
      [req.user.id, (page - 1) * 30],
    );
    const count = await one(
      'SELECT COUNT(*)::int AS count FROM notifications n JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1 AND n.read_at IS NULL AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$1 AND b.target_id=n.actor_id) OR (b.target_id=$1 AND b.user_id=n.actor_id))',
      [req.user.id],
    );
    res.json({
      notifications: rows.slice(0, 30).map((n) => ({
        id: n.id,
        actor: publicUser(n.actor),
        kind: n.kind,
        postId: n.post_id,
        commentId: n.comment_id,
        readAt: n.read_at,
        createdAt: n.created_at,
      })),
      unread: count.count,
      hasMore: rows.length > 30,
    });
  });
  app.patch('/api/notifications/read', async (req, res) => {
    await db.query('UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL', [
      req.user.id,
    ]);
    io.to(`user:${req.user.id}`).emit('notification:new');
    res.json({ ok: true });
  });
  app.patch('/api/notifications/:id/read', async (req, res) => {
    const updated = await q(
      'UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND user_id=$2 RETURNING id',
      [id(req.params.id), req.user.id],
    );
    if (!updated.length) throw new HttpError(404, 'Thông báo không tồn tại.');
    io.to(`user:${req.user.id}`).emit('notification:new');
    res.json({ ok: true });
  });
  app.get('/api/conversations', async (req, res) => {
    const rows = await q(
      `SELECT DISTINCT ON (u.id) u.id,u.username,u.name,u.bio,u.avatar,u.created_at,
      m.content AS last_message,m.created_at AS last_at,
      (SELECT COUNT(*)::int FROM messages x WHERE x.sender_id=u.id AND x.recipient_id=$1 AND x.read_at IS NULL) AS unread
      FROM messages m JOIN users u ON u.id=CASE WHEN m.sender_id=$1 THEN m.recipient_id ELSE m.sender_id END
      WHERE (m.sender_id=$1 OR m.recipient_id=$1) AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$1 AND b.target_id=u.id) OR (b.target_id=$1 AND b.user_id=u.id)) ORDER BY u.id,m.created_at DESC,m.id DESC`,
      [req.user.id],
    );
    res.json({
      conversations: rows
        .map((r) => ({
          user: publicUser(r),
          lastMessage: r.last_message,
          lastAt: r.last_at,
          unread: r.unread,
        }))
        .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)),
    });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API không tồn tại.' }));
  app.use('/uploads', auth, legacyMedia);
  const clientDir = fileURLToPath(new URL('../../client/dist/', import.meta.url));
  app.use(
    express.static(clientDir, {
      setHeaders(res, path) {
        if (path.endsWith('/sw.js') || path.endsWith('\\sw.js')) {
          res.set('Cache-Control', 'no-store');
          res.set('Service-Worker-Allowed', '/');
        } else if (path.endsWith('.webmanifest')) {
          res.type('application/manifest+json');
          res.set('Cache-Control', 'no-cache');
        } else if (path.endsWith('.html')) {
          res.set('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.get('/{*path}', (_req, res, next) =>
    res.sendFile(`${clientDir}/index.html`, (error) => error && next(error)),
  );
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: error.issues[0]?.message || 'Dữ liệu không hợp lệ.' });
    if (error instanceof multer.MulterError)
      return res.status(400).json({
        error: 'Tệp quá lớn hoặc không đúng định dạng: ảnh tối đa 5 MB, video tối đa 25 MB.',
      });
    if (error.code === '23505')
      return res.status(409).json({ error: 'Email hoặc tên người dùng đã được sử dụng.' });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'JSON không hợp lệ.' });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Nội dung quá lớn.' });
    const status = error.status || 500;
    if (status >= 500 && !testing) console.error(error.message);
    res
      .status(status)
      .json({ error: status >= 500 ? 'Server đang gặp sự cố. Vui lòng thử lại.' : error.message });
  });
  io.use(async (socket, next) => {
    try {
      if (
        socket.handshake.headers.origin &&
        !allowedOrigins.includes(socket.handshake.headers.origin)
      )
        return next(new Error('Nguồn kết nối không hợp lệ.'));
      const user = await sessionFromCookie(socket.handshake.headers.cookie);
      if (!user) return next(new Error('Vui lòng đăng nhập.'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Không thể xác thực.'));
    }
  });
  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    socket.join(`session:${user.token_hash}`);
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(1, new Date(user.expires_at).getTime() - Date.now()),
    );
    socket.on('disconnect', () => clearTimeout(timer));
  });
  return { app, http, io };
}
