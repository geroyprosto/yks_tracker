import type { SupabaseClient } from "@supabase/supabase-js";
import { commandSchema } from "../domain/commands";
import { emptyState, type AppState } from "../domain/types";
import { ApiError } from "./http";
export function databaseError(error:{message:string;code?:string}):never{
 const known:Record<string,[number,string]>={
  ACCESS_DENIED:[403,"Bu işlem için yetkiniz bulunmuyor."],
  ACCOUNT_REQUIRED:[403,"Önce başvurunuzu tamamlayın."],
  APPROVAL_REQUIRED:[403,"Yönetici onayınız bekleniyor veya erişiminiz durduruldu."],
  ADMIN_REQUIRED:[403,"Bu işlem yalnızca yönetici tarafından yapılabilir."],
  TEACHER_REQUIRED:[403,"Bu işlem için onaylı öğretmen hesabı gerekir."],
  STUDENT_REQUIRED:[403,"Bu işlem için onaylı öğrenci hesabı gerekir."],
  EMAIL_UNVERIFIED:[403,"Önce e-posta adresinizi doğrulayın."],
  EMAIL_VERIFICATION_REQUIRED:[403,"Önce e-posta adresinizi doğrulayın."],
  AUTH_REQUIRED:[401,"Devam etmek için giriş yapın."],
  INVITE_INVALID:[410,"Davet iptal edilmiş veya süresi dolmuş."],
  ALERT_LOCKED:[409,"Bu ekranın beş dakikalık süresi henüz dolmadı."],
  ROLE_CHANGE_FORBIDDEN:[409,"Mevcut hesabınızın rolü bu başvuruyla değiştirilemez."],
  PENDING_APPLICATION_EXISTS:[409,"Zaten değerlendirme bekleyen bir başvurunuz var."],
  INVALID_INVITE:[410,"Davet iptal edilmiş veya süresi dolmuş."],
  CONFLICT:[409,"Kayıt başka bir cihazda değişti. Güncel verileri alıp tekrar deneyin."],
  ACTIVE_SESSION:[409,"Zaten açık bir çalışma oturumu var. Önce onu bitirin."],
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
export async function getState(client:SupabaseClient):Promise<AppState>{
 const {data,error}=await client.rpc("yks_state");if(error)databaseError(error);
 return {...emptyState(true),...data,configured:true,authenticated:true} as AppState;
}
export async function executeCommand(client:SupabaseClient,input:unknown):Promise<{ok:true;id:string;request_id:string;replayed:boolean;state:AppState}>{
 const parsed=commandSchema.safeParse(input);
 if(!parsed.success)throw new ApiError(400,"INVALID_INPUT",parsed.error.issues[0]?.message??"Alanları kontrol edin.");
 const {data,error}=await client.rpc("yks_command",{request_id:parsed.data.request_id,command_type:parsed.data.type,payload:parsed.data.payload});
 if(error)databaseError(error);
 const result=data as {id:string;request_id:string;replayed:boolean};
 return {...result,ok:true,state:await getState(client)};
}


