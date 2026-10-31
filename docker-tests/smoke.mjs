import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { unlink } from 'node:fs/promises';
const requireServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireServer('pg');
const sharp = requireServer('sharp');
requireServer('dotenv').config({
  path: new URL('../server/.env', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
  quiet: true,
});

const baseURL = 'http://localhost:5180';
const browser = await chromium.launch({ channel: 'chrome' });
const users = [];
const assets = [];
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const suffix = Date.now().toString(36);
  const a = await browser.newContext({ baseURL, colorScheme: 'light' });
  const b = await browser.newContext({ baseURL, colorScheme: 'dark' });
  const themePage = await a.newPage();
  await themePage.goto('/');
  await themePage.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
  await expect(themePage.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themePage.reload();
  await expect(themePage.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themePage.screenshot({ path: 'test-results/dark-login.png', fullPage: true });
  await themePage.close();
  for (const [context, name] of [
    [a, 'Alice'],
    [b, 'Bob'],
  ]) {
    const response = await context.request.post('/api/auth/register', {
      data: {
        username: `docker_${name.toLowerCase()}_${suffix}`,
        name: `Docker ${name}`,
        email: `${name}.${suffix}@example.com`,
        password: 'DockerTest123!',
      },
    });
    expect(response.status()).toBe(201);
    const { user } = await response.json();
    users.push(user.id);
  }
  const alice = await a.newPage();
  const bob = await b.newPage();
  const errors = [];
  alice.on('pageerror', (e) => errors.push(e.message));
  bob.on('pageerror', (e) => errors.push(e.message));
  const websockets = [];
  bob.on('websocket', (socket) => websockets.push(socket.url()));
  await Promise.all([alice.goto('/'), bob.goto('/')]);
  await expect(alice.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(bob.locator('html')).toHaveAttribute('data-theme', 'dark');
  await bob.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  await bob.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).click();
  await bob
    .getByRole('dialog', { name: 'Cài đặt', exact: true })
    .getByRole('button', { name: 'Đóng', exact: true })
    .click();
  await bob.reload();
  await expect(bob.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(alice.getByRole('heading', { name: 'Bảng tin' })).toBeVisible();
  await expect(bob.getByRole('heading', { name: 'Bảng tin' })).toBeVisible();
  const image = await sharp({
    create: { width: 120, height: 80, channels: 3, background: '#286553' },
  })
    .png()
    .toBuffer();
  const upload = await a.request.post('/api/uploads', {
    multipart: { image: { name: 'docker-test.png', mimeType: 'image/png', buffer: image } },
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json();
  assets.push(asset.url);
  const created = await a.request.post('/api/posts', {
    data: { content: `Docker upload ${suffix}`, uploadId: asset.id },
  });
  expect(created.status()).toBe(201);
  await alice.reload();
  const article = alice.locator('article').filter({ hasText: `Docker upload ${suffix}` });
  await expect(article.locator('.post-image')).toBeVisible();
  await expect
    .poll(() => article.locator('.post-image').evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);
  await alice.screenshot({ path: 'test-results/dark-feed-desktop.png', fullPage: true });
  await alice.setViewportSize({ width: 393, height: 852 });
  expect(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await alice.screenshot({ path: 'test-results/dark-feed-mobile.png', fullPage: true });
  await alice.setViewportSize({ width: 1280, height: 900 });
  await bob.locator('.topbar').getByRole('button', { name: 'Khám phá', exact: true }).click();
  const person = bob.locator('.person-card').filter({ hasText: 'Docker Alice' });
  await expect(person).toBeVisible();
  await person.getByRole('button', { name: 'Theo dõi', exact: true }).click();
  await expect(person.getByRole('button', { name: 'Đang theo dõi', exact: true })).toBeVisible();
  await person.getByRole('button', { name: 'Nhắn tin cho Docker Alice' }).click();
  await bob.getByLabel('Nội dung tin nhắn').fill(`Xin chào qua Docker ${suffix}`);
  await bob.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  await alice.locator('.topbar').getByRole('button', { name: 'Mở tin nhắn' }).click();
  await alice.locator('.conversation').filter({ hasText: 'Docker Bob' }).click();
  await expect(alice.locator('.message').getByText(`Xin chào qua Docker ${suffix}`)).toBeVisible();
  await alice.getByLabel('Nội dung tin nhắn').fill(`Phản hồi realtime ${suffix}`);
  await alice.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  await expect(bob.locator('.message').getByText(`Phản hồi realtime ${suffix}`)).toBeVisible();
  await expect.poll(() => websockets.some((url) => url.includes('/socket.io/'))).toBe(true);
  await alice.locator('.topbar').getByRole('button', { name: 'Mở thông báo' }).click();
  await expect(alice.locator('.notice').filter({ hasText: 'Docker Bob' })).toBeVisible();
  await alice.screenshot({ path: 'test-results/docker-notifications.png', fullPage: true });
  await bob.setViewportSize({ width: 393, height: 852 });
  expect(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await bob.screenshot({ path: 'test-results/docker-chat-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  await a.request.post('/api/auth/logout');
  expect((await a.request.get('/api/auth/me')).status()).toBe(401);
  console.log(
    'Docker smoke passed: sessions, images, follow, notifications, WebSocket chat, mobile and logout.',
  );
} finally {
  await browser.close();
  if (users.length) {
    const sources = await pool.query(
      'SELECT source_url FROM uploads WHERE user_id=ANY($1::uuid[])',
      [users],
    );
    for (const source of sources.rows) if (source.source_url) assets.push(source.source_url);
  }
  if (users.length) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
  await pool.end();
  for (const asset of assets) {
    if (/^\/uploads\/[0-9a-f-]+\.webp$/.test(asset)) {
      await unlink(new URL(`../server${asset}`, import.meta.url)).catch(() => {});
    }
  }
}
