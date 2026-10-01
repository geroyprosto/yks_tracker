import {expect, test} from '@playwright/test';
import {emptyState, type AppState} from '../../src/lib/domain/types';

const now = '2026-10-01T09:00:00.000Z';
const diaryKinds = ['early_wake', 'stress', 'sleep', 'mood'] as const;
const diaryLabels = {early_wake: 'ERKEN KALKIŞ', stress: 'STRES', sleep: 'UYKU SÜRESİ', mood: 'RUH HÂLİ'};

function metrics() {
  return {
    schema_version: 1,
    context: {timezone: 'Europe/Istanbul', current_cutoff: now, current_analysis_id: null, cutoff_local_date: '2026-10-01',
      previous_cutoff: null, previous_analysis_id: null, week_start: '2026-09-28', week_end: '2026-10-04'},
    priority_summary: {
      high: {done: 5, total: 8, remaining: 3, rate_percent: 62.5},
      all: {done: 10, total: 20, remaining: 10, rate_percent: 50},
      by_subject: [
        {exam: 'AYT', subject: 'Matematik', done: 3, total: 3, remaining: 0, rate_percent: 100},
        {exam: 'TYT', subject: 'Matematik', done: 0, total: 1, remaining: 1, rate_percent: 0},
        {exam: 'TYT', subject: 'Türkçe', done: 1, total: 2, remaining: 1, rate_percent: 50},
        {exam: 'AYT', subject: 'Kimya', done: 1, total: 2, remaining: 1, rate_percent: 50},
      ],
      overdue: {high: 3, count: 4, task_ids: ['task-1', 'task-2', 'task-3', 'task-4']},
    },
    study: {start: '2026-09-18', end: '2026-10-01', total_seconds: 44817, duration_label: '12 sa 27 dk', question_count: 210, test_count: 15},
    retrospective_changes: [],
    diary_insights: diaryKinds.map(kind => ({kind, type: 'observation', sufficient_data: false, matched_days: 3,
      group_a: {label: 'Birinci grup', count: 2, average_seconds: 9000, average_label: '2 sa 30 dk'},
      group_b: {label: 'İkinci grup', count: 1, average_seconds: 3600, average_label: '1 sa 0 dk'},
      text: 'Üç kayıtlı gün için yalnız tarihli gözlem yapılabilir.'})),
    diary_observations: [{date: '2026-09-29', text: '10.08 kalkış, stres 5, enerji 1.', study_label: '2 sa 45 dk'}],
    weekly_exam: {start: '2026-09-28', end: '2026-10-04', TYT: {exams: [{id: 'exam-1', date: '2026-09-30', name: 'TYT Deneme 1', total_net: 57.5,
      sections: [{key: 'matematik', label: 'Matematik', net: 22.5, question_count: 40}, {key: 'cografya', label: 'Coğrafya', net: 0, question_count: 5}]}],
      warnings: ['Coğrafya alt dersinde net düşük; yanlışları incele.']}, AYT: {exams: [], warnings: []}},
    data_gaps: [],
    directions: [
      {title: 'TYT Matematik', text: 'Bu haftanın açık görevini tamamla.'},
      {title: 'Organik Kimya', text: 'Kaldığın konunun anlatımını bitir.'},
      {title: 'AYT Türev', text: 'Ön koşulları kontrol ederek başla.'},
      {title: 'Dördüncü öneri', text: 'Varsayılan görünümde olmamalı.'},
    ],
    homework_results: [{key: 'h1', topic_id: null, title: 'TYT Matematik soru çözümü', exam: 'TYT', subject: 'Matematik',
      plan_date: '2026-10-02', status: 'created', task_ids: ['task-5'], reason: 'Açık konu'}],
  };
}

for (const width of [360, 1280]) test(`çalışma analizi gerçek ölçütleri ve eski raporu ayırır · ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  await page.clock.setFixedTime(new Date(now));
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now};
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-10-01', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  let postCount = 0;
  await page.route('**/api/analysis', route => {
    if (route.request().method() === 'POST') postCount++;
    return route.fulfill({json: {
      ok: true, configured: true, model: 'synthetic', limits: {monthly_requests: 4, monthly_usd: 2},
      used: {requests: 1, estimated_cost_usd: 0}, current_coaching: metrics(),
      current_repetition_cutoff: '2026-09-30T12:00:00.000Z',
      current_repetition_results: [{series_id: 'series-1', topic_id: 'topic-1', title: 'Parabol', subject: 'Matematik', status: 'created',
        task_ids: ['review-1'], stages: [{stage: 0, plan_date: '2026-10-04', status: 'created', task_id: 'review-1'}]},
      {series_id: 'series-2', topic_id: 'topic-2', title: 'Solunum Sistemi', subject: 'Biyoloji', status: 'existing',
        task_ids: ['review-2'], stages: [{stage: 0, plan_date: '2026-10-04', status: 'created', task_id: 'review-2'}]}],
      reports: [{id: 'legacy-3', start_date: '2026-09-18', end_date: '2026-10-01', status: 'completed', body: null,
        created_at: now, stale: false, summary: {source_days: ['2026-09-30'], structured_report: {schema_version: 3,
          topics: {headline: 'Eski konu gözlemi', text: 'Bu eski raporda fonksiyonlar incelendi.'},
          regularity: {headline: 'Eski düzen', text: 'Eski çalışma kaydı.'}}}}],
    }});
  });

  await page.goto('/');
  if (width === 360) await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  await expect(page.getByRole('heading', {name: 'Çalışma Analizi'})).toBeVisible();
  const current = page.getByTestId('analysis-coaching').first();
  await expect(current).toContainText('Canlı durum');
  await expect(current.getByRole('heading', {name: 'Öncelikli görevler'})).toBeVisible();
  await expect(current).toContainText('%62,5');
  await expect(current).toContainText('5 / 8 tamamlandı');
  await expect(current).toContainText('3 açık');
  await expect(current).toContainText('3 gecikmiş yüksek öncelikli görev');
  await expect(current).toContainText('AYT Matematik');
  await expect(current).toContainText('TYT Matematik');
  await expect(current.getByRole('heading', {name: 'Gelişim ve yönlendirme'})).toBeVisible();
  await expect(current).toContainText('12 sa 27 dk');
  await expect(current).toContainText('210 soru');
  await expect(current).toContainText('15 test');
  await expect(current.locator('ol li')).toHaveCount(3);
  await expect(current).not.toContainText('Dördüncü öneri');
  await expect(current).not.toContainText('44817');
  await expect(current).toContainText('Parabol konusu tekrar görevlerine eklendi.');
  await expect(current).toContainText('30 Eylül 2026 analizinde');
  await expect(current).toContainText('Solunum Sistemi için mevcut tekrar görevleri Görevlerim’de.');
  await expect(current).not.toContainText('Solunum Sistemi konusu tekrar görevlerine eklendi.');
  await expect(current.getByRole('button', {name: 'Görevlerim’de gör'}).first()).toBeVisible();
  for (const kind of diaryKinds) {
    const card = current.getByTestId(`diary-${kind}`);
    await expect(card).toContainText(diaryLabels[kind]);
    await expect(card).toContainText('Şimdilik gözlem');
    await expect(card).not.toContainText('2 sa 30 dk');
  }
  await expect(current).toContainText('29 Eylül 2026');
  await expect(current).toContainText('10.08 kalkış, stres 5, enerji 1.');
  await expect(current.getByTestId('weekly-exam-tyt')).toContainText('Coğrafya alt dersinde net düşük');
  await expect(current).toContainText('Bu hafta kayıtlı deneme yok.');
  await expect(page.getByTestId('analysis-controls')).not.toHaveAttribute('open');
  await expect(page.getByTestId('report-card').first()).toHaveAttribute('open');
  await expect(page.getByTestId('report-card').first()).toContainText('Kaydedilmiş değerlendirme · eski rapor biçimi');
  await expect(page.getByRole('heading', {name: 'Kayıt düzeni'})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(postCount).toBe(0);

  if (width === 360) for (const theme of ['graphite', 'rose', 'ocean', 'aurora', 'forest', 'burgundy', 'plum', 'pastel', 'steel', 'white', 'black']) {
    await page.evaluate(value => {
      document.documentElement.dataset.theme = value;
      document.documentElement.dataset.appearance = value === 'white' ? 'light' : 'dark';
    }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme} horizontal overflow`).toBe(true);
    for (const kind of diaryKinds) await expect(current.getByTestId(`diary-${kind}`)).toBeVisible();
    if (theme === 'white' && process.env.CAPTURE_REPORT_SCREENSHOT === '1') await page.screenshot({path: 'artifacts/analysis-coaching-white-360.png', fullPage: true});
  }
  if (process.env.CAPTURE_REPORT_SCREENSHOT === '1') await page.screenshot({path: `artifacts/analysis-coaching-${width}.png`, fullPage: true});

  await current.getByRole('button', {name: 'Görevlerim’de gör'}).first().click();
  await expect(page.getByRole('heading', {name: 'Görevlerim'})).toBeVisible();
});

test('güncel ölçütler ile son kaydedilmiş koçluk yönlendirmesi ayrı tarihleriyle görünür', async ({page}) => {
  const latest = '2026-09-30T12:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-10-01', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  await page.route('**/api/analysis', route => route.fulfill({json: {
    ok: true, configured: true, model: 'synthetic', limits: {monthly_requests: 4, monthly_usd: 2},
    used: {requests: 1, estimated_cost_usd: 0},
    current_coaching: {...metrics(), directions: [{title: 'Canlı görev önerisi', text: 'Bugünün verisinden.'}]},
    current_repetition_results: [],
    reports: [{id: 'v4', start_date: '2026-09-17', end_date: '2026-09-30', status: 'completed', body: null, created_at: latest, stale: false,
      summary: {schema_version: 4, coaching: {...metrics(), context: {...metrics().context, current_cutoff: latest},
        directions: [{title: 'AI yönlendirmesi', text: 'Bu hafta TYT Matematikte açık görevi bitir.'}],
        journal_note: '30 Eylül kaydı çalışma süresiyle birlikte incelendi.',
        exam_note: 'Coğrafya netini ayrıca izle.'}}}],
  }}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  const current = page.getByTestId('analysis-coaching').first();
  await expect(current).toContainText('Canlı durum');
  await expect(current).toContainText('Veri kesimi: 1 Ekim 2026');
  await expect(current).toContainText('Yönlendirmeler son kaydedilmiş rapordan: 30 Eylül 2026');
  await expect(current).toContainText('AI yönlendirmesi');
  await expect(current).not.toContainText('Canlı görev önerisi');
  await expect(current).toContainText('30 Eylül kaydı çalışma süresiyle birlikte incelendi.');
  await expect(current).toContainText('Coğrafya netini ayrıca izle.');
});

test('çok sayıdaki gerçek tekrar kaydı özette görünür, uzun liste kapalı başlar', async ({page}) => {
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-10-01', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  const receipts = Array.from({length: 100}, (_, index) => ({series_id: `series-${index}`, topic_id: `topic-${index}`, title: `Konu ${index}`,
    subject: 'Matematik', status: 'created', task_ids: Array.from({length: index < 15 ? 4 : 5}, (_, stage) => `task-${index}-${stage}`)}));
  await page.route('**/api/analysis', route => route.fulfill({json: {ok: true, configured: true, model: 'synthetic',
    limits: {monthly_requests: 4, monthly_usd: 2}, used: {requests: 1, estimated_cost_usd: 0},
    current_coaching: metrics(), current_repetition_results: receipts, current_repetition_cutoff: now, reports: []}}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  const current = page.getByTestId('analysis-coaching');
  await expect(current).toContainText('100 konu · 485 görev');
  await expect(current.getByText('Konu 99 konusu tekrar görevlerine eklendi.')).toBeHidden();
  await current.getByText('96 konuyu daha göster').click();
  await expect(current.getByText('Konu 99 konusu tekrar görevlerine eklendi.')).toBeVisible();
});

test('haftalık net grafiği iki denemenin kayıtlı alt ders ortalamasını gösterir', async ({page}) => {
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-10-01', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  const current = metrics();
  current.weekly_exam.TYT.exams = [
    {id: 'exam-1', date: '2026-09-29', name: 'TYT İlk', total_net: 50,
      sections: [{key: 'matematik', label: 'Matematik', net: 10, question_count: 40},
        {key: 'cografya', label: 'Coğrafya', net: -2, question_count: 5}]},
    {id: 'exam-2', date: '2026-09-30', name: 'TYT Son', total_net: 80,
      sections: [{key: 'matematik', label: 'Matematik', net: 20, question_count: 40},
        {key: 'turkce', label: 'Türkçe', net: 40, question_count: 40}]},
  ];
  await page.route('**/api/analysis', route => route.fulfill({json: {ok: true, configured: true, model: 'synthetic',
    limits: {monthly_requests: 4, monthly_usd: 2}, used: {requests: 1, estimated_cost_usd: 0},
    current_coaching: current, current_repetition_results: [], reports: []}}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  const chart = page.getByTestId('weekly-exam-tyt');
  await expect(chart).toContainText('Haftalık ortalama');
  await expect(chart).toContainText('2 deneme · 2 toplam net kaydı');
  await expect(chart).toContainText('65 net');
  await expect(chart).not.toContainText('TYT Son');
  await expect(chart.getByRole('group', {name: 'Matematik: 15 net, 2 kayıt ortalaması'})).toBeVisible();
  await expect(chart.getByRole('group', {name: 'Coğrafya: -2 net, 1 kayıt ortalaması'})).toBeVisible();
  await expect(chart.getByRole('group', {name: 'Türkçe: 40 net, 1 kayıt ortalaması'})).toBeVisible();
});
