import {createHash} from 'node:crypto';
import {Realtime} from '@upstash/realtime';
import {Redis} from '@upstash/redis';
import type {SupabaseClient} from '@supabase/supabase-js';
import {after} from 'next/server';
import {studyRealtimeSchema} from '../realtime-schema';

let cachedRedis:Redis|null=null;
let cachedCredentials='';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function studyRealtimeRedis():Redis|null{
  // Generated demo identities and records never reach the production database.
  if(process.env.CLASSROOM_DEMO_ENABLED==='true')return null;
  const url=process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token=process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if(!url||!token)return null;
  try{if(new URL(url).protocol!=='https:')return null;}catch{return null;}
  const credentials=url+'\n'+token;
  if(credentials!==cachedCredentials){
    cachedRedis=new Redis({url,token,retry:false,signal:()=>AbortSignal.timeout(500),
      enableAutoPipelining:false,enableTelemetry:false});
    cachedCredentials=credentials;
  }
  return cachedRedis;
}

/** Both production origins share this scope; previews and other databases do not. */
export function studyRealtimeChannel(userId:string):string{
  if(!uuid.test(userId))throw new Error('Invalid verified identity');
  const scope=[process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.VERCEL_ENV??'development',userId].join('\n');
  return 'yksim:study:v1:'+createHash('sha256').update(scope).digest('hex');
}

export async function publishStudyDirty(userId:string):Promise<void>{
  const redis=studyRealtimeRedis();
  if(!redis)return;
  const realtime=new Realtime({redis,schema:studyRealtimeSchema,verbose:false,
    history:{maxLength:32,expireAfterSecs:60}});
  await realtime.channel(studyRealtimeChannel(userId)).emit('study.dirty',{});
}

export type StudyDirtyOptions={
  /** Server auth/MCP context only. Never read this value from mutation input. */
  verifiedUserId?:string;
  defer?:(work:()=>Promise<void>)=>void;
  publish?:(userId:string)=>Promise<void>;
};

async function bounded<T>(work:Promise<T>,duration:number):Promise<T|null>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),duration);})]);}
  finally{clearTimeout(timer);}
}

/** Call only after an awaited, successful mutation RPC has committed. */
export function scheduleStudyDirty(client:SupabaseClient,options:StudyDirtyOptions={}):void{
  if(process.env.CLASSROOM_DEMO_ENABLED==='true'||(!options.publish&&!studyRealtimeRedis()))return;
  const work=async()=>{
    try{
      let userId=options.verifiedUserId;
      if(!userId){
        // The very same client that committed verifies its JWT signature/expiry.
        // This Auth/JWKS work is after the receipt, never another save round trip.
        const verified=await bounded(client.auth.getClaims(),1000);
        if(!verified||verified.error)return;
        userId=verified.data?.claims.sub;
      }
      if(!userId||!uuid.test(userId))return;
      await bounded((options.publish??publishStudyDirty)(userId),1500);
    }catch{
      // Dirty hints are best effort. Durable receipts and polling remain valid.
    }
  };
  try{(options.defer??after)(work);}catch{void work();}
}
