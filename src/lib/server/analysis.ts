import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppState } from '../domain/types';
import { buildAnalysisSnapshot, buildSixInsightSnapshot, buildStudentAnalysisSnapshot } from '../analysis-snapshot';
import { GUIDANCE_SOURCES, REPORT_SCHEMA_VERSION } from '../ai-report';
import { localDate } from '../ui';
import { getState } from './service';
import { getConfiguration } from './auth';
import { ApiError } from './http';
import { analysisServiceConfigured, formatAnalysis, getAnalysisProviderConfig, providerPayload, requestAnalysis, reservedCostUsd, schedulerReady, verifyAnalysisModel } from './analysis-provider';

type ReportRow={id:string;user_id:string;start_date:string;end_date:string;source_hash:string;
  status:'pending'|'running'|'completed'|'failed'|'uncertain';body:string|null;summary:Record<string,unknown>|null;
  usage:{input_tokens:number;output_tokens:number;estimated_cost_usd:number|null}|null;error_message:string|null;
  request_id:string;created_at:string;updated_at:string};
type ScheduleRow={enabled:boolean;start_date:string|null}|null;
type UsageRow={requests:number;estimated_cost_usd:number|null;resets_at:string;enabled:boolean;month:string}|null;
function databaseSetupError(){return new ApiError(503,'ANALYSIS_STORAGE_UNAVAILABLE','Analiz veritabanı kurulumu veya bağlantısı eksik.');}
export function analysisAdmin():SupabaseClient {
  const config=getConfiguration();
  const secret=process.env.SUPABASE_SECRET_KEY?.trim();
  if(!config||!secret||/REPLACE|YOUR_/i.test(secret))throw new ApiError(503,'ANALYSIS_SETUP_REQUIRED','AI raporları için sunucu veritabanı anahtarı kurulmalı.');
  return createClient(config.url,secret,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
}
export async function ownerId(client:SupabaseClient){
  const {data,error}=await client.auth.getUser();
  if(error||!data.user)throw new ApiError(401,'SIGN_IN_REQUIRED','Devam etmek için giriş yapın.');
  return data.user.id;
}
export async function getAnalysisStatus(client:SupabaseClient){
  const id=await ownerId(client);
  const [settings,reports,usage]=await Promise.all([
    client.from('analysis_settings').select('enabled,start_date').eq('user_id',id).maybeSingle(),
    client.from('analysis_reports').select('id,user_id,start_date,end_date,source_hash,status,body,summary,usage,error_message,request_id,created_at,updated_at').eq('user_id',id).order('created_at',{ascending:false}).limit(25),
    client.rpc('ai_usage_status'),
  ]);
  if(settings.error||reports.error||usage.error)throw databaseSetupError();
  const rows=reports.data as ReportRow[];
  const current=rows.filter(row=>row.status==='completed');
  const hashes=new Map<string,string>();
  if(current.length){
    const state=await getState(client);
    for(const row of current){const version=row.summary?.schema_version??1;
      const asOf=version===3&&typeof row.summary?.guidance_as_of==='string'?row.summary.guidance_as_of:'';
      const key=row.start_date+'/'+row.end_date+'/'+version+'/'+asOf;
      if(!hashes.has(key)){
        try{hashes.set(key,version===3?buildSixInsightSnapshot(state,row.start_date,row.end_date,asOf||undefined).sourceHash
          :version===2?buildStudentAnalysisSnapshot(state,row.start_date,row.end_date).sourceHash
          :buildAnalysisSnapshot(state,row.start_date,row.end_date).sourceHash);}catch{hashes.set(key,'');}
      }
    }
  }
  const config=getAnalysisProviderConfig();
  return {ok:true,configured:Boolean(config&&analysisServiceConfigured()&&(usage.data as UsageRow)?.enabled),model:process.env.OPENAI_MODEL?.trim()||null,
    scheduler_ready:schedulerReady(),schedule:settings.data as ScheduleRow,
    reports:rows.map(row=>({id:row.id,start_date:row.start_date,end_date:row.end_date,status:row.status,body:row.body,
      created_at:row.created_at,stale:row.status==='completed'&&hashes.get(row.start_date+'/'+row.end_date+'/'+(row.summary?.schema_version??1)+'/'+
        (row.summary?.schema_version===3&&typeof row.summary?.guidance_as_of==='string'?row.summary.guidance_as_of:''))!==row.source_hash,
      error_message:row.error_message,summary:row.summary,usage:row.usage})),
    resets_at:(usage.data as UsageRow)?.resets_at??null,
    limits:{monthly_requests:4,
      monthly_usd:(config?.monthlyUsd??Number(process.env.AI_MONTHLY_BUDGET_USD))||0},
    used:{requests:(usage.data as UsageRow)?.requests??0,estimated_cost_usd:(usage.data as UsageRow)?.estimated_cost_usd??0}};
}
export async function setAnalysisSchedule(client:SupabaseClient,enabled:boolean,startDate:string|null){
  if(enabled)throw new ApiError(409,'AUTOMATIC_AI_DISABLED','Bu pilotta AI yalnız isteğin üzerine çalışır. Otomatik rapor kapalıdır.');
  const userId=await ownerId(client);
  const {error}=await analysisAdmin().rpc('analysis_schedule_set_for_owner',
    {p_user_id:userId,p_enabled:enabled,p_start_date:startDate});
  if(error?.message.includes('STUDENT_REQUIRED'))throw new ApiError(403,'STUDENT_REQUIRED','Hesap artık analiz için uygun değil.');
  if(error)throw databaseSetupError();
}
export async function generateAnalysisForState(options:{owner:string;state:AppState;start:string;end:string;requestId:string;
}){
  const config=getAnalysisProviderConfig();
  if(!config)throw new ApiError(503,'ANALYSIS_SETUP_REQUIRED','OpenAI API anahtarı, model ve maliyet sınırları henüz kurulmadı.');
  const {snapshot,sourceHash}=buildSixInsightSnapshot(options.state,options.start,options.end);
  if(snapshot.summary.data_days===0)throw new ApiError(400,'ANALYSIS_NO_DATA','Bu aralıkta değerlendirilecek kayıt yok. AI hakkı kullanılmadı.');
  const prompt=providerPayload(snapshot);
  const reservation=reservedCostUsd(config,prompt);
  if(reservation>config.monthlyUsd)throw new ApiError(429,'ANALYSIS_BUDGET','Tek rapor maliyet üst sınırı aylık bütçeyi aşıyor.');
  await verifyAnalysisModel(config);
  const params={p_request_id:options.requestId,p_start_date:options.start,p_end_date:options.end,
    p_source_hash:sourceHash,p_max_requests:config.monthlyRequests,p_monthly_budget_usd:config.monthlyUsd,
    p_reserved_cost_usd:reservation};
  const claim=await analysisAdmin().rpc('analysis_report_claim_for_owner',{p_user_id:options.owner,...params});
  if(claim.error){
    if(claim.error.message.includes('STUDENT_REQUIRED'))throw new ApiError(403,'STUDENT_REQUIRED','Hesap artık analiz için uygun değil.');
    if(claim.error.message.includes('AI_DISABLED'))throw new ApiError(503,'AI_DISABLED','AI sunucuda kapalı; çalışma kayıtların kullanılabilir.');
    if(/AI_LIMIT_REACHED|AI_APP_BUDGET_REACHED/.test(claim.error.message))throw new ApiError(429,'ANALYSIS_BUDGET','Bu ayki 4 AI kullanımı veya uygulama bütçesi doldu.');
    throw databaseSetupError();
  }
  const value=claim.data as {report:ReportRow;claimed:boolean};
  if(!value?.claimed)return value?.report;
  const admin=analysisAdmin();
  try{
    const marked=await admin.rpc('ai_mark_sent',{p_user_id:options.owner,p_kind:'report',p_id:value.report.id,p_request_id:options.requestId});
    if(marked.error)throw databaseSetupError();
    const generated=await requestAnalysis(config,prompt);
    const summary={...snapshot.summary,schema_version:REPORT_SCHEMA_VERSION,structured_report:generated.analysis,
      evidence:snapshot.evidence,report_metrics:snapshot.report_metrics,guidance_as_of:snapshot.timing_guidance.as_of,
      guidance_sources:snapshot.education.yks_goal===false?[]:GUIDANCE_SOURCES.map(source=>({title:source.title,url:source.url}))};
    const result=await admin.rpc('analysis_report_finalize',{p_user_id:options.owner,p_report_id:value.report.id,
      p_request_id:options.requestId,p_body:formatAnalysis(generated.analysis),p_summary:summary,
      p_usage:generated.usage,p_actual_cost_usd:generated.cost});
    if(result.error)throw databaseSetupError();
    return result.data as ReportRow;
  }catch(error){
    const message=error instanceof ApiError?error.message:'AI raporu tamamlanamadı.';
    await admin.rpc('analysis_report_fail',{p_user_id:options.owner,p_report_id:value.report.id,
      p_request_id:options.requestId,p_error_message:message});
    throw error;
  }
}
export async function generateManualAnalysis(client:SupabaseClient,start:string,end:string,requestId:string){
  const state=await getState(client);
  return generateAnalysisForState({owner:await ownerId(client),state,start,end,requestId});
}
export async function generateScheduledAnalysis(admin:SupabaseClient,owner:string,start:string,end:string,requestId:string){
  void admin;void owner;void start;void end;void requestId;
  throw new ApiError(409,'AUTOMATIC_AI_DISABLED','Otomatik AI raporu bu pilotta kapalıdır.');
}
export function dueAnalysisWindow(startDate:string,today=localDate()){
  const from=Date.parse(startDate+'T12:00:00Z'),now=Date.parse(today+'T12:00:00Z');
  const elapsed=Math.floor((now-from)/86400000);
  if(!Number.isFinite(elapsed)||elapsed<14)return null;
  const cycle=Math.floor(elapsed/14)-1;
  const start=new Date(from+cycle*14*86400000).toISOString().slice(0,10);
  const end=new Date(from+(cycle*14+13)*86400000).toISOString().slice(0,10);
  return {start,end};
}
