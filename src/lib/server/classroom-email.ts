import { createClient } from '@supabase/supabase-js';
import { getConfiguration } from './auth';
import type { ClassroomApplication, ClassroomAccount } from '../classroom/types';

export type ApplicationEmail = { id:string;name:string;email:string;requested_role:string;teacher_name?:string|null };
// Approval is handled in the app. Outbound administrator notifications require
// explicit opt-in, independently of Supabase's verification/recovery emails.
export function applicationEmailNotificationsEnabled() {
  return process.env.CLASSROOM_EMAIL_NOTIFICATIONS_ENABLED === 'true';
}
export function applicationEmail(application:ApplicationEmail,origin:string) {
  const to=process.env.ADMIN_NOTIFICATION_EMAIL??'admin@example.invalid';
  const reviewUrl=`${origin}/classroom?application=${encodeURIComponent(application.id)}`;
  return {to,subject:`YKSim · ${application.requested_role==='teacher'?'Öğretmen':'Öğrenci'} başvurusu`,
    body:`Ad: ${application.name}\nE-posta: ${application.email}\nİstenen rol: ${application.requested_role==='teacher'?'Öğretmen':'Öğrenci'}\nÖğretmen/sınıf: ${application.teacher_name??'Yönetici ataması bekleniyor'}\n\nBaşvuruyu incele, onayla veya reddet: ${reviewUrl}\n\nBağlantıyı açmak başvuruyu onaylamaz. Yönetici hesabınızla giriş yapıp açıkça karar vermelisiniz.`};
}
export function emailPreviews(applications:ClassroomApplication[],accounts:ClassroomAccount[],origin:string) {
  return applications.map(a=>applicationEmail({...a,teacher_name:accounts.find(t=>t.id===a.teacher_id)?.name},origin));
}
function emailDeliveryConfiguration() {
  if(!applicationEmailNotificationsEnabled())return null;
  const config=getConfiguration();const apiKey=process.env.RESEND_API_KEY;const from=process.env.CLASSROOM_EMAIL_FROM;const secret=process.env.SUPABASE_SECRET_KEY;const origin=process.env.APP_ORIGIN;
  if(!config||!apiKey||!from||!secret||!origin)return null;
  try {
    const url=new URL(origin);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))return null;
    return {url:config.url,apiKey,from,secret,origin:url.origin};
  } catch {return null;}
}
export function emailDeliveryConfigured() {return emailDeliveryConfiguration()!==null;}
export async function deliverApplicationEmails() {
  const config=emailDeliveryConfiguration();
  if(!config)return {configured:false,sent:0,failed:0};
  const {apiKey,from,secret,origin}=config;
  const client=createClient(config.url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const claim=await client.rpc('classroom_email_claim');if(claim.error)return {configured:true,sent:0,failed:1};
  let sent=0,failed=0;
  for(const application of (claim.data??[]) as ApplicationEmail[]) {
    const preview=applicationEmail(application,origin);let delivered=false;
    try{const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`yks-application-${application.id}`},body:JSON.stringify({from,to:[preview.to],subject:preview.subject,text:preview.body}),signal:AbortSignal.timeout(10000)});delivered=response.ok;}catch{/* The durable row is retried after its lease; secrets and provider responses never go to logs. */}
    await client.rpc('classroom_email_ack',{application_id:application.id,delivered});
    if(delivered)sent++;else failed++;
  }
  return {configured:true,sent,failed};
}
