import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {JournalStructuredFields} from '../domain/types';
import {analysisAdmin, ownerId} from './analysis';
import {getAnalysisProviderConfig, verifyAnalysisModel} from './analysis-provider';
import {ApiError} from './http';
import {requestJournalSuggestion, reservedJournalCostUsd} from './journal-ai-provider';

type SuggestionRow = {
  id: string; source_hash: string; status: 'running'|'completed'|'failed'|'uncertain';
  fields: JournalStructuredFields|null;
  usage: {input_tokens: number; output_tokens: number; estimated_cost_usd: number}|null;
};
type Claim = {suggestion: SuggestionRow; claimed: boolean; replayed: boolean};

export function journalSuggestionHash(date: string, text: string, model: string) {
  return createHash('sha256').update(JSON.stringify({version: 1, model, date, text})).digest('hex');
}

export async function suggestJournalFields(client: SupabaseClient, date: string, text: string,
  requestId: string) {
  const config = getAnalysisProviderConfig();
  if (!config) throw new ApiError(503, 'JOURNAL_AI_SETUP',
    'OpenAI anahtarı, model ve aylık maliyet sınırları henüz kurulmadı. Günlüğünü normal biçimde kaydedebilirsin.');
  const reservation = reservedJournalCostUsd(config, text);
  if (reservation > config.monthlyUsd) throw new ApiError(429, 'JOURNAL_AI_BUDGET',
    'Bu metin için üst maliyet tahmini aylık bütçeyi aşıyor. Daha kısa bir metin seç.');
  await verifyAnalysisModel(config);
  const userId = await ownerId(client);
  const admin = analysisAdmin();
  const {data, error} = await admin.rpc('journal_ai_suggestion_claim', {
    p_user_id: userId, p_request_id: requestId,
    p_source_hash: journalSuggestionHash(date, text, config.model),
    p_max_requests: config.monthlyRequests,
    p_monthly_budget_usd: config.monthlyUsd,
    p_reserved_cost_usd: reservation,
  });
  if (error) {
    if (error.message.includes('AI_LIMIT_REACHED')) throw new ApiError(429, 'JOURNAL_AI_BUDGET',
      'Bu ayki ortak AI istek veya bütçe sınırına ulaşıldı.');
    if(error.message.includes('AI_APP_BUDGET_REACHED'))throw new ApiError(429,'JOURNAL_AI_BUDGET','Uygulamanın aylık AI bütçesi doldu.');
    if(error.message.includes('AI_DISABLED'))throw new ApiError(503,'AI_DISABLED','AI bu pilotta kapalı; günlük alanlarını elle düzenleyebilirsin.');
    if (error.message.includes('IDEMPOTENCY_CONFLICT')) throw new ApiError(409, 'JOURNAL_AI_CONFLICT',
      'Bu istek başka bir günlük metnine ait.');
    throw new ApiError(503, 'JOURNAL_AI_STORAGE', 'Günlük AI bütçe veritabanı kurulumu eksik.');
  }
  const claim = data as Claim | null;
  if (!claim?.suggestion?.id) throw new ApiError(503, 'JOURNAL_AI_STORAGE',
    'Günlük önerisinin kayıt durumu doğrulanamadı.');
  if (!claim.claimed) {
    if (claim.suggestion.status === 'completed' && claim.suggestion.fields && claim.suggestion.usage)
      return {fields: claim.suggestion.fields, usage: claim.suggestion.usage, cached: true};
    if (claim.suggestion.status === 'running') throw new ApiError(409, 'JOURNAL_AI_RUNNING',
      'Bu metin için öneri zaten hazırlanıyor. Biraz sonra tekrar dene.');
    throw new ApiError(409, 'JOURNAL_AI_UNCERTAIN',
      'Bu metnin önceki AI isteğinin sonucu belirsiz. Mükerrer ücret oluşmaması için otomatik tekrar gönderilmeyecek; alanları elle düzenleyebilirsin.');
  }
  try {
    const marked=await admin.rpc('ai_mark_sent',{p_user_id:userId,p_kind:'journal',p_id:claim.suggestion.id,p_request_id:requestId});
    if(marked.error)throw new ApiError(503,'JOURNAL_AI_STORAGE','AI gönderimi başlatılamadı.');
    const generated = await requestJournalSuggestion(config, text);
    const final = await admin.rpc('journal_ai_suggestion_finalize', {
      p_user_id: userId, p_suggestion_id: claim.suggestion.id, p_request_id: requestId,
      p_fields: generated.fields, p_usage: generated.usage, p_actual_cost_usd: generated.cost,
    });
    if (final.error) throw new ApiError(503, 'JOURNAL_AI_STORAGE',
      'Öneri alındı fakat sunucu kullanım kaydını tamamlayamadı. Yeniden otomatik istek gönderilmeyecek.');
    return {fields: generated.fields, usage: generated.usage, cached: false};
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Günlük önerisi tamamlanamadı.';
    // The provider might have billed the attempt. Retain the reservation.
    await admin.rpc('journal_ai_suggestion_fail', {p_user_id: userId,
      p_suggestion_id: claim.suggestion.id, p_request_id: requestId,
      p_error_message: message.slice(0, 1000)});
    throw error;
  }
}
