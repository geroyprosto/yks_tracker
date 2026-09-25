import { requireOwner } from "@/lib/server/auth";
import { uploadImportDocument } from "@/lib/server/exam-import";
import { ApiError, errorResponse, json, sameOrigin } from "@/lib/server/http";
import { MAX_PDF_BYTES } from "@/lib/exam-import/extract";

export const runtime="nodejs";
export const maxDuration=300;
export const MAX_MULTIPART_BYTES=MAX_PDF_BYTES+1024*1024;

export async function boundedMultipartForm(request:Request):Promise<FormData> {
  const contentType=request.headers.get("content-type");
  if(!contentType?.toLowerCase().startsWith("multipart/form-data"))
    throw new ApiError(415,"MULTIPART_REQUIRED","PDF dosyası seçin.");
  const declared=Number(request.headers.get("content-length")??0);
  if(Number.isFinite(declared) && declared>MAX_MULTIPART_BYTES)
    throw new ApiError(413,"PDF_TOO_LARGE","PDF en fazla 10 MB olabilir.");
  if(!request.body) throw new ApiError(400,"INVALID_INPUT","PDF dosyası seçin.");
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let length=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      length+=value.byteLength;
      if(length>MAX_MULTIPART_BYTES) {
        await reader.cancel();
        throw new ApiError(413,"PDF_TOO_LARGE","PDF en fazla 10 MB olabilir.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {
    return await new Request("http://localhost/exam-import",{
      method:"POST",headers:{"content-type":contentType},body:bytes,
    }).formData();
  } catch {
    throw new ApiError(400,"INVALID_MULTIPART","PDF yükleme verisi okunamadı.");
  }
}
export function visualConsent(form:FormData):boolean {
  const consent=form.getAll("allow_visual_extraction");
  if(consent.length>1 || consent.length===1 &&
    consent[0]!=="true" && consent[0]!=="false")
    throw new ApiError(400,"INVALID_INPUT","Görsel okuma seçimini kontrol edin.");
  return consent[0]==="true";
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const client=await requireOwner();
  const form=await boundedMultipartForm(request);
  const files=form.getAll("file");
  if(files.length!==1 || !(files[0] instanceof File))
   throw new ApiError(400,"INVALID_INPUT","Bir PDF dosyası seçin.");
  return json(await uploadImportDocument(client,files[0],visualConsent(form)));
 }catch(error){return errorResponse(error);}
}