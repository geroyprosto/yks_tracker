import { expect, test, type Page } from '@playwright/test';
import type { FriendScore } from '../../src/components/friends-workspace';
import { emptyState, type AppState } from '../../src/lib/domain/types';

// All API requests are intercepted. No study, profile or friendship rows are
// read from or written to a real account.
const meId = '10000000-0000-4000-8000-000000000001';
const friendId = '10000000-0000-4000-8000-000000000002';
const thirdId = '10000000-0000-4000-8000-000000000003';
const groupId = '10000000-0000-4000-8000-000000000004';
const meName = 'Ada Deniz';
const friendName = 'Bora Bilge';
const thirdName = 'Ceren Can';
const names = [meName, friendName, thirdName];

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

async function mockedFriends(page: Page) {
  const mock = {
    friendsReads: [] as string[],
    friends: friendsResponse(),
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
    if (path === '/api/state') return route.fulfill({ json: state() });
    if (path === '/api/calendar/today') return route.fulfill({ json: { connected: false, events: [], refreshedAt: null } });
    if (path === '/api/friends') {
      mock.friendsReads.push(request.url());
      return route.fulfill({ json: mock.friends });
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
const rankingRow = (page: Page, name: string) => ranking(page).getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

async function expectInitialsAndScores(page: Page, myDuration = '2 sa') {
  for (const [index, name] of names.entries()) {
    const row = rankingRow(page, name);
    await expect(row).toBeVisible();
    await expect(row.locator(`[aria-label="${index + 1}. sıra"]`)).toBeVisible();
    await expect(row).toContainText('30 soru · 2 test · 1 görev');
    await expect(row.getByText(['AD', 'BB', 'CC'][index], { exact: true })).toBeVisible();
  }
  await expect(rankingRow(page, meName)).toContainText('Sen');
  await expect(duel(page)).toContainText(meName);
  await expect(duel(page)).toContainText(friendName);
  await expect(duel(page).getByText('AD', { exact: true })).toBeVisible();
  await expect(duel(page).getByText('BB', { exact: true })).toBeVisible();
  await expect(duel(page).locator('[aria-label="Lider"]')).toBeVisible();
  await expect(duel(page).locator('img')).toHaveCount(0);
  await expect(ranking(page).locator('img')).toHaveCount(0);
  await expect(rankingRow(page, meName)).toContainText(myDuration);
  await expect(rankingRow(page, friendName)).toContainText('1 sa 30 dk');
  await expect(rankingRow(page, thirdName)).toContainText('1 sa');
}

test('friends keep initials and scores on refresh, re-entry and reload without photo requests', async ({ page }) => {
  await page.clock.install();
  const mock = await mockedFriends(page);
  await expectInitialsAndScores(page);
  expect(mock.friendsReads).toHaveLength(1);
  await page.clock.fastForward(180_000);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.fastForward(180_000);
  expect(mock.friendsReads).toHaveLength(1);

  mock.friends.me.today_seconds = 10_800;
  await page.getByRole('button', { name: 'Skorları yenile', exact: true }).click();
  await expect.poll(() => mock.friendsReads.length).toBe(2);
  await expectInitialsAndScores(page, '3 sa');
  const navigation = page.getByRole('navigation', { name: 'Ana gezinme', exact: true });
  await navigation.getByRole('button', { name: 'Görevlerim', exact: true }).click();
  await expect(page.locator('main#main')).toHaveAttribute('data-page', 'tasks');
  await page.clock.fastForward(180_000);
  expect(mock.friendsReads).toHaveLength(2);
  await navigation.getByRole('button', { name: 'Arkadaşlar', exact: true }).click();
  await expect.poll(() => mock.friendsReads.length).toBe(3);
  await expectInitialsAndScores(page, '3 sa');

  await page.reload();
  await expectInitialsAndScores(page, '3 sa');
  // Preserve the refresh cancellation regression while exercising the same
  // initials-only flow: leaving the page must abort an outstanding score read.
  let releaseRead: (() => void) | undefined;
  const heldRead = new Promise<void>(resolve => { releaseRead = resolve; });
  await page.route('**/api/friends?*', async route => {
    await heldRead;
    await route.fulfill({ json: mock.friends });
  });
  const pendingRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/friends');
  await page.getByRole('button', { name: 'Skorları yenile', exact: true }).click();
  const request = await pendingRead;
  const aborted = page.waitForEvent('requestfailed', failed => failed === request);
  try {
    await navigation.getByRole('button', { name: 'Görevlerim', exact: true }).click();
    expect((await aborted).failure()?.errorText).toMatch(/ABORTED/);
    await expect(page.locator('main#main')).toHaveAttribute('data-page', 'tasks');
  } finally {
    releaseRead?.();
  }
  expect(mock.photoRequests).toEqual([]);
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('friends initials, names and scores fit mobile and refresh without photo requests', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const mock = await mockedFriends(page);
  await expectInitialsAndScores(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Skorları yenile', exact: true }).click();
  await expect.poll(() => mock.friendsReads.length).toBe(2);
  await expectInitialsAndScores(page);
  expect(mock.photoRequests).toEqual([]);
  expect(mock.unexpectedWrites).toEqual([]);
  expect(mock.errors).toEqual([]);
});
