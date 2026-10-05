import type { SupabaseClient } from "@supabase/supabase-js";
import { commandSchema } from "../domain/commands";
import { emptyState, type AppState } from "../domain/types";
import { ApiError } from "./http";
import { after } from 'next/server';
import { readStateWithCache } from './state-cache';
export function databaseError(error:{message:string;code?:string}):never{
 const known:Record<string,[number,string]>={
  ACCESS_DENIED:[403,"Bu işlem için yetkiniz bulunmuyor."],
  ACCOUNT_REQUIRED:[403,"Önce başvurunuzu tamamlayın."],
  APPROVAL_REQUIRED:[403,"Yönetici onayınız bekleniyor veya erişiminiz durduruldu."],
  ADMIN_REQUIRED:[403,"Bu işlem yalnızca yönetici tarafından yapılabilir."],
  ACCOUNT_DELETE_PROTECTED:[403,"Kendi hesabınızı veya yönetici hesaplarını silemezsiniz."],
  ACCOUNT_DELETE_CONFIRMATION:[400,"Onay için kişinin e-posta adresini aynen yazın."],
  ACCOUNT_DELETE_FILES_REMAIN:[409,"Hesaba ait dosyalar hâlâ mevcut. Silmeyi yeniden deneyin."],
  DELETE_CONFIRMATION_REQUIRED:[400,"Onay için kişinin e-posta adresini aynen yazın."],
  STORAGE_CLEANUP_REQUIRED:[409,"Hesaba ait dosyalar hâlâ mevcut. Silmeyi yeniden deneyin."],
  ACCOUNT_DELETION_IN_PROGRESS:[409,"Bu hesabın kalıcı silme işlemi başladı. Silmeyi yeniden deneyin."],
  TEACHER_REQUIRED:[403,"Bu işlem için onaylı öğretmen hesabı gerekir."],
  STUDENT_REQUIRED:[403,"Bu işlem için onaylı öğrenci hesabı gerekir."],
  EMAIL_UNVERIFIED:[403,"Önce e-posta adresinizi doğrulayın."],
  EMAIL_VERIFICATION_REQUIRED:[403,"Önce e-posta adresinizi doğrulayın."],
  AUTH_REQUIRED:[401,"Devam etmek için giriş yapın."],
  INVITE_INVALID:[410,"Davet iptal edilmiş veya süresi dolmuş."],
  SELF_INVITE:[409,"Kendi davetini kabul edemezsin."],
  ALREADY_FRIENDS:[409,"Zaten bu grubun bir üyesisin."],
  GROUP_NOT_FOUND:[404,"Bu gruba erişimin yok veya grup artık mevcut değil."],
  GROUP_OWNER_REQUIRED:[403,"Başka bir üyeyi yalnızca grup yöneticisi çıkarabilir."],
  ALERT_LOCKED:[409,"Bu ekranın beş dakikalık süresi henüz dolmadı."],
  ROLE_CHANGE_FORBIDDEN:[409,"Mevcut hesabınızın rolü bu başvuruyla değiştirilemez."],
  PENDING_APPLICATION_EXISTS:[409,"Zaten değerlendirme bekleyen bir başvurunuz var."],
  INVALID_INVITE:[410,"Davet iptal edilmiş veya süresi dolmuş."],
  CONFLICT:[409,"Kayıt başka bir cihazda değişti. Güncel verileri alıp tekrar deneyin."],
  ACTIVE_SESSION:[409,"Zaten açık bir çalışma oturumu var. Önce onu bitirin."],
  DURATION_IMMUTABLE:[409,"Kesinleşmiş çalışma süresi değiştirilemez."],
  DUPLICATE_COURSE:[409,"Bu ders aynı dönemde ve çalışma bağlamında zaten var."],
  CONFIRM_DURATION:[422,"Uzun süreli oturumun gerçek çalışma süresini doğrulayın."],
  INVALID_TRANSITION:[409,"Sayaç durumu değişti. Güncel verileri alıp tekrar deneyin."],
  OWNER_REQUIRED:[403,"Bu hesap için erişim tanımlı değil."],NOT_FOUND:[404,"Kayıt bulunamadı."],
  INVALID_INPUT:[400,"Girdi veya ilişkili kayıt geçerli değil."],
  IDEMPOTENCY_CONFLICT:[409,"İstek kimliği başka bir işlem için kullanılmış."],
  JOURNAL_EXISTS:[409,"Bu gün için bir günlük kaydı zaten var. Mevcut kaydı düzenleyin."],
  IMPORT_ALREADY_SAVED:[409,"Bu PDF sonucu zaten kaydedildi."],
  POSSIBLE_DUPLICATE:[409,"Benzer bir deneme kaydı var. Kaydetmeden önce karşılaştırın."],
  RATE_LIMITED:[429,"Çok sayıda işlem yapıldı. Bir dakika sonra yeniden deneyin."],
 };
 const key=Object.keys(known).find(key=>error.message===key);
 if(key)throw new ApiError(known[key][0],key,known[key][1]);
 if(error.code?.startsWith("22")||error.code?.startsWith("23"))throw new ApiError(400,"INVALID_INPUT","Alanlar veya ilişkili kayıtlar geçerli değil.");
 if(error.code==="PGRST202"||error.code==="42P01")throw new ApiError(503,"DATABASE_SETUP_REQUIRED","Veritabanı migration kurulumu gerekli.");
 throw new ApiError(503,"DATABASE_UNAVAILABLE","Veritabanı işlemi tamamlanamadı. Bağlantıyı ve kurulumu kontrol edin.");
}
export async function getState(client:SupabaseClient,verifiedUserId?:string):Promise<AppState>{
 return readStateWithCache(client,async()=>{
  const {data,error}=await client.rpc("yks_state");if(error)databaseError(error);
  return {...emptyState(true),...data,configured:true,authenticated:true} as AppState;
 },{verifiedUserId,defer:work=>{try{after(work);}catch{void work();}}});
}
export async function authorizeStudyCommand(client:SupabaseClient):Promise<SupabaseClient>{
 const {data,error}=await client.rpc('classroom_identity');
 if(error){
  // The database verifies the JWT for the usual path. An Auth check on failure
  // preserves the existing sign-in error when the token cannot be refreshed.
  const verified=await client.auth.getUser();
  if(verified.error||!verified.data.user)throw new ApiError(401,'SIGN_IN_REQUIRED','Devam etmek için giriş yapın.');
  databaseError(error);
 }
 const account=data as {status:string;role:string}|null;
 if(!account||account.status!=='approved'||account.role!=='student')throw new ApiError(403,'STUDENT_REQUIRED','Çalışma verilerine erişmek için onaylı öğrenci hesabı gerekir.');
 return client;
}
export type CommandReceipt = {ok:true;id:string;request_id:string;replayed:boolean};
export type CommandResponse = CommandReceipt & {state:AppState};
/** The live approved-student gate and durable write execute in one database transaction. */
export async function executeStudentCommand(client:SupabaseClient,input:unknown):Promise<CommandReceipt>{
 const parsed=commandSchema.safeParse(input);
 if(!parsed.success)throw new ApiError(400,"INVALID_INPUT",parsed.error.issues[0]?.message??"Alanları kontrol edin.");
 const {data,error}=await client.rpc("yks_student_command",{request_id:parsed.data.request_id,command_type:parsed.data.type,payload:parsed.data.payload});
 if(error){
  // PostgREST rejects invalid JWTs and anonymous function calls before the SQL
  // gate runs. Contact Auth only on this error path to retain the sign-in error.
  if(error.message==='AUTH_REQUIRED'||error.code==='42501'||error.code?.startsWith('PGRST3')||/\b(jwt|token)\b/i.test(error.message)){
   const verified=await client.auth.getUser();
   if(verified.error||!verified.data.user)throw new ApiError(401,'SIGN_IN_REQUIRED','Devam etmek için giriş yapın.');
  }
  databaseError(error);
 }
 return {...data as {id:string;request_id:string;replayed:boolean},ok:true};
}
export async function executeCommand(client:SupabaseClient,input:unknown):Promise<CommandResponse>;
export async function executeCommand(client:SupabaseClient,input:unknown,options:{minimal:true}):Promise<CommandReceipt>;
export async function executeCommand(client:SupabaseClient,input:unknown,options:{minimal:boolean}):Promise<CommandReceipt|CommandResponse>;
export async function executeCommand(client:SupabaseClient,input:unknown,options:{minimal:boolean}={minimal:false}):Promise<CommandReceipt|CommandResponse>{
 const parsed=commandSchema.safeParse(input);
 if(!parsed.success)throw new ApiError(400,"INVALID_INPUT",parsed.error.issues[0]?.message??"Alanları kontrol edin.");
 const {data,error}=await client.rpc("yks_command",{request_id:parsed.data.request_id,command_type:parsed.data.type,payload:parsed.data.payload});
 if(error)databaseError(error);
 const result=data as {id:string;request_id:string;replayed:boolean};
 const receipt:CommandReceipt={...result,ok:true};
 if(options.minimal)return receipt;
 return {...receipt,state:await getState(client)};
}


