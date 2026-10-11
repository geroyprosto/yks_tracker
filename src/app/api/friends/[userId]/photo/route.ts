import { classroomContext } from '@/lib/server/classroom';
import { errorResponse, privateHeaders } from '@/lib/server/http';
import { getFriendProfilePhoto } from '@/lib/server/profile-photo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params;
    const photo = await getFriendProfilePhoto(await classroomContext(), userId);
    return new Response(new Uint8Array(photo), {
      headers: { ...privateHeaders, 'Content-Type': 'image/webp', 'Content-Length': String(photo.byteLength) },
    });
  } catch (error) { return errorResponse(error); }
}
