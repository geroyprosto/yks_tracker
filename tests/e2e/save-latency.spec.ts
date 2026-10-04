import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';
import {localDate} from '../../src/lib/ui';

function task(): Task {
  return {id: '22222222-2222-4222-8222-222222222222', title: 'Ardışık kayıt',
    plan_date: localDate(), exam: null, subject: null, topic_id: null, resource: '',
    completion_criteria: '', planned_minutes: 40, difficulty: 'medium', progress: 0,
    weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Tekrar',
    steps: [], revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString()};
}

async function openTasks(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
}

test('accepted task saves unlock before a 2500 ms state refresh', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let writes = 0;
  let receiptAt = 0;
  await page.route('**/api/state', async route => {
    const snapshot = structuredClone(state);
    if (writes) await new Promise(resolve => setTimeout(resolve, 2500));
    await route.fulfill({json: snapshot});
  });
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    expect(command.payload.expected_revision).toBe(state.tasks[0].revision);
    state.tasks[0] = {...state.tasks[0], progress: command.payload.progress, revision: state.tasks[0].revision + 1};
    writes++;
    receiptAt = Date.now();
    await route.fulfill({json: {ok: true, id: state.tasks[0].id, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page);
  await page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'}).click();
  const undo = page.getByRole('button', {name: 'Ardışık kayıt tamamlamasını geri al'});
  await expect(undo).toBeEnabled({timeout: 4500});
  const receiptToUnlockMs = Date.now() - receiptAt;
  console.log(`receipt-to-next-action: ${receiptToUnlockMs} ms (state refresh delayed 2500 ms)`);
  await undo.click();
  await expect.poll(() => writes).toBe(2);
  expect(receiptToUnlockMs).toBeLessThan(1000);
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  await expect(page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'})).toBeEnabled();
});

test('an older refresh cannot overwrite a second accepted task change', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let writes = 0;
  const reads: {snapshot: AppState; release: () => void; completed: Promise<void>}[] = [];
  await page.route('**/api/state', async route => {
    if (!writes) return route.fulfill({json: state});
    let release!: () => void;
    const held = new Promise<void>(resolve => {release = resolve;});
    let finish!: () => void;
    const completed = new Promise<void>(resolve => {finish = resolve;});
    const snapshot = structuredClone(state);
    reads.push({snapshot, release, completed});
    await held;
    await route.fulfill({json: snapshot});
    finish();
  });
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    expect(command.payload.expected_revision).toBe(state.tasks[0].revision);
    state.tasks[0] = {...state.tasks[0], progress: command.payload.progress, revision: state.tasks[0].revision + 1};
    writes++;
    await route.fulfill({json: {ok: true, id: state.tasks[0].id, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page);
  try {
    await page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'}).click();
    await expect.poll(() => reads.length).toBe(1);
    const undo = page.getByRole('button', {name: 'Ardışık kayıt tamamlamasını geri al'});
    await expect(undo).toBeEnabled({timeout: 1000});
    await undo.click();
    await expect.poll(() => reads.length).toBe(2);
    expect(reads[0].snapshot.tasks[0].progress).toBe(1);
    expect(reads[1].snapshot.tasks[0].progress).toBe(0);
    reads[0].release();
    await reads[0].completed;
    await expect(page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'})).toBeEnabled();
    await expect(page.locator('.sync-status')).toContainText('Görünüm güncelleniyor');
    reads[1].release();
    await reads[1].completed;
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(page.locator('.notice.error[role="alert"]')).toHaveCount(0);
  } finally {reads.forEach(read => read.release());}
});

test('journal creation uses its confirmed ID for another save during a held refresh', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  const id = '33333333-3333-4333-8333-333333333333';
  let writes = 0;
  const releases: (() => void)[] = [];
  await page.route('**/api/state', async route => {
    if (!writes) return route.fulfill({json: state});
    const snapshot = structuredClone(state);
    await new Promise<void>(resolve => {releases.push(resolve);});
    await route.fulfill({json: snapshot});
  });
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    if (!writes) {
      expect(command.type).toBe('journal.create');
      state.journal_entries = [{id, journal_date: command.payload.journal_date,
        original_text: command.payload.original_text, structured_fields: {}, ai_shared_fields: [],
        exclude_from_analysis: false, revision: 1, created_at: state.server_now, updated_at: state.server_now}];
    } else {
      expect(command).toMatchObject({type: 'journal.update', payload: {id, expected_revision: 1}});
      state.journal_entries[0] = {...state.journal_entries[0], original_text: command.payload.original_text, revision: 2};
    }
    writes++;
    await route.fulfill({json: {ok: true, id, request_id: command.request_id, replayed: false}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Günlüğüm', exact: true}).click();
  try {
    await page.getByLabel('Bugün aklında neler kaldı?').fill('İlk kayıt');
    await page.getByRole('button', {name: 'Günlüğü kaydet'}).click();
    await expect.poll(() => releases.length).toBe(1);
    await expect(page.getByRole('button', {name: 'Günlüğü kaydet'})).toBeEnabled({timeout: 1000});
    await page.getByLabel('Bugün aklında neler kaldı?').fill('İkinci kayıt');
    await page.getByRole('button', {name: 'Günlüğü kaydet'}).click();
    await expect.poll(() => writes).toBe(2);
  } finally {releases.forEach(release => release());}
  await expect(page.getByLabel('Bugün aklında neler kaldı?')).toHaveValue('İkinci kayıt');
});

test('failed state refresh preserves an accepted task save and allows another action', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let writes = 0;
  await page.route('**/api/state', route => writes
    ? route.fulfill({status: 503, json: {ok: false, error: {message: 'Görünüm geçici olarak alınamadı.'}}})
    : route.fulfill({json: state}));
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    expect(command.payload.expected_revision).toBe(state.tasks[0].revision);
    state.tasks[0] = {...state.tasks[0], progress: command.payload.progress, revision: state.tasks[0].revision + 1};
    writes++;
    await route.fulfill({json: {ok: true, id: state.tasks[0].id, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page);
  await page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'}).click();
  await expect(page.getByRole('alert').filter({hasText: 'Kayıt tamamlandı'})).toBeVisible();
  const undo = page.getByRole('button', {name: 'Ardışık kayıt tamamlamasını geri al'});
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => writes).toBe(2);
});

test('an obsolete failed refresh cannot clear the next pending save or show an error', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  let writes = 0;
  let refreshStarted = false;
  let releaseRefresh!: () => void;
  const heldRefresh = new Promise<void>(resolve => {releaseRefresh = resolve;});
  let releaseWrite!: () => void;
  const heldWrite = new Promise<void>(resolve => {releaseWrite = resolve;});
  let refreshFinished!: () => void;
  const refreshComplete = new Promise<void>(resolve => {refreshFinished = resolve;});
  await page.route('**/api/state', async route => {
    if (writes !== 1) return route.fulfill({json: state});
    refreshStarted = true;
    await heldRefresh;
    await route.fulfill({status: 503, json: {error: {message: 'Eski görünüm alınamadı.'}}});
    refreshFinished();
  });
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    expect(command.payload.expected_revision).toBe(state.tasks[0].revision);
    writes++;
    if (writes === 2) await heldWrite;
    state.tasks[0] = {...state.tasks[0], progress: command.payload.progress, revision: state.tasks[0].revision + 1};
    await route.fulfill({json: {ok: true, id: state.tasks[0].id, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page);
  try {
    await page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'}).click();
    await expect.poll(() => refreshStarted).toBe(true);
    const undo = page.getByRole('button', {name: 'Ardışık kayıt tamamlamasını geri al'});
    await expect(undo).toBeEnabled({timeout: 1000});
    await undo.click();
    await expect.poll(() => writes).toBe(2);
    releaseRefresh();
    await refreshComplete;
    await expect(page.locator('.sync-status')).toContainText('Kaydediliyor');
    await expect(page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'})).toBeDisabled();
    await expect(page.locator('.notice.error[role="alert"]')).toHaveCount(0);
    releaseWrite();
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(page.getByRole('button', {name: 'Ardışık kayıt görevini tamamla'})).toBeEnabled();
  } finally {releaseRefresh(); releaseWrite();}
});

test('deleting a task obtains revised linked timer state before the next timer action', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  const started = new Date(Date.now() - 40 * 60_000).toISOString();
  const sessionId = '33333333-3333-4333-8333-333333333333';
  state.sessions = [{id: sessionId, title: 'Bağlı çalışma', task_id: state.tasks[0].id,
    topic_id: null, subject: null, study_type: 'Tekrar', mode: 'stopwatch', target_seconds: null,
    status: 'running', started_at: started, active_since: started, accumulated_seconds: 0, finished_at: null, revision: 1}];
  state.intervals = [{id: 'interval', session_id: sessionId, started_at: started, ended_at: null}];
  const commands: {request_id: string; type: string; payload: {expected_revision: number}}[] = [];
  const releases: (() => void)[] = [];
  let deletePreference: string | undefined;
  await page.route('**/api/state', async route => {
    if (commands.length) await new Promise<void>(resolve => {releases.push(resolve);});
    await route.fulfill({json: state});
  });
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.delete') {
      state.tasks = [];
      state.sessions[0] = {...state.sessions[0], task_id: null, revision: 2};
      deletePreference = route.request().headers()['prefer'];
      const receipt = {ok: true, id: command.payload.id, request_id: command.request_id, replayed: false};
      return route.fulfill({json: deletePreference === 'return=minimal' ? receipt : {...receipt, state}});
    }
    if (command.type === 'timer.pause' && command.payload.expected_revision === 2) {
      state.sessions[0] = {...state.sessions[0], status: 'paused', active_since: null, revision: 3};
      state.intervals[0] = {...state.intervals[0], ended_at: state.server_now};
      return route.fulfill({json: {ok: true, id: sessionId, request_id: command.request_id, replayed: false, state}});
    }
    await route.fulfill({status: 409, json: {error: {message: 'Bağlı sayaç sürümü eskidi.'}}});
  });
  await openTasks(page);
  try {
    await page.getByRole('button', {name: 'Ardışık kayıt düzenle'}).click();
    await page.getByRole('dialog', {name: 'Görevi düzenle'}).getByRole('button', {name: 'Sil', exact: true}).click();
    await page.getByRole('dialog', {name: 'Görevi sil'}).getByRole('button', {name: 'Görevi sil', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Görevi sil'})).not.toBeVisible();
    await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Bugün', exact: true}).click();
    await page.getByRole('button', {name: 'Sayaç — çalışma sayacını aç', exact: true}).first().click();
    await page.getByRole('dialog', {name: 'Çalışma sayacı'}).getByRole('button', {name: 'Duraklat', exact: true}).click();
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1]).toMatchObject({type: 'timer.pause', payload: {expected_revision: 2}});
    expect(deletePreference).not.toBe('return=minimal');
    await expect(page.getByRole('dialog', {name: 'Çalışma sayacı'}).getByRole('button', {name: 'Sürdür', exact: true})).toBeEnabled();
  } finally {releases.forEach(release => release());}
});

test('retrying an update after its response is lost restores the server revision before another edit', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task()]};
  const commands: {request_id: string; type: string; payload: {expected_revision: number; progress?: number; title?: string}}[] = [];
  let retryPreference: string | undefined;
  const releases: (() => void)[] = [];
  await page.route('**/api/state', async route => {
    if (commands.length === 2) await new Promise<void>(resolve => {releases.push(resolve);});
    await route.fulfill({json: state});
  });
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) {
      state.tasks[0] = {...state.tasks[0], title: command.payload.title, revision: 2};
      return route.abort('failed');
    }
    if (commands.length === 2) {
      expect(command.request_id).toBe(commands[0].request_id);
      retryPreference = route.request().headers()['prefer'];
      const receipt = {ok: true, id: state.tasks[0].id, request_id: command.request_id, replayed: true};
      return route.fulfill({json: retryPreference === 'return=minimal' ? receipt : {...receipt, state}});
    }
    if (command.payload.expected_revision === state.tasks[0].revision) {
      state.tasks[0] = {...state.tasks[0], progress: command.payload.progress!, revision: 3};
      return route.fulfill({json: {ok: true, id: state.tasks[0].id, request_id: command.request_id, replayed: false}});
    }
    await route.fulfill({status: 409, json: {error: {message: 'Tekrarlanan kayıttan sonra sürüm eskidi.'}}});
  });
  await openTasks(page);
  try {
    await page.getByRole('button', {name: 'Ardışık kayıt düzenle'}).click();
    const dialog = page.getByRole('dialog', {name: 'Görevi düzenle'});
    await dialog.getByLabel('Görev başlığı').fill('Yanıtı kaybolan görev');
    await dialog.getByRole('button', {name: 'Görevi kaydet', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Görevi kaydet', exact: true})).toBeEnabled();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', {name: 'Görevi kaydet', exact: true}).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', {name: 'Yanıtı kaybolan görev görevini tamamla'}).click();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2].payload.expected_revision).toBe(2);
    expect(retryPreference).not.toBe('return=minimal');
    await expect(page.getByRole('button', {name: 'Yanıtı kaybolan görev tamamlamasını geri al'})).toBeEnabled();
  } finally {releases.forEach(release => release());}
});
