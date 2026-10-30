import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type StudySession} from '../../src/lib/domain/types';

const sessionId = '44444444-4444-4444-8444-444444444444';
type TimerCommand = {type: 'timer.pause' | 'timer.resume' | 'timer.finish'; request_id: string; payload: {id: string; expected_revision: number}};
const focus = (page: Page) => page.getByRole('dialog', {name: 'Odak ekranı', exact: true});

async function visibility(page: Page, value: 'hidden' | 'visible') {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, value});
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

async function displayedSeconds(page: Page) {
  const units = await focus(page).locator('.focus-digit-unit').evaluateAll(nodes => Object.fromEntries(nodes.map(node =>
    [node.getAttribute('data-unit'), Number(node.querySelector('.focus-digit-value')?.textContent ?? 0)])));
  return (units.hours ?? 0) * 3600 + (units.minutes ?? 0) * 60 + (units.seconds ?? 0);
}

async function runningTimer(page: Page) {
  const stamp = new Date().toISOString();
  const state: AppState = {...emptyState(true), authenticated: true, server_now: stamp,
    sessions: [{id: sessionId, title: 'Bağlantısız çalışma', task_id: null, topic_id: null, subject: 'TYT Matematik',
      study_type: 'Tekrar', mode: 'stopwatch', target_seconds: null, status: 'running', started_at: stamp,
      active_since: stamp, accumulated_seconds: 600, finished_at: null, revision: 1}],
    intervals: [{id: '55555555-5555-4555-8555-555555555555', session_id: sessionId, started_at: stamp, ended_at: null}],
  };
  let reads = 0, checks = 0, version = 'initial';
  await page.clock.install({time: new Date(stamp)});
  await page.route('**/api/state', async route => {
    reads++;
    const now = await page.evaluate(() => new Date().toISOString());
    return route.fulfill({json: {...state, server_now: now}});
  });
  await page.route('**/api/realtime?*', route => {checks++; return route.fulfill({json: {enabled: true, version}});});
  await page.goto('/');
  await expect.poll(() => checks).toBe(1);
  await page.getByRole('button', {name: 'Sayacı büyüt', exact: true}).first().click();
  await expect(focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true})).toBeEnabled();
  await expect.poll(() => displayedSeconds(page)).toBeGreaterThanOrEqual(600);
  return {state, get reads() {return reads;}, get checks() {return checks;}, dirty() {version += '-changed';}};
}

test('the running stopwatch keeps elapsed time while hidden and offline polling stops', async ({page, context}) => {
  const commands: string[] = [];
  page.on('request', request => {if (new URL(request.url()).pathname === '/api/command') commands.push(request.url());});
  const fixture = await runningTimer(page);
  const beforeSeconds = await displayedSeconds(page);
  const beforeReads = fixture.reads, beforeChecks = fixture.checks;

  await visibility(page, 'hidden');
  await page.clock.fastForward(120_000);
  await expect.poll(() => displayedSeconds(page)).toBeGreaterThanOrEqual(beforeSeconds + 120);
  expect(fixture.reads).toBe(beforeReads);
  expect(fixture.checks).toBe(beforeChecks);

  await context.setOffline(true);
  await visibility(page, 'visible');
  await page.clock.fastForward(60_000);
  await expect.poll(() => displayedSeconds(page)).toBeGreaterThanOrEqual(beforeSeconds + 180);
  expect(fixture.reads).toBe(beforeReads);
  expect(fixture.checks).toBe(beforeChecks);

  await context.setOffline(false);
  await expect.poll(() => fixture.checks).toBe(beforeChecks + 1);
  await expect(focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true})).toBeEnabled();
  expect(fixture.reads).toBe(beforeReads);
  expect(commands).toEqual([]);
});

test('hidden polling and returning version changes preserve queued timer pause resume and finish', async ({page}) => {
  const commands: TimerCommand[] = [];
  let releasePause!: () => void;
  const heldPause = new Promise<void>(resolve => {releasePause = resolve;});
  const fixture = await runningTimer(page);
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON() as TimerCommand;
    commands.push(command);
    const session = fixture.state.sessions[0];
    expect(command.payload).toMatchObject({id: sessionId, expected_revision: session.revision});
    const now = await page.evaluate(() => Date.now());
    const stamp = new Date(now).toISOString();
    const elapsed = session.accumulated_seconds + (session.status === 'running' && session.active_since
      ? Math.floor((now - Date.parse(session.active_since)) / 1000) : 0);
    const status: StudySession['status'] = command.type === 'timer.finish' ? 'finished' : command.type === 'timer.pause' ? 'paused' : 'running';
    fixture.state.sessions[0] = {...session, status, accumulated_seconds: elapsed, active_since: status === 'running' ? stamp : null,
      finished_at: status === 'finished' ? stamp : null, revision: session.revision + 1};
    if (command.type === 'timer.pause') await heldPause;
    await route.fulfill({json: {ok: true, id: sessionId, request_id: command.request_id, replayed: false,
      state: {...fixture.state, server_now: new Date(await page.evaluate(() => Date.now())).toISOString()}}});
  });

  try {
    await focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true}).click();
    await expect.poll(() => commands.length).toBe(1);
    await expect(focus(page).getByRole('button', {name: 'Sayacı sürdür', exact: true})).toBeEnabled();
    const pausedSeconds = await displayedSeconds(page);
    const reads = fixture.reads, checks = fixture.checks;
    await visibility(page, 'hidden');
    // Keep this response in flight below the transport timeout. The recovery
    // tests below cover longer suspensions after an uncertain response.
    await page.clock.fastForward(5000);
    expect(await displayedSeconds(page)).toBe(pausedSeconds);
    expect(fixture.reads).toBe(reads);
    expect(fixture.checks).toBe(checks);

    fixture.dirty();
    await visibility(page, 'visible');
    await expect.poll(() => fixture.checks).toBe(checks + 1);
    await page.clock.runFor(1000);
    expect(fixture.reads).toBe(reads);
    await focus(page).getByRole('button', {name: 'Sayacı sürdür', exact: true}).click();
    await expect(focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true})).toBeEnabled();
    await page.clock.fastForward(5000);
    await expect.poll(() => displayedSeconds(page)).toBeGreaterThanOrEqual(pausedSeconds + 5);
    await focus(page).getByRole('button', {name: 'Sayacı bitir', exact: true}).click();
    await expect(focus(page)).not.toBeVisible();
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '3');
    expect(commands).toHaveLength(1);

    releasePause();
    await expect.poll(() => commands.length).toBe(3);
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
    await page.clock.runFor(1000);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    expect(commands.map(command => [command.type, command.payload.expected_revision])).toEqual([
      ['timer.pause', 1], ['timer.resume', 2], ['timer.finish', 3],
    ]);
    expect(new Set(commands.map(command => command.request_id)).size).toBe(3);
    expect(fixture.state.sessions[0]).toMatchObject({status: 'finished', revision: 4});
    await expect(page.locator('.floating-timer')).toHaveCount(0);
  } finally {releasePause();}
});

test('a lost timer response recovers automatically with the same request and no duplicate pause', async ({page}) => {
  const fixture = await runningTimer(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const commands: TimerCommand[] = [];
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON() as TimerCommand;
    commands.push(command);
    if (commands.length === 1) {
      fixture.state.sessions[0] = {...fixture.state.sessions[0], status: 'paused', active_since: null, revision: 2};
      fixture.state.intervals[0] = {...fixture.state.intervals[0], ended_at: fixture.state.server_now};
      return route.abort('connectionreset');
    }
    expect(command).toEqual(commands[0]);
    expect(route.request().headers()['prefer']).not.toBe('return=minimal');
    await route.fulfill({json: {ok: true, id: sessionId, request_id: command.request_id, replayed: true, state: fixture.state}});
  });

  await focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true}).click();
  await expect(focus(page).getByRole('alert')).toContainText('otomatik');
  await expect(focus(page).getByRole('alert')).not.toContainText('Failed to fetch');
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '1');
  expect(commands).toHaveLength(1);

  await page.clock.fastForward(1000);
  await expect.poll(() => commands.length).toBe(2);
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
  await expect(focus(page).getByRole('alert')).toHaveCount(0);
  await expect(focus(page).getByRole('button', {name: 'Sayacı sürdür', exact: true})).toBeEnabled();
  expect(fixture.state.sessions).toHaveLength(1);
  expect(fixture.state.sessions[0]).toMatchObject({id: sessionId, status: 'paused', revision: 2});
});

test('a stalled timer response times out and safely replays the committed pause', async ({page}) => {
  const fixture = await runningTimer(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const commands: TimerCommand[] = [];
  let release!: () => void;
  const stalled = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON() as TimerCommand;
    commands.push(command);
    if (commands.length === 1) {
      fixture.state.sessions[0] = {...fixture.state.sessions[0], status: 'paused', active_since: null, revision: 2};
      fixture.state.intervals[0] = {...fixture.state.intervals[0], ended_at: fixture.state.server_now};
      await stalled;
    } else {
      expect(command).toEqual(commands[0]);
    }
    await route.fulfill({json: {ok: true, id: sessionId, request_id: command.request_id,
      replayed: commands.length > 1, state: fixture.state}});
  });

  try {
    await focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true}).click();
    await expect.poll(() => commands.length).toBe(1);
    await page.clock.fastForward(15_000);
    await expect(focus(page).getByRole('alert')).toContainText('otomatik');
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '1');
    await page.clock.fastForward(1000);
    await expect.poll(() => commands.length).toBe(2);
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
    await expect(focus(page).getByRole('alert')).toHaveCount(0);
    await expect(focus(page).getByRole('button', {name: 'Sayacı sürdür', exact: true})).toBeEnabled();
    expect(fixture.state.sessions[0]).toMatchObject({status: 'paused', revision: 2});
  } finally {release();}
});

for (const wakeup of ['online', 'visibility'] as const) test(`pending timer retries resume on ${wakeup} after waiting offline`, async ({page, context}) => {
  const fixture = await runningTimer(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const commands: TimerCommand[] = [];
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON() as TimerCommand;
    commands.push(command);
    if (commands.length === 1) return route.abort('connectionreset');
    expect(command).toEqual(commands[0]);
    fixture.state.sessions[0] = {...fixture.state.sessions[0], status: 'paused', active_since: null, revision: 2};
    fixture.state.intervals[0] = {...fixture.state.intervals[0], ended_at: fixture.state.server_now};
    await route.fulfill({json: {ok: true, id: sessionId, request_id: command.request_id, replayed: false, state: fixture.state}});
  });

  await focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true}).click();
  await expect(focus(page).getByRole('alert')).toContainText('otomatik');
  await context.setOffline(true);
  await page.clock.fastForward(60_000);
  expect(commands).toHaveLength(1);
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '1');

  if (wakeup === 'visibility') await visibility(page, 'hidden');
  await context.setOffline(false);
  if (wakeup === 'visibility') {
    await page.clock.fastForward(60_000);
    expect(commands).toHaveLength(1);
    await visibility(page, 'visible');
  }
  await expect.poll(() => commands.length).toBe(2);
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
  await expect(focus(page).getByRole('alert')).toHaveCount(0);
  await expect(focus(page).getByRole('button', {name: 'Sayacı sürdür', exact: true})).toBeEnabled();
});

test('a sustained timer outage backs off without dropping the pending command', async ({page}) => {
  await runningTimer(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const commands: TimerCommand[] = [];
  await page.route('**/api/command', async route => {
    commands.push(route.request().postDataJSON() as TimerCommand);
    await route.abort('connectionreset');
  });
  await focus(page).getByRole('button', {name: 'Sayacı duraklat', exact: true}).click();
  await expect(focus(page).getByRole('alert')).toContainText('otomatik');
  for (const [index, delay] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
    await page.clock.fastForward(delay - 1);
    expect(commands).toHaveLength(index + 1);
    await page.clock.fastForward(1);
    await expect.poll(() => commands.length).toBe(index + 2);
    await expect(focus(page).getByRole('alert')).toContainText('otomatik');
  }
  expect(commands.every(command => JSON.stringify(command) === JSON.stringify(commands[0]))).toBe(true);
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '1');
  await expect(page.locator('.notice.error').getByRole('button', {name: 'Bekleyen kayıtları yeniden dene', exact: true, includeHidden: true})).toBeEnabled();
});
