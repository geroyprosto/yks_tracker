import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfiguration } from './auth';
import { ApiError } from './http';

type ClassroomRegistration = {
  email: string;
  password: string;
  name: string;
  first_name: string;
  last_name: string;
  role: 'teacher' | 'student';
  invite_token: string | null;
};

/** New applicants use a password immediately and wait for their reviewer. */
export async function registerWithoutEmail(client: SupabaseClient, request: Request, input: ClassroomRegistration) {
  const config = getConfiguration();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secret) throw new ApiError(503, 'SETUP_REQUIRED', 'Kayıt henüz yapılandırılmamış.');
  const service = createClient(config.url, secret, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });

  const digest = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
  const forwarded = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim();
  const limit = await service.rpc('classroom_registration_allowed', {
    ip_digest: ip && ip.length <= 100 ? digest(`ip:${ip}`) : null,
    email_digest: digest(`email:${input.email}`),
  });
  if (limit.error) throw new ApiError(503, 'REGISTRATION_UNAVAILABLE', 'Başvuru şu anda alınamıyor. Biraz sonra yeniden dene.');
  if (!limit.data) throw new ApiError(429, 'RATE_LIMITED', 'Çok sayıda kayıt denemesi yapıldı. 15 dakika sonra yeniden dene.');

  const created = await service.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      name: input.name,
      first_name: input.first_name,
      last_name: input.last_name,
      requested_role: input.role,
      invite_token: input.invite_token,
    },
  });
  if (created.error || !created.data.user) {
    throw new ApiError(400, 'REGISTRATION_FAILED', 'Kayıt tamamlanamadı. Bilgileri kontrol edip yeniden dene. Bu adresle hesabın varsa giriş yap.');
  }
  const signedIn = await client.auth.signInWithPassword({ email: input.email, password: input.password });
  if (signedIn.error || signedIn.data.user?.id !== created.data.user.id) {
    throw new ApiError(503, 'APPLICATION_FAILED', 'Hesap oluşturuldu; giriş yaparak başvurunu tamamla.');
  }

  const application = await client.rpc('classroom_apply', {
    display_name: input.name,
    requested_role: input.role,
    invite_token: input.invite_token,
  });
  if (application.error) throw new ApiError(503, 'APPLICATION_FAILED', 'Hesap oluşturuldu; giriş yaparak başvurunu tamamla.');
  const identity = await client.rpc('classroom_identity');
  if (identity.error || !identity.data) throw new ApiError(503, 'APPLICATION_FAILED', 'Hesap oluşturuldu; giriş yaparak başvurunu tamamla.');
  return identity.data as { role: 'teacher' | 'student'; status: string };
}
