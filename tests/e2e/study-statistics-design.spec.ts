import {expect, test, type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {emptyState, type AppState, type StudySession, type Task} from '../../src/lib/domain/types';
import {defaultModules, type EducationCourse} from '../../src/lib/education';

const now = '2026-10-03T18:00:00.000Z';
const variants = [
  {id: 'ocean', name: 'Okyanus', appearance: 'dark'},
  {id: 'ocean', name: 'Okyanus', appearance: 'light'},
  {id: 'rose', name: 'Mercan / Gül', appearance: 'dark'},
  {id: 'rose', name: 'Mercan / Gül', appearance: 'light'},
  {id: 'plum', name: 'Mürdüm / Krem', appearance: 'dark'},
  {id: 'plum', name: 'Mürdüm / Krem', appearance: 'light'},
  {id: 'pastel', name: 'Pastel', appearance: 'dark'},
  {id: 'pastel', name: 'Pastel', appearance: 'light'},
  {id: 'white', name: 'Beyaz', appearance: 'light'},
  {id: 'black', name: 'Siyah', appearance: 'dark'},
] as const;

// All records exist only in intercepted responses in an isolated test browser.
function syntheticStudyState(): AppState {
  const termId = '10000000-0000-4000-8000-000000000001';
  const course = (index: number, name: string, exam: 'TYT' | 'AYT'): EducationCourse => ({
    id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    term_id: null, name, normalized_name: name.toLocaleLowerCase('tr-TR'),
    context: 'yks', exam, archived: false, revision: 1, created_at: now, updated_at: now,
  });
  const courses = [course(1, 'Matematik', 'AYT'), course(2, 'Fizik', 'AYT'),
    course(3, 'Matematik', 'TYT'), course(4, 'Biyoloji', 'AYT'), course(5, 'Türkçe', 'TYT')];
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now,
    settings: {display_name: 'Görsel doğrulama', exam_year: 2027, exam_date: null, target_rank: null,
      timezone: 'Europe/Istanbul', daily_target_minutes: 480, task_share: .7,
      difficulty_factors: {easy: 1, medium: 1.25, hard: 1.5}, weekday_targets: Array(7).fill(480),
      theme: 'ocean', appearance: 'dark', reduced_motion: true, simple_view: false, revision: 1},
    education: {profile: {education_level: 'high_school', yks_goal: true, grade: 12,
      department: '', university_year: '', yks_track: 'sayisal', modules: {...defaultModules},
      active_term_id: termId, onboarding_completed_at: now, revision: 1},
      draft: null, needs_onboarding: false, can_commit: true, results: [], courses,
      terms: [{id: termId, academic_year: '2026 / 2027', name: '1. dönem', starts_on: '2026-09-01',
        ends_on: '2027-01-31', archived: false, revision: 1, created_at: now}]},
  };
  const days = [
    {date: '2026-09-28', minutes: 3}, {date: '2026-09-29', minutes: 156},
    {date: '2026-09-30', minutes: 263}, {date: '2026-10-01', minutes: 270},
    {date: '2026-10-02', minutes: 115}, {date: '2026-10-03', minutes: 390},
  ];
  const subjects = [
    {course: courses[0], remaining: 340}, {course: courses[1], remaining: 278},
    {course: null, remaining: 266}, {course: courses[2], remaining: 180},
    {course: courses[3], remaining: 73}, {course: courses[4], remaining: 60},
  ];
  const addSession = (date: string, minutes: number, start: number, selectedCourse: EducationCourse | null) => {
    const id = 'synthetic-study-session-' + state.sessions.length;
    const session: StudySession = {id, course_id: selectedCourse?.id ?? null, title: 'Sentetik çalışma',
      task_id: null, topic_id: null, subject: selectedCourse?.name ?? null, study_type: 'Tekrar',
      mode: 'stopwatch', target_seconds: null, status: 'finished', active_since: null,
      accumulated_seconds: minutes * 60, started_at: new Date(start).toISOString(),
      finished_at: new Date(start + minutes * 60_000).toISOString(), revision: 1};
    state.sessions.push(session);
    state.intervals.push({id: 'synthetic-interval-' + id, session_id: id,
      started_at: session.started_at, ended_at: session.finished_at});
    expect(session.started_at.startsWith(date)).toBe(true);
  };
  let subjectIndex = 0;
  for (const day of days) {
    let remaining = day.minutes;
    let start = Date.parse(day.date + 'T06:00:00.000Z');
    while (remaining > 0) {
      const subject = subjects[subjectIndex];
      const minutes = Math.min(remaining, subject.remaining);
      addSession(day.date, minutes, start, subject.course);
      start += minutes * 60_000;
      remaining -= minutes;
      subject.remaining -= minutes;
      if (subject.remaining === 0) subjectIndex++;
    }
  }
  addSession('2026-09-27', 59, Date.parse('2026-09-27T06:00:00.000Z'), courses[0]);
  const addTask = (date: string, progress: number): Task => ({
    id: 'synthetic-study-task-' + state.tasks.length, course_id: courses[0].id,
    title: 'Sentetik tekrar ' + (state.tasks.length + 1), plan_date: date, exam: 'AYT', subject: 'Matematik',
    topic_id: null, resource: '', completion_criteria: '', planned_minutes: 30, difficulty: 'easy',
    progress, weight_override: null, priority: 'normal', position: state.tasks.length, notes: '',
    study_type: 'Tekrar', steps: [], revision: 1, created_at: now, updated_at: now,
  });
  for (const [date, count] of [['2026-09-27', 2], ['2026-09-30', 6], ['2026-10-01', 4], ['2026-10-03', 8]] as const) {
    for (let index = 0; index < count; index++) state.tasks.push(addTask(date, 1));
  }
  for (let index = 0; index < 3; index++) state.tasks.push(addTask('2026-10-03', .3));
  state.day_plans = days.map(day => ({id: 'synthetic-plan-' + day.date, plan_date: day.date,
    version: 1, target_minutes: day.date === '2026-09-30' ? 240 : day.date === '2026-10-01' ? 300 : 480,
    task_share: .7, difficulty_factors: {easy: 1, medium: 1.25, hard: 1.5}, snapshot: [], changed_at: now}));
  return state;
}

async function navigate(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  }
  await page.getByRole('navigation', {name: 'Ana gezinme'})
    .getByRole('button', {name: label, exact: true}).click();
}

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const result: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) result.push(`page: ${root.scrollWidth} > ${root.clientWidth}`);
    const selector = '[data-statistics-view="study"], .study-statistics, .study-stat-metric, .study-panel, ' +
      '.stats-chart-body, .distribution-content, .distribution-legend, .sgc-body, .sgc-calendar, .sgc-rail, .sgc-selected';
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.clientWidth && element.scrollWidth > element.clientWidth + 1) {
        result.push(`${element.className}: ${element.scrollWidth} > ${element.clientWidth}`);
      }
    }
    return result;
  });
  expect(overflow, label + ' content remains within its container').toEqual([]);
}

async function dataColors(page: Page) {
  return page.evaluate(() => {
    const values = (selector: string, property: string) => Array.from(document.querySelectorAll(selector),
      node => getComputedStyle(node).getPropertyValue(property).trim());
    return {
      metricAccents: values('.study-stat-metric', '--metric-accent'),
      metricIcons: values('.study-metric-icon', 'color'),
      timeBars: values('.study-time-card .stats-bar-fill', 'background-image'),
      taskBars: values('.study-task-card .stats-bar-fill', 'background-image'),
      donutStops: values('.study-distribution-card linearGradient stop', 'stop-color'),
      legend: values('.study-distribution-card .distribution-content > .distribution-legend .legend-dot', 'background-color'),
      targetRings: values('.study-goal-calendar .has-target .sgc-ring-progress', 'stroke'),
      targetLegend: values('.sgc-legend .goal, .sgc-legend .recorded', 'background-color'),
      progress: values('.sgc-progress > span', 'background-color'),
    };
  });
}

async function assertDesktopLayout(page: Page) {
  const time = (await page.locator('.study-time-card').boundingBox())!;
  const tasks = (await page.locator('.study-task-card').boundingBox())!;
  expect(Math.abs(time.width - tasks.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(time.y - tasks.y)).toBeLessThanOrEqual(1);
  expect(tasks.x).toBeGreaterThanOrEqual(time.x + time.width);
  const distribution = (await page.locator('.study-distribution-card').boundingBox())!;
  const calendar = (await page.locator('.study-goal-calendar').boundingBox())!;
  expect(Math.abs(distribution.width - calendar.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(distribution.y - calendar.y)).toBeLessThanOrEqual(1);
  expect(calendar.x).toBeGreaterThanOrEqual(distribution.x + distribution.width);
  const dates = (await page.locator('.sgc-calendar').boundingBox())!;
  const aside = (await page.locator('.sgc-rail').boundingBox())!;
  expect(aside.x).toBeGreaterThanOrEqual(dates.x + dates.width);
  expect(aside.width).toBeLessThan(dates.width);
  expect(aside.height).toBeLessThanOrEqual(calendar.height);
}

test('study dashboard preserves report colors across every theme and stays usable from 320px to desktop', async ({page}, testInfo) => {
  test.setTimeout(180_000);
  const screenshotDirectory = process.env.STUDY_DESIGN_SCREENSHOT_DIR ?? testInfo.outputPath('study-qa');
  const outputs = process.env.STUDY_DESIGN_OUTPUT_DIR ?? testInfo.outputPath('study-deliverables');
  const cleanCrop = {animations: 'disabled' as const, style: '.skip-link, .bottom-nav { visibility: hidden !important; }'};
  await Promise.all([mkdir(screenshotDirectory, {recursive: true}), mkdir(outputs, {recursive: true})]);
  const state = syntheticStudyState();
  const errors: string[] = [];
  let commands = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {
    connected: false, date: '2026-10-03', timezone: 'Europe/Istanbul', events: [], refreshedAt: null,
  }}));
  await page.route('**/api/classroom/student', route => route.fulfill({json: {teacher: null, announcements: []}}));
  await page.route('**/api/command', async route => {commands++; await route.abort();});
  await page.route('**/api/education', async route => {
    if (route.request().method() === 'GET') await route.fulfill({json: state.education});
    else {commands++; await route.abort();}
  });
  await page.goto('/');
  await navigate(page, 'Çalışma İstatistikleri');
  await expect(page.locator('.study-stat-metric')).toHaveCount(6);
  await expect(page.locator('.study-stat-metric > strong')).toHaveText(['20 sa 56 dk', '19 sa 57 dk', '6 sa 30 dk', '20', '18', '8']);
  await expect(page.getByRole('combobox', {name: 'Çalışma dönemi'})).toHaveValue('');
  await expect(page.getByRole('combobox', {name: 'Çalışma dersi'})).toHaveValue('');
  await expect(page.locator('.study-time-card .stats-bar-fill')).toHaveCount(6);
  await expect(page.locator('.study-task-card .stats-bar-fill')).toHaveCount(3);
  await expect(page.locator('.study-distribution-card .distribution-content > .distribution-legend li')).toHaveCount(5);
  await expect(page.locator('.study-distribution-card .donut-center strong')).toHaveText('19 sa 57 dk');
  await expect(page.locator('.sgc-summary-worked strong')).toHaveText('3');
  await expect(page.locator('.sgc-summary-goals strong')).toHaveText('0');
  await expect(page.locator('.sgc-total strong')).toHaveText('12 sa 55 dk');
  const baseline = await dataColors(page);
  expect(new Set(baseline.metricAccents).size).toBe(6);
  expect(baseline.timeBars.every(color => color.startsWith('linear-gradient('))).toBe(true);
  expect(baseline.taskBars.every(color => color.startsWith('linear-gradient('))).toBe(true);
  expect(baseline.donutStops).toHaveLength(10);
  expect(baseline.legend).toHaveLength(5);
  expect(baseline.targetRings).toHaveLength(3);
  expect(baseline.progress).toHaveLength(1);
  let achievedRing: string | undefined;

  for (const variant of variants) {
    await test.step(variant.id + ' ' + variant.appearance, async () => {
      await page.setViewportSize({width: 1440, height: 1000});
      await navigate(page, 'Ayarlar');
      // Pick a flexible theme first to expose mode controls even after a fixed neutral theme.
      await page.getByRole('button', {name: 'Okyanus', exact: true}).click();
      await page.getByRole('button', {name: variant.appearance === 'dark' ? 'Koyu' : 'Açık', exact: true}).click();
      await page.getByRole('button', {name: variant.name, exact: true}).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.id);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', variant.appearance);
      await navigate(page, 'Çalışma İstatistikleri');
      await expect(page.locator('.study-distribution-card .donut-center strong')).toHaveText('19 sa 57 dk');
      expect(await dataColors(page), variant.id + ' ' + variant.appearance + ' data palette').toEqual(baseline);
      await assertDesktopLayout(page);
      const goalCalendar = page.locator('.study-goal-calendar');
      await goalCalendar.getByRole('button', {name: 'Önceki ay', exact: true}).click();
      const achieved = goalCalendar.locator('.sgc-day.is-goal-met .sgc-ring-progress');
      await expect(achieved).toHaveCount(1);
      const color = await achieved.evaluate(node => getComputedStyle(node).stroke);
      if (achievedRing === undefined) achievedRing = color;
      expect(color).toBe(achievedRing);
      expect(color).not.toBe(baseline.targetRings[0]);
      await goalCalendar.getByRole('button', {name: 'Sonraki ay', exact: true}).click();
      const screenshotName = `${variant.id}-${variant.appearance}`;
      await page.screenshot({path: path.join(screenshotDirectory, screenshotName + '-desktop.png'), fullPage: true, animations: 'disabled'});
      if (variant.id === 'ocean' && variant.appearance === 'dark') {
        await page.locator('[data-statistics-view="study"]').screenshot({path: path.join(outputs, 'study-statistics-desktop.png'), ...cleanCrop});
      }
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({width, height: width <= 390 ? 844 : 1000});
        await assertNoOverflow(page, `${screenshotName} at ${width}px`);
        const donut = (await page.locator('.study-distribution-card .neon-donut').boundingBox())!;
        const center = (await page.locator('.study-distribution-card .donut-center strong').boundingBox())!;
        expect(center.width, `${screenshotName} at ${width}px: total fits inside donut hole`).toBeLessThanOrEqual(donut.width * (112 / 180) - 4);
        if (width === 390) {
          await page.screenshot({path: path.join(screenshotDirectory, screenshotName + '-mobile.png'), fullPage: true, animations: 'disabled'});
          if (variant.id === 'ocean' && variant.appearance === 'dark') {
            await page.locator('[data-statistics-view="study"]').screenshot({path: path.join(outputs, 'study-statistics-mobile.png'), ...cleanCrop});
          }
        }
      }
    });
  }
  expect(commands, 'appearance and report inspection must never write user records').toBe(0);
  expect(errors).toEqual([]);
});
