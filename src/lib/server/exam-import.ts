import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { commandSchema } from "../domain/commands";
import { extractPdfDraft, MAX_PDF_BYTES, PdfImportError, validatePdfUpload } from "../exam-import/extract";
import type { ImportCandidate, ImportDocument } from "../exam-import/types";
import { extractVisualCandidates } from "../exam-import/visual";
import { ApiError } from "./http";
import { databaseError, getState } from "./service";

const bucket = "exam-documents";
type DocumentRow = Omit<ImportDocument,"committed_candidate_indexes"> & {storage_path:string; user_id:string};
const uuid = z.uuid();
const commitSchema = z.object({
  request_id:uuid,document_id:uuid,candidate_index:z.number().int().min(0).max(49),
  exam:z.unknown(),accept_possible_duplicate:z.boolean().optional(),
}).strict();

function fail(error:{message:string;code?:string}):never {
  if (error.message === "IMPORT_ALREADY_SAVED" || error.message === "POSSIBLE_DUPLICATE"
      || error.message === "IDEMPOTENCY_CONFLICT" || error.message === "OWNER_REQUIRED"
      || error.message === "INVALID_INPUT" || error.message === "NOT_FOUND") databaseError(error);
  if (error.code === "PGRST202" || error.code === "42P01") databaseError(error);
  throw new ApiError(503,"DATABASE_UNAVAILABLE","PDF kayıtlarına ulaşılamadı. Kurulumu ve bağlantıyı kontrol edin.");
}
async function ownerId(client:SupabaseClient):Promise<string> {
  const {data,error}=await client.auth.getUser();
  if (error || !data.user) throw new ApiError(401,"SIGN_IN_REQUIRED","Devam etmek için giriş yapın.");
  return data.user.id;
}
const safeName = (name:string) => name.normalize("NFKC")
  .replace(/[\\/\u0000-\u001f\u007f]/g,"_").slice(0,255).trim() || "deneme.pdf";

async function withCommitIndexes(client:SupabaseClient,rows:DocumentRow[]):Promise<ImportDocument[]> {
  if (!rows.length) return [];
  const {data,error}=await client.from("exam_imports")
    .select("document_id,candidate_index").in("document_id",rows.map(row=>row.id));
  if (error) fail(error);
  const byDocument=new Map<string,number[]>();
  for (const value of data??[]) {
    const indexes=byDocument.get(value.document_id)??[];
    indexes.push(value.candidate_index);
    byDocument.set(value.document_id,indexes);
  }
  return rows.map(row=>({
    id:row.id,original_filename:row.original_filename,sha256:row.sha256,
    page_count:row.page_count,extraction_status:row.extraction_status,
    visual_extraction_status:row.visual_extraction_status??"not_needed",
    candidates:row.candidates as ImportCandidate[],
    committed_candidate_indexes:(byDocument.get(row.id)??[]).sort((a,b)=>a-b),
    created_at:row.created_at,
  }));
}
export async function listImportDocuments(client:SupabaseClient):Promise<ImportDocument[]> {
  const {data,error}=await client.from("exam_documents")
    .select("id,original_filename,sha256,page_count,extraction_status,visual_extraction_status,candidates,created_at,storage_path,user_id")
    .order("created_at",{ascending:false}).limit(30);
  if (error) fail(error);
  return withCommitIndexes(client,(data??[]) as DocumentRow[]);
}
export async function findImportDocument(client:SupabaseClient,id:string):Promise<{document:ImportDocument;storagePath:string}> {
  const parsed=uuid.safeParse(id);
  if (!parsed.success) throw new ApiError(400,"INVALID_INPUT","Belge kimliği geçersiz.");
  const {data,error}=await client.from("exam_documents")
    .select("id,original_filename,sha256,page_count,extraction_status,visual_extraction_status,candidates,created_at,storage_path,user_id")
    .eq("id",id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError(404,"NOT_FOUND","PDF bulunamadı.");
  const [document]=await withCommitIndexes(client,[data as DocumentRow]);
  return {document,storagePath:(data as DocumentRow).storage_path};
}
function storageFailure():never {
  throw new ApiError(503,"PDF_STORAGE_UNAVAILABLE","Özel PDF deposu kurulamadı veya erişilemiyor.");
}
export async function uploadImportDocument(client:SupabaseClient,file:File,allowVisualExtraction=false):Promise<{document:ImportDocument;duplicate_upload:boolean}> {
  if (file.size>MAX_PDF_BYTES) throw new ApiError(413,"PDF_TOO_LARGE","PDF en fazla 10 MB olabilir.");
  const bytes=new Uint8Array(await file.arrayBuffer());
  const filename=safeName(file.name);
  try { validatePdfUpload(bytes,file.type,filename); }
  catch (error) {
    if (error instanceof PdfImportError) throw new ApiError(error.status,error.code,error.message);
    throw error;
  }
  const sha256=createHash("sha256").update(bytes).digest("hex");
  const {data:existing,error:lookupError}=await client.from("exam_documents")
    .select("id").eq("sha256",sha256).maybeSingle();
  if (lookupError) fail(lookupError);
  if (existing) return {document:(await findImportDocument(client,existing.id)).document,duplicate_upload:true};
  let extracted:Awaited<ReturnType<typeof extractPdfDraft>>;
  try { extracted=await extractPdfDraft(bytes); }
  catch (error) {
    if (error instanceof PdfImportError) throw new ApiError(error.status,error.code,error.message);
    throw error;
  }
  let visualStatus:NonNullable<ImportDocument["visual_extraction_status"]>="not_needed";
  if(extracted.vision_pages.length) {
    if(allowVisualExtraction) {
      const visual=await extractVisualCandidates(bytes,extracted.vision_pages);
      visualStatus=visual.status;
      if(visual.candidates.length) {
        const recognizedPages=new Set(visual.candidates.flatMap(candidate=>candidate.source_pages));
        extracted.candidates=extracted.candidates.filter(candidate=>
          candidate.results.length>0 || candidate.reported_total_net!==null ||
          !candidate.source_pages.some(page=>recognizedPages.has(page)));
        extracted.candidates.push(...visual.candidates);
        extracted.candidates=extracted.candidates.slice(0,50)
          .map((candidate,index)=>({...candidate,index}));
      }
      if(visual.warnings.length) extracted.candidates[0]?.warnings.push(...visual.warnings);
    } else {
      visualStatus="skipped_by_user";
      extracted.candidates[0]?.warnings.push("Görsel okuma seçilmedi; PDF'yi açıp alanları elle doğrulayın.");
    }
    extracted.extraction_status=extracted.candidates.some(candidate=>
      candidate.results.length>0 || candidate.reported_total_net!==null)?"ready":"needs_visual_review";
  }
  const path=(await ownerId(client)) + "/" + sha256 + ".pdf";
  const uploaded=await client.storage.from(bucket).upload(path,bytes,{
    contentType:"application/pdf",upsert:false,cacheControl:"0",
  });
  if (uploaded.error) {
    // A prior request may have written the object before its metadata transaction.
    // Reuse it only after comparing the actual stored bytes with the claimed hash.
    if (String(uploaded.error).includes("409") || /already exists|duplicate/i.test(uploaded.error.message)) {
      const downloaded=await client.storage.from(bucket).download(path);
      if (downloaded.error || !downloaded.data) storageFailure();
      const previous=new Uint8Array(await downloaded.data.arrayBuffer());
      if (createHash("sha256").update(previous).digest("hex")!==sha256) storageFailure();
    } else storageFailure();
  }
  const registration=await client.rpc("exam_import_register",{
    digest_sha256:sha256,original_filename:filename,byte_size:bytes.byteLength,
    page_count:extracted.page_count,extraction_status:extracted.extraction_status,
    visual_extraction_status:visualStatus,
    candidates:extracted.candidates,
  });
  if (registration.error) fail(registration.error);
  const result=registration.data as {id:string;duplicate_upload:boolean};
  return {document:(await findImportDocument(client,result.id)).document,
    duplicate_upload:result.duplicate_upload};
}
export async function commitImportDocument(client:SupabaseClient,input:unknown):
 Promise<{id:string;request_id:string;replayed:boolean;state:Awaited<ReturnType<typeof getState>>}> {
  const parsed=commitSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400,"INVALID_INPUT",parsed.error.issues[0]?.message??"Alanları kontrol edin.");
  const envelope=commandSchema.safeParse({
    request_id:parsed.data.request_id,type:"exam.create",payload:parsed.data.exam,
  });
  if (!envelope.success) throw new ApiError(400,"INVALID_INPUT",envelope.error.issues[0]?.message??"Deneme alanlarını kontrol edin.");
  const response=await client.rpc("exam_import_commit",{
    request_id:parsed.data.request_id,document_id:parsed.data.document_id,
    candidate_index:parsed.data.candidate_index,exam_payload:envelope.data.payload,
    accept_possible_duplicate:parsed.data.accept_possible_duplicate??false,
  });
  if (response.error) fail(response.error);
  const result=response.data as {id:string;request_id:string;replayed:boolean};
  return {...result,state:await getState(client)};
}
export async function downloadImportDocument(client:SupabaseClient,id:string):Promise<Blob> {
  const {storagePath}=await findImportDocument(client,id);
  const {data,error}=await client.storage.from(bucket).download(storagePath);
  if (error || !data) storageFailure();
  return data;
}
