import { expect, test, type Page } from "@playwright/test";
import { emptyState, type AppState } from "../../src/lib/domain/types";
import { localDate } from "../../src/lib/ui";

// Browser-only contract checks: HTTP responses are intentionally mocked.
// These do not claim a live Supabase sign-in or successful database write.
function authenticatedState(): AppState {
  return { ...emptyState(true), authenticated: true };
}

async function mockState(page: Page, state: AppState, status = 200) {
  await page.route("**/api/state", route => route.fulfill({ status, json: { ...state, server_now: new Date().toISOString() } }));
}

test("mocked login error exposes the API message without leaking object serialization", async ({ page }) => {
  await mockState(page, emptyState(true), 401);
  await page.route("**/api/login", route => route.fulfill({ status: 401, json: { ok: false, error: { code: "INVALID_LOGIN", message: "Giriş bilgileri geçerli değil." } } }));
  await page.goto("/");
  await page.getByLabel("E-posta").fill("owner@example.com");
  await page.getByLabel("Parola").fill("invalid-password");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Giriş bilgileri geçerli değil." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Giriş yap", exact: true })).toBeEnabled();
});

test("mocked write conflict preserves draft and remains visible after state refresh", async ({ page }) => {
  await mockState(page, authenticatedState());
  await page.route("**/api/command", route => route.fulfill({ status: 409, json: { ok: false, error: { code: "CONFLICT", message: "Plan başka bir cihazda değişti. Yenileyip tekrar dene." } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Günü planla", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni görev" });
  await dialog.getByLabel("Görev başlığı").fill("Kaybolmaması gereken taslak");
  await dialog.getByRole("button", { name: "Görevi kaydet", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Görev başlığı")).toHaveValue("Kaybolmaması gereken taslak");
  await expect(dialog.getByRole("alert")).toHaveText("Plan başka bir cihazda değişti. Yenileyip tekrar dene.");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert").filter({ hasText: "Plan başka bir cihazda değişti." })).toBeVisible();
});

test("task completion changes immediately, then reconciles after a delayed save", async ({ page }) => {
  const state = authenticatedState();
  const taskId = '22222222-2222-4222-8222-222222222222';
  state.tasks = [{id: taskId, title: 'Hız testi', plan_date: localDate(), exam: null, subject: null,
    topic_id: null, resource: '', completion_criteria: '', planned_minutes: 40, difficulty: 'medium',
    progress: 0, weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Tekrar',
    steps: [], revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString()}];
  await mockState(page, state);
  let finish!: () => void;
  const held = new Promise<void>(resolve => {finish = resolve;});
  let prefer = '';
  await page.route('**/api/command', async route => {
    prefer = route.request().headers()['prefer'] ?? '';
    await held;
    state.tasks[0] = {...state.tasks[0], progress: 1, revision: 2};
    await route.fulfill({json: {ok: true, id: taskId, request_id: route.request().postDataJSON().request_id, replayed: false}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
  await page.getByRole('button', {name: 'Hız testi görevini tamamla'}).click();
  await expect(page.getByRole('button', {name: 'Hız testi tamamlamasını geri al'})).toBeVisible();
  await expect(page.locator('.sync-status')).toContainText('Kaydediliyor');
  expect(prefer).toBe('return=minimal');
  finish();
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  await expect(page.getByRole('button', {name: 'Hız testi tamamlamasını geri al'})).toBeVisible();
});

test("a rejected save restores the previous task state", async ({ page }) => {
  const state = authenticatedState();
  state.tasks = [{id: '22222222-2222-4222-8222-222222222222', title: 'Geri alma testi',
    plan_date: localDate(), exam: null, subject: null, topic_id: null, resource: '', completion_criteria: '',
    planned_minutes: 40, difficulty: 'medium', progress: 0, weight_override: null, priority: 'normal',
    position: 0, notes: '', study_type: 'Tekrar', steps: [], revision: 1,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()}];
  await mockState(page, state);
  let reject!: () => void;
  const held = new Promise<void>(resolve => {reject = resolve;});
  await page.route('**/api/command', async route => {
    await held;
    await route.fulfill({status: 409, json: {ok: false, error: {code: 'CONFLICT', message: 'Kayıt başka yerde değişti.'}}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Görevlerim', exact: true}).click();
  await page.getByRole('button', {name: 'Geri alma testi görevini tamamla'}).click();
  await expect(page.getByRole('button', {name: 'Geri alma testi tamamlamasını geri al'})).toBeVisible();
  reject();
  await expect(page.getByRole('button', {name: 'Geri alma testi görevini tamamla'})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText: 'Kayıt başka yerde değişti.'})).toBeVisible();
});

test('a journal entry appears before its delayed save response', async ({page}) => {
  const state = authenticatedState();
  await mockState(page, state);
  let finish!: () => void;
  const held = new Promise<void>(resolve => {finish = resolve;});
  await page.route('**/api/command', async route => {
    const command = route.request().postDataJSON();
    await held;
    state.journal_entries = [{id: 'saved-journal', journal_date: command.payload.journal_date,
      original_text: command.payload.original_text, structured_fields: {}, exclude_from_analysis: false,
      ai_shared_fields: [], revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString()}];
    await route.fulfill({json: {ok: true, id: 'saved-journal', request_id: command.request_id, replayed: false}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Günlüğüm'}).click();
  await page.getByLabel('Bugün aklında neler kaldı?').fill('Hızlı kayıt');
  await page.getByRole('button', {name: 'Günlüğü kaydet'}).click();
  await expect(page.getByText('Son kayıt:', {exact: false})).toBeVisible();
  await expect(page.locator('.sync-status')).toContainText('Kaydediliyor');
  finish();
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  await expect(page.getByLabel('Bugün aklında neler kaldı?')).toHaveValue('Hızlı kayıt');
});

test("mocked failed timer finish keeps the active session dialog open", async ({ page }) => {
  const state = authenticatedState();
  state.sessions = [{ id: "active-session", title: "Devam eden çalışma", task_id: null, topic_id: null, subject: null, study_type: "Tekrar", mode: "stopwatch", target_seconds: null, status: "running", started_at: new Date(Date.now() - 600_000).toISOString(), active_since: new Date(Date.now() - 600_000).toISOString(), accumulated_seconds: 0, finished_at: null, revision: 1 }];
  await mockState(page, state);
  await page.route("**/api/command", route => route.fulfill({ status: 409, json: { ok: false, error: { code: "CONFLICT", message: "Oturum değişti. Yenileyip tekrar dene." } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sayaç — çalışma sayacını aç", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Çalışma sayacı" });
  await dialog.getByRole("button", { name: "Bitir ve kaydet", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Oturum değişti. Yenileyip tekrar dene.");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Duraklat", exact: true })).toBeEnabled();
});

test("mocked authenticated mobile user can choose a course, activity, and duration without an existing task", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockState(page, authenticatedState());
  await page.goto("/");
  await page.getByRole("button", { name: "Sayaç — çalışma sayacını aç", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Çalışmaya başla" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Sınav bölümü" }).getByRole("button", { name: "TYT" })).toBeFocused();
  await expect(dialog.getByLabel("Süre (dakika)")).toHaveValue("40");
  await expect(dialog.getByRole("button", { name: "Çalışmaya başla", exact: true })).toBeDisabled();
  await dialog.getByRole("group", { name: "TYT dersi" }).getByRole("button", { name: "Türkçe" }).click();
  await dialog.getByRole("group", { name: "Çalışma türü" }).getByRole("button", { name: "Branş denemesi" }).click();
  await dialog.getByRole("group", { name: "Hazır süreler" }).getByRole("button", { name: "50 dk" }).click();
  await expect(dialog.getByLabel("Süre (dakika)")).toHaveValue("50");
  await expect(dialog).toContainText("TYT Türkçe branş denemesi");
  await expect(dialog.getByRole("button", { name: "Çalışmaya başla", exact: true })).toBeEnabled();
});



test("mocked authenticated state refresh preserves local unsynced appearance choices", async ({ page }) => {
  const state = authenticatedState();
  state.settings = { display_name: "Sümeyra", exam_year: 2027, exam_date: null, target_rank: null, timezone: "Europe/Istanbul", daily_target_minutes: 360, task_share: .7, difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 }, weekday_targets: [360, 360, 360, 360, 360, 360, 360], theme: "ocean", appearance: "dark", reduced_motion: false, simple_view: false, revision: 1 };
  await mockState(page, state);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page.getByRole("button", { name: "Mercan / Gül", exact: true }).click();
  await page.getByRole("checkbox", { name: /Az hareket/ }).check();
  await page.getByRole("checkbox", { name: /Sade görünüm/ }).check();
  const refreshed = page.waitForResponse("**/api/state");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(page.locator("html")).toHaveAttribute("data-theme", "rose");
  await expect(page.locator("html")).toHaveAttribute("data-reduced", "true");
  await expect(page.locator("html")).toHaveAttribute("data-simple", "true");
  const reloaded = page.waitForResponse("**/api/state");
  await page.reload();
  await reloaded;
  await expect(page.locator("html")).toHaveAttribute("data-theme", "rose");
  await expect(page.locator("html")).toHaveAttribute("data-reduced", "true");
  await expect(page.locator("html")).toHaveAttribute("data-simple", "true");
});

test("finalized session time remains in statistics without a records view", async ({ page }) => {
  const state = authenticatedState();
  const finishedAt = Date.now();
  const startedAt = new Date(finishedAt - 1_800_000).toISOString();
  state.sessions = [{ id: "finished-session", title: "Kaydedilmiş tekrar", task_id: null, topic_id: null, subject: null, study_type: "Tekrar", mode: "stopwatch", target_seconds: null, status: "finished", started_at: startedAt, active_since: null, accumulated_seconds: 1800, finished_at: new Date(finishedAt).toISOString(), revision: 2 }];
  state.intervals = [{id: 'finished-interval', session_id: 'finished-session', started_at: startedAt, ended_at: new Date(finishedAt).toISOString()}];
  await mockState(page, state);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "Çalışma İstatistikleri", exact: true }).click();
  await expect(page.locator('.study-stats-metrics > div').first().locator('strong')).toHaveText('30 dk');
  await expect(page.getByRole("group", { name: "İstatistik görünümü" }).getByRole("button", { name: "Kayıtlar", exact: true })).toHaveCount(0);
});

test("mocked task reorder submits an atomic move command and shows returned order", async ({ page }) => {
  const state = authenticatedState();
  const common = { plan_date: localDate(), exam: null, subject: null, topic_id: null, resource: "", completion_criteria: "", planned_minutes: 40, difficulty: "medium" as const, progress: 0, weight_override: null, priority: "normal" as const, notes: "", study_type: "Tekrar" as const, steps: [], revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  state.tasks = [{ ...common, id: "first-task", title: "İlk görev", position: 0 }, { ...common, id: "second-task", title: "İkinci görev", position: 1 }];
  await mockState(page, state);
  let sent: { type: string; payload: Record<string, unknown> } | undefined;
  await page.route("**/api/command", async route => {
    sent = route.request().postDataJSON();
    state.tasks[0].position = 1;
    state.tasks[1].position = 0;
    await route.fulfill({ json: { ok: true, state } });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "Görevlerim", exact: true }).click();
  await expect(page.getByRole("button", { name: "İlk görev yukarı taşı", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "İkinci görev yukarı taşı", exact: true }).click();
  await expect(page.locator(".task-item h3").first()).toHaveText("İkinci görev");
  expect(sent).toMatchObject({ type: "task.move", payload: { id: "second-task", expected_revision: 1, direction: "up" } });
});
test("mocked default goal change fills all weekdays and keeps individual edits in the save payload", async ({ page }) => {
  const state = authenticatedState();
  state.settings = { display_name: "Sümeyra", exam_year: 2027, exam_date: null, target_rank: null, timezone: "Europe/Istanbul", daily_target_minutes: 360, task_share: .7, difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 }, weekday_targets: [360, 360, 360, 360, 360, 360, 360], theme: "ocean", appearance: "dark", reduced_motion: false, simple_view: false, revision: 4 };
  await mockState(page, state);
  let sent: { type: string; payload: Record<string, unknown> } | undefined;
  await page.route("**/api/command", async route => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, state } });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page.getByRole("button", { name: "Plan ve hedefler", exact: true }).click();
  await page.getByLabel(/Varsayılan günlük hedef/).fill("240");
  for (const day of ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]) {
    await expect(page.getByLabel(day, { exact: true })).toHaveValue("240");
  }
  await page.getByLabel("Paz", { exact: true }).fill("120");
  await page.getByRole("button", { name: "Hedefleri kaydet", exact: true }).click();
  await expect.poll(() => sent?.type).toBe("settings.update");
  expect(sent).toMatchObject({ payload: { expected_revision: 4, daily_target_minutes: 240, weekday_targets: [240, 240, 240, 240, 240, 240, 120] } });
});
