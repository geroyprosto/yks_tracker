import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DEMO_ADMIN_ID, DEMO_TEACHER_IDS } from '../../src/lib/classroom/demo-seed';
import type { ClassroomState } from '../../src/lib/classroom/types';

const origin = 'http://127.0.0.1:3200';
const headers = { Origin: origin };

async function signIn(context: BrowserContext, accountId: string) {
  const response = await context.request.post('/api/demo', { headers, data: { account_id: accountId } });
  await expect(response).toBeOK();
}

async function readState(context: BrowserContext): Promise<ClassroomState> {
  const response = await context.request.get('/api/classroom');
  await expect(response).toBeOK();
  return response.json();
}

async function command(context: BrowserContext, type: string, payload: Record<string, unknown>) {
  return context.request.post('/api/classroom', { headers, data: { request_id: randomUUID(), type, payload } });
}

async function openStudent(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'Öğrenci adına göre ara' }).fill(name);
  const row = page.getByRole('button', { name: new RegExp(name) });
  await expect(row).toHaveCount(1);
  if (await row.getAttribute('aria-expanded') !== 'true') await row.click();
  await expect(page.getByText('Öğrenci istatistikleri salt okunur.')).toBeVisible();
}

test('separate study order control reaches a persistent five minute lock after ten refusals', async ({ browser }) => {
  test.setTimeout(120_000);
  const teacher = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const student = await browser.newContext({ baseURL: origin, viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' });
  const admin = await browser.newContext({ baseURL: origin });
  let studentId: string | undefined;

  try {
    await signIn(teacher, DEMO_TEACHER_IDS[0]);
    await signIn(admin, DEMO_ADMIN_ID);

    // A fresh approved account keeps prior timer/alert state and repeated runs
    // from influencing this order. Setup uses the real registration and review APIs.
    const suffix = randomUUID().slice(0, 8);
    const studentName = `Çalışma Emri Test ${suffix}`;
    const registration = await student.request.post('/api/register', {
      headers, data: { first_name: 'Çalışma', last_name: `Emri Test ${suffix}`, email: `study-order-${randomUUID()}@classroom-demo.invalid`, role: 'student', demo: true },
    });
    await expect(registration).toBeOK();
    const waiting = await readState(student);
    studentId = waiting.account!.id;
    const application = waiting.applications.find(item => item.user_id === studentId && item.status === 'pending')!;
    const approval = await command(admin, 'application.review', { id: application.id, decision: 'approved', teacher_id: DEMO_TEACHER_IDS[0] });
    await expect(approval).toBeOK();

    const teacherPage = await teacher.newPage();
    const studentPage = await student.newPage();
    await teacherPage.goto('/classroom');
    await openStudent(teacherPage, studentName);
    await studentPage.goto('/');
    await expect(studentPage.getByRole('button', { name: /Öğretmen mesajları/ })).toBeVisible();

    // The explicit order action coexists with the normal message composer and
    // preserves an unsent normal message when the order composer opens.
    const draft = `Gönderilmemiş normal mesaj ${suffix}`;
    await teacherPage.getByRole('textbox', { name: 'Mesajın', exact: true }).fill(draft);
    await teacherPage.getByRole('button', { name: 'Çalışma emri gönder', exact: true }).click();
    await expect(teacherPage.getByRole('textbox', { name: 'Mesajın', exact: true })).toHaveValue(draft);
    const orderBody = `Şimdi masanın başına geç ${suffix}`;
    await teacherPage.getByRole('textbox', { name: 'Çalışma emri', exact: true }).fill(orderBody);
    await teacherPage.getByRole('button', { name: 'Emri gönder', exact: true }).click();

    const dialog = studentPage.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: orderBody, exact: true })).toBeVisible();
    const sentState = await readState(teacher);
    const alertId = sentState.alerts.find(item => item.student_id === studentId && item.body === orderBody)!.id;

    for (let count = 1; count <= 10; count++) {
      const no = dialog.getByRole('button', { name: 'Hayır', exact: true });
      await expect(no).toBeEnabled();
      if (count === 1) { await no.focus(); await no.press('Enter'); }
      else await no.click();
      if (count < 10) await expect(dialog.getByText(`${count}/10 Hayır`, { exact: true })).toBeVisible();
    }

    await expect(dialog.getByRole('heading', { name: 'Peki, sen bilirsin.', exact: true })).toBeVisible();
    await expect(dialog.getByText('Ekran kilidi', { exact: true })).toBeVisible();
    const countdown = dialog.locator('time');
    await expect(countdown).toHaveText(/(?:0?5:00|0?4:[0-5]\d)/);
    await expect(dialog.getByRole('button', { name: 'Kapat ve devam et', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Tamam', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Hayır', exact: true })).toHaveCount(0);

    const lockedState = await readState(student);
    const lockedAlert = lockedState.alerts.find(item => item.id === alertId)!;
    expect(lockedAlert.status).toBe('declined');
    expect(lockedAlert.refusal_count).toBe(10);
    expect(lockedAlert.closed_at).not.toBeNull();
    const lockAge = Date.parse(lockedState.server_now) - Date.parse(lockedAlert.closed_at!);
    expect(lockAge).toBeGreaterThanOrEqual(0);
    expect(lockAge).toBeLessThan(30_000);

    // Hiding UI controls is insufficient: an immediate direct dismiss request
    // must be rejected by the real server while its persisted lock is active.
    const earlyDismiss = await command(student, 'alert.respond', { id: alertId, response: 'dismiss' });
    expect(earlyDismiss.status()).toBe(409);
    expect((await earlyDismiss.json()).error.code).toBe('ALERT_LOCKED');
    await studentPage.reload();
    await expect(dialog.getByRole('heading', { name: 'Peki, sen bilirsin.', exact: true })).toBeVisible();
    await expect(countdown).toHaveText(/(?:0?5:00|0?4:[0-5]\d)/);
    await studentPage.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Kapat ve devam et', exact: true })).toHaveCount(0);

    const afterReload = await readState(student);
    expect(afterReload.alerts.find(item => item.id === alertId)?.closed_at).toBe(lockedAlert.closed_at);
    const secondEarlyDismiss = await command(student, 'alert.respond', { id: alertId, response: 'dismiss' });
    expect(secondEarlyDismiss.status()).toBe(409);
    const feedback = (await readState(teacher)).feedback.filter(item => item.alert_id === alertId && item.event === 'refused_ten');
    expect(feedback).toHaveLength(1);
    expect(await studentPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally {
    if (studentId) {
      const suspended = await command(admin, 'account.suspend', { id: studentId, suspended: true });
      await expect(suspended).toBeOK();
    }
    await teacher.close();
    await student.close();
    await admin.close();
  }
});
