import {expect, test, type Page} from '@playwright/test';

test.use({serviceWorkers: 'allow'});

async function openControlledDashboard(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('navigation', {name: 'Ana gezinme'})).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
}

test('a transient first navigation failure recovers before showing the offline page', async ({page, context}) => {
  await openControlledDashboard(page);
  let attempts = 0;
  await context.route(url => url.searchParams.get('connection-test') === 'first-open', route => {
    if (!route.request().serviceWorker()) return route.continue();
    attempts++;
    return attempts === 1 ? route.abort('connectionreset') : route.continue();
  });

  const response = await page.goto('/?connection-test=first-open');

  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('navigation', {name: 'Ana gezinme'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Şu an çevrimdışısın.'})).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('an offline navigation returns to its original URL automatically when the connection returns', async ({page, context}, testInfo) => {
  await openControlledDashboard(page);
  const target = '/?connection-test=offline#retained';
  await context.setOffline(true);
  const response = await page.goto(target);

  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('heading', {name: 'Şu an çevrimdışısın.'})).toBeVisible();
  await expect(page.locator('#retry')).toHaveAttribute('href', /\?connection-test=offline#retained$/);
  await page.screenshot({path: testInfo.outputPath('offline.png'), fullPage: true});

  await context.setOffline(false);

  await expect(page.getByRole('navigation', {name: 'Ana gezinme'})).toBeVisible({timeout: 15_000});
  await expect(page).toHaveURL(/\/\?connection-test=offline#retained$/);
  await page.screenshot({path: testInfo.outputPath('recovered.png'), fullPage: true});
});

test('a reachable-network failure shows a truthful message and recovers without manual refresh', async ({page, context}) => {
  await openControlledDashboard(page);
  let unavailable = true;
  let failedRequests = 0;
  let documentLoads = 0;
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++;
  });
  await context.route(url => url.searchParams.get('connection-test') === 'unavailable', route => {
    if (unavailable) {
      failedRequests++;
      return route.abort('connectionreset');
    }
    return route.continue();
  });

  await page.goto('/?connection-test=unavailable#retained');
  await expect(page.getByRole('heading', {name: 'Siteye şu an ulaşılamıyor.'})).toBeVisible();
  await expect.poll(() => failedRequests).toBeGreaterThan(3);
  expect(documentLoads).toBe(1);

  unavailable = false;

  await expect(page.getByRole('navigation', {name: 'Ana gezinme'})).toBeVisible({timeout: 15_000});
  await expect(page).toHaveURL(/\/\?connection-test=unavailable#retained$/);
  expect(documentLoads).toBe(2);
});

test('manual retry reloads the attempted page even when its URL contains a fragment', async ({page, context}) => {
  await openControlledDashboard(page);
  let unavailable = true;
  await context.route(url => url.searchParams.get('connection-test') === 'manual', route =>
    unavailable ? route.abort('connectionreset') : route.continue());
  await page.clock.install();
  await page.clock.pauseAt(new Date());

  await page.goto('/?connection-test=manual#retained');
  await expect(page.getByRole('heading', {name: 'Siteye şu an ulaşılamıyor.'})).toBeVisible();
  unavailable = false;
  await page.getByRole('link', {name: 'Yeniden dene'}).click();

  await expect(page.getByRole('navigation', {name: 'Ana gezinme'})).toBeVisible();
  await expect(page).toHaveURL(/\/\?connection-test=manual#retained$/);
});
