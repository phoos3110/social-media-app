import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { processMediaCleanup } from './cleanup.js';

export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
  .max(72)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Mật khẩu tối đa 72 byte.');
const digest = (token) => createHash('sha256').update(token).digest('hex');
export function accountRoutes({
  app,
  db,
  auth,
  authLimit,
  io,
  startSession,
  allowedOrigins,
  sendMail,
}) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const error = (status, message) => Object.assign(new Error(message), { status });
  const emailReady = () =>
    Boolean(
      sendMail || (process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.APP_URL),
    );
  async function mail(to, subject, text) {
    if (sendMail) return sendMail({ to, subject, text });
    if (!emailReady()) throw error(503, 'Chức năng email chưa được cấu hình.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
    });
    if (!response.ok) throw error(503, 'Không thể gửi email lúc này. Vui lòng thử lại.');
  }
  async function issue(user, kind, newEmail) {
    if (!emailReady()) throw error(503, 'Chức năng email chưa được cấu hình.');
    const token = randomBytes(32).toString('hex');
    await db.query('DELETE FROM account_tokens WHERE user_id=$1 AND kind=$2', [user.id, kind]);
    await db.query(
      'INSERT INTO account_tokens(token_hash,user_id,kind,new_email,expires_at) VALUES($1,$2,$3,$4,$5)',
      [digest(token), user.id, kind, newEmail || null, new Date(Date.now() + 20 * 60 * 1000)],
    );
    const origin = process.env.APP_URL || allowedOrigins[0];
    const url = new URL('/', origin);
    url.hash = new URLSearchParams({ action: kind, token }).toString();
    try {
      await mail(
        newEmail || user.email,
        kind === 'reset' ? 'Đặt lại mật khẩu Po' : 'Xác minh email Po',
        `Mở liên kết sau để tiếp tục (hết hạn sau 20 phút):\n${url}\nNếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
      );
    } catch (e) {
      await db.query('DELETE FROM account_tokens WHERE token_hash=$1', [digest(token)]);
      throw e;
    }
  }
  async function checkPassword(user, password) {
    if (!(await bcrypt.compare(password, user.password_hash)))
      throw error(400, 'Mật khẩu hiện tại không đúng.');
  }
  app.post('/api/auth/forgot-password', authLimit, async (req, res) => {
    const { email } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
      })
      .parse(req.body);
    if (!emailReady()) throw error(503, 'Chức năng email chưa được cấu hình.');
    const user = await one('SELECT * FROM users WHERE email=$1 AND banned=FALSE', [email]);
    if (user) await issue(user, 'reset');
    res.json({
      ok: true,
      message: 'Nếu email đã đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu.',
    });
  });
  app.post('/api/auth/reset-password', authLimit, async (req, res) => {
    const { token, password } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema })
      .parse(req.body);
    const hashed = await bcrypt.hash(password, 12);
    const user = await one(
      `WITH token AS (DELETE FROM account_tokens WHERE token_hash=$1 AND kind='reset' AND expires_at>NOW() RETURNING user_id)
      UPDATE users SET password_hash=$2 WHERE id=(SELECT user_id FROM token) AND banned=FALSE RETURNING id`,
      [digest(token), hashed],
    );
    if (!user) throw error(400, 'Liên kết đã hết hạn hoặc đã được sử dụng.');
    await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    await db.query("DELETE FROM account_tokens WHERE user_id=$1 AND kind='reset'", [user.id]);
    io.in(`user:${user.id}`).disconnectSockets();
    res.json({ ok: true });
  });
  app.post('/api/auth/verify-email', authLimit, async (req, res) => {
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    const user = await one(
      `WITH token AS (DELETE FROM account_tokens WHERE token_hash=$1 AND kind IN ('verify','email') AND expires_at>NOW() RETURNING user_id,new_email)
      UPDATE users SET email=COALESCE((SELECT new_email FROM token),email),email_verified=TRUE WHERE id=(SELECT user_id FROM token) AND banned=FALSE RETURNING id`,
      [digest(token)],
    );
    if (!user) throw error(400, 'Liên kết đã hết hạn hoặc đã được sử dụng.');
    await db.query("DELETE FROM account_tokens WHERE user_id=$1 AND kind IN ('verify','email')", [
      user.id,
    ]);
    res.json({ ok: true });
  });
  app.get('/api/account', auth, (req, res) =>
    res.json({
      email: req.user.email,
      emailVerified: req.user.email_verified,
      isPrivate: req.user.is_private,
      emailConfigured: emailReady(),
      isAdmin: adminUser(req.user),
    }),
  );
  app.post('/api/account/password', auth, authLimit, async (req, res) => {
    const { currentPassword, password } = z
      .object({ currentPassword: z.string().max(72), password: passwordSchema })
      .parse(req.body);
    await checkPassword(req.user, currentPassword);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
      await bcrypt.hash(password, 12),
      req.user.id,
    ]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);
    await db.query("DELETE FROM account_tokens WHERE user_id=$1 AND kind='reset'", [req.user.id]);
    await startSession(res, req.user.id);
    io.in(`user:${req.user.id}`).disconnectSockets();
    res.json({ ok: true });
  });
  app.post('/api/account/verification', auth, authLimit, async (req, res) => {
    await issue(req.user, 'verify');
    res.json({ ok: true });
  });
  app.post('/api/account/email', auth, authLimit, async (req, res) => {
    const { email, password } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        password: z.string().max(72),
      })
      .parse(req.body);
    await checkPassword(req.user, password);
    if (await one('SELECT id FROM users WHERE email=$1', [email]))
      throw error(409, 'Email đã được sử dụng.');
    await issue(req.user, 'email', email);
    res.json({ ok: true });
  });
  app.delete('/api/account', auth, authLimit, async (req, res) => {
    const { password } = z.object({ password: z.string().max(72) }).parse(req.body);
    await checkPassword(req.user, password);
    await db.query(
      `WITH scheduled AS (
      INSERT INTO media_cleanup(id,public_id,kind,delivery_type,source_url)
      SELECT id,public_id,kind,delivery_type,COALESCE(NULLIF(source_url,''),url) FROM uploads WHERE user_id=$1 ON CONFLICT DO NOTHING RETURNING id
    ) DELETE FROM users WHERE id=$1 AND (SELECT COUNT(*) FROM scheduled)>=0`,
      [req.user.id],
    );
    void processMediaCleanup(db).catch(() => {});
    io.in(`user:${req.user.id}`).disconnectSockets();
    res.clearCookie('session', { path: '/' });
    res.json({ ok: true });
  });
}
export function adminUser(user) {
  if (
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .includes(user.id)
  )
    return true;
  if (!user.email_verified) return false;
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(user.email);
}
