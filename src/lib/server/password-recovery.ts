import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ApiError } from './http';

type AuthClient = Pick<SupabaseClient, 'auth'>;
export const recoveryEmailSchema = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) }).strict();
export const recoveryPasswordSchema = z.object({ password: z.string().min(10).max(128) }).strict();
export const recoveryNotice = 'Bu e-posta adresiyle bir hesabın varsa şifre yenileme bağlantısı gönderilir. Gelen kutunu ve spam klasörünü kontrol et.';

/** Redirects must use a trusted deployment URL, never a request Host header. */
export function authOrigin() {
  try {
    const url = new URL(process.env.APP_ORIGIN ?? '');
    const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin');
    return url.origin;
  } catch {
    throw new ApiError(503, 'SETUP_REQUIRED', 'Uygulamanın e-posta bağlantı adresi henüz yapılandırılmamış.');
  }
}

// This bounded process-local guard only supplements Supabase Auth's shared limits.
export function createRecoveryLimiter() {
  const attempts = new Map<string, { count: number; until: number }>();
  return (email: string, now = Date.now()) => {
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    const bucket = attempts.get(key);
    if (bucket && bucket.count >= 3) return false;
    if (!bucket && attempts.size >= 1000) return false;
    attempts.set(key, { count: (bucket?.count ?? 0) + 1, until: bucket?.until ?? now + 15 * 60_000 });
    return true;
  };
}

export async function requestPasswordRecovery(client: AuthClient, email: string, origin: string) {
  try {
    // Provider errors, unknown accounts and throttling have the same public response.
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?type=recovery` });
    if (error) console.error('Password recovery request failed', { code: error.code ?? 'unknown', status: error.status ?? null });
  } catch {
    // Do not expose account existence or provider details through error messages.
    console.error('Password recovery request failed', { code: 'unexpected_error' });
  }
  return { ok: true, message: recoveryNotice };
}

export async function recoveryUser(client: AuthClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at) throw new ApiError(401, 'RECOVERY_EXPIRED', 'Şifre yenileme bağlantısı geçersiz veya süresi dolmuş. Yeni bağlantı iste.');
  return data.user;
}

export async function updateRecoveredPassword(client: AuthClient, password: string) {
  await recoveryUser(client);
  const { error } = await client.auth.updateUser({ password });
  if (error) {
    if (error.code === 'same_password') throw new ApiError(400, 'SAME_PASSWORD', 'Önceki şifrenden farklı bir şifre seç.');
    if (error.code === 'weak_password') throw new ApiError(400, 'WEAK_PASSWORD', 'Daha güçlü bir şifre seç; harf, sayı ve sembol kullan.');
    if (error.code === 'reauthentication_needed' || error.status === 401 || error.status === 403) throw new ApiError(401, 'RECOVERY_EXPIRED', 'Yeni bir şifre yenileme bağlantısı isteyip yeniden dene.');
    throw new ApiError(400, 'PASSWORD_UPDATE_FAILED', 'Şifre yenilenemedi. Bir süre sonra yeniden dene.');
  }
  // The password is already changed: a logout outage must not look like a failed reset.
  let signedOut = false;
  try { signedOut = !(await client.auth.signOut({ scope: 'global' })).error; } catch {}
  return { ok: true, signedOut, redirect: '/' };
}

export async function verifyAuthCallback(client: AuthClient, url: URL) {
  const query = url.searchParams;
  const type = query.get('type');
  const code = query.get('code');
  const tokenHash = query.get('token_hash');
  if (query.has('error') || query.has('error_code') || ['type', 'code', 'token_hash'].some(key => query.getAll(key).length > 1) ||
      (type !== null && type !== 'email' && type !== 'recovery') || !Boolean(code || tokenHash) || Boolean(code && tokenHash)) {
    throw new ApiError(400, 'INVALID_AUTH_CALLBACK', 'Doğrulama bağlantısı geçerli değil.');
  }
  let recovery = type === 'recovery';
  if (code) {
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error) throw new ApiError(401, 'INVALID_AUTH_CALLBACK', 'Doğrulama bağlantısının süresi dolmuş.');
    // Supabase's runtime response also identifies PKCE recovery in its verifier.
    recovery ||= 'redirectType' in result.data && result.data.redirectType === 'recovery';
  } else {
    const result = await client.auth.verifyOtp({ token_hash: tokenHash!, type: recovery ? 'recovery' : 'email' });
    if (result.error) throw new ApiError(401, 'INVALID_AUTH_CALLBACK', 'Doğrulama bağlantısının süresi dolmuş.');
  }
  const user = await recoveryUser(client);
  return { user, recovery };
}
