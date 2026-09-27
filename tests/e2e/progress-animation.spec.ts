import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState } from '../../src/lib/domain/types';
import { localDate } from '../../src/lib/ui';

async function taskProgressPage(page: Page, initialProgress = .2) {
  const day = localDate();
  const timestamp = new Date().toISOString();
  const state: AppState = { ...emptyState(true), authenticated: true, server_now: timestamp };
  state.settings = {
    display_name: 'Animasyon testi', exam_year: 2027, exam_date: null, target_rank: null,
    timezone: 'Europe/Istanbul', daily_target_minutes: 180, task_share: .7,
    difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 },
    weekday_targets: Array(7).fill(180), theme: 'ocean', appearance: 'dark',
    reduced_motion: false, simple_view: false, revision: 1,
  };
  state.tasks = [{
    id: 'synthetic-animation-task', title: 'Sentetik ilerleme görevi', plan_date: day,
    exam: 'TYT', subject: 'Matematik', topic_id: null, resource: '', completion_criteria: '',
    planned_minutes: 45, difficulty: 'easy', progress: initialProgress, weight_override: null,
    priority: 'normal', position: 0, notes: '', study_type: 'Tekrar', steps: [],
    revision: 1, created_at: timestamp, updated_at: timestamp,
  }];
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/command', async route => {
    const body = route.request().postDataJSON() as { type: string; payload: { progress?: number } };
    expect(body.type).toBe('task.update');
    state.tasks[0].progress = body.payload.progress ?? 0;
    state.tasks[0].revision++;
    await route.fulfill({ json: { ok: true, state } });
  });
  await page.goto('/');
  const ring = page.getByRole('img', { name: 'Görevler: %' + Math.round(initialProgress * 100) });
  await expect(ring).toBeVisible();
  return page.locator('.neon-metric').filter({ has: page.getByRole('heading', { name: 'Görevler' }) });
}

async function dashLength(page: Page) {
  return page.locator('.neon-metric').filter({ has: page.getByRole('heading', { name: 'Görevler' }) })
    .locator('.donut-segment').evaluate(node => parseFloat(getComputedStyle(node).strokeDasharray));
}

test('completing a task visibly grows the ring through intermediate frames', async ({ page }) => {
  const metric = await taskProgressPage(page);
  const before = await dashLength(page);
  await page.getByRole('button', { name: 'Sentetik ilerleme görevi görevini tamamla' }).click();
  await expect(metric.getByRole('img', { name: 'Görevler: %100' })).toBeVisible();
  await page.waitForTimeout(150);
  const middle = await dashLength(page);
  const center = await metric.locator('.donut-center strong').textContent();
  expect(middle).toBeGreaterThan(before + 8);
  expect(middle).toBeLessThan(420);
  expect(Number(center?.replace('%', ''))).toBeGreaterThan(20);
  expect(Number(center?.replace('%', ''))).toBeLessThan(100);
  await expect.poll(() => dashLength(page)).toBeGreaterThan(438);
  await expect(metric.locator('.donut-center strong')).toHaveText('%100');
});

test('reduced motion jumps to the completed state without a ring transition', async ({ page }) => {
  const metric = await taskProgressPage(page);
  await page.evaluate(() => { document.documentElement.dataset.reduced = 'true'; });
  await page.getByRole('button', { name: 'Sentetik ilerleme görevi görevini tamamla' }).click();
  await expect(metric.getByRole('img', { name: 'Görevler: %100' })).toBeVisible();
  await expect.poll(() => dashLength(page)).toBeGreaterThan(438);
  await expect(metric.locator('.donut-segment')).toHaveCSS('transition-duration', '0s');
  await expect(metric.locator('.donut-center strong')).toHaveText('%100');
});

test('an initially empty ring grows when the first task is completed and does not replay on a plain refresh', async ({ page }) => {
  const metric = await taskProgressPage(page, 0);
  await expect(metric.locator('.donut-segment')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sentetik ilerleme görevi görevini tamamla' }).click();
  await expect(metric.getByRole('img', { name: 'Görevler: %100' })).toBeVisible();
  await expect(metric.locator('.donut-segment')).toHaveCount(1);
  await page.waitForTimeout(150);
  const middle = await dashLength(page);
  expect(middle).toBeGreaterThan(8);
  expect(middle).toBeLessThan(420);
  await expect.poll(() => dashLength(page)).toBeGreaterThan(438);
  await page.waitForTimeout(950);
  const refreshed = page.waitForResponse('**/api/state');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  const activeAnimations = await metric.locator('.donut-segment').evaluate(node => node.getAnimations().length);
  expect(activeAnimations).toBe(0);
});
