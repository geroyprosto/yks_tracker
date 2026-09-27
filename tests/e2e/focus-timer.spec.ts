import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState, type StudySession } from '../../src/lib/domain/types';

// These tests exercise browser behavior with isolated HTTP fixtures. Sample
// timers are local only; authenticated commands never reach the real database.
const initialTime = Date.now();
const initialStamp = new Date(initialTime).toISOString();
const digit = (page: Page, unit: string) => page.locator(`.focus-digit-unit[data-unit="${unit}"] .focus-digit-value`);
const focusScreen = (page: Page) => page.getByRole('dialog', { name: 'Odak ekranı', exact: true });

async function openExample(page: Page) {
  await page.clock.setFixedTime(initialTime);
  await page.route('**/api/state', route => route.fulfill({ json: { ...emptyState(false), server_now: initialStamp } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first().click();
  await expect(focusScreen(page)).toBeVisible();
}

function activeState(): AppState {
  const state = { ...emptyState(true), authenticated: true, server_now: initialStamp };
  state.sessions = [{ id: 'focus-contract-session', title: 'Sınır denemesi', task_id: null, topic_id: null, subject: null, study_type: 'Tekrar', mode: 'countdown', target_seconds: 4200, status: 'running', started_at: initialStamp, active_since: initialStamp, accumulated_seconds: 600, finished_at: null, revision: 1 }];
  return state;
}

async function assertFits(page: Page) {
  // Check the final layout after the intentional expand animation has settled.
  await expect.poll(() => page.locator('.timer-focus-screen').evaluate(node => node.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const bounds = await focusScreen(page).evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
}

test('sample timer adapts 50 and 70 minute tiles, pauses, minimizes, restores, and finishes without writes', async ({ page }) => {
  const commands: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/command')) commands.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem('yksim-theme', 'rose'));
  await openExample(page);
  const screen = focusScreen(page);
  await expect(screen).toContainText('Örnek sayaç');
  await expect(screen.getByLabel('Süre (dakika)')).toHaveValue('40');
  await screen.getByRole('button', { name: '50 dk', exact: true }).click();
  await expect(digit(page, 'hours')).toHaveCount(0);
  await expect(digit(page, 'minutes')).toHaveText('50');
  await expect(digit(page, 'seconds')).toHaveText('00');
  await screen.getByLabel('Süre (dakika)').fill('70');
  await expect(digit(page, 'hours')).toHaveText('01');
  await expect(digit(page, 'minutes')).toHaveText('10');
  await expect(digit(page, 'seconds')).toHaveText('00');
  await screen.getByRole('group', { name: 'Sınav bölümü' }).getByRole('button', { name: 'AYT' }).click();
  await screen.getByRole('group', { name: 'AYT dersi' }).getByRole('button', { name: 'Biyoloji' }).click();
  await screen.getByRole('group', { name: 'Çalışma türü' }).getByRole('button', { name: 'Deneme analizi' }).click();
  await screen.getByRole('button', { name: 'Çalışmaya başla', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Sayacı duraklat', exact: true })).toBeVisible();
  await page.clock.setFixedTime(initialTime + 3000);
  await expect(digit(page, 'seconds')).toHaveText('57');
  await page.screenshot({ path: 'artifacts/focus-timer-rose-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 360, height: 800 });
  await assertFits(page);
  await page.screenshot({ path: 'artifacts/focus-timer-rose-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 800, height: 450 });
  await assertFits(page);
  await screen.getByRole('button', { name: 'Sayacı küçült', exact: true }).scrollIntoViewIfNeeded();
  await expect(screen.getByRole('button', { name: 'Sayacı küçült', exact: true })).toBeInViewport();
  await expect(screen.getByRole('button', { name: 'Sayacı duraklat', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/focus-timer-rose-landscape.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screen.getByRole('button', { name: 'Sayacı duraklat', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Sayacı sürdür', exact: true })).toBeVisible();
  const paused = await screen.locator('.focus-digit-value').allTextContents();
  await page.clock.setFixedTime(initialTime + 8000);
  await expect(screen.locator('.focus-digit-value')).toHaveText(paused);
  await screen.getByRole('button', { name: 'Sayacı küçült', exact: true }).click();
  await expect(screen).not.toBeVisible();
  await expect(page.locator('.floating-timer')).toContainText('AYT Biyoloji deneme analizi');
  await page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first().click();
  await expect(screen).toBeVisible();
  await expect(screen.locator('.focus-digit-value')).toHaveText(paused);
  await screen.getByRole('button', { name: 'Sayacı sürdür', exact: true }).click();
  await page.clock.setFixedTime(initialTime + 10000);
  await expect(digit(page, 'seconds')).toHaveText('55');
  await screen.getByRole('button', { name: 'Sayacı küçült', exact: true }).click();
  await expect(screen).not.toBeVisible();
  await page.clock.setFixedTime(initialTime + 15000);
  await page.getByRole('button', { name: 'Odak ekranını aç', exact: true }).click();
  await expect(digit(page, 'seconds')).toHaveText('50');
  await screen.getByRole('button', { name: 'Sayacı bitir', exact: true }).click();
  await expect(screen).not.toBeVisible();
  await expect(page.locator('.floating-timer')).toHaveCount(0);
  expect(commands).toEqual([]);
});

test('authenticated timer crosses the hour boundary and sends authoritative pause resume and finish revisions', async ({ page }) => {
  let clockMillis = initialTime;
  const state = activeState();
  const requests: { type: string; payload: Record<string, unknown> }[] = [];
  await page.clock.setFixedTime(clockMillis);
  await page.route('**/api/state', route => route.fulfill({ json: { ...state, server_now: new Date(clockMillis).toISOString() } }));
  await page.route('**/api/command', async route => {
    const request = route.request().postDataJSON();
    requests.push(request);
    const session = state.sessions[0];
    const elapsed = session.accumulated_seconds + (session.status === 'running' && session.active_since ? Math.floor((clockMillis - Date.parse(session.active_since)) / 1000) : 0);
    const status: StudySession['status'] = request.type === 'timer.finish' ? 'finished' : request.type === 'timer.pause' ? 'paused' : 'running';
    state.sessions[0] = { ...session, status, accumulated_seconds: elapsed, active_since: status === 'running' ? new Date(clockMillis).toISOString() : null, finished_at: status === 'finished' ? new Date(clockMillis).toISOString() : null, revision: session.revision + 1 };
    await route.fulfill({ json: { ok: true, state: { ...state, server_now: new Date(clockMillis).toISOString() } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first().click();
  const screen = focusScreen(page);
  await expect(digit(page, 'hours')).toHaveText('01');
  await expect(digit(page, 'minutes')).toHaveText('00');
  clockMillis += 2000;
  await page.clock.setFixedTime(clockMillis);
  await expect(digit(page, 'hours')).toHaveText('00');
  await expect(digit(page, 'minutes')).toHaveText('59');
  await expect(digit(page, 'seconds')).toHaveText('58');
  await screen.getByRole('button', { name: 'Sayacı duraklat', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Sayacı sürdür', exact: true })).toBeEnabled();
  clockMillis += 10000;
  await page.clock.setFixedTime(clockMillis);
  await expect(digit(page, 'seconds')).toHaveText('58');
  await screen.getByRole('button', { name: 'Sayacı sürdür', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Sayacı duraklat', exact: true })).toBeEnabled();
  clockMillis += 2000;
  await page.clock.setFixedTime(clockMillis);
  await expect(digit(page, 'seconds')).toHaveText('56');
  await screen.getByRole('button', { name: 'Sayacı bitir', exact: true }).click();
  await expect(screen).not.toBeVisible();
  expect(requests).toMatchObject([
    { type: 'timer.pause', payload: { id: 'focus-contract-session', expected_revision: 1 } },
    { type: 'timer.resume', payload: { id: 'focus-contract-session', expected_revision: 2 } },
    { type: 'timer.finish', payload: { id: 'focus-contract-session', expected_revision: 3 } },
  ]);
});

test('failed fullscreen timer finish keeps the session and error visible', async ({ page }) => {
  const state = activeState();
  await page.clock.setFixedTime(initialTime);
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/command', route => route.fulfill({ status: 409, json: { ok: false, error: { code: 'CONFLICT', message: 'Oturum değişti. Yenileyip tekrar dene.' } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first().click();
  const screen = focusScreen(page);
  await screen.getByRole('button', { name: 'Sayacı bitir', exact: true }).click();
  await expect(screen).toBeVisible();
  await expect(screen.getByRole('alert')).toHaveText('Oturum değişti. Yenileyip tekrar dene.');
  await expect(screen.getByRole('button', { name: 'Sayacı duraklat', exact: true })).toBeEnabled();
});

test('fullscreen timer follows six themes, fits mobile, and restores focus on Escape', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openExample(page);
  await focusScreen(page).getByRole('button', { name: 'Sayacı küçült', exact: true }).click();
  await expect(focusScreen(page)).not.toBeVisible();
  const themes = [['Mercan / Gül', 'rose'], ['Okyanus', 'ocean'], ['Mürdüm / Krem', 'plum'], ['Pastel', 'pastel'], ['Beyaz', 'white'], ['Siyah', 'black']] as const;
  const backgrounds = new Set<string>();
  for (const [label, id] of themes) {
    await page.getByRole('navigation', { name: 'Ana gezinme', exact: true }).getByRole('button', { name: 'Ayarlar', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('navigation', { name: 'Ana gezinme', exact: true }).getByRole('button', { name: 'Bugün', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first();
    await trigger.click();
    const screen = focusScreen(page);
    await expect(screen).toBeVisible();
    await expect(screen.getByRole('group', { name: 'Sınav bölümü' }).getByRole('button', { name: 'TYT' })).toBeFocused();
    await expect(screen.locator('.timer-minutes-input')).not.toBeFocused();
    await screen.getByLabel('Süre (dakika)').fill('70');
    await expect(digit(page, 'hours')).toHaveText('01');
    backgrounds.add(await page.locator('.timer-focus-screen').evaluate(node => getComputedStyle(node).backgroundImage));
    await assertFits(page);
    if (id === 'rose') await page.screenshot({ path: 'artifacts/focus-timer-setup-rose-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 360, height: 800 });
    await assertFits(page);
    for (const control of ['Sayacı küçült', 'Çalışmaya başla']) await expect(screen.getByRole('button', { name: control, exact: true })).toBeVisible();
    if (id === 'rose') await page.screenshot({ path: 'artifacts/focus-timer-setup-rose-mobile.png', animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(screen).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  expect(backgrounds.size).toBe(themes.length);
  expect(errors).toEqual([]);
});

test('reduced motion skips fullscreen expansion and close animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExample(page);
  const screen = focusScreen(page);
  const moving = await screen.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && Number(animation.effect?.getTiming().duration) > 1).length);
  expect(moving).toBe(0);
  await page.keyboard.press('Escape');
  await expect(screen).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first()).toBeFocused();
});

test('authenticated fullscreen start uses selected course and minutes, then stays open with returned session', async ({ page }) => {
  await page.clock.setFixedTime(initialTime);
  const state = { ...emptyState(true), authenticated: true, server_now: initialStamp };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  let sent: { type: string; payload: Record<string, unknown> } | undefined;
  await page.route('**/api/command', async route => {
    sent = route.request().postDataJSON();
    state.sessions = [{ ...activeState().sessions[0], title: String(sent!.payload.title), subject: String(sent!.payload.subject), study_type: sent!.payload.study_type as StudySession['study_type'], target_seconds: Number(sent!.payload.target_seconds), accumulated_seconds: 0 }];
    await route.fulfill({ json: { ok: true, state } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first().click();
  const screen = focusScreen(page);
  await screen.getByRole('group', { name: 'Sınav bölümü' }).getByRole('button', { name: 'AYT' }).click();
  await screen.getByRole('group', { name: 'AYT dersi' }).getByRole('button', { name: 'Matematik' }).click();
  await screen.getByRole('group', { name: 'Çalışma türü' }).getByRole('button', { name: 'Tekrar' }).click();
  await screen.getByLabel('Süre (dakika)').fill('70');
  await screen.getByRole('button', { name: 'Çalışmaya başla', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Sayacı duraklat', exact: true })).toBeEnabled();
  await expect(screen.getByRole('heading', { name: 'AYT Matematik tekrar', exact: true })).toBeVisible();
  await expect(digit(page, 'hours')).toHaveText('01');
  await expect(digit(page, 'minutes')).toHaveText('10');
  expect(sent).toMatchObject({ type: 'timer.start', payload: { title: 'AYT Matematik tekrar', topic_id: null, subject: 'AYT Matematik', study_type: 'Tekrar', mode: 'countdown', target_seconds: 4200 } });
});

test('compact setup remembers the latest minutes and starts an activity without a topic', async ({ page }) => {
  const state: AppState = {...emptyState(true), authenticated: true, server_now: new Date().toISOString()};
  const topicBase = {
    parent_id: null, mastery: 0, notes: '', review_requested: false,
    source: '', next_step: '', revision: 1, updated_at: state.server_now,
  } as const;
  state.topics = [
    {id: 'ayt-bio-1', exam: 'AYT', subject: 'Biyoloji', name: 'Bitki biyolojisi', ...topicBase},
    {id: 'ayt-bio-2', exam: 'AYT', subject: 'Biyoloji', name: 'Hücresel solunum', ...topicBase},
  ];
  state.sessions = [
    {...activeState().sessions[0], id: 'older', title: 'AYT Biyoloji', subject: 'AYT Biyoloji', mode: 'countdown', target_seconds: 1500, status: 'finished', started_at: new Date(Date.now() - 7200_000).toISOString(), active_since: null, finished_at: new Date(Date.now() - 5700_000).toISOString()},
    {...activeState().sessions[0], id: 'latest', title: 'AYT Biyoloji', subject: 'AYT Biyoloji', mode: 'countdown', target_seconds: 4200, status: 'finished', started_at: new Date(Date.now() - 3600_000).toISOString(), active_since: null, finished_at: new Date().toISOString()},
  ];
  await page.route('**/api/state', route => route.fulfill({json: state}));
  let sent: {type: string; payload: Record<string, unknown>} | undefined;
  await page.route('**/api/command', async route => {
    sent = route.request().postDataJSON();
    await route.fulfill({json: {ok: true, state}});
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Sayaç — çalışma sayacını aç', exact: true}).first().click();
  const dialog = page.getByRole('dialog', {name: 'Çalışmaya başla'});
  await expect(dialog.getByRole('group', {name: 'Sınav bölümü'}).getByRole('button', {name: 'AYT'})).toBeFocused();
  await expect(dialog.getByLabel('Süre (dakika)')).toHaveValue('70');
  await expect(dialog.getByRole('group', {name: 'AYT dersi'}).getByRole('button', {name: 'Biyoloji'})).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('group', {name: 'AYT dersi'}).getByRole('button')).toHaveCount(1);
  await expect(dialog).not.toContainText('Bitki biyolojisi');
  await expect(dialog).not.toContainText('Hücresel solunum');
  await dialog.getByRole('group', {name: 'Çalışma türü'}).getByRole('button', {name: 'Deneme analizi'}).click();
  await dialog.getByRole('group', {name: 'Hazır süreler'}).getByRole('button', {name: '50 dk'}).click();
  await dialog.getByRole('button', {name: 'Çalışmaya başla', exact: true}).click();
  expect(sent).toMatchObject({
    type: 'timer.start',
    payload: {title: 'AYT Biyoloji deneme analizi', task_id: null, topic_id: null,
      subject: 'AYT Biyoloji', study_type: 'Yanlış analizi',
      mode: 'countdown', target_seconds: 3000},
  });
});
