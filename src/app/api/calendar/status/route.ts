import { errorResponse, json } from '@/lib/server/http';
import { calendarUserId, getCalendarConnection, getGoogleConfiguration,
  markCalendarSuccess } from '@/lib/server/google-calendar-store';
import { listGoogleCalendars, refreshCalendarAccess } from '@/lib/server/google-calendar';
import type { CalendarStatus } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';
export async function GET() {
  if (!getGoogleConfiguration()) return json({
    configured: false, connected: false, calendars: [], selectedCalendarIds: [], lastSuccessAt: null,
  } satisfies CalendarStatus);
  try {
    const userId = await calendarUserId();
    const connection = await getCalendarConnection(userId);
    if (!connection) return json({
      configured: true, connected: false, calendars: [], selectedCalendarIds: [], lastSuccessAt: null,
    } satisfies CalendarStatus);
    const token = await refreshCalendarAccess(connection);
    const calendars = await listGoogleCalendars(token);
    await markCalendarSuccess(userId);
    return json({ configured: true, connected: true, calendars,
      selectedCalendarIds: connection.selected_calendar_ids, lastSuccessAt: new Date().toISOString(),
    } satisfies CalendarStatus);
  } catch (error) { return errorResponse(error); }
}
