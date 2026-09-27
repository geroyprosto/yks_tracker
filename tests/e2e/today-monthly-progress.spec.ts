import { expect, test } from '@playwright/test';
import { emptyState, type AppState, type ExamRecord } from '../../src/lib/domain/types';

const now = '2026-09-24T09:00:00.000Z';
const format = { code: 'TYT' as const, version: 1, label: 'TYT', total_questions: 120, wrong_divisor: 4, sections: [] };
function exam(id: string, date: string, net: number): ExamRecord {
  return { id, name: id, publisher: '', exam_date: date, format_code: 'TYT', format_version: 1,
    format_snapshot: format, duration_minutes: null, notes: '', score: null, rank: null,
    source_document_id: null, import_metadata: null, results: [], reported_total_net: net,
    total_net: net, total_net_source: 'reported', revision: 1, created_at: now, updated_at: now };
}

test('monthly progress lives in Exams and Today task actions still raise the rings', async ({ page }) => {
  await page.clock.setFixedTime(new Date(now));
  const initial: AppState = { ...emptyState(true), authenticated: true, server_now: now,
    tasks: [{ id: 'task-1', title: 'Paragraf', plan_date: '2026-09-24', exam: 'TYT', subject: 'Türkçe',
      topic_id: null, resource: '', completion_criteria: '', planned_minutes: 60, difficulty: 'medium',
      progress: 0, weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Soru çözümü',
      steps: [], revision: 1, created_at: now, updated_at: now }],
    exams: [exam('Ağustos denemesi', '2026-08-14', 32), exam('Eylül ilk', '2026-09-04', 40),
      exam('Eylül son', '2026-09-20', 52)] };
  const completed: AppState = { ...initial, tasks: [{ ...initial.tasks[0], progress: 1, revision: 2 }] };
  await page.route('**/api/state', route => route.fulfill({ json: initial }));
  await page.route('**/api/calendar/today', route => route.fulfill({ json: {
    connected: false, date: '2026-09-24', timezone: 'Europe/Istanbul', events: [], refreshedAt: null,
  } }));
  await page.route('**/api/command', route => route.fulfill({ json: { ok: true, state: completed } }));
  await page.goto('/');

  await expect(page.locator('.monthly-exam-chart-card')).toHaveCount(0);

  const firstRing = page.locator('.daily-card .neon-metric').first();
  await expect(firstRing.getByRole('img')).toHaveAttribute('aria-label', /%0/);
  await page.getByRole('button', { name: 'Paragraf görevini tamamla' }).click();
  await expect(firstRing.getByRole('img')).toHaveAttribute('aria-label', /%100/);
  await expect(firstRing.locator('.donut-segment')).toBeVisible();
  await expect(firstRing.locator('.donut-center strong')).toHaveText('%100');
  const transition = await firstRing.locator('.donut-segment').evaluate(node => getComputedStyle(node).transitionDuration);
  expect(transition).toContain('0.85s');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Sınav Sonuçları', exact: true}).click();
  const chart = page.locator('.monthly-exam-chart-card');
  await expect(chart.getByRole('heading', { name: 'Aylık deneme gelişimin' })).toBeVisible();
  const plot = chart.getByRole('img', { name: /net gelişimi/i });
  await expect(plot).toBeVisible();
  await expect(chart.locator('.monthly-exam-summary')).toContainText('52');
  await expect(plot).toContainText('NET');
  await expect(plot).toContainText('AYIN GÜNÜ');
  await chart.getByRole('button', { name: 'Önceki ay' }).click();
  await expect(chart.locator('.monthly-exam-summary')).toContainText('32');
  await chart.getByRole('button', { name: 'Sonraki ay' }).click();

  await chart.getByRole('button', {name: 'Tüm analiz'}).click();
  const detailed = page.getByRole('tabpanel', {name: 'Ayrıntılı analiz'});
  await expect(detailed.getByRole('heading', {name: 'Net gelişimi', exact: true})).toBeVisible();
  for (const name of ['Tür', 'Dönem', 'Gösterim']) {
    await expect(detailed.getByRole('combobox', {name, exact: true})).toBeVisible();
  }
  await page.getByRole('tab', {name: 'Aylık görünüm'}).click();
  await expect(chart.locator('.monthly-exam-summary')).toContainText('52');
  await page.setViewportSize({width: 390, height: 844});
  await expect(chart.getByRole('img', {name: /net gelişimi/i})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

