import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http';
import { decryptRefreshToken, getGoogleConfiguration, requireGoogleConfiguration,
  type StoredCalendarConnection } from './google-calendar-store';
import { nextDate, normalizeCalendarEvents, safeHexColor, sortCalendarEvents, zonedMidnight,
  type CalendarChoice, type CalendarEvent, type GoogleEvent } from '../google-calendar';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;
const MAX_PAGES = 100;

type TokenReply = { access_token?: string; refresh_token?: string; scope?: string; error?: string };
type CalendarListReply = { nextPageToken?: string; items?: Array<{
  id?: string; summary?: string; primary?: boolean; backgroundColor?: string; deleted?: boolean;
}> };
type EventsReply = { nextPageToken?: string; items?: GoogleEvent[] };
type ColorsReply = { event?: Record<string, { background?: string }> };

export function newOAuthTransaction() {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { state, verifier, challenge };
}

export function matchingCalendarUser(startedFor: string | undefined, currentUser: string): boolean {
  if (!startedFor) return false;
  const a = Buffer.from(startedFor); const b = Buffer.from(currentUser);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizationUrl(state: string, challenge: string): URL {
  const config = requireGoogleConfiguration();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url;
}

async function googleJson<T>(url: URL | string, init: RequestInit, failureCode: string): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(12000) }); }
  catch { throw new ApiError(503, 'CALENDAR_OFFLINE', 'Google Takvim şu anda yanıt vermiyor. Yeniden deneyin.'); }
  if (!response.ok) {
    if (response.status === 401) throw new ApiError(409, 'CALENDAR_RECONNECT_REQUIRED', 'Google Takvim erişimi yenilenemedi. Yeniden bağlayın.');
    if (response.status === 403) throw new ApiError(403, 'CALENDAR_SCOPE_REQUIRED', 'Google Takvim okuma izni eksik. Yeniden bağlayın.');
    throw new ApiError(503, failureCode, 'Google Takvim verileri şu anda alınamadı.');
  }
  try { return await response.json() as T; }
  catch { throw new ApiError(503, failureCode, 'Google Takvim geçerli yanıt vermedi.'); }
}

export async function exchangeAuthorizationCode(code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string }> {
  const config = requireGoogleConfiguration();
  const data = await googleJson<TokenReply>('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  }, 'CALENDAR_AUTH_FAILED');
  if (!data.access_token || !data.refresh_token) throw new ApiError(409, 'CALENDAR_AUTH_FAILED', 'Google yenileme izni vermedi. Bağlantıyı yeniden kurun.');
  const granted = new Set(data.scope?.split(/\s+/) ?? []);
  if (granted.size !== GOOGLE_SCOPES.length || !GOOGLE_SCOPES.every(scope => granted.has(scope)))
    throw new ApiError(403, 'CALENDAR_SCOPE_REQUIRED', 'Takvimleri ve etkinlikleri okumak için iki izni de vermelisiniz.');
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function refreshCalendarAccess(connection: StoredCalendarConnection): Promise<string> {
  const config = requireGoogleConfiguration();
  const token = decryptRefreshToken(connection.refresh_token_ciphertext, config.key);
  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        refresh_token: token, grant_type: 'refresh_token' }), cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
  } catch { throw new ApiError(503, 'CALENDAR_OFFLINE', 'Google Takvim şu anda yanıt vermiyor.'); }
  if (!response.ok) {
    let error = '';
    try { error = (await response.json() as TokenReply).error ?? ''; } catch { /* No raw error body or token in logs. */ }
    if (error === 'invalid_grant') throw new ApiError(409, 'CALENDAR_RECONNECT_REQUIRED', 'Google Takvim izni süresi doldu veya kaldırıldı. Yeniden bağlayın.');
    throw new ApiError(503, 'CALENDAR_AUTH_FAILED', 'Google Takvim erişimi yenilenemedi.');
  }
  const data = await response.json() as TokenReply;
  if (!data.access_token) throw new ApiError(503, 'CALENDAR_AUTH_FAILED', 'Google erişim belirteci vermedi.');
  return data.access_token;
}

export async function revokeCalendarToken(connection: StoredCalendarConnection): Promise<boolean> {
  const config = getGoogleConfiguration();
  if (!config) return false;
  try {
    const token = decryptRefreshToken(connection.refresh_token_ciphertext, config.key);
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }), cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
    // 400 means the grant was already invalid; local credentials can still be removed.
    return response.ok || response.status === 400;
  } catch { return false; }
}

async function pagedGoogleItems<T>(base: URL, accessToken: string, errorCode: string): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(base);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await googleJson<{ items?: T[]; nextPageToken?: string }>(url,
      { headers: { Authorization: `Bearer ${accessToken}` } }, errorCode);
    if (Array.isArray(data.items)) items.push(...data.items);
    if (!data.nextPageToken) return items;
    if (seen.has(data.nextPageToken)) break;
    seen.add(data.nextPageToken);
    pageToken = data.nextPageToken;
  }
  throw new ApiError(503, 'CALENDAR_PAGE_LIMIT', 'Takvim verileri çok fazla sayfaya bölündü. Daha sonra yeniden deneyin.');
}

export async function listGoogleCalendars(accessToken: string): Promise<CalendarChoice[]> {
  const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
  url.searchParams.set('maxResults', '250');
  url.searchParams.set('minAccessRole', 'reader');
  const entries = await pagedGoogleItems<NonNullable<CalendarListReply['items']>[number]>(url, accessToken, 'CALENDAR_LIST_FAILED');
  return entries.filter(item => item.id && !item.deleted).map(item => ({
    id: item.id!, name: item.summary?.trim() || 'Adsız takvim', primary: item.primary === true,
    color: safeHexColor(item.backgroundColor),
  }));
}

async function listGoogleEventColors(accessToken: string): Promise<ReadonlyMap<string, string>> {
  try {
    const palette = await googleJson<ColorsReply>('https://www.googleapis.com/calendar/v3/colors',
      { headers: { Authorization: 'Bearer ' + accessToken } }, 'CALENDAR_COLORS_FAILED');
    return new Map(Object.entries(palette.event ?? {}).flatMap(([id, definition]) => {
      const color = safeHexColor(definition?.background);
      return color ? [[id, color] as const] : [];
    }));
  } catch {
    // A palette failure must not hide the schedule; use each calendar's default color.
    return new Map();
  }
}

export async function listTodayEvents(accessToken: string, calendars: CalendarChoice[],
  selectedIds: string[], date: string, timezone = 'Europe/Istanbul'): Promise<CalendarEvent[]> {
  const start = zonedMidnight(date, timezone);
  const end = zonedMidnight(nextDate(date), timezone);
  const chosen = calendars.filter(calendar => selectedIds.includes(calendar.id)
    || (calendar.primary && selectedIds.includes('primary')));
  if (chosen.length === 0) return [];
  const [eventColors, groups] = await Promise.all([
    listGoogleEventColors(accessToken),
    Promise.all(chosen.map(async calendar => {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`);
      url.searchParams.set('timeMin', start.toISOString());
      url.searchParams.set('timeMax', end.toISOString());
      url.searchParams.set('timeZone', timezone);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'false');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '250');
      const events = await pagedGoogleItems<NonNullable<EventsReply['items']>[number]>(url, accessToken, 'CALENDAR_EVENTS_FAILED');
      return { calendar, events };
    })),
  ]);
  return sortCalendarEvents(groups.flatMap(({ calendar, events }) =>
    normalizeCalendarEvents(calendar.id, calendar.name, events, date, start, end, calendar.color, eventColors)));
}


