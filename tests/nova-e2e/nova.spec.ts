import {expect, test, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {DEMO_STUDENT_IDS} from '../../src/lib/classroom/demo-seed';

const origin = 'http://127.0.0.1:3400';
const headers = {Origin: origin};

async function login(request: APIRequestContext, accountId = DEMO_STUDENT_IDS[0]) {
  await expect(await request.post('/api/demo', {headers, data: {account_id: accountId}})).toBeOK();
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
