import {expect, test} from '@playwright/test';
import {emptyState, type AppState} from '../../src/lib/domain/types';

test('rapor isteği, eski kaydın okunması ve kaynak güne geçiş', async ({page}) => {
  const now = '2026-09-25T09:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now};
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-09-25', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/analysis', route => {
    if (route.request().method() === 'POST') requests.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({json: {
      ok: true, configured: true, model: 'synthetic', scheduler_ready: false, schedule: null,
      limits: {monthly_requests: 4, monthly_usd: 2}, used: {requests: requests.length, estimated_cost_usd: 0},
      reports: requests.length ? [{id: 'report-1', start_date: '2026-09-12', end_date: '2026-09-25', status: 'completed',
        body: '2026-09-24 günü 40 dakika çalıştın.', created_at: now, stale: false,
        summary: {source_days: ['2026-09-24'], data_days: 1, missing_days: 13}}] : [],
    }});
  });

  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  await expect(page.getByRole('heading', {name: 'Çalışma Analizi'})).toBeVisible();
  const controls = page.getByTestId('analysis-controls');
  await controls.locator('summary').click();
  await expect(controls.getByLabel('Rapor dönemi')).toHaveValue('14');
  await controls.getByRole('button', {name: 'Rapor oluştur'}).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({action: 'report', start_date: '2026-09-12', end_date: '2026-09-25'});
  const report = page.getByTestId('report-card').first();
  await expect(report).toHaveAttribute('open');
  await expect(report).toContainText('Kaydedilmiş değerlendirme · eski rapor biçimi');
  await report.getByRole('button', {name: '24 Eylül 2026'}).first().click();
  await expect(page.getByRole('heading', {name: 'Çalışma İstatistikleri'})).toBeVisible();
  await expect(page.locator('.study-day-detail')).toContainText('24 Eylül');
});

test('kaydedilmiş eski V2 rapor yeni koçluk ölçütü gibi gösterilmez', async ({page}) => {
  const now = '2026-09-25T09:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-09-25', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  await page.route('**/api/analysis', route => route.fulfill({json: {ok: true, configured: true, model: 'synthetic',
    limits: {monthly_requests: 4, monthly_usd: 2}, used: {requests: 1, estimated_cost_usd: 0},
    reports: [{id: 'v2', start_date: '2026-09-12', end_date: '2026-09-25', status: 'completed', body: null, created_at: now, stale: false,
      summary: {structured_report: {schema_version: 2, overview: 'Eski rapor özeti.',
        study_observations: [{text: 'Geçmiş çalışma gözlemi.'}], result_observations: [],
        next_actions: [{text: 'O tarihte önerilen görev.'}], limitations: []}}}]}}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  await expect(page.getByTestId('analysis-coaching')).toHaveCount(0);
  await expect(page.getByText('Güncel koçluk ölçütleri henüz hazır değil.')).toBeVisible();
  await expect(page.getByTestId('report-card').first()).toHaveAttribute('open');
  await expect(page.getByTestId('report-card').first()).toContainText('Eski rapor özeti.');
  await expect(page.getByTestId('report-card').first()).toContainText('Geçmiş çalışma gözlemi.');
});
