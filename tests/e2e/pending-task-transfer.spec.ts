import {expect, test, type Locator, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';

const today = '2026-10-07';
const previousDay = '2026-10-06';
const stamp = `${today}T09:00:00.000Z`;
const pendingTitle = 'Bekleyen matematik';
type TaskCommand = {request_id: string; type: string; payload: Record<string, unknown>};

function task(index: number, overrides: Partial<Task> = {}): Task {
  return {id: `task-${index}`, title: `Görev ${index + 1}`, plan_date: today, exam: 'TYT',
    subject: 'Matematik', topic_id: null, resource: '', completion_criteria: '', planned_minutes: 40,
    difficulty: 'medium', progress: 0, weight_override: null, priority: 'normal', position: index,
    notes: '', study_type: 'Soru çözümü', steps: [], revision: 1, created_at: stamp, updated_at: stamp,
    ...overrides};
}

async function mockTasks(page: Page, reject = false, otherPending: Task[] = []) {
  await page.clock.setFixedTime(new Date(stamp));
  const pending = task(0, {title: pendingTitle, plan_date: previousDay, position: 21, revision: 4,
    progress: 0.5, steps: [{id: 'done-step', title: 'İlk testi çöz', completed: true},
      {id: 'open-step', title: 'Yanlışları incele', completed: false}]});
  const state: AppState = {...emptyState(true), authenticated: true, server_now: stamp,
    tasks: [pending, task(1, {position: 2}), task(2, {position: 7, progress: 1}), ...otherPending]};
  const commands: TaskCommand[] = [];
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/command', route => {
    const command: TaskCommand = route.request().postDataJSON();
    commands.push(command);
    expect(command.type).toBe('task.update');
    expect(command.payload).toEqual({id: pending.id, expected_revision: pending.revision,
      plan_date: today, position: 8});
    if (reject) return route.fulfill({status: 409,
      json: {error: {message: 'Görev başka bir yerde güncellendi; yeniden dene.'}}});
    state.tasks = state.tasks.map(item => item.id === pending.id
      ? {...item, plan_date: today, position: 8, revision: item.revision + 1} : item);
    return route.fulfill({json: {ok: true, id: pending.id, request_id: command.request_id,
      replayed: false, state}});
  });
  return {state, commands, pending};
}

async function navigateToTasks(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  }
  await page.getByRole('navigation', {name: 'Ana gezinme'})
    .getByRole('button', {name: 'Görevlerim', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Bugünün planı', exact: true})).toBeVisible();
}

const todayTab = (page: Page) => page.getByRole('tab', {name: 'Bugün', exact: true});
const pendingTab = (page: Page) => page.getByRole('tab', {name: 'Bekleyenler', exact: true});
const dragHandle = (page: Page) => page.getByRole('button', {name: `${pendingTitle} bugüne sürükle`, exact: true});
const dropZone = (page: Page) => page.getByRole('region', {name: 'Bugünün görevlerine taşı', exact: true});
const pendingRow = (page: Page) => page.locator('.task-item[data-task-id="task-0"]');

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return {x: box!.x + box!.width / 2, y: box!.y + box!.height / 2};
}

async function startDrag(page: Page, target: Locator) {
  const handle = dragHandle(page);
  await handle.scrollIntoViewIfNeeded();
  const start = await center(handle);
  const end = await center(target);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, {steps: 12});
  await expect(target).toHaveAttribute('data-drop-active', 'true');
}

async function expectTransferred(page: Page, state: AppState, commands: TaskCommand[], pending: Task) {
  await expect.poll(() => commands.length).toBe(1);
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
  await expect(todayTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(todayTab(page)).toBeFocused();
  await expect(page.getByLabel('Plan tarihi', {exact: true})).toHaveValue(today);
  await expect(page.getByRole('combobox', {name: 'Görev durumu', exact: true})).toHaveValue('all');
  await expect(page.locator('.task-list .task-item h3')).toHaveText(['Görev 2', 'Görev 3', pendingTitle]);
  expect(state.tasks.find(item => item.id === pending.id)).toEqual({...pending,
    plan_date: today, position: 8, revision: pending.revision + 1});
  await expect(pendingRow(page).getByRole('checkbox', {name: 'İlk testi çöz', exact: true})).toBeChecked();
  await expect(pendingRow(page).getByRole('checkbox', {name: 'Yanlışları incele', exact: true})).not.toBeChecked();
  await expect(pendingRow(page)).toContainText('%50 tamamlandı');
}

for (const target of ['drop zone', 'Bugün tab'] as const) {
  test(`dragging a pending task onto the ${target} appends it to today and persists after reload`, async ({page}, testInfo) => {
    const {state, commands, pending} = await mockTasks(page);
    await page.goto('/');
    await navigateToTasks(page);
    await page.getByLabel('Plan tarihi', {exact: true}).fill('2026-10-09');
    await page.getByRole('combobox', {name: 'Görev durumu', exact: true}).selectOption('done');
    await pendingTab(page).click();
    if (target === 'drop zone') await page.screenshot({path: testInfo.outputPath('pending-desktop.png')});
    const destination = target === 'drop zone' ? dropZone(page) : todayTab(page);
    expect(await destination.getAttribute('data-task-today-drop')).not.toBeNull();
    await startDrag(page, destination);
    expect(commands).toHaveLength(0);
    await page.mouse.up();
    await expectTransferred(page, state, commands, pending);
    await page.reload();
    await navigateToTasks(page);
    await expect(page.locator('.task-list .task-item h3')).toHaveText(['Görev 2', 'Görev 3', pendingTitle]);
    await pendingTab(page).click();
    await expect(pendingRow(page)).toHaveCount(0);
    expect(commands).toHaveLength(1);
  });
}

test('the sticky drop zone stays reachable while dragging the last task of a long pending list', async ({page}) => {
  const otherPending = Array.from({length: 16}, (_, index) => task(index + 3, {
    title: `Önceki görev ${index + 1}`, plan_date: previousDay, position: index,
  }));
  const {state, commands, pending} = await mockTasks(page, false, otherPending);
  await page.goto('/');
  await navigateToTasks(page);
  await pendingTab(page).click();
  await expect(page.locator('.task-list .task-item')).toHaveCount(17);
  await expect(page.locator('.task-list .task-item').last()).toHaveAttribute('data-task-id', pending.id);
  await dragHandle(page).scrollIntoViewIfNeeded();
  await expect(dragHandle(page)).toBeInViewport();
  await expect(page.locator('.task-list .task-item').first()).not.toBeInViewport();
  await expect(dropZone(page)).toBeInViewport();
  await startDrag(page, dropZone(page));
  expect(commands).toHaveLength(0);
  await page.mouse.up();
  await expectTransferred(page, state, commands, pending);
  await pendingTab(page).click();
  await expect(page.locator('.task-list .task-item')).toHaveCount(16);
  await expect(pendingRow(page)).toHaveCount(0);
});

test('Escape, dropping outside a target, and clicking the handle leave the pending task unchanged', async ({page}) => {
  const {state, commands, pending} = await mockTasks(page);
  await page.goto('/');
  await navigateToTasks(page);
  await pendingTab(page).click();
  await dragHandle(page).click();
  await startDrag(page, dropZone(page));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(pendingTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(dragHandle(page)).toBeVisible();
  await expect(page.locator('[data-drop-active="true"]')).toHaveCount(0);
  await startDrag(page, dropZone(page));
  const outside = await center(pendingTab(page));
  await page.mouse.move(outside.x, outside.y, {steps: 8});
  await page.mouse.up();
  await expect(pendingTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(dragHandle(page)).toBeVisible();
  await expect(page.locator('[data-drop-active="true"]')).toHaveCount(0);
  expect(commands).toHaveLength(0);
  expect(state.tasks.find(item => item.id === pending.id)).toEqual(pending);
});

test('the keyboard alternative transfers a pending task and focuses today', async ({page}) => {
  const {state, commands, pending} = await mockTasks(page);
  await page.goto('/');
  await navigateToTasks(page);
  await pendingTab(page).click();
  const transfer = page.getByRole('button', {name: `${pendingTitle} bugüne taşı`, exact: true});
  await transfer.focus();
  await transfer.press('Enter');
  await expectTransferred(page, state, commands, pending);
});

test('a rejected transfer keeps the task recoverable in pending with its progress and steps', async ({page}) => {
  const {state, commands, pending} = await mockTasks(page, true);
  await page.goto('/');
  await navigateToTasks(page);
  await pendingTab(page).click();
  await startDrag(page, dropZone(page));
  await page.mouse.up();
  await expect(page.getByRole('alert')
    .filter({hasText: 'Görev başka bir yerde güncellendi; yeniden dene.'})).toBeVisible();
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
  await pendingTab(page).click();
  await expect(dragHandle(page)).toBeEnabled();
  await expect(pendingRow(page)).toContainText('6 Eki');
  await expect(pendingRow(page)).toContainText('%50 tamamlandı');
  await expect(pendingRow(page).getByRole('checkbox', {name: 'İlk testi çöz', exact: true})).toBeChecked();
  await expect(pendingRow(page).getByRole('checkbox', {name: 'Yanlışları incele', exact: true})).not.toBeChecked();
  expect(state.tasks.find(item => item.id === pending.id)).toEqual(pending);
  expect(commands).toHaveLength(1);
});

test.describe('touch pending task transfer', () => {
  test.use({viewport: {width: 390, height: 1100}, isMobile: true, hasTouch: true});

  test('touch dragging cancels safely and transfers without narrow-screen overflow', async ({page}, testInfo) => {
    const {state, commands, pending} = await mockTasks(page);
    await page.goto('/');
    await navigateToTasks(page);
    await pendingTab(page).click();
    await page.setViewportSize({width: 320, height: 1100});
    await expect(dragHandle(page)).toBeVisible();
    await expect(page.getByRole('button', {name: `${pendingTitle} bugüne taşı`, exact: true})).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
    await page.screenshot({path: testInfo.outputPath('pending-mobile-320.png')});
    await dragHandle(page).scrollIntoViewIfNeeded();
    const start = await center(dragHandle(page));
    const end = await center(dropZone(page));
    const cdp = await page.context().newCDPSession(page);
    const touchPoint = (x: number, y: number) => [{id: 1, x, y, radiusX: 2, radiusY: 2, force: 1}];
    try {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: touchPoint(start.x, start.y)});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: touchPoint(end.x, end.y)});
      await expect(dropZone(page)).toHaveAttribute('data-drop-active', 'true');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
      await expect(pendingTab(page)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-drop-active="true"]')).toHaveCount(0);
      expect(commands).toHaveLength(0);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: touchPoint(start.x, start.y)});
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: touchPoint(
          start.x + (end.x - start.x) * step / 10, start.y + (end.y - start.y) * step / 10)});
      }
      await expect(dropZone(page)).toHaveAttribute('data-drop-active', 'true');
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await expectTransferred(page, state, commands, pending);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
    } finally {await cdp.detach();}
  });
});
