import { z } from 'zod';
import { requireStudyUser, publicClassroomClient } from '@/lib/server/classroom';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
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
    const input = z.object({ group_id: z.string().uuid().optional() }).strict().safeParse(request.body ? await readJson(request, 1024) : {});
    if (!input.success) throw new ApiError(400, 'INVALID_INPUT', 'Grup seçimi geçerli değil.');
    const client = await requireStudyUser();
    const { data, error } = await client.rpc('friend_invite_create', { p_group_id: input.data.group_id ?? null });
    if (error) databaseError(error);
    return json(data, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
