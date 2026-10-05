import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState, type StudySession } from '../../src/lib/domain/types';

const startedAt = new Date('2026-09-30T09:00:00.000Z');
const simpleTimer = (page: Page) => page.getByRole('dialog', { name: 'Sade mod', exact: true });
const digit = (page: Page, unit: 'hours' | 'minutes' | 'seconds') =>
  simpleTimer(page).locator(`.simple-digit-unit[data-unit="${unit}"] .simple-digit-value`);

async function openSampleFocus(page: Page) {
  const state = { ...emptyState(false), server_now: startedAt.toISOString() };
  await page.clock.setFixedTime(startedAt);
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first().click();
  const focus = page.getByRole('dialog', { name: 'Odak ekranı', exact: true });
  await expect(focus).toBeVisible();
  return focus;
}

test('Sade mod starts the selected countdown, pauses it, and closes without losing the timer', async ({ page }) => {
  const commands: string[] = [];
  await page.route('**/api/command', route => {
    commands.push(route.request().postDataJSON().type);
    return route.abort();
  });
  const focus = await openSampleFocus(page);
  await focus.getByLabel('Süre (dakika)').fill('70');
  await focus.getByRole('group', { name: 'Sınav bölümü' }).getByRole('button', { name: 'AYT' }).click();
  await focus.getByRole('group', { name: 'AYT dersi' }).getByRole('button', { name: 'Biyoloji' }).click();
  await focus.getByRole('button', { name: 'Sade mod', exact: true }).click();

  const simple = simpleTimer(page);
  await expect(simple).toBeVisible();
  await expect(simple.locator('.simple-digit-unit')).toHaveCount(3);
  await expect(digit(page, 'hours')).toHaveText('01');
  await expect(digit(page, 'minutes')).toHaveText('10');
  await expect(digit(page, 'seconds')).toHaveText('00');
  await expect(simple.locator('.focus-timer-heading')).not.toBeVisible();
  await expect(simple.getByRole('button', { name: 'Başlat', exact: true })).toBeVisible();

  await simple.getByRole('button', { name: 'Başlat', exact: true }).click();
  await expect(simple.getByRole('button', { name: 'Duraklat', exact: true })).toBeVisible();
  await expect(simple.getByRole('button', { name: 'Bitir', exact: true })).toHaveCount(0);
  await page.clock.setFixedTime(new Date(startedAt.getTime() + 3_000));
  await expect(digit(page, 'seconds')).toHaveText('57');

  await simple.getByRole('button', { name: 'Duraklat', exact: true }).click();
  await expect(simple.getByRole('button', { name: 'Sürdür', exact: true })).toBeVisible();
  await expect(simple.getByRole('button', { name: 'Bitir', exact: true })).toBeVisible();
  const pausedDigits = await simple.locator('.simple-digit-value').allTextContents();
  await page.clock.setFixedTime(new Date(startedAt.getTime() + 8_000));
  await expect(simple.locator('.simple-digit-value')).toHaveText(pausedDigits);

  await simple.getByRole('button', { name: 'Sade modu kapat', exact: true }).click();
  await expect(simple).not.toBeVisible();
  await expect(focus).toBeVisible();
  await expect(focus.getByRole('button', { name: 'Sayacı sürdür', exact: true })).toBeVisible();
  await expect(focus.locator('.focus-digit-unit[data-unit="seconds"] .focus-digit-value')).toHaveText('57');
  expect(commands).toEqual([]);
});

test('Sade mod keeps all three digits and controls within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const focus = await openSampleFocus(page);
  await focus.getByLabel('Süre (dakika)').fill('70');
  await focus.getByRole('group', { name: 'Sınav bölümü' }).getByRole('button', { name: 'AYT' }).click();
  await focus.getByRole('group', { name: 'AYT dersi' }).getByRole('button', { name: 'Biyoloji' }).click();
  await focus.getByRole('button', { name: 'Sade mod', exact: true }).click();

  const simple = simpleTimer(page);
  await expect(simple).toBeVisible();
  await expect(simple.locator('.simple-digit-unit')).toHaveCount(3);
  await expect(simple.getByRole('button', { name: 'Başlat', exact: true })).toBeInViewport();
  await expect(simple.getByRole('button', { name: 'Sade modu kapat', exact: true })).toBeInViewport();
  const bounds = await simple.locator('.simple-digit-unit').evaluateAll(nodes =>
    nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth };
    }));
  expect(bounds.every(({ left, right, width, viewport }) => width > 0 && left >= -1 && right <= viewport + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await simple.getByRole('button', { name: 'Sade modu kapat', exact: true }).click();
  await expect(focus).toBeVisible();
  await expect(focus.getByLabel('Süre (dakika)')).toHaveValue('70');
});

test('authenticated Sade mod pauses and finishes the existing session through versioned commands', async ({ page }) => {
  let clockMillis = startedAt.getTime();
  const state: AppState = { ...emptyState(true), authenticated: true, server_now: startedAt.toISOString() };
  state.sessions = [{
    id: 'simple-contract-session', title: 'AYT Biyoloji tekrar', task_id: null, topic_id: null,
    subject: 'AYT Biyoloji', study_type: 'Tekrar', mode: 'countdown', target_seconds: 4200,
    status: 'running', started_at: startedAt.toISOString(), active_since: startedAt.toISOString(),
    accumulated_seconds: 600, finished_at: null, revision: 1,
  }];
  const commands: { type: string; payload: Record<string, unknown> }[] = [];
  await page.clock.setFixedTime(clockMillis);
  await page.route('**/api/state', route => route.fulfill({ json: { ...state, server_now: new Date(clockMillis).toISOString() } }));
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    const session = state.sessions[0];
    const elapsed = session.accumulated_seconds + (session.status === 'running' && session.active_since
      ? Math.floor((clockMillis - Date.parse(session.active_since)) / 1000) : 0);
    const status: StudySession['status'] = command.type === 'timer.finish' ? 'finished'
      : command.type === 'timer.pause' ? 'paused' : 'running';
    state.sessions[0] = {
      ...session, status, accumulated_seconds: elapsed,
      active_since: status === 'running' ? new Date(clockMillis).toISOString() : null,
      finished_at: status === 'finished' ? new Date(clockMillis).toISOString() : null,
      revision: session.revision + 1,
    };
    await route.fulfill({ json: { ok: true, id: session.id, request_id: command.request_id, replayed: false,
      state: { ...state, server_now: new Date(clockMillis).toISOString() } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Sayacı büyüt', exact: true }).first().click();
  const focus = page.getByRole('dialog', { name: 'Odak ekranı', exact: true });
  await focus.getByRole('button', { name: 'Sade mod', exact: true }).click();
  const simple = simpleTimer(page);
  await expect(digit(page, 'hours')).toHaveText('01');
  await expect(digit(page, 'minutes')).toHaveText('00');
  await expect(digit(page, 'seconds')).toHaveText('00');
  await expect(simple.getByRole('button', { name: 'Duraklat', exact: true })).toBeVisible();
  await expect(simple.getByRole('button', { name: 'Bitir', exact: true })).toHaveCount(0);

  clockMillis += 2_000;
  await page.clock.setFixedTime(clockMillis);
  await expect(digit(page, 'seconds')).toHaveText('58');
  await simple.getByRole('button', { name: 'Duraklat', exact: true }).click();
  await expect(simple.getByRole('button', { name: 'Sürdür', exact: true })).toBeVisible();
  await expect(simple.getByRole('button', { name: 'Bitir', exact: true })).toBeEnabled();
  clockMillis += 10_000;
  await page.clock.setFixedTime(clockMillis);
  await expect(digit(page, 'seconds')).toHaveText('58');

  await simple.getByRole('button', { name: 'Bitir', exact: true }).click();
  await expect(simple).not.toBeVisible();
  await expect(page.locator('.floating-timer')).toHaveCount(0);
  await expect.poll(() => state.sessions[0].status).toBe('finished');
  expect(commands).toMatchObject([
    { type: 'timer.pause', payload: { id: 'simple-contract-session', expected_revision: 1 } },
    { type: 'timer.finish', payload: { id: 'simple-contract-session', expected_revision: 2 } },
  ]);
  expect(state.sessions[0].status).toBe('finished');
});
