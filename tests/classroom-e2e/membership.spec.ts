import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { DEMO_STUDENT_IDS, DEMO_TEACHER_IDS } from '../../src/lib/classroom/demo-seed';
import type { ClassroomState } from '../../src/lib/classroom/types';

const origin = 'http://127.0.0.1:3200';
const headers = { Origin: origin };

async function login(context: BrowserContext, id: string) {
  const response = await context.request.post('/api/demo', { headers, data: { account_id: id } });
  await expect(response).toBeOK();
}

async function state(context: BrowserContext): Promise<ClassroomState> {
  const response = await context.request.get('/api/classroom');
  await expect(response).toBeOK();
  return response.json();
}

async function command(context: BrowserContext, type: string, payload: Record<string, unknown>) {
  return context.request.post('/api/classroom', { headers, data: { request_id: randomUUID(), type, payload } });
}

async function createApprovedStudent(teacher: BrowserContext, student: BrowserContext) {
  const inviteResponse = await command(teacher, 'invite.create', { expires_in_days: 1 });
  await expect(inviteResponse).toBeOK();
  const invite = (await inviteResponse.json()).result as { id: string; token: string };
  const suffix = randomUUID().slice(0, 8);
  const name = `Üyelik ${suffix}`;
  const registration = await student.request.post('/api/register', {
    headers,
    data: { first_name: 'Üyelik', last_name: suffix, email: `membership-${suffix}@classroom-demo.invalid`, role: 'student', invite_token: invite.token, demo: true },
  });
  await expect(registration).toBeOK();
  const application = (await state(student)).applications.find(item => item.status === 'pending');
  expect(application).toBeDefined();
  await expect(await command(teacher, 'application.review', { id: application!.id, decision: 'approved' })).toBeOK();
  await expect(await command(teacher, 'invite.revoke', { id: invite.id })).toBeOK();
  const account = (await state(student)).account;
  expect(account?.teacher_id).toBe(DEMO_TEACHER_IDS[0]);
  return { id: account!.id, name };
}

test('teacher can remove only their own student without deleting the student account', async ({ browser }) => {
  const teacher = await browser.newContext({ baseURL: origin });
  const otherTeacher = await browser.newContext({ baseURL: origin });
  const student = await browser.newContext({ baseURL: origin });
  try {
    await login(teacher, DEMO_TEACHER_IDS[0]);
    await login(otherTeacher, DEMO_TEACHER_IDS[1]);
    const member = await createApprovedStudent(teacher, student);
    expect((await command(otherTeacher, 'student.remove', { id: member.id })).status()).toBe(403);
    expect((await command(student, 'student.remove', { id: DEMO_STUDENT_IDS[0] })).status()).toBe(403);

    const page = await teacher.newPage();
    await page.goto('/classroom');
    await page.getByRole('textbox', { name: 'Öğrenci adına göre ara' }).fill(member.name);
    await page.getByRole('button', { name: new RegExp(member.name) }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Sınıftan çıkar', exact: true }).click();
    await expect(page.getByText('Öğrencinin hesabı ve çalışma kayıtları korunur.')).toBeVisible();
    await page.getByRole('button', { name: 'Vazgeç' }).click();
    expect((await state(student)).account?.teacher_id).toBe(DEMO_TEACHER_IDS[0]);
    await page.getByRole('button', { name: 'Sınıftan çıkar', exact: true }).click();
    await page.getByRole('button', { name: 'Evet, sınıftan çıkar' }).click();
    await expect(page.getByRole('status')).toContainText(`${member.name} sınıfından çıkarıldı`);
    await expect(page.getByText('0 öğrenci', { exact: true })).toBeVisible();
    expect((await state(teacher)).students.some(item => item.id === member.id)).toBe(false);
    expect((await state(student)).account?.teacher_id).toBeNull();
    expect((await student.request.get('/api/state')).ok()).toBe(true);
  } finally {
    await teacher.close(); await otherTeacher.close(); await student.close();
  }
});

test('student can leave a teacher class and keep their study account', async ({ browser }) => {
  const teacher = await browser.newContext({ baseURL: origin });
  const student = await browser.newContext({ baseURL: origin });
  try {
    await login(teacher, DEMO_TEACHER_IDS[0]);
    const member = await createApprovedStudent(teacher, student);
    const page = await student.newPage();
    await page.goto('/');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'Sınıftan ayrıl', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByText('Kişisel çalışma kayıtların ve hesabın kalır.')).toBeVisible();
    await page.getByRole('button', { name: 'Vazgeç' }).click();
    expect((await state(student)).account?.teacher_id).toBe(DEMO_TEACHER_IDS[0]);
    await page.getByRole('button', { name: 'Sınıftan ayrıl', exact: true }).click();
    await page.getByRole('button', { name: 'Evet, sınıftan ayrıl' }).click();
    await expect(page.getByRole('status')).toContainText('Sınıftan ayrıldın');
    expect((await state(student)).account?.teacher_id).toBeNull();
    expect((await state(teacher)).students.some(item => item.id === member.id)).toBe(false);
    expect((await student.request.get('/api/state')).ok()).toBe(true);
  } finally {
    await teacher.close(); await student.close();
  }
});

test('student can leave through a locked full-screen study alert', async ({ browser }) => {
  const teacher = await browser.newContext({ baseURL: origin });
  const student = await browser.newContext({ baseURL: origin });
  try {
    await login(teacher, DEMO_TEACHER_IDS[0]);
    const member = await createApprovedStudent(teacher, student);
    const sent = await command(teacher, 'alert.send', { student_id: member.id, body: 'Çalışma hatırlatması' });
    await expect(sent).toBeOK();
    const alertId = (await sent.json()).result.id as string;
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(await command(student, 'alert.respond', { id: alertId, response: 'refuse' })).toBeOK();
    }

    const page = await student.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Ekran kilidi')).toBeVisible();
    await dialog.getByRole('button', { name: 'Sınıftan ayrıl', exact: true }).click();
    await expect(dialog.getByText('Kişisel çalışma kayıtların ve hesabın kalır.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Evet, sınıftan ayrıl' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Sınıftan ayrıldın');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect((await state(student)).account?.teacher_id).toBeNull();
    expect((await state(teacher)).students.some(item => item.id === member.id)).toBe(false);
  } finally {
    await teacher.close(); await student.close();
  }
});
