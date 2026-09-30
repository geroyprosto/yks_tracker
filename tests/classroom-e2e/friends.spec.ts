import { expect, test, type BrowserContext } from '@playwright/test';
import { DEMO_STUDENT_IDS } from '../../src/lib/classroom/demo-seed';

const origin = 'http://127.0.0.1:3200';

async function login(context: BrowserContext, id: string) {
  const response = await context.request.post('/api/demo', {
    headers: { Origin: origin }, data: { account_id: id },
  });
  await expect(response).toBeOK();
}

test('students share a one-time link, compare daily and weekly summaries, then remove friendship', async ({ browser }) => {
  const inviter = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 } });
  const invited = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 812 } });
  try {
    // These seeded students have no teacher alert dialog that covers the workspace.
    await login(inviter, DEMO_STUDENT_IDS[1]);
    await login(invited, DEMO_STUDENT_IDS[2]);
    const inviterPage = await inviter.newPage();
    await inviterPage.goto('/?page=friends');
    await expect(inviterPage.getByRole('heading', { name: 'Küçük bir çalışma yarışı' })).toBeVisible();
    await expect(inviterPage.getByText('Henüz arkadaşın yok.')).toBeVisible();
    await inviterPage.getByRole('button', { name: 'Arkadaş davet et' }).click();
    const link = await inviterPage.getByRole('textbox', { name: 'Davet bağlantısı' }).inputValue();
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3200\/friend-invite\?token=[a-f0-9]{64}$/);

    const invitedPage = await invited.newPage();
    await invitedPage.goto(link);
    await expect(invitedPage.getByRole('heading', { name: /seni davet etti/ })).toBeVisible();
    await invitedPage.getByRole('button', { name: 'Daveti kabul et' }).click();
    await expect(invitedPage.getByRole('heading', { name: 'Artık birlikte çalışıyorsunuz!' })).toBeVisible();
    await invitedPage.getByRole('link', { name: 'Arkadaşlar alanına git' }).click();
    await expect(invitedPage).toHaveURL(`${origin}/?page=friends`);
    await expect(invitedPage.getByText('1 arkadaş', { exact: true })).toBeVisible();
    await invitedPage.getByRole('button', { name: 'Bu hafta' }).click();
    await expect(invitedPage.getByRole('heading', { name: 'Bu haftanın sıralaması' })).toBeVisible();
    expect(await invitedPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await inviterPage.getByRole('button', { name: 'Skorları yenile' }).click();
    await expect(inviterPage.getByText('1 arkadaş', { exact: true })).toBeVisible();
    await invitedPage.getByRole('button', { name: /adlı arkadaşı kaldır/ }).click();
    await expect(invitedPage.getByRole('dialog', { name: 'Arkadaşı kaldır' })).toBeVisible();
    await invitedPage.getByRole('dialog').getByRole('button', { name: 'Arkadaşı kaldır' }).click();
    await expect(invitedPage.getByText('0 arkadaş', { exact: true })).toBeVisible();
    await inviterPage.getByRole('button', { name: 'Skorları yenile' }).click();
    await expect(inviterPage.getByText('0 arkadaş', { exact: true })).toBeVisible();
    const token = new URL(link).searchParams.get('token');
    expect((await invited.request.get(`/api/friends/invite?token=${token}`)).status()).toBe(404);
    await invitedPage.goto(link);
    await expect(invitedPage.getByText('Davet bağlantısı geçersiz veya süresi dolmuş.')).toBeVisible();
  } finally {
    await inviter.close();
    await invited.close();
  }
});
