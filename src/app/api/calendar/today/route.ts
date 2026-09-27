import { errorResponse, json } from '@/lib/server/http';
import { calendarUserId, getCalendarConnection, getGoogleConfiguration,
  markCalendarSuccess } from '@/lib/server/google-calendar-store';
import { listGoogleCalendars, listTodayEvents, refreshCalendarAccess } from '@/lib/server/google-calendar';
import { localDate } from '@/lib/ui';
import type { CalendarToday } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';
export async function GET() {
  const timezone = 'Europe/Istanbul';
  const date = localDate(new Date(), timezone);
  if (!getGoogleConfiguration()) return json({
    connected: false, date, timezone, events: [], refreshedAt: null,
  } satisfies CalendarToday);
  try {
    const userId = await calendarUserId();
    const connection = await getCalendarConnection(userId);
    if (!connection) return json({ connected: false, date, timezone, events: [], refreshedAt: null } satisfies CalendarToday);
    const token = await refreshCalendarAccess(connection);
    const calendars = await listGoogleCalendars(token);
    const events = await listTodayEvents(token, calendars, connection.selected_calendar_ids, date, timezone);
    const refreshedAt = new Date().toISOString();
    await markCalendarSuccess(userId);
    return json({ connected: true, date, timezone, events, refreshedAt } satisfies CalendarToday);
  } catch (error) { return errorResponse(error); }
}
