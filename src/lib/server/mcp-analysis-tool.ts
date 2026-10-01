import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppState } from "../domain/types";
import { buildAnalysisSnapshot } from "../analysis-snapshot";
import { localDate } from "../ui";

export const analysisSourcesInput = z.object({
  lookback_days: z.number().int().min(1).max(31).default(14),
}).strict();

function daysBefore(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Returns calculated source facts and journals according to the account setting. */
export function registerAnalysisSourcesTool(server: McpServer, loadState: () => Promise<AppState>) {
  server.registerTool("get_analysis_sources", {
    title: "Son günlerin analiz kaynakları",
    description: "Varsayılan son 14 günün gerçek çalışma, görev, soru, test ve deneme kayıtlarını getirir. Hesapta günlük analizi açıksa seçilen dönemdeki kaydedilmiş günlük metni ve doldurulmuş alanlar da eklenir; kapalıysa günlük içeriği verilmez. Eksik günler sıfır sayılmaz. En çok 31 gün istenebilir. Bu araç rapor yazmaz veya ücretli model çağrısı yapmaz.",
    inputSchema: analysisSourcesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [] }] },
  }, async ({ lookback_days }) => {
    try {
      const state = await loadState();
      const today = localDate(Date.parse(state.server_now), state.settings?.timezone ?? "Europe/Istanbul");
      const { snapshot } = buildAnalysisSnapshot(state, daysBefore(today, lookback_days - 1), today);
      return { content: [{ type: "text" as const, text: JSON.stringify(snapshot) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const,
        text: "Analiz kaynakları getirilemedi. Hesap verilerini ve tarih aralığını kontrol edin." }] };
    }
  });
}
