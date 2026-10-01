import { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { executeMcpOwnerCommand } from "./mcp-gateway";
import { ApiError } from "./http";

/** An exact topic ID and revision must come from list_topics before a change. */
export const updateTopicStatusInput = z.object({
  request_id: z.uuid(),
  confirmed_by_user: z.literal(true),
  topic_id: z.uuid(),
  expected_revision: z.number().int().positive(),
  mastery: z.number().int().min(0).max(4),
}).strict();

export function registerTopicStatusTool(server: McpServer, client: SupabaseClient, userId: string, appUrl: string) {
  server.registerTool("update_topic_status", {
    title: "Konu öğrenme düzeyini güncelle",
    description: "Kullanıcının açıkça istediği öğrenme düzeyini, list_topics ile bulunan tam konu kimliği ve sürümüyle kaydeder. Düzeyler: 0 başlanmadı, 1 öğreniliyor, 2 konu anlatımı tamamlandı, 3 bağımsız soru çözülebiliyor, 4 konuya hâkimim. İlk kez 2 veya üstüne geçişte uygulama Görevlerim'e beş düşük öncelikli pazar pekiştirmesi ekler; mevcut düzeyden geçmişteki bitiş tarihi uydurma. Konu belirsizse önce kullanıcıya sor. Yeniden denemede aynı request_id UUID değerini kullan.",
    inputSchema: updateTopicStatusInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [] }] },
  }, async ({ request_id, confirmed_by_user, topic_id, expected_revision, mastery }) => {
    try {
      if (!confirmed_by_user) throw new ApiError(400, "CONFIRMATION_REQUIRED", "Konu düzeyini değiştirmeden önce kullanıcı onayı gerekli.");
      const receipt = await executeMcpOwnerCommand(client, userId, { request_id, type: "topic.update",
        payload: { id: topic_id, expected_revision, mastery } });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        id: receipt.id, request_id: receipt.request_id, status: receipt.replayed ? "already_saved" : "saved",
        replayed: receipt.replayed, topic_id, mastery,
        app_url: appUrl,
      }) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const,
        text: error instanceof ApiError ? error.message : "Konu düzeyi kaydedilemedi." }] };
    }
  });
}



