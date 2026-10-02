import { requireStudyUser } from "@/lib/server/classroom";
import { authClient } from "@/lib/server/auth";
import { demoClient, demoUserId } from "@/lib/server/classroom-demo";
import { authorizeStudyCommand, executeCommand } from "@/lib/server/service";
import { errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const minimal=request.headers.get('prefer')?.split(',').some(value=>value.trim().toLowerCase()==='return=minimal')??false;
  let client;
  if(minimal){
   const demoId=await demoUserId();
   client=await authorizeStudyCommand(demoId?demoClient(demoId):await authClient());
  }else client=await requireStudyUser();
  return json(await executeCommand(client,await readJson(request),{minimal}));
 }catch(error){return errorResponse(error);}
}
