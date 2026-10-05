import { requireStudyUser } from "@/lib/server/classroom";
import { authClient } from "@/lib/server/auth";
import { demoClient, demoUserId } from "@/lib/server/classroom-demo";
import { authorizeStudyCommand, executeCommand } from "@/lib/server/service";
import { errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
export async function POST(request:Request){
 const appStarted=performance.now();
 try{
  sameOrigin(request);
  const minimal=request.headers.get('prefer')?.split(',').some(value=>value.trim().toLowerCase()==='return=minimal')??false;
  let client;
  let authorizationMs;
  if(minimal){
   const demoId=await demoUserId();
   const candidate=demoId?demoClient(demoId):await authClient();
   const authorizationStarted=performance.now();
   client=await authorizeStudyCommand(candidate);
   authorizationMs=performance.now()-authorizationStarted;
  }else{
   const authorizationStarted=performance.now();
   client=await requireStudyUser();
   authorizationMs=performance.now()-authorizationStarted;
  }
  const input=await readJson(request);
  const commandStarted=performance.now();
  const result=await executeCommand(client,input,{minimal});
  const commandMs=performance.now()-commandStarted;
  const response=json(result);
  // Durations contain no account, command, payload or database identifiers.
  // Full-response commands also include their state read in this stage.
  response.headers.set('Server-Timing',`auth_db;dur=${authorizationMs.toFixed(1)}, command;dur=${commandMs.toFixed(1)}, app;dur=${(performance.now()-appStarted).toFixed(1)}`);
  return response;
 }catch(error){return errorResponse(error);}
}
