import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { calendarOwnerId, markCalendarSuccess, requireGoogleConfiguration,
  saveCalendarConnection } from '@/lib/server/google-calendar-store';
import { exchangeAuthorizationCode, listGoogleCalendars } from '@/lib/server/google-calendar';

export const dynamic = 'force-dynamic';
function matchingState(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected); const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
function returnToSettings(outcome: 'connected' | 'denied' | 'error'): NextResponse {
  const { origin } = requireGoogleConfiguration();
  const url = new URL('/', origin);
  url.searchParams.set('settings', 'connections');
  url.searchParams.set('calendar', outcome);
  const response = NextResponse.redirect(url, { status: 303 });
  const clear = { path: '/api/calendar/callback', maxAge: 0 };
  response.cookies.set('yks_calendar_state', '', clear);
  response.cookies.set('yks_calendar_verifier', '', clear);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const jar = await cookies();
    const state = jar.get('yks_calendar_state')?.value;
    const verifier = jar.get('yks_calendar_verifier')?.value;
    if (!matchingState(state, query.get('state')) || !verifier) return returnToSettings('error');
    // Clear the transaction on every outcome; a callback cannot be replayed.
    if (query.has('error')) return returnToSettings('denied');
    const code = query.get('code');
    if (!code || code.length > 4096) return returnToSettings('error');
    const userId = await calendarOwnerId();
    const { accessToken, refreshToken } = await exchangeAuthorizationCode(code, verifier);
    const calendars = await listGoogleCalendars(accessToken);
    const primary = calendars.find(calendar => calendar.primary)?.id;
    await saveCalendarConnection(userId, refreshToken, primary ? [primary] : []);
    await markCalendarSuccess(userId);
    return returnToSettings('connected');
  } catch { return returnToSettings('error'); }
}
