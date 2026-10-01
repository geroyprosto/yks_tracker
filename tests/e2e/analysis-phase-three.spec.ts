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
  await expect(report).not.toHaveAttribute('open');
  await report.locator('summary').click();
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
  await expect(page.getByTestId('report-card').first()).not.toHaveAttribute('open');
  await page.getByTestId('report-card').first().locator('summary').click();
  await expect(page.getByTestId('report-card').first()).toContainText('Eski rapor özeti.');
  await expect(page.getByTestId('report-card').first()).toContainText('Geçmiş çalışma gözlemi.');
  await expect(page.getByTestId('report-card').first()).not.toContainText('O tarihte önerilen görev.');
});

test('eski rapor gözlemleri saklı başlar; ham saniye dönüştürülür ve eski koçluk emirleri gösterilmez', async ({page}) => {
  const now = '2026-10-01T09:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-10-01', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  await page.route('**/api/analysis', route => route.fulfill({json: {ok: true, configured: true, model: 'synthetic',
    limits: {monthly_requests: 4, monthly_usd: 2}, used: {requests: 1, estimated_cost_usd: 0},
    reports: [
      {id: 'v3', start_date: '2026-09-18', end_date: '2026-10-01', status: 'completed',
        body: 'Konu ilerlemesi: her gün 20 soru çöz. 44.817 saniye.', created_at: now, stale: false,
        summary: {structured_report: {schema_version: 3,
          topics: {headline: 'Konu İlerlemesi', text: 'Bugün 20 soru çöz.'},
          regularity: {headline: 'Kayıt Düzeni', text: 'Hemen çalışma düzeni kur.'},
          journal: {headline: 'Günlük gözlemi', text: '30 Eylül günlüğü kaydedildi.'},
          wins: {headline: 'Çalışma gözlemi', text: 'Bu dönemde 44.817 saniye çalışıldı.'},
          improvements: {headline: 'İyileştirilecekler', text: 'Her gün 20 soru çöz.'},
          timing: {headline: 'Döneme Göre Yol Haritası', text: 'Aralık ayında bitmeli.'}}}},
      {id: 'v1', start_date: '2026-09-04', end_date: '2026-09-17', status: 'completed',
        body: '44.817 saniye çalışıldı.\nHer gün 20 soru çöz.', created_at: '2026-09-18T09:00:00.000Z', stale: false, summary: {}},
    ]}}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  const reports = page.getByTestId('report-card');
  await expect(reports).toHaveCount(2);
  await expect(reports.nth(0)).not.toHaveAttribute('open');
  await expect(reports.nth(1)).not.toHaveAttribute('open');
  await reports.nth(0).locator('summary').click();
  await expect(reports.nth(0)).toContainText('Günlük gözlemi');
  await expect(reports.nth(0)).toContainText('12 sa 27 dk');
  for (const removed of ['Konu İlerlemesi', 'Kayıt Düzeni', 'İyileştirilecekler', 'Döneme Göre Yol Haritası', '20 soru', '44.817 saniye'])
    await expect(reports.nth(0)).not.toContainText(removed);
  await reports.nth(1).locator('summary').click();
  await expect(reports.nth(1)).toContainText('12 sa 27 dk çalışıldı.');
  await expect(reports.nth(1)).not.toContainText('44.817 saniye');
  await expect(reports.nth(1)).not.toContainText('20 soru');
});
