import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState} from '../../src/lib/domain/types';

const day = '2026-10-15';
const now = day + 'T18:00:00.000Z';

function rhythmState(target = 360, withEntries = true): AppState {
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now};
  state.settings = {
    display_name: 'Ritim testi', exam_year: 2027, exam_date: null, target_rank: null,
    timezone: 'Europe/Istanbul', daily_target_minutes: target, task_share: .7,
    difficulty_factors: {easy: 1, medium: 1.25, hard: 1.5}, weekday_targets: Array(7).fill(target),
    theme: 'ocean', appearance: 'dark', reduced_motion: true, simple_view: false, revision: 1,
  };
  state.manual_study_entries = withEntries ? [
    {id: 'rhythm-yesterday', study_date: '2026-10-14', subject: 'TYT Matematik', duration_seconds: 364 * 60, created_at: now},
    {id: 'rhythm-today', study_date: day, subject: 'TYT Fizik', duration_seconds: 47 * 60, created_at: now},
  ] : [];
  return state;
}

async function openRhythm(page: Page, state = rhythmState()) {
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
  await expect(page.getByRole('heading', {name: 'Çalışma ritmin', exact: true})).toBeVisible();
  return () => writes;
}

test('weekly rhythm shows hour levels, the daily goal, and accurate durations at every screen size', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1800});
  const writes = await openRhythm(page);
  const rhythm = page.locator('.today-rhythm-card');
  await expect(rhythm.locator('.rhythm-axis [data-hours]')).toHaveText(['0 sa', '2 sa', '4 sa', '6 sa', '8 sa']);
  await expect(rhythm.locator('.rhythm-goal-line')).toHaveCSS('bottom', '180px');
  await expect(rhythm.locator('.bar-value')).toHaveText(['—', '—', '—', '—', '—', '6 sa 4 dk', '47 dk']);

  const today = rhythm.locator('.day-bar.current');
  await rhythm.locator('.rhythm-scroll').focus();
  for (let index = 0; index < 7; index++) await page.keyboard.press('Tab');
  await expect(today).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('47 dk');
  await expect(page.getByRole('tooltip')).toContainText('Bugün');
  await page.keyboard.press('Escape');

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height: 1000});
    await expect(today.locator('.bar-track')).toHaveCSS('height', '240px');
    const ratio = await today.locator('.bar-track').evaluate(track => {
      const fill = track.firstElementChild;
      if (!fill) throw new Error('Missing study-time bar fill');
      return fill.getBoundingClientRect().height / track.getBoundingClientRect().height;
    });
    expect(ratio, `${width}px: 47 minutes on an eight-hour scale`).toBeCloseTo(47 / 480, 2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width}px: page has no horizontal overflow`).toBeLessThanOrEqual(1);
  }
  expect(writes()).toBe(0);
});

test('an empty week with no target keeps a usable scale without a goal line', async ({page}) => {
  const writes = await openRhythm(page, rhythmState(0, false));
  const rhythm = page.locator('.today-rhythm-card');
  await expect(rhythm.locator('.rhythm-goal-line')).toHaveCount(0);
  await expect(rhythm.locator('.bar-value')).toHaveText(Array(7).fill('—'));
  const levels = await rhythm.locator('.rhythm-axis [data-hours]').evaluateAll(nodes =>
    nodes.map(node => Number(node.getAttribute('data-hours'))));
  expect(levels.length).toBeGreaterThan(1);
  expect(levels.every(Number.isFinite)).toBe(true);
  expect(Math.max(...levels)).toBeGreaterThan(0);
  expect(writes()).toBe(0);
});
