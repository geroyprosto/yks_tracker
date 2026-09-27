import { z } from 'zod';
import { createDemoSession, demoEnabled, demoQuery } from '@/lib/server/classroom-demo';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function GET(){try{if(!demoEnabled())return json({enabled:false,accounts:[]});const accounts=await demoQuery(async db=>(await db.query('select id,name,role,status,teacher_id from public.classroom_accounts order by role,name')).rows);return json({enabled:true,accounts});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{sameOrigin(request);if(!demoEnabled())throw new ApiError(404,'DEMO_DISABLED','Demo bu ortamda kapalı.');const input=z.object({account_id:z.uuid()}).strict().safeParse(await readJson(request,1024));if(!input.success)throw new ApiError(400,'INVALID_INPUT','Demo hesabı seçin.');await createDemoSession(input.data.account_id);return json({ok:true});}catch(error){return errorResponse(error);}}
