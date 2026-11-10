import { test, expect, type BrowserContext } from '@playwright/test';
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});
async function register(context: BrowserContext, name: string) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const response = await context.request.post('/api/auth/register', {
    data: {
      name,
      username: `u_${suffix}`,
      email: `${suffix}@example.com`,
      password: 'Password123!',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}

test('full post editing, reactions, hiding and Stories work in the interface', async ({ page }) => {
  await register(page.context(), 'Expansion Writer');
  await page.goto('/');
  await page.getByLabel('Nội dung bài viết', { exact: true }).fill('Edit this expansion #newmusic');
  await page.getByRole('button', { name: 'Đăng bài', exact: true }).click();
  const created = page.locator('article').filter({ hasText: 'Edit this expansion' }).first();
  await expect(created).toBeVisible();
  const post = page.locator(
    `article[data-post-id="${await created.getAttribute('data-post-id')}"]`,
  );
  await post.getByLabel('Tùy chọn bài viết').click();
  await post.getByRole('button', { name: 'Sửa bài viết', exact: true }).click();
  await post.getByLabel('Sửa nội dung bài viết').fill('Changed expansion #newmusic');
  await post.getByLabel('Sửa link YouTube').fill('https://youtu.be/dQw4w9WgXcQ');
  await post.getByLabel('Tên bài hát', { exact: true }).fill('A song');
  await post.getByLabel('Ca sĩ hoặc kênh').fill('Singer');
  await post.getByLabel('Quyền xem bài viết', { exact: true }).selectOption('private');
  await post.getByRole('button', { name: 'Lưu', exact: true }).click();
  const updated = page.locator('article').filter({ hasText: 'Changed expansion' }).first();
  await expect(updated).toContainText('Chỉ mình tôi');
  await expect(updated).toContainText('A song');
  await updated.getByRole('button', { name: 'Cảm xúc love', exact: true }).click();
  await expect(updated.getByRole('button', { name: 'Cảm xúc love', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await updated.locator('summary').click();
  await updated.getByRole('button', { name: 'Ẩn bài viết', exact: true }).click();
  await expect(updated).toHaveCount(0);
  await page.getByLabel('Nội dung bài viết', { exact: true }).fill('My short story');
  await page.getByLabel('Tùy chọn bài đăng').click();
  await page.getByLabel('Loại bài đăng').selectOption('story');
  await page.getByRole('button', { name: 'Đăng bài', exact: true }).click();
  await page.getByRole('button', { name: 'Stories · 24 giờ', exact: true }).click();
  await expect(page.locator('.social-hub article')).toContainText('My short story');
});

test('direct chat supports editing, searching, file attachments and voice recording', async ({
  page,
  browser,
}) => {
  await register(page.context(), 'Chat Writer');
  const other = await browser.newContext({ baseURL: 'http://localhost:4100' });
  try {
    const recipient = await register(other, 'Chat Reader');
    await page.context().grantPermissions(['microphone']);
    await page.goto(`/#chat=${recipient.id}`);
    await page.getByLabel('Nội dung tin nhắn', { exact: true }).fill('Original chat text');
    await page.getByLabel('Gửi tin nhắn', { exact: true }).click();
    await page.getByLabel('Sửa tin nhắn', { exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Sửa tin nhắn', exact: true });
    await editor.getByLabel('Sửa tin nhắn', { exact: true }).fill('Updated chat text');
    await editor.getByRole('button', { name: 'Lưu tin nhắn', exact: true }).click();
    await expect(page.locator('.message-list')).toContainText('Updated chat text');
    await page.getByRole('button', { name: 'Tìm tin nhắn', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Tìm trong cuộc trò chuyện' });
    await search.getByLabel('Tìm nội dung tin nhắn').fill('Updated');
    await search.getByRole('button', { name: 'Tìm', exact: true }).click();
    await expect(search.locator('blockquote')).toContainText('Updated chat text');
    await search.getByLabel('Đóng', { exact: true }).click();
    await page.locator('.attachment-picker input[type=file]').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello document'),
    });
    const attachment = page.getByRole('dialog', { name: 'Gửi tệp đính kèm' });
    await attachment.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.locator('.message-list .file-message')).toHaveText('hello.txt');
    await page.getByRole('button', { name: 'Ghi âm', exact: true }).click();
    await page.getByRole('button', { name: 'Dừng ghi âm (tối đa 2 phút)', exact: true }).click();
    await expect(attachment.locator('audio')).toBeVisible();
    await attachment.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.locator('.message-list audio')).toHaveCount(1);
  } finally {
    await other.close();
  }
});

test('group creation and WebRTC audio calls connect between two users', async ({
  page,
  browser,
}) => {
  const a = await register(page.context(), 'Call Owner');
  const other = await browser.newContext({ baseURL: 'http://localhost:4100' });
  try {
    const b = await register(other, 'Call Friend');
    const reader = await other.newPage();
    await page.context().grantPermissions(['microphone', 'camera']);
    await other.grantPermissions(['microphone', 'camera']);
    await page.goto(`/#chat=${b.id}`);
    await reader.goto(`/#chat=${a.id}`);
    await expect(page.locator('.connection-state')).toHaveText('Đã kết nối');
    await expect(reader.locator('.connection-state')).toHaveText('Đã kết nối');
    await page.getByRole('button', { name: 'Gọi thoại', exact: true }).click();
    const incoming = reader.getByRole('dialog', { name: 'Gọi thoại · Call Owner', exact: true });
    await incoming.getByRole('button', { name: 'Trả lời', exact: true }).click();
    await expect(incoming.getByRole('status')).toHaveText('Đang gọi', { timeout: 20000 });
    const outgoing = page.getByRole('dialog', { name: 'Gọi thoại · Call Friend', exact: true });
    await expect(outgoing.getByRole('status')).toHaveText('Đang gọi');
    await outgoing.getByRole('button', { name: 'Kết thúc', exact: true }).click();
    await expect(incoming).toHaveCount(0);
    await page.getByRole('button', { name: 'Chat nhóm', exact: true }).click();
    await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Tạo nhóm chat' });
    await create.getByLabel('Tên nhóm').fill('Our music group');
    await create.getByLabel('Tìm thành viên').fill(b.username);
    await create.getByRole('checkbox').check();
    await create.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
    await page.getByLabel('Tin nhắn nhóm').fill('Hello group');
    await page.getByRole('button', { name: 'Gửi vào nhóm', exact: true }).click();
    await expect(page.locator('.group-message-list')).toContainText('Hello group');
    await page.locator('.group-choices button').first().click();
    await expect(page.locator('.group-message-list')).toContainText('Hello group');
  } finally {
    await other.close();
  }
});
