import {expect, test} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';
import {localDate} from '../../src/lib/ui';

function task(id: string, title: string): Task {
  return {id, title, plan_date: localDate(), exam: null, subject: null, topic_id: null,
    resource: '', completion_criteria: '', planned_minutes: 30, difficulty: 'medium', progress: 0,
    weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Tekrar', steps: [],
    revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString()};
}

test('task toggle, delete and the next task update do not wait for a slow first receipt', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [
    task('22222222-2222-4222-8222-222222222222', 'Birinci'),
    task('33333333-3333-4333-8333-333333333333', 'İkinci'),
  ]};
  const commands: {type: string; payload: {id: string; expected_revision: number; progress: number}}[] = [];
  let releaseFirst!: () => void;
  const firstReceipt = new Promise<void>(resolve => {releaseFirst = resolve;});
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) await firstReceipt;
    const row = state.tasks.find(item => item.id === command.payload.id)!;
    expect(command.payload.expected_revision).toBe(row.revision);
    if (command.type === 'task.delete') state.tasks = state.tasks.filter(item => item.id !== row.id);
    else state.tasks = state.tasks.map(item => item.id === row.id
      ? {...item, progress: command.payload.progress, revision: item.revision + 1} : item);
    const receipt = {ok: true, id: row.id, request_id: command.request_id, replayed: false};
    await route.fulfill({json: command.type === 'task.delete' ? {...receipt, state} : receipt});
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', {name: 'Ana gezinme'});
  await nav.getByRole('button', {name: 'Görevlerim', exact: true}).click();
  try {
    await page.getByRole('button', {name: 'Birinci görevini tamamla'}).click();
    await expect(page.getByRole('button', {name: 'Birinci tamamlamasını geri al'})).toBeEnabled({timeout: 1000});
    await page.getByRole('button', {name: 'Birinci düzenle'}).click();
    await page.getByRole('dialog', {name: 'Görevi düzenle'}).getByRole('button', {name: 'Sil', exact: true}).click();
    await page.getByRole('dialog', {name: 'Görevi sil'}).getByRole('button', {name: 'Görevi sil', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Görevi sil'})).not.toBeVisible({timeout: 1000});
    await expect(page.getByRole('button', {name: 'Birinci düzenle'})).toHaveCount(0);
    await page.getByRole('button', {name: 'İkinci görevini tamamla'}).click();
    await expect(page.getByRole('button', {name: 'İkinci tamamlamasını geri al'})).toBeEnabled({timeout: 1000});
    expect(commands).toHaveLength(1);
    releaseFirst();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands.map(command => [command.type, command.payload.expected_revision])).toEqual([
      ['task.update', 1], ['task.delete', 2], ['task.update', 1],
    ]);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(page.getByRole('button', {name: 'İkinci tamamlamasını geri al'})).toBeEnabled();
    await expect(page.getByRole('button', {name: 'Birinci düzenle'})).toHaveCount(0);
  } finally {releaseFirst();}
});

test('timer start and pause are immediate while the start receipt is held and use its confirmed ID', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const commands: {type: string; payload: {id?: string; expected_revision?: number}}[] = [];
  let releaseFirst!: () => void;
  const firstReceipt = new Promise<void>(resolve => {releaseFirst = resolve;});
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'timer.start') {
      await firstReceipt;
      const now = new Date().toISOString();
      state.sessions = [{id: sessionId, ...command.payload, status: 'running', started_at: now,
        active_since: now, accumulated_seconds: 0, finished_at: null, revision: 1}];
      state.intervals = [{id: 'interval', session_id: sessionId, started_at: now, ended_at: null}];
    } else {
      expect(command).toMatchObject({type: 'timer.pause', payload: {id: sessionId, expected_revision: 1}});
      state.sessions[0] = {...state.sessions[0], status: 'paused', active_since: null, revision: 2};
      state.intervals[0] = {...state.intervals[0], ended_at: new Date().toISOString()};
    }
    await route.fulfill({json: {ok: true, id: sessionId, request_id: command.request_id, replayed: false, state}});
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Sayacı büyüt', exact: true}).first().click();
  const focus = page.getByRole('dialog', {name: 'Odak ekranı', exact: true});
  try {
    await focus.getByRole('group', {name: 'TYT dersi'}).getByRole('button', {name: 'Matematik', exact: true}).click();
    await focus.getByRole('button', {name: 'Kronometre', exact: true}).click();
    await focus.getByRole('button', {name: 'Çalışmaya başla', exact: true}).click();
    const pause = focus.getByRole('button', {name: 'Sayacı duraklat', exact: true});
    await expect(pause).toBeEnabled({timeout: 1000});
    await pause.click();
    await expect(focus.getByRole('button', {name: 'Sayacı sürdür', exact: true})).toBeEnabled({timeout: 1000});
    expect(commands).toHaveLength(1);
    releaseFirst();
    await expect.poll(() => commands.length).toBe(2);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(focus.getByRole('button', {name: 'Sayacı sürdür', exact: true})).toBeEnabled();
  } finally {releaseFirst();}
});

test('a pending exam form cannot create a second row when its suggested name changes', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, exam_formats: [{code: 'TYT', version: 1,
    label: 'TYT', total_questions: 40, wrong_divisor: 4, sections: [{key: 'math', label: 'Matematik', question_count: 40}]}]};
  let writes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    writes++;
    await held;
    await route.fulfill({json: {ok: true, id: '55555555-5555-4555-8555-555555555555', request_id: command.request_id, replayed: false}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Sınav Sonuçları', exact: true}).click();
  await page.getByRole('button', {name: 'Deneme ekle', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Yeni deneme ekle'});
  try {
    await dialog.getByLabel('Matematik doğru', {exact: true}).fill('30');
    await dialog.getByRole('button', {name: 'Denemeyi kaydet', exact: true}).click();
    await expect(dialog.locator('input[name="name"]')).toHaveAttribute('placeholder', 'Boşsa 2. deneme');
    await expect(dialog.getByRole('button', {name: 'Kaydediliyor…', exact: true})).toBeDisabled();
    // Native repeated submit/Enter must also be guarded, even though the derived
    // default name has changed after the first optimistic row was installed.
    await dialog.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit());
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '1');
    await expect(dialog.locator('input[name="name"]')).toHaveAttribute('placeholder', 'Boşsa 2. deneme');
    release();
    await expect(dialog).not.toBeVisible();
    expect(writes).toBe(1);
  } finally {release();}
});

for (const failure of ['command', 'recovery'] as const) test(`expired authentication during ${failure} exits a queue with another accepted action`, async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task('22222222-2222-4222-8222-222222222222', 'Birinci'),
    task('33333333-3333-4333-8333-333333333333', 'İkinci')]};
  let writes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/state', route => writes
    ? route.fulfill({status: 401, json: {...emptyState(true), error: {message: 'Oturum sona erdi.'}}})
    : route.fulfill({json: state}));
  await page.route('**/api/command', async route => {
    writes++;
    await held;
    await route.fulfill({status: failure === 'command' ? 401 : 409, json: {error: {message: 'Kayıt yetkisi sona erdi.'}}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
  try {
    await page.getByRole('button', {name: 'Birinci görevini tamamla'}).click();
    await page.getByRole('button', {name: 'İkinci görevini tamamla'}).click();
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '2');
    release();
    await expect(page.getByRole('heading', {name: 'Yolculuğuna devam et.'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Giriş yap', exact: true})).toBeEnabled();
    expect(writes).toBe(1);
    await expect(page.locator('[data-pending-commands]')).toHaveCount(0);
  } finally {release();}
});

test('an unknown receipt pauses later writes and the persistent retry resolves the same request before them', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true, tasks: [task('22222222-2222-4222-8222-222222222222', 'Birinci'),
    task('33333333-3333-4333-8333-333333333333', 'İkinci')]};
  const commands: {request_id: string; payload: {id: string; progress: number; expected_revision: number}}[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) {
      await held;
      state.tasks[0] = {...state.tasks[0], progress: 1, revision: 2};
      return route.abort('failed');
    }
    if (commands.length === 2) {
      expect(command).toEqual(commands[0]);
      return route.fulfill({json: {ok: true, id: state.tasks[0].id, request_id: command.request_id, replayed: true, state}});
    }
    expect(command.payload.id).toBe(state.tasks[1].id);
    expect(command.payload.expected_revision).toBe(1);
    state.tasks[1] = {...state.tasks[1], progress: 1, revision: 2};
    await route.fulfill({json: {ok: true, id: command.payload.id, request_id: command.request_id, replayed: false}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
  try {
    await page.getByRole('button', {name: 'Birinci görevini tamamla'}).click();
    await page.getByRole('button', {name: 'İkinci görevini tamamla'}).click();
    release();
    const retry = page.getByRole('button', {name: 'Bekleyen kayıtları yeniden dene', exact: true});
    await expect(retry).toBeVisible();
    expect(commands).toHaveLength(1);
    await expect(page.getByRole('button', {name: 'Uyarıyı kapat', exact: true})).toHaveCount(0);
    await retry.click();
    await expect.poll(() => commands.length).toBe(3);
    await expect(page.getByRole('button', {name: 'İkinci tamamlamasını geri al'})).toBeEnabled();
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
  } finally {release();}
});
