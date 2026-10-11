import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_TYPES } from '../profile-photo';
import { ApiError } from './http';

const BUCKET = 'profile-photos';
const MAX_INPUT_PIXELS = 40_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PhotoContext = {
  client: SupabaseClient;
  user: { id: string };
  account: { id: string; role: string; status: string } | null;
  demo: boolean;
};

function photoPath(context: PhotoContext, mutation = false) {
  const { user, account } = context;
  if (!user?.id || !UUID.test(user.id)) {
    throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Devam etmek için giriş yapın.');
  }
  if (!account || account.id !== user.id || account.status !== 'approved' || !['student', 'admin'].includes(account.role)) {
    throw new ApiError(403, 'STUDENT_REQUIRED', 'Profil fotoğrafı için onaylı öğrenci hesabı gerekir.');
  }
  if (context.demo) {
    if (mutation) throw new ApiError(403, 'DEMO_INTEGRATION_DISABLED', 'Demo ortamında profil fotoğrafı kaydedilemez.');
    throw new ApiError(404, 'PHOTO_NOT_FOUND', 'Henüz profil fotoğrafı eklenmemiş.');
  }
  // Never accept an account ID, filename or storage path from the request.
  return `${user.id}/avatar.webp`;
}

export async function readProfilePhoto(request: Request): Promise<Buffer> {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (!(PROFILE_PHOTO_TYPES as readonly string[]).includes(type)) {
    throw new ApiError(415, 'PHOTO_TYPE_UNSUPPORTED', 'JPG, PNG veya WebP formatında bir fotoğraf seçin.');
  }
  if (Number(request.headers.get('content-length')) > MAX_PROFILE_PHOTO_BYTES) {
    throw new ApiError(413, 'PHOTO_TOO_LARGE', 'Fotoğraf en fazla 4 MB olabilir.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_PHOTO', 'Fotoğraf dosyası boş veya okunamıyor.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_PROFILE_PHOTO_BYTES) {
      await reader.cancel();
      throw new ApiError(413, 'PHOTO_TOO_LARGE', 'Fotoğraf en fazla 4 MB olabilir.');
    }
    chunks.push(value);
  }
  if (!length) throw new ApiError(400, 'INVALID_PHOTO', 'Fotoğraf dosyası boş veya okunamıyor.');
  return Buffer.concat(chunks, length);
}

export async function normalizeProfilePhoto(bytes: Buffer): Promise<Buffer> {
  try {
    const photo = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' });
    const metadata = await photo.metadata();
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) {
      throw new Error('Unsupported photo format');
    }
    // Re-encoding strips EXIF/GPS and other metadata; autoOrient is applied first.
    return await photo.autoOrient().resize(512, 512, { fit: 'cover', position: 'centre' }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw new ApiError(400, 'INVALID_PHOTO', 'Fotoğraf okunamadı. Geçerli, hareketsiz bir JPG, PNG veya WebP seçin.');
  }
}

function storageFailure() {
  return new ApiError(503, 'PHOTO_STORAGE_UNAVAILABLE', 'Profil fotoğrafı işlemi tamamlanamadı. Lütfen yeniden deneyin.');
}

async function downloadPhoto(context: PhotoContext, path: string): Promise<Buffer> {
  const { data, error } = await context.client.storage.from(BUCKET).download(path);
  if (error) {
    const code = 'code' in error ? error.code : undefined;
    if (code === 'NoSuchKey' || code === 'ObjectNotFound' || error.message === 'Object not found') {
      throw new ApiError(404, 'PHOTO_NOT_FOUND', 'Henüz profil fotoğrafı eklenmemiş.');
    }
    throw storageFailure();
  }
  if (!data) throw storageFailure();
  return Buffer.from(await data.arrayBuffer());
}

export async function getProfilePhoto(context: PhotoContext): Promise<Buffer> {
  return downloadPhoto(context, photoPath(context));
}

export async function getFriendProfilePhoto(context: PhotoContext, userId: string): Promise<Buffer> {
  photoPath(context);
  if (!UUID.test(userId)) throw new ApiError(400, 'INVALID_INPUT', 'Arkadaş seçimi geçerli değil.');
  const targetId = userId.toLowerCase();
  const { data: allowed, error } = await context.client.rpc('profile_photo_can_read', { p_user_id: targetId });
  if (error) throw storageFailure();
  if (allowed !== true) throw new ApiError(404, 'PHOTO_NOT_FOUND', 'Profil fotoğrafı bulunamadı.');
  // RLS checks the same current membership again during the signed-in download.
  return downloadPhoto(context, `${targetId}/avatar.webp`);
}

export async function putProfilePhoto(context: PhotoContext, request: Request): Promise<void> {
  const path = photoPath(context, true);
  const bytes = await normalizeProfilePhoto(await readProfilePhoto(request));
  const { error } = await context.client.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'image/webp', cacheControl: '0', upsert: true,
  });
  if (error) throw storageFailure();
}

export async function deleteProfilePhoto(context: PhotoContext): Promise<void> {
  const path = photoPath(context, true);
  const { error } = await context.client.storage.from(BUCKET).remove([path]);
  if (error) throw storageFailure();
}
