import type { SupabaseClient } from '@supabase/supabase-js';
import { authClient, requireOwner } from './auth';
import { demoClient, demoEnabled, demoUserId } from './classroom-demo';
import { ApiError } from './http';
import { databaseError } from './service';
import type { AccountIdentity } from './classroom-application';
export type { AccountIdentity } from './classroom-application';
export async function classroomContext({readOnly=false}:{readOnly?:boolean}={}) {
  const demoId = await demoUserId();
  const client = demoId ? demoClient(demoId) : await authClient({readOnly});
  const {data,error} = await client.auth.getUser();
  if (error || !data.user) throw new ApiError(401,'SIGN_IN_REQUIRED','Devam etmek için giriş yapın.');
  const identity = await client.rpc('classroom_identity');
  if (identity.error) databaseError(identity.error);
  return {client, user:data.user, account:identity.data as AccountIdentity|null, demo:Boolean(demoId)};
}
export async function classroomState(client:SupabaseClient) {
  const {data,error}=await client.rpc('classroom_state');
  if(error)databaseError(error);
  return data;
}
export async function requireStudyUser() {
  const context=await classroomContext();
  if(!context.account || context.account.status!=='approved' || context.account.role!=='student') throw new ApiError(403,'STUDENT_REQUIRED','Çalışma verilerine erişmek için onaylı öğrenci hesabı gerekir.');
  return context.client;
}
export async function requireAiStudyUser() {
  const context=await classroomContext();
  if(context.demo)throw new ApiError(403,'DEMO_INTEGRATION_DISABLED','Bu harici entegrasyon demo ortamında kullanılamaz.');
  if(!context.account || context.account.status!=='approved')
    throw new ApiError(403,'APPROVAL_REQUIRED','Bu hesabın erişimi onaylanmamış veya durdurulmuş.');
  if(context.account.role==='student')return context.client;
  if(context.account.role==='admin')return requireOwner();
  throw new ApiError(403,'STUDENT_REQUIRED','Bu işlem için onaylı öğrenci hesabı gerekir.');
}
export async function publicClassroomClient() { return demoEnabled() ? demoClient(null) : authClient(); }
