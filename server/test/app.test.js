import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import sharp from 'sharp';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { migrateNotifications } from '../src/migrations.js';

let db, app, http, io, alice, bob, carol, aliceUser, bobUser, postId, commentId, cookie;
const sockets = [];
let postgresAdmin, testSchema;
before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    postgresAdmin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await postgresAdmin.connect();
    testSchema = `test_${randomUUID().replaceAll('-', '')}`;
    await postgresAdmin.query(`CREATE SCHEMA ${testSchema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${testSchema}`);
    process.env.DATABASE_URL = url.toString();
  }
  db = await createDatabase({ memory: !process.env.TEST_DATABASE_URL });
  ({ app, http, io } = createApp(db, { testing: true }));
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  alice = request.agent(app);
  bob = request.agent(app);
  carol = request.agent(app);
});
after(async () => {
  sockets.forEach((socket) => socket.disconnect());
  await new Promise((resolve) => io.close(resolve));
  await db.close();
  if (postgresAdmin) {
    await postgresAdmin.query(`DROP SCHEMA ${testSchema} CASCADE`);
    await postgresAdmin.end();
  }
});

test('authentication, validation, duplicate accounts, sessions and profile', async () => {
  await request(app).get('/api/posts').expect(401);
  await alice
    .post('/api/auth/register')
    .send({ name: 'Alice', username: 'alice', email: 'alice@example.com', password: 'short' })
    .expect(400);
  const a = await alice
    .post('/api/auth/register')
    .send({ name: 'Alice', username: 'alice', email: 'alice@example.com', password: 'password123' })
    .expect(201);
  aliceUser = a.body.user;
  cookie = a.headers['set-cookie'][0].split(';')[0];
  assert.match(a.headers['set-cookie'][0], /HttpOnly/);
  assert.equal(a.body.user.password_hash, undefined);
  const b = await bob
    .post('/api/auth/register')
    .send({ name: 'Bob', username: 'bob', email: 'bob@example.com', password: 'password123' })
    .expect(201);
  bobUser = b.body.user;
  await carol
    .post('/api/auth/register')
    .send({ name: 'Carol', username: 'carol', email: 'carol@example.com', password: 'password123' })
    .expect(201);
  await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', username: 'alice', email: 'alice@example.com', password: 'password123' })
    .expect(409);
  await request(app)
    .post('/api/auth/login')
    .send({ email: 'alice@example.com', password: 'incorrect' })
    .expect(401);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'alice@example.com', password: 'password123' })
    .expect(200);
  assert.equal(login.body.user.id, aliceUser.id);
  await alice.patch('/api/users/me').send({ name: 'Alice Nguyen', bio: 'Hello Nhịp' }).expect(200);
  const me = await alice.get('/api/auth/me').expect(200);
  assert.equal(me.body.user.name, 'Alice Nguyen');
  await alice
    .post('/api/posts')
    .set('Origin', 'https://evil.example')
    .send({ content: 'csrf' })
    .expect(403);
});

test('posts, ownership, idempotent likes, search and following feed', async () => {
  await alice.post('/api/posts').send({ content: '   ' }).expect(400);
  const created = await alice
    .post('/api/posts')
    .send({ content: 'Learning React together' })
    .expect(201);
  postId = created.body.post.id;
  await bob.patch(`/api/posts/${postId}`).send({ content: 'hacked' }).expect(403);
  await bob.delete(`/api/posts/${postId}`).expect(403);
  await alice
    .patch(`/api/posts/${postId}`)
    .send({ content: 'Learning React and TypeScript' })
    .expect(200);
  await bob.put(`/api/posts/${postId}/like`).send({ liked: true }).expect(200);
  const liked = await bob.put(`/api/posts/${postId}/like`).send({ liked: true }).expect(200);
  assert.equal(liked.body.post.likeCount, 1);
  assert.equal(liked.body.post.isLiked, true);
  const feedBefore = await bob.get('/api/posts?feed=following').expect(200);
  assert.equal(feedBefore.body.posts.length, 0);
  await bob.put(`/api/users/${aliceUser.id}/follow`).send({ following: true }).expect(200);
  await bob.put(`/api/users/${aliceUser.id}/follow`).send({ following: true }).expect(200);
  const profile = await bob.get(`/api/users/${aliceUser.id}`).expect(200);
  assert.equal(profile.body.user.followers, 1);
  const feedAfter = await bob.get('/api/posts?feed=following').expect(200);
  assert.equal(feedAfter.body.posts.length, 1);
  const search = await bob.get('/api/posts?search=TYPESCRIPT').expect(200);
  assert.equal(search.body.posts[0].id, postId);
  await bob.put(`/api/users/${bobUser.id}/follow`).send({ following: true }).expect(400);
  await bob.get('/api/posts?author=not-a-uuid').expect(400);
});

test('comments, notifications and permissions', async () => {
  await bob.post(`/api/posts/${postId}/comments`).send({ content: '   ' }).expect(400);
  await bob.post(`/api/posts/${postId}/comments`).send({ content: 'Nice work!' }).expect(201);
  const comments = await alice.get(`/api/posts/${postId}/comments`).expect(200);
  commentId = comments.body.comments[0].id;
  assert.equal(comments.body.comments[0].author.id, bobUser.id);
  await alice.delete(`/api/posts/${postId}/comments/${commentId}`).expect(403);
  const notifications = await alice.get('/api/notifications').expect(200);
  assert.equal(notifications.body.unread, 3);
  assert.deepEqual(notifications.body.notifications.map((n) => n.kind).sort(), [
    'comment',
    'follow',
    'like',
  ]);
  const notificationId = notifications.body.notifications[0].id;
  await bob.patch(`/api/notifications/${notificationId}/read`).expect(404);
  await alice.patch(`/api/notifications/${notificationId}/read`).expect(200);
  await alice.patch(`/api/notifications/${notificationId}/read`).expect(200);
  const partialRead = await alice.get('/api/notifications').expect(200);
  assert.equal(partialRead.body.unread, 2);
  await alice.patch('/api/notifications/read').expect(200);
  const read = await alice.get('/api/notifications').expect(200);
  assert.equal(read.body.unread, 0);
  await bob.delete(`/api/posts/${postId}/comments/${commentId}`).expect(200);
});

test('image decoding and upload ownership', async () => {
  await alice
    .post('/api/uploads')
    .attach('image', Buffer.from('not an image'), {
      filename: 'fake.png',
      contentType: 'image/png',
    })
    .expect(400);
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#286553' } })
    .png()
    .toBuffer();
  const upload = await alice.post('/api/uploads').attach('image', image, 'real.png').expect(201);
  assert.match(upload.body.url, /^\/uploads\/.*\.webp$/);
  await bob.post('/api/posts').send({ content: 'stolen', uploadId: upload.body.id }).expect(400);
  const post = await alice
    .post('/api/posts')
    .send({ content: '', uploadId: upload.body.id })
    .expect(201);
  assert.equal(post.body.post.image, upload.body.url);
  await alice.delete(`/api/posts/${post.body.post.id}`).expect(200);
});

test('authenticated realtime delivery, private history, unread counts and logout revocation', async () => {
  const url = `http://127.0.0.1:${http.address().port}`;
  const unauthorized = connect(url, { transports: ['websocket'], reconnection: false });
  sockets.push(unauthorized);
  await new Promise((resolve, reject) => {
    unauthorized.on('connect_error', resolve);
    unauthorized.on('connect', () => reject(new Error('Unauthenticated socket connected')));
  });
  const socket = connect(url, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  const delivery = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Message delivery timed out')), 3000);
    socket.once('message:new', (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
  const sent = await bob
    .post(`/api/messages/${aliceUser.id}`)
    .send({ content: 'Realtime hello!' })
    .expect(201);
  const received = await delivery;
  assert.equal(received.id, sent.body.message.id);
  const history = await alice.get(`/api/messages/${bobUser.id}`).expect(200);
  assert.equal(history.body.messages[0].content, 'Realtime hello!');
  const stranger = await carol.get(`/api/messages/${bobUser.id}`).expect(200);
  assert.equal(stranger.body.messages.length, 0);
  const conversations = await alice.get('/api/conversations').expect(200);
  assert.equal(conversations.body.conversations[0].unread, 1);
  await alice.patch(`/api/messages/${bobUser.id}/read`).expect(200);
  const read = await alice.get('/api/conversations').expect(200);
  assert.equal(read.body.conversations[0].unread, 0);
  const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
  await alice.post('/api/auth/logout').expect(200);
  await disconnected;
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
});

test('deleting a post cascades interactions; unfollow and unlike are repeatable', async () => {
  await bob.put(`/api/posts/${postId}/like`).send({ liked: false }).expect(200);
  await bob.put(`/api/posts/${postId}/like`).send({ liked: false }).expect(200);
  await bob.put(`/api/users/${aliceUser.id}/follow`).send({ following: false }).expect(200);
  await alice
    .post('/api/auth/login')
    .send({ email: 'alice@example.com', password: 'password123' })
    .expect(200);
  await alice.delete(`/api/posts/${postId}`).expect(200);
  await bob.get(`/api/posts/${postId}`).expect(404);
  const dangling = await db.query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE post_id=$1',
    [postId],
  );
  assert.equal(dangling.rows[0].count, 0);
});

test('follow and like toggles cannot spam notices, while separate comments still notify', async () => {
  const target = (await carol.get('/api/auth/me').expect(200)).body.user.id;
  const targetPost = (
    await carol.post('/api/posts').send({ content: 'Notification test' }).expect(201)
  ).body.post.id;
  for (let index = 0; index < 4; index++) {
    await bob.put(`/api/users/${target}/follow`).send({ following: true }).expect(200);
    await bob.put(`/api/users/${target}/follow`).send({ following: false }).expect(200);
    await bob.put(`/api/posts/${targetPost}/like`).send({ liked: true }).expect(200);
    await bob.put(`/api/posts/${targetPost}/like`).send({ liked: false }).expect(200);
  }
  const initial = (await carol.get('/api/notifications').expect(200)).body;
  assert.equal(initial.unread, 2);
  assert.deepEqual(initial.notifications.map((n) => n.kind).sort(), ['follow', 'like']);
  await carol.patch('/api/notifications/read').expect(200);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      bob.put(`/api/users/${target}/follow`).send({ following: true }).expect(200),
    ),
  );
  await bob.put(`/api/posts/${targetPost}/like`).send({ liked: true }).expect(200);
  assert.equal((await carol.get('/api/notifications').expect(200)).body.unread, 0);
  for (const content of ['First comment', 'Another comment']) {
    await bob.post(`/api/posts/${targetPost}/comments`).send({ content }).expect(201);
  }
  const final = (await carol.get('/api/notifications').expect(200)).body;
  assert.equal(final.notifications.length, 4);
  assert.equal(final.unread, 2);
});

test('migration merges historical duplicates, preserves unread state and is repeatable', async () => {
  // All changes are confined to the disposable test database/schema.
  await db.query('DROP INDEX notifications_follow_once');
  await db.query('DROP INDEX notifications_like_once');
  await db.query("DELETE FROM schema_migrations WHERE version='001_notification_dedup'");
  const target = (await carol.get('/api/auth/me').expect(200)).body.user.id;
  const latestId = randomUUID();
  const likedPost = (
    await db.query(
      "SELECT post_id FROM notifications WHERE user_id=$1 AND actor_id=$2 AND kind='like'",
      [target, bobUser.id],
    )
  ).rows[0].post_id;
  await db.query(
    "INSERT INTO notifications(id,user_id,actor_id,kind,post_id) VALUES($1,$2,$3,'like',$4)",
    [randomUUID(), target, bobUser.id, likedPost],
  );
  await db.query(
    `INSERT INTO notifications(id,user_id,actor_id,kind,read_at,created_at)
    VALUES($1,$2,$3,'follow',NULL,NOW()-INTERVAL '1 day'),
          ($4,$2,$3,'follow',NOW(),NOW()+INTERVAL '1 day')`,
    [randomUUID(), target, bobUser.id, latestId],
  );
  await migrateNotifications(db);
  await migrateNotifications(db);
  const notices = (await carol.get('/api/notifications').expect(200)).body;
  const follows = notices.notifications.filter(
    (n) => n.kind === 'follow' && n.actor.id === bobUser.id,
  );
  assert.equal(follows.length, 1);
  assert.equal(follows[0].id, latestId);
  assert.equal(follows[0].readAt, null);
  assert.equal(notices.notifications.filter((n) => n.kind === 'comment').length, 2);
  assert.equal(notices.notifications.filter((n) => n.kind === 'like').length, 1);
  // The database constraint also protects against concurrent direct inserts.
  await assert.rejects(
    db.query("INSERT INTO notifications(id,user_id,actor_id,kind) VALUES($1,$2,$3,'follow')", [
      randomUUID(),
      target,
      bobUser.id,
    ]),
    (error) => error.code === '23505',
  );
});
