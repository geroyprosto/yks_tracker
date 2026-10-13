import { expect, test, type Locator, type Page } from '@playwright/test';
import type { FriendScore } from '../../src/components/friends-workspace';
import { emptyState, type AppState } from '../../src/lib/domain/types';

// All accounts and photo responses are synthetic and intercepted in an isolated
// browser context. No study/profile/friendship rows are written by these tests.
const rosePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWN4EVuKFTEMLQkASg1ugXDxfiUAAAAASUVORK5CYII=', 'base64');
const bluePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPQbt+OFTEMLQkAINVaQbRsOy0AAAAASUVORK5CYII=', 'base64');
const meId = '10000000-0000-4000-8000-000000000001';
const friendId = '10000000-0000-4000-8000-000000000002';
const thirdId = '10000000-0000-4000-8000-000000000003';
const groupId = '10000000-0000-4000-8000-000000000004';
const meName = 'Ada Deniz';
const friendName = 'Bora Bilge';
const thirdName = 'Ceren Can';
const names = [meName, friendName, thirdName];
const ids = [meId, friendId, thirdId];

type PhotoResponse = Buffer | 403 | 404;

function score(user_id: string, display_name: string, today_seconds: number): FriendScore {
  return {
    user_id, display_name, today_seconds, week_seconds: today_seconds * 3,
    today_questions: 30, week_questions: 90, today_tests: 2, week_tests: 6,
    today_tasks: 1, week_tasks: 3,
  };
}

function friendsResponse() {
  const group = { id: groupId, name: 'Sentetik çalışma grubu', owner_id: meId, member_count: 3, timezone: 'Europe/Istanbul' };
  return {
    today: '2026-10-11', week_start: '2026-10-05',
    me: score(meId, meName, 7_200),
    friends: [score(friendId, friendName, 5_400), score(thirdId, thirdName, 3_600)],
    groups: [group], group,
  };
}

function state(): AppState {
  return {
    ...emptyState(true), authenticated: true,
    settings: {
      display_name: meName, exam_year: 2027, exam_date: null, target_rank: null,
      timezone: 'Europe/Istanbul', daily_target_minutes: 180, task_share: .7,
      difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 },
      weekday_targets: Array(7).fill(180), theme: 'ocean', appearance: 'dark',
      reduced_motion: true, simple_view: false, revision: 1,
    },
  };
}

async function mockedFriends(page: Page, initialPhotos: Record<string, PhotoResponse> = {
  [meId]: rosePhoto, [friendId]: bluePhoto, [thirdId]: rosePhoto,
}) {
  const mock = {
    photos: { ...initialPhotos },
    friendsReads: [] as string[],
    friends: friendsResponse(),
    photoReads: [] as { userId: string; url: string; method: string }[],
    unexpectedWrites: [] as string[],
    errors: [] as string[],
  };
  page.on('pageerror', error => mock.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      mock.unexpectedWrites.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 500, json: { error: { message: 'Unexpected synthetic test mutation' } } });
    }
    if (url.pathname === '/api/state') return route.fulfill({ json: state() });
    if (url.pathname === '/api/calendar/today') return route.fulfill({ json: { connected: false, events: [], refreshedAt: null } });
    if (url.pathname === '/api/friends') {
      mock.friendsReads.push(request.url());
      return route.fulfill({ json: mock.friends });
    }
    const friendPhoto = url.pathname.match(/^\/api\/friends\/([^/]+)\/photo$/);
    if (url.pathname === '/api/profile/photo' || friendPhoto) {
      const userId = friendPhoto ? decodeURIComponent(friendPhoto[1]) : meId;
      if (friendPhoto) mock.photoReads.push({ userId, url: request.url(), method: request.method() });
      const photo = mock.photos[userId] ?? 404;
      if (!Buffer.isBuffer(photo)) return route.fulfill({ status: photo, json: { error: { code: photo === 403 ? 'FORBIDDEN' : 'PHOTO_NOT_FOUND' } } });
      return route.fulfill({ contentType: 'image/png', body: photo, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return route.fulfill({ status: 404, json: { error: { message: 'No synthetic response for this read' } } });
  });
  await page.goto('/?page=friends');
  await expect(page.locator('main#main')).toHaveAttribute('data-page', 'friends');
  await expect(page.getByRole('region', { name: 'İkili karşılaşma' })).toBeVisible();
  return mock;
}

const duel = (page: Page) => page.getByRole('region', { name: 'İkili karşılaşma', exact: true });
const ranking = (page: Page) => page.getByRole('region', { name: 'Çalışma süresine göre', exact: true });
const photo = (scope: Page | Locator, name: string) => scope.locator(`img[alt="${name} profil fotoğrafı"]`);
const rankingRow = (page: Page, name: string) => ranking(page).getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

async function expectDecoded(images: Locator, count: number) {
  await expect(images).toHaveCount(count);
  await expect.poll(() => images.evaluateAll((nodes, count) => nodes.length === count && nodes.every(node => {
    const image = node as HTMLImageElement;
    return image.complete && image.naturalWidth === 8 && image.naturalHeight === 8;
  }), count)).toBe(true);
}

async function pixel(image: Locator) {
  return image.evaluate(node => {
    const image = node as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
}

async function expectScores(page: Page) {
  for (const [index, name] of names.entries()) {
    const row = rankingRow(page, name);
    await expect(row).toBeVisible();
    await expect(row.locator(`[aria-label="${index + 1}. sıra"]`)).toBeVisible();
    await expect(row).toContainText('30 soru · 2 test · 1 görev');
  }
  await expect(rankingRow(page, meName)).toContainText('Sen');
  await expect(duel(page)).toContainText(meName);
  await expect(duel(page)).toContainText(friendName);
  await expect(duel(page).locator('[aria-label="Lider"]')).toBeVisible();
  await expect(rankingRow(page, meName)).toContainText('2 sa');
  await expect(rankingRow(page, friendName)).toContainText('1 sa 30 dk');
  await expect(rankingRow(page, thirdName)).toContainText('1 sa');
}

async function expectAllPhotos(page: Page) {
  await expectDecoded(duel(page).locator('img'), 2);
  await expectDecoded(ranking(page).locator('img'), 3);
  const sources: string[] = [];
  for (const [index, name] of names.entries()) {
    const images = photo(page.locator('main#main'), name);
    await expectDecoded(images, index < 2 ? 2 : 1);
    const personSources = await images.evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
    expect(new Set(personSources).size).toBe(1);
    sources.push(personSources[0]);
  }
  expect(new Set(sources).size).toBe(3);
  await expectScores(page);
  return sources;
}

test('self and every friend show their own photos in the duel and ranking', async ({ page }) => {
  const mock = await mockedFriends(page);
  await expectAllPhotos(page);
  for (const userId of ids) expect(mock.photoReads.some(read => read.userId === userId)).toBe(true);
  expect(mock.photoReads.every(read => read.method === 'GET')).toBe(true);
  expect(await pixel(photo(ranking(page), meName))).not.toEqual(await pixel(photo(ranking(page), friendName)));
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('friends refresh on entry and explicit actions without polling or focus refresh', async ({ page }) => {
  await page.clock.install();
  const mock = await mockedFriends(page);
  const initialReads = mock.friendsReads.length;
  expect(initialReads).toBe(1);
  await page.clock.fastForward(180_000);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.fastForward(180_000);
  expect(mock.friendsReads).toHaveLength(initialReads);

  await page.getByRole('button', { name: 'Skorları yenile', exact: true }).click();
  await expect.poll(() => mock.friendsReads.length).toBe(initialReads + 1);
  await expect(page.getByRole('button', { name: 'Skorları yenile', exact: true })).toBeEnabled();
  await page.getByRole('navigation', { name: 'Ana gezinme', exact: true }).getByRole('button', { name: 'Görevlerim', exact: true }).click();
  await expect(page.locator('main#main')).toHaveAttribute('data-page', 'tasks');
  await page.clock.fastForward(180_000);
  expect(mock.friendsReads).toHaveLength(initialReads + 1);

  mock.friends.me.today_seconds = 10_800;
  await page.getByRole('navigation', { name: 'Ana gezinme', exact: true }).getByRole('button', { name: 'Arkadaşlar', exact: true }).click();
  await expect.poll(() => mock.friendsReads.length).toBe(initialReads + 2);
  await expect(rankingRow(page, meName)).toContainText('3 sa');
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('leaving friends aborts an in-flight manual refresh', async ({ page }) => {
  await mockedFriends(page);
  let releaseRead: (() => void) | undefined;
  const heldRead = new Promise<void>(resolve => { releaseRead = resolve; });
  await page.route('**/api/friends?*', async route => {
    await heldRead;
    await route.fulfill({ json: friendsResponse() });
  });
  const pendingRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/friends');
  await page.getByRole('button', { name: 'Skorları yenile', exact: true }).click();
  const request = await pendingRead;
  const aborted = page.waitForEvent('requestfailed', failed => failed === request);
  await page.getByRole('navigation', { name: 'Ana gezinme', exact: true }).getByRole('button', { name: 'Görevlerim', exact: true }).click();
  try {
    const failed = await aborted;
    expect(failed.failure()?.errorText).toMatch(/ABORTED/);
    await expect(page.locator('main#main')).toHaveAttribute('data-page', 'tasks');
  } finally {
    releaseRead?.();
  }
});

for (const status of [404, 403] as const) {
  test(`unavailable ${status} photos use initials without hiding names, ranks or the leader crown`, async ({ page }) => {
    const mock = await mockedFriends(page, { [meId]: status, [friendId]: status, [thirdId]: bluePhoto });
    await expect.poll(() => new Set(mock.photoReads.map(read => read.userId)).size).toBe(3);
    await expect(duel(page).locator('img')).toHaveCount(0);
    await expect(ranking(page).locator('img')).toHaveCount(1);
    await expectDecoded(photo(ranking(page), thirdName), 1);
    for (const [name, initials] of [[meName, 'AD'], [friendName, 'BB']]) {
      await expect(photo(page.locator('main#main'), name)).toHaveCount(0);
      await expect(duel(page).getByText(initials, { exact: true })).toBeVisible();
      await expect(rankingRow(page, name).getByText(initials, { exact: true })).toBeVisible();
    }
    await expectScores(page);
    expect(mock.unexpectedWrites).toEqual([]);
    expect(mock.errors).toEqual([]);
  });
}

test('refresh and reload show a changed photo and removed friend photo across both views', async ({ page }) => {
  const mock = await mockedFriends(page);
  const originalSources = await expectAllPhotos(page);
  const originalPixel = await pixel(photo(ranking(page), meName));
  const readsBefore = mock.photoReads.length;
  mock.photos[meId] = bluePhoto;
  mock.photos[friendId] = 404;
  await page.getByRole('button', { name: 'Skorları yenile', exact: true }).click();
  await expect.poll(() => mock.photoReads.length).toBeGreaterThan(readsBefore);
  await expectDecoded(photo(page.locator('main#main'), meName), 2);
  const replacementSource = await photo(ranking(page), meName).getAttribute('src');
  expect(replacementSource).not.toBe(originalSources[0]);
  await expect(photo(duel(page), meName)).toHaveAttribute('src', replacementSource ?? '');
  await expect.poll(() => pixel(photo(ranking(page), meName))).not.toEqual(originalPixel);
  await expect(photo(page.locator('main#main'), friendName)).toHaveCount(0);
  await expect(duel(page).getByText('BB', { exact: true })).toBeVisible();
  await expect(rankingRow(page, friendName).getByText('BB', { exact: true })).toBeVisible();
  await expectScores(page);

  await page.reload();
  await expectDecoded(photo(page.locator('main#main'), meName), 2);
  await expect.poll(() => pixel(photo(ranking(page), meName))).not.toEqual(originalPixel);
  await expect(photo(page.locator('main#main'), friendName)).toHaveCount(0);
  await expect(rankingRow(page, friendName).getByText('BB', { exact: true })).toBeVisible();
  await expectScores(page);
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('friends photos, names and scores fit a 320px mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const mock = await mockedFriends(page);
  await expectAllPhotos(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  for (const section of [duel(page), ranking(page)]) {
    expect(await section.evaluate(node => {
      const box = node.getBoundingClientRect();
      return Array.from(node.querySelectorAll('img')).every(image => {
        const imageBox = image.getBoundingClientRect();
        return imageBox.left >= box.left - 1 && imageBox.right <= box.right + 1;
      });
    })).toBe(true);
  }
  await page.locator('main#main').screenshot({ path: test.info().outputPath('friends-profile-photo-mobile-320.png'), animations: 'disabled' });
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});
