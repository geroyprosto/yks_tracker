import { z } from 'zod';
import { classroomContext } from '@/lib/server/classroom';
import { classroomState } from '@/lib/server/classroom';
import { databaseError } from '@/lib/server/service';
import { ApiError,errorResponse,json,readJson,sameOrigin } from '@/lib/server/http';
import { after } from 'next/server';
import { deliverApplicationEmails } from '@/lib/server/classroom-email';
export async function POST(request:Request){try{sameOrigin(request);const input=z.object({name:z.string().trim().min(2).max(100),role:z.enum(['student','teacher']),invite_token:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()}).strict().safeParse(await readJson(request,2048));if(!input.success)throw new ApiError(400,'INVALID_INPUT','Başvuru alanlarını kontrol edin.');const {client,demo}=await classroomContext();const {data,error}=await client.rpc('classroom_apply',{display_name:input.data.name,requested_role:input.data.role,invite_token:input.data.invite_token??null});if(error)databaseError(error);if(!demo)after(()=>deliverApplicationEmails().then(()=>undefined));return json({ok:true,id:data,state:await classroomState(client)});}catch(error){return errorResponse(error);}}
