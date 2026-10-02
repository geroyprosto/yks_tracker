import {expect, test, type BrowserContext, type Route} from '@playwright/test';
import {CLASSROOM_DEMO_ACCOUNTS} from '../../src/lib/classroom/demo-seed';
import type {EducationCommand, EducationState} from '../../src/lib/education';

const origin = 'http://127.0.0.1:3200';

async function login(context: BrowserContext) {
  const pending = CLASSROOM_DEMO_ACCOUNTS.find(account => account.key === 'pending-student')!;
  await expect(await context.request.post('/api/demo', {headers: {Origin: origin}, data: {account_id: pending.id}})).toBeOK();
}

test('standalone draft save uses a narrow receipt and waits for background reconciliation', async ({page, context}) => {
  await login(context);
  const initialResponse = await context.request.get('/api/education');
  await expect(initialResponse).toBeOK();
  const initial = await initialResponse.json() as EducationState;
  let releaseRead: () => void = () => {};
  const heldRead = new Promise<void>(resolve => {releaseRead = resolve;});
  let readCount = 0;
  let saved: EducationCommand | null = null;

  await page.route('**/api/education', async (route: Route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers().prefer).toBe('return=minimal');
      saved = route.request().postDataJSON() as EducationCommand;
      await route.fulfill({json: {ok: true, result: {id: saved.request_id, request_id: saved.request_id, replayed: false}}});
      return;
    }
    readCount++;
    await heldRead;
    if (!saved || saved.type !== 'draft.save') throw new Error('Expected draft save before reconciliation');
    await route.fulfill({json: {...initial, draft: {step: saved.payload.step, data: saved.payload.data,
      revision: (initial.draft?.revision ?? 0) + 1, updated_at: new Date().toISOString()}}});
  });

  await page.goto('/personalize');
  const save = page.getByRole('button', {name: 'Taslağı kaydet', exact: true});
  await save.click();
  await expect(page.getByRole('status')).toContainText('Taslağın kaydedildi');
  await expect.poll(() => readCount).toBe(1);
  await expect(save).toBeDisabled();
  releaseRead();
  await expect(save).toBeEnabled();
});

test('standalone draft save rolls back a failed preview and retries the same request', async ({page, context}) => {
  await login(context);
  const initialResponse = await context.request.get('/api/education');
  await expect(initialResponse).toBeOK();
  const initial = await initialResponse.json() as EducationState;
  const requests: EducationCommand[] = [];

  await page.route('**/api/education', async route => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as EducationCommand;
      requests.push(command);
      if (requests.length === 1) {
        await route.fulfill({status: 500, json: {error: {message: 'Geçici kayıt hatası.'}}});
      } else {
        await route.fulfill({json: {ok: true, result: {id: command.request_id, request_id: command.request_id, replayed: false}}});
      }
      return;
    }
    const command = requests.at(-1);
    if (!command || command.type !== 'draft.save') throw new Error('Expected draft save before reconciliation');
    await route.fulfill({json: {...initial, draft: {step: command.payload.step, data: command.payload.data,
      revision: (initial.draft?.revision ?? 0) + 1, updated_at: new Date().toISOString()}}});
  });

  await page.goto('/personalize');
  const save = page.getByRole('button', {name: 'Taslağı kaydet', exact: true});
  await save.click();
  await expect(page.getByRole('alert').filter({hasText: 'Geçici kayıt hatası.'})).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('status')).toContainText('Taslağın kaydedildi');
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].request_id).toBe(requests[0].request_id);
  if (requests[0].type !== 'draft.save' || requests[1].type !== 'draft.save') throw new Error('Expected draft saves');
  expect(requests[0].payload.expected_revision).toBe(initial.draft?.revision ?? 0);
  expect(requests[1].payload.expected_revision).toBe(initial.draft?.revision ?? 0);
});
