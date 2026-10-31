import webpush from 'web-push';
import { z } from 'zod';
const ready = () =>
  Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
export function pushRoutes({ app, db, sendPush }) {
  app.get('/api/push/config', (_req, res) =>
    res.json({ enabled: ready(), publicKey: ready() ? process.env.VAPID_PUBLIC_KEY : null }),
  );
  app.post('/api/push/subscriptions', async (req, res) => {
    if (!ready())
      throw Object.assign(new Error('Thông báo đẩy chưa được cấu hình.'), { status: 503 });
    const sub = z
      .object({
        endpoint: z.url().max(2048),
        expirationTime: z.number().nullable().optional(),
        keys: z.object({
          p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,120}={0,2}$/),
          auth: z.string().regex(/^[A-Za-z0-9_-]{20,40}={0,2}$/),
        }),
      })
      .parse(req.body);
    const url = new URL(sub.endpoint);
    const allowed = [
      'fcm.googleapis.com',
      'push.services.mozilla.com',
      'push.apple.com',
      'notify.windows.com',
    ];
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !allowed.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))
    )
      throw Object.assign(new Error('Máy chủ push không được hỗ trợ.'), { status: 400 });
    await db.query(
      `INSERT INTO push_subscriptions(endpoint,user_id,session_hash,subscription) VALUES($1,$2,$3,$4)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,session_hash=EXCLUDED.session_hash,subscription=EXCLUDED.subscription`,
      [sub.endpoint, req.user.id, req.user.token_hash, JSON.stringify(sub)],
    );
    res.status(201).json({ ok: true });
  });
  app.delete('/api/push/subscriptions', async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2048) }).parse(req.body);
    await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [
      endpoint,
      req.user.id,
    ]);
    res.json({ ok: true });
  });
  return async function push(userId, payload) {
    if (!ready() && !sendPush) return;
    const rows = (
      await db.query('SELECT endpoint,subscription FROM push_subscriptions WHERE user_id=$1', [
        userId,
      ])
    ).rows;
    await Promise.allSettled(
      rows.map(async (row) => {
        try {
          if (sendPush) await sendPush(row.subscription, payload);
          else
            await webpush.sendNotification(row.subscription, JSON.stringify(payload), {
              TTL: 3600,
              timeout: 10000,
              vapidDetails: {
                subject: process.env.VAPID_SUBJECT,
                publicKey: process.env.VAPID_PUBLIC_KEY,
                privateKey: process.env.VAPID_PRIVATE_KEY,
              },
            });
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410)
            await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [row.endpoint]);
        }
      }),
    );
  };
}
