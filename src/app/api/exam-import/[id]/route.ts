import { requireOwner } from "@/lib/server/auth";
import { findImportDocument } from "@/lib/server/exam-import";
import { errorResponse, json } from "@/lib/server/http";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{return json((await findImportDocument(await requireOwner(),(await params).id)).document);}
 catch(error){return errorResponse(error);}
}
