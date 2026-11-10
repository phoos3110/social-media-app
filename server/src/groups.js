import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ownedAttachment } from './attachments.js';
const fail = (status, message) => Object.assign(new Error(message), { status });
export function groupRoutes({ app, db, io, peer, publicUser, push }) {
  const q = async (s, p = []) => (await db.query(s, p)).rows;
  const one = async (s, p = []) => (await q(s, p))[0];
  async function member(groupId, userId) {
    const group = await one(
      'SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE g.id=$1 AND gm.user_id=$2',
      [z.uuid().parse(groupId), userId],
    );
    if (!group) throw fail(404, 'Nhóm không tồn tại hoặc bạn không còn là thành viên.');
    return group;
  }
  async function emit(groupId, event, payload) {
    const users = await q('SELECT user_id FROM group_members WHERE group_id=$1', [groupId]);
    for (const user of users) io.to(`user:${user.user_id}`).emit(event, payload);
  }
  const json = (m) => ({
    id: m.id,
    groupId: m.group_id,
    senderId: m.sender_id,
    content: m.content,
    attachment: m.attachment,
    createdAt: m.created_at,
    recalledAt: m.recalled_at,
    author: m.author ? publicUser(m.author) : undefined,
  });
  app.get('/api/groups', async (req, res) => {
    const groups = await q(
      `SELECT g.*,(SELECT COUNT(*)::int FROM group_members WHERE group_id=g.id) AS members,
      (SELECT COUNT(*)::int FROM group_messages m WHERE m.group_id=g.id AND m.sender_id<>$1 AND m.created_at>gm.read_at AND m.recalled_at IS NULL) AS unread
      FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=$1 ORDER BY g.created_at DESC LIMIT 100`,
      [req.user.id],
    );
    res.json({ groups });
  });
  app.post('/api/groups', async (req, res) => {
    const { name, userIds } = z
      .object({ name: z.string().trim().min(1).max(80), userIds: z.array(z.uuid()).min(1).max(49) })
      .parse(req.body);
    const users = [...new Set([req.user.id, ...userIds])];
    for (const user of users) if (user !== req.user.id) await peer(req.user.id, user);
    const groupId = randomUUID();
    await db.query(
      `WITH created AS(INSERT INTO groups(id,name,owner_id) VALUES($1,$2,$3) RETURNING id) INSERT INTO group_members(group_id,user_id) SELECT created.id,unnest($4::uuid[]) FROM created`,
      [groupId, name, req.user.id, users],
    );
    await emit(groupId, 'group:changed', { groupId });
    res.status(201).json({ id: groupId });
  });
  app.get('/api/groups/:id/members', async (req, res) => {
    await member(req.params.id, req.user.id);
    res.json({
      users: (
        await q(
          'SELECT u.* FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 ORDER BY u.name',
          [req.params.id],
        )
      ).map(publicUser),
    });
  });
  app.put('/api/groups/:id/members/:userId', async (req, res) => {
    const group = await member(req.params.id, req.user.id);
    if (group.owner_id !== req.user.id) throw fail(403, 'Chỉ trưởng nhóm được thêm thành viên.');
    const userId = z.uuid().parse(req.params.userId);
    await peer(req.user.id, userId);
    const count = await one('SELECT COUNT(*)::int AS total FROM group_members WHERE group_id=$1', [
      group.id,
    ]);
    if (count.total >= 50) throw fail(400, 'Nhóm tối đa 50 thành viên.');
    await db.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [group.id, userId],
    );
    await emit(group.id, 'group:changed', { groupId: group.id });
    res.json({ ok: true });
  });
  app.delete('/api/groups/:id/members/:userId', async (req, res) => {
    const group = await member(req.params.id, req.user.id);
    const userId = z.uuid().parse(req.params.userId);
    if (userId !== req.user.id && group.owner_id !== req.user.id)
      throw fail(403, 'Chỉ được tự rời nhóm.');
    if (group.owner_id === userId) {
      const users = await q('SELECT user_id FROM group_members WHERE group_id=$1', [group.id]);
      await db.query('DELETE FROM groups WHERE id=$1', [group.id]);
      for (const user of users)
        io.to(`user:${user.user_id}`).emit('group:changed', { groupId: group.id });
    } else {
      await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [
        group.id,
        userId,
      ]);
      io.to(`user:${userId}`).emit('group:changed', { groupId: group.id });
      await emit(group.id, 'group:changed', { groupId: group.id });
    }
    res.json({ ok: true });
  });
  app.get('/api/groups/:id/messages', async (req, res) => {
    const group = await member(req.params.id, req.user.id);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const rows = await q(
      `SELECT m.*,row_to_json(u) AS author FROM group_messages m JOIN users u ON u.id=m.sender_id WHERE m.group_id=$1 AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$2 AND b.target_id=m.sender_id) OR (b.target_id=$2 AND b.user_id=m.sender_id)) ORDER BY m.created_at DESC,m.id DESC LIMIT 41 OFFSET $3`,
      [group.id, req.user.id, (page - 1) * 40],
    );
    res.json({ messages: rows.slice(0, 40).reverse().map(json), hasMore: rows.length > 40 });
  });
  app.patch('/api/groups/:id/read', async (req, res) => {
    await member(req.params.id, req.user.id);
    await db.query('UPDATE group_members SET read_at=NOW() WHERE group_id=$1 AND user_id=$2', [
      req.params.id,
      req.user.id,
    ]);
    io.to(`user:${req.user.id}`).emit('group:read');
    res.json({ ok: true });
  });
  app.post('/api/groups/:id/messages', async (req, res) => {
    const group = await member(req.params.id, req.user.id);
    const { content, attachmentId } = z
      .object({
        content: z.string().trim().max(2000).default(''),
        attachmentId: z.uuid().optional(),
      })
      .parse(req.body);
    const attachment = await ownedAttachment(db, req.user.id, attachmentId);
    if (!content && !attachment) throw fail(400, 'Nhập tin nhắn hoặc chọn tệp.');
    const message = await one(
      'INSERT INTO group_messages(id,group_id,sender_id,content,attachment) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [
        randomUUID(),
        group.id,
        req.user.id,
        content,
        attachment ? JSON.stringify(attachment) : null,
      ],
    );
    const payload = { ...json(message), author: publicUser(req.user) };
    const users = await q(
      `SELECT u.id,u.notification_preferences FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=u.id AND b.target_id=$2) OR (b.target_id=u.id AND b.user_id=$2))`,
      [group.id, req.user.id],
    );
    for (const user of users) {
      io.to(`user:${user.id}`).emit('group:message', payload);
      if (user.id !== req.user.id && user.notification_preferences.message !== false)
        void push(user.id, {
          body: 'Bạn có tin nhắn nhóm mới.',
          url: '/',
          tag: 'group-' + group.id,
        });
    }
    res.status(201).json({ message: payload });
  });
  app.delete('/api/groups/:id/messages/:messageId', async (req, res) => {
    const group = await member(req.params.id, req.user.id);
    const message = await one('SELECT * FROM group_messages WHERE id=$1 AND group_id=$2', [
      z.uuid().parse(req.params.messageId),
      group.id,
    ]);
    if (!message) throw fail(404, 'Tin nhắn không tồn tại.');
    if (message.sender_id !== req.user.id) throw fail(403, 'Chỉ được thu hồi tin nhắn của mình.');
    const updated = await one(
      "UPDATE group_messages SET content='',attachment=NULL,recalled_at=NOW() WHERE id=$1 RETURNING *",
      [message.id],
    );
    await emit(group.id, 'group:recalled', json(updated));
    res.json({ message: json(updated) });
  });
}
