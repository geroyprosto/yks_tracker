import {timingSafeEqual} from 'node:crypto';
import {ApiError,errorResponse,json} from '@/lib/server/http';
import {analysisAdmin} from '@/lib/server/analysis';
import {coachingRpc} from '@/lib/server/coaching';
export const dynamic='force-dynamic';
export const runtime='nodejs';
// Model-free recovery only: this endpoint never starts a paid analysis.
export async function GET(request:Request){try{
  const expected=process.env.CRON_SECRET,actual=request.headers.get('authorization')??'';
  if(!expected||actual.length!==`Bearer ${expected}`.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(`Bearer ${expected}`)))
    throw new ApiError(401,'UNAUTHORIZED','Zamanlayıcı kimliği doğrulanamadı.');
  const result=await coachingRpc(analysisAdmin(),'topic_review_retry_pending',{});
  return json({ok:true,result});
}catch(error){return errorResponse(error);}}
