import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import sharp from 'sharp';
import webpush from 'web-push';
import { v2 as cloudinary } from 'cloudinary';
import { io as connect } from 'socket.io-client';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

let db, app, http, io, adminDb, schema;
const mail = [],
  pushes = [],
  sockets = [];
before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    adminDb = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await adminDb.connect();
    schema = `features_${randomUUID().replaceAll('-', '')}`;
    await adminDb.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
  }
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  db = await createDatabase({ memory: !process.env.TEST_DATABASE_URL });
  ({ app, http, io } = createApp(db, {
    testing: true,
    sendMail: async (m) => mail.push(m),
    sendPush: async (s, p) => pushes.push({ subscription: s, payload: p }),
  }));
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
});
after(async () => {
  sockets.forEach((s) => s.disconnect());
  if (io) await new Promise((resolve) => io.close(resolve));
  await db?.close();
  if (adminDb) {
    await adminDb.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminDb.end();
  }
});
async function person(prefix = 'user') {
  const agent = request.agent(app),
    suffix = randomUUID().slice(0, 8),
    email = `${prefix}.${suffix}@example.com`;
  const response = await agent
    .post('/api/auth/register')
    .send({ name: prefix, username: `${prefix}_${suffix}`, email, password: 'Password123!' })
    .expect(201);
  return {
    agent,
    user: response.body.user,
    email,
    cookie: response.headers['set-cookie'][0].split(';')[0],
  };
}
const token = () =>
  new URLSearchParams(new URL(mail.at(-1).text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get(
    'token',
  );
const image = () =>
  sharp({ create: { width: 12, height: 12, channels: 3, background: '#1877f2' } })
    .png()
    .toBuffer();
const once = (socket, event) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 4000);
    socket.once(event, (p) => {
      clearTimeout(timeout);
      resolve(p);
    });
  });
async function socketFor(user) {
  const socket = connect(`http://127.0.0.1:${http.address().port}`, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Cookie: user.cookie },
  });
  sockets.push(socket);
  await once(socket, 'connect');
  return socket;
}

test('account verification, email changes, password reset and password changes use expiring one-use tokens and revoke sessions', async () => {
  const a = await person('security');
  await a.agent.post('/api/account/verification').expect(200);
  const verification = token();
  assert.equal((await a.agent.get('/api/account').expect(200)).body.emailVerified, false);
  await request(app).post('/api/auth/verify-email').send({ token: verification }).expect(200);
  await request(app).post('/api/auth/verify-email').send({ token: verification }).expect(400);
  assert.equal((await a.agent.get('/api/account').expect(200)).body.emailVerified, true);
  const nextEmail = `new.${randomUUID()}@example.com`;
  await a.agent.post('/api/account/email').send({ email: nextEmail, password: 'bad' }).expect(400);
  await a.agent
    .post('/api/account/email')
    .send({ email: nextEmail, password: 'Password123!' })
    .expect(200);
  assert.equal((await a.agent.get('/api/account')).body.email, a.email);
  await request(app).post('/api/auth/verify-email').send({ token: token() }).expect(200);
  assert.equal((await a.agent.get('/api/account')).body.email, nextEmail);
  await a.agent
    .post('/api/account/password')
    .send({ currentPassword: 'Password123!', password: 'NewPassword123!' })
    .expect(200);
  await request(app).get('/api/auth/me').set('Cookie', a.cookie).expect(401);
  await request(app)
    .post('/api/auth/login')
    .send({ email: nextEmail, password: 'Password123!' })
    .expect(401);
  const before = mail.length;
  const unknown = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'unknown@example.com' })
    .expect(200);
  assert.equal(mail.length, before);
  const known = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: nextEmail })
    .expect(200);
  assert.equal(known.body.message, unknown.body.message);
  const reset = token();
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token: reset, password: 'ResetPassword123!' })
    .expect(200);
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token: reset, password: 'AgainPassword123!' })
    .expect(400);
  await a.agent.get('/api/auth/me').expect(401);
  await a.agent
    .post('/api/auth/login')
    .send({ email: nextEmail, password: 'ResetPassword123!' })
    .expect(200);
  await request(app).post('/api/auth/forgot-password').send({ email: nextEmail }).expect(200);
  const expired = token();
  await db.query(
    "UPDATE account_tokens SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    [a.user.id],
  );
  await request(app)
    .post('/api/auth/reset-password')
    .send({ token: expired, password: 'ExpiredPassword123!' })
    .expect(400);
});

test('private posts, media, follow approval, bookmarks and two-way blocks are enforced on direct API access', async () => {
  const a = await person('private'),
    b = await person('visitor');
  const upload = (
    await a.agent
      .post('/api/uploads')
      .attach('image', await image(), 'image.png')
      .expect(201)
  ).body;
  const post = (
    await a.agent
      .post('/api/posts')
      .send({ content: 'Private photo', uploadIds: [upload.id] })
      .expect(201)
  ).body.post;
  await a.agent.patch('/api/account/privacy').send({ isPrivate: true }).expect(200);
  await b.agent.get(`/api/posts/${post.id}`).expect(404);
  await b.agent.get(upload.url).expect(403);
  assert.ok(!(await b.agent.get('/api/posts')).body.posts.some((p) => p.id === post.id));
  await b.agent.get(`/api/users/${a.user.id}/followers`).expect(403);
  const requested = (
    await b.agent.put(`/api/users/${a.user.id}/follow`).send({ following: true }).expect(200)
  ).body;
  assert.equal(requested.following, false);
  assert.equal(requested.requested, true);
  assert.ok(
    (await a.agent.get('/api/account/requests')).body.users.some((u) => u.id === b.user.id),
  );
  await a.agent.put(`/api/account/requests/${b.user.id}`).send({ accept: true }).expect(200);
  await b.agent.get(`/api/posts/${post.id}`).expect(200);
  await b.agent.get(upload.url).expect(200);
  await b.agent.put(`/api/posts/${post.id}/save`).send({ saved: true }).expect(200);
  assert.ok((await b.agent.get('/api/bookmarks')).body.posts.some((p) => p.id === post.id));
  await a.agent.put(`/api/users/${b.user.id}/block`).send({ blocked: true }).expect(200);
  await b.agent.get(`/api/users/${a.user.id}`).expect(404);
  await b.agent.get(upload.url).expect(404);
  await b.agent.get(`/api/posts/${post.id}/comments`).expect(404);
  await b.agent.post(`/api/messages/${a.user.id}`).send({ content: 'Blocked' }).expect(404);
  assert.equal((await b.agent.get('/api/bookmarks')).body.posts.length, 0);
  assert.ok((await a.agent.get('/api/account/blocks')).body.users.some((u) => u.id === b.user.id));
  await a.agent.put(`/api/users/${b.user.id}/block`).send({ blocked: false }).expect(200);
  await b.agent.get(`/api/users/${a.user.id}`).expect(200);
  await b.agent.get(`/api/posts/${post.id}`).expect(404);
});

test('multiple media, sharing without copying private content, comment edits, likes and deep comment context', async () => {
  const a = await person('writer'),
    b = await person('reader');
  const ids = [];
  for (let i = 0; i < 2; i++)
    ids.push(
      (
        await a.agent
          .post('/api/uploads')
          .attach('image', await image(), 'photo.png')
          .expect(201)
      ).body.id,
    );
  const post = (
    await a.agent.post('/api/posts').send({ content: 'Gallery', uploadIds: ids }).expect(201)
  ).body.post;
  assert.equal(post.media.length, 2);
  await b.agent.post('/api/posts').send({ content: 'Stolen', uploadIds: ids }).expect(400);
  await a.agent
    .post('/api/posts')
    .send({ content: 'Duplicate', uploadIds: [ids[0], ids[0]] })
    .expect(400);
  const share = (
    await b.agent.post('/api/posts').send({ content: 'A share', sharedPostId: post.id }).expect(201)
  ).body.post;
  assert.equal(share.sharedPostId, post.id);
  assert.equal(share.image, '');
  assert.equal(share.media.length, 0);
  const root = (await b.agent.post(`/api/posts/${post.id}/comments`).send({ content: 'Root' })).body
    .comment;
  const reply = (
    await a.agent
      .post(`/api/posts/${post.id}/comments`)
      .send({ content: 'Reply', parentId: root.id })
  ).body.comment;
  const child = (
    await b.agent
      .post(`/api/posts/${post.id}/comments`)
      .send({ content: 'Nested', parentId: reply.id })
      .expect(201)
  ).body.comment;
  await a.agent
    .patch(`/api/posts/${post.id}/comments/${root.id}`)
    .send({ content: 'Forbidden' })
    .expect(403);
  await b.agent
    .patch(`/api/posts/${post.id}/comments/${root.id}`)
    .send({ content: 'Edited root' })
    .expect(200);
  await a.agent
    .put(`/api/posts/${post.id}/comments/${root.id}/like`)
    .send({ liked: true })
    .expect(200);
  const rootData = (await a.agent.get(`/api/posts/${post.id}/comments`)).body.comments.find(
    (c) => c.id === root.id,
  );
  assert.equal(rootData.content, 'Edited root');
  assert.equal(rootData.likeCount, 1);
  assert.equal(rootData.isLiked, true);
  const context = (
    await b.agent.get(`/api/posts/${post.id}/comments/${child.id}/context`).expect(200)
  ).body.comments;
  assert.deepEqual(
    context.map((c) => c.id),
    [root.id, reply.id, child.id],
  );
  const notices = (await a.agent.get('/api/notifications')).body.notifications;
  assert.ok(notices.some((n) => n.commentId === child.id));
  await a.agent.patch('/api/account/privacy').send({ isPrivate: true }).expect(200);
  await b.agent.get(`/api/posts/${post.id}`).expect(404);
  const shared = (await b.agent.get(`/api/posts/${share.id}`).expect(200)).body.post;
  assert.equal(shared.content, 'A share');
  assert.equal(shared.media.length, 0);
  await a.agent
    .post('/api/videos')
    .attach('video', Buffer.from('not a video'), { filename: 'bad.mp4', contentType: 'video/mp4' })
    .expect(400);
});

test('chat supports image replies, idempotent sends, read receipts, online presence, typing and recall', async () => {
  const a = await person('sender'),
    b = await person('recipient');
  const sa = await socketFor(a),
    sb = await socketFor(b);
  assert.ok((await a.agent.get(`/api/presence?ids=${b.user.id}`)).body.online.includes(b.user.id));
  const typed = once(sb, 'typing');
  sa.emit('typing', { recipientId: b.user.id, typing: true });
  assert.equal((await typed).userId, a.user.id);
  const upload = (await a.agent.post('/api/uploads').attach('image', await image(), 'chat.png'))
    .body;
  const clientId = randomUUID();
  const first = (
    await a.agent
      .post(`/api/messages/${b.user.id}`)
      .send({ uploadId: upload.id, clientId })
      .expect(201)
  ).body.message;
  const duplicate = (
    await a.agent
      .post(`/api/messages/${b.user.id}`)
      .send({ uploadId: upload.id, clientId })
      .expect(201)
  ).body.message;
  assert.equal(first.id, duplicate.id);
  await a.agent
    .post(`/api/messages/${b.user.id}`)
    .send({ content: 'Different', clientId })
    .expect(409);
  const reply = (
    await b.agent
      .post(`/api/messages/${a.user.id}`)
      .send({ content: 'An image reply', replyToId: first.id })
      .expect(201)
  ).body.message;
  assert.equal(reply.replyTo.image, upload.url);
  const receipt = once(sa, 'message:read');
  await b.agent.patch(`/api/messages/${a.user.id}/read`).expect(200);
  assert.equal((await receipt).readerId, b.user.id);
  await b.agent.delete(`/api/messages/${first.id}`).expect(403);
  const recalled = once(sb, 'message:recalled');
  await a.agent.delete(`/api/messages/${first.id}`).expect(200);
  assert.equal((await recalled).image, '');
  const history = (await b.agent.get(`/api/messages/${a.user.id}`)).body.messages;
  assert.equal(history.find((m) => m.id === first.id).image, '');
  assert.ok(history.find((m) => m.id === reply.id).replyTo.recalledAt);
  const c = await person('stranger');
  await c.agent
    .post(`/api/messages/${a.user.id}`)
    .send({ content: 'Foreign reply', replyToId: first.id })
    .expect(400);
});

test('reports are admin-only to review; bans revoke sessions and an admin can unban', async () => {
  const admin = await person('admin'),
    a = await person('reporter'),
    b = await person('reported');
  process.env.ADMIN_EMAILS = admin.email;
  await admin.agent.get('/api/admin/reports').expect(403);
  await admin.agent.post('/api/account/verification').expect(200);
  await request(app).post('/api/auth/verify-email').send({ token: token() }).expect(200);
  const post = (await b.agent.post('/api/posts').send({ content: 'Reported content' })).body.post;
  await a.agent
    .post('/api/reports')
    .send({ postId: post.id, reason: 'Spam content report' })
    .expect(201);
  await a.agent.get('/api/admin/reports').expect(403);
  await a.agent.put(`/api/admin/users/${b.user.id}/ban`).send({ banned: true }).expect(403);
  const reports = (await admin.agent.get('/api/admin/reports').expect(200)).body.reports;
  assert.equal(reports[0].target_user_id, b.user.id);
  await admin.agent
    .patch(`/api/admin/reports/${reports[0].id}`)
    .send({ status: 'resolved' })
    .expect(200);
  await admin.agent.put(`/api/admin/users/${b.user.id}/ban`).send({ banned: true }).expect(200);
  await b.agent.get('/api/auth/me').expect(401);
  await b.agent
    .post('/api/auth/login')
    .send({ email: b.email, password: 'Password123!' })
    .expect(401);
  await a.agent.get(`/api/posts/${post.id}`).expect(404);
  await admin.agent.put(`/api/admin/users/${b.user.id}/ban`).send({ banned: false }).expect(200);
  await b.agent
    .post('/api/auth/login')
    .send({ email: b.email, password: 'Password123!' })
    .expect(200);
});

test('push subscriptions reject internal endpoints and are removed when their session logs out', async () => {
  const a = await person('pushuser');
  const keys = {
    p256dh: process.env.VAPID_PUBLIC_KEY,
    auth: randomBytes(16).toString('base64url'),
  };
  await a.agent
    .post('/api/push/subscriptions')
    .send({ endpoint: 'https://127.0.0.1/push', keys })
    .expect(400);
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  await a.agent.post('/api/push/subscriptions').send({ endpoint, keys }).expect(201);
  const actor = await person('pushactor');
  await actor.agent.put(`/api/users/${a.user.id}/follow`).send({ following: true }).expect(200);
  for (
    let attempt = 0;
    attempt < 30 && !pushes.some((p) => p.subscription.endpoint === endpoint);
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(
    pushes.some(
      (p) => p.subscription.endpoint === endpoint && p.payload.body.includes('thông báo'),
    ),
  );
  assert.equal(
    (
      await db.query('SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE user_id=$1', [
        a.user.id,
      ])
    ).rows[0].count,
    1,
  );
  await a.agent.post('/api/auth/logout').expect(200);
  assert.equal(
    (
      await db.query('SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE user_id=$1', [
        a.user.id,
      ])
    ).rows[0].count,
    0,
  );
});

test('legacy media is upgraded before privacy changes, and a storage failure does not falsely enable privacy', async () => {
  const a = await person('legacy');
  const assetId = randomUUID(),
    oldUrl = `https://res.cloudinary.com/demo/image/upload/legacy-${assetId}.webp`;
  await db.query('INSERT INTO uploads(id,user_id,url,public_id) VALUES($1,$2,$3,$4)', [
    assetId,
    a.user.id,
    oldUrl,
    `legacy-${assetId}`,
  ]);
  const post = (
    await a.agent
      .post('/api/posts')
      .send({ content: 'Legacy gallery', uploadId: assetId })
      .expect(201)
  ).body.post;
  const original = cloudinary.uploader.rename,
    secret = process.env.CLOUDINARY_API_SECRET;
  process.env.CLOUDINARY_API_SECRET = 'test-only';
  try {
    cloudinary.uploader.rename = async () => {
      throw { http_code: 500 };
    };
    await a.agent.patch('/api/account/privacy').send({ isPrivate: true }).expect(503);
    assert.equal((await a.agent.get('/api/account')).body.isPrivate, false);
    cloudinary.uploader.rename = async (_from, _to, options) => {
      assert.equal(options.to_type, 'authenticated');
      return { secure_url: oldUrl.replace('/upload/', '/authenticated/') };
    };
    await a.agent.patch('/api/account/privacy').send({ isPrivate: true }).expect(200);
    const data = (await a.agent.get(`/api/posts/${post.id}`).expect(200)).body.post;
    assert.equal(data.image, `/api/media/${assetId}`);
    assert.equal(data.media[0].url, data.image);
    assert.equal(
      (await db.query('SELECT delivery_type FROM uploads WHERE id=$1', [assetId])).rows[0]
        .delivery_type,
      'authenticated',
    );
  } finally {
    cloudinary.uploader.rename = original;
    if (secret === undefined) delete process.env.CLOUDINARY_API_SECRET;
    else process.env.CLOUDINARY_API_SECRET = secret;
  }
});

test('deleting an account requires its password and cascades owned content and sessions', async () => {
  const a = await person('deleted');
  await a.agent.post('/api/posts').send({ content: 'Delete with account' }).expect(201);
  await a.agent.delete('/api/account').send({ password: 'wrong' }).expect(400);
  await a.agent.delete('/api/account').send({ password: 'Password123!' }).expect(200);
  await a.agent.get('/api/auth/me').expect(401);
  assert.equal(
    (await db.query('SELECT COUNT(*)::int AS count FROM posts WHERE user_id=$1', [a.user.id]))
      .rows[0].count,
    0,
  );
});
