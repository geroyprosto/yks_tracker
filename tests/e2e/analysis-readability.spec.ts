import {expect, test} from '@playwright/test';
import {emptyState} from '../../src/lib/domain/types';

const now = '2026-10-01T09:00:00.000Z';
const variants = [
  ['graphite', 'black', 'dark'], ['rose', 'rose', 'dark'], ['ocean', 'ocean', 'dark'],
  ['aurora', 'white', 'light'], ['forest', 'black', 'dark'], ['burgundy', 'rose', 'dark'],
  ['plum', 'plum', 'dark'], ['pastel', 'pastel', 'dark'], ['steel', 'ocean', 'dark'],
  ['white', 'white', 'light'], ['black', 'black', 'dark'],
  ['rose light', 'rose', 'light'], ['ocean light', 'ocean', 'light'],
  ['plum light', 'plum', 'light'], ['pastel light', 'pastel', 'light'],
] as const;

function coaching() {
  return {
    schema_version: 1,
    context: {timezone: 'Europe/Istanbul', current_cutoff: now, current_analysis_id: null, cutoff_local_date: '2026-10-01',
      previous_cutoff: null, previous_analysis_id: null, week_start: '2026-09-28', week_end: '2026-10-04'},
    priority_summary: {high: {done: 1, total: 2, remaining: 1, rate_percent: 50},
      all: {done: 2, total: 3, remaining: 1, rate_percent: 66.7},
      by_subject: [{exam: 'TYT', subject: 'Matematik', done: 1, total: 2, remaining: 1, rate_percent: 50}],
      overdue: {high: 0, count: 0, task_ids: []}},
    study: {start: '2026-09-18', end: '2026-10-01', total_seconds: 3600, duration_label: '1 sa 0 dk', question_count: 20, test_count: 1},
    retrospective_changes: [],
    diary_insights: (['early_wake', 'stress', 'sleep', 'mood'] as const).map(kind => ({kind, type: 'observation', sufficient_data: false, matched_days: 1,
      group_a: {label: 'Erken', count: 1, average_seconds: 3600, average_label: '1 sa 0 dk'},
      group_b: {label: 'Geç', count: 0, average_seconds: null, average_label: '—'}, text: 'Kayıtlı gün için gözlem.'})),
    diary_observations: [{date: '2026-09-30', text: '07.00 kalkış kaydedildi.', study_label: '1 sa 0 dk'}],
    weekly_exam: {start: '2026-09-28', end: '2026-10-04', TYT: {exams: [{id: 'exam', date: '2026-09-30', name: 'TYT Deneme', total_net: 42.5,
      sections: [{key: 'matematik', label: 'Matematik', net: 12.5, question_count: 40}]}], warnings: ['Matematik alt dersini incele.']},
      AYT: {exams: [], warnings: []}},
    data_gaps: [],
    directions: [{title: 'TYT Matematik', text: 'Bu haftanın açık görevini tamamla.'},
      {title: 'AYT Kimya', text: 'Organik kimya konusuna başla.'},
      {title: 'TYT Türkçe', text: 'Paragraf yanlışlarını analiz et.'}],
  };
}

test('analiz metni mobilde okunur, konu vurguları ayrılır ve temalarda taşma olmaz', async ({page}) => {
  await page.setViewportSize({width: 360, height: 900});
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-10-01', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  await page.route('**/api/analysis', route => route.fulfill({json: {ok: true, configured: true, model: 'synthetic',
    limits: {monthly_requests: 4, monthly_usd: 2}, used: {requests: 1, estimated_cost_usd: 0},
    current_coaching: coaching(), current_repetition_results: [{status: 'created', title: 'Parabol', task_ids: ['review-1']}], reports: []}}));
  await page.goto('/');
  await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz'}).click();
  await expect(page.getByTestId('analysis-coaching')).toBeVisible();

  const measurements = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="analysis-coaching"]')!;
    const selectors = {
      subject: '[class*="subjectRow"]', direction: '[class*="directions"] p',
      repetition: '[class*="repetitionRows"] > [class*="repetitionRow"]',
      diary: '[data-testid="diary-early_wake"] p', observation: '[class*="diaryObservations"] p',
      exam: '[data-testid="weekly-exam-tyt"] [role="group"]',
      warning: '[class*="examWarnings"] p',
    };
    return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const element = root.querySelector(selector);
      return [name, element ? Number.parseFloat(getComputedStyle(element).fontSize) : null];
    }));
  });
  for (const [name, size] of Object.entries(measurements)) {
    expect(size, `${name} body text size`).not.toBeNull();
    expect(size!, `${name} body text should be at least 14px`).toBeGreaterThanOrEqual(14);
  }
  for (const heading of ['Öncelikli görevler', 'Gelişim ve yönlendirme', 'Tekrar görevlerine eklenenler', 'Günlüklerin ne söylüyor?', 'Bu haftanın TYT ve AYT netleri']) {
    const size = await page.getByRole('heading', {name: heading}).first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(size, `${heading} heading size`).toBeGreaterThanOrEqual(16);
  }

  for (const [label, theme, appearance] of variants) {
    const state = await page.evaluate(({theme, appearance}) => {
      const html = document.documentElement;
      html.dataset.theme = theme;
      html.dataset.appearance = appearance;
      const root = document.querySelector('[data-testid="analysis-coaching"]')!;
      const colors = [...root.querySelectorAll('[class*="directions"] li>div>strong')]
        .map(element => getComputedStyle(element).color);
      const diary = [...root.querySelectorAll('[data-testid^="diary-"]')].map(card => ({
        label: card.getAttribute('data-testid'), background: getComputedStyle(card).backgroundColor,
        ink: getComputedStyle(card.querySelector('strong')!).color,
      }));
      const style = getComputedStyle(html);
      return {overflow: html.scrollWidth > window.innerWidth, colors, diary,
        surface: style.getPropertyValue('--surface').trim(), foreground: style.getPropertyValue('--foreground').trim(),
        muted: style.getPropertyValue('--muted').trim(), primary: style.getPropertyValue('--primary').trim()};
    }, {theme, appearance});
    expect(state.overflow, `${label} horizontal overflow`).toBe(false);
    expect(new Set(state.colors).size, `${label} topic colors`).toBe(3);
    for (const color of ['foreground', 'muted', 'primary'] as const) {
      const contrast = contrastRatio(state[color], state.surface);
      expect(contrast, `${label} ${color} text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    for (const diary of state.diary) {
      const contrast = contrastRatio(diary.ink, diary.background);
      expect(contrast, `${label} ${diary.label} semantic text contrast`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

function contrastRatio(a: string, b: string) {
  const rgb = (color: string): number[] => {
    const value = color.trim();
    if (/^#[0-9a-f]{3}$/i.test(value)) return [...value.slice(1)].map(channel => Number.parseInt(channel + channel, 16));
    if (/^#[0-9a-f]{6}$/i.test(value)) return [0, 2, 4].map(index => Number.parseInt(value.slice(index + 1, index + 3), 16));
    const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (srgb) return srgb.slice(1, 4).map(channel => Number(channel) * 255);
    const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (rgb) return rgb.slice(1, 4).map(Number);
    throw new Error(`Unsupported CSS color: ${color}`);
  };
  const luminance = (color: string) => {
    const channels = rgb(color).map(channel => channel / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
