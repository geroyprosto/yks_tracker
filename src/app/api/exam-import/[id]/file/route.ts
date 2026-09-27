import { requireAiStudyUser } from "@/lib/server/classroom";
import { downloadImportDocument } from "@/lib/server/exam-import";
import { errorResponse, privateHeaders } from "@/lib/server/http";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const blob=await downloadImportDocument(await requireAiStudyUser(),(await params).id);
  return new Response(blob,{headers:{
   ...privateHeaders,"Content-Type":"application/pdf","Content-Disposition":"inline; filename=exam-source.pdf",
  }});
 }catch(error){return errorResponse(error);}
}
