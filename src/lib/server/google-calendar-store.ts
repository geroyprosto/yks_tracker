import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from './http';
import { getConfiguration, requireOwner } from './auth';

export type StoredCalendarConnection = {
  user_id: string; refresh_token_ciphertext: string; selected_calendar_ids: string[];
  connected_at: string; updated_at: string; last_success_at: string | null;
};

export function getGoogleConfiguration() {
  const supabase = getConfiguration();
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (!supabase || !clientId || !clientSecret || !secretKey || !encryptionKey || !appOrigin
      || /REPLACE|your-app|YOUR_/i.test(clientId + clientSecret + secretKey + encryptionKey + appOrigin)) return null;
  let key: Buffer;
  try { key = Buffer.from(encryptionKey, 'base64'); } catch { return null; }
  if (key.length !== 32) return null;
  let origin: string;
  try {
    const url = new URL(appOrigin);
    if (url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return null;
    origin = url.origin;
  } catch { return null; }
  return { supabase, clientId, clientSecret, secretKey, key, origin,
    redirectUri: `${origin}/api/calendar/callback` };
}

export function requireGoogleConfiguration() {
  const config = getGoogleConfiguration();
  if (!config) throw new ApiError(503, 'CALENDAR_SETUP_REQUIRED', 'Google Takvim bağlantısı için sunucu kurulumu gerekli.');
  return config;
}

function calendarDb() {
  const config = requireGoogleConfiguration();
  return createClient(config.supabase.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function calendarOwnerId(): Promise<string> {
  const client = await requireOwner();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Devam etmek için giriş yapın.');
  return data.user.id;
}

export function encryptRefreshToken(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptRefreshToken(ciphertext: string, key: Buffer): string {
  const [version, ivPart, tagPart, dataPart] = ciphertext.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) throw new ApiError(503, 'CALENDAR_TOKEN_ERROR', 'Takvim bağlantısı yeniden kurulmalı.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new ApiError(503, 'CALENDAR_TOKEN_ERROR', 'Takvim bağlantısı yeniden kurulmalı.'); }
}

export async function getCalendarConnection(userId: string): Promise<StoredCalendarConnection | null> {
  const { data, error } = await calendarDb().from('google_calendar_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new ApiError(503, 'CALENDAR_STORAGE_ERROR', 'Takvim bağlantısı okunamadı.');
  return data as StoredCalendarConnection | null;
}

export async function saveCalendarConnection(userId: string, refreshToken: string, selectedCalendarIds: string[]): Promise<void> {
  const config = requireGoogleConfiguration();
  const { error } = await calendarDb().from('google_calendar_connections').upsert({
    user_id: userId, refresh_token_ciphertext: encryptRefreshToken(refreshToken, config.key),
    selected_calendar_ids: selectedCalendarIds, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new ApiError(503, 'CALENDAR_STORAGE_ERROR', 'Takvim bağlantısı kaydedilemedi.');
}

export async function updateCalendarSelection(userId: string, selectedCalendarIds: string[]): Promise<void> {
  const { error } = await calendarDb().from('google_calendar_connections').update({
    selected_calendar_ids: selectedCalendarIds, updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
  if (error) throw new ApiError(503, 'CALENDAR_STORAGE_ERROR', 'Takvim seçimi kaydedilemedi.');
}

export async function markCalendarSuccess(userId: string): Promise<void> {
  const { error } = await calendarDb().from('google_calendar_connections').update({
    last_success_at: new Date().toISOString(),
  }).eq('user_id', userId);
  if (error) throw new ApiError(503, 'CALENDAR_STORAGE_ERROR', 'Takvim durumu kaydedilemedi.');
}

export async function deleteCalendarConnection(userId: string): Promise<void> {
  const { error } = await calendarDb().from('google_calendar_connections').delete().eq('user_id', userId);
  if (error) throw new ApiError(503, 'CALENDAR_STORAGE_ERROR', 'Takvim bağlantısı silinemedi.');
}
