import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState } from '../../src/lib/domain/types';

// All API requests are intercepted in an isolated browser context; these tests
// never read or write a real account or profile photo.
function syntheticState(): AppState {
  return {
    ...emptyState(true),
    authenticated: true,
    settings: {
      display_name: 'Ada Deniz', exam_year: 2027, exam_date: null,
      target_rank: null, timezone: 'Europe/Istanbul', daily_target_minutes: 180,
      task_share: .7, difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 },
      weekday_targets: Array(7).fill(180), theme: 'ocean', appearance: 'dark',
      reduced_motion: true, simple_view: false, revision: 1,
    },
  };
}

async function mockedProfile(page: Page) {
  const mock = {
    photoRequests: [] as string[],
    unexpectedWrites: [] as string[],
    errors: [] as string[],
  };
  page.on('pageerror', error => mock.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(?:profile\/photo|friends\/[^/]+\/photo)\/?$/.test(path)) {
      mock.photoRequests.push(request.method() + ' ' + path);
      return route.fulfill({ status: 410, json: { error: { message: 'Profile photos are unavailable' } } });
    }
    if (request.method() !== 'GET') {
      mock.unexpectedWrites.push(request.method() + ' ' + path);
      return route.fulfill({ status: 500, json: { error: { message: 'Unexpected synthetic test mutation' } } });
    }
    if (path === '/api/state') return route.fulfill({ json: syntheticState() });
    if (path === '/api/calendar/today') return route.fulfill({ json: { connected: false, events: [], refreshedAt: null } });
    return route.fulfill({ status: 404, json: { error: { message: 'No synthetic response for this read' } } });
  });
  await page.goto('/');
  await expect(page.locator('.profile-button strong')).toHaveText('Ada Deniz');
  return mock;
}

async function expectInitials(page: Page) {
  await expect(page.locator('.profile-button .avatar')).toHaveText('AD');
  await expect(page.locator('.topbar .avatar')).toHaveText('AD');
  await expect(page.locator('.profile-button img, .topbar .avatar img')).toHaveCount(0);
}

async function expectAccountSettings(page: Page) {
  await expect(page.getByRole('button', { name: 'Genel ayarlar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Hesap', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('heading', { name: 'Kişisel hesap', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profil fotoğrafı', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Profil fotoğrafı seç', { exact: true })).toHaveCount(0);
  await expect(page.locator('main input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Fotoğraf(?:ı)? (?:seç|kaydet|değiştir|kaldır)/i })).toHaveCount(0);
  await expectInitials(page);
}

async function openProfile(page: Page) {
  const menu = page.getByRole('button', { name: 'Menüyü aç', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.locator('.profile-button').click();
  await expectAccountSettings(page);
}

test('dashboard and account settings keep initials after navigation and reload without photo requests', async ({ page }) => {
  const mock = await mockedProfile(page);
  await expectInitials(page);
  await openProfile(page);

  await page.getByRole('button', { name: 'Görünüm', exact: true }).click();
  await page.locator('.profile-button').focus();
  await page.keyboard.press('Enter');
  await expectAccountSettings(page);

  await page.reload();
  await expectInitials(page);
  await openProfile(page);
  expect(mock.photoRequests).toEqual([]);
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('mobile profile navigation and account settings use initials without photo controls or requests', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const mock = await mockedProfile(page);
  await expectInitials(page);
  await openProfile(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.reload();
  await openProfile(page);
  expect(mock.photoRequests).toEqual([]);
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});
