import { test, expect } from '@playwright/test';

test('publish a YouTube song from a saved draft', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: 'Music Fan',
      username: `music_${suffix}`,
      email: `music_${suffix}@example.com`,
      password: 'Password123!',
    },
  });
  expect(response.status()).toBe(201);
  await page.goto('/');
  await page.getByRole('button', { name: 'Bài hát', exact: true }).click();
  const input = page.getByLabel('Bài hát từ YouTube');
  await input.fill('https://example.com/song');
  await expect(page.getByRole('button', { name: 'Đăng bài', exact: true })).toBeDisabled();
  await input.fill('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.reload();
  await expect(input).toHaveValue('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(page.locator('.composer iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
  await page.getByRole('button', { name: 'Đăng bài', exact: true }).click();
  await expect(page.locator('article iframe').first()).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
  await expect(page.locator('.composer iframe')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('article iframe').first()).toBeVisible();
});
