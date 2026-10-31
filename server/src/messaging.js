import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const fail = (status, message) => Object.assign(new Error(message), { status });
export function messagingRoutes({ app, db, io, peer, ownedImage, push }) {
  const q = async (s, p = []) => (await db.query(s, p)).rows;
  const one = async (s, p = []) => (await q(s, p))[0];
  const id = (v) => z.uuid().parse(v);
  const select = `SELECT m.*,CASE WHEN original.id IS NULL THEN NULL ELSE json_build_object('id',original.id,'senderId',original.sender_id,'content',original.content,'image',original.image,'recalledAt',original.recalled_at) END AS reply
    FROM messages m LEFT JOIN messages original ON original.id=m.reply_to_id`;
  const json = (m) => ({
    id: m.id,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    content: m.content,
    image: m.image,
    replyToId: m.reply_to_id,
    replyTo: m.reply,
    createdAt: m.created_at,
    readAt: m.read_at,
    recalledAt: m.recalled_at,
  });
  const pair = `((m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1))`;
  app.get('/api/messages/:id', async (req, res) => {
    const target = id(req.params.id);
    await peer(req.user.id, target);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const rows = await q(
      `${select} WHERE ${pair} ORDER BY m.created_at DESC,m.id DESC LIMIT 41 OFFSET $3`,
      [req.user.id, target, (page - 1) * 40],
    );
    res.json({ messages: rows.slice(0, 40).reverse().map(json), hasMore: rows.length > 40 });
  });
  app.patch('/api/messages/:id/read', async (req, res) => {
    const target = id(req.params.id);
    await peer(req.user.id, target);
    const readAt = new Date().toISOString();
    await db.query(
      'UPDATE messages SET read_at=$3 WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL',
      [target, req.user.id, readAt],
    );
    io.to(`user:${req.user.id}`).emit('conversation:read');
    io.to(`user:${target}`).emit('message:read', { readerId: req.user.id, readAt });
    res.json({ ok: true });
  });
  app.post('/api/messages/:id', async (req, res) => {
    const target = id(req.params.id);
    if (target === req.user.id) throw fail(400, 'Hãy chọn người nhận khác.');
    await peer(req.user.id, target);
    const { content, uploadId, replyToId, clientId } = z
      .object({
        content: z.string().trim().max(2000).default(''),
        uploadId: z.uuid().optional(),
        replyToId: z.uuid().optional(),
        clientId: z.uuid().optional(),
      })
      .parse(req.body);
    if (!content && !uploadId) throw fail(400, 'Nhập nội dung hoặc chọn ảnh.');
    const image = await ownedImage(req.user.id, uploadId);
    if (
      replyToId &&
      !(await one(
        `SELECT m.id FROM messages m WHERE ${pair} AND m.id=$3 AND m.recalled_at IS NULL`,
        [req.user.id, target, replyToId],
      ))
    )
      throw fail(400, 'Tin nhắn được trả lời không còn khả dụng.');
    const inserted = await one(
      `INSERT INTO messages(id,sender_id,recipient_id,content,image,reply_to_id,client_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
      [randomUUID(), req.user.id, target, content, image, replyToId || null, clientId || null],
    );
    const row = inserted
      ? await one(`${select} WHERE m.id=$1`, [inserted.id])
      : await one(`${select} WHERE m.sender_id=$1 AND m.client_id=$2`, [req.user.id, clientId]);
    if (
      !row ||
      row.recipient_id !== target ||
      row.content !== content ||
      row.image !== image ||
      row.reply_to_id !== (replyToId || null)
    )
      throw fail(409, 'Mã gửi tin nhắn đã được sử dụng.');
    const payload = json(row);
    if (inserted) {
      io.to(`user:${target}`).to(`user:${req.user.id}`).emit('message:new', payload);
      void push(target, {
        body: 'Bạn có tin nhắn mới.',
        url: `/#chat=${req.user.id}`,
        tag: `chat-${req.user.id}`,
      });
    }
    res.status(201).json({ message: payload });
  });
  app.delete('/api/messages/:id', async (req, res) => {
    const message = await one('SELECT * FROM messages WHERE id=$1', [id(req.params.id)]);
    if (!message) throw fail(404, 'Tin nhắn không tồn tại.');
    if (message.sender_id !== req.user.id) throw fail(403, 'Chỉ được thu hồi tin nhắn của mình.');
    await db.query(
      "UPDATE messages SET content='',image='',recalled_at=COALESCE(recalled_at,NOW()) WHERE id=$1",
      [message.id],
    );
    const payload = json(await one(`${select} WHERE m.id=$1`, [message.id]));
    io.to(`user:${message.sender_id}`)
      .to(`user:${message.recipient_id}`)
      .emit('message:recalled', payload);
    res.json({ message: payload });
  });
  app.get('/api/presence', async (req, res) => {
    const ids = z
      .array(z.uuid())
      .max(100)
      .parse(typeof req.query.ids === 'string' && req.query.ids ? req.query.ids.split(',') : []);
    if (!ids.length) return res.json({ online: [] });
    const visible = await q(
      `SELECT u.id FROM users u WHERE u.id=ANY($1::uuid[]) AND u.banned=FALSE AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$2 AND b.target_id=u.id) OR (b.target_id=$2 AND b.user_id=u.id))`,
      [ids, req.user.id],
    );
    const online = new Set([...io.of('/').sockets.values()].map((s) => s.data.user.id));
    res.json({ online: visible.filter((u) => online.has(u.id)).map((u) => u.id) });
  });
  io.on('connection', (socket) => {
    io.emit('presence:changed');
    let lastTyped = 0;
    socket.on('typing', async (input) => {
      const parsed = z.object({ recipientId: z.uuid(), typing: z.boolean() }).safeParse(input);
      if (!parsed.success || Date.now() - lastTyped < 300) return;
      lastTyped = Date.now();
      try {
        const user = socket.data.user;
        const session = await one(
          'SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.banned=FALSE',
          [user.token_hash],
        );
        if (!session) return socket.disconnect(true);
        await peer(user.id, parsed.data.recipientId);
        io.to(`user:${parsed.data.recipientId}`).emit('typing', {
          userId: user.id,
          typing: parsed.data.typing,
        });
      } catch {}
    });
    socket.on('disconnect', () => io.emit('presence:changed'));
  });
}
