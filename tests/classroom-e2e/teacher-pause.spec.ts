import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import {teacherFeaturesEnabled, teacherFeaturesPausedMessage} from '../../src/lib/classroom/availability';
import {DEMO_STUDENT_IDS, DEMO_TEACHER_IDS} from '../../src/lib/classroom/demo-seed';

const origin = 'http://127.0.0.1:3200';
test.skip(teacherFeaturesEnabled, 'These regressions cover the temporary teacher pause.');

async function login(context: BrowserContext, accountId: string) {
  await expect(await context.request.post('/api/demo', {headers: {Origin: origin}, data: {account_id: accountId}})).toBeOK();
}

async function backgroundAndReturn(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(180_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.fastForward(180_000);
}

test('teacher sees the pause notice without students, events, presence or repeated classroom reads', async ({page, context}) => {
  await login(context, DEMO_TEACHER_IDS[0]);
  await page.clock.install();
  const classroomRequests: {path: string; method: string}[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/classroom')) classroomRequests.push({path, method: request.method()});
  });
  const initialRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/classroom');
  await page.goto('/classroom');
  const body = await (await initialRead).json();
  expect(body).toMatchObject({teacher_features_paused: true, students: [], messages: [], alerts: [], feedback: [], applications: [], invites: []});
  await expect(page.getByRole('heading', {name: 'Öğretmen alanı duraklatıldı.', exact: true})).toBeVisible();
  await expect(page.getByText(teacherFeaturesPausedMessage, {exact: true})).toBeVisible();
  await expect(page.getByRole('navigation', {name: 'Öğretmen alanları'})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Öğrenci adına göre ara'})).toHaveCount(0);
  // Development StrictMode may repeat the initial effect. Neither mount may
  // create a subscription, heartbeat, or further refresh when visibility changes.
  const initialRequests = [...classroomRequests];
  expect(initialRequests.length).toBeGreaterThan(0);
  expect(initialRequests.every(request => request.path === '/api/classroom' && request.method === 'GET')).toBe(true);
  await backgroundAndReturn(page);
  expect(classroomRequests).toEqual(initialRequests);
});

test('student study and friends pages send no classroom background traffic during the pause', async ({page, context}) => {
  await login(context, DEMO_STUDENT_IDS[0]);
  await page.clock.install();
  await page.route('**/api/realtime?*', route => route.fulfill({json: {enabled: true, version: 'teacher-paused'}}));
  const classroomRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/classroom')) classroomRequests.push(request.url());
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', {name: 'Ana gezinme', exact: true});
  await expect(nav).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sayaç — çalışma sayacını aç', exact: true}).first()).toBeEnabled();
  await backgroundAndReturn(page);
  await nav.getByRole('button', {name: 'Görevlerim', exact: true}).click();
  await expect(page.locator('main#main')).toHaveAttribute('data-page', 'tasks');
  await nav.getByRole('button', {name: 'Arkadaşlar', exact: true}).click();
  await expect(page.getByRole('region', {name: 'İkili karşılaşma', exact: true})).toBeVisible();
  await backgroundAndReturn(page);
  expect(classroomRequests).toEqual([]);
});
