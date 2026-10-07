import {expect, test, type Locator, type Page} from '@playwright/test';
import {emptyState, type AppState, type Task} from '../../src/lib/domain/types';

const today = '2026-10-07';
const stamp = `${today}T09:00:00.000Z`;
type TaskCommand = {request_id: string; type: string; payload: Record<string, unknown>};

function task(index: number, overrides: Partial<Task> = {}): Task {
  return {id: `task-${index}`, title: `Görev ${index + 1}`, plan_date: today, exam: 'TYT',
    subject: 'Matematik', topic_id: null, resource: '', completion_criteria: '', planned_minutes: 40,
    difficulty: 'medium', progress: 0, weight_override: null, priority: 'normal', position: index,
    notes: '', study_type: 'Soru çözümü', steps: [], revision: 1, created_at: stamp, updated_at: stamp,
    ...overrides};
}

async function mockTasks(page: Page, tasks: Task[]) {
  await page.clock.setFixedTime(new Date(stamp));
  const state: AppState = {...emptyState(true), authenticated: true, server_now: stamp, tasks};
  const commands: TaskCommand[] = [];
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/command', route => {
    const command: TaskCommand = route.request().postDataJSON();
    commands.push(command);
    const moving = state.tasks.find(item => item.id === command.payload.id);
    expect(moving, 'Only an existing fixture task may be changed').toBeDefined();
    expect(command.payload.expected_revision).toBe(moving!.revision);
    if (command.type === 'task.move') {
      const day = state.tasks.filter(item => item.plan_date === moving!.plan_date)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      const from = day.findIndex(item => item.id === moving!.id);
      const to = from + (command.payload.direction === 'up' ? -1 : 1);
      expect(to).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThan(day.length);
      const neighbor = day[to];
      [day[from], day[to]] = [day[to], day[from]];
      const positions = new Map(day.map((item, position) => [item.id, position]));
      state.tasks = state.tasks.map(item => {
        const position = positions.get(item.id);
        if (position === undefined || (position === item.position && item.id !== moving!.id && item.id !== neighbor.id)) return item;
        return {...item, position, revision: item.revision + 1, updated_at: stamp};
      });
    } else {
      expect(command.type).toBe('task.update');
      const {id: _id, expected_revision: _revision, ...changes} = command.payload;
      void _id; void _revision;
      state.tasks = state.tasks.map(item => item.id === moving!.id
        ? {...item, ...changes, revision: item.revision + 1} as Task : item);
    }
    return route.fulfill({json: {ok: true, id: moving!.id, request_id: command.request_id, replayed: false, state}});
  });
  return {state, commands};
}

async function navigateToTasks(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  }
  await page.getByRole('navigation', {name: 'Ana gezinme'})
    .getByRole('button', {name: 'Görevlerim', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Bugünün planı', exact: true})).toBeVisible();
}

function row(page: Page, id: string) {return page.locator(`.task-item[data-task-id="${id}"]`);}
function titles(page: Page) {return page.locator('.task-list .task-item h3');}

async function dragCoordinates(handle: Locator, target: Locator) {
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const end = await target.boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  return {x: start!.x + start!.width / 2, y: start!.y + start!.height / 2,
    targetY: end!.y + end!.height / 2};
}

test('all of today’s tasks can be reached with wheel and keyboard scrolling', async ({page}) => {
  const tasks = Array.from({length: 12}, (_, index) => task(index, {progress: index < 2 ? 1 : 0}));
  await mockTasks(page, tasks);
  await page.goto('/');
  const card = page.locator('.tasks-summary-card');
  const list = card.getByRole('region', {name: 'Bugünün görev listesi', exact: true});
  await expect(list.locator('.task-line')).toHaveCount(12);
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(list.getByText('Görev 12', {exact: true})).toBeInViewport();

  await list.focus();
  await list.press('Home');
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
  await list.press('End');
  await expect(list.getByText('Görev 12', {exact: true})).toBeInViewport();
  await card.getByRole('button', {name: /^Bekleyen/}).click();
  await expect(list.locator('.task-line')).toHaveCount(10);
  await card.getByRole('button', {name: /^Tamamlanan/}).click();
  await expect(list.locator('.task-line')).toHaveCount(2);
  await card.getByRole('button', {name: /^Tümü/}).click();
  await expect(list.locator('.task-line')).toHaveCount(12);
});

test('subject labels share the requested colors while completion controls and archive toggles stay neutral', async ({page}) => {
  const subjects = [
    ['Matematik', 'red'], ['Fizik', 'purple'], ['Kimya', 'blue'], ['Biyoloji', 'green'],
    ['Sosyal', 'yellow'], ['Paragraf', 'yellow'], ['Türkçe', 'yellow'],
  ] as const;
  const tasks = subjects.map(([subject], index) => task(index, {title: `${subject} görevi`, subject}));
  tasks.push(task(7, {title: 'Tamamlanan matematik', subject: 'Matematik', progress: 1,
    steps: [{id: 'math-step', title: 'Tamamlanan alt adım', completed: true}]}));
  tasks.push(task(8, {title: 'Tamamlanan fizik', subject: 'Fizik', progress: 1}));
  const {commands} = await mockTasks(page, tasks);
  await page.goto('/');
  const summary = page.locator('.tasks-summary-card');
  for (const [subject, color] of subjects) {
    await expect(summary.locator('.task-line').filter({hasText: `${subject} görevi`})
      .locator(`small [data-subject-color="${color}"]`)).toContainText(subject);
  }
  const checkStyles = await summary.locator('.check-button').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return {checked: element.classList.contains('checked'), background: style.backgroundColor,
      color: style.color, border: style.borderColor};
  }));
  expect(new Set(checkStyles.filter(item => !item.checked).map(item => JSON.stringify(item))).size).toBe(1);
  expect(new Set(checkStyles.filter(item => item.checked).map(item => JSON.stringify(item))).size).toBe(1);
  await expect(summary.locator('.check-button[data-subject-color]')).toHaveCount(0);

  await navigateToTasks(page);
  for (const [subject, color] of subjects) {
    await expect(page.locator('.task-item').filter({has: page.getByRole('heading', {name: `${subject} görevi`, exact: true})})
      .locator(`.task-tags [data-subject-color="${color}"]`)).toContainText(subject);
  }
  const labelColors = await page.locator('.task-tags [data-subject-color]').evaluateAll(elements =>
    elements.map(element => getComputedStyle(element).color));
  expect(new Set(labelColors).size).toBe(5);

  await page.getByRole('tab', {name: 'Tamamlananlar', exact: true}).click();
  const courses = page.getByTestId('completed-course');
  await expect(courses).toHaveCount(2);
  await expect(page.getByRole('region', {name: 'Tamamlanan görevler', exact: true})
    .locator('[data-subject-color], [data-task-drag-handle]')).toHaveCount(0);
  const summaries = courses.locator(':scope > summary');
  const summaryColors = await summaries.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return JSON.stringify({background: style.backgroundColor, color: style.color, border: style.borderColor});
  }));
  expect(new Set(summaryColors).size).toBe(1);
  await summaries.first().click();
  const completedTask = page.getByTestId('completed-task');
  await completedTask.locator(':scope > summary').click();
  await expect(completedTask.getByRole('button', {name: /Tamamlamayı geri al/})).toBeVisible();
  await completedTask.locator(':scope > summary').click();
  await summaries.first().click();
  expect(commands).toHaveLength(0);
});

test('dragging across several rows saves the new order and restores it after reload', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1400});
  const {commands} = await mockTasks(page, Array.from({length: 4}, (_, index) => task(index)));
  await page.goto('/');
  await navigateToTasks(page);
  const handle = page.getByRole('button', {name: 'Görev 1 sürükleyerek taşı', exact: true});
  const points = await dragCoordinates(handle, row(page, 'task-3'));
  await page.mouse.move(points.x, points.y);
  await page.mouse.down();
  await page.mouse.move(points.x, points.targetY, {steps: 16});
  await expect(titles(page)).toHaveText(['Görev 2', 'Görev 3', 'Görev 4', 'Görev 1']);
  expect(commands).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands).toMatchObject([1, 2, 3].map(expected_revision =>
    ({type: 'task.move', payload: {id: 'task-0', expected_revision, direction: 'down'}})));
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
  await page.reload();
  await navigateToTasks(page);
  await expect(titles(page)).toHaveText(['Görev 2', 'Görev 3', 'Görev 4', 'Görev 1']);
  const upward = await dragCoordinates(handle, row(page, 'task-1'));
  await page.mouse.move(upward.x, upward.y);
  await page.mouse.down();
  await page.mouse.move(upward.x, upward.targetY, {steps: 16});
  await expect(titles(page)).toHaveText(['Görev 1', 'Görev 2', 'Görev 3', 'Görev 4']);
  await page.mouse.up();
  await expect.poll(() => commands.length).toBe(6);
  expect(commands.slice(3)).toMatchObject([4, 5, 6].map(expected_revision =>
    ({type: 'task.move', payload: {id: 'task-0', expected_revision, direction: 'up'}})));
  await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
});

test('Escape and a handle click leave the original order without sending a move', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1400});
  const {commands} = await mockTasks(page, Array.from({length: 3}, (_, index) => task(index)));
  await page.goto('/');
  await navigateToTasks(page);
  const handle = page.getByRole('button', {name: 'Görev 1 sürükleyerek taşı', exact: true});
  await handle.click();
  expect(commands).toHaveLength(0);
  const points = await dragCoordinates(handle, row(page, 'task-2'));
  await page.mouse.move(points.x, points.y);
  await page.mouse.down();
  await page.mouse.move(points.x, points.targetY, {steps: 12});
  await expect(titles(page)).toHaveText(['Görev 2', 'Görev 3', 'Görev 1']);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(titles(page)).toHaveText(['Görev 1', 'Görev 2', 'Görev 3']);
  expect(commands).toHaveLength(0);
});

test.describe('touch task ordering', () => {
  test.use({viewport: {width: 390, height: 1100}, isMobile: true, hasTouch: true});

  test('touch dragging and the retained arrows both work without narrow-screen overflow', async ({page}) => {
    const {commands} = await mockTasks(page, Array.from({length: 3}, (_, index) => task(index)));
    await page.goto('/');
    await navigateToTasks(page);
    const handle = page.getByRole('button', {name: 'Görev 1 sürükleyerek taşı', exact: true});
    const points = await dragCoordinates(handle, row(page, 'task-2'));
    const cdp = await page.context().newCDPSession(page);
    const touchPoint = (y: number) => [{id: 1, x: points.x, y, radiusX: 2, radiusY: 2, force: 1}];
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: touchPoint(points.y)});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: touchPoint(points.targetY)});
    await expect(titles(page)).toHaveText(['Görev 2', 'Görev 3', 'Görev 1']);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    await expect(titles(page)).toHaveText(['Görev 1', 'Görev 2', 'Görev 3']);
    expect(commands).toHaveLength(0);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: touchPoint(points.y)});
    for (let step = 1; step <= 10; step++) {
      const y = points.y + (points.targetY - points.y) * step / 10;
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: touchPoint(y)});
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect.poll(() => commands.length).toBe(2);
    await expect(titles(page)).toHaveText(['Görev 2', 'Görev 3', 'Görev 1']);
    await expect(page.locator('[data-pending-commands]')).toHaveAttribute('data-pending-commands', '0');
    await page.getByRole('button', {name: 'Görev 1 yukarı taşı', exact: true}).click();
    await expect.poll(() => commands.length).toBe(3);
    await expect(titles(page)).toHaveText(['Görev 2', 'Görev 1', 'Görev 3']);
    await expect(page.getByRole('button', {name: 'Görev 2 yukarı taşı', exact: true})).toBeDisabled();
    await expect(page.getByRole('button', {name: 'Görev 3 aşağı taşı', exact: true})).toBeDisabled();

    await page.setViewportSize({width: 320, height: 1100});
    const middle = row(page, 'task-0');
    for (const action of ['yukarı taşı', 'aşağı taşı', 'sürükleyerek taşı']) {
      await expect(middle.getByRole('button', {name: `Görev 1 ${action}`, exact: true})).toBeVisible();
      await expect(middle.getByRole('button', {name: `Görev 1 ${action}`, exact: true})).toBeEnabled();
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
    await page.getByRole('combobox', {name: 'Görev durumu', exact: true}).selectOption('open');
    for (const action of ['yukarı taşı', 'aşağı taşı', 'sürükleyerek taşı']) {
      await expect(page.getByRole('button', {name: `Görev 1 ${action}`, exact: true})).toBeDisabled();
    }
    expect(commands).toHaveLength(3);
    await cdp.detach();
  });
});
