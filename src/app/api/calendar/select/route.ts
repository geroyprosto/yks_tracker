import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { calendarOwnerId, getCalendarConnection, updateCalendarSelection } from '@/lib/server/google-calendar-store';
import { listGoogleCalendars, refreshCalendarAccess } from '@/lib/server/google-calendar';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const userId = await calendarOwnerId();
    const connection = await getCalendarConnection(userId);
    if (!connection) throw new ApiError(409, 'CALENDAR_NOT_CONNECTED', 'Önce Google Takvim bağlantısını kurun.');
    const body = await readJson(request, 8192);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !('calendarIds' in body)
      || !Array.isArray(body.calendarIds) || body.calendarIds.length > 50
      || body.calendarIds.some(id => typeof id !== 'string' || id.length > 1024))
      throw new ApiError(400, 'INVALID_INPUT', 'Geçerli takvim seçimi gerekli.');
    const ids = [...new Set(body.calendarIds as string[])];
    const token = await refreshCalendarAccess(connection);
    const available = new Set((await listGoogleCalendars(token)).map(calendar => calendar.id));
    if (ids.some(id => !available.has(id))) throw new ApiError(400, 'INVALID_CALENDAR', 'Seçilen takvimlerden biri artık erişilebilir değil.');
    await updateCalendarSelection(userId, ids);
    return json({ ok: true, selectedCalendarIds: ids });
  } catch (error) { return errorResponse(error); }
}
