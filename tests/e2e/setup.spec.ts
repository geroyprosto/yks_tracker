import { expect, test, type Page } from "@playwright/test";

async function navigate(page: Page, name: string) {
  const mobile = (page.viewportSize()?.width ?? 1440) <= 760;
  await page.getByRole("navigation", { name: mobile ? "Mobil gezinme" : "Ana gezinme" }).getByRole("button", { name, exact: true }).click();
}

async function showRealEmpty(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gerçek boş görünümü göster' }).click();
  await expect(page.getByText('Örnek grafik önizlemesi kapalı.')).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
}

test("real setup API exposes empty data and the dashboard never invents study records", async ({ page, request }, testInfo) => {
  const response = await request.get("/api/state");
  expect(response.status()).toBe(200);
  const state = await response.json();
  expect(state).toMatchObject({ configured: false, authenticated: false, settings: null, tasks: [], topics: [], sessions: [], intervals: [], day_plans: [] });
  expect(response.headers()["cache-control"]).toContain("no-store");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await showRealEmpty(page);
  await expect(page.getByText("Kişisel alanın kurulum için hazır.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bugün için temiz bir sayfa" })).toBeVisible();
  await expect(page.getByRole("img", {name:"Görevler: tanımlı değil",exact:true})).toBeVisible();
  await expect(page.getByText("İlk görevini ekle", {exact:true})).toBeVisible();
  await expect(page.getByRole("button", { name: "Çalışma sayacını aç", exact: true }).first()).toBeDisabled();
  expect(await page.locator(".bar-value").allTextContents()).toEqual(Array(7).fill("—"));
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("desktop-setup.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("task and topic dialogs are keyboard accessible and cannot save without authentication", async ({ page }) => {
  let commandRequests = 0;
  page.on("request", request => { if (request.url().includes("/api/command")) commandRequests++; });
  await showRealEmpty(page);
  await expect(page.getByRole("heading", { name: "Bugün için temiz bir sayfa" })).toBeVisible();
  await navigate(page, "Görevlerim");
  await page.getByRole("button", { name: "Görev ekle", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Yeni görev" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Görev başlığı")).toBeFocused();
  await dialog.getByLabel("Görev başlığı").fill("Tarayıcı kabul testi");
  await expect(dialog.getByRole("group", { name: "Alt adımlar" })).toHaveCount(0);
  await expect(dialog.getByLabel("Notlar", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Görevi kaydet" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await navigate(page, "Konularım");
  await page.getByRole("button", { name: "Konu ekle", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Yeni konu" });
  await expect(dialog.getByLabel("Konu adı")).toBeFocused();
  await dialog.getByLabel("Konu adı").fill("Yeni konu");
  await dialog.getByLabel("Ders", { exact: true }).fill("Matematik");
  await expect(dialog.getByRole("button", { name: "Kaydet", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(commandRequests).toBe(0);
});

test("six themes and appearance persist across reload, with accessible preference controls", async ({ page }) => {
  await showRealEmpty(page);
  await expect(page.getByRole("heading", { name: "Bugün için temiz bir sayfa" })).toBeVisible();
  await navigate(page, "Ayarlar");
  const themes = ["Mercan / Gül", "Okyanus", "Mürdüm / Krem", "Beyaz", "Siyah", "Pastel"];
  await expect(page.locator(".theme-card")).toHaveCount(6);
  for (const name of ["Çelik Mavisi", "Grafit", "Aurora", "Orman", "Bordo"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  for (const name of themes) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expectNoOverflow(page);
  }
  await page.getByRole("button", { name: "Açık", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await page.getByRole("checkbox", { name: /Az hareket/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-reduced", "true");
  await page.getByRole("checkbox", { name: /Sade görünüm/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-simple", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "pastel");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  for (const theme of [{ name: "Beyaz", id: "white" }, { name: "Siyah", id: "black" }]) {
    await navigate(page, "Ayarlar");
    await page.getByRole("button", { name: theme.name, exact: true }).click();
    await expect(page.getByRole("button", { name: "Açık", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.id);
    await navigate(page, "Ayarlar");
    await expect(page.getByRole("button", { name: theme.name, exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Pastel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Açık", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  for (const [legacy, current] of Object.entries({ steel: "ocean", graphite: "black", aurora: "white", forest: "black", burgundy: "rose" })) {
    await page.evaluate(value => localStorage.setItem("yksim-theme", value), legacy);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", current);
  }
});

test("mobile routes, forms, and themes remain inside a 360px viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await showRealEmpty(page);
  await expect(page.getByRole("heading", { name: "Bugün için temiz bir sayfa" })).toBeVisible();
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("mobile-setup.png"), fullPage: true });
  for (const name of ["Görevlerim", "Konularım", "Ayarlar"]) {
    await navigate(page, name);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expectNoOverflow(page);
  }
  await page.getByRole("button", { name: "Plan ve hedefler", exact: true }).click();
  await expect(page.getByLabel("Varsayılan günlük hedef (dk)")).toBeVisible();
  await expectNoOverflow(page);
  await navigate(page, "Görevlerim");
  await page.getByRole("button", { name: "Görev ekle", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni görev" });
  await expect(dialog).toBeVisible();
  await expectNoOverflow(page);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menüyü aç", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Ana gezinme" })).toBeVisible();
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "Sınav Sonuçları" }).click();
  await expect(page.getByRole("heading", { name: "Deneme sonuçların" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("real mutation APIs reject absent setup and requests from another origin", async ({ request, baseURL }) => {
  const command = { request_id: "47d6ff6e-246f-4be4-962c-9b6270ff3a3f", type: "task.create", payload: { title: "Must not save" } };
  const rejected = await request.post("/api/command", { data: command, headers: { Origin: "https://other.example" } });
  expect(rejected.status()).toBe(403);
  expect(await rejected.json()).toMatchObject({ ok: false, error: { code: "ORIGIN_REJECTED" } });
  const unavailable = await request.post("/api/command", { data: command, headers: { Origin: baseURL! } });
  expect(unavailable.status()).toBe(503);
  expect(await unavailable.json()).toMatchObject({ ok: false, error: { code: "SETUP_REQUIRED" } });
  const login = await request.post("/api/login", { data: { email: "test@example.com", password: "not-a-real-password" }, headers: { Origin: baseURL! } });
  expect(login.status()).toBe(503);
  expect(await login.json()).toMatchObject({ ok: false, error: { code: "SETUP_REQUIRED" } });
  expect((await (await request.get("/api/state")).json()).tasks).toEqual([]);
});
