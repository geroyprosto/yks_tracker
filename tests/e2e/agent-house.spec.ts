import {expect, test, type Locator, type Page} from '@playwright/test';
import {emptyState} from '../../src/lib/domain/types';
import type {AgentHouseReport, AgentHouseRuns} from '../../src/lib/agent-house';

const now = '2026-11-14T09:00:00.000Z';
const ids = ['leader', 'strategy', 'tracking', 'awareness', 'daily', 'discovery'] as const;
const labels = ['Lider', 'YKS Stratejisti', 'YKSİM Takipçisi', 'Öz Farkındalık', 'Günlük Rehber', 'Keşif'];
const reportHeadings = ['Büyük resim', 'Çalışmanın yönü', 'İlerlemenin kaydı', 'Kendi ritmini keşfet', 'Günün akışı', 'Yeni bir pencere'];

function roomRail(page: Page) {
  return page.getByRole('navigation', {name: 'Ajan odaları', exact: true});
}

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

const longDetail = 'Bu sentetik programda çalışmanın tamamlanma ölçütü ve kaynak notu birlikte korunur. '.repeat(9).trim();

function longReport(): AgentHouseReport {
  const result = report('sample', 'long-synthetic');
  const strategy = result.agents.find(agent => agent.id === 'strategy')!;
  strategy.summary += ` ${longDetail} Son değerlendirme kontrolü.`;
  strategy.recommendations = Array.from({length: 12}, (_, index) => `Deneme önerisi ${index + 1}. ${longDetail.slice(0, 320)}`);
  strategy.sources = Array.from({length: 16}, (_, index) => ({
    title: `Sentetik kaynak ${index + 1}`, url: `https://example.org/sources/${index + 1}`, note: longDetail,
  }));
  strategy.tables = [{
    title: 'Ayrıntılı çalışma görevleri',
    columns: ['Kayıt', 'Uzun konu başlığı', 'Kayıtlı süre', 'Başarı ölçütü', 'Yöntem açıklaması'],
    rows: Array.from({length: 100}, (_, index) => [`Sentetik satır ${index + 1}`, 'ÇokUzunBoşluksuzAlan'.repeat(14),
      `${index + 1} dk`, `Sonuç kontrolü ${index + 1}`, longDetail.slice(0, 200)]),
  }, {
    title: 'Ayrı doğrulama tablosu', columns: ['Aşama', 'Sonuç'], rows: [['Son kontrol', 'İkinci tablo uç kaydı']],
  }];
  const daily = result.agents.find(agent => agent.id === 'daily')!;
  daily.schedule = [
    {date: '2026-11-18', start: '19:00', end: '19:35', title: 'Çarşamba son oturumu', detail: longDetail},
    {date: '2026-11-16', start: '08:00', end: '08:25', title: 'Pazartesi açılışı', detail: 'Önceki yanlışları kayıttan aç.'},
    {date: '2026-11-18', start: '16:00', end: '16:25', title: 'Çarşamba ilk oturumu', detail: 'Deneme ölçütlerini kontrol et.'},
    {date: '2026-11-22', start: '11:00', end: '11:20', title: 'Pazar son kontrolü', detail: 'Bütün sentetik görevleri gözden geçir.'},
  ];
  return result;
}

async function openHouse(page: Page, width: number, runs: AgentHouseRuns, options: {fail?: boolean; controlledClock?: boolean} = {}) {
  await page.setViewportSize({width, height: 1000});
  if (options.controlledClock) await page.clock.install({time: new Date(now)});
  else await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({json: {...emptyState(true), authenticated: true, server_now: now}}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {connected: false, date: '2026-11-14', timezone: 'Europe/Istanbul', events: [], refreshedAt: null}}));
  await page.route('**/api/analysis', route => route.fulfill({json: {ok: true, reports: [], configured: false, model: null, limits: {monthly_requests: 4, monthly_usd: 0}, used: {requests: 0, estimated_cost_usd: 0}}}));
  let writes = 0;
  let gets = 0;
  await page.route('**/api/agent-house', route => {
    if (route.request().method() !== 'GET') writes++;
    else gets++;
    return route.fulfill(options.fail ? {status: 503, json: {error: {message: 'Rapor bağlantısı geçici olarak kesildi.'}}} : {json: {runs}});
  });
  await page.goto('/');
  const navigation = page.getByRole('navigation', {name: 'Ana gezinme'});
  if (width <= 760) {
    const menu = page.getByRole('button', {name: 'Menüyü aç', exact: true});
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('aside.sidebar.is-open').getByRole('navigation', {name: 'Ana gezinme'})).toBeInViewport();
  }
  const analysis = navigation.getByRole('button', {name: 'Analiz', exact: true});
  await expect(analysis).toBeInViewport();
  if (options.controlledClock) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await analysis.click();
  await expect(page.getByTestId('agent-house')).toBeVisible();
  await expect(page.getByTestId('agent-house').getByRole('button', {name: 'Yenile', exact: true})).toBeEnabled();
  return {writes: () => writes, gets: () => gets};
}

async function mascotPosition(mascot: Locator) {
  return mascot.evaluate(async element => {
    const transitions = element.getAnimations().filter(animation => animation instanceof CSSTransition);
    await Promise.allSettled(transitions.map(animation => animation.finished));
    const {x, y} = element.getBoundingClientRect();
    const scene = element.closest('[data-testid="agent-house-scene"]')!.getBoundingClientRect();
    return {x: x - scene.x, y: y - scene.y};
  });
}

function distance(first: {x: number; y: number}, second: {x: number; y: number}) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

async function openMovingHouse(page: Page) {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  const writes: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url());
  });
  await openHouse(page, 1440, {live: [], sample: [report('sample')]}, {controlledClock: true});
  const scene = page.getByTestId('agent-house-scene');
  const motion = scene.getByTestId('agent-house-motion');
  await motion.scrollIntoViewIfNeeded();
  await expect(motion).toHaveAttribute('data-motion', 'running');
  return {writes, scene, motion, strategist: motion.locator('[data-mascot-id="strategy"]')};
}

for (const width of [360, 1280]) test(`ajan evi odaları raporu ve programı açar, sohbet ve otomatik yazma yok · ${width}px`, async ({page}) => {
  const requests = await openHouse(page, width, {live: [report('live')], sample: [report('sample')]});
  const house = page.getByTestId('agent-house');
  const detail = page.getByTestId('agent-room-report');
  const rooms = roomRail(page);
  await expect(house.getByRole('button', {name: 'Benim raporlarım', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(detail).toContainText('Kişisel Lider değerlendirmesi.');
  await expect(rooms.getByRole('button', {name: / odası$/})).toHaveCount(6);
  await expect(house.getByRole('textbox')).toHaveCount(0);
  await expect(house.locator('textarea,[contenteditable=true]')).toHaveCount(0);

  const strategist = rooms.getByRole('button', {name: 'YKS Stratejisti odası', exact: true});
  await strategist.focus();
  await page.keyboard.press('Enter');
  await expect(strategist).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.getByRole('heading', {name: 'Çalışmanın yönü'})).toBeFocused();
  await expect(detail).toContainText('Önce problem çözümündeki yanlışlarını incele.');
  await detail.getByRole('tab', {name: /^Kaynaklar\b/}).click();
  await expect(detail.getByRole('link', {name: 'Öğrenme araştırması'})).toHaveAttribute('href', 'https://example.org/research');

  await rooms.getByRole('button', {name: 'YKSİM Takipçisi odası', exact: true}).click();
  await detail.getByRole('tab', {name: 'Veriler', exact: true}).click();
  await expect(detail.getByRole('table')).toContainText('Matematik');
  await expect(detail.getByRole('table')).toContainText('90 dk');

  await rooms.getByRole('button', {name: 'Günlük Rehber odası', exact: true}).click();
  await detail.getByRole('tab', {name: 'Program', exact: true}).click();
  await expect(detail).toContainText('17:00–17:25');
  await expect(detail).toContainText('Problemler');
  await expect(detail).toContainText('Yanlışların nedenlerini not et.');
  await rooms.getByRole('button', {name: 'Öz Farkındalık odası', exact: true}).click();
  await expect(detail).toContainText('Kişisel Öz Farkındalık değerlendirmesi.');
  await rooms.getByRole('button', {name: 'Keşif odası', exact: true}).click();
  await expect(detail).toContainText('Bu akışta çalışmadı');

  await house.getByRole('button', {name: 'Örnek akış', exact: true}).click();
  await expect(house).toContainText('ÖRNEK VERİ');
  await expect(detail).toContainText('Örnek Keşif değerlendirmesi.');
  await expect(detail).not.toContainText('Kişisel');
  await rooms.getByRole('button', {name: 'YKSİM Takipçisi odası', exact: true}).click();
  await detail.getByRole('tab', {name: 'Veriler', exact: true}).click();
  await expect(detail.getByRole('table')).toContainText('25 dk');
  await expect(detail.getByRole('table')).not.toContainText('90 dk');
  await house.getByRole('button', {name: 'Benim raporlarım', exact: true}).click();
  await detail.getByRole('tab', {name: 'Veriler', exact: true}).click();
  await expect(detail.getByRole('table')).toContainText('90 dk');
  await expect(house).not.toContainText('ÖRNEK VERİ');

  await rooms.getByRole('button', {name: 'Günlük Rehber odası', exact: true}).click();
  await detail.getByRole('tab', {name: 'Program', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_AGENT_HOUSE_SCREENSHOT === '1') {
    await page.screenshot({path: `artifacts/agent-house-${width}.png`, fullPage: true});
  }
  expect(requests.gets()).toBeGreaterThanOrEqual(1);
  expect(requests.writes()).toBe(0);
});

test('rapor sekmeleri yön tuşlarıyla açılır ve odalar kendi bölümlerini gösterir', async ({page}) => {
  await openHouse(page, 768, {live: [], sample: [longReport()]});
  const house = page.getByTestId('agent-house');
  const detail = house.getByTestId('agent-room-report');
  await roomRail(page).getByRole('button', {name: 'YKS Stratejisti odası', exact: true}).click();
  const tabs = detail.getByRole('tablist', {name: 'Rapor bölümleri'});
  const summary = tabs.getByRole('tab', {name: 'Özet', exact: true});
  const data = tabs.getByRole('tab', {name: 'Veriler', exact: true});
  const sources = tabs.getByRole('tab', {name: /^Kaynaklar\b/});
  const panel = detail.getByRole('tabpanel');
  await expect(summary).toHaveAttribute('aria-selected', 'true');
  await expect(summary).toHaveAttribute('tabindex', '0');
  await expect(data).toHaveAttribute('tabindex', '-1');
  await summary.press('ArrowRight');
  await expect(data).toBeFocused();
  await expect(data).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('table')).toContainText('Sentetik satır 1');
  await data.press('End');
  await expect(sources).toBeFocused();
  await expect(sources).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('link', {name: /^Sentetik kaynak 16\b/})).toBeVisible();
  await sources.press('Home');
  await expect(summary).toBeFocused();
  await expect(panel).toContainText('Örnek YKS Stratejisti değerlendirmesi.');
  await summary.press('ArrowLeft');
  await expect(sources).toBeFocused();
  await expect(sources).toHaveAttribute('aria-selected', 'true');

  await roomRail(page).getByRole('button', {name: 'Günlük Rehber odası', exact: true}).click();
  await expect(summary).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', {name: 'Program', exact: true})).toBeVisible();
  await expect(data).toHaveCount(0);
  await expect(sources).toHaveCount(0);
});

test('uzun örnek raporda son öneri, kaynak ve yüz satırın tamamı okunabilir', async ({page}) => {
  const sample = longReport();
  await openHouse(page, 1280, {live: [], sample: [sample]});
  const house = page.getByTestId('agent-house');
  await roomRail(page).getByRole('button', {name: 'YKS Stratejisti odası', exact: true}).click();
  const detail = house.getByTestId('agent-room-report');
  const panel = detail.getByRole('tabpanel');
  const strategy = sample.agents.find(agent => agent.id === 'strategy')!;
  const fullSummary = panel.getByText(strategy.summary, {exact: true});
  await expect(fullSummary).toBeHidden();
  await panel.getByRole('button', {name: 'Değerlendirmenin tamamını oku'}).click();
  await expect(fullSummary).toBeVisible();
  await panel.getByRole('button', {name: 'Özeti daralt'}).click();
  await expect(fullSummary).toBeHidden();
  await expect(panel.getByText(strategy.recommendations[0], {exact: true})).toBeVisible();
  const finalRecommendation = panel.getByText(strategy.recommendations[11], {exact: true});
  await expect(finalRecommendation).toBeHidden();
  await panel.locator('summary').filter({hasText: /Öneri 12/}).click();
  await expect(finalRecommendation).toBeVisible();

  await detail.getByRole('tab', {name: /^Kaynaklar\b/}).click();
  await expect(panel.getByRole('link')).toHaveCount(16);
  await expect(panel.getByRole('link', {name: /^Sentetik kaynak 16\b/})).toHaveAttribute('href', 'https://example.org/sources/16');

  await detail.getByRole('tab', {name: 'Veriler', exact: true}).click();
  const firstTable = strategy.tables[0];
  const table = panel.getByRole('table');
  const next = panel.getByRole('button', {name: 'Sonraki satırlar', exact: true});
  const previous = panel.getByRole('button', {name: 'Önceki satırlar', exact: true});
  await expect(previous).toBeDisabled();
  for (let start = 0; start < firstTable.rows.length; start += 10) {
    const rows = firstTable.rows.slice(start, start + 10);
    await expect(table.locator('tbody tr td:first-child')).toHaveText(rows.map(row => row[0]));
    if (start + rows.length < firstTable.rows.length) await next.click();
  }
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(table.getByRole('cell', {name: 'Sentetik satır 81', exact: true})).toBeVisible();
  await panel.getByRole('button', {name: /Ayrı doğrulama tablosu/}).click();
  await expect(table).toContainText('İkinci tablo uç kaydı');
  await panel.getByRole('button', {name: /Ayrıntılı çalışma görevleri/}).click();
  await expect(table).not.toContainText('İkinci tablo uç kaydı');
});

test('tablo biçiminde gelen saat atanmamış program günlere ayrılır ve asıl kayıtlar okunabilir kalır', async ({page}) => {
  const sample = report('sample');
  const daily = sample.agents.find(agent => agent.id === 'daily')!;
  daily.schedule = [];
  daily.tables = [{title: 'Haftalık çalışma sırası', columns: ['Gün', 'Sıra', 'Çalışma', 'Süre', 'Nasıl yapacaksın?'], rows: [
    ['Pazartesi', '1', 'Sentetik geometri tekrarı', '25 dk', 'Eski yanlışları yeniden dene.'],
    ['Cuma', '1', 'Sentetik paragraf denemesi', '15 dk', 'İki yanlışın nedenini yaz.'],
    ['Cuma', '2', 'Sentetik haftalık kontrol', '10 dk', 'Kaydedilen süreleri karşılaştır.'],
  ]}];
  await openHouse(page, 768, {live: [], sample: [sample]});
  const house = page.getByTestId('agent-house');
  await roomRail(page).getByRole('button', {name: 'Günlük Rehber odası', exact: true}).click();
  await house.getByRole('tab', {name: 'Program', exact: true}).click();
  const plan = house.getByTestId('agent-plan');
  await expect(plan.getByRole('button', {name: 'Pazartesi', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(plan.getByText('Sentetik geometri tekrarı', {exact: true})).toBeVisible();
  await plan.getByRole('button', {name: 'Cuma', exact: true}).click();
  const friday = plan.getByTestId('agent-plan-day');
  await expect(friday.getByRole('heading', {name: /^Sentetik/})).toHaveText(['Sentetik paragraf denemesi', 'Sentetik haftalık kontrol']);
  await expect(friday).toContainText('15 dk');
  await expect(friday).toContainText('Kaydedilen süreleri karşılaştır.');
  await house.getByRole('tab', {name: 'Veriler', exact: true}).click();
  await expect(house.getByRole('table').getByRole('row')).toHaveCount(4);
});

test('program tarih değiştirince yalnız seçilen günün bütün blokları gösterilir', async ({page}) => {
  await openHouse(page, 768, {live: [], sample: [longReport()]});
  const house = page.getByTestId('agent-house');
  await roomRail(page).getByRole('button', {name: 'Günlük Rehber odası', exact: true}).click();
  await house.getByRole('tab', {name: 'Program', exact: true}).click();
  const plan = house.getByTestId('agent-plan');
  const day = plan.getByTestId('agent-plan-day');
  const monday = plan.getByRole('button', {name: /\b16\b/});
  const wednesday = plan.getByRole('button', {name: /\b18\b/});
  const sunday = plan.getByRole('button', {name: /\b22\b/});
  await expect(monday).toHaveAttribute('aria-pressed', 'true');
  await expect(plan.getByText('Pazartesi açılışı', {exact: true})).toBeVisible();
  await expect(plan.getByText('Çarşamba son oturumu', {exact: true})).toHaveCount(0);

  await wednesday.press('Enter');
  await expect(wednesday).toHaveAttribute('aria-pressed', 'true');
  await expect(monday).toHaveAttribute('aria-pressed', 'false');
  await expect(plan.getByText('Pazartesi açılışı', {exact: true})).toHaveCount(0);
  const last = plan.getByText('Çarşamba son oturumu', {exact: true});
  await expect(day.getByRole('heading', {name: /Çarşamba .* oturumu/})).toHaveText(['Çarşamba ilk oturumu', 'Çarşamba son oturumu']);
  await expect(plan.getByText(longDetail, {exact: true})).toBeVisible();

  await sunday.click();
  await expect(sunday).toHaveAttribute('aria-pressed', 'true');
  await expect(plan.getByText('Pazar son kontrolü', {exact: true})).toBeVisible();
  await expect(last).toHaveCount(0);
  await monday.click();
  await expect(plan.getByText('Önceki yanlışları kayıttan aç.', {exact: true})).toBeVisible();
});

for (const width of [320, 768, 1024, 1440]) test(`uzun ajan raporu sayfayı taşırmaz · ${width}px`, async ({page}) => {
  await openHouse(page, width, {live: [], sample: [longReport()]});
  const house = page.getByTestId('agent-house');
  const detail = house.getByTestId('agent-room-report');
  const scene = house.getByTestId('agent-house-scene');
  await expect(scene).toBeVisible();
  await expect(scene.getByRole('button', {name: / odası$/})).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const room = scene.getByRole('button', {name: 'YKS Stratejisti odası', exact: true});
  const floor = room.getByTestId('agent-room-floor-strategy');
  const heading = detail.getByRole('heading', {name: 'Çalışmanın yönü', exact: true});
  await floor.click();
  await expect(heading).toBeFocused();
  await detail.getByRole('button', {name: 'Eve dön', exact: true}).click();
  await expect(room).toBeFocused();
  await room.click();
  await expect(heading).toBeFocused();
  await detail.getByRole('tab', {name: 'Veriler', exact: true}).click();
  await expect(detail.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await detail.getByRole('tab', {name: /^Kaynaklar\b/}).click();
  await expect(detail.getByRole('link', {name: /^Sentetik kaynak 16\b/})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('piksel ev ve altı maskot yüklenir, her oda kendi raporunu açar ve geri dönünce oda odaklanır', async ({page}) => {
  const requests = await openHouse(page, 1440, {live: [], sample: [report('sample')]});
  const house = page.getByTestId('agent-house');
  const scene = house.getByTestId('agent-house-scene');
  const detail = house.getByTestId('agent-room-report');
  await expect(scene).toBeVisible();
  const artwork = scene.locator('img');
  await expect(artwork).toHaveCount(7);
  await expect.poll(() => artwork.evaluateAll(images => images.every(node => {
    const image = node as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  }))).toBe(true);
  const roomButtons = scene.getByRole('button', {name: / odası$/});
  await expect(roomButtons).toHaveCount(6);

  for (const [index, label] of labels.entries()) {
    const room = scene.getByRole('button', {name: `${label} odası`, exact: true});
    await expect(room).toBeVisible();
    await room.getByTestId(`agent-room-floor-${ids[index]}`).click();
    await expect(scene).toBeHidden();
    await expect(detail.getByRole('heading', {name: reportHeadings[index], exact: true})).toBeFocused();
    await expect(detail).toContainText(`Örnek ${label} değerlendirmesi.`);
    await detail.getByRole('button', {name: 'Eve dön', exact: true}).click();
    await expect(scene).toBeVisible();
    await expect(room).toHaveAttribute('aria-pressed', 'true');
    await expect(room).toBeFocused();
  }
  expect(requests.writes()).toBe(0);
});

test('ev görünümü açılıp kapanabilir, hazır oda sayısı seçilen rapora dayanır', async ({page}) => {
  const sample = report('sample');
  sample.agents.find(agent => agent.id === 'awareness')!.status = 'no_data';
  const requests = await openHouse(page, 768, {live: [], sample: [sample]});
  const house = page.getByTestId('agent-house');
  const scene = house.getByTestId('agent-house-scene');
  const toggle = house.locator('summary').filter({hasText: 'Ajan evin'});
  await expect(scene).toBeVisible();
  await expect(toggle).toContainText('4 odada rapor hazır');
  await expect(scene.getByRole('button', {name: / odası$/})).toHaveCount(6);
  await toggle.click();
  await expect(scene).toBeHidden();
  await expect(roomRail(page).getByRole('button', {name: / odası$/})).toHaveCount(6);
  await toggle.press('Enter');
  await expect(scene).toBeVisible();
  await house.getByRole('button', {name: 'Benim raporlarım', exact: true}).click();
  await expect(scene).toBeVisible();
  await expect(toggle).toContainText('0 odada rapor hazır');
  await expect(house.getByTestId('agent-room-report')).toContainText('Bu odanın raporu henüz gelmedi');
  expect(requests.writes()).toBe(0);
});

test('maskot yürür, masasında çalışır, yan odaya gider ve başlangıç yerine döner', async ({page}) => {
  const {writes, strategist} = await openMovingHouse(page);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'idle');
  const home = await mascotPosition(strategist);

  await page.clock.runFor(1600);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'walking');
  await expect(strategist).toHaveAttribute('data-target-room', 'strategy');
  const firstStep = await mascotPosition(strategist);
  expect(distance(home, firstStep)).toBeGreaterThan(2);
  await page.clock.runFor(500);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'walking');
  const secondStep = await mascotPosition(strategist);
  expect(distance(firstStep, secondStep)).toBeGreaterThan(2);

  await page.clock.runFor(2900);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'working');
  const desk = await mascotPosition(strategist);
  expect(distance(home, desk)).toBeGreaterThan(10);

  // Visiting the adjacent room is well inside a five-second hold, so sample it directly.
  await page.clock.runFor(28_000);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'visiting');
  await expect(strategist).toHaveAttribute('data-target-room', 'tracking');
  const visit = await mascotPosition(strategist);
  expect(visit.x - home.x).toBeGreaterThan(50);

  await page.clock.runFor(10_000);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'idle');
  await expect(strategist).toHaveAttribute('data-target-room', 'strategy');
  expect(distance(await mascotPosition(strategist), home)).toBeLessThan(1);
  expect(writes).toEqual([]);
});

test('hareket düğmesi maskotu olduğu yerde durdurur ve aynı rotadan sürdürür', async ({page}) => {
  const {writes, scene, motion, strategist} = await openMovingHouse(page);
  await page.clock.runFor(1600);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'walking');
  const before = await mascotPosition(strategist);
  await scene.getByRole('button', {name: 'Hareketi durdur', exact: true}).click();
  await expect(motion).toHaveAttribute('data-motion', 'paused');
  await expect.poll(() => motion.evaluate(element => element.getAnimations({subtree: true})
    .some(animation => animation.playState === 'running'))).toBe(false);
  await page.clock.runFor(3500);
  expect(distance(await mascotPosition(strategist), before)).toBeLessThan(1);

  await scene.getByRole('button', {name: 'Hareketi başlat', exact: true}).click();
  await expect(motion).toHaveAttribute('data-motion', 'running');
  await page.clock.runFor(480);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'walking');
  expect(distance(await mascotPosition(strategist), before)).toBeGreaterThan(2);

  await scene.getByTestId('agent-room-floor-strategy').click();
  await page.clock.runFor(80);
  await expect(scene).toBeHidden();
  await expect(page.getByTestId('agent-room-report').getByRole('heading', {name: 'Çalışmanın yönü', exact: true})).toBeFocused();
  expect(writes).toEqual([]);
});

for (const preference of ['system', 'app'] as const) test(`hareket tercihi çalışma sırasında uygulanır · ${preference}`, async ({page}) => {
  const {writes, scene, motion, strategist} = await openMovingHouse(page);
  await page.clock.runFor(1600);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'walking');
  const before = await mascotPosition(strategist);
  if (preference === 'system') await page.emulateMedia({reducedMotion: 'reduce'});
  else await page.locator('html').evaluate(root => root.setAttribute('data-reduced', 'true'));

  await expect(motion).toHaveAttribute('data-motion', 'reduced');
  await expect(scene.getByRole('button', {name: 'Hareketi başlat', exact: true})).toBeDisabled();
  await expect.poll(() => scene.evaluate(element => element.getAnimations({subtree: true}).length)).toBe(0);
  await page.clock.runFor(3500);
  expect(distance(await mascotPosition(strategist), before)).toBeLessThan(1);

  if (preference === 'system') await page.emulateMedia({reducedMotion: 'no-preference'});
  else await page.locator('html').evaluate(root => root.setAttribute('data-reduced', 'false'));
  await expect(motion).toHaveAttribute('data-motion', 'running');
  await page.clock.runFor(480);
  await expect(strategist).toHaveAttribute('data-mascot-state', 'walking');
  expect(distance(await mascotPosition(strategist), before)).toBeGreaterThan(2);
  expect(writes).toEqual([]);
});

for (const preference of ['system', 'app'] as const) test(`azaltılmış hareket tercihinde ev ve oda kontrolü animasyonsuz çalışır · ${preference}`, async ({page}) => {
  await page.emulateMedia({reducedMotion: preference === 'system' ? 'reduce' : 'no-preference'});
  if (preference === 'app') await page.addInitScript(() => localStorage.setItem('yksim-reduced', 'true'));
  await openHouse(page, 1440, {live: [], sample: [report('sample')]});
  const house = page.getByTestId('agent-house');
  const scene = house.getByTestId('agent-house-scene');
  await expect(scene).toBeVisible();
  if (preference === 'app') await expect(page.locator('html')).toHaveAttribute('data-reduced', 'true');
  const room = scene.getByRole('button', {name: 'YKSİM Takipçisi odası', exact: true});
  await expect.poll(() => scene.evaluate(element => element.getAnimations({subtree: true}).length)).toBe(0);
  await room.press('Enter');
  await expect(scene).toBeHidden();
  await expect(house.getByRole('heading', {name: 'İlerlemenin kaydı', exact: true})).toBeFocused();
});

test('ajan evi seçilen geçmiş raporun içeriğini gösterir', async ({page}) => {
  const earlier = report('live', 'earlier-report');
  earlier.generated_at = '2026-11-07T09:00:00.000Z';
  earlier.week_start = '2026-11-09';
  earlier.agents[0].summary = 'Daha erken tarihli sentetik lider değerlendirmesi.';
  const requests = await openHouse(page, 1280, {live: [report('live'), earlier], sample: [report('sample')]});
  const house = page.getByTestId('agent-house');
  const detail = page.getByTestId('agent-room-report');
  const history = house.getByRole('combobox', {name: 'Rapor', exact: true});
  await expect(history).toHaveValue('live');
  await expect(detail).toContainText('Kişisel Lider değerlendirmesi.');
  await history.selectOption('earlier-report');
  await expect(detail).toContainText(earlier.agents[0].summary);
  await expect(detail).not.toContainText('Kişisel Lider değerlendirmesi.');
  await history.selectOption('live');
  await expect(detail).toContainText('Kişisel Lider değerlendirmesi.');
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
  const requests = await openHouse(page, 360, {live: [], sample: []}, {fail: true});
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
