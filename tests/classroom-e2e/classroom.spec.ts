import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { CLASSROOM_DEMO_ACCOUNTS, DEMO_ADMIN_ID, DEMO_STUDENT_IDS, DEMO_TEACHER_IDS } from '../../src/lib/classroom/demo-seed';
import type { ClassroomState } from '../../src/lib/classroom/types';
import type { AppState } from '../../src/lib/domain/types';

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
async function command(context: BrowserContext, type: string, payload: Record<string, unknown>, request_id = randomUUID()) {
  return context.request.post('/api/classroom', { headers, data: { request_id, type, payload } });
}
async function openStudent(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'Öğrenci adına göre ara' }).fill(name);
  const toggle = page.getByRole('button', { name: new RegExp(name) });
  await expect(toggle).toHaveCount(1);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.getByText('Öğrenci istatistikleri salt okunur.')).toBeVisible();
}
async function assertNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('teachers see exactly their own 10/25 students and direct unauthorized requests fail', async ({ browser }) => {
  const teacher = await browser.newContext({ baseURL: origin });
  const pending = await browser.newContext({ baseURL: origin });
  try {
    for (let index = 0; index < 2; index++) {
      await login(teacher, DEMO_TEACHER_IDS[index]);
      const result = await state(teacher);
      expect(result.students).toHaveLength(index ? 25 : 10);
      expect(result.students.every(student => student.teacher_id === DEMO_TEACHER_IDS[index])).toBe(true);
      const forged = await teacher.request.get(`/api/classroom?student_id=${DEMO_STUDENT_IDS[index ? 0 : 10]}`);
      expect((await forged.json()).students.map((student: { id: string }) => student.id)).not.toContain(DEMO_STUDENT_IDS[index ? 0 : 10]);
      const deniedMessage = await command(teacher, 'message.send', { student_id: DEMO_STUDENT_IDS[index ? 0 : 10], category: 'warning', body: 'Yetkisiz test' });
      expect(deniedMessage.status()).toBe(403);
      const deniedStudy = await teacher.request.post('/api/command', { headers, data: { request_id: randomUUID(), type: 'timer.start', payload: { title: 'İzinsiz çalışma' } } });
      expect(deniedStudy.status()).toBe(403);
    }
    await login(pending, CLASSROOM_DEMO_ACCOUNTS.find(account => account.key === 'pending-teacher')!.id);
    expect((await pending.request.get('/api/state')).status()).toBe(403);
    expect((await state(pending)).students).toHaveLength(0);
    const deniedInvite = await command(pending, 'invite.create', {});
    expect(deniedInvite.status()).toBe(403);
  } finally { await teacher.close(); await pending.close(); }
});

test('25 student accordion, search, sorting and persistent themes fit phone, tablet and desktop', async ({ page, context }) => {
  await login(context, DEMO_TEACHER_IDS[1]);
  await page.goto('/classroom');
  await expect(page.getByText('25 öğrenci', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Öğrencileri sırala' }).selectOption('week');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await openStudent(page, 'Ada Karaca');
    await expect(page.getByRole('heading', { name: 'Son TYT denemesi' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Konu tamamlama' })).toBeVisible();
    await assertNoOverflow(page);
    await page.getByRole('button', { name: /Ada Karaca/ }).click();
    await expect(page.getByRole('heading', { name: 'Son TYT denemesi' })).toHaveCount(0);
  }
  await page.getByRole('combobox', { name: 'Vurgu rengi' }).selectOption('plum');
  await page.getByRole('button', { name: 'Koyu görünüme geç' }).click();
  await page.reload();
  await expect(page.locator('[data-appearance="dark"][data-accent="plum"]')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Vurgu rengi' })).toHaveValue('plum');
  await page.getByRole('button', { name: 'Açık görünüme geç' }).click();
});

test('teacher can expand each student’s TYT and AYT net progress with readable point details', async ({ page, context }) => {
  await login(context, DEMO_TEACHER_IDS[1]);
  await page.goto('/classroom');
  await openStudent(page, 'Ada Karaca');
  const student = page.getByRole('button', { name: /Ada Karaca/ }).locator('..');
  await expect(student.getByRole('heading', { name: 'Net gelişimi' })).toBeVisible();
  const show = student.getByRole('button', { name: 'Grafiği göster' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(student.locator('[data-chart-point]')).toHaveCount(0);

  await show.click();
  const hide = student.getByRole('button', { name: 'Grafiği gizle' });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  const tyt = student.getByRole('button', { name: 'TYT', exact: true });
  const ayt = student.getByRole('button', { name: 'AYT', exact: true });
  await expect(tyt).toHaveAttribute('aria-pressed', 'true');
  const points = student.locator('[data-chart-point]');
  await expect(points).toHaveCount(3);
  const tytValues = await points.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  await points.first().hover();
  await expect(page.getByRole('tooltip')).toContainText('TYT Genel Deneme 1');
  await expect(page.getByRole('tooltip')).toContainText(/\d{1,2} .+ 20\d\d/);
  await expect(page.getByRole('tooltip')).toContainText(/\d+(?:,\d+)? net/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  await ayt.click();
  await expect(ayt).toHaveAttribute('aria-pressed', 'true');
  await expect(tyt).toHaveAttribute('aria-pressed', 'false');
  await expect(points).toHaveCount(3);
  const aytValues = await points.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  expect(aytValues).not.toEqual(tytValues);
  await points.last().focus();
  await expect(page.getByRole('tooltip')).toContainText('AYT Sayısal Genel Deneme 3');
  await expect(page.getByRole('tooltip')).toContainText(/\d+(?:,\d+)? net/);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 375, height: 812 });
  await assertNoOverflow(page);
  await hide.click();
  await expect(student.locator('[data-chart-point]')).toHaveCount(0);
  await expect(student.getByRole('button', { name: 'Grafiği göster' })).toHaveAttribute('aria-expanded', 'false');
});

test('teacher sees a clear empty AYT progress state when a student has only TYT exams', async ({ page, context }) => {
  await login(context, DEMO_TEACHER_IDS[0]);
  await page.goto('/classroom');
  await openStudent(page, 'Ecrin Yılmaz');
  const student = page.getByRole('button', { name: /Ecrin Yılmaz/ }).locator('..');
  await student.getByRole('button', { name: 'Grafiği göster' }).click();
  await expect(student.locator('[data-chart-point]')).toHaveCount(3);
  await student.getByRole('button', { name: 'AYT', exact: true }).click();
  await expect(student.locator('[data-chart-point]')).toHaveCount(0);
  await expect(student.getByRole('region', { name: 'Deneme net gelişimi' }).getByText(/AYT denemesi yok/)).toBeVisible();
});

test('live messages, replies and a real timer start persist across student devices', async ({ browser }) => {
  const teacher = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const student = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  const teacherPage = await teacher.newPage(); const studentPage = await student.newPage();
  const studentId = DEMO_STUDENT_IDS[3];
  const note = `E2E birlikte ilerliyoruz ${randomUUID().slice(0, 8)}`;
  const reply = `${note} için teşekkürler hocam.`;
  try {
    await login(teacher, DEMO_TEACHER_IDS[0]); await login(student, studentId);
    const prior = await student.request.get('/api/state');
    await expect(prior).toBeOK();
    const priorActive = ((await prior.json()) as AppState).sessions.find(session => session.status !== 'finished');
    if (priorActive) {
      const finished = await student.request.post('/api/command', { headers, data: { request_id: randomUUID(), type: 'timer.finish', payload: { id: priorActive.id, expected_revision: priorActive.revision, confirmed_seconds: 0 } } });
      await expect(finished).toBeOK();
    }
    await teacherPage.goto('/classroom'); await openStudent(teacherPage, 'Kerem Şahin');
    await studentPage.goto('/');
    await studentPage.getByRole('button', { name: /Öğretmen mesajları/ }).click();
    await teacherPage.getByRole('button', { name: 'Takdir', exact: true }).click();
    await teacherPage.getByRole('textbox', { name: 'Mesajın', exact: true }).fill(note);
    await teacherPage.getByRole('button', { name: 'Gönder', exact: true }).click();
    await expect(studentPage.getByLabel('Mesaj geçmişi').getByText(note, { exact: true })).toBeVisible();
    await expect(studentPage.getByRole('dialog')).toHaveCount(0);
    await studentPage.getByRole('textbox', { name: 'Cevabın', exact: true }).fill(reply);
    await studentPage.getByRole('button', { name: 'Gönder', exact: true }).click();
    await expect(teacherPage.getByText(reply, { exact: true })).toBeVisible();
    await studentPage.reload();
    await studentPage.getByRole('button', { name: /Öğretmen mesajları/ }).click();
    await expect(studentPage.getByText(reply, { exact: true })).toBeVisible();

    const accepted = await command(teacher, 'alert.send', { student_id: studentId, body: `${note} şimdi başla` });
    await expect(accepted).toBeOK();
    const acceptedId = (await accepted.json()).result.id;
    await studentPage.getByRole('button', { name: 'Tamam', exact: true }).click();
    await expect(studentPage.getByRole('dialog')).toHaveCount(0);
    let feedback = (await state(teacher)).feedback.filter(item => item.alert_id === acceptedId);
    expect(feedback.map(item => item.event)).toEqual(['accepted']);
    // Reload is a real second client lifecycle; the accepted timestamp stays server-side.
    await studentPage.reload();
    await studentPage.getByRole('button', { name: 'Çalışma sayacını aç' }).click();
    const timer = studentPage.getByRole('dialog');
    const mathematics = timer.getByRole('button', { name: 'Matematik', exact: true });
    if (await mathematics.getAttribute('aria-pressed') !== 'true') await mathematics.click();
    await timer.getByRole('button', { name: 'Çalışmaya başla', exact: true }).click();
    await expect.poll(async () => (await state(teacher)).feedback.filter(item => item.alert_id === acceptedId).map(item => item.event).sort()).toEqual(['accepted', 'started']);
    feedback = (await state(teacher)).feedback.filter(item => item.alert_id === acceptedId);
    expect(feedback).toHaveLength(2);
    await expect.poll(async () => (await state(teacher)).students.find(item => item.id === studentId)?.presence.status).toBe('working');
    await assertNoOverflow(studentPage);

    await expect.poll(async () => (await state(teacher)).students.find(item => item.id === studentId)?.presence.online).toBe(true);
    const backgroundPage = await student.newPage();
    await backgroundPage.bringToFront();
    // Headless Edge leaves both tabs visible, so model the background tab's document lifecycle.
    await studentPage.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => studentPage.evaluate(() => document.visibilityState)).toBe('hidden');
    await expect.poll(async () => (await state(teacher)).students.find(item => item.id === studentId)?.presence.online).toBe(true);

    await studentPage.close();
    await backgroundPage.close();
    await expect.poll(async () => {
      const presence = (await state(teacher)).students.find(item => item.id === studentId)?.presence;
      return { online: presence?.online, status: presence?.status };
    }).toEqual({ online: false, status: 'working' });
    await expect(teacherPage.getByRole('button', { name: /Kerem Şahin/ }).locator('[data-status="working"]')).toContainText('Çalışıyor', { timeout: 40_000 });
  } finally {
    const saved = await student.request.get('/api/state');
    if (saved.ok()) {
      const value = await saved.json() as AppState;
      const active = value.sessions?.find(session => session.status !== 'finished');
      if (active) await student.request.post('/api/command', { headers, data: { request_id: randomUUID(), type: 'timer.finish', payload: { id: active.id, expected_revision: active.revision } } });
    }
    await teacher.close(); await student.close();
  }
});

test('invite registration is reviewed by its teacher and revoked links stop working', async ({ browser }) => {
  const teacher = await browser.newContext({ baseURL: origin });
  const student = await browser.newContext({ baseURL: origin });
  const admin = await browser.newContext({ baseURL: origin });
  let studentId: string | undefined;
  try {
    await login(teacher, DEMO_TEACHER_IDS[0]); await login(admin, DEMO_ADMIN_ID);
    const created = await command(teacher, 'invite.create', { expires_in_days: 1 });
    await expect(created).toBeOK();
    const invite = (await created.json()).result;
    const invitePage = await student.newPage();
    await invitePage.goto(`/join?token=${invite.token}`);
    await expect(invitePage.getByText(/Ayşe Demir/).first()).toBeVisible();
    await invitePage.getByRole('button', { name: 'Evet, katılmak istiyorum' }).click();
    await invitePage.getByRole('link', { name: 'Yeni öğrenci hesabı oluştur' }).click();
    const firstName = 'Deniz';
    const lastName = `Test ${randomUUID().slice(0, 7)}`;
    const name = `${firstName} ${lastName}`;
    const email = `e2e-${randomUUID()}@classroom-demo.invalid`;
    await invitePage.getByRole('textbox', { name: 'Adın', exact: true }).fill(firstName);
    await invitePage.getByRole('textbox', { name: 'Soyadın', exact: true }).fill(lastName);
    await invitePage.getByRole('textbox', { name: 'E-posta adresin' }).fill(email);
    await invitePage.locator('input[name="password"]').fill('DemoOnlyDoesNotStorePassword!');
    await invitePage.getByLabel('Şifreni tekrar gir').fill('AnotherPassword!2026');
    await invitePage.getByRole('checkbox', { name: /Başvuruyu demo olarak dene/ }).check();
    await invitePage.getByRole('button', { name: 'Başvurumu oluştur' }).click();
    await expect(invitePage.getByText('Şifreler eşleşmiyor. İki alana aynı şifreyi girin.', { exact: true })).toBeVisible();
    await invitePage.getByLabel('Şifreni tekrar gir').fill('DemoOnlyDoesNotStorePassword!');
    await invitePage.getByRole('button', { name: 'Başvurumu oluştur' }).click();
    await expect(invitePage.getByRole('heading', { name: 'Başvurun alındı.' })).toBeVisible();
    const waiting = await state(student); studentId = waiting.account!.id;
    expect(waiting.account!.status).toBe('pending');
    expect(waiting.applications[0].teacher_id).toBe(DEMO_TEACHER_IDS[0]);
    expect((await student.request.get('/api/state')).status()).toBe(403);
    const applicationId = waiting.applications[0].id;
    expect((await state(teacher)).applications.some(application => application.id === applicationId)).toBe(true);
    expect((await state(admin)).applications.some(application => application.id === applicationId)).toBe(true);
    const teacherPage = await teacher.newPage(); await teacherPage.goto('/classroom');
    await teacherPage.getByRole('button', { name: /Başvurular/ }).click();
    const card = teacherPage.locator(`#application-${applicationId}`);
    await expect(card.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(card.getByText(email, { exact: true })).toBeVisible();
    await expect(card.getByText(/Davetli öğrenci başvurusu/)).toBeVisible();
    await expect(teacherPage.getByText('DemoOnlyDoesNotStorePassword!', { exact: true })).toHaveCount(0);
    const adminPage = await admin.newPage(); await adminPage.goto('/classroom');
    await expect(adminPage.locator(`#application-${applicationId}`).getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: 'E-posta önizlemeleri' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Onayla', exact: true }).click();
    await expect.poll(async () => (await state(student)).account?.status).toBe('approved');
    await expect(await student.request.get('/api/state')).toBeOK();
    expect((await state(teacher)).students.some(item => item.id === studentId)).toBe(true);
    const revoked = await command(teacher, 'invite.revoke', { id: invite.id });
    await expect(revoked).toBeOK();
    expect((await student.request.get(`/api/classroom/invite?token=${invite.token}`)).status()).toBe(404);
    const rejectedRegistration = await student.request.post('/api/register', { headers, data: { first_name: 'Geçersiz', last_name: 'Davet', email: `e2e-${randomUUID()}@classroom-demo.invalid`, role: 'student', invite_token: invite.token, demo: true } });
    expect(rejectedRegistration.status()).toBe(410);
  } finally {
    if (studentId) {
      const saved = await state(student);
      if (saved.account?.status === 'approved') await command(admin, 'account.suspend', { id: studentId, suspended: true });
    }
    await teacher.close(); await student.close(); await admin.close();
  }
});

test('individual students wait for admin approval before studying', async ({ browser }) => {
  const student = await browser.newContext({ baseURL: origin });
  const teacher = await browser.newContext({ baseURL: origin });
  const admin = await browser.newContext({ baseURL: origin });
  let studentId: string | undefined;
  try {
    const page = await student.newPage();
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Bireysel öğrenci başvurusu.' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Adın', exact: true }).fill('Deniz');
    await page.getByRole('textbox', { name: 'Soyadın', exact: true }).fill('Bireysel');
    const email = `solo-${randomUUID()}@classroom-demo.invalid`;
    await page.getByRole('textbox', { name: 'E-posta adresin' }).fill(email);
    await page.locator('input[name="password"]').fill('DemoOnlyDoesNotStorePassword!');
    await page.getByLabel('Şifreni tekrar gir').fill('DemoOnlyDoesNotStorePassword!');
    await page.getByRole('checkbox', { name: /Başvuruyu demo olarak dene/ }).check();
    await page.getByRole('button', { name: 'Bireysel hesabımı oluştur' }).click();
    await expect(page.getByRole('heading', { name: 'Başvurun alındı.' })).toBeVisible();
    const studentState = await state(student);
    const account = studentState.account;
    studentId = account?.id;
    expect(account?.role).toBe('student');
    expect(account?.status).toBe('pending');
    expect(account?.teacher_id).toBeNull();
    expect(studentState.applications).toHaveLength(1);
    expect(studentState.applications[0].teacher_id).toBeNull();
    expect(studentState.applications[0].status).toBe('pending');
    expect((await student.request.get('/api/state')).status()).toBe(403);
    await login(teacher, DEMO_TEACHER_IDS[0]);
    expect((await state(teacher)).applications.some(application => application.id === studentState.applications[0].id)).toBe(false);
    expect((await state(teacher)).students.some(item => item.id === studentId)).toBe(false);
    await login(admin, DEMO_ADMIN_ID);
    const adminPage = await admin.newPage(); await adminPage.goto('/classroom');
    const card = adminPage.locator(`#application-${studentState.applications[0].id}`);
    await expect(card.getByRole('heading', { name: 'Deniz Bireysel' })).toBeVisible();
    await expect(card.getByText(email, { exact: true })).toBeVisible();
    await expect(card.getByText(/Bireysel öğrenci başvurusu/)).toBeVisible();
    await card.getByRole('button', { name: 'Onayla', exact: true }).click();
    await expect.poll(async () => (await state(student)).account?.status).toBe('approved');
    await expect(await student.request.get('/api/state')).toBeOK();
    await page.getByRole('link', { name: 'Başvuru durumum' }).click();
    await expect(page.getByRole('heading', { name: 'Çalışma alanın hazır.' })).toBeVisible();
    await page.getByRole('link', { name: 'Öğrenci alanına geç' }).click();
    await expect(page).toHaveURL(`${origin}/`);
  } finally {
    if (studentId) {
      await login(admin, DEMO_ADMIN_ID);
      await command(admin, 'account.suspend', { id: studentId, suspended: true });
    }
    await student.close(); await teacher.close(); await admin.close();
  }
});
