import {McpServer} from '@modelcontextprotocol/server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {agentHouseReportSchema} from '../agent-house';
import {saveAgentHouseMcpReport} from './agent-house';
import {ApiError} from './http';

export function registerAgentHouseTool(server: McpServer, client: SupabaseClient, userId: string) {
  server.registerTool('publish_agent_house_report', {
    title: 'Ajan Evi raporunu kaydet',
    description: 'Liderin birleştirdiği altı ajan raporunu YKSİM Analiz ekranındaki eve kaydeder. Yalnız kullanıcıya sunulacak özet, öneri, tablo, program ve doğrulanmış kaynakları gönder; özel günlük ham metinlerini, anahtarları veya yerel dosya yollarını ekleme. Örnek veriyi mode=sample, gerçek veriyi mode=live olarak açıkça ayır. Bu araç ders görevi veya çalışma kaydı oluşturmaz. Aynı raporu yeniden gönderirken run_id ve içeriği aynen koru; değişiklik için yeni run_id kullan. Başarı yanıtı gelmeden kaydedildi deme.',
    inputSchema: agentHouseReportSchema,
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    _meta: {securitySchemes: [{type: 'oauth2', scopes: []}]},
  }, async report => {
    try {
      const result = await saveAgentHouseMcpReport(client, userId, report);
      return {content: [{type: 'text' as const, text: JSON.stringify({run_id: report.run_id, mode: report.mode, created: result.created, status: 'saved'})}]};
    } catch (error) {
      return {isError: true, content: [{type: 'text' as const, text: error instanceof ApiError ? error.message : 'Ajan Evi raporu kaydedilemedi.'}]};
    }
  });
}
