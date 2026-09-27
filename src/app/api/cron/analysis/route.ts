import { createHash } from 'node:crypto';
import type { AppState } from '@/lib/domain/types';
import { analysisAdmin, dueAnalysisWindow, generateScheduledAnalysis } from '@/lib/server/analysis';
import { schedulerReady } from '@/lib/server/analysis-provider';
import { ApiError, errorResponse, json } from '@/lib/server/http';
import { localDate } from '@/lib/ui';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=120;

function requestId(owner:string,start:string,end:string){
  const hex=createHash('sha256').update(`analysis:v1:${owner}:${start}:${end}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

export async function GET(request:Request){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return json({ok:false},401);
  if(!schedulerReady())return json({ok:false,error:{code:'SCHEDULER_NOT_READY',message:'Sunucu zamanlayıcısı kurulmadı.'}},503);
  try{
    const admin=analysisAdmin();
    const schedules=await admin.from('analysis_settings').select('user_id,start_date').eq('enabled',true);
    if(schedules.error)throw schedules.error;
    let completed=0,skipped=0,failed=0;
    for(const row of schedules.data??[]){
      if(!row.start_date){skipped++;continue;}
      const source=await admin.rpc('analysis_source_state',{p_user_id:row.user_id});
      if(source.error?.message.includes('STUDENT_REQUIRED')){skipped++;continue;}
      if(source.error||!source.data){failed++;continue;}
      const timezone=(source.data as AppState).settings?.timezone??'Europe/Istanbul';
      const window=dueAnalysisWindow(row.start_date,localDate(new Date(),timezone));
      if(!window){skipped++;continue;}
      const prior=await admin.from('analysis_reports').select('id').eq('user_id',row.user_id)
        .eq('start_date',window.start).eq('end_date',window.end).limit(1);
      if(prior.error){failed++;continue;}
      if(prior.data?.length){skipped++;continue;}
      try{await generateScheduledAnalysis(admin,row.user_id,window.start,window.end,requestId(row.user_id,window.start,window.end));completed++;}
      catch(error){if(error instanceof ApiError&&error.code==='STUDENT_REQUIRED')skipped++;else failed++;}
    }
    return json({ok:failed===0,completed,skipped,failed},failed?503:200);
  }catch(error){return errorResponse(error);}
}
