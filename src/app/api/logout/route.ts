import { authClient } from "@/lib/server/auth";
import { ApiError, errorResponse, json, sameOrigin } from "@/lib/server/http";
import { clearDemoSession, demoUserId } from '@/lib/server/classroom-demo';
export async function POST(request:Request){try{sameOrigin(request);if(await demoUserId()){await clearDemoSession();return json({ok:true});}const client=await authClient();const {error}=await client.auth.signOut({scope:"local"});if(error)throw new ApiError(503,"LOGOUT_FAILED","Çıkış tamamlanamadı. Yeniden deneyin.");return json({ok:true});}catch(error){return errorResponse(error);}}
