import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState, type Task } from '../../src/lib/domain/types';
import { localDate } from '../../src/lib/ui';

type Metric = {
  command_type: string; outcome: string; visible_ms: number | null; visible_source: string | null;
  confirmed_ms: number | null; confirmation_source: string | null;
  server_timing: Record<string, number>; refresh_ms: number | null; refresh_outcome: string | null;
};

async function metrics(page: Page): Promise<Metric[]> {
  return JSON.parse(await page.locator('.app-shell').getAttribute('data-save-metrics') ?? '[]');
}

test('passive DOM metrics separate optimistic commitment, receipt and refresh without exposing save data', async ({ page }) => {
  const privateText = 'private-user@example.test journal content';
  const stamp = new Date().toISOString();
  const task: Task = {
    id: '22222222-2222-4222-8222-222222222222', title: privateText,
    plan_date: localDate(), exam: null, subject: null, topic_id: null, resource: '',
    completion_criteria: '', planned_minutes: 40, difficulty: 'medium', progress: 0,
    weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Tekrar',
    steps: [], revision: 1, created_at: stamp, updated_at: stamp,
  };
  const state: AppState = { ...emptyState(true), authenticated: true, tasks: [task] };
  let writes = 0;
  let releaseReceipt!: () => void;
  const receipt = new Promise<void>(resolve => { releaseReceipt = resolve; });
  let releaseRefresh!: () => void;
  const refresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
  await page.route('**/api/state', async route => {
    if (writes) await refresh;
    await route.fulfill({ json: state });
  });
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    writes++;
    await receipt;
    state.tasks[0] = { ...state.tasks[0], progress: command.payload.progress, revision: 2 };
    await route.fulfill({
      headers: { 'server-timing': `auth_db;dur=15;desc="${privateText}", command;dur=10, app;dur=28` },
      json: { ok: true, id: task.id, request_id: command.request_id, replayed: false },
    });
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Görevlerim', exact: true }).click();
  try {
    await page.getByRole('button', { name: privateText + ' görevini tamamla', exact: true }).click();
    const undo = page.getByRole('button', { name: privateText + ' tamamlamasını geri al', exact: true });
    await expect(undo).toBeEnabled();
    const beforeReceipt = (await metrics(page))[0];
    expect(beforeReceipt).toMatchObject({
      command_type: 'task.update', outcome: 'pending', visible_source: 'optimistic',
      confirmed_ms: null, refresh_ms: null,
    });
    expect(beforeReceipt.visible_ms).toBeGreaterThanOrEqual(0);

    releaseReceipt();
    await expect(undo).toBeEnabled();
    const afterReceipt = (await metrics(page))[0];
    expect(afterReceipt).toMatchObject({
      outcome: 'confirmed', confirmation_source: 'receipt', refresh_ms: null,
      server_timing: { auth_db: 15, command: 10, app: 28 },
    });
    expect(afterReceipt.confirmed_ms).toBeGreaterThanOrEqual(beforeReceipt.visible_ms!);
    releaseRefresh();
    await expect.poll(async () => (await metrics(page))[0].refresh_outcome).toBe('applied');
    expect((await metrics(page))[0].refresh_ms).toBeGreaterThanOrEqual(0);
    const serialized = await page.locator('.app-shell').getAttribute('data-save-metrics');
    expect(serialized).not.toContain(privateText);
    expect(serialized).not.toContain(task.id);
    expect(serialized).not.toContain('request_id');
  } finally { releaseReceipt(); releaseRefresh(); }
});
