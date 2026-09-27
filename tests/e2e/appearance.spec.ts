import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState } from '../../src/lib/domain/types';
import { localDate } from '../../src/lib/ui';

// These records exist only inside intercepted HTTP responses in isolated browser
// contexts. They are never seeded into the application or sent to its database.
function syntheticAppearanceState(): AppState {
  const day = localDate();
  const stamp = day + 'T09:00:00.000Z';
  const state = { ...emptyState(true), authenticated: true, server_now: stamp };
  state.settings = { display_name: 'Sentetik görsel test', exam_year: 2027, exam_date: null, target_rank: null, timezone: 'Europe/Istanbul', daily_target_minutes: 180, task_share: .7, difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 }, weekday_targets: Array(7).fill(180), theme: 'ocean', appearance: 'dark', reduced_motion: false, simple_view: false, revision: 1 };
  state.tasks = [1, .8, .3].map((progress, index) => ({ id: 'synthetic-appearance-task-' + index, title: ['Sentetik test · Matematik tekrarı', 'Sentetik test · Türkçe çalışması', 'Sentetik test · Konu pekiştirme'][index], plan_date: day, exam: 'TYT', subject: index === 1 ? 'Türkçe' : 'Matematik', topic_id: null, resource: '', completion_criteria: '', planned_minutes: 60, difficulty: 'easy', progress, weight_override: null, priority: 'normal', position: index, notes: '', study_type: 'Tekrar', steps: [], revision: 1, created_at: stamp, updated_at: stamp }));
  state.sessions = [54, 36].map((minutes, index) => ({ id: 'synthetic-appearance-session-' + index, title: 'Sentetik test oturumu ' + index, task_id: state.tasks[index].id, topic_id: null, subject: state.tasks[index].subject, study_type: 'Tekrar', mode: 'stopwatch', target_seconds: null, status: 'finished', started_at: day + 'T07:00:00.000Z', active_since: null, accumulated_seconds: minutes * 60, finished_at: new Date(Date.parse(day + 'T07:00:00.000Z') + minutes * 60_000).toISOString(), revision: 1 }));
  state.intervals = state.sessions.map(session => ({ id: 'synthetic-interval-' + session.id, session_id: session.id, started_at: session.started_at, ended_at: session.finished_at }));
  return state;
}
async function mockedAppearance(page: Page) {
  const state = syntheticAppearanceState();
  await page.clock.setFixedTime(new Date(state.server_now));
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/command', () => { throw new Error('Appearance checks must not write any records'); });
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Görevler: %70', exact: true })).toBeVisible();
  await expect(page.getByText('Örnek grafik önizlemesi açık.')).toHaveCount(0);
}
async function navigate(page: Page, label: string) {
  const mobile = (page.viewportSize()?.width ?? 1440) <= 760;
  const mobileButton = page.getByRole('navigation', {name: 'Mobil gezinme'}).getByRole('button', {name: label, exact: true});
  if (mobile && await mobileButton.count()) {
    await mobileButton.click();
    return;
  }
  if (mobile) await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: label, exact: true}).click();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function snapshot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'artifacts/gradient-cards-' + name + '.png', fullPage: true, animations: 'disabled' });
}

test('sample charts appear by default, toggle off restores real empty data, and no writes occur', async ({ page, request }) => {
  let commandRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/command')) commandRequests++; });
  const response = await request.get('/api/state');
  const state = await response.json();
  expect(state).toMatchObject({ configured: false, authenticated: false, tasks: [], sessions: [], intervals: [], topics: [] });
  await page.goto('/');
  await expect(page.getByText('Örnek grafik önizlemesi açık.')).toBeVisible();
  const hideExamples = page.getByRole('button', { name: 'Gerçek boş görünümü göster' });
  await expect(hideExamples).toHaveAttribute('aria-pressed', 'true');
  const values = (await page.locator('.daily-card .donut-center strong').allTextContents()).map(value => Number(value.replace('%', '')));
  expect(values).toHaveLength(2);
  expect(values.some(value => value > 0 && value < 100)).toBe(true);

  expect((await page.locator('.bar-value').allTextContents()).some(value => value !== '—')).toBe(true);
  expect(await page.locator('.tasks-summary-card .check-button').count()).toBeGreaterThan(0);
  await expect(page.locator('.tasks-summary-card .check-button:not(:disabled)')).toHaveCount(0);
  await noOverflow(page);
  await snapshot(page, 'sample-preview-ocean-desktop');
  await expect(page.locator('.distribution-card')).toHaveCount(0);
  await navigate(page, 'Çalışma İstatistikleri');
  await page.getByRole('group', {name: 'İstatistik dönemi'}).getByRole('button', {name: 'Bugün', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Zamanını nasıl paylaştın?'})).toBeVisible();
  await expect(page.locator('.distribution-card .donut-segment')).not.toHaveCount(0);
  await expect(page.locator('.distribution-legend li')).not.toHaveCount(0);
  await navigate(page, 'Bugün');

  await hideExamples.click();
  await expect(page.getByText('Örnek grafik önizlemesi kapalı.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bugün için temiz bir sayfa' })).toBeVisible();

  await expect(page.locator('.daily-card .donut-segment')).toHaveCount(0);
  expect(await page.locator('.bar-value').allTextContents()).toEqual(Array(7).fill('—'));
  await noOverflow(page);
  await snapshot(page, 'real-empty-ocean');
  await navigate(page, 'Çalışma İstatistikleri');
  await page.getByRole('group', {name: 'İstatistik dönemi'}).getByRole('button', {name: 'Bugün', exact: true}).click();
  await expect(page.getByRole('img', {name: 'Seçili dönemde çalışma kaydı yok.'})).toBeVisible();
  await expect(page.locator('.distribution-card .donut-segment')).toHaveCount(0);
  await expect(page.locator('.distribution-legend')).toHaveCount(0);
  await navigate(page, 'Bugün');
  expect((await (await request.get('/api/state')).json()).tasks).toEqual([]);
  expect(commandRequests).toBe(0);

  await page.reload();
  await expect(page.getByText('Örnek grafik önizlemesi kapalı.')).toBeVisible();
  await page.getByRole('button', { name: 'Örnekleri göster' }).click();
  await expect(page.locator('.daily-card .donut-segment')).not.toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page);
  await snapshot(page, 'sample-preview-ocean-mobile');
  expect(commandRequests).toBe(0);
});

test('synthetic HTTP preview shows enlarged accessible rings without the daily footer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockedAppearance(page);
  const dailyCard = page.locator('.daily-card');
  await expect(dailyCard.locator('.neon-metric')).toHaveCount(2);
  await expect(dailyCard.getByRole('img', {name: 'Görevler: %70', exact: true})).toBeVisible();
  await expect(dailyCard.getByRole('img', {name: 'Net çalışma süresi: %50', exact: true})).toBeVisible();
  await expect(dailyCard.locator('.card-bottom, .ring-legend')).toHaveCount(0);
  await expect(dailyCard.getByRole('button', {name: /Hesaplama ayrıntıları|Hedefi düzenle/})).toHaveCount(0);
  const donuts = dailyCard.locator('.neon-donut');
  await expect(donuts).toHaveCount(2);
  await expect(donuts.nth(0)).toHaveCSS('width', '240px');
  await expect(donuts.nth(1)).toHaveCSS('width', '240px');

  await expect(page.locator('.donut-segment').first()).toHaveCSS('stroke-width', '28px');
  await expect(page.locator('.donut-center strong').first()).toHaveCSS('text-shadow', 'none');
  await noOverflow(page);
  await snapshot(page, 'synthetic-ocean-desktop');
  await page.locator('.daily-card').screenshot({ path: 'artifacts/gradient-cards-synthetic-ocean-desktop-daily-crop.png', animations: 'disabled' });
  await navigate(page, 'Çalışma İstatistikleri');
  await page.getByRole('group', {name: 'İstatistik dönemi'}).getByRole('button', {name: 'Bugün', exact: true}).click();
  await expect(page.locator('.distribution-legend li').filter({hasText: 'Matematik'})).toContainText('%60');
  await expect(page.locator('.distribution-legend li').filter({hasText: 'Türkçe'})).toContainText('%40');
  await expect(page.locator('.distribution-card .donut-center strong')).toHaveText('1 sa 30 dk');
  await noOverflow(page);
  await page.setViewportSize({width: 360, height: 800});
  await noOverflow(page);
  await page.locator('.distribution-card').screenshot({path: 'artifacts/gradient-cards-synthetic-ocean-mobile-distribution-crop.png', animations: 'disabled'});
  await navigate(page, 'Bugün');
  await noOverflow(page);
  const mobileDonuts = await donuts.evaluateAll(nodes => nodes.map(node => ({
    width: node.getBoundingClientRect().width,
    available: node.parentElement!.getBoundingClientRect().width,
  })));
  expect(mobileDonuts.every(({width, available}) => width > 0 && width <= available + 1 && width <= 225)).toBe(true);
  const metrics = await page.locator('.neon-metric').evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth })));
  expect(metrics.every(metric => metric.scrollWidth <= metric.width + 1)).toBe(true);
  await snapshot(page, 'synthetic-ocean-mobile');
  await page.setViewportSize({width: 760, height: 800});
  await expect(donuts.nth(0)).toHaveCSS('width', '225px');
  await expect(donuts.nth(1)).toHaveCSS('width', '225px');
  await noOverflow(page);

  expect(errors).toEqual([]);
});

async function themeColors(page: Page) {
  return page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgb = (token: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css.getPropertyValue(token).trim();
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => channel / 255);
    };
    const luminance = (token: string) => {
      const channels = rgb(token).map(channel => channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4));
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const contrast = (a: string, b: string) => {
      const first = luminance(a), second = luminance(b);
      return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
    };
    const hue = (token: string) => {
      const [r, g, b] = rgb(token), max = Math.max(r, g, b), min = Math.min(r, g, b), range = max - min;
      if (range === 0) return 0;
      const value = max === r ? (g - b) / range : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
      return (value * 60 + 360) % 360;
    };
    const distance = Math.abs(hue('--ring-1') - hue('--ring-2'));
    return {
      background: rgb('--background'),
      contrasts: {
        foregroundOnCard: contrast('--foreground', '--surface'),
        secondaryOnCard: contrast('--muted', '--surface'),
        foregroundOnCanvas: contrast('--foreground', '--background'),
        secondaryOnCanvas: contrast('--muted', '--background'),
      },
      ringHues: [hue('--ring-1'), hue('--ring-2')],
      ringHueDistance: Math.min(distance, 360 - distance),
    };
  });
}

test('all four color families keep readable text against their calm surfaces', async ({ page }) => {
  await mockedAppearance(page);
  await navigate(page, 'Ayarlar');
  const themes = ['Mercan / Gül', 'Okyanus', 'Mürdüm / Krem', 'Pastel'];
  await expect(page.locator('.theme-card')).toHaveCount(6);
  for (const appearance of ['Koyu', 'Açık']) {
    await page.getByRole('button', { name: appearance, exact: true }).click();
    for (const theme of themes) {
      await page.getByRole('button', { name: theme, exact: true }).click();
      const colors = await themeColors(page);
      for (const [label, contrast] of Object.entries(colors.contrasts)) {
        expect(contrast, theme + ' ' + appearance + ' ' + label).toBeGreaterThanOrEqual(4.5);
      }
      await noOverflow(page);
    }
  }
});

test('rose uses distinct pink and green accents in thick segmented rings on desktop and mobile', async ({ page }) => {
  await mockedAppearance(page);
  for (const appearance of ['Açık', 'Koyu']) {
    await navigate(page, 'Ayarlar');
    await page.getByRole('button', { name: 'Mercan / Gül', exact: true }).click();
    await page.getByRole('button', { name: appearance, exact: true }).click();
    const colors = await themeColors(page);
    expect(colors.ringHues[0], 'pink family primary ring').toBeGreaterThan(300);
    expect(colors.ringHues[1], 'green family contrasting ring').toBeGreaterThan(70);
    expect(colors.ringHues[1], 'green family contrasting ring').toBeLessThan(185);
    expect(colors.ringHueDistance).toBeGreaterThan(100);
    await navigate(page, 'Bugün');
    await noOverflow(page);
    const name = 'synthetic-rose-' + (appearance === 'Açık' ? 'light' : 'dark');
    await snapshot(page, name + '-desktop');
    await page.locator('.daily-card').screenshot({ path: 'artifacts/gradient-cards-' + name + '-daily-crop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await snapshot(page, name + '-mobile');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});

test('white and black have fixed bases without changing stored appearance', async ({ page }) => {
  await mockedAppearance(page);
  for (const theme of [{ name: 'Beyaz', id: 'white' }, { name: 'Siyah', id: 'black' }]) {
    const backgrounds: number[][] = [];
    for (const appearance of ['Açık', 'Koyu']) {
      await navigate(page, 'Ayarlar');
      await page.getByRole('button', { name: 'Okyanus', exact: true }).click();
      await page.getByRole('button', { name: appearance, exact: true }).click();
      await page.getByRole('button', { name: theme.name, exact: true }).click();
      await expect(page.getByRole('button', { name: 'Açık', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Koyu', exact: true })).toHaveCount(0);
      const colors = await themeColors(page);
      backgrounds.push(colors.background);
      expect(await page.evaluate(() => localStorage.getItem('yksim-appearance'))).toBe(appearance === 'Açık' ? 'light' : 'dark');
      for (const [label, contrast] of Object.entries(colors.contrasts)) {
        expect(contrast, theme.name + ' ' + label).toBeGreaterThanOrEqual(4.5);
      }
      await navigate(page, 'Bugün');
      await noOverflow(page);
    }
    expect(backgrounds[0]).toEqual(backgrounds[1]);
    expect(Math.max(...backgrounds[0]) - Math.min(...backgrounds[0]), theme.name + ' neutral canvas').toBeLessThan(.06);
    if (theme.id !== 'black') expect(Math.min(...backgrounds[0])).toBeGreaterThan(.9);
    else expect(Math.max(...backgrounds[0])).toBeLessThan(.1);
    await snapshot(page, 'synthetic-' + theme.id + '-desktop');
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await snapshot(page, 'synthetic-' + theme.id + '-mobile');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});


test('YKS countdown labels its preview, ticks live, opens date settings, and clears with preview', async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  expect(state).toMatchObject({ configured: false, authenticated: false });
  await page.clock.install({ time: new Date() });
  await page.goto('/');
  const countdown = page.locator('.yks-countdown-card');
  await expect(countdown).toBeVisible();
  await expect(countdown.locator('.countdown-meta')).toContainText('Örnek tarih');
  await expect(countdown.locator('.countdown-unit')).toHaveCount(4);
  await expect(countdown.locator('.countdown-value').first()).not.toHaveText('--');
  const remaining = async () => {
    const parts = (await countdown.locator('.countdown-value').allTextContents()).map(Number);
    expect(parts).toHaveLength(4);
    expect(parts.every(Number.isFinite)).toBe(true);
    return ((parts[0] * 24 + parts[1]) * 60 + parts[2]) * 60 + parts[3];
  };
  const before = await remaining();
  await countdown.screenshot({ path: 'artifacts/yks-countdown-preview-ocean.png', animations: 'disabled' });
  await page.clock.fastForward(2_000);
  await expect.poll(remaining).toBeLessThan(before);
  await noOverflow(page);

  await countdown.getByRole('button', { name: 'Sınav tarihini ayarla' }).click();
  await expect(page.getByRole('button', { name: 'Plan ve hedefler', exact: true })).toHaveClass(/active/);
  await expect(page.locator('input[name="exam_date"]')).toBeVisible();
  await navigate(page, 'Bugün');
  await page.getByRole('button', { name: 'Gerçek boş görünümü göster' }).click();
  await expect(countdown.getByRole('heading', {name: 'Sınava kalan zaman'})).toBeVisible();
  await expect(countdown.locator('.countdown-value')).toHaveText(['--', '--', '--', '--']);
  await expect(countdown.getByRole('button', {name: 'Sınav tarihini ayarla'})).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page);
  await countdown.screenshot({ path: 'artifacts/yks-countdown-no-date-mobile.png', animations: 'disabled' });
});

test('YKS countdown uses the saved exam date and follows all six theme gradients', async ({ page }) => {
  const state = syntheticAppearanceState();
  state.settings!.exam_year = 2026;
  state.settings!.exam_date = '2026-10-01';
  await page.clock.install({ time: new Date('2026-09-24T09:00:00.000Z') });
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/command', () => { throw new Error('Countdown appearance checks must not write any records'); });
  await page.goto('/');
  const countdown = page.locator('.yks-countdown-card');
  await expect(countdown.locator('.countdown-meta')).toContainText('1 Ekim 2026');
  await expect(countdown.locator('.countdown-meta')).not.toContainText('Örnek tarih');
  await expect(countdown.locator('.countdown-value').first()).not.toHaveText('--');
  const values = (await countdown.locator('.countdown-value').allTextContents()).map(Number);
  expect(values).toHaveLength(4);
  expect(values[0]).toBe(6);
  expect(values[1]).toBe(12);

  const themes = [
    ['Mercan / Gül', 'rose'],
    ['Okyanus', 'ocean'],
    ['Mürdüm / Krem', 'plum'],
    ['Pastel', 'pastel'],
    ['Beyaz', 'white'],
    ['Siyah', 'black'],
  ] as const;
  const gradients = new Set<string>();
  for (const [name, id] of themes) {
    await navigate(page, 'Ayarlar');
    await page.getByRole('button', { name, exact: true }).click();
    await navigate(page, 'Bugün');
    const styles = await countdown.evaluate(node => {
      const tile = node.querySelector('.countdown-value')!;
      return {
        card: getComputedStyle(node).backgroundImage,
        tile: getComputedStyle(tile).backgroundImage,
        cardFits: node.scrollWidth <= node.clientWidth + 1,
        tilesFit: Array.from(node.querySelectorAll('.countdown-value')).every(value => value.scrollWidth <= value.clientWidth + 1),
      };
    });
    expect(styles.card, name + ' card gradient').toMatch(/gradient/);
    expect(styles.tile, name + ' tile gradient').toMatch(/gradient/);
    expect(styles.cardFits, name + ' card fit').toBe(true);
    expect(styles.tilesFit, name + ' tile fit').toBe(true);
    gradients.add(styles.card);
    await noOverflow(page);
    await countdown.screenshot({ path: 'artifacts/yks-countdown-' + id + '.png', animations: 'disabled' });
    if (id === 'ocean' || id === 'plum') await page.locator('.today-primary-grid').screenshot({ path: 'artifacts/yks-today-grid-' + id + '.png', animations: 'disabled' });
  }
  expect(gradients.size).toBe(themes.length);
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page);
  await countdown.screenshot({ path: 'artifacts/yks-countdown-black-mobile.png', animations: 'disabled' });
});




