import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DEMO_ADMIN_ID, DEMO_STUDENT_IDS, DEMO_TEACHER_IDS } from '../../src/lib/classroom/demo-seed';
import type { ClassroomAccount, ClassroomState } from '../../src/lib/classroom/types';
import type { AppState } from '../../src/lib/domain/types';

const origin = 'http://127.0.0.1:3200';
const headers = { Origin: origin };
const deleteLabel = 'Kişiyi ve tüm verilerini kalıcı sil';

async function login(context: BrowserContext, id: string) {
  await expect(await context.request.post('/api/demo', { headers, data: { account_id: id } })).toBeOK();
}

async function classroom(context: BrowserContext): Promise<ClassroomState> {
  const response = await context.request.get('/api/classroom');
  await expect(response).toBeOK();
  return response.json();
}

async function command(context: BrowserContext, type: string, payload: Record<string, unknown>, commandOrigin = origin) {
  return context.request.post('/api/classroom', { headers: { Origin: commandOrigin }, data: { request_id: randomUUID(), type, payload } });
}

async function register(context: BrowserContext, role: 'student' | 'teacher', inviteToken?: string): Promise<ClassroomAccount> {
  const suffix = randomUUID().slice(0, 8);
  const registration = await context.request.post('/api/register', {
    headers,
    data: { first_name: 'Silme', last_name: suffix, email: `delete-${suffix}@classroom-demo.invalid`, role, demo: true, ...(inviteToken ? { invite_token: inviteToken } : {}) },
  });
  await expect(registration).toBeOK();
  const account = (await classroom(context)).account;
  expect(account?.status).toBe('pending');
  return account!;
}

async function approve(reviewer: BrowserContext, context: BrowserContext) {
  const pending = (await classroom(context)).applications.find(application => application.status === 'pending');
  expect(pending).toBeDefined();
  await expect(await command(reviewer, 'application.review', { id: pending!.id, decision: 'approved' })).toBeOK();
  expect((await classroom(context)).account?.status).toBe('approved');
}

async function inviteStudent(teacher: BrowserContext, student: BrowserContext) {
  const response = await command(teacher, 'invite.create', { expires_in_days: 1 });
  await expect(response).toBeOK();
  const invite = (await response.json()).result as { id: string; token: string };
  const account = await register(student, 'student', invite.token);
  await approve(teacher, student);
  await expect(await command(teacher, 'invite.revoke', { id: invite.id })).toBeOK();
  return account;
}

async function studyState(context: BrowserContext): Promise<AppState> {
  const response = await context.request.get('/api/state');
  await expect(response).toBeOK();
  return response.json();
}

async function addStudyRecords(context: BrowserContext, marker: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const post = async (type: string, payload: Record<string, unknown>) => {
    const response = await context.request.post('/api/command', { headers, data: { request_id: randomUUID(), type, payload } });
    await expect(response).toBeOK();
    return response.json();
  };
  await post('manual_study.create', { subject: marker, study_date: today, minutes: 15, confirmed_by_user: true });
  await post('timer.start', { title: marker, subject: marker });
  const active = (await studyState(context)).sessions.find(session => session.status !== 'finished');
  expect(active).toBeDefined();
  await post('timer.finish', { id: active!.id, expected_revision: active!.revision, confirmed_seconds: 0 });
  await post('exam.create', { name: marker, format_code: 'BRANCH', branch_subject: 'Matematik', branch_question_count: 20, exam_date: today, results: [{ section_key: 'branch', correct: 15, wrong: 4, blank: 1 }] });
  const state = await studyState(context);
  expect(state.sessions.some(session => session.title === marker && session.status === 'finished')).toBe(true);
  expect((state.manual_study_entries ?? []).some(entry => entry.subject === marker)).toBe(true);
  expect(state.exams.some(exam => exam.name === marker)).toBe(true);
  return state;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test('admin confirmation is keyboard safe, exact, responsive and keeps failed deletion reviewable before removing all account access', async ({ browser }) => {
  const admin = await browser.newContext({ baseURL: origin });
  const teacher = await browser.newContext({ baseURL: origin });
  const student = await browser.newContext({ baseURL: origin });
  try {
    await login(admin, DEMO_ADMIN_ID);
    await login(teacher, DEMO_TEACHER_IDS[0]);
    const account = await inviteStudent(teacher, student);
    const marker = `Silinecek çalışma ${randomUUID().slice(0, 8)}`;
    await addStudyRecords(student, marker);
    const sent = await command(teacher, 'message.send', { student_id: account.id, category: 'praise', body: marker });
    await expect(sent).toBeOK();
    const messageId = (await sent.json()).result.id;
    await expect(await command(student, 'message.reply', { id: messageId, body: `${marker} cevabı` })).toBeOK();
    const otherStudent = (await classroom(teacher)).students.find(item => item.id === DEMO_STUDENT_IDS[0])!;
    expect(otherStudent).toBeDefined();

    const page = await admin.newPage();
    await page.goto('/classroom');
    const trigger = page.getByRole('button', { name: `${account.name} kişisini sil`, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Kişiyi ve tüm verilerini sil', exact: true });
    const cancel = dialog.getByRole('button', { name: 'Vazgeç', exact: true });
    const submit = dialog.getByRole('button', { name: deleteLabel, exact: true });
    const input = dialog.getByRole('textbox');
    await expect(cancel).toBeFocused();
    await expect(submit).toBeDisabled();
    await page.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await classroom(student)).account?.id).toBe(account.id);

    await trigger.click();
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    let deletionRequests = 0;
    await page.route('**/api/classroom', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON().type === 'account.delete') {
        deletionRequests += 1;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Silme servisi geçici olarak kullanılamıyor.' } }) });
      } else await route.continue();
    });
    await input.fill(`${account.email} `);
    await expect(submit).toBeDisabled();
    await input.press('Enter');
    expect(deletionRequests).toBe(0);
    await input.fill(account.email.toUpperCase());
    await expect(submit).toBeDisabled();
    await input.fill(account.email);
    await expect(submit).toBeEnabled();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 812 });
      await expect(dialog).toBeVisible();
      await noOverflow(page);
    }
    await submit.click();
    await expect(dialog.getByRole('alert')).toHaveText('Silme servisi geçici olarak kullanılamıyor.');
    await expect(input).toHaveValue(account.email);
    await expect(submit).toBeEnabled();
    expect(deletionRequests).toBe(1);
    expect((await classroom(student)).account?.id).toBe(account.id);
    await page.unroute('**/api/classroom');
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('kalıcı olarak silindi');
    await expect(page.getByRole('heading', { name: 'Kullanıcılar', exact: true })).toBeFocused();
    await expect(trigger).toHaveCount(0);
    const adminState = await classroom(admin);
    expect(adminState.accounts.some(item => item.id === account.id)).toBe(false);
    expect(adminState.applications.some(item => item.user_id === account.id)).toBe(false);
    const teacherState = await classroom(teacher);
    expect(teacherState.students.some(item => item.id === account.id)).toBe(false);
    expect(teacherState.messages.some(item => item.student_id === account.id)).toBe(false);
    expect(teacherState.students.find(item => item.id === otherStudent.id)?.state.sessions.filter(session => session.status === 'finished')).toEqual(otherStudent.state.sessions.filter(session => session.status === 'finished'));
    expect((await student.request.get('/api/classroom')).status()).toBe(401);
    expect((await student.request.get('/api/state')).status()).toBe(401);
    expect((await student.request.post('/api/demo', { headers, data: { account_id: account.id } })).ok()).toBe(false);
    const deletedStudentPage = await student.newPage();
    await deletedStudentPage.goto('/');
    await expect(deletedStudentPage.getByRole('heading', { name: 'Yolculuğuna devam et.', exact: true })).toBeVisible();
    await deletedStudentPage.goto('/classroom');
    await expect(deletedStudentPage).toHaveURL(`${origin}/`);
    await expect(deletedStudentPage.getByRole('heading', { name: 'Yolculuğuna devam et.', exact: true })).toBeVisible();
  } finally { await admin.close(); await teacher.close(); await student.close(); }
});

test('only an admin with the exact account confirmation and same origin may delete; admin and self remain protected', async ({ browser }) => {
  const admin = await browser.newContext({ baseURL: origin });
  const teacher = await browser.newContext({ baseURL: origin });
  const student = await browser.newContext({ baseURL: origin });
  const pending = await browser.newContext({ baseURL: origin });
  try {
    await login(admin, DEMO_ADMIN_ID);
    await login(teacher, DEMO_TEACHER_IDS[0]);
    await login(student, DEMO_STUDENT_IDS[0]);
    const account = await register(pending, 'student');
    const adminAccount = (await classroom(admin)).account!;
    const before = (await classroom(admin)).accounts.map(item => ({ id: item.id, status: item.status })).sort((a, b) => a.id.localeCompare(b.id));
    const payload = { id: account.id, confirmation_email: account.email };
    expect((await command(teacher, 'account.delete', payload)).status()).toBe(403);
    expect((await command(student, 'account.delete', payload)).status()).toBe(403);
    expect((await command(pending, 'account.delete', payload)).status()).toBe(403);
    expect((await command(admin, 'account.delete', { ...payload, confirmation_email: 'wrong@classroom-demo.invalid' })).status()).toBe(400);
    expect((await command(admin, 'account.delete', { id: adminAccount.id, confirmation_email: adminAccount.email })).status()).toBe(403);
    expect((await command(admin, 'account.delete', payload, 'https://attacker.invalid')).status()).toBe(403);
    expect((await command(admin, 'account.delete', { id: 'not-a-uuid', confirmation_email: account.email })).status()).toBe(400);
    expect((await command(admin, 'account.delete', { id: account.id })).status()).toBe(400);
    expect((await classroom(admin)).accounts.map(item => ({ id: item.id, status: item.status })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(before);
    expect((await classroom(pending)).account?.id).toBe(account.id);
    const page = await admin.newPage();
    await page.goto('/classroom');
    const adminRow = page.getByRole('heading', { name: adminAccount.name, exact: true }).locator('..').locator('..');
    await expect(adminRow.getByRole('button', { name: /kişisini sil/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `${account.name} kişisini sil`, exact: true })).toBeVisible();
    await expect(await command(admin, 'account.delete', payload)).toBeOK();
    expect((await classroom(admin)).accounts.some(item => item.id === account.id)).toBe(false);
  } finally { await admin.close(); await teacher.close(); await student.close(); await pending.close(); }
});

test('deleting a disposable teacher removes its messages while preserving and detaching student accounts and study records', async ({ browser }) => {
  const admin = await browser.newContext({ baseURL: origin });
  const teacher = await browser.newContext({ baseURL: origin });
  const student = await browser.newContext({ baseURL: origin });
  try {
    await login(admin, DEMO_ADMIN_ID);
    const account = await register(teacher, 'teacher');
    await approve(admin, teacher);
    const studentAccount = await inviteStudent(teacher, student);
    const marker = `Korunacak çalışma ${randomUUID().slice(0, 8)}`;
    const before = await addStudyRecords(student, marker);
    await expect(await command(teacher, 'message.send', { student_id: studentAccount.id, category: 'praise', body: marker })).toBeOK();
    const page = await admin.newPage();
    await page.goto('/classroom');
    await page.getByRole('button', { name: `${account.name} kişisini sil`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Kişiyi ve tüm verilerini sil', exact: true });
    await expect(dialog.getByText('Öğretmenin öğrencileri sınıftan ayrılır; öğrencilerin kendi hesapları ve çalışma kayıtları korunur.')).toBeVisible();
    await dialog.getByRole('textbox').fill(account.email);
    await dialog.getByRole('button', { name: deleteLabel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const after = await classroom(student);
    expect(after.account?.id).toBe(studentAccount.id);
    expect(after.account?.teacher_id).toBeNull();
    expect(after.messages).toHaveLength(0);
    const study = await studyState(student);
    expect(study.sessions).toEqual(before.sessions);
    expect(study.manual_study_entries).toEqual(before.manual_study_entries);
    expect(study.exams).toEqual(before.exams);
    expect((await teacher.request.get('/api/classroom')).status()).toBe(401);
    expect((await classroom(admin)).accounts.some(item => item.id === account.id)).toBe(false);
    await expect(await command(admin, 'account.delete', { id: studentAccount.id, confirmation_email: studentAccount.email })).toBeOK();
  } finally { await admin.close(); await teacher.close(); await student.close(); }
});
