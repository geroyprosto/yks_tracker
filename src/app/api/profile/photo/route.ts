import { classroomContext } from '@/lib/server/classroom';
import { errorResponse, json, privateHeaders, sameOrigin } from '@/lib/server/http';
import { deleteProfilePhoto, getProfilePhoto, putProfilePhoto } from '@/lib/server/profile-photo';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const photo = await getProfilePhoto(await classroomContext());
    return new Response(new Uint8Array(photo), {
      headers: { ...privateHeaders, 'Content-Type': 'image/webp', 'Content-Length': String(photo.byteLength) },
    });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    await putProfilePhoto(await classroomContext(), request);
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await deleteProfilePhoto(await classroomContext());
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
