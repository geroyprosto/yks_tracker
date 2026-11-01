// Keep legacy clients from uploading files or opening authenticated Storage requests.
export function profilePhotosRemovedResponse(): Response {
  return Response.json(
    { ok: false, error: { code: 'PROFILE_PHOTOS_REMOVED', message: 'Profil fotoğrafı özelliği kaldırıldı.' } },
    { status: 410, headers: { 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } },
  );
}
