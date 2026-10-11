import { expect, test, type Locator, type Page } from '@playwright/test';
import { emptyState, type AppState } from '../../src/lib/domain/types';

// Synthetic 8×8 PNGs generated in memory. Every account and photo response below
// is intercepted in an isolated browser context; nothing is written to a database.
const rosePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWN4EVuKFTEMLQkASg1ugXDxfiUAAAAASUVORK5CYII=', 'base64');
const bluePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPQbt+OFTEMLQkAINVaQbRsOy0AAAAASUVORK5CYII=', 'base64');
const photoInput = (page: Page) => page.getByLabel('Profil fotoğrafı seç', { exact: true });
const photoCard = (page: Page) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Profil fotoğrafı', exact: true }) });
const chromePhotos = (page: Page) => page.locator('.profile-button img, .topbar .avatar img');

function syntheticState(): AppState {
  return {
    ...emptyState(true),
    authenticated: true,
    settings: {
      display_name: 'Sentetik fotoğraf testi', exam_year: 2027, exam_date: null,
      target_rank: null, timezone: 'Europe/Istanbul', daily_target_minutes: 180,
      task_share: .7, difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 },
      weekday_targets: Array(7).fill(180), theme: 'ocean', appearance: 'dark',
      reduced_motion: true, simple_view: false, revision: 1,
    },
  };
}

async function mockedProfile(page: Page, initialPhoto: Buffer | null = null) {
  const mock = {
    photo: initialPhoto,
    failSave: false,
    writes: [] as { method: string; body: Buffer | null; contentType: string }[],
    unexpectedWrites: [] as string[],
  };
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    mock.unexpectedWrites.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
    await route.fulfill({ status: 500, json: { error: { message: 'Unexpected synthetic test mutation' } } });
  });
  await page.route('**/api/state', route => route.fulfill({ json: syntheticState() }));
  await page.route('**/api/calendar/today', route => route.fulfill({ json: { connected: false, events: [], refreshedAt: null } }));
  await page.route('**/api/profile/photo*', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      if (!mock.photo) return route.fulfill({ status: 404, json: { error: { code: 'PHOTO_NOT_FOUND', message: 'Profil fotoğrafı yok.' } } });
      return route.fulfill({ status: 200, contentType: 'image/png', body: mock.photo, headers: { 'Cache-Control': 'private, no-store' } });
    }
    mock.writes.push({ method: request.method(), body: request.postDataBuffer(), contentType: request.headers()['content-type'] ?? '' });
    if (request.method() === 'PUT') {
      if (mock.failSave) return route.fulfill({ status: 500, json: { error: { code: 'SAVE_FAILED', message: 'Fotoğraf kaydedilemedi. Lütfen yeniden dene.' } } });
      mock.photo = request.postDataBuffer();
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() === 'DELETE') {
      mock.photo = null;
      return route.fulfill({ json: { ok: true } });
    }
    throw new Error('Unexpected profile photo method: ' + request.method());
  });
  await page.goto('/');
  await expect(page.locator('.profile-button strong')).toHaveText('Sentetik fotoğraf testi');
  return mock;
}

async function openProfile(page: Page) {
  const menu = page.getByRole('button', { name: 'Menüyü aç', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.locator('.profile-button').click();
  await expect(page.getByRole('button', { name: 'Genel ayarlar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Hesap', exact: true })).toHaveClass(/active/);
  await expect(photoCard(page)).toBeVisible();
}

async function selectPhoto(page: Page, buffer = rosePhoto) {
  await expect(photoInput(page)).toBeEnabled();
  await photoInput(page).setInputFiles({ name: 'sentetik-fotograf.png', mimeType: 'image/png', buffer });
  const preview = page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true });
  await expect(preview).toBeVisible();
  await expectDecoded(preview);
}

async function expectDecoded(images: Locator) {
  await expect.poll(() => images.evaluateAll(nodes => nodes.length > 0 && nodes.every(node => {
    const image = node as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  }))).toBe(true);
}

async function expectSavedPhoto(page: Page) {
  await expect(chromePhotos(page)).toHaveCount(2);
  await expectDecoded(chromePhotos(page));
  const savedPhoto = photoCard(page).getByRole('img', { name: 'Profil fotoğrafın', exact: true });
  await expect(savedPhoto).toBeVisible();
  await expectDecoded(savedPhoto);
  const sources = await page.locator('.profile-button img, .topbar .avatar img').evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
  expect(new Set(sources).size).toBe(1);
  await expect(savedPhoto).toHaveAttribute('src', await chromePhotos(page).first().getAttribute('src') ?? '');
  return sources[0];
}

test('profile photo previews, cancels, saves across avatars and reloads, replaces and removes', async ({ page }) => {
  const mock = await mockedProfile(page);
  await openProfile(page);
  await expect(photoCard(page).getByRole('button', { name: 'Fotoğraf seç', exact: true })).toBeVisible();
  await expect(photoInput(page)).toHaveAttribute('accept', /image\/jpeg/);
  await expect(photoInput(page)).toHaveAttribute('accept', /image\/png/);
  await expect(photoInput(page)).toHaveAttribute('accept', /image\/webp/);

  await selectPhoto(page);
  expect(mock.writes).toEqual([]);
  await expect(chromePhotos(page)).toHaveCount(0);
  await photoCard(page).getByRole('button', { name: 'Vazgeç', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true })).toHaveCount(0);
  await expect(photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true })).toHaveCount(0);
  expect(mock.writes).toEqual([]);

  await selectPhoto(page);
  await photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true }).click();
  await expectSavedPhoto(page);
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toMatchObject({ method: 'PUT', contentType: 'image/png' });
  expect(mock.writes[0].body?.equals(rosePhoto)).toBe(true);
  await expect(photoCard(page).getByRole('button', { name: 'Fotoğrafı değiştir', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true })).toHaveCount(0);

  await page.reload();
  await openProfile(page);
  const reloadedSource = await expectSavedPhoto(page);
  expect(mock.writes).toHaveLength(1);

  await selectPhoto(page, bluePhoto);
  await photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true }).click();
  const replacementSource = await expectSavedPhoto(page);
  expect(replacementSource).not.toBe(reloadedSource);
  expect(mock.writes).toHaveLength(2);
  expect(mock.writes[1].body?.equals(bluePhoto)).toBe(true);

  await photoCard(page).getByRole('button', { name: 'Fotoğrafı kaldır', exact: true }).click();
  await expect(chromePhotos(page)).toHaveCount(0);
  await expect(photoCard(page).getByRole('img', { name: 'Profil fotoğrafın', exact: true })).toHaveCount(0);
  await expect(photoCard(page).getByRole('button', { name: 'Fotoğraf seç', exact: true })).toBeVisible();
  await expect(page.locator('.profile-button .avatar')).toHaveText('SF');
  await expect(page.locator('.topbar .avatar')).toHaveText('SF');
  expect(mock.writes.map(write => write.method)).toEqual(['PUT', 'PUT', 'DELETE']);
  expect(mock.photo).toBeNull();
  expect(mock.unexpectedWrites).toEqual([]);
});

test('the profile shortcut reopens account settings and the photo controls work with a keyboard', async ({ page }) => {
  const mock = await mockedProfile(page);
  await openProfile(page);
  await page.getByRole('button', { name: 'Görünüm', exact: true }).click();
  await expect(photoCard(page)).toHaveCount(0);
  await openProfile(page);

  await page.getByRole('button', { name: 'Görünüm', exact: true }).click();
  await page.locator('.profile-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Hesap', exact: true })).toHaveClass(/active/);
  await expect(photoCard(page)).toBeVisible();
  const choose = photoCard(page).getByRole('button', { name: 'Fotoğraf seç', exact: true });
  await expect(choose).toBeEnabled();
  await choose.focus();
  const chooserEvent = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const chooser = await chooserEvent;
  await chooser.setFiles({ name: 'sentetik-klavye.png', mimeType: 'image/png', buffer: rosePhoto });
  await expect(page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true })).toBeVisible();
  await photoCard(page).getByRole('button', { name: 'Fotoğrafı değiştir', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(photoCard(page).getByRole('button', { name: 'Vazgeç', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true })).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  expect(mock.unexpectedWrites).toEqual([]);
});

test('unsupported and oversized images stay local and report actionable errors', async ({ page }) => {
  const mock = await mockedProfile(page);
  await openProfile(page);
  await expect(photoInput(page)).toBeEnabled();
  for (const file of [
    { name: 'sentetik.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    { name: 'sentetik.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
  ]) {
    await photoInput(page).setInputFiles(file);
    await expect(photoCard(page).getByRole('alert')).toContainText(/JPEG|JPG|PNG|WebP/i);
    await expect(page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true })).toHaveCount(0);
  }
  await photoInput(page).setInputFiles({ name: 'buyuk-fotograf.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await expect(photoCard(page).getByRole('alert')).toContainText(/4\s*MB/);
  await expect(page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true })).toHaveCount(0);
  await expect(photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true })).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  expect(mock.unexpectedWrites).toEqual([]);
});

test('a failed replacement retains the saved photo and allows retrying the selection', async ({ page }) => {
  const mock = await mockedProfile(page, rosePhoto);
  await openProfile(page);
  const initialSource = await expectSavedPhoto(page);
  mock.failSave = true;
  await selectPhoto(page, bluePhoto);
  await photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true }).click();
  await expect(photoCard(page).getByRole('alert')).toContainText('Fotoğraf kaydedilemedi. Lütfen yeniden dene.');
  await expect(chromePhotos(page)).toHaveCount(2);
  await expectDecoded(chromePhotos(page));
  expect(await chromePhotos(page).first().evaluate(node => (node as HTMLImageElement).src)).toBe(initialSource);
  expect(mock.photo?.equals(rosePhoto)).toBe(true);
  await expect(page.getByRole('img', { name: 'Seçilen profil fotoğrafı', exact: true })).toBeVisible();
  await expect(photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true })).toBeEnabled();

  mock.failSave = false;
  await photoCard(page).getByRole('button', { name: 'Fotoğrafı kaydet', exact: true }).click();
  expect(await expectSavedPhoto(page)).not.toBe(initialSource);
  expect(mock.photo?.equals(bluePhoto)).toBe(true);
  expect(mock.writes.map(write => write.method)).toEqual(['PUT', 'PUT']);
  expect(mock.unexpectedWrites).toEqual([]);
});

for (const width of [320, 360, 760, 1440]) {
  test('profile photo controls and preview fit a ' + width + 'px viewport', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const mock = await mockedProfile(page);
    await openProfile(page);
    await selectPhoto(page);
    const card = photoCard(page);
    await expect(card.getByRole('button', { name: 'Fotoğrafı kaydet', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await card.evaluate(node => {
      const box = node.getBoundingClientRect();
      return Array.from(node.querySelectorAll('button, img')).every(child => {
        const childBox = child.getBoundingClientRect();
        return childBox.left >= box.left - 1 && childBox.right <= box.right + 1;
      });
    })).toBe(true);
    await card.screenshot({ path: 'artifacts/profile-photo-preview-' + width + '.png', animations: 'disabled' });
    await card.getByRole('button', { name: 'Fotoğrafı kaydet', exact: true }).click();
    await expectSavedPhoto(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(mock.writes.map(write => write.method)).toEqual(['PUT']);
    expect(mock.unexpectedWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
}
