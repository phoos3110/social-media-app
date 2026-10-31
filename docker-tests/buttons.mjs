import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
require('dotenv').config({ path: 'server/.env', quiet: true });
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });
const browser = await chromium.launch({ channel: 'chrome' });
const users = [];
const suffix = Date.now().toString(36);
try {
  const context = await browser.newContext({
    baseURL: 'http://localhost:5180',
    colorScheme: 'dark',
  });
  const other = await browser.newContext({ baseURL: 'http://localhost:5180' });
  for (const [session, name] of [
    [context, 'Alice'],
    [other, 'Bob'],
  ]) {
    const response = await session.request.post('/api/auth/register', {
      data: {
        name: `Audit ${name} ${suffix}`,
        username: `audit_${name.toLowerCase()}_${suffix}`,
        email: `${name}.${suffix}@example.com`,
        password: 'ButtonsTest123!',
      },
    });
    expect(response.status()).toBe(201);
    users.push((await response.json()).user.id);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const dialog = page.locator('.confirm-dialog');
  const settings = page.getByRole('dialog', { name: 'Cài đặt', exact: true });
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  const logout = settings.getByRole('button', { name: 'Đăng xuất', exact: true });
  await logout.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect((await context.request.get('/api/auth/me')).status()).toBe(200);
  await logout.click();
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  expect((await context.request.get('/api/auth/me')).status()).toBe(200);
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test logout error' }),
    }),
  );
  await logout.click();
  await dialog.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('Test logout error');
  await expect(logout).toBeEnabled();
  expect((await context.request.get('/api/auth/me')).status()).toBe(200);
  await page.unroute('**/api/auth/logout');
  await settings.getByRole('button', { name: 'Đóng', exact: true }).click();
  console.log('Logout: cancel, Escape and API failure preserve session.');

  const postButton = page
    .locator('.composer')
    .getByRole('button', { name: 'Đăng bài', exact: true });
  await expect(postButton).toBeDisabled();
  await page.getByLabel('Nội dung bài viết', { exact: true }).fill(`Button audit ${suffix}`);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let submitted = 0;
  await page.route('**/api/posts', async (route) => {
    if (route.request().method() === 'POST') {
      submitted++;
      await gate;
    }
    await route.continue();
  });
  await postButton.click();
  await expect(postButton).toBeDisabled();
  await expect(page.getByLabel('Nội dung bài viết', { exact: true })).toBeDisabled();
  await page.locator('.composer').evaluate((form) => form.requestSubmit());
  release();
  let article = page.locator('article').filter({ hasText: `Button audit ${suffix}` });
  await expect(article).toBeVisible();
  expect(submitted).toBe(1);
  await page.unroute('**/api/posts');
  await article.getByRole('button', { name: 'Thích', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Đã thích', exact: true })).toBeVisible();
  await article.getByRole('button', { name: 'Đã thích', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Thích', exact: true })).toBeVisible();
  await article.getByRole('button', { name: 'Bình luận', exact: true }).click();
  await article.getByLabel('Nội dung bình luận').fill('   ');
  await expect(article.getByRole('button', { name: 'Gửi bình luận' })).toBeDisabled();
  await article.getByLabel('Nội dung bình luận').fill(`Comment ${suffix}`);
  await article.getByRole('button', { name: 'Gửi bình luận' }).click();
  await expect(article.getByText(`Comment ${suffix}`, { exact: true })).toBeVisible();
  await article.getByRole('button', { name: 'Xóa bình luận' }).click();
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(article.getByText(`Comment ${suffix}`, { exact: true })).toBeVisible();
  await article.getByRole('button', { name: 'Xóa bình luận' }).click();
  await dialog.getByRole('button', { name: 'Xóa bình luận', exact: true }).click();
  await expect(article.getByText(`Comment ${suffix}`, { exact: true })).toHaveCount(0);

  // While editing, the post text becomes a textarea value rather than textContent.
  article = page.locator('article.feed-post').first();
  await article.getByRole('button', { name: 'Tùy chọn bài viết' }).click();
  await page.keyboard.press('Escape');
  await expect(article.locator('.dropdown')).toHaveCount(0);
  await article.getByRole('button', { name: 'Tùy chọn bài viết' }).click();
  await article.getByRole('button', { name: 'Sửa bài viết' }).click();
  await article.getByLabel('Sửa nội dung bài viết').fill(`Edited ${suffix}`);
  await article.getByRole('button', { name: 'Hủy', exact: true }).click();
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(article.getByLabel('Sửa nội dung bài viết')).toHaveValue(`Edited ${suffix}`);
  await page.route('**/api/posts/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Test edit error' }),
        })
      : route.continue(),
  );
  await article.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Test edit error');
  await expect(article.getByLabel('Sửa nội dung bài viết')).toHaveValue(`Edited ${suffix}`);
  await page.unroute('**/api/posts/*');
  await article.getByRole('button', { name: 'Lưu', exact: true }).click();
  article = page.locator('article').filter({ hasText: `Edited ${suffix}` });
  await expect(article.locator('.edit-post')).toHaveCount(0);
  console.log(
    'Posts/comments: blank input, double submit, like, edit failure and delete cancellation passed.',
  );

  const data = await context.request.get(`/api/posts?author=${users[0]}`);
  const postId = (await data.json()).posts[0].id;
  await other.request.put(`/api/posts/${postId}/like`, { data: { liked: true } });
  await page.locator('.topbar').getByRole('button', { name: 'Mở thông báo' }).click();
  await page
    .locator('.notice')
    .filter({ hasText: `Audit Bob ${suffix}` })
    .click();
  await expect
    .poll(async () => (await (await context.request.get('/api/notifications')).json()).unread)
    .toBe(0);
  await page
    .locator('.header-nav')
    .getByRole('button', { name: 'Trang cá nhân', exact: true })
    .click();
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Giới thiệu', { exact: true }).fill('Unsaved bio');
  await page.locator('.profile-edit').getByRole('button', { name: 'Hủy', exact: true }).click();
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByLabel('Giới thiệu', { exact: true })).toHaveValue('Unsaved bio');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Unsaved bio', { exact: true })).toBeVisible();
  article = page.locator('article').filter({ hasText: `Edited ${suffix}` });
  await article.getByRole('button', { name: 'Tùy chọn bài viết' }).click();
  await article.getByRole('button', { name: 'Xóa bài viết' }).click();
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(article).toBeVisible();
  await article.getByRole('button', { name: 'Tùy chọn bài viết' }).click();
  await article.getByRole('button', { name: 'Xóa bài viết' }).click();
  await dialog.getByRole('button', { name: 'Xóa bài viết', exact: true }).click();
  await expect(article).toHaveCount(0);
  await expect(page.locator('.profile-stats > span').first()).toContainText('0');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  await logout.click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/confirm-logout-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.locator('.auth-layout')).toBeVisible();
  expect((await context.request.get('/api/auth/me')).status()).toBe(401);
  expect(errors).toEqual([]);
  console.log(
    'Profile counts, notification read, mobile confirmation and confirmed logout passed.',
  );
} finally {
  await browser.close();
  if (users.length) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
  await pool.end();
}
