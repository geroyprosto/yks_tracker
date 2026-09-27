import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState, type Theme } from '../../src/lib/domain/types';

const now = '2026-09-24T09:00:00.000Z';
const stamp = '2026-09-24T08:00:00.000Z';
const themes: Array<{ id: Theme; name: string }> = [
  { id: 'rose', name: 'Mercan / Gül' }, { id: 'ocean', name: 'Okyanus' },
  { id: 'plum', name: 'Mürdüm / Krem' }, { id: 'pastel', name: 'Pastel' },
  { id: 'white', name: 'Beyaz' }, { id: 'black', name: 'Siyah' },
];
function visualState(): AppState {
  const state = { ...emptyState(true), authenticated: true, server_now: now };
  state.settings = { display_name: 'Görsel test', exam_year: 2027, exam_date: null, target_rank: null,
    timezone: 'Europe/Istanbul', daily_target_minutes: 180, task_share: .7,
    difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 }, weekday_targets: Array(7).fill(180),
    theme: 'ocean', appearance: 'dark', reduced_motion: false, simple_view: false, revision: 1 };
  const format = { code: 'TYT' as const, version: 1, label: 'TYT görsel örnek', total_questions: 80, wrong_divisor: 4,
    sections: [{ key: 'turkce', label: 'Türkçe', question_count: 40 }, { key: 'matematik', label: 'Matematik', question_count: 40 }] };
  state.exam_formats = [format];
  state.exams = [
    { id: 'visual-exam-1', name: 'Örnek TYT 1', publisher: 'Örnek yayın', exam_date: '2026-09-02', format_code: 'TYT',
      format_version: 1, format_snapshot: format, duration_minutes: 120, notes: '', score: 310.2, rank: 83000,
      source_document_id: null, import_metadata: null,
      results: [{ section_key: 'turkce', correct: 28, wrong: 8, blank: 4, net: 26 }, { section_key: 'matematik', correct: 16, wrong: 8, blank: 16, net: 14 }],
      reported_total_net: null, total_net: 40, total_net_source: 'sections', revision: 1, created_at: stamp, updated_at: stamp },
    { id: 'visual-exam-2', name: 'Örnek TYT 2', publisher: 'Örnek yayın', exam_date: '2026-09-24', format_code: 'TYT',
      format_version: 1, format_snapshot: format, duration_minutes: 110, notes: '', score: 322.4, rank: 74000,
      source_document_id: null, import_metadata: null,
      results: [{ section_key: 'turkce', correct: 30, wrong: 6, blank: 4, net: 28.5 }, { section_key: 'matematik', correct: 20, wrong: 5, blank: 15, net: 18.75 }],
      reported_total_net: null, total_net: 47.25, total_net_source: 'sections', revision: 1, created_at: stamp, updated_at: stamp },
  ];
  state.journal_entries = [{ id: 'visual-journal-1', journal_date: '2026-09-24',
    original_text: 'Bugün matematik denemesinde daha sakindim. Yanlışlarımı akşam tekrar edeceğim.',
    structured_fields: { mood: 'İyi', energy: 4, sleep_quality: 3 }, exclude_from_analysis: false,
    ai_shared_fields: [], revision: 1, created_at: stamp, updated_at: stamp }];
  state.sessions = [{ id: 'visual-session-1', title: 'Matematik tekrar', task_id: null, topic_id: null, subject: 'Matematik',
    study_type: 'Tekrar', mode: 'stopwatch', target_seconds: null, status: 'finished', started_at: '2026-09-24T06:00:00.000Z',
    active_since: null, accumulated_seconds: 4500, finished_at: '2026-09-24T07:15:00.000Z', revision: 1 }];
  state.intervals = [{ id: 'visual-interval-1', session_id: 'visual-session-1', started_at: '2026-09-24T06:00:00.000Z',
    ended_at: '2026-09-24T07:15:00.000Z' }];
  state.practice_entries = [{ id: 'visual-practice-1', practice_date: '2026-09-24', exam: 'TYT', subject: 'Matematik',
    question_count: 40, test_count: 2, revision: 1, created_at: stamp, updated_at: stamp }];
  return state;
}
async function navigate(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: label, exact: true }).click();
}
async function assertNoOverflow(page: Page, context: string) {
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    main: document.querySelector('main')?.scrollWidth ?? 0,
    mainClient: document.querySelector('main')?.clientWidth ?? 0 }));
  expect.soft(widths.document - widths.viewport, `${context}: document overflow ${JSON.stringify(widths)}`).toBeLessThanOrEqual(1);
  expect.soft(widths.main - widths.mainClient, `${context}: main overflow ${JSON.stringify(widths)}`).toBeLessThanOrEqual(1);
}

// Intentional visual QA test. All records are isolated HTTP mocks.
test('Phase 2 pages fit six themes at desktop and mobile widths', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push('page: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  const state = visualState();
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/analysis', route => route.fulfill({ json: { ok: true, configured: false, scheduler_ready: false, schedule: null, reports: [], limits: { monthly_requests: 0, monthly_usd: 0 }, used: { requests: 0, estimated_cost_usd: 0 } } }));
  await page.route('**/api/calendar/today', route => route.fulfill({ json: { connected: false, date: '2026-09-24', timezone: 'Europe/Istanbul', events: [], refreshedAt: null } }));
  await page.route('**/api/command', route => route.abort());
  await page.goto('/');
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
    for (const theme of themes) {
      await navigate(page, 'Ayarlar');
      await page.getByRole('button', { name: theme.name, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
      for (const [pageName, label, heading] of [
        ['exams', 'Sınav Sonuçları', 'Deneme sonuçların'],
        ['stats', 'Çalışma İstatistikleri', 'Odaklanma süresi grafiği'],
        ['journal', 'Günlüğüm', 'Bugünü kendi sözlerinle anlat.'],
      ] as const) {
        await navigate(page, label);
        await expect(page.getByRole('heading', { name: heading })).toBeVisible();
        await assertNoOverflow(page, `${theme.id}-${width}-${pageName}`);
        await page.screenshot({ path: `artifacts/phase2-qa/${theme.id}-${width}-${pageName}.png`, fullPage: true, animations: 'disabled' });
      }
    }
  }
  expect.soft(errors).toEqual([]);
});


