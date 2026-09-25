import { NextResponse } from 'next/server';
import { sameOrigin, errorResponse } from '@/lib/server/http';
import { calendarOwnerId, requireGoogleConfiguration } from '@/lib/server/google-calendar-store';
import { authorizationUrl, newOAuthTransaction } from '@/lib/server/google-calendar';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    requireGoogleConfiguration();
    await calendarOwnerId();
    const { state, verifier, challenge } = newOAuthTransaction();
    const response = NextResponse.redirect(authorizationUrl(state, challenge), { status: 303 });
    const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const, path: '/api/calendar/callback', maxAge: 600 };
    response.cookies.set('yks_calendar_state', state, options);
    response.cookies.set('yks_calendar_verifier', verifier, options);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return response;
  } catch (error) { return errorResponse(error); }
}
