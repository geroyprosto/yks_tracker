import { z } from 'zod';
import { classroomContext, classroomState } from '@/lib/server/classroom';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { databaseError } from '@/lib/server/service';
import { emailPreviews, deliverApplicationEmails, emailDeliveryConfigured, applicationEmailNotificationsEnabled } from '@/lib/server/classroom-email';
import { after } from 'next/server';
import { deleteClassroomAccount, accountDeletionSchema, requireAccountDeletionAdmin } from '@/lib/server/classroom-account-deletion';
import { deleteDemoClassroomAccount } from '@/lib/server/classroom-demo';
import { isPausedPresenceCommand, requireClassroomCommandAvailable } from '@/lib/server/classroom-availability';
export const dynamic='force-dynamic';
export const maxDuration=60;
const command=z.object({request_id:z.uuid(),type:z.string().min(1).max(80),payload:z.record(z.string(),z.unknown())}).strict();
export async function GET(request:Request){try{const {client,demo,account}=await classroomContext();const state=await classroomState(client,account);const email_preview=applicationEmailNotificationsEnabled()&&state.account?.role==='admin'&&state.account?.status==='approved'?emailPreviews(state.applications,state.accounts,process.env.APP_ORIGIN??new URL(request.url).origin):undefined;if(!demo&&email_preview)after(()=>deliverApplicationEmails().then(()=>undefined));return json({...state,demo,email_preview,email_configured:!demo&&emailDeliveryConfigured()});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{
  sameOrigin(request);const parsed=command.safeParse(await readJson(request,12000));
  if(!parsed.success)throw new ApiError(400,'INVALID_INPUT','İşlem alanlarını kontrol edin.');
  // Old open tabs may still send heartbeats. Acknowledge without auth, database
  // writes, or an expensive classroom snapshot while teacher updates are paused.
  if(isPausedPresenceCommand(parsed.data.type))return json({ok:true,paused:true});
  const context=await classroomContext();const {client,demo}=context;
  requireClassroomCommandAvailable(context.account,parsed.data.type);
  if(parsed.data.type==='account.delete'){
    const input=accountDeletionSchema.safeParse(parsed.data.payload);
    if(!input.success)throw new ApiError(400,'INVALID_INPUT','Silinecek kişinin bilgilerini kontrol edin.');
    requireAccountDeletionAdmin(context,input.data.id);
    const result=demo?await deleteDemoClassroomAccount(context.user.id,input.data):await deleteClassroomAccount(context,input.data);
    return json({ok:true,result,state:{...await classroomState(client,context.account),demo}});
  }
  const {data,error}=await client.rpc('classroom_command',{request_id:parsed.data.request_id,command_type:parsed.data.type,payload:parsed.data.payload});
  if(error)databaseError(error);
  return json({ok:true,result:data,state:{...await classroomState(client),demo}});
}catch(error){return errorResponse(error);}}
