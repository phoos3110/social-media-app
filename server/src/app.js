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
});
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp(db, { testing = false } = {}) {
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
    maxHttpBufferSize: 16_384,
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
      WHERE s.token_hash=$1 AND s.expires_at > NOW()`,
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
  async function notify(userId, actorId, kind, postId = null) {
    if (userId === actorId) return;
    const inserted = await q(
      'INSERT INTO notifications(id,user_id,actor_id,kind,post_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',
      [randomUUID(), userId, actorId, kind, postId],
    );
    if (inserted.length) io.to(`user:${userId}`).emit('notification:new');
  }
  async function requirePost(postId) {
    const post = await one('SELECT * FROM posts WHERE id=$1', [id(postId)]);
    if (!post) throw new HttpError(404, 'Bài viết không còn tồn tại.');
    return post;
  }
  const postSelect = `SELECT p.*,row_to_json(u) AS author,
    (SELECT COUNT(*)::int FROM likes l WHERE l.post_id=p.id) AS like_count,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS is_liked,
    (SELECT COUNT(*)::int FROM comments c WHERE c.post_id=p.id) AS comment_count
    FROM posts p JOIN (SELECT id,username,name,bio,avatar,created_at FROM users) u ON u.id=p.user_id`;
  function postJSON(p) {
    return {
      id: p.id,
      author: publicUser(p.author),
      content: p.content,
      image: p.image,
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
    const user = await one('SELECT * FROM users WHERE email=$1', [input.email]);
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
  app.use('/api', auth);

  app.get('/api/users', async (req, res) => {
    const search = z
      .string()
      .max(100)
      .parse(req.query.search || '');
    const users = await q(
      `SELECT u.*,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=u.id) AS is_following,
      (SELECT COUNT(*)::int FROM follows f WHERE f.following_id=u.id) AS followers
      FROM users u WHERE u.id <> $1 AND (u.name ILIKE $2 OR u.username ILIKE $2)
      ORDER BY followers DESC,u.created_at DESC LIMIT 40`,
      [req.user.id, `%${search}%`],
    );
    res.json({
      users: users.map((u) => ({
        ...publicUser(u),
        isFollowing: u.is_following,
        followers: u.followers,
      })),
    });
  });
  app.get('/api/users/:id', async (req, res) => {
    const user = await one(
      `SELECT u.*,
      (SELECT COUNT(*)::int FROM follows WHERE following_id=u.id) AS followers,
      (SELECT COUNT(*)::int FROM follows WHERE follower_id=u.id) AS following,
      (SELECT COUNT(*)::int FROM posts WHERE user_id=u.id) AS post_count,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=u.id) AS is_following
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
      },
    });
  });
  async function ownedImage(userId, uploadId) {
    if (!uploadId) return '';
    const asset = await one('SELECT url FROM uploads WHERE id=$1 AND user_id=$2', [
      id(uploadId),
      userId,
    ]);
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
            { folder: 'nhip', resource_type: 'image', public_id: uploadId },
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
    await db.query('INSERT INTO uploads(id,user_id,url,public_id) VALUES($1,$2,$3,$4)', [
      uploadId,
      req.user.id,
      url,
      publicId,
    ]);
    res.status(201).json({ id: uploadId, url });
  });
  app.get('/api/posts', async (req, res) => {
    const input = z
      .object({
        search: z.string().max(100).default(''),
        author: uuid.optional(),
        feed: z.enum(['all', 'following']).default('all'),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    const rows = await q(
      `${postSelect} WHERE (p.content ILIKE $2 OR u.name ILIKE $2 OR u.username ILIKE $2)
      AND ($3::uuid IS NULL OR p.user_id=$3)
      AND ($4='all' OR p.user_id=$1 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.user_id))
      ORDER BY p.created_at DESC,p.id DESC LIMIT 21 OFFSET $5`,
      [req.user.id, `%${input.search}%`, input.author || null, input.feed, (input.page - 1) * 20],
    );
    res.json({ posts: rows.slice(0, 20).map(postJSON), hasMore: rows.length > 20 });
  });
  app.get('/api/posts/:id', async (req, res) => {
    const post = await one(`${postSelect} WHERE p.id=$2`, [req.user.id, id(req.params.id)]);
    if (!post) throw new HttpError(404, 'Bài viết không còn tồn tại.');
    res.json({ post: postJSON(post) });
  });
  app.post('/api/posts', async (req, res) => {
    const input = z
      .object({ content: z.string().trim().max(5000), uploadId: uuid.optional() })
      .parse(req.body);
    if (!input.content && !input.uploadId)
      throw new HttpError(400, 'Hãy viết nội dung hoặc chọn ảnh.');
    const image = await ownedImage(req.user.id, input.uploadId);
    const postId = randomUUID();
    await db.query('INSERT INTO posts(id,user_id,content,image) VALUES($1,$2,$3,$4)', [
      postId,
      req.user.id,
      input.content,
      image,
    ]);
    res
      .status(201)
      .json({ post: postJSON(await one(`${postSelect} WHERE p.id=$2`, [req.user.id, postId])) });
  });
  app.patch('/api/posts/:id', async (req, res) => {
    const post = await requirePost(req.params.id);
    if (post.user_id !== req.user.id)
      throw new HttpError(403, 'Bạn chỉ được sửa bài viết của mình.');
    const { content } = z.object({ content: z.string().trim().max(5000) }).parse(req.body);
    if (!content && !post.image) throw new HttpError(400, 'Bài viết cần có nội dung.');
    await db.query('UPDATE posts SET content=$1,updated_at=NOW() WHERE id=$2', [content, post.id]);
    res.json({ post: postJSON(await one(`${postSelect} WHERE p.id=$2`, [req.user.id, post.id])) });
  });
  app.delete('/api/posts/:id', async (req, res) => {
    const post = await requirePost(req.params.id);
    if (post.user_id !== req.user.id)
      throw new HttpError(403, 'Bạn chỉ được xóa bài viết của mình.');
    await db.query('DELETE FROM posts WHERE id=$1', [post.id]);
    res.json({ ok: true });
  });
  app.put('/api/posts/:id/like', async (req, res) => {
    const post = await requirePost(req.params.id);
    const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
    if (liked) {
      const inserted = await q(
        'INSERT INTO likes(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING *',
        [req.user.id, post.id],
      );
      if (inserted.length) await notify(post.user_id, req.user.id, 'like', post.id);
    } else
      await db.query('DELETE FROM likes WHERE user_id=$1 AND post_id=$2', [req.user.id, post.id]);
    res.json({ post: postJSON(await one(`${postSelect} WHERE p.id=$2`, [req.user.id, post.id])) });
  });
  app.get('/api/posts/:id/comments', async (req, res) => {
    await requirePost(req.params.id);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const rows = await q(
      `SELECT c.*,row_to_json(u) AS author FROM comments c
      JOIN (SELECT id,username,name,bio,avatar,created_at FROM users) u ON u.id=c.user_id
      WHERE c.post_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 21 OFFSET $2`,
      [req.params.id, (page - 1) * 20],
    );
    res.json({
      comments: rows.slice(0, 20).map((c) => ({
        id: c.id,
        content: c.content,
        author: publicUser(c.author),
        createdAt: c.created_at,
      })),
      hasMore: rows.length > 20,
    });
  });
  app.post('/api/posts/:id/comments', async (req, res) => {
    const post = await requirePost(req.params.id);
    const { content } = z.object({ content: text(2000) }).parse(req.body);
    const commentId = randomUUID();
    await db.query('INSERT INTO comments(id,post_id,user_id,content) VALUES($1,$2,$3,$4)', [
      commentId,
      post.id,
      req.user.id,
      content,
    ]);
    await notify(post.user_id, req.user.id, 'comment', post.id);
    res.status(201).json({ ok: true });
  });
  app.delete('/api/posts/:postId/comments/:id', async (req, res) => {
    const comment = await one('SELECT * FROM comments WHERE id=$1 AND post_id=$2', [
      id(req.params.id),
      id(req.params.postId),
    ]);
    if (!comment) throw new HttpError(404, 'Bình luận không tồn tại.');
    if (comment.user_id !== req.user.id)
      throw new HttpError(403, 'Bạn chỉ được xóa bình luận của mình.');
    await db.query('DELETE FROM comments WHERE id=$1', [comment.id]);
    res.json({ ok: true });
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
      JOIN (SELECT id,username,name,bio,avatar,created_at FROM users) u ON u.id=n.actor_id
      WHERE n.user_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 31 OFFSET $2`,
      [req.user.id, (page - 1) * 30],
    );
    const count = await one(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL',
      [req.user.id],
    );
    res.json({
      notifications: rows.slice(0, 30).map((n) => ({
        id: n.id,
        actor: publicUser(n.actor),
        kind: n.kind,
        postId: n.post_id,
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
      WHERE m.sender_id=$1 OR m.recipient_id=$1 ORDER BY u.id,m.created_at DESC,m.id DESC`,
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
  const messageJSON = (m) => ({
    id: m.id,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    content: m.content,
    createdAt: m.created_at,
    readAt: m.read_at,
  });
  app.get('/api/messages/:id', async (req, res) => {
    const target = id(req.params.id);
    if (!(await one('SELECT id FROM users WHERE id=$1', [target])))
      throw new HttpError(404, 'Không tìm thấy người dùng.');
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const rows = await q(
      `SELECT * FROM messages WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)
      ORDER BY created_at DESC,id DESC LIMIT 41 OFFSET $3`,
      [req.user.id, target, (page - 1) * 40],
    );
    res.json({ messages: rows.slice(0, 40).reverse().map(messageJSON), hasMore: rows.length > 40 });
  });
  app.patch('/api/messages/:id/read', async (req, res) => {
    await db.query(
      'UPDATE messages SET read_at=NOW() WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL',
      [id(req.params.id), req.user.id],
    );
    io.to(`user:${req.user.id}`).emit('conversation:read');
    res.json({ ok: true });
  });
  app.post('/api/messages/:id', async (req, res) => {
    const target = id(req.params.id);
    const { content } = z.object({ content: text(2000) }).parse(req.body);
    if (target === req.user.id) throw new HttpError(400, 'Hãy chọn người nhận khác.');
    if (!(await one('SELECT id FROM users WHERE id=$1', [target])))
      throw new HttpError(404, 'Không tìm thấy người dùng.');
    const message = await one(
      'INSERT INTO messages(id,sender_id,recipient_id,content) VALUES($1,$2,$3,$4) RETURNING *',
      [randomUUID(), req.user.id, target, content],
    );
    const payload = messageJSON(message);
    io.to(`user:${target}`).to(`user:${req.user.id}`).emit('message:new', payload);
    res.status(201).json({ message: payload });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API không tồn tại.' }));
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', dotfiles: 'deny' }));
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
      return res.status(400).json({ error: 'Chỉ nhận một ảnh, tối đa 5 MB.' });
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
