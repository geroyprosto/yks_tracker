import {expect, test, type APIRequestContext, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {DEMO_STUDENT_IDS} from '../../src/lib/classroom/demo-seed';
import type {NovaWebState} from '../../src/lib/nova/web-types';

const origin = 'http://127.0.0.1:3400';
const headers = {Origin: origin};

async function login(request: APIRequestContext, accountId = DEMO_STUDENT_IDS[0]) {
  await expect(await request.post('/api/demo', {headers, data: {account_id: accountId}})).toBeOK();
}

async function raceFixture(request: APIRequestContext): Promise<NovaWebState> {
  await login(request);
  const response = await request.get('/api/nova');
  await expect(response).toBeOK();
  const data: NovaWebState = await response.json();
  const weights = {tasks: 0.3, study: 0.35, questions: 0.25, topics: 0, consistency: 0.1};
  data.race = {
    user: {total: 0, components: {tasks: 0, study: 0, questions: 0, topics: null, consistency: 0}, weights, missing: ['topics']},
    nova: {total: 100, components: {tasks: 100, study: 100, questions: 100, topics: null, consistency: 100}, weights, missing: ['topics']},
    userMetrics: {tasksCompleted: 0, taskTotal: 5, studyMinutes: 0, studyTargetMinutes: 100, questions: 0, questionTarget: 25, accuracyPercent: null, topicProgress: null, topicTarget: null, activeDays: 0, observedDays: 1},
    novaMetrics: {tasksCompleted: 5, taskTotal: 5, studyMinutes: 150, studyTargetMinutes: 100, questions: 25, questionTarget: 25, accuracyPercent: null, topicProgress: null, topicTarget: null, activeDays: 1, observedDays: 1},
  };
  data.weekly = [];
  return data;
}

async function openRaceFixture(page: Page, data: NovaWebState) {
  // Stub only the presentation boundary so edge cases do not alter real study records.
  await page.route('**/api/nova', route => route.fulfill({json: data}));
  await page.goto('/nova');
  await page.getByRole('button', {name: 'Yarış', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Bugünün adil yarışı'})).toBeVisible();
}

test('daily simulation, race and preferences survive reload without a local model', async ({page, context}) => {
  await login(context.request);
  const initialResponse = await context.request.get('/api/nova');
  await expect(initialResponse).toBeOK();
  const initial = await initialResponse.json();
  expect(initial.today.timeline.length).toBeGreaterThan(0);
  expect(initial.race).toBeTruthy();
  for (const archivedField of ['messages', 'jobs', 'devices', 'memories', 'proactiveCount']) {
    expect(initial).not.toHaveProperty(archivedField);
  }

  // Old pairing links must also land on the simulation, with no device approval flow.
  await page.goto('/nova?pair=0123456789AB');
  await expect(page.getByRole('heading', {name: 'Nova', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Nova Bugün', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', {name: 'Günün akışı'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sohbet', exact: true})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Nova’ya mesajın'})).toHaveCount(0);
  await expect(page.getByText(/Yerel model bağlı|Bilgisayar bağlantısı bekleniyor/)).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Eşleştirme kodu'})).toHaveCount(0);
  await page.screenshot({path: 'tmp/nova-today-desktop.png', fullPage: true});

  await page.getByRole('button', {name: 'Yarışı gör', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Yarış', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', {name: 'Bugünün adil yarışı'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Biriken emek'})).toBeVisible();
  await page.getByText('Puanın ayrıntıları', {exact: true}).click();
  await expect(page.getByRole('table', {name: '0–100 aralığında puan bileşenleri'})).toBeVisible();
  await page.getByText('Yakın günleri gör', {exact: true}).click();
  await expect(page.getByText(initial.dayInfo.localDate, {exact: true})).toBeVisible();

  await page.getByRole('button', {name: 'Nova Lab', exact: true}).click();
  await page.getByText('Simülasyon kaydı ve ham durum', {exact: true}).click();
  await expect(page.getByText(initial.dayInfo.seed, {exact: true})).toBeVisible();
  await expect(page.getByText('Yerel bağlantı ve eşleştirme', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('checkbox', {name: 'Proaktif mesajlar'})).toHaveCount(0);
  await expect(page.getByRole('checkbox', {name: 'Hafıza önerileri'})).toHaveCount(0);
  await expect(page.getByText('İş kuyruğu ve yanıt süreleri', {exact: true})).toHaveCount(0);
  await page.getByRole('combobox', {name: 'Haftalık tempo değişimi sınırı'}).selectOption('0.02');
  await expect(page.getByRole('combobox', {name: 'Haftalık tempo değişimi sınırı'})).toHaveValue('0.02');
  await expect(page.getByRole('combobox', {name: 'Haftalık tempo değişimi sınırı'})).toBeEnabled();

  await page.reload();
  await expect(page.getByRole('button', {name: 'Nova Bugün', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', {name: 'Günün akışı'})).toBeVisible();
  const persistedResponse = await context.request.get('/api/nova');
  await expect(persistedResponse).toBeOK();
  const persisted = await persistedResponse.json();
  expect(persisted.dayInfo).toEqual(initial.dayInfo);
  expect(persisted.today.timeline.map((event: {id: string}) => event.id)).toEqual(initial.today.timeline.map((event: {id: string}) => event.id));
  expect(persisted.settings.weekly_adaptation_limit).toBe(0.02);

  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: width === 320 ? 568 : 1000});
    for (const label of ['Nova Bugün', 'Yarış', 'Nova Lab']) {
      await page.getByRole('button', {name: label, exact: true}).click();
      if (label === 'Yarış') await page.getByText('Puanın ayrıntıları', {exact: true}).click();
      if (label === 'Nova Lab') await page.getByText('Simülasyon kaydı ve ham durum', {exact: true}).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), label + ' at ' + width + 'px').toBe(true);
    }
    if (width === 320) await page.screenshot({path: 'tmp/nova-lab-mobile.png', fullPage: true});
  }
  await expect(await context.request.post('/api/nova', {headers, data: {operation: 'settings', settings: {weekly_adaptation_limit: initial.settings.weekly_adaptation_limit}}})).toBeOK();
});

test('race score cards preserve zero scores, missing components and progress beyond the daily target', async ({page, context}) => {
  const data = await raceFixture(context.request);
  await openRaceFixture(page, data);
  const user = page.getByRole('article', {name: 'Sen: günlük yarış puanı'});
  const nova = page.getByRole('article', {name: 'Nova: günlük yarış puanı'});
  await expect(user.getByRole('img', {name: 'Sen: 0 / 100 puan'})).toBeVisible();
  await expect(nova.getByRole('img', {name: 'Nova: 100 / 100 puan'})).toBeVisible();
  await expect(user).toContainText('%0');
  await expect(nova).toContainText('%150');
  const userGoal = page.getByRole('progressbar', {name: 'Sen: çalışma hedefi'});
  const novaGoal = page.getByRole('progressbar', {name: 'Nova: çalışma hedefi'});
  await expect(userGoal).toHaveAttribute('aria-valuenow', '0');
  await expect(novaGoal).toHaveAttribute('aria-valuenow', '100');
  await expect(novaGoal).toHaveAttribute('aria-valuetext', '%150 tamamlandı');
  const components = page.getByRole('region', {name: 'Puan bileşenleri karşılaştırması'});
  const taskBars = components.getByRole('listitem').filter({hasText: 'Görev tamamlama'});
  await expect(taskBars.getByText('0 puan', {exact: true})).toBeVisible();
  await expect(taskBars.getByText('100 puan', {exact: true})).toBeVisible();
  const topicBars = components.getByRole('listitem').filter({hasText: 'Konu ilerlemesi'});
  await expect(topicBars.getByText('Kayıt yok', {exact: true})).toHaveCount(2);

  await page.getByText('Puanın ayrıntıları', {exact: true}).click();
  const table = page.getByRole('table', {name: '0–100 aralığında puan bileşenleri'});
  const taskRow = table.getByRole('row').filter({has: page.getByRole('rowheader', {name: 'Görev tamamlama', exact: true})});
  await expect(taskRow.getByRole('cell')).toHaveText(['0', '100', '%30']);
  const topicRow = table.getByRole('row').filter({has: page.getByRole('rowheader', {name: 'Konu ilerlemesi', exact: true})});
  await expect(topicRow.getByRole('cell')).toHaveText(['Kayıt yok', 'Kayıt yok', 'Katılmıyor']);
});

test('missing scores and absent or zero study targets never become a zero achievement percentage', async ({page, context}) => {
  const data = await raceFixture(context.request);
  data.race!.user.total = null;
  data.race!.userMetrics.studyTargetMinutes = 0;
  data.race!.novaMetrics.studyTargetMinutes = null;
  await openRaceFixture(page, data);
  const user = page.getByRole('article', {name: 'Sen: günlük yarış puanı'});
  const nova = page.getByRole('article', {name: 'Nova: günlük yarış puanı'});
  await expect(user.getByRole('img', {name: 'Sen: Kayıt yok'})).toBeVisible();
  await expect(user.getByRole('img', {name: 'Sen: 0 / 100 puan'})).toHaveCount(0);
  await expect(user).toContainText('0 dk · Hedef yok');
  await expect(nova).toContainText('150 dk · Hedef yok');
  await expect(page.getByRole('progressbar', {name: 'Sen: çalışma hedefi'})).toHaveCount(0);
  await expect(page.getByRole('progressbar', {name: 'Nova: çalışma hedefi'})).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Yarış özeti'})).toContainText('Ortak kayıtlar bekleniyor');

  data.race!.userMetrics.studyMinutes = null;
  data.race!.userMetrics.studyTargetMinutes = 100;
  await page.getByRole('button', {name: 'Nova durumunu yenile'}).click();
  await expect(user).not.toContainText('0 dk · Hedef yok');
  await expect(user.getByText('Kayıt yok', {exact: true})).toHaveCount(2);
  await expect(page.getByRole('progressbar', {name: 'Sen: çalışma hedefi'})).toHaveCount(0);
  await expect(user).not.toContainText(/NaN|Infinity/);
});

test('weekly race chart handles empty history, a genuine zero and keyboard inspection of missing and provisional days', async ({page, context}) => {
  const data = await raceFixture(context.request);
  await openRaceFixture(page, data);
  const chart = page.getByRole('group', {name: 'Son kayıtlı günlerde Sen ve Nova puanları'});
  const weekly = page.getByRole('region', {name: 'Haftalık yarış grafiği'});
  await expect(page.getByText('Grafik ilk puanlarınla oluşacak', {exact: true})).toBeVisible();
  await expect(weekly.getByText('Kayıt yok', {exact: true})).toHaveCount(2);
  await expect(chart).toHaveCount(0);

  data.weekly = [{localDate: '2026-10-11', userScore: 0, novaScore: 25, finalized: true}];
  await page.getByRole('button', {name: 'Nova durumunu yenile'}).click();
  await expect(chart).toBeVisible();
  const zeroDay = chart.getByRole('button', {name: /11 Ekim\. Sen 0 puan · Nova 25 puan/}).first();
  await expect(zeroDay).toBeVisible();
  await expect(weekly.getByText('0 puan', {exact: true})).toBeVisible();
  await expect(weekly.getByText('25 puan', {exact: true})).toBeVisible();
  await expect(page.getByText(/İlk günün puanları burada\./)).toBeVisible();
  await zeroDay.scrollIntoViewIfNeeded();
  await zeroDay.focus();
  await expect(page.getByRole('tooltip')).toContainText('Sen 0 puan · Nova 25 puan');
  await zeroDay.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // Deliberately unsorted: the visible chart must keep calendar order and label gaps honestly.
  data.weekly = [
    {localDate: '2026-10-14', userScore: 35, novaScore: 35, finalized: true},
    {localDate: '2026-10-12', userScore: null, novaScore: 40, finalized: true},
    {localDate: '2026-10-11', userScore: 0, novaScore: 25, finalized: true},
    {localDate: '2026-10-13', userScore: 90, novaScore: 80, finalized: false},
  ];
  await page.getByRole('button', {name: 'Nova durumunu yenile'}).click();
  await expect(weekly).toContainText('2 kesinleşmiş ortak gün');
  await expect(weekly.getByText('35 puan', {exact: true})).toBeVisible();
  await expect(weekly.getByText('60 puan', {exact: true})).toBeVisible();
  const missingDay = chart.getByRole('button', {name: /12 Ekim\. Sen Kayıt yok · Nova 40 puan/}).first();
  await missingDay.scrollIntoViewIfNeeded();
  await missingDay.focus();
  await expect(missingDay).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Eksik kayıt sıfır sayılmaz; bu gün haftalık toplama katılmaz.');
  await missingDay.press('ArrowRight');
  const provisionalDay = chart.getByRole('button', {name: /13 Ekim\. Sen 90 puan · Nova 80 puan/}).first();
  await expect(provisionalDay).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Gün sürüyor · Geçici puan');
  await expect(page.getByRole('tooltip')).toContainText('Devam eden gün haftalık toplama katılmaz.');
  await provisionalDay.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  data.weekly = [{localDate: '2026-10-11', userScore: null, novaScore: null, finalized: true}];
  await page.getByRole('button', {name: 'Nova durumunu yenile'}).click();
  await expect(page.getByText('Grafik ilk puanlarınla oluşacak', {exact: true})).toBeVisible();
  await expect(chart).toHaveCount(0);
});

test('race charts remain readable across dashboard themes and mobile widths', async ({page, context}) => {
  const data = await raceFixture(context.request);
  data.weekly = [
    {localDate: '2026-10-11', userScore: 0, novaScore: 25, finalized: true},
    {localDate: '2026-10-12', userScore: 30, novaScore: 45, finalized: true},
    {localDate: '2026-10-13', userScore: 70, novaScore: 50, finalized: false},
  ];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openRaceFixture(page, data);
  const chart = page.getByRole('group', {name: 'Son kayıtlı günlerde Sen ve Nova puanları'});
  for (const variant of [
    {theme: 'ocean', appearance: 'dark'}, {theme: 'rose', appearance: 'light'},
    {theme: 'plum', appearance: 'dark'}, {theme: 'pastel', appearance: 'light'},
    {theme: 'white', appearance: 'light'}, {theme: 'black', appearance: 'dark'},
  ]) {
    // The standalone page shares these CSS tokens with the dashboard's appearance controls.
    await page.evaluate(({theme, appearance}) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.appearance = appearance;
    }, variant);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({width, height: width === 320 ? 568 : 1000});
      await expect(page.getByRole('article', {name: 'Sen: günlük yarış puanı'})).toBeVisible();
      await expect(page.getByRole('article', {name: 'Nova: günlük yarış puanı'})).toBeVisible();
      await expect(chart).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${variant.theme} ${variant.appearance} at ${width}px`).toBe(true);
      const box = await chart.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      if (variant.theme === 'ocean' && width !== 768) await page.screenshot({path: `tmp/nova-race-${width}px.png`, fullPage: true, animations: 'disabled'});
    }
  }
  expect(errors).toEqual([]);
});

test('a failed simulation refresh keeps the day visible and can be retried', async ({page, context}) => {
  await login(context.request);
  await page.goto('/nova');
  const workspace = page.getByRole('region', {name: 'Nova çalışma arkadaşı'});
  await expect(page.getByRole('heading', {name: 'Günün akışı'})).toBeVisible();
  await page.route('**/api/nova', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({ok: false, error: {code: 'TEST_UNAVAILABLE', message: 'Simülasyon şu an yenilenemiyor.'}})}));
  await page.getByRole('button', {name: 'Nova durumunu yenile'}).click();
  await expect(workspace.getByRole('alert')).toContainText('Simülasyon şu an yenilenemiyor.');
  await expect(page.getByRole('heading', {name: 'Günün akışı'})).toBeVisible();
  await page.unroute('**/api/nova');
  await page.getByRole('button', {name: 'Tekrar dene', exact: true}).click();
  await expect(workspace.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Günün akışı'})).toBeVisible();
});

test('retired chat and bridge operations cannot enqueue or process messages', async ({context}) => {
  await login(context.request);
  const responses = [
    await context.request.get('/api/nova/chat'),
    await context.request.post('/api/nova/bridge', {data: {operation: 'pair.begin', challenge: 'retired', name: 'Retired device'}}),
    await context.request.post('/api/nova/bridge', {data: {operation: 'claim', payload: {}}}),
    await context.request.post('/api/nova/bridge', {headers: {Authorization: 'Bearer retired.token'}, data: {operation: 'complete', payload: {}}}),
  ];
  for (const response of responses) {
    expect(response.status()).toBe(410);
    expect((await response.json()).error.code).toBe('NOVA_CHAT_REMOVED');
  }
  for (const operation of [
    {operation: 'message', requestId: randomUUID(), content: 'Bu mesaj işlenmemeli.'},
    {operation: 'retry', jobId: randomUUID()},
    {operation: 'pair.approve', code: '0123456789AB'},
    {operation: 'memory', memoryId: randomUUID(), action: 'approve'},
    {operation: 'history'},
  ]) {
    const response = await context.request.post('/api/nova', {headers, data: operation});
    expect(response.status()).toBe(410);
    expect((await response.json()).error.code).toBe('NOVA_CHAT_REMOVED');
  }
  const state = await context.request.get('/api/nova');
  await expect(state).toBeOK();
  expect(await state.json()).not.toHaveProperty('jobs');
});

test('simulation access and settings stay scoped to the approved account', async ({context}) => {
  await login(context.request, DEMO_STUDENT_IDS[1]);
  const ungranted = await context.request.get('/api/nova');
  expect(ungranted.status()).toBe(403);
  expect((await ungranted.json()).error.code).toBe('NOVA_ACCESS_REQUIRED');
  expect((await context.request.post('/api/nova', {headers, data: {operation: 'settings', settings: {weekly_adaptation_limit: 0.02}}})).status()).toBe(403);

  await login(context.request);
  await expect(await context.request.get('/api/nova')).toBeOK();
  const crossOrigin = await context.request.post('/api/nova', {headers: {Origin: 'https://other.example'}, data: {operation: 'settings', settings: {weekly_adaptation_limit: 0.02}}});
  expect(crossOrigin.status()).toBe(403);
  expect((await crossOrigin.json()).error.code).toBe('ORIGIN_REJECTED');
  const retiredSetting = await context.request.post('/api/nova', {headers, data: {operation: 'settings', settings: {proactive_enabled: true}}});
  expect(retiredSetting.status()).toBe(400);
  const invalidAdaptation = await context.request.post('/api/nova', {headers, data: {operation: 'settings', settings: {weekly_adaptation_limit: 0.06}}});
  expect(invalidAdaptation.status()).toBe(400);
});
