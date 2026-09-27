import { authClient, getConfiguration } from "@/lib/server/auth";
import { loginSchema } from "@/lib/domain/commands";
import { ApiError, errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
import { clearDemoSession } from '@/lib/server/classroom-demo';
import { after } from 'next/server';
import { deliverApplicationEmails } from '@/lib/server/classroom-email';
import { ensureClassroomApplication } from '@/lib/server/classroom-application';
// This process-local guard supplements Supabase Auth's shared provider rate limits.
const attempts=new Map<string,{count:number;until:number}>();
export async function POST(request:Request){try{
 sameOrigin(request);const config=getConfiguration();if(!config)throw new ApiError(503,"SETUP_REQUIRED","Supabase ve sahip hesap kurulumu gerekli.");
 const result=loginSchema.safeParse(await readJson(request,4096));if(!result.success)throw new ApiError(400,"INVALID_INPUT","E-posta ve şifreyi kontrol edin.");
 const key=result.data.email.trim().toLowerCase();const now=Date.now();const bucket=attempts.get(key);if(bucket&&bucket.until>now&&bucket.count>=10)throw new ApiError(429,"RATE_LIMITED","Çok sayıda deneme yapıldı. Bir süre bekleyin.");
 attempts.set(key,{count:bucket&&bucket.until>now?bucket.count+1:1,until:bucket&&bucket.until>now?bucket.until:now+60000});
 const client=await authClient();const {data,error}=await client.auth.signInWithPassword(result.data);
 if(error||!data.user)throw new ApiError(401,"INVALID_LOGIN","Giriş bilgileri geçerli değil.");
 await clearDemoSession();
 const account=await ensureClassroomApplication(client,data.user);
 after(()=>deliverApplicationEmails().then(()=>undefined));
 attempts.delete(key);return json({ok:true,account,redirect:account?.role==='student'&&account?.status==='approved'?'/':'/classroom'});
 }catch(error){return errorResponse(error);}}
