import {createServer, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';
import {localDate} from '../../src/lib/ui';

const taskId = '66666666-6666-4666-8666-666666666666';
type Command = {request_id: string; type: string; payload: Partial<Task>};

function task(payload: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {id: taskId, title: 'Korunan görev', plan_date: localDate(), exam: null, subject: null,
    topic_id: null, resource: '', completion_criteria: '', planned_minutes: 30, difficulty: 'medium',
    progress: 0, weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Tekrar',
    steps: [], revision: 1, created_at: now, updated_at: now, ...payload};
}

async function openTasks(page: Page, realtime = false) {
  if (!realtime) await page.route('**/api/realtime?*', route => route.fulfill({json: {enabled: false}}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
}

test('a confirmed task save recovers a transient state failure without reload or duplicate writes', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  const commands: Command[] = [];
  const responses: number[] = [];
  let documentLoads = 0;
  let failedRead = false;
  let release!: () => void;
  const heldRecovery = new Promise<void>(resolve => {release = resolve;});
  page.on('request', request => {if (request.resourceType() === 'document') documentLoads++;});
  await page.route('**/api/state', async route => {
    if (commands.length && !failedRead) {
      failedRead = true; responses.push(503);
      return route.fulfill({status: 503, json: {error: {message: 'Veritabanı işlemi tamamlanamadı. Bağlantıyı ve kurulumu kontrol edin.'}}});
    }
    if (failedRead) {responses.push(200); await heldRecovery;}
    return route.fulfill({json: state});
  });
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON(); commands.push(command);
    state.tasks = [task(command.payload)];
    await route.fulfill({json: {ok: true, id: taskId, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page);
  try {
    await page.getByRole('button', {name: 'Görev ekle', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
    await dialog.getByLabel('Görev başlığı').fill('Kaydı onaylanan görev');
    await dialog.getByRole('button', {name: 'Görevi kaydet', exact: true}).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => failedRead).toBe(true);
    await expect(page.getByRole('button', {name: 'Kaydı onaylanan görev düzenle', exact: true})).toBeEnabled();
    await expect.poll(() => responses, {timeout: 4000}).toEqual([503, 200]);
    release();
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(page.locator('.notice.error[role="alert"]')).toHaveCount(0);
    await expect(page.locator('.task-item h3')).toHaveText(['Kaydı onaylanan görev']);
    expect(commands).toHaveLength(1);
    expect(documentLoads).toBe(1);
  } finally {release();}
});

test('an exhausted timer poll offers a read-only retry while its running focus view stays open', async ({page}) => {
  const now = new Date().toISOString();
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()],
    sessions: [{id: sessionId, title: 'Kesintisiz çalışma', task_id: null, topic_id: null, subject: 'Matematik',
      study_type: 'Tekrar', mode: 'stopwatch', target_seconds: null, status: 'running', started_at: now,
      active_since: now, accumulated_seconds: 0, finished_at: null, revision: 1}],
    intervals: [{id: 'interval', session_id: sessionId, started_at: now, ended_at: null}]};
  let failReads = false;
  let failedReads = 0;
  let writes = 0;
  let documentLoads = 0;
  page.on('request', request => {if (request.resourceType() === 'document') documentLoads++;});
  await page.clock.install();
  await page.route('**/api/state', route => {
    if (failReads) {failedReads++; return route.fulfill({status: 503, json: {error: {message: 'Durum sorgusu zaman aşımına uğradı.'}}});}
    return route.fulfill({json: {...state, server_now: now}});
  });
  await page.route('**/api/command', route => {writes++; return route.fulfill({status: 500, json: {}});});
  await openTasks(page);
  await page.getByRole('button', {name: 'Odak ekranını aç', exact: true}).click();
  const focus = page.getByRole('dialog', {name: 'Odak ekranı', exact: true});
  await expect(focus.getByRole('button', {name: 'Sayacı duraklat', exact: true})).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  failReads = true;
  await page.clock.runFor(30000);
  await page.clock.resume();
  await expect.poll(() => failedReads, {timeout: 5000}).toBe(3);
  const retry = page.getByRole('button', {name: 'Görünümü yeniden dene', exact: true});
  await expect(retry).toBeVisible();
  await expect(page.locator('.sync-status')).toContainText('Görünüm güncel değil');
  await expect(page.locator('.notice.error')).not.toContainText('Kayıt tamamlandı');
  await expect(focus).toBeVisible();
  await expect(focus.getByRole('button', {name: 'Sayacı duraklat', exact: true})).toBeEnabled();
  await page.screenshot({path: test.info().outputPath('recoverable-timer-poll.png')});
  failReads = false;
  // The focus overlay covers the global notice, so close it using its normal
  // control to reach the retry. The session itself keeps running throughout.
  await focus.getByRole('button', {name: 'Sayacı küçült', exact: true}).click();
  await retry.click();
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  await expect(retry).toHaveCount(0);
  await page.getByRole('button', {name: 'Odak ekranını aç', exact: true}).click();
  await expect(focus.getByRole('button', {name: 'Sayacı duraklat', exact: true})).toBeEnabled();
  expect(writes).toBe(0);
  expect(documentLoads).toBe(1);
});

test('a delayed read cannot overwrite a task saved after that read began', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let delayRead = false;
  let delayed = false;
  let writes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/state', async route => {
    const snapshot = structuredClone(state);
    if (delayRead) {delayRead = false; delayed = true; await held;}
    return route.fulfill({json: snapshot});
  });
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON(); writes++;
    state.tasks = [{...state.tasks[0], ...command.payload, revision: 2}];
    await route.fulfill({json: {ok: true, id: taskId, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page);
  try {
    delayRead = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => delayed).toBe(true);
    await page.getByRole('button', {name: 'Korunan görev görevini tamamla', exact: true}).click();
    const undo = page.getByRole('button', {name: 'Korunan görev tamamlamasını geri al', exact: true});
    await expect(undo).toBeEnabled();
    await expect.poll(() => writes).toBe(1);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    release();
    await page.waitForTimeout(100);
    await expect(undo).toBeEnabled();
    await expect(page.locator('.notice.error')).toHaveCount(0);
  } finally {release();}
});

test('a failed read from before a later mutation never retries that stale snapshot', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let failing = false;
  let failedReads = 0;
  let successfulReads = 0;
  await page.route('**/api/state', route => {
    if (failing) {failing = false; failedReads++; return route.fulfill({status: 503, json: {error: {message: 'Zaman aşımı.'}}});}
    successfulReads++; return route.fulfill({json: state});
  });
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON();
    state.tasks = [{...state.tasks[0], ...command.payload, revision: 2}];
    await route.fulfill({json: {ok: true, id: taskId, request_id: command.request_id, replayed: false, state}});
  });
  await openTasks(page);
  const before = successfulReads;
  failing = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => failedReads).toBe(1);
  await page.getByRole('button', {name: 'Korunan görev görevini tamamla', exact: true}).click();
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  await page.waitForTimeout(1200);
  expect(successfulReads).toBe(before);
  await expect(page.getByRole('button', {name: 'Korunan görev tamamlamasını geri al', exact: true})).toBeEnabled();
});

test('read permission failures are reported without automatic retries', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let failReads = false;
  let failedReads = 0;
  await page.route('**/api/state', route => {
    if (failReads) {failedReads++; return route.fulfill({status: 403, json: {error: {message: 'Bu görünüm için yetkin yok.'}}});}
    return route.fulfill({json: state});
  });
  await openTasks(page);
  failReads = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.notice.error')).toContainText('Bu görünüm için yetkin yok.');
  await page.waitForTimeout(1200);
  expect(failedReads).toBe(1);
  await expect(page.getByRole('button', {name: 'Görünümü yeniden dene', exact: true})).toHaveCount(0);
});

test('overlapping focus and online refreshes share one in-flight read', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let reads = 0;
  let holdReads = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/state', async route => {
    reads++;
    if (holdReads) await held;
    return route.fulfill({json: state});
  });
  await openTasks(page);
  const before = reads;
  try {
    holdReads = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => reads).toBe(before + 1);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(200);
    expect(reads).toBe(before + 1);
    state.tasks[0] = {...state.tasks[0], title: 'Tek okumada güncellendi', revision: 2};
    release();
    await expect(page.getByRole('button', {name: 'Tek okumada güncellendi düzenle', exact: true})).toBeEnabled();
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  } finally {release();}
});

test('manual recovery of a confirmed save retries only state after the bounded attempts fail', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let writes = 0;
  let failedReads = 0;
  let failReads = false;
  await page.route('**/api/state', route => {
    if (failReads) {failedReads++; return route.fulfill({status: 503, json: {error: {message: 'Veritabanı zaman aşımı.'}}});}
    return route.fulfill({json: state});
  });
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON(); writes++;
    state.tasks[0] = {...state.tasks[0], ...command.payload, revision: 2};
    failReads = true;
    await route.fulfill({json: {ok: true, id: taskId, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page);
  await page.getByRole('button', {name: 'Korunan görev görevini tamamla', exact: true}).click();
  const undo = page.getByRole('button', {name: 'Korunan görev tamamlamasını geri al', exact: true});
  await expect(undo).toBeEnabled();
  const retry = page.getByRole('button', {name: 'Görünümü yeniden dene', exact: true});
  await expect(retry).toBeVisible({timeout: 6000});
  expect(failedReads).toBe(3);
  expect(writes).toBe(1);
  await page.screenshot({path: test.info().outputPath('saved-task-view-retry.png')});
  failReads = false;
  await retry.click();
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  await expect(undo).toBeEnabled();
  expect(writes).toBe(1);
});

test('a network state read failure recovers automatically', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let failNextRead = false;
  let failures = 0;
  let reads = 0;
  await page.route('**/api/state', route => {
    reads++;
    if (failNextRead) {failNextRead = false; failures++; return route.abort('failed');}
    return route.fulfill({json: state});
  });
  await openTasks(page);
  const before = reads;
  failNextRead = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => reads, {timeout: 4000}).toBe(before + 2);
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  expect(failures).toBe(1);
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

test('a later full command response repairs an exhausted display notice without an extra read', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let writes = 0;
  let failedReads = 0;
  await page.route('**/api/state', route => {
    if (writes) {failedReads++; return route.fulfill({status: 503, json: {error: {message: 'Görünüm zaman aşımı.'}}});}
    return route.fulfill({json: state});
  });
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON(); writes++;
    state.tasks[0] = {...state.tasks[0], ...command.payload, revision: state.tasks[0].revision + 1};
    const receipt = {ok: true, id: taskId, request_id: command.request_id, replayed: false};
    await route.fulfill({json: writes === 1 ? receipt : {...receipt, state}});
  });
  await openTasks(page);
  await page.getByRole('button', {name: 'Korunan görev görevini tamamla', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Görünümü yeniden dene', exact: true})).toBeVisible({timeout: 6000});
  expect(failedReads).toBe(3);
  await page.getByRole('button', {name: 'Korunan görev tamamlamasını geri al', exact: true}).click();
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Korunan görev görevini tamamla', exact: true})).toBeEnabled();
  expect(writes).toBe(2);
  expect(failedReads).toBe(3);
});

test('realtime hints during a held snapshot produce one trailing read with the newer external state', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  const channel = 'yksim:study:v1:' + 'a'.repeat(64);
  const streams = new Set<ServerResponse>();
  let reads = 0;
  let holdNextRead = false;
  let heldRead = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  const server = createServer((request, response) => {
    response.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive',
      'Access-Control-Allow-Origin': request.headers.origin ?? 'http://127.0.0.1:3100', 'Access-Control-Allow-Credentials': 'true'});
    streams.add(response);
    response.on('close', () => streams.delete(response));
    response.write(`data: ${JSON.stringify({type: 'connected', channel})}\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await page.route('**/api/realtime?*', route => {
    const url = new URL(route.request().url());
    return url.searchParams.get('session') === '1' ? route.fulfill({json: {enabled: true, channel}})
      : route.fulfill({status: 307, headers: {Location: `http://127.0.0.1:${port}/events?${url.searchParams}`}});
  });
  await page.route('**/api/state', async route => {
    reads++;
    const snapshot = structuredClone(state);
    if (holdNextRead) {holdNextRead = false; heldRead = true; await held;}
    return route.fulfill({json: snapshot});
  });
  try {
    await openTasks(page, true);
    await expect.poll(() => streams.size).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    const before = reads;
    holdNextRead = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => heldRead).toBe(true);
    state.tasks[0] = {...state.tasks[0], title: 'Son dış değişiklik', revision: 2};
    for (let sequence = 1; sequence <= 2; sequence++) {
      const frame = JSON.stringify({id: `${Date.now()}-${sequence}`, event: 'study.dirty', channel, data: {}});
      for (const stream of streams) stream.write(`data: ${frame}\n\n`);
    }
    await page.waitForTimeout(700);
    expect(reads).toBe(before + 1);
    release();
    await expect(page.getByRole('button', {name: 'Son dış değişiklik düzenle', exact: true})).toBeEnabled({timeout: 3000});
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    expect(reads).toBe(before + 2);
  } finally {
    release();
    for (const stream of streams) stream.end();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
