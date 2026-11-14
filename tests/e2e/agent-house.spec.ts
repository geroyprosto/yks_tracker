import {expect, test, type Locator, type Page} from '@playwright/test';
import {emptyState} from '../../src/lib/domain/types';
import type {AgentHouseReport, AgentHouseRuns} from '../../src/lib/agent-house';

const now = '2026-11-14T09:00:00.000Z';
const ids = ['leader', 'strategy', 'tracking', 'awareness', 'daily', 'discovery'] as const;
const labels = ['Lider', 'YKS Stratejisti', 'YKSİM Takipçisi', 'Öz Farkındalık', 'Günlük Rehber', 'Keşif'];
const reportHeadings = ['Büyük resim', 'Çalışmanın yönü', 'İlerlemenin kaydı', 'Kendi ritmini keşfet', 'Günün akışı', 'Yeni bir pencere'];

function roomRail(page: Page) {
  return page.getByRole('navigation', {name: 'Evin odaları', exact: true});
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

async function openRoom(page: Page, label: string) {
  await roomRail(page).getByRole('button', {name: `${label} odası`, exact: true}).click();
  return page.getByTestId('agent-room-report');
}

async function options(page: Page) {
  await page.getByLabel('Ev seçenekleri', {exact: true}).click();
  return page.getByTestId('agent-house');
}

for (const width of [320, 768, 1024, 1440]) test(`ev tek sahnede kalır, not açılır ve odağa dönülür · ${width}px`, async ({page}) => {
  const requests = await openHouse(page, width, {live: [longReportWithMode()], sample: []});
  const house = page.getByTestId('agent-house');
  const scene = house.getByTestId('agent-house-scene');
  const room = roomRail(page).getByRole('button', {name: 'YKS Stratejisti odası', exact: true});
  await expect(scene).toBeVisible();
  await expect(house.getByRole('dialog')).toHaveCount(0);
  await expect(roomRail(page).getByRole('button')).toHaveCount(6);
  await expect(house.getByRole('navigation', {name: 'Ajan odaları', exact: true})).toHaveCount(0);
  await expect(house.getByRole('button', {name: 'Benim raporlarım', exact: true})).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await room.getByTestId('agent-room-floor-strategy').click();
  const detail = page.getByTestId('agent-room-report');
  await expect(detail).toHaveAttribute('open', '');
  await expect(detail.getByRole('heading', {name: 'Çalışmanın yönü', exact: true})).toBeFocused();
  await expect(scene).toBeVisible();
  await expect(detail.getByRole('tab')).toHaveCount(0);
  await expect(detail.getByRole('table')).toHaveCount(0);
  await expect(detail.getByRole('link')).toHaveCount(0);
  await expect(detail).not.toContainText('Ayrıntılı çalışma görevleri');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(room).toBeFocused();
  expect(requests.writes()).toBe(0);
});

function longReportWithMode(): AgentHouseReport {
  return {...longReport(), mode: 'live'};
}

for (const [width, height] of [[1440, 900], [1920, 915], [2560, 1080]]) test(`ev kullanılabilir ekranı boşluksuz doldurur · ${width}×${height}`, async ({page}) => {
  await openHouse(page, width, {live: [report('live')], sample: []});
  await page.setViewportSize({width, height});
  const scene = page.getByTestId('agent-house-scene');
  const sidebar = await page.locator('aside.sidebar').boundingBox();
  await expect.poll(() => scene.boundingBox()).toEqual({x: sidebar!.width, y: 0, width: width - sidebar!.width, height});
  expect(await page.evaluate(() => ({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight}))).toEqual({width, height});
  for (const id of ids) await expect(scene.locator(`[data-room-id="${id}"]`)).toBeInViewport({ratio: 1});
  await expect(scene.getByRole('button', {name: 'Hareketi durdur', exact: true})).toBeInViewport({ratio: 1});
});

test('dar ekranda ev kaydırılır, bütün odalar ve ana menü erişilebilir kalır', async ({page}) => {
  await openHouse(page, 390, {live: [report('live')], sample: []});
  await page.setViewportSize({width: 390, height: 844});
  const scene = page.getByTestId('agent-house-scene');
  await expect.poll(() => scene.boundingBox()).toEqual({x: 0, y: 0, width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
  for (const label of labels) {
    const room = roomRail(page).getByRole('button', {name: `${label} odası`, exact: true});
    await room.click();
    await expect(page.getByTestId('agent-room-report')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(room).toBeFocused();
    await expect(scene.getByRole('button', {name: 'Hareketi durdur', exact: true})).toBeInViewport({ratio: 1});
  }
  await page.getByRole('button', {name: 'Menüyü aç', exact: true}).click();
  await page.getByRole('navigation', {name: 'Ana gezinme', exact: true}).getByRole('button', {name: 'Bugün', exact: true}).click();
  await expect(page.getByTestId('agent-house')).toHaveCount(0);
  await expect(page.getByRole('navigation', {name: 'Mobil gezinme'})).toBeVisible();
});

test('altı oda kendi notunu açar, görseller yüklenir ve odak not defterinde kalır', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = await openHouse(page, 1440, {live: [report('live')], sample: []});
  const scene = page.getByTestId('agent-house-scene');
  const images = scene.locator('img');
  await expect(images).toHaveCount(7);
  await expect.poll(() => images.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
  for (const [index, label] of labels.entries()) {
    const room = roomRail(page).getByRole('button', {name: `${label} odası`, exact: true});
    await room.press('Enter');
    const detail = page.getByTestId('agent-room-report');
    await expect(detail.getByRole('heading', {name: reportHeadings[index], exact: true})).toBeFocused();
    if (ids[index] === 'daily') await expect(detail.getByTestId('agent-plan')).toBeVisible();
    else if (ids[index] === 'strategy') await expect(detail).toContainText('Önce problem çözümündeki yanlışlarını incele.');
    else await expect(detail).toContainText(`Kişisel ${label} değerlendirmesi.`);
    for (let n = 0; n < 8; n++) {
      await page.keyboard.press('Tab');
      expect(await detail.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await detail.getByRole('button', {name: 'Eve dön', exact: true}).click();
    await expect(room).toBeFocused();
  }
  expect(errors).toEqual([]);
  expect(requests.writes()).toBe(0);
});

test('öneriler kesilmeden tek tek okunur, son nottan geri dönülebilir', async ({page}) => {
  const sample = longReport();
  await openHouse(page, 768, {live: [], sample: [sample]});
  const detail = await openRoom(page, 'YKS Stratejisti');
  const notes = sample.agents.find(agent => agent.id === 'strategy')!.recommendations;
  await expect(detail.getByRole('button', {name: 'Önceki not', exact: true})).toBeDisabled();
  for (const [index, note] of notes.entries()) {
    await expect(detail.getByText(note, {exact: true})).toBeVisible();
    await expect(detail.getByLabel('Ajanın notu').locator('p')).toHaveCount(1);
    if (index < notes.length - 1) await detail.getByRole('button', {name: 'Sonraki not', exact: true}).click();
  }
  await expect(detail.getByRole('button', {name: 'Sonraki not', exact: true})).toBeDisabled();
  await detail.getByRole('button', {name: 'Önceki not', exact: true}).click();
  await expect(detail.getByText(notes.at(-2)!, {exact: true})).toBeVisible();
});

test('günlük rehber programla açılır; gün ve çalışma ayrıntısı seçilince gösterilir', async ({page}) => {
  await openHouse(page, 360, {live: [], sample: [longReport()]});
  const detail = await openRoom(page, 'Günlük Rehber');
  const plan = detail.getByTestId('agent-plan');
  await expect(plan).toBeVisible();
  await expect(plan).toContainText('Pazartesi açılışı');
  await expect(plan.getByText('Önceki yanlışları kayıttan aç.', {exact: true})).toBeHidden();
  await plan.locator('summary').filter({hasText: 'Pazartesi açılışı'}).click();
  await expect(plan.getByText('Önceki yanlışları kayıttan aç.', {exact: true})).toBeVisible();
  await plan.getByRole('button', {name: 'Sonraki gün', exact: true}).click();
  await expect(plan).not.toContainText('Pazartesi açılışı');
  await expect(plan.locator('summary strong')).toHaveText(['Çarşamba ilk oturumu', 'Çarşamba son oturumu']);
  await plan.getByRole('combobox', {name: 'Program günü'}).selectOption('2');
  await expect(plan).toContainText('Pazar son kontrolü');
  await expect(plan.getByRole('button', {name: 'Sonraki gün', exact: true})).toBeDisabled();
  await detail.getByRole('button', {name: 'Notlar', exact: true}).click();
  await expect(detail).toContainText('Örnek Günlük Rehber değerlendirmesi.');
});

test('saat içermeyen program tablosu da günlük not defterinde okunur', async ({page}) => {
  const sample = report('sample');
  const daily = sample.agents.find(agent => agent.id === 'daily')!;
  daily.schedule = [];
  daily.tables = [{title: 'Günlük plan', columns: ['Gün', 'Sıra', 'Çalışma', 'Süre', 'Nasıl yapacaksın?'], rows: [
    ['Pazartesi', '1', 'Geometri tekrarı', '25 dk', 'Önce yardımsız dene.'],
    ['Cuma', '1', 'Paragraf denemesi', '30 dk', 'Süre tut.'],
    ['Cuma', '2', 'Haftalık kontrol', '15 dk', 'Sonuçları karşılaştır.'],
  ]}];
  await openHouse(page, 768, {live: [], sample: [sample]});
  const detail = await openRoom(page, 'Günlük Rehber');
  await expect(detail).toContainText('Geometri tekrarı');
  await detail.getByRole('combobox', {name: 'Program günü'}).selectOption({label: 'Cuma'});
  await expect(detail).toContainText('Paragraf denemesi');
  await expect(detail).toContainText('Haftalık kontrol');
  await expect(detail).toContainText('15 dk');
  await expect(detail.getByRole('table')).toHaveCount(0);
});

test('örnek ve kişisel raporlar karışmaz, geçmiş seçim seçeneklerde kalır', async ({page}) => {
  const earlier = report('live', 'earlier');
  earlier.week_start = '2026-11-09';
  earlier.generated_at = '2026-11-07T09:00:00.000Z';
  earlier.agents[0].summary = 'Daha erken tarihli lider değerlendirmesi.';
  await openHouse(page, 1280, {live: [report('live'), earlier], sample: [report('sample')]});
  const house = await options(page);
  await house.getByRole('combobox', {name: 'Rapor', exact: true}).selectOption('earlier');
  let detail = await openRoom(page, 'Lider');
  await expect(detail).toContainText(earlier.agents[0].summary);
  await detail.getByRole('button', {name: 'Eve dön', exact: true}).click();
  await options(page);
  await house.getByRole('button', {name: 'Örnek akış', exact: true}).click();
  detail = await openRoom(page, 'Lider');
  await expect(detail).toContainText('Örnek Lider değerlendirmesi.');
  await expect(detail).toContainText('Örnek rapor');
  await expect(detail).not.toContainText(earlier.agents[0].summary);
});

test('boş kişisel rapora örnek içerik taşınmaz', async ({page}) => {
  await openHouse(page, 360, {live: [], sample: [report('sample')]});
  const house = await options(page);
  await house.getByRole('button', {name: 'Benim raporlarım', exact: true}).click();
  const detail = await openRoom(page, 'Lider');
  await expect(detail).toContainText('Henüz bir not yok.');
  await expect(detail).not.toContainText('Örnek Lider');
});

test('hata ve yenileme çalışır, not defteri yükleme bitmeden açılabilir', async ({page}) => {
  const requests = await openHouse(page, 360, {live: [], sample: []}, {fail: true});
  await expect(page.getByTestId('agent-house').getByRole('alert')).toContainText('Rapor bağlantısı geçici olarak kesildi.');
  const detail = await openRoom(page, 'Lider');
  await expect(detail).toContainText('Henüz bir not yok.');
  await detail.getByRole('button', {name: 'Eve dön', exact: true}).click();
  await page.getByRole('button', {name: 'Yenile', exact: true}).click();
  await expect.poll(requests.gets).toBeGreaterThanOrEqual(2);
  expect(requests.writes()).toBe(0);
});

test('rapor aktarımı seçeneklerde çalışır ve geçersiz dosya gönderilmez', async ({page}) => {
  const requests = await openHouse(page, 1280, {live: [report('live')], sample: []});
  const imported = report('sample', 'older-import');
  imported.week_start = '2026-10-26';
  imported.agents[0].summary = 'İçe aktarılan eski örnek raporun notu.';
  const posts: unknown[] = [];
  await page.route('**/api/agent-house', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts.push(route.request().postDataJSON());
    return route.fulfill({status: 201, json: {run: imported, created: true}});
  });
  const house = await options(page);
  await house.getByLabel('Rapor dosyasını seç', {exact: true}).setInputFiles({name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ invalid json')});
  await expect(house.getByRole('alert')).toContainText('Dosya okunamadı.');
  expect(posts).toEqual([]);
  await house.getByLabel('Rapor dosyasını seç', {exact: true}).setInputFiles({name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported))});
  await expect(house.getByRole('status')).toContainText('Rapor hesabına kaydedildi.');
  await expect(house.getByRole('combobox', {name: 'Rapor', exact: true})).toHaveValue('older-import');
  const detail = await openRoom(page, 'Lider');
  await expect(detail).toContainText(imported.agents[0].summary);
  await expect(detail).toContainText('Örnek rapor');
  expect(posts).toEqual([imported]);
  expect(requests.writes()).toBe(0);
});

for (const preference of ['system', 'app'] as const) test(`azaltılmış hareket ve klavye desteklenir · ${preference}`, async ({page}) => {
  await page.emulateMedia({reducedMotion: preference === 'system' ? 'reduce' : 'no-preference'});
  if (preference === 'app') await page.addInitScript(() => localStorage.setItem('yksim-reduced', 'true'));
  await openHouse(page, 1440, {live: [report('live')], sample: []});
  const scene = page.getByTestId('agent-house-scene');
  await expect.poll(() => scene.evaluate(element => element.getAnimations({subtree: true}).length)).toBe(0);
  const room = roomRail(page).getByRole('button', {name: 'YKSİM Takipçisi odası', exact: true});
  await room.press('Enter');
  const detail = page.getByTestId('agent-room-report');
  await expect(detail.getByRole('heading', {name: 'İlerlemenin kaydı', exact: true})).toBeFocused();
  await expect.poll(() => detail.evaluate(element => element.getAnimations({subtree: true}).length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(room).toBeFocused();
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

test('ziyaretteki maskota dokunmak kendi notunu açar ve kapatınca ona döner', async ({page}) => {
  const {strategist, motion, writes} = await openMovingHouse(page);
  await page.clock.runFor(33_000);
  await expect(strategist).toHaveAttribute('data-target-room', 'tracking');
  await strategist.getByTestId('agent-mascot-strategy').click();
  const note = page.getByTestId('agent-room-report');
  await expect(note.getByRole('heading', {name: 'Çalışmanın yönü', exact: true})).toBeFocused();
  await expect(note).toContainText('Önce problem çözümündeki yanlışlarını incele.');
  await expect(motion).toHaveAttribute('data-motion', 'reduced');
  await page.keyboard.press('Escape');
  await page.clock.runFor(80);
  await expect(strategist).toBeFocused();
  await expect(motion).toHaveAttribute('data-motion', 'running');
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

  await scene.getByTestId('agent-room-floor-strategy').click({position: {x: 8, y: 30}});
  await page.clock.runFor(80);
  await expect(scene).toBeVisible();
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


