export type CalendarChoice = { id: string; name: string; primary: boolean; color: string | null };
export type CalendarEvent = {
  id: string; calendarId: string; calendarName: string; title: string;
  start: string; end: string; allDay: boolean; continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean; htmlLink: string | null; color?: string | null;
};
export type CalendarStatus = {
  configured: boolean; connected: boolean; calendars: CalendarChoice[];
  selectedCalendarIds: string[]; lastSuccessAt: string | null;
};
export type CalendarToday = {
  connected: boolean; date: string; timezone: string;
  events: CalendarEvent[]; refreshedAt: string | null;
};
export type GoogleEvent = {
  id?: string; summary?: string; status?: string; htmlLink?: string; colorId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function nextDate(date: string): string {
  if (!datePattern.test(date)) throw new Error('Invalid date');
  const next = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(next.getTime())) throw new Error('Invalid date');
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// Solve local midnight against the timezone's actual offset (including DST).
export function zonedMidnight(date: string, timezone: string): Date {
  if (!datePattern.test(date)) throw new Error('Invalid date');
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(target)) throw new Error('Invalid date');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let result = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(result)).map(part => [part.type, part.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    const change = target - local;
    result += change;
    if (change === 0) break;
  }
  return new Date(result);
}

export function normalizeCalendarEvents(
  calendarId: string, calendarName: string, source: GoogleEvent[],
  date: string, dayStart: Date, dayEnd: Date,
  calendarColor: string | null = null, eventColors: ReadonlyMap<string, string> = new Map(),
): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  for (const item of source) {
    if (item.status === 'cancelled' || !item.id || !item.start || !item.end) continue;
    const allDay = Boolean(item.start.date && item.end.date);
    const start = allDay ? Date.parse(`${item.start.date}T00:00:00Z`) : Date.parse(item.start.dateTime ?? '');
    const end = allDay ? Date.parse(`${item.end.date}T00:00:00Z`) : Date.parse(item.end.dateTime ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const dayStartValue = allDay ? Date.parse(date + 'T00:00:00Z') : dayStart.getTime();
    const dayEndValue = allDay ? Date.parse(nextDate(date) + 'T00:00:00Z') : dayEnd.getTime();
    // All-day dates are local calendar dates, so use the requested day's local label below instead.
    if (end <= dayStartValue || start >= dayEndValue) continue;
    const url = item.htmlLink ? safeGoogleCalendarLink(item.htmlLink) : null;
    result.push({
      id: item.id, calendarId, calendarName,
      title: (item.summary?.trim() || 'Başlıksız etkinlik').slice(0, 240),
      start: allDay ? item.start.date! : new Date(start).toISOString(),
      end: allDay ? item.end.date! : new Date(end).toISOString(),
      allDay,
      continuesFromPreviousDay: start < dayStartValue,
      continuesIntoNextDay: end > dayEndValue,
      htmlLink: url,
      color: safeHexColor(eventColors.get(item.colorId ?? '')) ?? safeHexColor(calendarColor),
    });
  }
  return result;
}

export function safeHexColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

export function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.sort((a, b) => Number(b.allDay) - Number(a.allDay)
    || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'tr'));
}

function safeGoogleCalendarLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'calendar.google.com' || url.hostname === 'www.google.com')
      ? url.href : null;
  } catch { return null; }
}

