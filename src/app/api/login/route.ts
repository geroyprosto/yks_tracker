import { authClient, getConfiguration } from "@/lib/server/auth";
import { loginSchema } from "@/lib/domain/commands";
import { ApiError, errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
// This process-local guard supplements Supabase Auth's shared provider rate limits.
const attempts=new Map<string,{count:number;until:number}>();
export async function POST(request:Request){try{
 sameOrigin(request);const config=getConfiguration();if(!config)throw new ApiError(503,"SETUP_REQUIRED","Supabase ve sahip hesap kurulumu gerekli.");
 const result=loginSchema.safeParse(await readJson(request,4096));if(!result.success)throw new ApiError(400,"INVALID_INPUT","E-posta ve şifreyi kontrol edin.");
 const key="owner-login";const now=Date.now();const bucket=attempts.get(key);if(bucket&&bucket.until>now&&bucket.count>=10)throw new ApiError(429,"RATE_LIMITED","Çok sayıda deneme yapıldı. Bir süre bekleyin.");
 attempts.set(key,{count:bucket&&bucket.until>now?bucket.count+1:1,until:bucket&&bucket.until>now?bucket.until:now+60000});
 if(result.data.email.trim().toLowerCase()!==config.email)throw new ApiError(401,"INVALID_LOGIN","Giriş bilgileri geçerli değil.");
 const client=await authClient();const {data,error}=await client.auth.signInWithPassword(result.data);
 if(error||!data.user)throw new ApiError(401,"INVALID_LOGIN","Giriş bilgileri geçerli değil.");
 const allowed=await client.from("owner_allowlist").select("user_id").eq("user_id",data.user.id).maybeSingle();
 if(allowed.error||!allowed.data){await client.auth.signOut({scope:"local"});throw new ApiError(403,"OWNER_REQUIRED","Sahip hesap erişimi henüz tanımlı değil.");}
 attempts.delete(key);return json({ok:true});
 }catch(error){return errorResponse(error);}}
