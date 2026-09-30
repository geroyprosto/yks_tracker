import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CLASSROOM_DEMO_ACCOUNTS, DEMO_STUDENT_IDS } from '../../src/lib/classroom/demo-seed';

const origin = 'http://127.0.0.1:3200';
const headers = { Origin: origin };

type Score = { user_id: string; display_name: string; today_seconds: number; week_seconds: number };
type Group = { id: string; name: string; owner_id: string; member_count: number };
type Competition = {
  today: string; week_start: string; me: Score; friends: Score[];
  groups: Group[]; group: Group | null;
};

async function login(context: BrowserContext, id: string) {
  await expect(await context.request.post('/api/demo', { headers, data: { account_id: id } })).toBeOK();
}

async function competition(context: BrowserContext, groupId?: string): Promise<Competition> {
  const path = '/api/friends' + (groupId ? '?group_id=' + groupId : '');
  const response = await context.request.get(path);
  await expect(response).toBeOK();
  return response.json();
}

async function addStudy(context: BrowserContext, date: string, minutes: number) {
  const response = await context.request.post('/api/command', {
    headers,
    data: {
      request_id: randomUUID(), type: 'manual_study.create',
      payload: { confirmed_by_user: true, study_date: date, subject: 'Arkadaş yarışması testi', minutes },
    },
  });
  await expect(response).toBeOK();
}

async function finishDemoTimer(context: BrowserContext) {
  const response = await context.request.get('/api/state');
  await expect(response).toBeOK();
  const state = await response.json() as { sessions: { id: string; status: string; revision: number }[] };
  for (const session of state.sessions.filter(item => item.status !== 'finished')) {
    await expect(await context.request.post('/api/command', {
      headers,
      data: {
        request_id: randomUUID(), type: 'timer.finish',
        payload: { id: session.id, expected_revision: session.revision },
      },
    })).toBeOK();
  }
}

async function inviteLink(page: Page) {
  await page.getByRole('button', { name: 'Arkadaş davet et' }).first().click();
  const link = await page.getByRole('textbox', { name: 'Davet bağlantısı' }).inputValue();
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3200\/friend-invite\?token=[a-f0-9]{64}$/);
  return link;
}

async function acceptInvitation(context: BrowserContext, link: string, errors: string[], label: string) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(label + ': ' + error.message));
  await page.goto(link);
  await expect(page.getByRole('heading', { name: /seni davet etti/ })).toBeVisible();
  await page.getByRole('button', { name: 'Daveti kabul et' }).click();
  await expect(page.getByRole('heading', { name: 'Artık birlikte çalışıyorsunuz!' })).toBeVisible();
  await page.getByRole('link', { name: 'Arkadaşlar alanına git' }).click();
  await expect(page).toHaveURL(/\?page=friends&group=[a-f0-9-]{36}$/);
  return page;
}

async function friendPalette(page: Page) {
  const button = page.getByRole('button', { name: /Arkadaş davet et/ }).first();
  const colors = await button.evaluate(element => {
    const sample = document.createElement('span');
    sample.style.backgroundColor = 'var(--primary)';
    document.body.appendChild(sample);
    const primary = getComputedStyle(sample).backgroundColor;
    sample.remove();
    return { primary, invite: getComputedStyle(element).backgroundColor };
  });
  const duel = page.getByRole('region', { name: 'İkili karşılaşma' });
  const background = await duel.evaluate(element => getComputedStyle(element).backgroundColor);
  return { ...colors, background };
}

async function assertWideFriendsLayout(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await expect(page.locator('main#main')).toHaveAttribute('data-page', 'friends');
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.main-shell')!.getBoundingClientRect();
    const groupBar = document.querySelector('main#main [aria-label="Yarışma grubu"]')!;
    const workspace = groupBar.parentElement!.getBoundingClientRect();
    const duel = document.querySelector('main#main [aria-label="İkili karşılaşma"]')!;
    const rail = duel.nextElementSibling!;
    const lastRailCard = rail.lastElementChild!;
    return {
      shellWidth: shell.width, workspaceWidth: workspace.width,
      left: workspace.left - shell.left, right: shell.right - workspace.right,
      documentWidth: document.documentElement.scrollWidth,
      cardBottomGap: Math.abs(duel.getBoundingClientRect().bottom - lastRailCard.getBoundingClientRect().bottom),
    };
  });
  expect(layout.workspaceWidth).toBeGreaterThanOrEqual(layout.shellWidth * 0.8);
  expect(layout.left).toBeGreaterThan(16);
  expect(layout.right).toBeGreaterThan(16);
  expect(layout.left).toBeLessThanOrEqual(160);
  expect(layout.right).toBeLessThanOrEqual(160);
  expect(Math.abs(layout.left - layout.right)).toBeLessThanOrEqual(16);
  expect(layout.cardBottomGap).toBeLessThanOrEqual(2);
  expect(layout.documentWidth).toBeLessThanOrEqual(width + 1);
}

test('three students join one group, see the top two duel, and lose access when removed or leaving', async ({ browser }) => {
  test.setTimeout(150_000);
  const owner = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 } });
  const member = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 812 } });
  const third = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const names = DEMO_STUDENT_IDS.slice(1, 4).map(id => CLASSROOM_DEMO_ACCOUNTS.find(account => account.id === id)!.name);
  try {
    await login(owner, DEMO_STUDENT_IDS[1]);
    await login(member, DEMO_STUDENT_IDS[2]);
    await login(third, DEMO_STUDENT_IDS[3]);
    await finishDemoTimer(owner);
    await finishDemoTimer(member);
    const ownerPage = await owner.newPage();
    ownerPage.on('pageerror', error => errors.push('owner: ' + error.message));
    await ownerPage.goto('/?page=friends');

    const firstLink = await inviteLink(ownerPage);
    const firstState = await competition(owner);
    const groupId = firstState.group?.id;
    expect(groupId).toMatch(/^[a-f0-9-]{36}$/);
    expect(firstState.group?.owner_id).toBe(DEMO_STUDENT_IDS[1]);
    expect((await third.request.get('/api/friends?group_id=' + groupId)).status()).toBe(404);

    // Ensure the owner ranks third, regardless of the demo data's original totals.
    await addStudy(member, firstState.today, 600);
    await addStudy(third, firstState.today, 720);

    const memberPage = await acceptInvitation(member, firstLink, errors, 'member');
    const firstToken = new URL(firstLink).searchParams.get('token');
    expect((await member.request.get('/api/friends/invite?token=' + firstToken)).status()).toBe(404);
    const secondLink = await inviteLink(memberPage);
    await acceptInvitation(third, secondLink, errors, 'third');

    for (const [context, ownId] of [[owner, DEMO_STUDENT_IDS[1]], [member, DEMO_STUDENT_IDS[2]], [third, DEMO_STUDENT_IDS[3]]] as const) {
      const state = await competition(context, groupId);
      expect(state.group?.id).toBe(groupId);
      expect(state.group?.member_count).toBe(3);
      expect(state.groups.map(group => group.id)).toContain(groupId);
      expect(state.me.user_id).toBe(ownId);
      expect(state.friends.map(friend => friend.user_id).sort()).toEqual(DEMO_STUDENT_IDS.slice(1, 4).filter(id => id !== ownId).sort());
    }

    await ownerPage.reload();
    const scores = await competition(owner, groupId);
    await expect(ownerPage.getByText(scores.group?.name ?? '', { exact: true }).first()).toBeVisible();
    for (const name of names) await expect(ownerPage.getByText(name, { exact: true }).first()).toBeVisible();
    const ranking = [scores.me, ...scores.friends].sort((a, b) =>
      b.today_seconds - a.today_seconds || a.display_name.localeCompare(b.display_name, 'tr'));
    expect(ranking[2].user_id).toBe(DEMO_STUDENT_IDS[1]);
    const duel = ownerPage.getByRole('region', { name: 'İkili karşılaşma' });
    await expect(duel).toContainText(ranking[0].display_name);
    await expect(duel).toContainText(ranking[1].display_name);
    await expect(duel).not.toContainText(names[0]);
    await ownerPage.screenshot({ path: 'tmp/friends-desktop.png', fullPage: true, animations: 'disabled' });
    await ownerPage.evaluate(() => {
      localStorage.setItem('yksim-theme', 'white');
      localStorage.setItem('yksim-appearance', 'light');
    });
    await ownerPage.reload();
    await expect(ownerPage.locator('html')).toHaveAttribute('data-appearance', 'light');
    await expect(ownerPage.getByRole('region', { name: 'İkili karşılaşma' })).toContainText(ranking[0].display_name);
    await ownerPage.screenshot({ path: 'tmp/friends-light.png', fullPage: true, animations: 'disabled' });
    await ownerPage.evaluate(() => {
      localStorage.setItem('yksim-theme', 'black');
      localStorage.setItem('yksim-appearance', 'dark');
    });
    await ownerPage.reload();
    await expect(ownerPage.locator('html')).toHaveAttribute('data-appearance', 'dark');
    await expect(ownerPage.getByRole('region', { name: 'İkili karşılaşma' })).toContainText(ranking[0].display_name);
    await ownerPage.screenshot({ path: 'tmp/friends-dark.png', fullPage: true, animations: 'disabled' });

    const navigation = ownerPage.getByRole('navigation', { name: 'Ana gezinme' });
    await navigation.getByRole('button', { name: 'Ayarlar' }).click();
    await ownerPage.getByRole('button', { name: 'Okyanus', exact: true }).click();
    await expect(ownerPage.locator('html')).toHaveAttribute('data-theme', 'ocean');
    await navigation.getByRole('button', { name: 'Arkadaşlar' }).click();
    await expect(ownerPage.getByRole('region', { name: 'İkili karşılaşma' })).toContainText(ranking[0].display_name);
    const ocean = await friendPalette(ownerPage);
    expect(ocean.invite).toBe(ocean.primary);
    await assertWideFriendsLayout(ownerPage, 1920);
    await ownerPage.screenshot({ path: 'tmp/friends-wide-1920.png', fullPage: true, animations: 'disabled' });

    await navigation.getByRole('button', { name: 'Ayarlar' }).click();
    await ownerPage.getByRole('button', { name: 'Açık', exact: true }).click();
    await expect(ownerPage.locator('html')).toHaveAttribute('data-appearance', 'light');
    await navigation.getByRole('button', { name: 'Arkadaşlar' }).click();
    await expect(ownerPage.getByRole('region', { name: 'İkili karşılaşma' })).toContainText(ranking[0].display_name);
    const oceanLight = await friendPalette(ownerPage);
    expect(oceanLight.invite).toBe(oceanLight.primary);
    await ownerPage.screenshot({ path: 'tmp/friends-wide-1920-light.png', fullPage: true, animations: 'disabled' });

    await navigation.getByRole('button', { name: 'Ayarlar' }).click();
    await ownerPage.getByRole('button', { name: 'Mercan / Gül', exact: true }).click();
    await ownerPage.getByRole('button', { name: 'Koyu', exact: true }).click();
    await expect(ownerPage.locator('html')).toHaveAttribute('data-theme', 'rose');
    await navigation.getByRole('button', { name: 'Arkadaşlar' }).click();
    await expect(ownerPage.getByRole('region', { name: 'İkili karşılaşma' })).toContainText(ranking[0].display_name);
    const rose = await friendPalette(ownerPage);
    expect(rose.invite).toBe(rose.primary);
    expect(rose.invite).not.toBe(ocean.invite);
    expect(rose.background).not.toBe(ocean.background);
    await assertWideFriendsLayout(ownerPage, 2560);
    await ownerPage.screenshot({ path: 'tmp/friends-wide-2560.png', fullPage: true, animations: 'disabled' });

    // Exercise every current picker theme. The four flexible palettes support
    // both appearance modes; white and black fix their own background modes.
    for (const [theme, appearance] of [
      ['ocean', 'dark'], ['ocean', 'light'], ['rose', 'dark'], ['rose', 'light'],
      ['plum', 'dark'], ['plum', 'light'], ['pastel', 'dark'], ['pastel', 'light'],
      ['white', 'light'], ['black', 'dark'],
    ] as const) {
      await ownerPage.evaluate(({ theme, appearance }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.appearance = appearance;
      }, { theme, appearance });
      const palette = await friendPalette(ownerPage);
      expect(palette.invite, theme + '/' + appearance).toBe(palette.primary);
    }

    await memberPage.reload();
    const periodTabs = memberPage.getByRole('group', { name: 'Yarışma dönemi' });
    await periodTabs.getByRole('button', { name: 'Bu hafta' }).click();
    await expect(periodTabs.getByRole('button', { name: 'Bu hafta' })).toHaveAttribute('aria-pressed', 'true');
    await expect(memberPage.getByRole('region', { name: 'İkili karşılaşma' })).toBeVisible();
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await memberPage.screenshot({ path: 'tmp/friends-mobile.png', fullPage: true, animations: 'disabled' });
    await memberPage.setViewportSize({ width: 320, height: 720 });
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await memberPage.screenshot({ path: 'tmp/friends-mobile-320.png', fullPage: true, animations: 'disabled' });
    await memberPage.setViewportSize({ width: 375, height: 812 });
    await periodTabs.getByRole('button', { name: 'Bugün' }).click();
    await expect(periodTabs.getByRole('button', { name: 'Bugün' })).toHaveAttribute('aria-pressed', 'true');

    const deniedRemoval = await member.request.delete('/api/friends', {
      headers, data: { friend_id: DEMO_STUDENT_IDS[3], group_id: groupId },
    });
    expect(deniedRemoval.status()).toBe(403);
    await ownerPage.getByRole('button', { name: names[2] + ' adlı üyeyi çıkar' }).click();
    const removeDialog = ownerPage.getByRole('dialog');
    await expect(removeDialog).toBeVisible();
    await removeDialog.getByRole('button', { name: /çıkar/i }).last().click();
    await expect.poll(async () => (await competition(owner, groupId)).group?.member_count).toBe(2);
    expect((await third.request.get('/api/friends?group_id=' + groupId)).status()).toBe(404);

    await memberPage.getByRole('button', { name: 'Gruptan ayrıl' }).click();
    const leaveDialog = memberPage.getByRole('dialog');
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole('button', { name: /ayrıl/i }).last().click();
    await expect.poll(async () => (await competition(owner, groupId)).group?.member_count).toBe(1);
    expect((await member.request.get('/api/friends?group_id=' + groupId)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([owner.close(), member.close(), third.close()]);
  }
});
