import { expect, test } from '@playwright/test';
import { emptyState, type AppState, type ExamRecord } from '../../src/lib/domain/types';
import { previewExamFormats } from '../../src/lib/exam-preview';

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
  for (const name of ['Tür', 'Ders', 'Dönem', 'Gösterim']) {
    await expect(detailed.getByRole('combobox', {name, exact: true})).toBeVisible();
  }
  await page.getByRole('tab', {name: 'Aylık görünüm'}).click();
  await expect(chart.locator('.monthly-exam-summary')).toContainText('52');
  await page.setViewportSize({width: 390, height: 844});
  await expect(chart.getByRole('img', {name: /net gelişimi/i})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('detailed analysis switches between TYT, AYT and total nets', async ({ page }) => {
  await page.clock.setFixedTime(new Date(now));
  const tyt = previewExamFormats.find(item => item.code === 'TYT')!;
  const ayt = previewExamFormats.find(item => item.code === 'AYT_SAYISAL')!;
  function subjectExam(id: string, date: string, turkce: number, matematik: number): ExamRecord {
    return {
      ...exam(id, date, turkce + matematik),
      format_snapshot: tyt,
      results: tyt.sections.map(section => ({
        section_key: section.key, correct: null, wrong: null, blank: null,
        net: section.key === 'turkce' ? turkce : section.key === 'matematik' ? matematik : 0,
      })),
      reported_total_net: null,
      total_net_source: 'sections',
    };
  }
  const initial: AppState = {
    ...emptyState(true), authenticated: true, server_now: now, exam_formats: [tyt, ayt],
    exams: [subjectExam('TYT ilk', '2026-09-10', 18, 24), subjectExam('TYT son', '2026-09-20', 22, 26), {
      ...exam('AYT son', '2026-09-19', 42), format_code: 'AYT_SAYISAL', format_snapshot: ayt,
      results: ayt.sections.map(section => ({section_key: section.key, correct: null, wrong: null, blank: null,
        net: section.key === 'matematik' ? 20 : section.key === 'fizik' ? 8 : 7})),
      reported_total_net: null, total_net_source: 'sections',
    }],
  };
  await page.route('**/api/state', route => route.fulfill({ json: initial }));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Sınav Sonuçları', exact: true}).click();
  await page.getByRole('tab', {name: 'Ayrıntılı analiz'}).click();

  const detailed = page.getByRole('tabpanel', {name: 'Ayrıntılı analiz'});
  const subject = detailed.getByRole('combobox', {name: 'Ders', exact: true});
  const summary = detailed.locator('.exam-chart-summary strong');
  const plotValues = detailed.getByRole('img', {name: /net grafiği/}).locator('.exam-plot-value');

  await subject.selectOption({label: 'Türkçe'});
  await expect(summary).toHaveText(['22', '+4', '2']);
  await expect(plotValues).toHaveText(['18', '22']);

  await subject.selectOption({label: 'Toplam net'});
  await expect(summary).toHaveText(['48', '+6', '2']);
  await expect(plotValues).toHaveText(['42', '48']);

  await detailed.getByRole('combobox', {name: 'Tür', exact: true}).selectOption('AYT_SAYISAL');
  await expect(subject).toHaveValue('total');
  await subject.selectOption({label: 'Fizik'});
  await expect(summary).toHaveText(['8', '—', '1']);
  await expect(plotValues).toHaveText(['8']);

  await page.setViewportSize({width: 1101, height: 800});
  const filters = detailed.locator('.exam-filters');
  expect(await filters.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
  await page.setViewportSize({width: 390, height: 844});
  await expect(subject).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('branch analysis keeps subjects with the same section key separate', async ({ page }) => {
  await page.clock.setFixedTime(new Date(now));
  const branch = previewExamFormats.find(item => item.code === 'BRANCH')!;
  function branchExam(id: string, date: string, subject: string, net: number): ExamRecord {
    return {
      ...exam(id, date, net), format_code: 'BRANCH',
      format_snapshot: {...branch, sections: [{key: 'branch', label: subject, question_count: 40}]},
      results: [{section_key: 'branch', correct: null, wrong: null, blank: null, net}],
      reported_total_net: null, total_net_source: 'sections',
    };
  }
  const initial: AppState = {
    ...emptyState(true), authenticated: true, server_now: now, exam_formats: [branch],
    exams: [branchExam('Matematik denemesi', '2026-09-10', 'Matematik', 31),
      branchExam('Fizik denemesi', '2026-09-20', 'Fizik', 12)],
  };
  await page.route('**/api/state', route => route.fulfill({ json: initial }));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Sınav Sonuçları', exact: true}).click();
  await page.getByRole('tab', {name: 'Ayrıntılı analiz'}).click();

  const detailed = page.getByRole('tabpanel', {name: 'Ayrıntılı analiz'});
  await detailed.getByRole('combobox', {name: 'Tür', exact: true}).selectOption('BRANCH');
  await detailed.getByRole('combobox', {name: 'Ders', exact: true}).selectOption({label: 'Matematik'});
  await expect(detailed.locator('.exam-chart-summary strong')).toHaveText(['31', '—', '1']);
  await expect(detailed.getByRole('img', {name: /net grafiği/}).locator('.exam-plot-value')).toHaveText(['31']);
});

