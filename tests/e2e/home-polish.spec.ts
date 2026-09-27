import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState} from '../../src/lib/domain/types';

const day = '2026-09-24';
const now = day + 'T09:00:00.000Z';

function homeState(progress = [0, .5, 1]): AppState {
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now};
  state.settings = {
    display_name: 'ipek ışık', exam_year: 2027, exam_date: null, target_rank: null,
    timezone: 'Europe/Istanbul', daily_target_minutes: 180, task_share: .7,
    difficulty_factors: {easy: 1, medium: 1.25, hard: 1.5}, weekday_targets: Array(7).fill(180),
    theme: 'ocean', appearance: 'dark', reduced_motion: true, simple_view: false, revision: 1,
  };
  state.tasks = progress.map((value, index) => ({
    id: `home-task-${index}`, title: ['Matematik tekrarı', 'Türkçe çalışması', 'Fizik soruları'][index],
    plan_date: day, exam: 'TYT', subject: ['Matematik', 'Türkçe', 'Fizik'][index], topic_id: null,
    resource: '', completion_criteria: '', planned_minutes: 40, difficulty: 'easy', progress: value,
    weight_override: null, priority: 'normal', position: index, notes: '', study_type: 'Tekrar',
    steps: [], revision: 1, created_at: now, updated_at: now,
  }));
  return state;
}

async function openHome(page: Page, state = homeState()) {
  let writes = 0;
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {
    connected: false, date: day, timezone: 'Europe/Istanbul', events: [], refreshedAt: null,
  }}));
  await page.route('**/api/analysis', route => route.fulfill({json: {reports: []}}));
  await page.route('**/api/classroom/session', route => route.fulfill({json: {account: null}}));
  await page.route('**/api/command', async route => {
    writes++;
    await route.abort();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Merhaba, ipek ışık.', exact: true})).toBeVisible();
  return () => writes;
}

test('home task filters show pending, completed, and all tasks without changing records', async ({page}) => {
  const writes = await openHome(page);
  const card = page.locator('.tasks-summary-card');
  const filters = card.getByRole('group', {name: 'Bugünün görevlerini filtrele'});
  const titles = card.locator('.task-line strong');
  await expect(titles).toHaveText(['Matematik tekrarı', 'Türkçe çalışması', 'Fizik soruları']);

  await filters.getByRole('button', {name: /^Bekleyen/}).click();
  await expect(filters.getByRole('button', {name: /^Bekleyen/})).toHaveAttribute('aria-pressed', 'true');
  await expect(titles).toHaveText(['Matematik tekrarı', 'Türkçe çalışması']);

  await filters.getByRole('button', {name: /^Tamamlanan/}).click();
  await expect(titles).toHaveText(['Fizik soruları']);
  await filters.getByRole('button', {name: /^Tümü/}).click();
  await expect(titles).toHaveCount(3);
  expect(writes()).toBe(0);
});

test('home task filters explain an empty completed view and return to the plan', async ({page}) => {
  const writes = await openHome(page, homeState([0, .5]));
  const card = page.locator('.tasks-summary-card');
  const filters = card.getByRole('group', {name: 'Bugünün görevlerini filtrele'});
  await filters.getByRole('button', {name: /^Tamamlanan/}).click();
  await expect(card.getByText('Tamamladığın görevler burada görünecek.')).toBeVisible();
  await expect(card.locator('.task-line')).toHaveCount(0);
  await filters.getByRole('button', {name: /^Tümü/}).click();
  await expect(card.locator('.task-line')).toHaveCount(2);
  expect(writes()).toBe(0);
});

test('empty focus card keeps an accessible timer in the wider desktop layout', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await openHome(page);
  const focus = page.locator('.focus-card');
  for (const text of ['Odak oturumu', 'Odak sayacı', 'Bir süre ayır, odaklan.', 'Bir görev seç veya serbest çalışmaya başla.']) {
    await expect(focus).not.toContainText(text);
  }
  await expect(focus.getByRole('timer')).toHaveAttribute('aria-label', /00:00.*Başlamaya hazır/);
  await expect(focus.getByRole('button', {name: 'Sayaç — çalışma sayacını aç'})).toBeVisible();

  const focusBox = await focus.boundingBox();
  expect(focusBox?.width).toBeGreaterThanOrEqual(360);
  const rings = page.locator('.daily-card .neon-donut');
  await expect(rings).toHaveCount(2);
  for (const ring of await rings.all()) {
    const box = await ring.boundingBox();
    expect(box?.width).toBe(240);
  }
});
test('profile initials and greeting use the saved student name with Turkish casing', async ({page}) => {
  await openHome(page);
  await expect(page.locator('.profile-button strong')).toHaveText('ipek ışık');
  await expect(page.locator('.avatar')).toHaveText(['İI', 'İI']);
});

test('an unset exam date keeps the countdown card and opens plan settings', async ({page}) => {
  const writes = await openHome(page);
  const countdown = page.locator('.yks-countdown-card');
  await expect(countdown.getByRole('heading', {name: 'Sınava kalan zaman'})).toBeVisible();
  await expect(countdown.locator('.countdown-value')).toHaveText(['--', '--', '--', '--']);
  await expect(countdown.getByRole('timer')).toBeVisible();
  await countdown.getByRole('button', {name: 'Sınav tarihini ayarla'}).click();
  await expect(page.getByRole('button', {name: 'Plan ve hedefler', exact: true})).toHaveClass(/active/);
  await expect(page.locator('input[name="exam_date"]')).toBeVisible();
  expect(writes()).toBe(0);
});
