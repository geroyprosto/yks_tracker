import { getConfiguration, requireOwner } from "@/lib/server/auth";
import { getState } from "@/lib/server/service";
import { ApiError, errorResponse, json } from "@/lib/server/http";
import { emptyState } from "@/lib/domain/types";
export const dynamic="force-dynamic";
export async function GET(){
 if(!getConfiguration())return json(emptyState());
 try{return json(await getState(await requireOwner()));}catch(error){
  if(error instanceof ApiError&&error.status===401)return json({...emptyState(true),error:{code:error.code,message:error.message}},401);
  return errorResponse(error);
 }
}
