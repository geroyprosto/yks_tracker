import { expect, test, type BrowserContext } from '@playwright/test';
import { CLASSROOM_DEMO_ACCOUNTS, DEMO_STUDENT_IDS, DEMO_TEACHER_IDS } from '../../src/lib/classroom/demo-seed';

const origin = 'http://127.0.0.1:3200';

async function login(context: BrowserContext, id: string) {
  const response = await context.request.post('/api/demo', {
    headers: { Origin: origin },
    data: { account_id: id },
  });
  await expect(response).toBeOK();
}

test('anonymous classroom request redirects before protected HTML is rendered', async ({ page, context }) => {
  const response = await context.request.get('/classroom', { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(new URL(response.headers().location, origin).pathname).toBe('/');
  const redirectBody = await response.text();
  expect(redirectBody).not.toContain('Öğrencilerim');
  expect(redirectBody).not.toContain('Sınıfına bir bakış.');

  await page.goto('/classroom');
  await expect(page).toHaveURL(origin + '/');
  await expect(page.getByRole('heading', { name: 'Sınıfına bir bakış.' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Öğretmen alanları' })).toHaveCount(0);
});

test('approved teacher is redirected from the student page to classroom', async ({ page, context }) => {
  await login(context, DEMO_TEACHER_IDS[0]);
  const response = await context.request.get('/', { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(new URL(response.headers().location, origin).pathname).toBe('/classroom');

  const firstHtml = await (await context.request.get('/classroom')).text();
  expect(firstHtml).toContain('Sınıfın hazırlanıyor');
  expect(firstHtml).not.toContain('Sınıfına bir bakış.');

  await page.goto('/');
  await expect(page).toHaveURL(origin + '/classroom');
  await expect(page.getByRole('heading', { name: 'Sınıfına bir bakış.' })).toBeVisible();
});

test('pending account sees its classroom status screen', async ({ page, context }) => {
  const pending = CLASSROOM_DEMO_ACCOUNTS.find(account => account.key === 'pending-teacher');
  if (!pending) throw new Error('Pending demo teacher is missing');
  await login(context, pending.id);

  await page.goto('/classroom');
  await expect(page).toHaveURL(origin + '/classroom');
  await expect(page.getByRole('heading', { name: 'Onay bekliyor' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Öğretmen alanları' })).toHaveCount(0);
});

test('approved student stays on the student page', async ({ page, context }) => {
  await login(context, DEMO_STUDENT_IDS[0]);

  const firstHtml = await (await context.request.get('/')).text();
  expect(firstHtml).toContain('Çalışma alanı yükleniyor');
  expect(firstHtml).not.toContain('Ana gezinme');

  await page.goto('/');
  await expect(page).toHaveURL(origin + '/');
  await expect(page.getByRole('navigation', { name: 'Ana gezinme' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Merhaba,/ })).toBeVisible();
});
