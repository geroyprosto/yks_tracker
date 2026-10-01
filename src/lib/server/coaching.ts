import type {SupabaseClient} from '@supabase/supabase-js';
import {emptyState,type AppState} from '../domain/types';
import {buildCoachingReportMetrics,type CoachingReportMetrics} from '../coaching-report';
import {buildWeeklyHomeworkCandidates,type CoachingPlan} from '../coaching-plan';
import {ApiError} from './http';
import {localDate} from '../ui';

export type TaskReceipt={key?:string;title:string;topic_id:string;exam?:string;subject?:string;
  status:string;task_ids:string[];reason?:string;plan_date?:string};
export type CoachingContext={plan:CoachingPlan|null;previous_cutoff:string|null;previous_report_id:string|null;
  previous_metrics:CoachingReportMetrics|null;homework_results:TaskReceipt[]};
type Run={run_id:string;cutoff:string;previous_cutoff:string|null;previous_report_id:string|null;
  source_state:AppState;previous_metrics:CoachingReportMetrics|null;plan:CoachingPlan|null;status:string;report_id:string|null};
export async function coachingRpc<T>(admin:SupabaseClient,name:string,args:Record<string,unknown>):Promise<T>{
  const {data,error}=await admin.rpc(name,args);
  if(error){
    if(error.message.includes('COACHING_BUSY'))throw new ApiError(409,'COACHING_BUSY','Önceki analiz sürüyor; tamamlanmasını bekle.');
    throw new ApiError(503,'COACHING_STORAGE','Koçluk görevleri veya analiz kaydı tamamlanamadı. Kaydedilmiş görevler korunuyor.');
  }
  return data as T;
}
export async function loadCoachingContext(admin:SupabaseClient,owner:string){
  return coachingRpc<CoachingContext>(admin,'coaching_context',{p_user_id:owner});
}
export function receiptDirections(receipts:TaskReceipt[],cutoff=new Date().toISOString()){
  const today=localDate(Date.parse(cutoff),'Europe/Istanbul'),end=new Date(today+'T12:00:00Z');
  end.setUTCDate(end.getUTCDate()+(7-end.getUTCDay())%7);
  const weekEnd=end.toISOString().slice(0,10);
  return receipts.filter(item=>item.task_ids?.length>0).slice(0,3).map(item=>{
    const when=item.plan_date?(item.plan_date<=weekEnd?'Bu hafta':'Gelecek hafta'):null;
    const action=item.title.includes('konu öğrenimi')?'konu anlatımını tamamla':'bağımsız uygulamayı ve yanlış analizini bitir';
    return {title:item.title,text:[when?`${when} ${action}.`:null,
      item.reason??'Görevlerim’deki tamamlanma ölçütlerini yerine getir.'].filter(Boolean).join(' '),
      topic_id:item.topic_id,task_ids:item.task_ids};
  });
}
export async function prepareCoachingRun(admin:SupabaseClient,owner:string,requestId:string,start:string,end:string){
  const run=await coachingRpc<Run>(admin,'coaching_run_begin',{p_user_id:owner,p_run_id:requestId});
  try{
  const state={...emptyState(true),...run.source_state,authenticated:true,server_now:run.cutoff};
  const repetition=await coachingRpc<{results:TaskReceipt[]}>(admin,'topic_review_reconcile',{
    p_user_id:owner,p_current_cutoff:run.cutoff,p_previous_cutoff:run.previous_cutoff,p_initial_backfill:false,p_run_id:requestId});
  if(repetition.results.some(item=>item.status==='pending'||item.status==='retry_pending'))
    throw new ApiError(503,'COACHING_REVIEWS_PENDING','Tekrar görevlerinin kaydı yeniden deneniyor. AI hakkın kullanılmadı; kaydedilmiş görevler korunuyor.');
  // Metrics use the frozen pre-assignment cohort. Capacity uses actual tasks, including just-persisted reviews.
  const metrics=buildCoachingReportMetrics(state,{cutoff:run.cutoff,start,end,previous:run.previous_metrics,
    previousAnalysisId:run.previous_report_id,currentAnalysisId:run.report_id});
  const live=await coachingRpc<AppState>(admin,'analysis_source_state',{p_user_id:owner});
  const planned=run.plan?buildWeeklyHomeworkCandidates({...state,tasks:live.tasks},run.plan,metrics):
    {candidates:[],directions:[],data_gaps:['Kişisel aylık plan kayıtlı değil.']};
  const homework=await coachingRpc<{results:TaskReceipt[]}>(admin,'coaching_homework_create',{
    p_user_id:owner,p_run_id:requestId,p_candidates:planned.candidates});
  const coaching={...metrics,directions:receiptDirections(homework.results,run.cutoff),
    repetition_results:repetition.results,homework_results:homework.results,
    data_gaps:[...metrics.data_gaps,...planned.data_gaps]};
  return {run,state,coaching,plan:run.plan};
  }catch(error){await admin.rpc('coaching_run_fail',{p_user_id:owner,p_run_id:requestId});throw error;}
}
