import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';
import {localDate} from '../../src/lib/ui';

type Command = {request_id: string; type: string; payload: Partial<Task> & {expected_revision?: number}};
const firstId = '66666666-6666-4666-8666-666666666666';
const secondId = '77777777-7777-4777-8777-777777777777';

function task(id: string, payload: Partial<Task>, position = 0): Task {
  const now = new Date().toISOString();
  return {title: '', plan_date: localDate(), exam: null, subject: null, topic_id: null,
    resource: '', completion_criteria: '', planned_minutes: 40, difficulty: 'medium', progress: 0,
    weight_override: null, priority: 'normal', position, notes: '', study_type: 'Soru çözümü', steps: [],
    revision: 1, created_at: now, updated_at: now, ...payload, id};
}

async function openTasks(page: Page, state: AppState) {
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
}

async function addTask(page: Page, title: string, plannedMinutes = 40) {
  await page.getByRole('button', {name: 'Görev ekle', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
  await dialog.getByLabel('Görev başlığı').fill(title);
  await dialog.getByLabel('Planlanan net dakika').fill(String(plannedMinutes));
  await dialog.getByRole('button', {name: 'Görevi kaydet', exact: true}).click();
  await expect(dialog).not.toBeVisible({timeout: 1000});
  await expect(page.getByRole('button', {name: title + ' düzenle', exact: true})).toBeEnabled();
}

test('new task saves immediately and queued edits use its confirmed ID and revisions', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  const commands: Command[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) await held;
    let id: string;
    if (command.type === 'task.create') {
      id = state.tasks.length ? secondId : firstId;
      state.tasks.push(task(id, command.payload, state.tasks.length));
    } else {
      const row = state.tasks.find(item => item.id === command.payload.id)!;
      expect(command.payload.expected_revision).toBe(row.revision);
      id = row.id;
      state.tasks = state.tasks.map(item => item.id === id
        ? {...item, ...command.payload, revision: item.revision + 1} : item);
    }
    await route.fulfill({json: {ok: true, id, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page, state);
  try {
    await addTask(page, 'İlk hızlı görev');
    await expect.poll(() => commands.length).toBe(1);
    const measurement=JSON.parse(await page.locator('.app-shell').getAttribute('data-save-metrics')??'[]').at(-1);
    console.log('New task while response is held:',JSON.stringify(measurement));
    await page.screenshot({path:test.info().outputPath('new-task-pending.png')});
    await addTask(page, 'İkinci hızlı görev');
    await page.getByRole('button', {name: 'İlk hızlı görev düzenle', exact: true}).click();
    const edit = page.getByRole('dialog', {name: 'Görevi düzenle'});
    await edit.getByLabel('Görev başlığı').fill('Düzenlenen hızlı görev');
    await edit.getByRole('button', {name: 'Görevi kaydet', exact: true}).click();
    await expect(edit).toBeVisible();
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '3');
    expect(commands).toHaveLength(1);
    release();
    await expect(edit).not.toBeVisible();
    await page.getByRole('button', {name: 'Düzenlenen hızlı görev görevini tamamla', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Düzenlenen hızlı görev tamamlamasını geri al', exact: true})).toBeEnabled();
    await expect.poll(() => commands.length).toBe(4);
    expect(commands.slice(2)).toMatchObject([
      {type: 'task.update', payload: {id: firstId, expected_revision: 1, title: 'Düzenlenen hızlı görev'}},
      {type: 'task.update', payload: {id: firstId, expected_revision: 2, progress: 1}},
    ]);
    expect(new Set(commands.map(command => command.request_id)).size).toBe(4);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(page.locator('.task-item h3')).toHaveText(['Düzenlenen hızlı görev', 'İkinci hızlı görev']);
  } finally {release();}
});

test('a rejected create restores its draft, removes the optimistic task and cancels its queued progress', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  let writes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/command', async route => {
    writes++;
    await held;
    await route.fulfill({status: 400, json: {error: {message: 'Yeni görev doğrulanamadı.'}}});
  });
  await openTasks(page, state);
  try {
    await addTask(page, 'Reddedilecek görev', 75);
    await page.getByRole('button', {name: 'Reddedilecek görev görevini tamamla', exact: true}).click();
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '2');
    release();
    await expect(page.locator('.task-item')).toHaveCount(0);
    const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Görev başlığı')).toHaveValue('Reddedilecek görev');
    await expect(dialog.getByLabel('Planlanan net dakika')).toHaveValue('75');
    await expect(dialog.getByRole('alert')).toContainText('Yeni görev doğrulanamadı.');
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
    expect(writes).toBe(1);
    await expect(dialog.getByRole('button', {name: 'Görevi kaydet', exact: true})).toBeEnabled();
  } finally {release();}
});

test('a rejected earlier create does not overwrite a newer unsaved task draft', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  let writes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/command', async route => {
    writes++;
    await held;
    await route.fulfill({status: 400, json: {error: {message: 'Önceki görev doğrulanamadı.'}}});
  });
  await openTasks(page, state);
  try {
    await addTask(page, 'Eski taslak', 75);
    await page.getByRole('button', {name: 'Görev ekle', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
    await dialog.getByLabel('Görev başlığı').fill('Üzerinde çalışılan yeni taslak');
    await dialog.getByLabel('Planlanan net dakika').fill('45');
    release();
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Görev başlığı')).toHaveValue('Üzerinde çalışılan yeni taslak');
    await expect(dialog.getByLabel('Planlanan net dakika')).toHaveValue('45');
    await expect(dialog.getByRole('alert')).toContainText('Önceki görev doğrulanamadı.');
    await expect(page.locator('.task-item')).toHaveCount(0);
    expect(writes).toBe(1);
  } finally {release();}
});

test('independent rejected task drafts remain recoverable when one is saved again', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  const commands: Command[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) await held;
    if (commands.length <= 2) {
      return route.fulfill({status: 400, json: {error: {message: command.payload.title + ' kaydedilemedi.'}}});
    }
    state.tasks.push(task(firstId, command.payload));
    await route.fulfill({json: {ok: true, id: firstId, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page, state);
  try {
    await addTask(page, 'A', 75);
    await addTask(page, 'B', 45);
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '2');
    release();
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
    const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
    await expect(dialog.getByLabel('Görev başlığı')).toHaveValue('B');
    await expect(dialog.getByLabel('Planlanan net dakika')).toHaveValue('45');
    await page.keyboard.press('Escape');
    const reopenA = page.getByRole('button', {name: 'A yeniden aç', exact: true});
    const reopenB = page.getByRole('button', {name: 'B yeniden aç', exact: true});
    await expect(reopenA).toBeVisible();
    await expect(reopenB).toBeVisible();
    await reopenA.click();
    await expect(dialog.getByLabel('Görev başlığı')).toHaveValue('A');
    await expect(dialog.getByLabel('Planlanan net dakika')).toHaveValue('75');
    await page.keyboard.press('Escape');
    await reopenB.click();
    await expect(dialog.getByLabel('Görev başlığı')).toHaveValue('B');
    await expect(dialog.getByLabel('Planlanan net dakika')).toHaveValue('45');
    await page.keyboard.press('Escape');
    await reopenA.click();
    await dialog.getByRole('button', {name: 'Görevi kaydet', exact: true}).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2]).toMatchObject({type: 'task.create', payload: {title: 'A', planned_minutes: 75}});
    expect(commands[2].request_id).not.toBe(commands[0].request_id);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(page.getByRole('button', {name: 'A düzenle', exact: true})).toBeEnabled();
    await expect(reopenA).toHaveCount(0);
    await expect(reopenB).toBeVisible();
    await reopenB.click();
    await expect(dialog.getByLabel('Görev başlığı')).toHaveValue('B');
    await expect(dialog.getByLabel('Planlanan net dakika')).toHaveValue('45');
  } finally {release();}
});

test('a lost create receipt pauses later saves until retry replays the same request once', async ({page}) => {
  const state: AppState = {...emptyState(true), authenticated: true};
  const commands: Command[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/command', async route => {
    const command: Command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) {
      await held;
      state.tasks.push(task(firstId, command.payload));
      return route.abort('failed');
    }
    if (commands.length === 2) {
      expect(command).toEqual(commands[0]);
      return route.fulfill({json: {ok: true, id: firstId, request_id: command.request_id, replayed: true, state}});
    }
    state.tasks.push(task(secondId, command.payload, 1));
    await route.fulfill({json: {ok: true, id: secondId, request_id: command.request_id, replayed: false}});
  });
  await openTasks(page, state);
  try {
    await addTask(page, 'Yanıtı kaybolan görev');
    await addTask(page, 'Sırada bekleyen görev');
    release();
    const retry = page.getByRole('button', {name: 'Bekleyen kayıtları yeniden dene', exact: true});
    await expect(retry).toBeVisible();
    expect(commands).toHaveLength(1);
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '2');
    await expect(page.getByRole('button', {name: 'Uyarıyı kapat', exact: true})).toHaveCount(0);
    await retry.click();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2]).toMatchObject({type: 'task.create', payload: {title: 'Sırada bekleyen görev'}});
    expect(commands[2].request_id).not.toBe(commands[0].request_id);
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
    await expect(page.locator('.task-item h3')).toHaveText(['Yanıtı kaybolan görev', 'Sırada bekleyen görev']);
    await expect(retry).toHaveCount(0);
  } finally {release();}
});
