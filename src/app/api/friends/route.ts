import { z } from 'zod';
import { requireStudyUser } from '@/lib/server/classroom';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { databaseError } from '@/lib/server/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const groupId = new URL(request.url).searchParams.get('group_id');
    if (groupId !== null && !z.string().uuid().safeParse(groupId).success) {
      throw new ApiError(400, 'INVALID_INPUT', 'Grup seçimi geçerli değil.');
    }
    const client = await requireStudyUser();
    const { data, error } = await client.rpc('friend_competition_state', { p_group_id: groupId });
    if (error) databaseError(error);
    return json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const input = z.object({ friend_id: z.string().uuid(), group_id: z.string().uuid().optional() }).strict().safeParse(await readJson(request, 1024));
    if (!input.success) throw new ApiError(400, 'INVALID_INPUT', 'Arkadaş seçimi geçerli değil.');
    const client = await requireStudyUser();
    const { data, error } = await client.rpc('friend_remove', { p_friend_id: input.data.friend_id, p_group_id: input.data.group_id ?? null });
    if (error) databaseError(error);
    return json({ ok: Boolean(data) });
  } catch (error) {
    return errorResponse(error);
  }
}
