import {expect, test} from '@playwright/test';
import {emptyState, type AppState} from '../../src/lib/domain/types';

test('Today cards keep the requested order without horizontal overflow', async ({page}) => {
  const now = '2026-09-24T09:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  const state: AppState = {...emptyState(true), authenticated: true, server_now: now};
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/calendar/today', route => route.fulfill({json: {
    connected: true, date: '2026-09-24', timezone: 'Europe/Istanbul', refreshedAt: now,
    events: [{id: 'event-1', calendarId: 'primary', calendarName: 'private@example.com',
      title: 'Matematik', start: now, end: '2026-09-24T10:00:00.000Z', allDay: false,
      htmlLink: null, color: '#2952a3', continuesFromPreviousDay: false, continuesIntoNextDay: false}],
  }}));
  await page.goto('/');

  const left = page.locator('.today-primary-grid > .column').first();
  const right = page.locator('.today-primary-grid > .column').last();
  await expect(left.locator('.tasks-summary-card')).toBeVisible();
  await expect(left.locator('.today-rhythm-card')).toBeVisible();
  await expect(left.locator('.today-practice-card')).toBeVisible();
  await expect(right.locator('.calendar-program-card')).toBeVisible();
  await expect(right.locator('.yks-countdown-card')).toBeVisible();
  await expect(page.locator('.monthly-exam-chart-card')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Zamanını nasıl paylaştın?'})).toHaveCount(0);
  await expect(left.getByRole('heading', {name: 'Soru ve testlerin'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Konu pusulası'})).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Deneme gelişimin', exact: true})).toHaveCount(0);
  await expect(page.getByText('private@example.com')).toHaveCount(0);

  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({width, height: 900});
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const rect = element.getBoundingClientRect();
        return {top: rect.top + scrollY, bottom: rect.bottom + scrollY};
      };
      return {
        rhythm: box('.today-rhythm-card'), insights: box('.today-practice-card'),
        calendar: box('.calendar-program-card'), countdown: box('.yks-countdown-card'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(boxes.insights.top, `${width}px: study insights follow rhythm`).toBeGreaterThanOrEqual(boxes.rhythm.bottom);
    expect(boxes.countdown.top, `${width}px: countdown follows calendar`).toBeGreaterThanOrEqual(boxes.calendar.bottom);
    expect(boxes.overflow, `${width}px: horizontal overflow`).toBeLessThanOrEqual(1);
  }
});


