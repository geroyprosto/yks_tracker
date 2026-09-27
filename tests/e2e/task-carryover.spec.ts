import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';

const monday = '2026-09-28';
const tuesday = '2026-09-29';
const wednesday = '2026-09-30';
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
  await expect(page.getByLabel('Plan tarihi')).toHaveValue(tuesday);

  await page.getByRole('button', {name: 'Eski görev düzenle'}).click();
  const edit = page.getByRole('dialog', {name: 'Görevi düzenle'});
  await edit.getByLabel('Görev başlığı').fill('Düzenlenen görev');
  await edit.getByRole('button', {name: 'Görevi kaydet'}).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({type: 'task.update', payload: {id: 'existing', title: 'Düzenlenen görev'}});
  for (const field of ['plan_date', 'resource', 'progress', 'weight_override']) expect(commands[1].payload).not.toHaveProperty(field);
});

test('today shows unfinished earlier tasks without moving them into today', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  state.tasks = [
    task('monday-open', 'Pazartesiden kalan', monday, 0),
    task('monday-partial', 'Pazartesi yarım', monday, 0.5, 1),
    task('monday-done', 'Pazartesi biten', monday, 1, 2),
    task('tuesday-open', 'Salı görevi', tuesday, 0),
    task('tuesday-done', 'Salı biten', tuesday, 1, 1),
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
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesiden kalan', 'Pazartesi yarım', 'Salı görevi', 'Salı biten']);
  await expect(page.getByText('Pazartesi biten', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Çarşamba görevi', {exact: true})).toHaveCount(0);
  await expect(page.getByText('28 Eyl tarihinden kaldı')).toHaveCount(2);
  await expect(page.getByRole('button', {name: 'Pazartesiden kalan yukarı taşı'})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Pazartesiden kalan aşağı taşı'})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Salı görevi yukarı taşı'})).toBeDisabled();
  await page.getByRole('button', {name: 'Pazartesiden kalan görevini tamamla'}).click();
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesi yarım', 'Salı görevi', 'Salı biten']);
  await page.getByRole('combobox', {name: 'Görev durumu'}).selectOption('done');
  await expect(page.locator('.task-item h3')).toHaveText(['Salı biten']);
  await expect(page.getByRole('button', {name: 'Salı biten yukarı taşı'})).toBeDisabled();
  await page.getByLabel('Plan tarihi').fill(monday);
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesiden kalan', 'Pazartesi biten']);
});
