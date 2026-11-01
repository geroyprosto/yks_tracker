import { profilePhotosRemovedResponse } from '@/lib/server/profile-photo';

export function GET() {
  return profilePhotosRemovedResponse();
}
