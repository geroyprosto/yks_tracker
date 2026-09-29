import {expect, test} from '@playwright/test';
import {emptyState, type AppState} from '../../src/lib/domain/types';

const insightKeys = ['topics', 'regularity', 'journal', 'wins', 'improvements', 'timing'] as const;
const sectionHeadings = {
  topics: 'Konu İlerlemesi',
  regularity: 'Çalışma Düzeni',
  journal: 'Günlükten Notlar',
  wins: 'Bu Haftanın Güçlü Yanları',
  improvements: 'İyileştirilecekler',
  timing: 'Döneme Göre Yol Haritası',
} as const;
const insightCopy = {
  topics: {headline: 'Matematikte iki konu ilerledi', text: 'Fonksiyonlar bitti, polinomlarda yeni testler çözüldü.'},
  regularity: {headline: 'Üç gün kayıtlı çalışma var', text: 'Kayıt bulunan günlerde çalışma süresi birbirine yakın.'},
  journal: {headline: 'Günlükte başlangıç saati değişti', text: 'Erken başladığın günlerde daha uzun oturumlar kaydedilmiş.'},
  wins: {headline: 'Geçen haftaya göre çalışma süresi arttı', text: 'Kayıtlı çalışma süresi önceki haftanın üstünde.'},
  improvements: {headline: 'Yanlış analizi için alan aç', text: 'Bir sonraki denemeden sonra hataları konuya göre ayır.'},
  timing: {headline: 'Eylül için alan çalışmasını sürdür', text: 'TYT tekrarını korurken AYT konu sorularını plana ekle.'},
} as const;
const chartEvidence = {
  topics: 'Tamamlanan', regularity: '45', journal: '/ 14 gün',
  wins: 'Bu dönem · 2 kayıtlı gün', improvements: '/ 4 görev', timing: 'Temel ve düzen',
} as const;

for (const width of [360, 1280]) {
  test(`altı rapor kartı yalnız açılan rapor ayrıntısında görünür · ${width}px`, async ({page}) => {
    const now = '2026-09-25T09:00:00.000Z';
    await page.setViewportSize({width, height: 900});
    await page.clock.setFixedTime(new Date(now));
    const state: AppState = {...emptyState(true), authenticated: true, server_now: now};
    await page.route('**/api/state', route => route.fulfill({json: state}));
    await page.route('**/api/calendar/today', route => route.fulfill({json: {
      connected: false, date: '2026-09-25', timezone: 'Europe/Istanbul', events: [], refreshedAt: null,
    }}));

    let postCount = 0;
    await page.route('**/api/analysis', route => {
      if (route.request().method() === 'POST') postCount++;
      return route.fulfill({json: {
        ok: true, configured: true, model: 'synthetic', scheduler_ready: false, schedule: null,
        limits: {monthly_requests: 4, monthly_usd: 2}, used: {requests: 1, estimated_cost_usd: 0},
        reports: [
          {
            id: 'six-insights', start_date: '2026-09-12', end_date: '2026-09-25',
            status: 'completed', body: 'Eski düz metin kullanılmamalı.', created_at: now, stale: false,
            summary: {
              schema_version: 3, record_count: 6, source_days: ['2026-09-24'],
              report_metrics: {
                topics: {completed: 1, progressed: 2},
                regularity: {days: [
                  {date: '2026-09-22', seconds: 2700, status: 'worked'},
                  {date: '2026-09-23', seconds: null, status: 'missing'},
                  {date: '2026-09-24', seconds: 3600, status: 'worked'},
                ]},
                journal: {shared_day_count: 2},
                wins: {current: {observed_days: 2, study_seconds: 6300}, previous: {observed_days: 1, study_seconds: 2400}},
                improvements: {task_done: 3, task_count: 4},
                timing: {month: 9, phase: 'Temel ve düzen', as_of: '2026-09-25'},
              },
              guidance_sources: [{title: 'MEB · YKS hazırlık programları', url: 'https://seben.meb.gov.tr/www/yks039ye-hazirlik-programlari-yks039ye-nasil-hazirlanmaliyim/icerik/503'}],
              guidance_as_of: '2026-09-25',
              structured_report: {
                schema_version: 3,
                ...Object.fromEntries(insightKeys.map(key => [key, {
                  ...insightCopy[key], evidence_ids: ['day:2026-09-24'], course_id: null,
                }])),
              },
            },
          },
          {
            id: 'historic-v2', start_date: '2026-08-29', end_date: '2026-09-11',
            status: 'completed', body: 'Tarihî düz metin kullanılmamalı.', created_at: now, stale: false,
            summary: {schema_version: 2, structured_report: {
              schema_version: 2, overview: 'Eski rapor özeti.',
              study_observations: [{text: 'Eski çalışma gözlemi.', evidence_ids: [], course_id: null}],
              result_observations: [], next_actions: [], limitations: ['Örnek sayısı az.'],
            }},
          },
        ],
      }});
    });

    await page.goto('/');
    if (width === 360) await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
    await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
    const reports = page.locator('details');
    await expect(reports).toHaveCount(2);
    const newReport = reports.nth(0);
    const historicReport = reports.nth(1);
    await expect(page.getByTestId(/^report-insight-/)).toHaveCount(6);
    await expect(newReport.getByTestId(/^report-insight-/)).toHaveCount(6);
    for (const key of insightKeys) await expect(newReport.getByTestId(`report-insight-${key}`)).toBeHidden();

    await newReport.locator('summary').click();
    for (const key of insightKeys) {
      const card = newReport.getByTestId(`report-insight-${key}`);
      await expect(card).toBeVisible();
      await expect(card.getByRole('heading', {name: sectionHeadings[key], exact: true})).toBeVisible();
      await expect(card).toContainText(insightCopy[key].headline);
      await expect(card).toContainText(insightCopy[key].text);
      const chart = card.getByTestId(`report-chart-${key}`);
      await expect(chart).toBeVisible();
      await expect(chart.locator('figcaption')).toHaveText(/\S/);
      await expect(chart).not.toContainText('Grafik için yeterli kayıt yok.');
      await expect(chart).toContainText(chartEvidence[key]);
    }
    await expect(newReport.getByTestId('report-insight-timing').getByRole('link', {name: 'MEB · YKS hazırlık programları'})).toBeVisible();
    await expect(historicReport.getByTestId(/^report-insight-/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 1280 && process.env.CAPTURE_REPORT_SCREENSHOT === '1') {
      await page.screenshot({path: 'artifacts/analysis-six-insights-review.png', fullPage: true});
    }

    await newReport.locator('summary').click();
    for (const key of insightKeys) await expect(newReport.getByTestId(`report-insight-${key}`)).toBeHidden();
    await historicReport.locator('summary').click();
    await expect(historicReport.getByRole('heading', {name: 'Genel Durum', exact: true})).toBeVisible();
    await expect(historicReport).toContainText('Eski çalışma gözlemi.');
    expect(postCount).toBe(0);
  });
}
