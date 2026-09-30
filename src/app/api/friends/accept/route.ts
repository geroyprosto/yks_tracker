import { z } from 'zod';
import { requireStudyUser } from '@/lib/server/classroom';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { databaseError } from '@/lib/server/service';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(await readJson(request, 1024));
    if (!input.success) throw new ApiError(400, 'INVITE_INVALID', 'Davet bağlantısı geçersiz.');
    const client = await requireStudyUser();
    const { data, error } = await client.rpc('friend_invite_accept', { p_token: input.data.token });
    if (error) databaseError(error);
    return json(data);
  } catch (error) {
    return errorResponse(error);
  }
}
