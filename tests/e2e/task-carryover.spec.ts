import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';

const monday = '2026-09-28';
const tuesday = '2026-09-29';
const wednesday = '2026-09-30';
const sunday = '2026-09-27';
const stamp = '2026-09-28T09:00:00.000Z';

function task(id: string, title: string, plan_date: string, progress: number, position = 0): Task {
  return {id, title, plan_date, exam: null, subject: null, topic_id: null, resource: '', completion_criteria: '',
    planned_minutes: 40, difficulty: 'medium', progress, weight_override: null, priority: 'normal', position,
    notes: '', study_type: 'Tekrar', steps: [], revision: 1, created_at: stamp, updated_at: stamp};
}

async function openTasks(page: Page, state: AppState) {
  await page.route('**/api/state', route => route.fulfill({json: {...state, server_now: stamp}}));
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
}

test('task form saves on the creation day and preserves values removed from the form', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  state.tasks = [{...task('existing', 'Eski görev', tuesday, 0.4), resource: 'Kaynak 1', weight_override: 12}];
  const commands: {type: string; payload: Record<string, unknown>}[] = [];
  await page.route('**/api/command', route => {
    commands.push(route.request().postDataJSON());
    return route.fulfill({json: {ok: true, state}});
  });
  await openTasks(page, state);
  await page.getByLabel('Plan tarihi').fill(monday);
  await page.getByRole('tab', {name: 'Geçmiş görevler'}).click();
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('done');
  await page.getByRole('button', {name: 'Görev ekle', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
  for (const label of ['Tarih', 'Kaynak / test / sayfa', 'İlerleme (%)', 'Özel ağırlık (isteğe bağlı)']) {
    await expect(dialog.getByLabel(label, {exact: true})).toHaveCount(0);
  }
  await dialog.getByLabel('Görev başlığı').fill('Salı görevi');
  await dialog.getByRole('button', {name: 'Görevi kaydet'}).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({type: 'task.create', payload: {title: 'Salı görevi', plan_date: tuesday}});
  for (const field of ['resource', 'progress', 'weight_override']) expect(commands[0].payload).not.toHaveProperty(field);
  await expect(page.getByRole('tab', {name: 'Günün görevleri'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Plan tarihi')).toHaveValue(tuesday);
  await expect(page.getByRole('combobox', {name: 'Görev durumu'})).toHaveValue('all');

  await page.getByRole('button', {name: 'Eski görev düzenle'}).click();
  const edit = page.getByRole('dialog', {name: 'Görevi düzenle'});
  await edit.getByLabel('Görev başlığı').fill('Düzenlenen görev');
  await edit.getByRole('button', {name: 'Görevi kaydet'}).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({type: 'task.update', payload: {id: 'existing', title: 'Düzenlenen görev'}});
  for (const field of ['plan_date', 'resource', 'progress', 'weight_override']) expect(commands[1].payload).not.toHaveProperty(field);
});

test('task form saves on the selected future day and keeps that day visible', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  const commands: {type: string; payload: Record<string, unknown>}[] = [];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.create') {
      state.tasks.push(task('created', String(command.payload.title), String(command.payload.plan_date), 0));
    }
    return route.fulfill({json: {ok: true, state}});
  });
  await openTasks(page, state);

  await page.getByLabel('Plan tarihi').fill(wednesday);
  await page.getByRole('button', {name: 'Görev ekle', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
  await dialog.getByLabel('Görev başlığı').fill('Çarşamba görevi');
  await dialog.getByRole('button', {name: 'Görevi kaydet'}).click();

  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({type: 'task.create', payload: {title: 'Çarşamba görevi', plan_date: wednesday}});
  await expect(page.getByLabel('Plan tarihi')).toHaveValue(wednesday);
  await expect(page.locator('.task-item h3')).toHaveText(['Çarşamba görevi']);
});

test('clearing the plan date filter creates a task for today', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  const commands: {type: string; payload: Record<string, unknown>}[] = [];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.create') {
      state.tasks.push(task('created-after-clear', String(command.payload.title), String(command.payload.plan_date), 0));
    }
    return route.fulfill({json: {ok: true, state}});
  });
  await openTasks(page, state);

  const planDate = page.getByLabel('Plan tarihi');
  await planDate.fill(wednesday);
  await planDate.fill('');
  await page.getByRole('button', {name: 'Görev ekle', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Yeni görev'});
  await dialog.getByLabel('Görev başlığı').fill('Bugünün görevi');
  await dialog.getByRole('button', {name: 'Görevi kaydet'}).click();

  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({type: 'task.create', payload: {title: 'Bugünün görevi', plan_date: tuesday}});
  await expect(planDate).toHaveValue(tuesday);
  await expect(page.locator('.task-item h3')).toHaveText(['Bugünün görevi']);
});

test('task can be deleted from its edit dialog after confirmation', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-28T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  state.tasks = [task('delete-me', 'Silinecek görev', monday, 0), task('keep-me', 'Kalacak görev', monday, 0, 1)];
  const commands: {type: string; payload: Record<string, unknown>}[] = [];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.delete') state.tasks = state.tasks.filter(item => item.id !== command.payload.id);
    return route.fulfill({json: {ok: true, state}});
  });
  await openTasks(page, state);

  await page.getByRole('button', {name: 'Silinecek görev düzenle'}).click();
  await page.getByRole('dialog', {name: 'Görevi düzenle'}).getByRole('button', {name: 'Sil', exact: true}).click();
  const confirmation = page.getByRole('dialog', {name: 'Görevi sil'});
  await expect(confirmation).toContainText('Silinecek görev');
  await confirmation.getByRole('button', {name: 'Vazgeç'}).click();
  expect(commands).toHaveLength(0);
  await expect(page.locator('.task-item h3')).toHaveText(['Silinecek görev', 'Kalacak görev']);

  await page.getByRole('button', {name: 'Silinecek görev düzenle'}).click();
  await page.getByRole('dialog', {name: 'Görevi düzenle'}).getByRole('button', {name: 'Sil', exact: true}).click();
  await page.getByRole('dialog', {name: 'Görevi sil'}).getByRole('button', {name: 'Görevi sil'}).click();
  await expect(page.locator('.task-item h3')).toHaveText(['Kalacak görev']);
  expect(commands).toMatchObject([{type: 'task.delete', payload: {id: 'delete-me', expected_revision: 1}}]);
});

test('day view shows one date and history keeps older tasks separate', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  state.tasks = [
    task('monday-open', 'Pazartesiden kalan', monday, 0),
    task('monday-partial', 'Pazartesi yarım', monday, 0.5, 1),
    task('monday-done', 'Pazartesi biten', monday, 1, 2),
    task('tuesday-open', 'Salı görevi', tuesday, 0),
    task('tuesday-done', 'Salı biten', tuesday, 1, 1),
    task('sunday-open', 'Pazar görevi', sunday, 0),
    task('wednesday-open', 'Çarşamba görevi', wednesday, 0),
  ];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    if (command.type === 'task.update') {
      state.tasks = state.tasks.map(item => item.id === command.payload.id
        ? {...item, progress: command.payload.progress, revision: item.revision + 1} : item);
    }
    return route.fulfill({json: {ok: true, state}});
  });
  await openTasks(page, state);
  const dayTab = page.getByRole('tab', {name: 'Günün görevleri'});
  const historyTab = page.getByRole('tab', {name: 'Geçmiş görevler'});
  await expect(dayTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.task-item h3')).toHaveText(['Salı görevi', 'Salı biten']);
  await expect(page.getByText('Pazartesiden kalan', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Çarşamba görevi', {exact: true})).toHaveCount(0);
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('done');
  await expect(page.locator('.task-item h3')).toHaveText(['Salı biten']);
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('open');
  await expect(page.locator('.task-item h3')).toHaveText(['Salı görevi']);
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('all');
  await expect(page.getByRole('button', {name: 'Salı görevi yukarı taşı'})).toBeDisabled();

  await historyTab.click();
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesiden kalan', 'Pazartesi yarım', 'Pazartesi biten', 'Pazar görevi']);
  await expect(page.getByText('Salı görevi', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Çarşamba görevi', {exact: true})).toHaveCount(0);
  for (const title of ['Pazartesiden kalan', 'Pazartesi yarım', 'Pazartesi biten']) {
    await expect(page.locator('.task-item').filter({hasText: title})).toContainText('28 Eyl');
  }
  await expect(page.locator('.task-item').filter({hasText: 'Pazar görevi'})).toContainText('27 Eyl');
  await expect(page.getByRole('button', {name: 'Pazartesiden kalan yukarı taşı'})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Pazartesiden kalan aşağı taşı'})).toBeDisabled();
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('done');
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesi biten']);
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('open');
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesiden kalan', 'Pazartesi yarım', 'Pazar görevi']);
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('all');

  await dayTab.click();
  await page.getByLabel('Plan tarihi').fill(monday);
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesiden kalan', 'Pazartesi yarım', 'Pazartesi biten']);
  await expect(page.getByText('Pazar görevi', {exact: true})).toHaveCount(0);
  await page.getByLabel('Plan tarihi').fill(tuesday);
  await expect(page.locator('.task-item h3')).toHaveText(['Salı görevi', 'Salı biten']);
});
