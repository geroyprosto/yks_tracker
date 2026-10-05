import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getConfiguration } from './auth';
import { ApiError } from './http';
import { databaseError } from './service';

export const accountDeletionSchema = z.object({
  id: z.uuid(),
  confirmation_email: z.string().min(3).max(320),
}).strict();

type Actor = { user: { id: string }; account: { id: string; role: string; status: string } | null };
const deletionPlanSchema = z.object({
  exists: z.boolean(),
  emails: z.array(z.string().min(3).max(320)),
  storage: z.array(z.object({ bucket_id: z.string().min(1).max(100), name: z.string().min(1).max(4096) })),
});
type Dependencies = { service: SupabaseClient; secret: string };

function deletionDependencies(): Dependencies {
  const config = getConfiguration();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secret) throw new ApiError(503, 'SETUP_REQUIRED', 'Hesap silme henüz yapılandırılmamış.');
  return { secret, service: createClient(config.url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }) };
}

export function requireAccountDeletionAdmin(actor: Actor, targetId: string) {
  if (!actor.account || actor.account.id !== actor.user.id || actor.account.role !== 'admin' || actor.account.status !== 'approved') {
    throw new ApiError(403, 'ADMIN_REQUIRED', 'Bu işlem yalnızca yönetici tarafından yapılabilir.');
  }
  if (actor.user.id === targetId) throw new ApiError(403, 'ACCOUNT_DELETE_PROTECTED', 'Kendi hesabınızı veya yönetici hesaplarını silemezsiniz.');
}

/** The Auth delete and all database cleanup commit together through the Auth trigger. */
export async function deleteClassroomAccount(actor: Actor, input: unknown, dependencies?: Dependencies) {
  const parsed = accountDeletionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', 'Silinecek kişinin bilgilerini kontrol edin.');
  requireAccountDeletionAdmin(actor, parsed.data.id);
  const { service, secret } = dependencies ?? deletionDependencies();
  const prepare = async (digests: string[] = []) => {
    const { data, error } = await service.rpc('classroom_account_delete_prepare', {
      p_actor_id: actor.user.id,
      p_target_id: parsed.data.id,
      p_confirmation_email: parsed.data.confirmation_email,
      p_registration_email_digests: digests,
    });
    if (error) databaseError(error);
    const plan = deletionPlanSchema.safeParse(data);
    if (!plan.success) {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Hesap silme bilgileri alınamadı.');
    }
    return plan.data;
  };
  const initial = await prepare();
  if (!initial.exists) return { deleted: true };
  const digests = [...new Set(initial.emails.map(email =>
    createHmac('sha256', secret).update(`email:${email.trim().toLowerCase()}`).digest('hex')))];
  const plan = await prepare(digests);
  if (!plan.exists) return { deleted: true };
  const buckets = new Map<string, string[]>();
  for (const object of plan.storage) {
    const paths = buckets.get(object.bucket_id) ?? [];
    paths.push(object.name);
    buckets.set(object.bucket_id, paths);
  }
  for (const [bucket, paths] of buckets) {
    for (let start = 0; start < paths.length; start += 100) {
      const { error } = await service.storage.from(bucket).remove(paths.slice(start, start + 100));
      if (error) throw new ApiError(503, 'ACCOUNT_DELETE_FILES_FAILED', 'Dosyalar silinemedi. Hesabın erişimi durduruldu; silmeyi yeniden deneyin.');
    }
  }
  // Recheck after Storage API removal. Never delete only storage metadata via SQL.
  const remaining = await prepare(digests);
  if (!remaining.exists) return { deleted: true };
  if (remaining.storage.length) throw new ApiError(409, 'ACCOUNT_DELETE_FILES_FAILED', 'Hesaba ait dosyalar hâlâ mevcut. Silmeyi yeniden deneyin.');
  const { error } = await service.auth.admin.deleteUser(parsed.data.id, false);
  if (error) {
    // A lost response can follow a committed delete; retries remain safe.
    const retry = await prepare(digests);
    if (retry.exists) throw new ApiError(503, 'ACCOUNT_DELETE_FAILED', 'Hesap silinemedi. Hesabın erişimi durduruldu; silmeyi yeniden deneyin.');
  }
  const verified = await prepare();
  if (verified.exists) throw new ApiError(503, 'ACCOUNT_DELETE_FAILED', 'Hesap silme tamamlanamadı. Silmeyi yeniden deneyin.');
  return { deleted: true };
}
