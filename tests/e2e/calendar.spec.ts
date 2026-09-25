import { expect, test } from '@playwright/test';
import { emptyState, type AppState } from '../../src/lib/domain/types';
import type { CalendarChoice, CalendarEvent, CalendarToday } from '../../src/lib/google-calendar';

// Browser contract: app state and Google routes are mocked; this never requests real OAuth access.
test('read-only Today calendar, selection, disconnect and Phase 2 navigation work together', async ({ page }, testInfo) => {
  const now = '2026-09-24T09:00:00.000Z';
  const state: AppState = { ...emptyState(true), authenticated: true, server_now: now };
  const calendars: CalendarChoice[] = [
    { id: 'owner@example.com', name: 'Kişisel', primary: true, color: '#76c6e8' },
    { id: 'school@example.com', name: 'Okul', primary: false, color: '#c8a8e9' },
  ];
  const events: CalendarEvent[] = [
    { id: 'all', color: '#7986cb', calendarId: 'owner@example.com', calendarName: 'owner@example.com', title: 'Tüm gün deneme hazırlığı', start: '2026-09-24', end: '2026-09-25', allDay: true, continuesFromPreviousDay: false, continuesIntoNextDay: false, htmlLink: null },
    { id: 'night', color: '#33b679', calendarId: 'owner@example.com', calendarName: 'owner@example.com', title: 'Gece tekrar grubu', start: '2026-09-23T20:30:00.000Z', end: '2026-09-23T22:30:00.000Z', allDay: false, continuesFromPreviousDay: true, continuesIntoNextDay: false, htmlLink: null },
    { id: 'course', color: '#f6c026', calendarId: 'school@example.com', calendarName: 'school@example.com', title: 'Matematik kursu', start: '2026-09-24T10:00:00.000Z', end: '2026-09-24T11:00:00.000Z', allDay: false, continuesFromPreviousDay: false, continuesIntoNextDay: false, htmlLink: 'https://calendar.google.com/calendar/u/0/r/eventedit/example' },
  ];
  let connected = true;
  let selected = ['owner@example.com'];
  let writes = 0;
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/command', route => { writes++; return route.abort(); });
  await page.route('**/api/calendar/today', route => route.fulfill({ json: {
    connected, date: '2026-09-24', timezone: 'Europe/Istanbul',
    events: connected ? events : [], refreshedAt: now,
  } satisfies CalendarToday }));
  await page.route('**/api/calendar/status', route => route.fulfill({ json: {
    configured: true, connected, calendars: connected ? calendars : [],
    selectedCalendarIds: connected ? selected : [], lastSuccessAt: connected ? now : null,
  } }));
  await page.route('**/api/calendar/select', async route => {
    const body = route.request().postDataJSON() as { calendarIds: string[] };
    selected = body.calendarIds;
    await route.fulfill({ json: { ok: true, selectedCalendarIds: selected } });
  });
  await page.route('**/api/calendar/disconnect', async route => {
    connected = false;
    await route.fulfill({ json: { ok: true, revoked: true } });
  });

  await page.goto('/');
  const program = page.locator('.calendar-program-card');
  await expect(program.getByText('Tüm gün deneme hazırlığı')).toBeVisible();
  await expect(program.getByText('Gece tekrar grubu')).toBeVisible();
  await expect(program.getByText('Önceki günden')).toBeVisible();
  await expect(program).not.toContainText('owner@example.com');
  await expect(program).not.toContainText('school@example.com');
  await expect(program.locator('.calendar-event-detail small')).toHaveCount(1);
  await expect(program.getByText('Matematik kursu')).toBeVisible();
  await expect(program.getByText('Tüm gün', { exact: true })).toBeVisible();
  const eventColors = await program.locator('.calendar-event').evaluateAll(cards =>
    cards.map(card => ({
      fill: getComputedStyle(card).backgroundImage,
      edge: getComputedStyle(card).borderLeftColor,
    })),
  );
  expect(new Set(eventColors.map(color => color.fill)).size).toBe(3);
  expect(new Set(eventColors.map(color => color.edge)).size).toBe(3);
  await program.getByRole('button', { name: 'Takvimi yenile' }).click();
  await expect(program.getByText('Son yenileme')).toBeVisible();
  expect(writes).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('phase2-calendar-desktop.png'), fullPage: true });

  await program.getByRole('button', { name: 'Bağlantı ayarları' }).click();
  const settings = page.locator('.google-calendar-settings');
  await expect(settings.getByText('Bağlı · Yalnız okuma')).toBeVisible();
  await settings.getByRole('checkbox', { name: /Okul/ }).check();
  await settings.getByRole('button', { name: 'Seçimi kaydet' }).click();
  await expect(settings.getByText('Takvim seçimi kaydedildi.')).toBeVisible();
  expect(selected).toEqual(['owner@example.com', 'school@example.com']);
  await settings.getByRole('button', { name: 'Bağlantıyı kes' }).click();
  await expect(settings.getByRole('button', { name: 'Google Takvim’i bağla' })).toBeVisible();
  expect(writes).toBe(0);

  const nav = page.getByRole('navigation', { name: 'Ana gezinme' });
  await nav.getByRole('button', { name: 'Denemelerim' }).click();
  await expect(page.getByRole('heading', { name: 'Denemelerini birlikte oku.' })).toBeVisible();
  await nav.getByRole('button', { name: 'Çalışma İstatistikleri' }).click();
  await expect(page.getByRole('heading', { name: 'Odaklanma süresi grafiği' })).toBeVisible();
  await nav.getByRole('button', { name: 'Günlüğüm' }).click();
  await expect(page.getByRole('heading', { name: 'Bugünü kendi sözlerinle anlat.' })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath('phase2-journal-mobile.png'), fullPage: true });
});



