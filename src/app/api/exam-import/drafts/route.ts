import { requireAiStudyUser } from "@/lib/server/classroom";
import { listImportDocuments } from "@/lib/server/exam-import";
import { errorResponse, json } from "@/lib/server/http";
export const runtime="nodejs";
export async function GET(){
 try{return json({documents:await listImportDocuments(await requireAiStudyUser())});}
 catch(error){return errorResponse(error);}
}
