export const MAX_PROFILE_PHOTO_BYTES = 4 * 1024 * 1024;
export const PROFILE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function profilePhotoError(file: { size: number; type: string }): string | null {
  if (!(PROFILE_PHOTO_TYPES as readonly string[]).includes(file.type)) return 'JPG, PNG veya WebP biçiminde bir fotoğraf seç.';
  if (file.size === 0) return 'Seçtiğin dosya boş. Başka bir fotoğraf seç.';
  if (file.size > MAX_PROFILE_PHOTO_BYTES) return 'Fotoğraf en fazla 4 MB olabilir.';
  return null;
}
