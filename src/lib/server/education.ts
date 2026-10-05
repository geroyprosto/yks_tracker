import type { SupabaseClient } from '@supabase/supabase-js';
import { educationCommandSchema, type EducationState } from '../education';
import { classroomContext } from './classroom';
import { ApiError } from './http';
import { databaseError } from './service';
import {scheduleStudyDirty,type StudyDirtyOptions} from './study-realtime';

export async function requireEducationUser() {
  const context=await classroomContext();
  if(!context.user.email_confirmed_at)throw new ApiError(403,'EMAIL_VERIFICATION_REQUIRED','Önce e-posta adresinizi doğrulayın.');
  if(context.account?.role!=='student'||!['pending','approved'].includes(context.account.status))throw new ApiError(403,'STUDENT_REQUIRED','Öğrenci profiline erişmek için öğrenci hesabı gerekir.');
  return context.client;
}
export async function getEducation(client:SupabaseClient):Promise<EducationState>{
  const {data,error}=await client.rpc('education_state');if(error)databaseError(error);return data as EducationState;
}
export type EducationCommandReceipt={ok:true;result:{id:string;request_id:string;replayed:boolean}};
export type EducationCommandResponse=EducationCommandReceipt&{state:EducationState};
export async function executeEducationCommand(client:SupabaseClient,input:unknown):Promise<EducationCommandResponse>;
export async function executeEducationCommand(client:SupabaseClient,input:unknown,options:{minimal:true;notification?:StudyDirtyOptions}):Promise<EducationCommandReceipt>;
export async function executeEducationCommand(client:SupabaseClient,input:unknown,options:{minimal:boolean;notification?:StudyDirtyOptions}):Promise<EducationCommandReceipt|EducationCommandResponse>;
export async function executeEducationCommand(client:SupabaseClient,input:unknown,options:{minimal:boolean;notification?:StudyDirtyOptions}={minimal:false}):Promise<EducationCommandReceipt|EducationCommandResponse>{
  const parsed=educationCommandSchema.safeParse(input);
  if(!parsed.success)throw new ApiError(400,'INVALID_INPUT',parsed.error.issues[0]?.message??'Alanları kontrol edin.');
  const {data,error}=await client.rpc('education_command',{request_id:parsed.data.request_id,command_type:parsed.data.type,payload:parsed.data.payload});
  if(error)databaseError(error);
  scheduleStudyDirty(client,options.notification);
  const receipt:EducationCommandReceipt={ok:true,result:data as EducationCommandReceipt['result']};
  if(options.minimal)return receipt;
  return {...receipt,state:await getEducation(client)};
}
