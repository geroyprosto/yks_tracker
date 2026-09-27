import { z } from 'zod';
import { requireAiStudyUser } from '@/lib/server/classroom';
import { generateManualAnalysis, getAnalysisStatus, setAnalysisSchedule } from '@/lib/server/analysis';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { localDate } from '@/lib/ui';
import { validAnalysisRange } from '@/lib/analysis-snapshot';

export const dynamic='force-dynamic';
const actionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('report'),request_id:z.uuid(),start_date:z.iso.date(),end_date:z.iso.date()}).strict(),
  z.object({action:z.literal('schedule'),request_id:z.uuid(),enabled:z.boolean(),start_date:z.iso.date().nullable()}).strict(),
]);

export async function GET(){try{return json(await getAnalysisStatus(await requireAiStudyUser()));}catch(error){return errorResponse(error);}}
export async function POST(request:Request){
  try{
    sameOrigin(request);
    const client=await requireAiStudyUser();
    const parsed=actionSchema.safeParse(await readJson(request));
    if(!parsed.success)throw new ApiError(400,'INVALID_INPUT','Analiz isteğindeki alanları kontrol edin.');
    const action=parsed.data;
    if(action.action==='report'){
      const today=localDate();
      if(!validAnalysisRange(action.start_date,action.end_date,today))
        throw new ApiError(400,'INVALID_RANGE','Geçerli ve en fazla bir yıllık, geleceğe uzanmayan aralık seçin.');
      const days=(Date.parse(action.end_date)-Date.parse(action.start_date))/86400000+1;
      if(![7,14,30].includes(days))throw new ApiError(400,'INVALID_RANGE','Son 7, 14 veya 30 günlük bir aralık seçin.');
      await generateManualAnalysis(client,action.start_date,action.end_date,action.request_id);
    }else{
      const today=localDate();
      const maxStart=new Date(Date.parse(today+'T12:00:00Z')+365*86400000).toISOString().slice(0,10);
      if(action.enabled&&(!action.start_date||action.start_date>maxStart))
        throw new ApiError(400,'INVALID_RANGE','Başlangıç günü en fazla bir yıl sonrası olabilir.');
      await setAnalysisSchedule(client,action.enabled,action.start_date);
    }
    return json(await getAnalysisStatus(client));
  }catch(error){return errorResponse(error);}
}
