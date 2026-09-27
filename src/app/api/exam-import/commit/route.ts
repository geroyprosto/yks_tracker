import { requireAiStudyUser } from "@/lib/server/classroom";
import { commitImportDocument } from "@/lib/server/exam-import";
import { errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
export const runtime="nodejs";
export async function POST(request:Request){
 try{sameOrigin(request);const client=await requireAiStudyUser();
  return json(await commitImportDocument(client,await readJson(request)));}
 catch(error){return errorResponse(error);}
}
