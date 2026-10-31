import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const base = 'http://localhost:4100';
// Use a validated image fixture shared with the existing browser suite.
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIElEQVQ4jWPQSA0mGzGMag4eDbDg0UQSPJoxggeuMAAA7mNeENmdLGMAAAAASUVORK5CYII=',
  'base64',
);
async function register(context: BrowserContext, name: string) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    email = `${suffix}@example.com`;
  const response = await context.request.post(base + '/api/auth/register', {
    data: { name, username: `u_${suffix}`, email, password: 'Password123!' },
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()).user, email };
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  return page.getByRole('dialog', { name: 'Cài đặt', exact: true });
}

test('gallery, realtime likes, likers, saved posts, sharing and persisted drafts work from the interface', async ({
  page,
  browser,
}) => {
  const a = await register(page.context(), 'Gallery Owner');
  const context = await browser.newContext({ baseURL: base });
  const b = await register(context, 'Gallery Reader');
  const reader = await context.newPage();
  try {
    await page.goto('/');
    await reader.goto('/');
    await expect(page.locator('.connection-state')).toContainText('Đã kết nối');
    await page.getByLabel('Nội dung bài viết', { exact: true }).fill('Gallery complete UI');
    await page.reload();
    await expect(page.getByLabel('Nội dung bài viết', { exact: true })).toHaveValue(
      'Gallery complete UI',
    );
    await page.locator('.composer input[type=file]').setInputFiles([
      { name: 'one.png', mimeType: 'image/png', buffer: image },
      { name: 'two.png', mimeType: 'image/png', buffer: image },
    ]);
    await expect(page.locator('.composer-preview img')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Đăng bài', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Đăng bài', exact: true }).click();
    const original = page.locator('article').filter({ hasText: 'Gallery complete UI' }).first();
    await expect(original.locator('.post-image')).toHaveCount(2);
    const id = await original.getAttribute('data-post-id');
    const remote = reader.locator(`article[data-post-id="${id}"]`);
    await expect(remote).toBeVisible();
    await remote
      .locator('.post-actions')
      .getByRole('button', { name: 'Thích', exact: true })
      .click();
    await expect(original.locator('.likers-link')).toContainText('1 lượt thích');
    await original.locator('.likers-link').click();
    await expect(page.getByRole('dialog', { name: 'Người đã thích' })).toContainText(b.name);
    await page
      .getByRole('dialog', { name: 'Người đã thích' })
      .getByRole('button', { name: 'Đóng', exact: true })
      .click();
    await remote.getByRole('button', { name: 'Lưu bài viết', exact: true }).click();
    const drawer = await settings(reader);
    await drawer.getByRole('button', { name: 'Bài viết đã lưu', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: 'Bài viết đã lưu', exact: true }),
    ).toBeVisible();
    await expect(remote).toBeVisible();
    await remote
      .locator('.post-actions')
      .getByRole('button', { name: 'Chia sẻ', exact: true })
      .click();
    const share = reader.getByRole('dialog', { name: 'Chia sẻ bài viết' });
    await share.getByLabel('Nội dung chia sẻ').fill('Shared from the gallery');
    await share.getByRole('button', { name: 'Chia sẻ ngay' }).click();
    await expect(share).not.toBeVisible();
    await expect(
      page.locator('.shared-post').getByText('Gallery complete UI', { exact: true }),
    ).toBeVisible();
    await remote.getByRole('button', { name: 'Bỏ lưu bài viết', exact: true }).click();
    expect(
      (await (await reader.request.get('/api/bookmarks')).json()).posts.some(
        (p: { id: string }) => p.id === id,
      ),
    ).toBe(false);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.screenshot({ path: 'test-results/gallery-complete-mobile.png', fullPage: true });
    expect(a.id).not.toBe(b.id);
    await page.bringToFront();
    const videoBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:96px;height:96px;z-index:9999';
      document.body.append(canvas);
      const draw = canvas.getContext('2d')!;
      draw.fillStyle = '#1877f2';
      draw.fillRect(0, 0, 96, 96);
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: BlobPart[] = [];
      return new Promise<number[]>((resolve) => {
        let frames: ReturnType<typeof setInterval>;
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onstop = async () => {
          clearInterval(frames);
          canvas.remove();
          stream.getTracks().forEach((track) => track.stop());
          resolve(
            Array.from(
              new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()),
            ),
          );
        };
        recorder.onstart = () => {
          draw.fillRect(0, 0, 96, 96);
          track.requestFrame();
          frames = setInterval(() => {
            draw.fillStyle = `rgb(${Math.floor(Math.random() * 255)},80,200)`;
            draw.fillRect(0, 0, 96, 96);
            track.requestFrame();
          }, 50);
          setTimeout(() => recorder.stop(), 800);
        };
        recorder.start();
      });
    });
    expect(videoBytes.length).toBeGreaterThan(200);
    await page.getByLabel('Nội dung bài viết', { exact: true }).fill('Playable video UI');
    await page.locator('.composer input[type=file]').setInputFiles({
      name: 'clip.webm',
      mimeType: 'video/webm',
      buffer: Buffer.from(videoBytes),
    });
    await expect(page.locator('.composer-preview video')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đăng bài', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Đăng bài', exact: true }).click();
    const video = page.locator('article').filter({ hasText: 'Playable video UI' }).locator('video');
    await expect(video).toBeVisible();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('private account requests can be approved; report and block actions work from profiles', async ({
  page,
  browser,
}) => {
  const owner = await register(page.context(), 'Private Owner');
  const context = await browser.newContext({ baseURL: base });
  await register(context, 'Private Visitor');
  const visitor = await context.newPage();
  try {
    const post = (
      await (await page.request.post('/api/posts', { data: { content: 'Privacy UI post' } })).json()
    ).post;
    await page.goto('/');
    await visitor.goto('/');
    const drawer = await settings(page);
    await drawer.getByRole('button', { name: 'Quyền riêng tư', exact: true }).click();
    await drawer.getByRole('switch').click();
    await expect(drawer.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(visitor.locator(`article[data-post-id="${post.id}"]`)).toHaveCount(0);
    await visitor
      .locator('.header-nav')
      .getByRole('button', { name: 'Khám phá', exact: true })
      .click();
    await visitor.getByRole('searchbox', { name: 'Tìm kiếm', exact: true }).fill('Private Owner');
    await visitor
      .locator('.person-card')
      .filter({ hasText: 'Private Owner' })
      .locator('.person-profile')
      .click();
    const profile = visitor.locator('.profile-card');
    await profile.getByRole('button', { name: 'Theo dõi', exact: true }).click();
    await expect(
      profile.getByRole('button', { name: 'Đã gửi yêu cầu', exact: true }),
    ).toBeVisible();
    await drawer.getByRole('button', { name: 'Yêu cầu theo dõi', exact: true }).click();
    await expect(drawer).toContainText('Private Visitor');
    await drawer.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(profile.getByRole('button', { name: 'Đang theo dõi', exact: true })).toBeVisible();
    await profile.getByRole('button', { name: 'Báo cáo người dùng' }).click();
    const report = visitor.getByRole('dialog', { name: 'Báo cáo nội dung' });
    await report.getByLabel('Lý do báo cáo').fill('Kiểm tra chức năng báo cáo');
    await report.getByRole('button', { name: 'Gửi báo cáo' }).click();
    await expect(report).toContainText('Đã gửi báo cáo');
    await report.getByRole('button', { name: 'Đóng', exact: true }).click();
    await profile.getByRole('button', { name: 'Chặn', exact: true }).click();
    await visitor
      .locator('.confirm-dialog')
      .getByRole('button', { name: 'Chặn', exact: true })
      .click();
    await expect(visitor.getByRole('heading', { name: 'Bảng tin', exact: true })).toBeVisible();
    expect((await visitor.request.get(`/api/users/${owner.id}`)).status()).toBe(404);
  } finally {
    await context.close();
  }
});

test('chat images, message replies, seen receipts, recall and chat drafts work on mobile', async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({ baseURL: base });
  const receiver = await register(context, 'Complete Chat Receiver');
  await register(page.context(), 'Complete Chat Sender');
  const reader = await context.newPage();
  try {
    await reader.goto('/');
    await page.goto('/');
    await page.locator('.contact-row').filter({ hasText: receiver.name }).click();
    await expect(page.locator('.chat-header')).toContainText('Đang hoạt động');
    await page
      .locator('.message-form input[type=file]')
      .setInputFiles({ name: 'chat.png', mimeType: 'image/png', buffer: image });
    await expect(page.locator('.message-compose-preview img')).toBeVisible();
    await page.getByLabel('Nội dung tin nhắn').fill('A chat image');
    await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect(page.locator('.message .chat-image')).toBeVisible();
    await reader.getByRole('button', { name: 'Mở tin nhắn', exact: true }).click();
    await reader.locator('.conversation').filter({ hasText: 'Complete Chat Sender' }).click();
    await expect(reader.locator('.chat-image')).toBeVisible();
    await expect(page.locator('.message small')).toContainText('Đã xem');
    await reader.getByRole('button', { name: 'Trả lời tin nhắn', exact: true }).click();
    await reader.getByLabel('Nội dung tin nhắn').fill('Reply to the image');
    await reader.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect(page.locator('.message-quote')).toContainText('A chat image');
    await page
      .locator('.message.outgoing')
      .getByRole('button', { name: 'Thu hồi tin nhắn' })
      .click();
    await page
      .locator('.confirm-dialog')
      .getByRole('button', { name: 'Thu hồi', exact: true })
      .click();
    await expect(reader.locator('.recalled-message')).toBeVisible();
    await expect(reader.locator('.message-quote')).toContainText('Tin nhắn đã thu hồi');
    await page.getByLabel('Nội dung tin nhắn').fill('Persistent chat draft');
    await expect(reader.locator('.typing-indicator')).toContainText('đang nhập');
    await page.reload();
    await page.locator('.contact-row').filter({ hasText: receiver.name }).click();
    await expect(page.getByLabel('Nội dung tin nhắn')).toHaveValue('Persistent chat draft');
    await page.setViewportSize({ width: 393, height: 852 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/chat-complete-mobile.png', fullPage: true });
  } finally {
    await context.close();
  }
});

test('forgot-password links open a reset form and allow login with the new password', async ({
  page,
}) => {
  const user = await register(page.context(), 'Recovery User');
  await page.request.post('/api/auth/logout');
  await page.goto('/');
  await page.getByRole('button', { name: 'Quên mật khẩu?', exact: true }).click();
  const forgot = page.getByRole('dialog', { name: 'Quên mật khẩu' });
  await forgot.getByLabel('Email đăng ký').fill(user.email);
  await forgot.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click();
  await expect(forgot).toContainText('Nếu email đã đăng ký');
  const messages = (await readFile('test-results/mail.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const message = messages.findLast((m: { to: string }) => m.to === user.email);
  expect(message).toBeTruthy();
  const link = message.text.match(/https?:\/\/\S+/)[0];
  await page.goto(link);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('RecoveredPassword123!');
  await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill('RecoveredPassword123!');
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText('Đã hoàn tất. Bạn có thể quay lại Po.')).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại Po', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('RecoveredPassword123!');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Bảng tin' })).toBeVisible();
});

test('nested comments can be edited and liked, and notification links focus the exact reply', async ({
  page,
  browser,
}) => {
  const author = await register(page.context(), 'Thread Owner');
  const context = await browser.newContext({ baseURL: base });
  await register(context, 'Thread Reader');
  const reader = await context.newPage();
  try {
    const post = (
      await (
        await page.request.post('/api/posts', { data: { content: 'Nested UI discussion' } })
      ).json()
    ).post;
    await page.goto('/');
    await reader.goto('/');
    const own = page.locator(`article[data-post-id="${post.id}"]`),
      remote = reader.locator(`article[data-post-id="${post.id}"]`);
    await remote
      .locator('.post-actions')
      .getByRole('button', { name: 'Bình luận', exact: true })
      .click();
    await remote.getByLabel('Nội dung bình luận', { exact: true }).fill('Root from reader');
    await remote.getByRole('button', { name: 'Gửi bình luận' }).click();
    await expect(remote.getByText('Đang gửi…', { exact: true })).toHaveCount(0);
    await remote.getByRole('button', { name: 'Sửa bình luận', exact: true }).click();
    await remote
      .getByRole('textbox', { name: 'Sửa bình luận', exact: true })
      .fill('Edited root from reader');
    await remote.locator('.comment-edit').getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(remote.getByText('Edited root from reader', { exact: true })).toBeVisible();
    await own
      .locator('.post-actions')
      .getByRole('button', { name: 'Bình luận', exact: true })
      .click();
    await expect(own.getByText('Edited root from reader', { exact: true })).toBeVisible();
    await own.locator('.comment-meta').getByRole('button', { name: 'Thích', exact: true }).click();
    await expect(own.locator('.comment-meta .liked')).toContainText('1');
    await own
      .locator('.comment-meta')
      .getByRole('button', { name: 'Trả lời', exact: true })
      .click();
    await own.getByLabel('Nội dung bình luận', { exact: true }).fill('Reply from owner');
    await own.getByRole('button', { name: 'Gửi bình luận' }).click();
    await expect(own.getByText('Đang gửi…', { exact: true })).toHaveCount(0);
    const roots = (await (await reader.request.get(`/api/posts/${post.id}/comments`)).json())
      .comments;
    const replies = (
      await (
        await reader.request.get(`/api/posts/${post.id}/comments/${roots[0].id}/replies`)
      ).json()
    ).comments;
    const rootReply = replies[0];
    await reader.goto(`/#post=${post.id}&comment=${rootReply.id}`);
    await expect(reader.locator(`#comment-${rootReply.id}.comment-highlight`)).toBeVisible();
    await reader
      .locator(`#comment-${rootReply.id}`)
      .getByRole('button', { name: 'Trả lời', exact: true })
      .click();
    await reader.getByLabel('Nội dung bình luận', { exact: true }).fill('A nested reply');
    await reader.getByRole('button', { name: 'Gửi bình luận' }).click();
    await expect(reader.getByText('Đang gửi…', { exact: true })).toHaveCount(0);
    await expect(reader.getByText('A nested reply', { exact: true })).toBeVisible();
    const nested = (
      await (
        await reader.request.get(`/api/posts/${post.id}/comments/${rootReply.id}/replies`)
      ).json()
    ).comments[0];
    await page.goto(`/#post=${post.id}&comment=${nested.id}`);
    await expect(page.locator(`#comment-${nested.id}.comment-highlight`)).toBeVisible();
    await page.setViewportSize({ width: 393, height: 852 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/nested-comments-mobile.png', fullPage: true });
    expect(author.id).toBeTruthy();
  } finally {
    await context.close();
  }
});

test('verified admin can review reports, ban, unban and remove content through settings', async ({
  page,
  browser,
}) => {
  await page.request.post('/api/auth/register', {
    data: {
      name: 'Complete Admin',
      username: 'complete_admin',
      email: 'complete_admin@example.com',
      password: 'Password123!',
    },
  });
  await page.request.post('/api/account/verification');
  const mails = (await readFile('test-results/mail.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const verification = mails.findLast(
    (mail: { to: string }) => mail.to === 'complete_admin@example.com',
  );
  const token = new URLSearchParams(
    new URL(verification.text.match(/https?:\/\/\S+/)[0]).hash.slice(1),
  ).get('token');
  expect((await page.request.post('/api/auth/verify-email', { data: { token } })).status()).toBe(
    200,
  );
  const context = await browser.newContext({ baseURL: base });
  const owner = await register(context, 'Moderation Target');
  try {
    const post = (
      await (
        await context.request.post('/api/posts', { data: { content: 'Moderation UI content' } })
      ).json()
    ).post;
    await page.goto('/');
    const article = page.locator(`article[data-post-id="${post.id}"]`);
    await article.getByRole('button', { name: 'Báo cáo bài viết' }).click();
    const report = page.getByRole('dialog', { name: 'Báo cáo nội dung' });
    await report.getByLabel('Lý do báo cáo').fill('Nội dung cần kiểm tra');
    await report.getByRole('button', { name: 'Gửi báo cáo' }).click();
    await expect(report).toContainText('Đã gửi báo cáo');
    await report.getByRole('button', { name: 'Đóng', exact: true }).click();
    const drawer = await settings(page);
    await drawer.getByRole('button', { name: 'Quản trị', exact: true }).click();
    const card = drawer.locator('.report-card').filter({ hasText: 'Moderation UI content' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Khóa tài khoản', exact: true }).click();
    await page
      .locator('.confirm-dialog')
      .getByRole('button', { name: 'Khóa', exact: true })
      .click();
    await expect.poll(async () => (await context.request.get('/api/auth/me')).status()).toBe(401);
    await card.getByRole('button', { name: 'Mở khóa tài khoản', exact: true }).click();
    await expect(drawer.getByRole('status')).toContainText('Đã mở khóa');
    expect(
      (
        await context.request.post('/api/auth/login', {
          data: { email: owner.email, password: 'Password123!' },
        })
      ).status(),
    ).toBe(200);
    await card.getByRole('button', { name: 'Đã xử lý', exact: true }).click();
    await expect(card.locator('small')).toContainText('resolved');
    await card.getByRole('button', { name: 'Gỡ bài', exact: true }).click();
    await page
      .locator('.confirm-dialog')
      .getByRole('button', { name: 'Gỡ bài', exact: true })
      .click();
    await expect(card).toHaveCount(0);
    expect((await context.request.get(`/api/posts/${post.id}`)).status()).toBe(404);
  } finally {
    await context.close();
  }
});
