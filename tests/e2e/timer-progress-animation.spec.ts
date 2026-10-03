import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState } from '../../src/lib/domain/types';

function metric(page: Page, heading: string) {
  return page.locator('.neon-metric').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
}

async function dashLength(page: Page, heading: string) {
  return metric(page, heading).locator('.donut-segment')
    .evaluate(node => parseFloat(getComputedStyle(node).strokeDasharray));
}

test('finishing a study timer grows the time ring while only task and time rings remain', async ({ page }) => {
  const finishedAt = new Date('2026-09-24T09:00:00.000Z');
  const startedAt = new Date(finishedAt.getTime() - 45 * 60_000);
  await page.clock.setFixedTime(finishedAt);
  const state: AppState = {
    ...emptyState(true), authenticated: true, server_now: finishedAt.toISOString(),
  };
  state.settings = {
    display_name: 'Sayaç animasyonu testi', exam_year: 2027, exam_date: null, target_rank: null,
    timezone: 'Europe/Istanbul', daily_target_minutes: 180, task_share: .7,
    difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 },
    weekday_targets: Array(7).fill(180), theme: 'ocean', appearance: 'dark',
    reduced_motion: false, simple_view: false, revision: 1,
  };
  state.sessions = [{
    id: 'synthetic-timer-animation', title: 'Sentetik 45 dakika çalışma',
    task_id: null, topic_id: null, subject: 'Matematik', study_type: 'Tekrar',
    mode: 'stopwatch', target_seconds: null, status: 'running',
    started_at: startedAt.toISOString(), active_since: startedAt.toISOString(),
    accumulated_seconds: 0, finished_at: null, revision: 1,
  }];
  // The intercepted finish response supplies the newly saved interval. No real database is touched.
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/command', async route => {
    const request = route.request().postDataJSON() as {
      type: string; payload: { id: string; expected_revision: number };
    };
    expect(request).toMatchObject({
      type: 'timer.finish',
      payload: { id: 'synthetic-timer-animation', expected_revision: 1 },
    });
    state.sessions[0] = {
      ...state.sessions[0], status: 'finished', active_since: null,
      accumulated_seconds: 45 * 60, finished_at: finishedAt.toISOString(), revision: 2,
    };
    state.intervals = [{
      id: 'synthetic-timer-interval', session_id: 'synthetic-timer-animation',
      started_at: startedAt.toISOString(), ended_at: finishedAt.toISOString(),
    }];
    await route.fulfill({ json: { ok: true, state } });
  });

  await page.goto('/');
  const time = metric(page, 'Net çalışma süresi');
  await expect(page.locator('.daily-card .neon-metric')).toHaveCount(2);
  await expect(metric(page, 'Görevler').getByRole('img', { name: 'Görevler: tanımlı değil' })).toBeVisible();
  await expect(metric(page, 'Günlük ilerleme')).toHaveCount(0);
  await expect(time.getByRole('img', { name: 'Net çalışma süresi: %0' })).toBeVisible();
  await expect(time.locator('.donut-segment')).toHaveCount(0);

  await page.getByRole('button', { name: 'Sayaç — çalışma sayacını aç', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Çalışma sayacı' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Bitir ve kaydet', exact: true }).click();

  await expect(time.getByRole('img', { name: 'Net çalışma süresi: %25' })).toBeVisible();
  await expect(time.locator('.donut-segment')).toHaveCount(1);
  await page.waitForTimeout(150);
  const timeMiddle = await dashLength(page, 'Net çalışma süresi');
  expect(timeMiddle).toBeGreaterThan(5);
  expect(timeMiddle).toBeLessThan(100);
  // Rounded ring caps reserve part of the arc, so a quarter ring draws about 82 units.
  await expect.poll(() => dashLength(page, 'Net çalışma süresi')).toBeGreaterThan(81);
  await expect(time.locator('.donut-center strong')).toHaveText('%25');
  await expect(metric(page, 'Günlük ilerleme')).toHaveCount(0);
});
