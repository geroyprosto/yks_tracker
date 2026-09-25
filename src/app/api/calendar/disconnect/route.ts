import { errorResponse, json, sameOrigin } from '@/lib/server/http';
import { calendarOwnerId, deleteCalendarConnection, getCalendarConnection } from '@/lib/server/google-calendar-store';
import { revokeCalendarToken } from '@/lib/server/google-calendar';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const userId = await calendarOwnerId();
    const connection = await getCalendarConnection(userId);
    const revoked = connection ? await revokeCalendarToken(connection) : true;
    if (connection) await deleteCalendarConnection(userId);
    return json({ ok: true, revoked });
  } catch (error) { return errorResponse(error); }
}
