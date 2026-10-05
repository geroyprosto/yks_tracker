import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';
import {defaultModules, emptyEducation} from '../../src/lib/education';

const monday = '2026-09-28';
const tuesday = '2026-09-29';
const wednesday = '2026-09-30';
const sunday = '2026-09-27';
const stamp = '2026-09-28T09:00:00.000Z';
type TaskCommand = {request_id: string; type: string; payload: Record<string, unknown>};

function commandReceipt(command: TaskCommand, state: AppState,
  id = typeof command.payload.id === 'string' ? command.payload.id : command.request_id) {
  return {ok: true, id, request_id: command.request_id, replayed: false, state};
}

function task(id: string, title: string, plan_date: string, progress: number, position = 0): Task {
  return {id, title, plan_date, exam: null, subject: null, topic_id: null, resource: '', completion_criteria: '',
    planned_minutes: 40, difficulty: 'medium', progress, weight_override: null, priority: 'normal', position,
    notes: '', study_type: 'Tekrar', steps: [], revision: 1, created_at: stamp, updated_at: stamp};
}

async function openTasks(page: Page, state: AppState) {
  await page.route('**/api/state', route => route.fulfill({json: {...state, server_now: stamp}}));
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  }
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
}

for (const view of ['Bekleyenler', 'Tamamlananlar']) {
test(`creating from ${view} uses today and preserves fields removed from the edit form`, async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  state.tasks = [{...task('existing', 'Eski görev', tuesday, 0.4), resource: 'Kaynak 1', weight_override: 12}];
  const commands: TaskCommand[] = [];
  await page.route('**/api/command', route => {
    const command: TaskCommand = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.create') {
      const position = state.tasks.filter(item => item.plan_date === command.payload.plan_date).length;
      state.tasks.push({...task(command.request_id, String(command.payload.title), String(command.payload.plan_date), 0, position),
        ...command.payload});
    }
    if (command.type === 'task.update') {
      state.tasks = state.tasks.map(item => item.id === command.payload.id
        ? {...item, ...command.payload, revision: item.revision + 1} : item);
    }
    return route.fulfill({json: commandReceipt(command, state)});
  });
  await openTasks(page, state);
  await page.getByLabel('Plan tarihi').fill(monday);
  await page.getByRole('tab', {name: view}).click();
  await expect(page.getByRole('combobox', {name: 'Görev durumu'})).toHaveCount(0);
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
  await expect(page.getByRole('tab', {name: 'Bugün'})).toHaveAttribute('aria-selected', 'true');
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
}

test('task form saves on the selected future day and keeps that day visible', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  const commands: TaskCommand[] = [];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.create') {
      state.tasks.push(task('created', String(command.payload.title), String(command.payload.plan_date), 0));
    }
    return route.fulfill({json: commandReceipt(command, state, 'created')});
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
  const commands: TaskCommand[] = [];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.create') {
      state.tasks.push(task('created-after-clear', String(command.payload.title), String(command.payload.plan_date), 0));
    }
    return route.fulfill({json: commandReceipt(command, state, 'created-after-clear')});
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
  const commands: TaskCommand[] = [];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.delete') state.tasks = state.tasks.filter(item => item.id !== command.payload.id);
    return route.fulfill({json: commandReceipt(command, state)});
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

test('day, pending and completed views separate plan dates from completion status', async ({page}) => {
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
    return route.fulfill({json: commandReceipt(command, state)});
  });
  await openTasks(page, state);
  const dayTab = page.getByRole('tab', {name: 'Bugün'});
  const pendingTab = page.getByRole('tab', {name: 'Bekleyenler'});
  const completedTab = page.getByRole('tab', {name: 'Tamamlananlar'});
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

  await pendingTab.click();
  await expect(pendingTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.task-item h3')).toHaveText(['Pazar görevi', 'Pazartesiden kalan', 'Pazartesi yarım']);
  await expect(page.getByText('Salı görevi', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Pazartesi biten', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Çarşamba görevi', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('combobox', {name: 'Görev durumu'})).toHaveCount(0);
  for (const title of ['Pazartesiden kalan', 'Pazartesi yarım']) {
    await expect(page.locator('.task-item').filter({hasText: title})).toContainText('28 Eyl');
  }
  await expect(page.locator('.task-item').filter({hasText: 'Pazar görevi'})).toContainText('27 Eyl');
  await expect(page.getByRole('button', {name: 'Pazartesiden kalan yukarı taşı'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Pazartesiden kalan aşağı taşı'})).toHaveCount(0);
  await expect(page.locator('.task-item').filter({hasText: 'Pazartesiden kalan'}).getByRole('button', {name: 'Çalışmaya başla'})).toBeEnabled();

  await completedTab.click();
  await expect(completedTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', {name: 'Görev durumu'})).toHaveCount(0);
  await expect(page.getByTestId('completed-task')).toHaveCount(0);
  const course = page.getByTestId('completed-course');
  await expect(course.locator(':scope > summary')).toContainText('Ders belirtilmemiş');
  await expect(course.locator(':scope > summary')).toContainText('2');
  await course.locator(':scope > summary').click();
  await expect(page.getByTestId('completed-task')).toHaveCount(2);
  await expect(page.getByText('Salı biten', {exact: true})).toBeVisible();
  await expect(page.getByText('Pazartesi biten', {exact: true})).toBeVisible();
  for (const title of ['Pazartesiden kalan', 'Salı görevi', 'Çarşamba görevi']) {
    await expect(page.getByText(title, {exact: true})).toHaveCount(0);
  }

  await dayTab.click();
  await page.getByLabel('Plan tarihi').fill(monday);
  await expect(page.locator('.task-item h3')).toHaveText(['Pazartesiden kalan', 'Pazartesi yarım', 'Pazartesi biten']);
  await expect(page.getByText('Pazar görevi', {exact: true})).toHaveCount(0);
  await page.getByLabel('Plan tarihi').fill(tuesday);
  await expect(page.locator('.task-item h3')).toHaveText(['Salı görevi', 'Salı biten']);
});

test('completed course and task details start closed and expose only useful archive actions', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  state.tasks = [{...task('completed-biology', 'Ekosistem ekolojisi pekiştirme', monday, 1),
    exam: 'TYT', subject: 'Biyoloji', resource: 'Ekosistem kaynak sayfası', notes: 'Tekrar notu',
    updated_at: '2026-09-29T08:00:00.000Z',
    steps: [{id: 'ecosystem-step', title: 'Ekosistem sorularını çöz', completed: true}]}];
  await openTasks(page, state);
  await page.getByRole('tab', {name: 'Tamamlananlar'}).click();

  const course = page.getByTestId('completed-course');
  await expect(course.locator(':scope > summary')).toContainText('TYT Biyoloji');
  await expect(course).not.toHaveAttribute('open');
  await expect(page.getByText('Ekosistem ekolojisi pekiştirme', {exact: true})).toHaveCount(0);
  await course.locator(':scope > summary').click();
  const completed = page.getByTestId('completed-task');
  await expect(completed).not.toHaveAttribute('open');
  await expect(completed.locator(':scope > summary')).toContainText('Plan: 28 Eyl 2026');
  await expect(completed.locator(':scope > summary')).not.toContainText('29 Eyl');
  await expect(completed.getByRole('button', {name: 'Tamamlamayı geri al'})).toHaveCount(0);
  await expect(completed.getByText('Ekosistem kaynak sayfası', {exact: true})).toHaveCount(0);
  await expect(completed.locator(':scope > summary .done')).toHaveCount(0);
  await expect(completed.locator(':scope > summary')).not.toContainText('%100');

  await completed.locator(':scope > summary').click();
  await expect(completed.getByRole('button', {name: 'Tamamlamayı geri al'})).toBeEnabled();
  await expect(completed.getByRole('button', {name: 'Ekosistem ekolojisi pekiştirme düzenle'})).toBeEnabled();
  await expect(completed.getByText('Ekosistem kaynak sayfası', {exact: true})).toBeVisible();
  await expect(completed.getByText('Tekrar notu', {exact: true})).toBeVisible();
  await expect(completed.getByRole('checkbox', {name: 'Ekosistem sorularını çöz'})).toBeChecked();
  await expect(completed.getByRole('button', {name: 'Çalışmaya başla'})).toHaveCount(0);
  await expect(completed.getByRole('button', {name: /taşı/})).toHaveCount(0);

  await course.locator(':scope > summary').click();
  await expect(page.getByTestId('completed-task')).toHaveCount(0);
});

test('completed groups keep TYT, AYT and course identities separate, including archived courses', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  const education = emptyEducation();
  education.can_commit = true;
  education.profile = {education_level: 'university', yks_goal: false, grade: null, department: 'İktisat',
    university_year: '1', yks_track: 'undecided', modules: {...defaultModules}, active_term_id: 'current-term',
    onboarding_completed_at: stamp, revision: 1};
  education.terms = [
    {id: 'current-term', academic_year: '2026–2027', name: 'Güz', starts_on: null, ends_on: null, archived: false, revision: 1, created_at: stamp},
    {id: 'previous-term', academic_year: '2025–2026', name: 'Bahar', starts_on: null, ends_on: null, archived: true, revision: 1, created_at: stamp},
  ];
  education.courses = [
    {id: 'current-course', term_id: 'current-term', name: 'Matematik', normalized_name: 'matematik', context: 'school', exam: null, archived: false, revision: 1, created_at: stamp, updated_at: stamp},
    {id: 'previous-course', term_id: 'previous-term', name: 'Matematik', normalized_name: 'matematik', context: 'school', exam: null, archived: true, revision: 1, created_at: stamp, updated_at: stamp},
  ];
  state.education = education;
  state.tasks = [
    {...task('tyt-one', 'TYT hücre tekrarı', monday, 1), exam: 'TYT', subject: 'Biyoloji'},
    {...task('tyt-two', 'TYT ekoloji tekrarı', tuesday, 1), exam: 'TYT', subject: 'Biyoloji'},
    {...task('ayt-one', 'AYT sistemler tekrarı', monday, 1), exam: 'AYT', subject: 'Biyoloji'},
    {...task('current-course-task', 'Güz matematik görevi', monday, 1), course_id: 'current-course', subject: 'Matematik'},
    {...task('previous-course-task', 'Bahar matematik görevi', sunday, 1), course_id: 'previous-course', subject: 'Matematik'},
    task('no-course-task', 'Derssiz tamamlanan görev', sunday, 1),
  ];
  await openTasks(page, state);
  await page.getByRole('tab', {name: 'Tamamlananlar'}).click();
  const groups = page.getByTestId('completed-course');
  await expect(groups).toHaveCount(5);
  const tyt = groups.filter({has: page.getByText('TYT Biyoloji', {exact: true})});
  await expect(tyt.locator(':scope > summary')).toContainText('2');
  await tyt.locator(':scope > summary').click();
  await expect(tyt.getByTestId('completed-task')).toHaveCount(2);
  await expect(tyt.getByText('TYT hücre tekrarı', {exact: true})).toBeVisible();
  await expect(tyt.getByText('AYT sistemler tekrarı', {exact: true})).toHaveCount(0);
  const ayt = groups.filter({has: page.getByText('AYT Biyoloji', {exact: true})});
  await ayt.locator(':scope > summary').click();
  await expect(ayt.getByTestId('completed-task')).toHaveCount(1);

  const mathematics = groups.filter({hasText: 'Matematik'});
  await expect(mathematics).toHaveCount(2);
  for (const group of await mathematics.all()) {
    await group.locator(':scope > summary').click();
    await expect(group.getByTestId('completed-task')).toHaveCount(1);
  }
  await expect(page.getByText('Güz matematik görevi', {exact: true})).toBeVisible();
  await expect(page.getByText('Bahar matematik görevi', {exact: true})).toBeVisible();
  const withoutCourse = groups.filter({has: page.getByText('Ders belirtilmemiş', {exact: true})});
  await withoutCourse.locator(':scope > summary').click();
  await expect(withoutCourse.getByText('Derssiz tamamlanan görev', {exact: true})).toBeVisible();
});

test('undoing a completed older task returns it to pending and resets its completed steps', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  state.tasks = [{...task('undo-task', 'Eski biyoloji görevi', monday, 1), exam: 'TYT', subject: 'Biyoloji',
    steps: [{id: 'first-step', title: 'İlk testi çöz', completed: true}, {id: 'second-step', title: 'Yanlışları incele', completed: true}]}];
  const commands: TaskCommand[] = [];
  await page.route('**/api/command', route => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (command.type === 'task.update') {
      state.tasks = state.tasks.map(item => item.id === command.payload.id
        ? {...item, ...command.payload, revision: item.revision + 1} : item);
    }
    return route.fulfill({json: commandReceipt(command, state)});
  });
  await openTasks(page, state);
  await page.getByRole('tab', {name: 'Tamamlananlar'}).click();
  await page.getByTestId('completed-course').locator(':scope > summary').click();
  await page.getByTestId('completed-task').locator(':scope > summary').click();
  await page.getByRole('button', {name: 'Tamamlamayı geri al'}).click();
  await expect(page.getByTestId('completed-course')).toHaveCount(0);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({type: 'task.update', payload: {id: 'undo-task', expected_revision: 1,
    progress: 0, steps: [{id: 'first-step', completed: false}, {id: 'second-step', completed: false}]}});

  await page.getByRole('tab', {name: 'Bekleyenler'}).click();
  await expect(page.locator('.task-item h3')).toHaveText(['Eski biyoloji görevi']);
  await expect(page.getByRole('checkbox', {name: 'İlk testi çöz'})).not.toBeChecked();
  await expect(page.getByRole('checkbox', {name: 'Yanlışları incele'})).not.toBeChecked();
  await expect(page.getByRole('button', {name: 'Eski biyoloji görevi düzenle'})).toBeEnabled();
  await expect(page.getByRole('button', {name: 'Çalışmaya başla'})).toBeEnabled();
  await page.getByRole('tab', {name: 'Bugün'}).click();
  await expect(page.getByText('Eski biyoloji görevi', {exact: true})).toHaveCount(0);
});

test('task tabs support arrow wrapping, Home, End and accessible panel links', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  await openTasks(page, {...emptyState(true), authenticated: true});
  const tabs = page.getByRole('tablist', {name: 'Görev görünümü'});
  const day = tabs.getByRole('tab', {name: 'Bugün'});
  const pending = tabs.getByRole('tab', {name: 'Bekleyenler'});
  const completed = tabs.getByRole('tab', {name: 'Tamamlananlar'});
  await expect(day).toHaveAttribute('aria-selected', 'true');
  await day.focus();
  await day.press('ArrowRight');
  await expect(pending).toBeFocused();
  await expect(pending).toHaveAttribute('aria-selected', 'true');
  await pending.press('ArrowRight');
  await expect(completed).toBeFocused();
  await completed.press('ArrowRight');
  await expect(day).toBeFocused();
  await day.press('ArrowLeft');
  await expect(completed).toBeFocused();
  await completed.press('Home');
  await expect(day).toBeFocused();
  await day.press('End');
  await expect(completed).toBeFocused();
  await expect(completed).toHaveAttribute('aria-selected', 'true');
  await expect(completed).toHaveAttribute('tabindex', '0');
  await expect(day).toHaveAttribute('tabindex', '-1');
  await expect(pending).toHaveAttribute('tabindex', '-1');
  for (const tab of [day, pending, completed]) {
    const panel = page.locator('#' + await tab.getAttribute('aria-controls'));
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', await tab.getAttribute('id') ?? '');
  }
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
});

test('task tabs and expanded completed details fit a narrow mobile viewport', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.clock.setFixedTime(new Date('2026-09-29T09:00:00.000Z'));
  const state = {...emptyState(true), authenticated: true};
  const longTitle = 'UzunBirBiyolojiGörevBaşlığı'.repeat(7);
  state.tasks = [task('today-mobile', longTitle, tuesday, 0),
    {...task('completed-mobile', longTitle + 'Tamamlandı', monday, 1), exam: 'TYT', subject: 'UzunDersAdı'.repeat(9),
      resource: 'KaynakSayfası'.repeat(25), notes: 'UzunNot'.repeat(80),
      steps: [{id: 'mobile-step', title: 'UzunAltAdımBaşlığı'.repeat(10), completed: true}]}];
  await openTasks(page, state);
  const expectNoHorizontalOverflow = async () => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  };
  await expectNoHorizontalOverflow();
  await page.getByRole('tab', {name: 'Bekleyenler'}).click();
  await expectNoHorizontalOverflow();
  await page.getByRole('tab', {name: 'Tamamlananlar'}).click();
  await expectNoHorizontalOverflow();
  await page.getByTestId('completed-course').locator(':scope > summary').click();
  await expectNoHorizontalOverflow();
  await page.getByTestId('completed-task').locator(':scope > summary').click();
  await expect(page.getByRole('button', {name: 'Tamamlamayı geri al'})).toBeVisible();
  await expectNoHorizontalOverflow();
});
