import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type ExamRecord} from '../../src/lib/domain/types';

const now = '2026-09-26T10:00:00.000Z';
const format = {code: 'TYT' as const, version: 1, label: 'TYT', total_questions: 120, wrong_divisor: 4, sections: []};
function exam(id: string, date: string, net: number): ExamRecord {
  return {id, name: id, publisher: 'Örnek Yayın', exam_date: date, format_code: 'TYT', format_version: 1,
    format_snapshot: format, duration_minutes: 120, notes: '', score: null, rank: null,
    source_document_id: null, import_metadata: null, results: [], reported_total_net: net,
    total_net: net, total_net_source: 'reported', revision: 1, created_at: now, updated_at: now};
}
async function openExams(page: Page, exams: ExamRecord[]) {
  await page.clock.setFixedTime(new Date(now));
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now, exams, exam_formats: [format]};
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {
    connected: false, date: '2026-09-26', timezone: 'Europe/Istanbul', events: [], refreshedAt: null,
  }}));
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Sınav Sonuçları', exact: true}).click();
}

test('monthly and detailed chart points reveal contextual data at their edges and by keyboard', async ({page}) => {
  await openExams(page, [exam('İlk TYT denemem', '2026-09-04', 64.25), exam('Son TYT denemem', '2026-09-26', 81.75)]);
  const monthly = page.locator('.monthly-exam-plot-desktop');
  const monthlyPoints = monthly.locator('[data-chart-point]');
  await monthlyPoints.first().hover({position: {x: 28, y: 18}});
  await expect(page.getByRole('tooltip')).toContainText('64,25 net');
  await expect(page.getByRole('tooltip')).toContainText('İlk TYT denemem');
  await expect(page.getByRole('tooltip')).toContainText('4 Eylül 2026');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  await monthlyPoints.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(monthlyPoints.last()).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('81,75 net');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  await page.getByRole('button', {name: 'Tüm analiz'}).click();
  const detailed = page.locator('.exam-plot-canvas');
  const dot = detailed.locator('.exam-plot-dot').last();
  await dot.scrollIntoViewIfNeeded();
  const bounds = (await dot.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - .5, bounds.y + bounds.height / 2);
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('81,75 net');
  await expect(tooltip).toContainText('Son TYT denemem');
  await expect(tooltip).toContainText('Örnek Yayın');
  const tooltipBox = (await tooltip.boundingBox())!;
  expect(tooltipBox.x).toBeGreaterThanOrEqual(12);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(page.viewportSize()!.width - 12);
  await detailed.locator('[data-chart-point]').last().focus();
  await page.keyboard.press('Home');
  await expect(detailed.locator('[data-chart-point]').first()).toBeFocused();
  await expect(tooltip).toContainText('64,25 net');
});

test('study bars show readable values on hover and focus without clipping the chart edge', async ({page}) => {
  await openExams(page, []);
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Çalışma İstatistikleri', exact: true}).click();
  const bar = page.locator('.study-time-card .stats-bar').last();
  await bar.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('0 dk');
  await expect(tooltip).toContainText('Toplam odaklanma süresi');
  const box = (await tooltip.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width - 12);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await bar.focus();
  await expect(tooltip).toContainText('Gün ayrıntıları için seç');
  await bar.click();
  await expect(tooltip).toHaveCount(0);
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
});

test.describe('touch chart details', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true});

  test('a single exam has a persistent readable tooltip that stays within the mobile viewport', async ({page}) => {
    await openExams(page, [exam('Eylül değerlendirme denemesi', '2026-09-26', 81.75)]);
    const monthlyPoint = page.locator('.monthly-exam-plot-mobile [data-chart-point]');
    await monthlyPoint.tap();
    await expect(page.getByRole('tooltip')).toContainText('81,75 net');
    await expect(page.getByRole('tooltip')).toContainText('Eylül değerlendirme denemesi');
    const box = (await page.getByRole('tooltip').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(12);
    expect(box.x + box.width).toBeLessThanOrEqual(378);
    expect(box.y).toBeGreaterThanOrEqual(12);
    expect(box.y + box.height).toBeLessThanOrEqual(832);

    await page.getByRole('button', {name: 'Tüm analiz'}).tap();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const point = page.locator('.exam-plot-canvas [data-chart-point]');
    await point.tap();
    await expect(page.getByRole('tooltip')).toContainText('81,75 net');
    const pointBox = (await point.boundingBox())!;
    const plotBox = (await page.locator('.exam-plot-canvas').boundingBox())!;
    expect(Math.abs(pointBox.x + pointBox.width / 2 - (plotBox.x + plotBox.width / 2))).toBeLessThan(1);
    await page.getByRole('heading', {name: 'Net gelişimi', exact: true}).tap();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
