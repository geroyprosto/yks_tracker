import { expect, test } from '@playwright/test';

const authorizationId = 'ABCDEFGHIJKLMNOPQRST';

test('OAuth consent shows the requesting client, scopes, and owner before any decision', async ({ page }) => {
  await page.route('**/api/oauth/consent?**', route => route.fulfill({ json: {
    ok: true, authorizationId, csrf: 'mock-csrf', ownerEmail: 'owner@example.com',
    client: { name: 'ChatGPT', uri: 'https://chatgpt.com' },
    redirectUri: 'https://chatgpt.com/connector/callback', scopes: ['openid', 'email'],
  } }));
  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
  await expect(page.getByRole('heading', { name: 'ChatGPT bağlanmak istiyor' })).toBeVisible();
  await expect(page.getByText('owner@example.com')).toBeVisible();
  await expect(page.getByText('Kimlik doğrulaması')).toBeVisible();
  await expect(page.getByRole('button', { name: 'İzin ver' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reddet' })).toBeVisible();
  await expect(page.locator('form[action="/api/oauth/decision"] input[name="authorization_id"]')).toHaveValue(authorizationId);
});

test('OAuth consent gives no approval controls while MCP is disabled', async ({ page }) => {
  await page.route('**/api/oauth/consent?**', route => route.fulfill({ status: 503, json: {
    ok: false, error: { code: 'MCP_DISABLED', message: 'ChatGPT bağlantısı henüz kurulmadı.' },
  } }));
  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
  await expect(page.getByRole('heading', { name: 'Bağlantı açılamadı' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'İzin ver' })).toHaveCount(0);
});

for (const [decision, button] of [['approve', 'İzin ver'], ['deny', 'Reddet']] as const) {
  test(`OAuth ${decision} native form preserves the same-origin POST and consent fields`, async ({ page }) => {
    await page.route('**/api/oauth/consent?**', route => route.fulfill({ json: {
      ok: true, authorizationId, csrf: 'mock-csrf', ownerEmail: 'owner@example.com',
      client: { name: 'ChatGPT', uri: 'https://chatgpt.com' },
      redirectUri: 'https://chatgpt.com/connector/callback', scopes: ['openid', 'email'],
    } }));
    // Inspect a real browser form navigation; a fetch or synthetic Request does
    // not reproduce Chromium's Origin:null behavior with no-referrer metadata.
    await page.route('**/api/oauth/decision', route => route.fulfill({
      status: 200, contentType: 'text/html', body: '<p>Decision received</p>',
    }));
    await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
    const [request] = await Promise.all([
      page.waitForRequest(request => new URL(request.url()).pathname === '/api/oauth/decision'),
      page.getByRole('button', { name: button }).click(),
    ]);
    expect(request.method()).toBe('POST');
    expect(await request.headerValue('origin')).toBe(new URL(request.url()).origin);
    const form = new URLSearchParams(request.postData() ?? '');
    expect(form.get('authorization_id')).toBe(authorizationId);
    expect(form.get('csrf')).toBe('mock-csrf');
    expect(form.get('decision')).toBe(decision);
  });
}
