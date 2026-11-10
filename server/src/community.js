import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminUser } from './accounts.js';
import { protectLegacyMedia } from './media-access.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function visiblePost(alias = 'p', viewer = '$1') {
  return `EXISTS(SELECT 1 FROM users author WHERE author.id=${alias}.user_id AND author.banned=FALSE
    AND (author.id=${viewer} OR author.is_private=FALSE OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=${viewer} AND f.following_id=author.id)))
    AND (${alias}.user_id=${viewer} OR ${alias}.audience='public' OR (${alias}.audience='followers' AND EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=${viewer} AND f.following_id=${alias}.user_id)))
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at>NOW())
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=${viewer} AND b.target_id=${alias}.user_id) OR (b.target_id=${viewer} AND b.user_id=${alias}.user_id))`;
}
export function communityRoutes({
  app,
  db,
  io,
  publicUser,
  postSelect,
  postJSON,
  requirePost,
  ownedImage,
  mentions,
}) {
  const q = async (s, p = []) => (await db.query(s, p)).rows;
  const one = async (s, p = []) => (await q(s, p))[0];
  const id = (value) => z.uuid().parse(value);
  const page = (req) =>
    z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
  async function blocked(a, b) {
    return Boolean(
      await one(
        'SELECT 1 FROM blocks WHERE (user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1)',
        [a, b],
      ),
    );
  }
  async function peer(a, b) {
    if (
      !(await one('SELECT id FROM users WHERE id=$1 AND banned=FALSE', [b])) ||
      (await blocked(a, b))
    )
      throw fail(404, 'Không thể tương tác với người dùng này.');
  }
  const changed = (postId, extra = {}) => io.emit('post:changed', { id: postId, ...extra });
  app.patch('/api/account/privacy', async (req, res) => {
    const { isPrivate } = z.object({ isPrivate: z.boolean() }).parse(req.body);
    if (isPrivate) await protectLegacyMedia(db, req.user.id);
    await db.query('UPDATE users SET is_private=$1 WHERE id=$2', [isPrivate, req.user.id]);
    if (!isPrivate) {
      await db.query(
        'INSERT INTO follows(follower_id,following_id) SELECT user_id,target_id FROM follow_requests WHERE target_id=$1 ON CONFLICT DO NOTHING',
        [req.user.id],
      );
      await db.query('DELETE FROM follow_requests WHERE target_id=$1', [req.user.id]);
    }
    io.emit('permissions:changed');
    res.json({ isPrivate });
  });
  app.get('/api/account/blocks', async (req, res) =>
    res.json({
      users: (
        await q(
          'SELECT u.* FROM blocks b JOIN users u ON u.id=b.target_id WHERE b.user_id=$1 ORDER BY u.name,u.id',
          [req.user.id],
        )
      ).map(publicUser),
    }),
  );
  app.put('/api/users/:id/block', async (req, res) => {
    const target = id(req.params.id);
    if (target === req.user.id) throw fail(400, 'Không thể chặn chính mình.');
    if (!(await one('SELECT id FROM users WHERE id=$1', [target])))
      throw fail(404, 'Người dùng không tồn tại.');
    const { blocked: enable } = z.object({ blocked: z.boolean() }).parse(req.body);
    if (enable) {
      await db.query('INSERT INTO blocks(user_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        req.user.id,
        target,
      ]);
      await db.query(
        'DELETE FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)',
        [req.user.id, target],
      );
      await db.query(
        'DELETE FROM follow_requests WHERE (user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1)',
        [req.user.id, target],
      );
      await db.query(
        'DELETE FROM notifications WHERE (user_id=$1 AND actor_id=$2) OR (user_id=$2 AND actor_id=$1)',
        [req.user.id, target],
      );
    } else
      await db.query('DELETE FROM blocks WHERE user_id=$1 AND target_id=$2', [req.user.id, target]);
    io.to(`user:${target}`).to(`user:${req.user.id}`).emit('permissions:changed');
    res.json({ blocked: enable });
  });
  app.get('/api/account/requests', async (req, res) =>
    res.json({
      users: (
        await q(
          'SELECT u.* FROM follow_requests r JOIN users u ON u.id=r.user_id WHERE r.target_id=$1 ORDER BY r.created_at DESC LIMIT 100',
          [req.user.id],
        )
      ).map(publicUser),
    }),
  );
  app.put('/api/account/requests/:id', async (req, res) => {
    const target = id(req.params.id);
    await peer(req.user.id, target);
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    if (accept)
      await db.query(
        'INSERT INTO follows(follower_id,following_id) SELECT user_id,target_id FROM follow_requests WHERE user_id=$1 AND target_id=$2 ON CONFLICT DO NOTHING',
        [target, req.user.id],
      );
    await db.query('DELETE FROM follow_requests WHERE user_id=$1 AND target_id=$2', [
      target,
      req.user.id,
    ]);
    io.to(`user:${target}`).emit('permissions:changed');
    res.json({ ok: true });
  });
  app.put('/api/posts/:id/save', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    const { saved } = z.object({ saved: z.boolean() }).parse(req.body);
    if (saved)
      await db.query(
        'INSERT INTO bookmarks(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [req.user.id, post.id],
      );
    else
      await db.query('DELETE FROM bookmarks WHERE user_id=$1 AND post_id=$2', [
        req.user.id,
        post.id,
      ]);
    res.json({ saved });
  });
  app.get('/api/bookmarks', async (req, res) => {
    const rows = await q(
      `${postSelect} WHERE EXISTS(SELECT 1 FROM bookmarks b WHERE b.user_id=$1 AND b.post_id=p.id) AND ${visiblePost()} ORDER BY p.created_at DESC,p.id DESC LIMIT 21 OFFSET $2`,
      [req.user.id, (page(req) - 1) * 20],
    );
    res.json({ posts: rows.slice(0, 20).map(postJSON), hasMore: rows.length > 20 });
  });
  app.get('/api/posts/:id/likes', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    const rows = await q(
      `SELECT u.* FROM likes l JOIN users u ON u.id=l.user_id WHERE l.post_id=$1 AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$2 AND b.target_id=u.id) OR (b.target_id=$2 AND b.user_id=u.id)) ORDER BY u.name,u.id LIMIT 31 OFFSET $3`,
      [post.id, req.user.id, (page(req) - 1) * 30],
    );
    res.json({ users: rows.slice(0, 30).map(publicUser), hasMore: rows.length > 30 });
  });
  app.get('/api/posts/:postId/comments/:id/context', async (req, res) => {
    await requirePost(req.params.postId, req.user.id);
    const rows = await q(
      `WITH RECURSIVE chain AS (
      SELECT c.*,0 AS depth FROM comments c WHERE c.id=$1 AND c.post_id=$2
      UNION ALL SELECT c.*,chain.depth+1 FROM comments c JOIN chain ON c.id=chain.parent_id WHERE chain.depth<20
    ) SELECT c.*,row_to_json(u) AS author,
      (SELECT COUNT(*)::int FROM comments child WHERE child.parent_id=c.id) AS reply_count,
      (SELECT COUNT(*)::int FROM comment_likes cl WHERE cl.comment_id=c.id) AS like_count,
      EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id=c.id AND cl.user_id=$3) AS is_liked
      FROM chain c JOIN (SELECT id,username,name,bio,avatar,cover,is_private,banned,created_at FROM users) u ON u.id=c.user_id
      WHERE u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$3 AND b.target_id=c.user_id) OR (b.target_id=$3 AND b.user_id=c.user_id)) ORDER BY c.depth DESC`,
      [id(req.params.id), id(req.params.postId), req.user.id],
    );
    if (!rows.length || rows[0].parent_id !== null || !rows.some((row) => row.id === req.params.id))
      throw fail(404, 'Bình luận không còn khả dụng.');
    res.json({
      comments: rows.map((c) => ({
        id: c.id,
        content: c.content,
        author: publicUser(c.author),
        createdAt: c.created_at,
        parentId: c.parent_id,
        replyCount: c.reply_count,
        likeCount: c.like_count,
        isLiked: c.is_liked,
      })),
    });
  });
  app.patch('/api/posts/:postId/comments/:id', async (req, res) => {
    await requirePost(req.params.postId, req.user.id);
    const { content } = z.object({ content: z.string().trim().min(1).max(2000) }).parse(req.body);
    const comment = await one('SELECT * FROM comments WHERE id=$1 AND post_id=$2', [
      id(req.params.id),
      id(req.params.postId),
    ]);
    if (!comment) throw fail(404, 'Bình luận không tồn tại.');
    if (comment.user_id !== req.user.id) throw fail(403, 'Bạn chỉ được sửa bình luận của mình.');
    await db.query('UPDATE comments SET content=$1 WHERE id=$2', [content, comment.id]);
    await mentions(content, req.user.id, comment.post_id, comment.id);
    changed(comment.post_id);
    res.json({ content });
  });
  app.put('/api/posts/:postId/comments/:id/like', async (req, res) => {
    await requirePost(req.params.postId, req.user.id);
    const comment = await one('SELECT id FROM comments WHERE id=$1 AND post_id=$2', [
      id(req.params.id),
      id(req.params.postId),
    ]);
    if (!comment) throw fail(404, 'Bình luận không tồn tại.');
    const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
    if (liked)
      await db.query(
        'INSERT INTO comment_likes(user_id,comment_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [req.user.id, comment.id],
      );
    else
      await db.query('DELETE FROM comment_likes WHERE user_id=$1 AND comment_id=$2', [
        req.user.id,
        comment.id,
      ]);
    const count = await one(
      'SELECT COUNT(*)::int AS count FROM comment_likes WHERE comment_id=$1',
      [comment.id],
    );
    changed(req.params.postId);
    res.json({ liked, likeCount: count.count });
  });
  app.post('/api/reports', async (req, res) => {
    const input = z
      .object({
        postId: z.uuid().optional(),
        userId: z.uuid().optional(),
        reason: z.string().trim().min(5).max(1000),
      })
      .refine((v) => Boolean(v.postId) !== Boolean(v.userId), 'Chọn một đối tượng báo cáo.')
      .parse(req.body);
    let reportedAuthor = input.userId;
    if (input.postId) reportedAuthor = (await requirePost(input.postId, req.user.id)).user_id;
    else await peer(req.user.id, input.userId);
    await db.query(
      'INSERT INTO reports(id,user_id,target_user_id,post_id,reason) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), req.user.id, reportedAuthor || null, input.postId || null, input.reason],
    );
    res.status(201).json({ ok: true });
  });
  app.use('/api/admin', (req, _res, next) => {
    if (!adminUser(req.user)) throw fail(403, 'Chỉ quản trị viên được truy cập.');
    next();
  });
  app.get('/api/admin/reports', async (req, res) => {
    const rows = await q(
      `SELECT r.*,p.content AS post_content,p.media AS post_media,p.image AS post_image,u.username AS target_username FROM reports r LEFT JOIN posts p ON p.id=r.post_id LEFT JOIN users u ON u.id=r.target_user_id ORDER BY r.created_at DESC,r.id LIMIT 31 OFFSET $1`,
      [(page(req) - 1) * 30],
    );
    res.json({ reports: rows.slice(0, 30), hasMore: rows.length > 30 });
  });
  app.patch('/api/admin/reports/:id', async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['open', 'resolved', 'dismissed']) })
      .parse(req.body);
    const report = await one('UPDATE reports SET status=$1 WHERE id=$2 RETURNING id', [
      status,
      id(req.params.id),
    ]);
    if (!report) throw fail(404, 'Báo cáo không tồn tại.');
    res.json({ ok: true });
  });
  app.put('/api/admin/users/:id/ban', async (req, res) => {
    const target = id(req.params.id);
    const user = await one('SELECT * FROM users WHERE id=$1', [target]);
    if (!user) throw fail(404, 'Người dùng không tồn tại.');
    if (adminUser(user)) throw fail(400, 'Không thể khóa tài khoản quản trị viên.');
    const { banned } = z.object({ banned: z.boolean() }).parse(req.body);
    await db.query('UPDATE users SET banned=$1 WHERE id=$2', [banned, target]);
    if (banned) {
      await db.query('DELETE FROM sessions WHERE user_id=$1', [target]);
      io.in(`user:${target}`).disconnectSockets();
    }
    io.emit('permissions:changed');
    res.json({ ok: true });
  });
  app.delete('/api/admin/posts/:id', async (req, res) => {
    await db.query('DELETE FROM posts WHERE id=$1', [id(req.params.id)]);
    io.emit('post:deleted', { id: req.params.id });
    res.json({ ok: true });
  });
  // A cover uses the same owned, validated image pipeline as avatars.
  app.patch('/api/account/cover', async (req, res) => {
    const { uploadId } = z.object({ uploadId: z.uuid().nullable() }).parse(req.body);
    const cover = uploadId ? await ownedImage(req.user.id, uploadId) : '';
    await db.query('UPDATE users SET cover=$1 WHERE id=$2', [cover, req.user.id]);
    res.json({ cover });
  });
  return { blocked, peer, changed };
}
