import { getConfiguration } from "@/lib/server/auth";
import { classroomContext } from "@/lib/server/classroom";
import { demoUserId } from "@/lib/server/classroom-demo";
import { getState } from "@/lib/server/service";
import { ApiError, errorResponse, json } from "@/lib/server/http";
import { emptyState } from "@/lib/domain/types";
export const dynamic="force-dynamic";
export async function GET(){
 try{if(!getConfiguration()&&!await demoUserId())return json(emptyState());
  const {client,account}=await classroomContext();
  if(!account||account.status!=='approved'||account.role!=='student')return json({...emptyState(true),redirect:'/classroom'},403);
  return json(await getState(client));}catch(error){
  if(error instanceof ApiError&&error.status===401)return json({...emptyState(true),error:{code:error.code,message:error.message}},401);
  return errorResponse(error);
 }
}
