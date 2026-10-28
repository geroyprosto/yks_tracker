import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {getConfiguration} from './auth';
import {ApiError} from './http';

type LoginLimitDependencies={service:Pick<SupabaseClient,'rpc'>;secret:string;trustedProxy?:boolean};

/** Only Vercel's platform-added header is trusted; other hosts share a bounded fallback bucket. */
export function authAttemptDigests(request:Request,email:string,secret:string,trustedProxy=process.env.VERCEL==='1'){
 const candidate=trustedProxy?request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim():null;
 const ip=candidate&&isIP(candidate)?candidate:null;
 const digest=(value:string)=>createHmac('sha256',secret).update(value).digest('hex');
 return {ip_digest:ip?digest(`ip:${ip}`):null,email_digest:digest(`email:${email.trim().toLowerCase()}`)};
}

/** The shared database enforces TTL, capacity and counters atomically before contacting Auth. */
export async function requireLoginAttempt(request:Request,email:string,dependencies?:LoginLimitDependencies){
 try{
  let configured=dependencies;
  if(!configured){
   const config=getConfiguration();
   const secret=process.env.SUPABASE_SECRET_KEY?.trim();
   if(!config||!secret)throw new Error('Login limit is not configured');
   configured={secret,service:createClient(config.url,secret,{
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},
   })};
  }
  if(!configured.secret.trim())throw new Error('Login limit secret is missing');
  const {data,error}=await configured.service.rpc('classroom_login_allowed',
   authAttemptDigests(request,email,configured.secret,configured.trustedProxy));
  if(error||typeof data!=='boolean')throw new Error('Login limit is unavailable');
  if(!data)throw new ApiError(429,'RATE_LIMITED','Çok sayıda deneme yapıldı. Bir dakika sonra yeniden deneyin.');
 }catch(error){
  if(error instanceof ApiError&&error.code==='RATE_LIMITED')throw error;
  // Upstream diagnostics can contain SQL, account identifiers or credentials.
  console.error('LOGIN_RATE_LIMIT_UNAVAILABLE');
  throw new ApiError(503,'LOGIN_UNAVAILABLE','Giriş güvenlik kontrolü şu anda tamamlanamıyor. Biraz sonra yeniden deneyin.');
 }
}
