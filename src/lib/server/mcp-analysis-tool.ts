import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppState } from "../domain/types";
import { buildAnalysisSnapshot, buildSixInsightSnapshot } from "../analysis-snapshot";
import { buildCoachingReportMetrics } from '../coaching-report';
import type {CoachingContext} from './coaching';
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
export function registerAnalysisSourcesTool(server: McpServer, loadState: () => Promise<AppState>,loadContext?:()=>Promise<CoachingContext>) {
  server.registerTool("get_analysis_sources", {
    title: "Son günlerin analiz kaynakları",
    description: "Varsayılan son 14 günün çalışma, görev, soru, test, deneme ve izin verilmiş günlük kayıtlarını; ayrıca mevcut konu ilerlemesini, ders/öncelik bazlı görev oranlarını ve bugünün dönemini getirir. Koçlukta öğrenciden bu kayıtları yeniden istemeden önce bu verileri incele. Eksik günler sıfır sayılmaz. En çok 31 gün istenebilir. Bu araç rapor yazmaz veya ücretli model çağrısı yapmaz.",
    inputSchema: analysisSourcesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [] }] },
  }, async ({ lookback_days }) => {
    try {
      const state = await loadState();
      const context=await loadContext?.();
      const today = localDate(Date.parse(state.server_now), state.settings?.timezone ?? "Europe/Istanbul");
      const start = daysBefore(today, lookback_days - 1);
      const { snapshot } = buildAnalysisSnapshot(state, start, today);
      const { snapshot: coaching } = buildSixInsightSnapshot(state, start, today, today);
      const metrics=buildCoachingReportMetrics(state,{cutoff:state.server_now,start,end:today,previous:context?.previous_metrics,previousAnalysisId:context?.previous_report_id});
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...snapshot, annual_plan:context?.plan??null, coaching: {
        topic_status_by_subject: coaching.topic_status_by_subject,
        weekly_task_priority: metrics.priority_summary,
        task_priority_by_subject: metrics.priority_summary.by_subject,
        metrics,
        timing_guidance: coaching.timing_guidance,
      } }) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const,
        text: "Analiz kaynakları getirilemedi. Hesap verilerini ve tarih aralığını kontrol edin." }] };
    }
  });
}
