import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { ApiError } from '../src/lib/server/http';
import { decryptRefreshToken, encryptRefreshToken } from '../src/lib/server/google-calendar-store';
import { authorizationUrl, exchangeAuthorizationCode, GOOGLE_SCOPES, listGoogleCalendars,
  listTodayEvents, newOAuthTransaction } from '../src/lib/server/google-calendar';

function setConfig() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
  process.env.ALLOWED_USER_EMAIL = 'owner@example.com';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.APP_ORIGIN = 'https://app.example.com';
}

test('OAuth uses a random state, S256 PKCE, offline access and only two read scopes', () => {
  setConfig();
  const { state, verifier, challenge } = newOAuthTransaction();
  const url = authorizationUrl(state, challenge);
  assert.equal(url.hostname, 'accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/api/calendar/callback');
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.deepEqual(url.searchParams.get('scope')?.split(' '), [...GOOGLE_SCOPES]);
  assert.ok(!url.searchParams.get('scope')?.includes('calendar.events '));
});

test('refresh token encryption authenticates ciphertext and rejects the wrong key', () => {
  const key = randomBytes(32);
  const ciphertext = encryptRefreshToken('sensitive-refresh-token', key);
  assert.ok(!ciphertext.includes('sensitive-refresh-token'));
  assert.equal(decryptRefreshToken(ciphertext, key), 'sensitive-refresh-token');
  assert.throws(() => decryptRefreshToken(ciphertext, randomBytes(32)), ApiError);
});

test('OAuth rejects missing and extra consent scopes', async () => {
  setConfig();
  const original = globalThis.fetch;
  let grantedScope: string = GOOGLE_SCOPES[0];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new URLSearchParams(init?.body as string).get('code_verifier'), 'verifier');
    return Response.json({ access_token: 'access', refresh_token: 'refresh', scope: grantedScope });
  }) as typeof fetch;
  try {
    await assert.rejects(exchangeAuthorizationCode('code', 'verifier'),
      (error: unknown) => error instanceof ApiError && error.code === 'CALENDAR_SCOPE_REQUIRED');
    grantedScope = [...GOOGLE_SCOPES, 'https://www.googleapis.com/auth/calendar'].join(' ');
    await assert.rejects(exchangeAuthorizationCode('code', 'verifier'),
      (error: unknown) => error instanceof ApiError && error.code === 'CALENDAR_SCOPE_REQUIRED');
  } finally { globalThis.fetch = original; }
});

test('calendar and event pages are all loaded, recurring instances expanded, cancelled events ignored', async () => {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.pathname.endsWith('/calendarList')) return Response.json(url.searchParams.has('pageToken')
      ? { items: [{ id: 'school@example.com', summary: 'Okul' }] }
      : { items: [{ id: 'owner@example.com', summary: 'Kişisel', primary: true }], nextPageToken: 'calendar-page-2' });
    return Response.json(url.searchParams.has('pageToken')
      ? { items: [{ id: 'later', summary: 'Ders', start: { dateTime: '2026-09-24T13:00:00+03:00' }, end: { dateTime: '2026-09-24T14:00:00+03:00' } }] }
      : { items: [
        { id: 'recurring-instance', summary: 'Tekrarlı kurs', start: { dateTime: '2026-09-24T09:00:00+03:00' }, end: { dateTime: '2026-09-24T10:00:00+03:00' } },
        { id: 'cancelled', status: 'cancelled', summary: 'İptal', start: { dateTime: '2026-09-24T10:00:00+03:00' }, end: { dateTime: '2026-09-24T11:00:00+03:00' } },
      ], nextPageToken: 'event-page-2' });
  }) as typeof fetch;
  try {
    const calendars = await listGoogleCalendars('access');
    assert.equal(calendars.length, 2);
    const events = await listTodayEvents('access', calendars, ['owner@example.com'], '2026-09-24');
    assert.deepEqual(events.map(event => event.id), ['recurring-instance', 'later']);
    const eventUrls = urls.filter(url => url.pathname.endsWith('/events'));
    assert.equal(eventUrls.length, 2);
    assert.equal(eventUrls[0].searchParams.get('singleEvents'), 'true');
    assert.equal(eventUrls[0].searchParams.get('showDeleted'), 'false');
    assert.equal(eventUrls[0].searchParams.get('timeMin'), '2026-09-23T21:00:00.000Z');
    assert.equal(eventUrls[0].searchParams.get('timeMax'), '2026-09-24T21:00:00.000Z');
    assert.equal(urls.filter(url => url.pathname.endsWith('/calendarList')).length, 2);
  } finally { globalThis.fetch = original; }
});



test('event colors use the Google palette, then the calendar color, and reject invalid palette values', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/colors')) return Response.json({ event: {
      '2': { background: '#33b679' }, '3': { background: 'url(javascript:bad)' },
    } });
    return Response.json({ items: [
      { id: 'specific', colorId: '2', start: { dateTime: '2026-09-24T09:00:00+03:00' }, end: { dateTime: '2026-09-24T10:00:00+03:00' } },
      { id: 'invalid', colorId: '3', start: { dateTime: '2026-09-24T10:00:00+03:00' }, end: { dateTime: '2026-09-24T11:00:00+03:00' } },
      { id: 'default', start: { dateTime: '2026-09-24T11:00:00+03:00' }, end: { dateTime: '2026-09-24T12:00:00+03:00' } },
    ] });
  }) as typeof fetch;
  try {
    const events = await listTodayEvents('access', [
      { id: 'owner@example.com', name: 'Kişisel', primary: true, color: '#3f51b5' },
    ], ['owner@example.com'], '2026-09-24');
    assert.deepEqual(events.map(event => event.color), ['#33b679', '#3f51b5', '#3f51b5']);
  } finally { globalThis.fetch = original; }
});