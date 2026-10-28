import { authClient, getConfiguration } from "@/lib/server/auth";
import { loginSchema } from "@/lib/domain/commands";
import { ApiError, errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
import { clearDemoSession } from '@/lib/server/classroom-demo';
import { after } from 'next/server';
import { deliverApplicationEmails } from '@/lib/server/classroom-email';
import { ensureClassroomApplication } from '@/lib/server/classroom-application';
import { requireLoginAttempt } from '@/lib/server/auth-rate-limit';
export async function POST(request:Request){try{
 sameOrigin(request);const config=getConfiguration();if(!config)throw new ApiError(503,"SETUP_REQUIRED","Supabase ve sahip hesap kurulumu gerekli.");
 const result=loginSchema.safeParse(await readJson(request,4096));if(!result.success)throw new ApiError(400,"INVALID_INPUT","E-posta ve şifreyi kontrol edin.");
 await requireLoginAttempt(request,result.data.email);
 const client=await authClient();const {data,error}=await client.auth.signInWithPassword(result.data);
 if(error||!data.user)throw new ApiError(401,"INVALID_LOGIN","Giriş bilgileri geçerli değil.");
 await clearDemoSession();
 const account=await ensureClassroomApplication(client,data.user);
 after(()=>deliverApplicationEmails().then(()=>undefined));
 return json({ok:true,account,redirect:account?.role==='student'&&account?.status==='approved'?'/':'/classroom'});
 }catch(error){return errorResponse(error);}}
