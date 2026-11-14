import { leaderChatInputSchema, leaderChatMessagesSchema } from '@/lib/agent-house-chat';
import { analysisAdmin } from '@/lib/server/analysis';
import { requireAiStudyContext } from '@/lib/server/classroom';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { databaseError } from '@/lib/server/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { userId } = await requireAiStudyContext();
    const { data, error } = await analysisAdmin().rpc('agent_team_chat_read', { p_user_id: userId });
    if (error) databaseError(error);
    const parsed = leaderChatMessagesSchema.safeParse(data);
    if (!parsed.success) throw new ApiError(503, 'INVALID_RESPONSE', 'Liderin defteri şu anda açılamıyor.');
    return json({ messages: parsed.data });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { userId } = await requireAiStudyContext();
    const parsed = leaderChatInputSchema.safeParse(await readJson(request, 18000));
    if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', 'Lider için en fazla 4000 karakterlik bir not yaz.');
    const { data, error } = await analysisAdmin().rpc('agent_team_chat_send', {
      p_user_id: userId, p_id: parsed.data.id, p_content: parsed.data.content,
    });
    if (error?.message === 'CHAT_PENDING_LIMIT') throw new ApiError(429, 'CHAT_PENDING_LIMIT', 'Önce bekleyen notlarını yanıtlayalım; ardından yeni bir not bırakabilirsin.');
    if (error) databaseError(error);
    if (!data || data.id !== parsed.data.id || typeof data.created !== 'boolean') {
      throw new ApiError(503, 'INVALID_RESPONSE', 'Notunun kaydı doğrulanamadı. Aynı notu yeniden gönderebilirsin.');
    }
    return json({ id: data.id, created: data.created }, data.created ? 201 : 200);
  } catch (error) { return errorResponse(error); }
}
