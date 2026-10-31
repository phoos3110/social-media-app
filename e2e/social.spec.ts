import { test, expect, type Page } from '@playwright/test';

test('compact feed keeps mobile search usable and dark actions readable', async ({ page }) => {
  await register(page, 'Phương Nguyễn', 'phuong_layout');
  await page
    .getByLabel('Nội dung bài viết', { exact: true })
    .fill('Một buổi chiều thật nhẹ nhàng. Bạn có điều gì vui hôm nay?');
  await page.getByRole('button', { name: 'Đăng bài', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('nhip-theme', value), theme);
    await page.reload();
    for (const width of [320, 393, 768, 1440]) {
      await page.setViewportSize({ width, height: 852 });
      const post = page
        .locator('article')
        .filter({ hasText: 'Một buổi chiều thật nhẹ nhàng.' })
        .first();
      await expect(post).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width < 600) {
        const composer = await page.locator('.composer').boundingBox();
        expect(composer!.height).toBeLessThan(160);
        await page.getByRole('button', { name: 'Tìm kiếm bài viết', exact: true }).click();
        await page
          .getByRole('searchbox', { name: 'Tìm kiếm', exact: true })
          .fill('khongtontai_layout');
        await expect(page.getByRole('heading', { name: 'Chưa tìm thấy câu chuyện' })).toBeVisible();
        await page.getByRole('button', { name: 'Tìm kiếm bài viết', exact: true }).click();
        await expect(post).toBeVisible();
      }
      const like = post.getByRole('button', { name: 'Thích', exact: true });
      await like.hover();
      if (theme === 'dark') {
        await expect(like).toHaveCSS('background-color', 'rgb(58, 59, 60)');
        await expect(like).toHaveCSS('color', 'rgb(228, 230, 235)');
      }
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `test-results/feed-${theme}-${width}.png`, fullPage: true });
    }
  }
});

async function register(page: Page, name: string, username: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(name);
  await page.getByLabel('Tên người dùng', { exact: true }).fill(username);
  await page.getByLabel('Email', { exact: true }).fill(`${username}@example.com`);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bảng tin' })).toBeVisible();
}

test('two people can post, edit, comment, follow, receive notifications and chat in realtime', async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const alice = await a.newPage();
  const bob = await b.newPage();
  const errors: string[] = [];
  alice.on('pageerror', (e) => errors.push(e.message));
  bob.on('pageerror', (e) => errors.push(e.message));
  await register(alice, 'Alice Nguyen', 'alice_browser');
  await alice.getByLabel('Nội dung bài viết', { exact: true }).fill('Một ngày học React thật vui');
  await alice.getByRole('button', { name: 'Đăng bài', exact: true }).click();
  const article = alice.locator('article').first();
  await expect(article.getByText('Một ngày học React thật vui')).toBeVisible();
  await article.getByRole('button', { name: 'Tùy chọn bài viết' }).click();
  await article.getByRole('button', { name: 'Sửa bài viết' }).click();
  await article.getByLabel('Sửa nội dung bài viết').fill('Đã lưu nội dung mới');
  await article.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(article.getByText('Đã lưu nội dung mới')).toBeVisible();
  await alice.reload();
  await expect(alice.locator('article').getByText('Đã lưu nội dung mới')).toBeVisible();
  await register(bob, 'Bob Tran', 'bob_browser');
  const bobPost = bob.locator('article').first();
  await expect(bobPost.getByRole('button', { name: 'Tùy chọn bài viết' })).toHaveCount(0);
  await bobPost.getByRole('button', { name: 'Thích', exact: true }).click();
  await expect(bobPost.getByRole('button', { name: 'Đã thích', exact: true })).toBeVisible();
  await bobPost.getByRole('button', { name: 'Bình luận', exact: true }).click();
  await bobPost.getByLabel('Nội dung bình luận').fill('Cùng học nhé!');
  await bobPost.getByRole('button', { name: 'Gửi bình luận' }).click();
  await expect(bobPost.getByText('Cùng học nhé!', { exact: true })).toBeVisible();
  await bobPost.getByRole('button', { name: 'Xóa bình luận' }).click();
  await bob.getByRole('dialog').getByRole('button', { name: 'Xóa bình luận', exact: true }).click();
  await expect(bobPost.getByText('Cùng học nhé!', { exact: true })).toHaveCount(0);
  await bob.locator('.topbar').getByRole('button', { name: 'Khám phá', exact: true }).click();
  const person = bob.locator('.person-card').filter({ hasText: 'Alice Nguyen' });
  await person.getByRole('button', { name: 'Theo dõi', exact: true }).click();
  await expect(person.getByRole('button', { name: 'Đang theo dõi', exact: true })).toBeVisible();
  await alice.locator('.topbar').getByRole('button', { name: 'Mở thông báo' }).click();
  await expect(alice.locator('.notice')).toHaveCount(3);
  await alice.getByRole('button', { name: 'Đọc tất cả' }).click();
  await expect(alice.getByText('0 thông báo chưa đọc')).toBeVisible();
  await person.getByRole('button', { name: 'Nhắn tin cho Alice Nguyen' }).click();
  await bob.getByLabel('Nội dung tin nhắn').fill('Xin chào Alice!');
  await bob.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  await expect(bob.locator('.message').getByText('Xin chào Alice!')).toBeVisible();
  await alice.locator('.topbar').getByRole('button', { name: 'Mở tin nhắn' }).click();
  await alice.locator('.conversation').filter({ hasText: 'Bob Tran' }).click();
  await expect(alice.locator('.message').getByText('Xin chào Alice!')).toBeVisible();
  await alice.getByLabel('Nội dung tin nhắn').fill('Chào Bob, tin nhắn đến ngay!');
  await alice.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  await expect(bob.locator('.message').getByText('Chào Bob, tin nhắn đến ngay!')).toBeVisible();
  await alice
    .locator('.topbar')
    .getByRole('button', { name: 'Trang cá nhân', exact: true })
    .click();
  await alice.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await alice.getByLabel('Giới thiệu', { exact: true }).fill('Đang học fullstack');
  await alice.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(alice.getByText('Đang học fullstack', { exact: true })).toBeVisible();
  await alice.locator('.topbar').getByRole('button', { name: 'Bảng tin', exact: true }).click();
  await alice.screenshot({ path: 'test-results/feed-desktop.png', fullPage: true });
  await alice.setViewportSize({ width: 390, height: 844 });
  await expect(alice.locator('.mobile-nav')).toBeVisible();
  expect(
    await alice.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await alice.screenshot({ path: 'test-results/feed-mobile.png', fullPage: true });
  await alice.reload();
  await expect(alice.locator('article').getByText('Đã lưu nội dung mới')).toBeVisible();
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test('auth screen fits mobile and shows login errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('nobody@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('wrongpass');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu không đúng.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/auth-mobile.png', fullPage: true });
});

test('image posts, avatar, search, cancel edit and deletion work in browser', async ({ page }) => {
  await register(page, 'Minh Photo', 'minh_photo');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIElEQVQ4jWPQSA0mGzGMag4eDbDg0UQSPJoxggeuMAAA7mNeENmdLGMAAAAASUVORK5CYII=',
    'base64',
  );
  await page
    .locator('.composer input[type=file]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.composer-preview img')).toBeVisible();
  await page.getByLabel('Nội dung bài viết', { exact: true }).fill('Ảnh đầu tiên của Minh');
  await page.getByRole('button', { name: 'Đăng bài', exact: true }).click();
  const article = page.locator('article').first();
  await expect(article.locator('.post-image')).toBeVisible();
  expect(
    await article.locator('.post-image').evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await article.getByRole('button', { name: 'Tùy chọn bài viết' }).click();
  await article.getByRole('button', { name: 'Sửa bài viết' }).click();
  await article.getByLabel('Sửa nội dung bài viết').fill('Không lưu bản này');
  await article.getByRole('button', { name: 'Hủy', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
  await expect(article.getByText('Ảnh đầu tiên của Minh')).toBeVisible();
  await page.getByLabel('Tìm kiếm trên Po', { exact: true }).fill('MINH');
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByLabel('Tìm kiếm trên Po', { exact: true }).fill('khongcoketqua123');
  await expect(page.getByRole('heading', { name: 'Chưa tìm thấy câu chuyện' })).toBeVisible();
  await page.getByLabel('Tìm kiếm trên Po', { exact: true }).fill('');
  await expect(article).toBeVisible();
  await page.locator('.topbar').getByRole('button', { name: 'Trang cá nhân', exact: true }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page
    .locator('.upload-avatar input')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.profile-top img')).toBeVisible();
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.locator('.profile-edit')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.topbar img')).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Ảnh đầu tiên của Minh' })).toBeVisible();
  const postCount = await page.locator('article').count();
  await page.locator('article').first().getByRole('button', { name: 'Tùy chọn bài viết' }).click();
  await page.locator('article').first().getByRole('button', { name: 'Xóa bài viết' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa bài viết', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(postCount - 1);
  await expect(page.getByText('Ảnh đầu tiên của Minh', { exact: true })).toHaveCount(0);
});
