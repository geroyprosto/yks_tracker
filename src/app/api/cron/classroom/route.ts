import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { getConfiguration } from '@/lib/server/auth';
import { ApiError,errorResponse,json } from '@/lib/server/http';
import { databaseError } from '@/lib/server/service';
import { deliverApplicationEmails } from '@/lib/server/classroom-email';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
  const expected=process.env.CRON_SECRET;const actual=request.headers.get('authorization')??'';
  if(!expected||actual.length!==`Bearer ${expected}`.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(`Bearer ${expected}`)))throw new ApiError(401,'UNAUTHORIZED','Zamanlayıcı kimliği doğrulanamadı.');
  const config=getConfiguration();if(!config||!process.env.SUPABASE_SECRET_KEY)throw new ApiError(503,'SETUP_REQUIRED','Sunucu veritabanı anahtarı gerekli.');
  const client=createClient(config.url,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc('classroom_tick');if(error)databaseError(error);return json({ok:true,result:data,email:await deliverApplicationEmails()});
}catch(error){return errorResponse(error);}}
