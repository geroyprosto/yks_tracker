import {expect, test, type Page} from '@playwright/test';
import {emptyState} from '../../src/lib/domain/types';
import type {AgentHouseReport, AgentHouseRuns} from '../../src/lib/agent-house';

const now = '2026-11-14T09:00:00.000Z';
const ids = ['leader', 'strategy', 'tracking', 'awareness', 'daily', 'discovery'] as const;
const labels = ['Lider', 'YKS Stratejisti', 'YKSİM Takipçisi', 'Öz Farkındalık', 'Günlük Rehber', 'Keşif'];

function report(mode: 'sample' | 'live', runId: string = mode): AgentHouseReport {
  return {
    schema_version: 1, run_id: runId, mode, generated_at: now, week_start: '2026-11-16',
    title: mode === 'live' ? 'Kişisel haftalık plan' : 'Örnek haftalık plan',
    agents: ids.map((id, index) => ({
      id, status: id === 'discovery' ? 'skipped' : 'ready',
      summary: `${mode === 'live' ? 'Kişisel' : 'Örnek'} ${labels[index]} değerlendirmesi.`,
      recommendations: id === 'strategy' ? ['Önce problem çözümündeki yanlışlarını incele.'] : [],
      sources: id === 'strategy' ? [{title: 'Öğrenme araştırması', url: 'https://example.org/research', note: 'Yöntemin dayanağı.'}] : [],
      tables: id === 'tracking' ? [{title: 'Ders ilerlemesi', columns: ['Ders', 'Kayıtlı süre'], rows: [['Matematik', mode === 'live' ? '90 dk' : '25 dk']]}] : [],
      schedule: id === 'daily' ? [{date: '2026-11-16', start: '17:00', end: '17:25', title: 'Problemler', detail: 'Yanlışların nedenlerini not et.'}] : [],
    })),
  };
}

async function openHouse(page: Page, width: number, runs: AgentHouseRuns, fail = false) {
  await page.setViewportSize({width, height: 1000});
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-11-14', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  await page.route('**/api/analysis', route => route.fulfill({json: {ok: true, reports: [], configured: false, model: null, limits: {monthly_requests: 4, monthly_usd: 0}, used: {requests: 0, estimated_cost_usd: 0}}}));
  let writes = 0;
  let gets = 0;
  await page.route('**/api/agent-house', route => {
    if (route.request().method() !== 'GET') writes++;
    else gets++;
    return route.fulfill(fail ? {status: 503, json: {error: {message: 'Rapor bağlantısı geçici olarak kesildi.'}}} : {json: {runs}});
  });
  await page.goto('/');
  if (width < 760) await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Analiz', exact: true}).click();
  await expect(page.getByTestId('agent-house')).toBeVisible();
  await expect(page.getByTestId('agent-house').getByRole('button', {name: 'Yenile', exact: true})).toBeEnabled();
  return {writes: () => writes, gets: () => gets};
}

for (const width of [360, 1280]) test(`ajan evi odaları raporu ve programı açar, sohbet ve otomatik yazma yok · ${width}px`, async ({page}) => {
  const requests = await openHouse(page, width, {live: [report('live')], sample: [report('sample')]});
  const house = page.getByTestId('agent-house');
  const detail = page.getByTestId('agent-room-report');
  await expect(house.getByRole('button', {name: 'Benim raporlarım', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(detail).toContainText('Kişisel Lider değerlendirmesi.');
  await expect(house.getByRole('button', {name: / odası$/})).toHaveCount(6);
  await expect(house.getByRole('textbox')).toHaveCount(0);
  await expect(house.locator('textarea,[contenteditable=true]')).toHaveCount(0);

  const strategist = house.getByRole('button', {name: 'YKS Stratejisti odası', exact: true});
  await strategist.focus();
  await page.keyboard.press('Enter');
  await expect(strategist).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.getByRole('heading', {name: 'Çalışmanın yönü'})).toBeFocused();
  await expect(detail).toContainText('Önce problem çözümündeki yanlışlarını incele.');
  await expect(detail.getByRole('link', {name: 'Öğrenme araştırması'})).toHaveAttribute('href', 'https://example.org/research');

  await house.getByRole('button', {name: 'YKSİM Takipçisi odası', exact: true}).click();
  await expect(detail.getByRole('table')).toContainText('Matematik');
  await expect(detail.getByRole('table')).toContainText('90 dk');

  await house.getByRole('button', {name: 'Günlük Rehber odası', exact: true}).click();
  await expect(detail).toContainText('17:00–17:25');
  await expect(detail).toContainText('Problemler');
  await expect(detail).toContainText('Yanlışların nedenlerini not et.');
  await house.getByRole('button', {name: 'Öz Farkındalık odası', exact: true}).click();
  await expect(detail).toContainText('Kişisel Öz Farkındalık değerlendirmesi.');
  await house.getByRole('button', {name: 'Keşif odası', exact: true}).click();
  await expect(detail).toContainText('Bu akışta çalışmadı');

  await house.getByRole('button', {name: 'Örnek akış', exact: true}).click();
  await expect(house).toContainText('ÖRNEK VERİ');
  await expect(detail).toContainText('Örnek Keşif değerlendirmesi.');
  await expect(detail).not.toContainText('Kişisel');
  await house.getByRole('button', {name: 'YKSİM Takipçisi odası', exact: true}).click();
  await expect(detail.getByRole('table')).toContainText('25 dk');
  await expect(detail.getByRole('table')).not.toContainText('90 dk');
  await house.getByRole('button', {name: 'Benim raporlarım', exact: true}).click();
  await expect(detail.getByRole('table')).toContainText('90 dk');
  await expect(house).not.toContainText('ÖRNEK VERİ');

  await house.getByRole('button', {name: 'Günlük Rehber odası', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: `artifacts/agent-house-${width}.png`, fullPage: true});
  expect(requests.gets()).toBeGreaterThanOrEqual(1);
  expect(requests.writes()).toBe(0);
});

test('ajan evi örnek sonucu kişisel rapor boşluğuna karıştırmaz', async ({page}) => {
  const requests = await openHouse(page, 1280, {live: [], sample: [report('sample')]});
  const house = page.getByTestId('agent-house');
  const detail = page.getByTestId('agent-room-report');
  await expect(house.getByRole('button', {name: 'Örnek akış', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(detail).toContainText('Örnek Lider değerlendirmesi.');
  await house.getByRole('button', {name: 'Benim raporlarım', exact: true}).click();
  await expect(detail).toContainText('Bu odanın raporu henüz gelmedi');
  await expect(detail).not.toContainText('Örnek Lider değerlendirmesi.');
  await expect(detail.getByRole('button', {name: 'Örnek akışı incele'})).toBeVisible();
  expect(requests.writes()).toBe(0);
});

test('ajan evi hata ile boş rapor durumunu gösterir ve yeniden okuyabilir', async ({page}) => {
  const requests = await openHouse(page, 360, {live: [], sample: []}, true);
  const house = page.getByTestId('agent-house');
  await expect(house.getByRole('alert')).toContainText('Rapor bağlantısı geçici olarak kesildi.');
  await expect(page.getByTestId('agent-room-report')).toContainText('Bu odanın raporu henüz gelmedi');
  await house.getByRole('button', {name: 'Yenile', exact: true}).click();
  await expect.poll(requests.gets).toBeGreaterThanOrEqual(2);
  expect(requests.writes()).toBe(0);
});

test('daha eski içe aktarılan rapor GET listesinin dışında olsa da seçilir ve örnek olarak kalır', async ({page}) => {
  const newer = Array.from({length: 5}, (_, index) => ({...report('sample', `newer-${index}`), generated_at: `2026-11-${14 - index}T09:00:00.000Z`}));
  const requests = await openHouse(page, 1280, {live: [report('live')], sample: newer});
  const imported = report('sample', 'older-import');
  imported.generated_at = '2026-10-26T09:00:00.000Z';
  imported.week_start = '2026-10-26';
  imported.title = 'Ekim ayının örnek raporu';
  imported.agents[0].summary = 'İçe aktarılan eski örnek raporun lider değerlendirmesi.';
  const posts: unknown[] = [];
  await page.route('**/api/agent-house', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts.push(route.request().postDataJSON());
    return route.fulfill({status: 201, json: {run: imported, created: true}});
  });
  const house = page.getByTestId('agent-house');
  const getCount = requests.gets();
  await house.locator('summary').filter({hasText: 'Hazır rapor aktar'}).click();
  await house.getByLabel('Rapor dosyasını seç', {exact: true}).setInputFiles({
    name: 'older-sample.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(house.getByRole('status')).toContainText('Rapor hesabına kaydedildi.');
  await expect(house.getByRole('combobox', {name: 'Rapor', exact: true})).toHaveValue('older-import');
  await expect(house.getByRole('button', {name: 'Örnek akış', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(house).toContainText('ÖRNEK VERİ');
  await expect(page.getByTestId('agent-room-report')).toContainText(imported.agents[0].summary);
  expect(posts).toEqual([imported]);
  expect(requests.gets()).toBe(getCount);
  await house.getByRole('button', {name: 'Benim raporlarım', exact: true}).click();
  await expect(page.getByTestId('agent-room-report')).toContainText('Kişisel Lider değerlendirmesi.');
  await expect(page.getByTestId('agent-room-report')).not.toContainText(imported.agents[0].summary);
});

test('geçersiz rapor dosyası API çağrısı yapmadan reddedilir', async ({page}) => {
  const requests = await openHouse(page, 1280, {live: [report('live')], sample: []});
  const house = page.getByTestId('agent-house');
  await house.locator('summary').filter({hasText: 'Hazır rapor aktar'}).click();
  await house.getByLabel('Rapor dosyasını seç', {exact: true}).setInputFiles({
    name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ invalid json'),
  });
  await expect(house.getByRole('alert')).toContainText('Dosya okunamadı. Geçerli bir rapor dosyası seç.');
  await expect(page.getByTestId('agent-room-report')).toContainText('Kişisel Lider değerlendirmesi.');
  expect(requests.writes()).toBe(0);
});
