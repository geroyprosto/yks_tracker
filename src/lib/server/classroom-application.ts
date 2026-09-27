import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ApiError } from './http';
import { databaseError } from './service';

export type AccountIdentity = {
  id: string; name: string; email: string;
  role: 'admin' | 'teacher' | 'student'; status: string; teacher_id: string | null;
};

/** An auth callback completes a first application, never resubmits a rejection
 * or requests a class transfer. Those decisions require an explicit form POST.
 * Metadata suggests the requested role only; the DB owns approval and access. */
export async function ensureClassroomApplication(client: Pick<SupabaseClient, 'rpc'>, user: Pick<User, 'email_confirmed_at' | 'user_metadata'>): Promise<AccountIdentity | null> {
  const identity = await client.rpc('classroom_identity');
  if (identity.error) databaseError(identity.error);
  if (identity.data) return identity.data as AccountIdentity;
  if (!user.email_confirmed_at) throw new ApiError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Önce e-posta adresinizi doğrulayın.');
  const metadata = user.user_metadata ?? {};
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
  const invite = typeof metadata.invite_token === 'string' && metadata.invite_token ? metadata.invite_token : null;
  if (invite && !/^[a-f0-9]{64}$/.test(invite)) throw new ApiError(410, 'INVITE_INVALID', 'Davet iptal edilmiş veya süresi dolmuş.');
  const applied = await client.rpc('classroom_apply', {
    display_name: name.length >= 2 && name.length <= 100 ? name : 'Öğrenci',
    requested_role: metadata.requested_role === 'teacher' ? 'teacher' : 'student',
    invite_token: invite,
  });
  if (applied.error) databaseError(applied.error);
  const refreshed = await client.rpc('classroom_identity');
  if (refreshed.error) databaseError(refreshed.error);
  return refreshed.data as AccountIdentity | null;
}
