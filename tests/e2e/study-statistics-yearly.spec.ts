import {expect, test} from '@playwright/test';
import {emptyState, type AppState, type StudySession} from '../../src/lib/domain/types';

const now = '2026-09-24T10:00:00.000Z';
function session(id: string, start: string, seconds: number): StudySession {
  return {id, title: id, task_id: null, topic_id: null, subject: 'Matematik', study_type: 'Tekrar',
    mode: 'stopwatch', target_seconds: null, status: 'finished', started_at: start,
    active_since: null, accumulated_seconds: seconds,
    finished_at: new Date(Date.parse(start) + seconds * 1000).toISOString(), revision: 1};
}

test('study analysis groups months into weeks and years into months with total-based averages', async ({page}) => {
  await page.clock.setFixedTime(new Date(now));
  const work = [
    session('old', '2023-06-08T09:00:00.000Z', 7200),
    session('past-year', '2025-11-08T09:00:00.000Z', 3600),
    session('february', '2026-02-14T09:00:00.000Z', 3600),
    session('september', '2026-09-23T09:00:00.000Z', 7200),
    session('today', '2026-09-24T06:00:00.000Z', 10800),
  ];
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now,
    sessions: work, intervals: work.map(item => ({id: 'interval-' + item.id, session_id: item.id,
      started_at: item.started_at, ended_at: item.finished_at!})),
  };
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {
    connected: false, date: '2026-09-24', timezone: 'Europe/Istanbul', events: [], refreshedAt: null,
  }}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Çalışma İstatistikleri'}).click();
  const periods = page.getByRole('group', {name: 'İstatistik dönemi'});
  const time = page.locator('.study-time-card');
  await expect(page.locator('.study-stat-metric')).toHaveCount(6);
  await expect(page.locator('.study-stat-metric').filter({hasText: 'Toplam odaklanma süresi'})).toContainText('9 sa 0 dk');
  await expect(page.locator('.study-stat-metric').filter({hasText: 'Bugünün odaklanma süresi'})).toContainText('3 sa 0 dk');
  await expect(page.getByText('Kayıtlı gün ortalaması', {exact: true})).toHaveCount(0);

  await periods.getByRole('button', {name: '1 ay', exact: true}).click();
  await expect(time.locator('.stats-bar')).toHaveCount(4);
  await expect(time.locator('.study-trend-badge')).toHaveText('Haftalık toplamlar');
  await expect(time.locator('.study-trend-total')).toContainText('5 sa 0 dk');
  await expect(time.locator('.study-trend-summary')).toContainText('1 sa 15 dk');
  await expect(page.locator('.study-distribution-card .donut-center strong')).toHaveText('5 sa 0 dk');
  await page.getByRole('combobox', {name: 'Dağılım ölçütü'}).selectOption('studyTypes');
  await expect(page.locator('.study-distribution-card .distribution-legend')).toContainText('Tekrar');

  await periods.getByRole('button', {name: '1 yıl', exact: true}).click();
  await expect(time.locator('.stats-bar')).toHaveCount(9);
  await expect(time.locator('.study-trend-badge')).toHaveText('Aylık toplamlar');
  await expect(time.locator('.study-trend-total')).toContainText('6 sa 0 dk');
  await expect(time.locator('.study-trend-summary')).toContainText('40 dk');
  await time.locator('.stats-bar').last().click();
  await expect(periods.getByRole('button', {name: '1 ay', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(time.locator('.stats-bar')).toHaveCount(4);

  await periods.getByRole('button', {name: '1 yıl', exact: true}).click();
  await page.getByRole('button', {name: 'Önceki yıl', exact: true}).click();
  await expect(page.locator('.study-stats-period-nav strong')).toHaveText('2025');
  await expect(time.locator('.stats-bar')).toHaveCount(12);
  await expect(time.locator('.study-trend-total')).toContainText('1 sa 0 dk');

  await periods.getByRole('button', {name: 'Tümü', exact: true}).click();
  await expect(time.locator('.stats-bar')).toHaveCount(4);
  await expect(time.locator('.study-trend-badge')).toHaveText('Yıllık toplamlar');
  await expect(time.locator('.study-trend-summary')).toContainText('2 sa 15 dk');

  await page.setViewportSize({width: 390, height: 844});
  for (const label of ['1 ay', '1 yıl']) {
    await periods.getByRole('button', {name: label, exact: true}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await time.locator('.stats-chart-body').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
});

