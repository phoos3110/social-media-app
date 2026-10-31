import { chromium, devices, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const require = createRequire(new URL('../server/package.json', import.meta.url));
require('dotenv').config({ path: 'server/.env', quiet: true });
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });
const sharp = require('sharp');
const origin = 'http://localhost:5180';
const browser = await chromium.launch({ channel: 'chrome' });
let userId;
try {
  const context = await browser.newContext({ baseURL: origin });
  const suffix = Date.now().toString(36);
  const created = await context.request.post('/api/auth/register', {
    data: {
      name: 'PWA Test',
      username: `pwa_${suffix}`,
      email: `${suffix}@example.com`,
      password: 'PwaTest123!',
    },
  });
  expect(created.status()).toBe(201);
  userId = (await created.json()).user.id;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bảng tin', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifestResponse = await context.request.get('/manifest.webmanifest');
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe('Po');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  for (const icon of [
    ...manifest.icons,
    { src: '/icons/apple-touch-icon.png', sizes: '180x180' },
  ]) {
    const response = await context.request.get(icon.src);
    expect(response.status()).toBe(200);
    const metadata = await sharp(await response.body()).metadata();
    expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes);
    expect(metadata.format).toBe('png');
  }
  const swResponse = await context.request.get('/sw.js');
  expect(swResponse.headers()['cache-control']).toBe('no-store');
  const workerCode = await swResponse.text();
  expect(workerCode).not.toContain('__PO_BUILD__');
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me');
    return { status: response.status, cache: response.headers.get('cache-control') };
  });
  expect(me.status).toBe(200);
  expect(me.cache).toBe('no-store');
  const cacheURLs = await page.evaluate(async () => {
    const output = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys()) output.push(request.url);
    return output;
  });
  expect(cacheURLs.some((url) => url.endsWith('/offline.html'))).toBe(true);
  expect(cacheURLs.some((url) => /\/(api|socket\.io|uploads)\//.test(url))).toBe(false);
  expect(cacheURLs.includes(`${origin}/`)).toBe(false);
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Bạn đang ngoại tuyến' })).toBeVisible();
  expect(await page.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/pwa-offline-mobile.png', fullPage: true });
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Thử kết nối lại' }).click();
  await expect(page.getByRole('heading', { name: 'Bảng tin', exact: true })).toBeVisible();
  const ios = await browser.newContext({ ...devices['iPhone 13'], baseURL: origin });
  await ios.addInitScript(() =>
    window.addEventListener('beforeinstallprompt', (event) => event.stopImmediatePropagation()),
  );
  const iphone = await ios.newPage();
  await iphone.goto('/');
  await iphone.getByRole('button', { name: 'Cài Po', exact: true }).click();
  await expect(iphone.getByRole('dialog')).toContainText('Thêm vào Màn hình chính');
  await iphone.getByRole('dialog').getByRole('button', { name: 'Đã hiểu' }).click();
  await ios.close();
  expect(errors).toEqual([]);
  await context.close();
  console.log(
    'Browser PWA passed: manifest/icons, private cache exclusions, 320px layout, offline/reconnect and iPhone install help.',
  );

  // Exercise update safety independently: installing a new worker must not force reload.
  const events = {};
  let skipped = 0;
  const saved = new Map();
  const removed = [];
  const cache = {
    addAll: async (urls) => urls.forEach((url) => saved.set(url, new Response('offline'))),
    match: async (request) =>
      saved.get(typeof request === 'string' ? request : new URL(request.url).pathname),
    put: async () => {},
    keys: async () => [],
  };
  const sandbox = {
    self: {
      location: { origin },
      addEventListener: (name, callback) => {
        events[name] = callback;
      },
      skipWaiting: () => {
        skipped++;
      },
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      keys: async () => ['po-static-old', 'another-app-cache'],
      delete: async (name) => {
        removed.push(name);
      },
      match: async (url) => saved.get(url),
    },
    fetch: async () => {
      throw new Error('offline');
    },
    URL,
    Response,
  };
  vm.runInNewContext(workerCode, sandbox);
  let work;
  events.install({
    waitUntil: (promise) => {
      work = promise;
    },
  });
  await work;
  expect(skipped).toBe(0);
  for (const path of ['/api/auth/me', '/socket.io/', '/uploads/example.webp']) {
    let intercepted = false;
    events.fetch({
      request: { method: 'GET', url: origin + path, mode: 'cors' },
      respondWith: () => {
        intercepted = true;
      },
    });
    expect(intercepted).toBe(false);
  }
  let fallback;
  events.fetch({
    request: { method: 'GET', url: origin + '/', mode: 'navigate' },
    respondWith: (promise) => {
      fallback = promise;
    },
  });
  expect(await (await fallback).text()).toBe('offline');
  events.activate({
    waitUntil: (promise) => {
      work = promise;
    },
  });
  await work;
  expect(removed).toEqual(['po-static-old']);
  events.message({ data: { type: 'ACTIVATE_UPDATE' } });
  expect(skipped).toBe(1);
  console.log(
    'Service worker passed: explicit update activation, private route bypass and own-cache cleanup.',
  );
} finally {
  await browser.close();
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
}
