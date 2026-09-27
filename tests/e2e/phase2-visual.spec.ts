import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState, type Theme } from '../../src/lib/domain/types';
import type { ImportDocument } from '../../src/lib/exam-import/types';

const now = '2026-09-24T09:00:00.000Z';
const stamp = '2026-09-24T08:00:00.000Z';
const themes: Array<{ id: Theme; name: string }> = [
  { id: 'rose', name: 'Mercan / Gül' }, { id: 'ocean', name: 'Okyanus' },
  { id: 'plum', name: 'Mürdüm / Krem' }, { id: 'pastel', name: 'Pastel' },
  { id: 'white', name: 'Beyaz' }, { id: 'black', name: 'Siyah' },
];
const importDocument: ImportDocument = {
  id: 'visual-pdf-1', original_filename: 'ornek-sonuc.pdf', sha256: 'mock-hash', page_count: 2,
  extraction_status: 'needs_visual_review', visual_extraction_status: 'provider_not_configured', committed_candidate_indexes: [], created_at: now,
  candidates: [{ index: 0, label: 'TYT aday sonucu', student_label: 'Örnek öğrenci', format_code: 'TYT',
    exam_date: '2026-09-24', name: 'Örnek TYT denemesi', publisher: 'Örnek yayın', source_pages: [1, 2],
    reported_total_net: 52.5, reported_total_source: { source_page: 2, raw: 'Toplam net 52,5', uncertain: false },
    warnings: ['Matematik neti kaynak PDF ile karşılaştır.'],
    results: [{ section_key: 'turkce', correct: 30, wrong: 5, blank: 5, source_page: 1, raw: 'Türkçe D30 Y5 B5', uncertain: false },
      { section_key: 'matematik', correct: 20, wrong: 6, blank: 14, source_page: 2, raw: 'Matematik D20 Y6 B14', uncertain: true }],
  }],
};
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

// Intentional visual QA test. All records and PDF drafts are isolated HTTP mocks.
test('Phase 2 pages and PDF review fit six themes at desktop and mobile widths', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push('page: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  const state = visualState();
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/analysis', route => route.fulfill({ json: { ok: true, configured: false, scheduler_ready: false, schedule: null, reports: [], limits: { monthly_requests: 0, monthly_usd: 0 }, used: { requests: 0, estimated_cost_usd: 0 } } }));
  await page.route('**/api/calendar/today', route => route.fulfill({ json: { connected: false, date: '2026-09-24', timezone: 'Europe/Istanbul', events: [], refreshedAt: null } }));
  await page.route('**/api/exam-import/drafts', route => route.fulfill({ json: { documents: [importDocument] } }));
  await page.route('**/api/command', route => route.abort());
  await page.goto('/');
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
    for (const theme of themes) {
      await navigate(page, 'Ayarlar');
      await page.getByRole('button', { name: theme.name, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
      for (const [pageName, label, heading] of [
        ['exams', 'Sınav Sonuçları', 'Denemelerini birlikte oku.'],
        ['stats', 'Çalışma İstatistikleri', 'Odaklanma süresi grafiği'],
        ['journal', 'Günlüğüm', 'Bugünü kendi sözlerinle anlat.'],
      ] as const) {
        await navigate(page, label);
        await expect(page.getByRole('heading', { name: heading })).toBeVisible();
        await assertNoOverflow(page, `${theme.id}-${width}-${pageName}`);
        await page.screenshot({ path: `artifacts/phase2-qa/${theme.id}-${width}-${pageName}.png`, fullPage: true, animations: 'disabled' });
      }
      await navigate(page, 'Sınav Sonuçları');
      await page.getByRole('button', { name: 'PDF yükle' }).click();
      const modal = page.getByRole('dialog', { name: "PDF'den deneme incele" });
      await expect(modal).toBeVisible();
      await expect(modal.getByRole('checkbox', { name: /Taranmış sonuç sayfalarını görsel olarak oku/ })).toHaveCount(0);
      await expect(modal.getByText('Taranmış sayfalar için ücretli görsel okuma pilotta kapalıdır.',{exact:false})).toBeVisible();
      await modal.getByRole('button', { name: /ornek-sonuc\.pdf/ }).click();
      await expect(modal.getByText('Çıkarılan bilgileri kontrol et')).toBeVisible();
      await expect(modal.getByText('Matematik neti kaynak PDF ile karşılaştır.')).toBeVisible();
      await assertNoOverflow(page, `${theme.id}-${width}-pdf`);
      const modalWidth = await modal.evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth }));
      expect.soft(modalWidth.scroll - modalWidth.client, `${theme.id}-${width}-pdf modal overflow`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `artifacts/phase2-qa/${theme.id}-${width}-pdf.png`, fullPage: true, animations: 'disabled' });
      if ((theme.id === 'white' && width === 1440) || (theme.id === 'rose' && width === 360)) {
        await page.screenshot({ path: `artifacts/phase2-qa/${theme.id}-${width}-pdf-viewport.png`, animations: 'disabled' });
      }
      const bounds = await modal.boundingBox();
      const viewport = page.viewportSize();
      expect(bounds).not.toBeNull();
      expect(viewport).not.toBeNull();
      if (bounds && viewport) {
        expect.soft(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2), `${theme.id}-${width}-pdf centered horizontally`).toBeLessThanOrEqual(2);
        expect.soft(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2), `${theme.id}-${width}-pdf centered vertically`).toBeLessThanOrEqual(2);
      }
      await modal.getByRole('button', { name: 'Pencereyi kapat' }).click();
    }
  }
  expect.soft(errors).toEqual([]);
});


