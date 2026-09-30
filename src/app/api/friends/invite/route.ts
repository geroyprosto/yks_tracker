import { requireStudyUser, publicClassroomClient } from '@/lib/server/classroom';
import { ApiError, errorResponse, json, sameOrigin } from '@/lib/server/http';
import { databaseError } from '@/lib/server/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(404, 'INVITE_INVALID', 'Davet bağlantısı geçersiz veya süresi dolmuş.');
    const { data, error } = await (await publicClassroomClient()).rpc('friend_invite_preview', { p_token: token });
    if (error) databaseError(error);
    if (!data) throw new ApiError(404, 'INVITE_INVALID', 'Davet bağlantısı geçersiz veya süresi dolmuş.');
    return json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const client = await requireStudyUser();
    const { data, error } = await client.rpc('friend_invite_create');
    if (error) databaseError(error);
    return json(data, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
