import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {classroomContext} from './classroom';
import {getConfiguration} from './auth';
import {demoEnabled,demoQuery} from './classroom-demo';
import {ApiError} from './http';
import {getState} from './service';
import {DEMO_STUDENT_IDS} from '../classroom/demo-seed';
import {adaptWeekly,boundedCalibrationStudyMinutes,buildBaseline,createDay,DEFAULT_PERSONALITY,ENGINE_VERSION,localDateAt,projectDay,userMetrics} from '../nova/core';
import {catchupDates,comparisonScores,nextDate,sha256} from '../nova/presentation';
import type {NovaBaseline,NovaDay,NovaPersonality,NovaState} from '../nova/types';
import type {NovaSettings,NovaWebState} from '../nova/web-types';
import type {AppState} from '../domain/types';

type DayRow={day_snapshot:NovaDay;local_date:string;finalized:boolean;user_score:{total:number|null}|null;nova_score:{total:number|null}|null};
type Profile={id:string;owner_id:string;name:string;baseline:NovaBaseline;personality:NovaPersonality;engine_version:string;created_at:string};
type RawState={profile:Profile|null;settings:NovaSettings;days:DayRow[]};
type Rpc=<T=unknown>(name:string,args?:Record<string,unknown>)=>Promise<T>;
type BrowserContext={rpc:Rpc;userId:string;client:SupabaseClient;demo:boolean};
export function novaEnabled(){return process.env.NOVA_ENABLED==='true';}
function requireEnabled(){if(!novaEnabled())throw new ApiError(503,'NOVA_DISABLED','Nova henüz etkin değil. Kurulum ve erişim izni tamamlanmalı.');}
function novaDemo(){return demoEnabled()&&process.env.NOVA_DEMO_ENABLED==='true';}
const browserFunctions=new Set(['nova_access','nova_settings_update']);
const serverFunctions=new Set(['nova_engine_initialize','nova_engine_day','nova_engine_state','nova_engine_race']);
function storageError(error:{message:string;code?:string}):never{
 const code=error.message;
 const known:Record<string,[number,string]>={
  NOVA_ACCESS_REQUIRED:[403,'Bu hesap için Nova erişim izni yok.'],
  NOVA_NOT_FOUND:[404,'Nova kaydı bulunamadı.'],NOVA_INVALID_INPUT:[400,'Alanları kontrol edin.'],
 };
 if(known[code])throw new ApiError(known[code][0],code,known[code][1]);
 if(error.code==='42P01'||error.code==='PGRST202')throw new ApiError(503,'NOVA_SETUP_REQUIRED','Nova veritabanı migration kurulumu gerekli.');
 if(code.startsWith('NOVA_'))throw new ApiError(409,code,'Nova işlemi doğrulanamadı. Görünümü yenileyip tekrar dene.');
 throw new ApiError(503,'NOVA_DATABASE_UNAVAILABLE','Nova veritabanına ulaşılamadı.');
}
function clientRpc(client:SupabaseClient):Rpc{return async<T>(name:string,args:Record<string,unknown>={})=>{const {data,error}=await client.rpc(name,args);if(error)storageError(error);return data as T;};}
function localRpc(userId:string|null,service:boolean):Rpc{return async<T>(name:string,args:Record<string,unknown>={})=>{
 if(!(service?serverFunctions:browserFunctions).has(name)||Object.keys(args).some(k=>!/^p_[a-z_]+$/.test(k)))throw new Error('INVALID_RPC');
 try{return await demoQuery(db=>db.transaction(async tx=>{
  await tx.exec(`set local role ${service?'service_role':'authenticated'}`);
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId??'']);
  const keys=Object.keys(args);const result=await tx.query<{value:T}>(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as value`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));
  return result.rows[0].value;
 }));}catch(error){storageError({message:error instanceof Error?error.message:'DATABASE_ERROR'});}
};}
function serviceRpc():Rpc{
 if(novaDemo())return localRpc(null,true);
 const config=getConfiguration(),secret=process.env.SUPABASE_SECRET_KEY;
 if(!config||!secret||/REPLACE|YOUR_/i.test(secret))throw new ApiError(503,'NOVA_SETUP_REQUIRED','Nova için sunucu veritabanı bağlantısı kurulmalı.');
 return clientRpc(createClient(config.url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}));
}
async function browserContext():Promise<BrowserContext>{
 requireEnabled();const {client,user,account,demo}=await classroomContext();
 if(!account||account.status!=='approved'||!['student','admin'].includes(account.role))throw new ApiError(403,'NOVA_ACCESS_REQUIRED','Bu hesap için Nova erişimi yok.');
 if(demo&&!novaDemo())throw new ApiError(403,'NOVA_DEMO_DISABLED','Nova yerel test ortamı etkin değil.');
 // Only this predefined isolated demo identity is granted; no real account is modified.
 if(demo&&user.id===DEMO_STUDENT_IDS[0])await demoQuery(db=>db.query('insert into public.nova_access_grants(owner_id) values($1) on conflict do nothing',[user.id]));
 const rpc=demo?localRpc(user.id,false):clientRpc(client);
 if(!await rpc<boolean>('nova_access'))throw new ApiError(403,'NOVA_ACCESS_REQUIRED','Bu hesap için Nova erişim izni yok.');
 return {rpc,userId:user.id,client,demo};
}
function raceFor(state:AppState,day:NovaDay,now:string){
 const projection=projectDay(day,now),user=userMetrics(state,day.localDate,day.timezone,now);
 // Daily denominators are frozen equally for both sides; later goal edits cannot change the race.
 user.studyTargetMinutes=day.targets.studyMinutes;user.questionTarget=day.targets.questions;user.topicTarget=day.targets.topicProgress;
 const scores=comparisonScores(user,projection.metrics);
 return {...scores,userMetrics:user,novaMetrics:projection.metrics};
}
async function synchronize(context:BrowserContext){
 const server=serviceRpc(),now=new Date().toISOString(),state=await getState(context.client,context.userId);
 const timezone=state.settings?.timezone??'Europe/Istanbul',today=localDateAt(now,timezone);
 const profile=await server<Profile>('nova_engine_initialize',{p_owner_id:context.userId,p_profile:{personality:DEFAULT_PERSONALITY,baseline:buildBaseline(state,today,timezone),engine_version:ENGINE_VERSION,timezone}});
 let raw=await server<RawState>('nova_engine_state',{p_owner_id:context.userId});
 const zone=raw.settings.timezone;
 const localToday=localDateAt(now,zone),activationDate=localDateAt(profile.created_at,zone);
 const last=raw.days.at(-1);
 const first=last?(last.finalized?nextDate(last.local_date):last.local_date):activationDate;
 let previousState:NovaState|undefined=last?projectDay(last.day_snapshot,last.day_snapshot.endsAt).state:undefined;
 let multiplier=last?.day_snapshot.inputSnapshot.strengthMultiplier??1;
 for(const date of catchupDates(first,localToday)){
  const existing=raw.days.find(d=>d.local_date===date);
  const elapsed=Math.floor((Date.parse(date)-Date.parse(activationDate))/86400000);
  if(!existing&&elapsed>0&&elapsed%7===0)multiplier=adaptWeekly({currentMultiplier:multiplier,beforeLocalDate:date,maxWeeklyChange:raw.settings.weekly_adaptation_limit,days:raw.days.map(d=>({localDate:d.local_date,completed:d.finalized,userScore:d.user_score?.total??null,novaScore:d.nova_score?.total??null}))});
  const baseline=elapsed<7?buildBaseline(state,date,zone):(raw.days.at(-1)?.day_snapshot.inputSnapshot.baseline??profile.baseline);
  const priorInput=raw.days.filter(d=>d.local_date<date).at(-1)?.day_snapshot.inputSnapshot;
  const priorBudget=priorInput?.calibrationStudyMinutes??priorInput?.baseline.averageStudyMinutes??baseline.averageStudyMinutes??45;
  const calibrationStudyMinutes=elapsed>0&&elapsed<7?boundedCalibrationStudyMinutes(priorBudget,baseline.averageStudyMinutes):priorBudget;
  const day=existing?.day_snapshot??createDay({localDate:date,timezone:zone,seed:sha256(`${profile.id}:${date}`),baseline,previousState,personality:profile.personality,engineVersion:ENGINE_VERSION,strengthMultiplier:multiplier,calibrationDay:Math.min(elapsed,7),calibrationStudyMinutes});
  // Insert returns the winner's immutable snapshot if two requests race.
  let stored=existing??await server<DayRow>('nova_engine_day',{p_owner_id:context.userId,p_day:day});
  const projection=projectDay(stored.day_snapshot,now);
  if(projection.completed&&!stored.finalized){const race=raceFor(state,stored.day_snapshot,stored.day_snapshot.endsAt);stored=await server<DayRow>('nova_engine_day',{p_owner_id:context.userId,p_day:{...stored.day_snapshot,computedState:projection.state,finalized:true,userScore:race.user,novaScore:race.nova}});}
  previousState=projectDay(stored.day_snapshot,stored.day_snapshot.endsAt).state;
  raw.days=[...raw.days.filter(d=>d.local_date!==date),stored].sort((a,b)=>a.local_date.localeCompare(b.local_date));
 }
 raw=await server<RawState>('nova_engine_state',{p_owner_id:context.userId});
 const current=raw.days.find(d=>d.local_date===localToday);
 const race=current?raceFor(state,current.day_snapshot,now):null;
 if(current&&race)await server('nova_engine_race',{p_owner_id:context.userId,p_local_date:localToday,p_user_score:race.user.total,p_nova_score:race.nova.total});
 return {raw,state,now,current,race,localToday};
}
export async function novaState():Promise<NovaWebState>{
 const context=await browserContext();const {raw,now,current,race,localToday}=await synchronize(context);
 const profile=raw.profile!;
 return {serverNow:now,demo:context.demo,profile:{id:profile.id,name:profile.name,baseline:profile.baseline,engine_version:profile.engine_version},today:current?projectDay(current.day_snapshot,now):null,dayInfo:current?{seed:current.day_snapshot.seed,engineVersion:current.day_snapshot.engineVersion,localDate:current.local_date,startState:current.day_snapshot.startState}:null,race,
  weekly:raw.days.slice(-7).map(d=>({localDate:d.local_date,userScore:d.finalized?d.user_score?.total??null:d.local_date===localToday?race?.user.total??null:null,novaScore:d.finalized?d.nova_score?.total??null:d.local_date===localToday?race?.nova.total??null:null,finalized:d.finalized})),
  settings:{timezone:raw.settings.timezone,weekly_adaptation_limit:raw.settings.weekly_adaptation_limit},catchupRemaining:!current};
}
const settingsSchema=z.object({
 timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('tr',{timeZone:v});return true;}catch{return false;}}).optional(),
 weekly_adaptation_limit:z.number().min(0).max(.05).optional(),
}).strict();
const commandSchema=z.object({operation:z.literal('settings'),settings:settingsSchema}).strict();
const retiredOperations=new Set(['message','retry','memory','duel','pair.approve','device.revoke','history','source']);
export async function novaCommand(input:unknown){
 if(input&&typeof input==='object'&&'operation' in input&&typeof input.operation==='string'&&retiredOperations.has(input.operation))
  throw new ApiError(410,'NOVA_CHAT_REMOVED','Nova’nın yerel model sohbeti kaldırıldı. Nova Bugün, Yarış ve Nova Lab kullanılabilir.');
 const parsed=commandSchema.safeParse(input);if(!parsed.success)throw new ApiError(400,'NOVA_INVALID_INPUT','Alanları kontrol edin.');
 const context=await browserContext();
 const settings=await context.rpc<NovaSettings>('nova_settings_update',{p_settings:parsed.data.settings});
 return {timezone:settings.timezone,weekly_adaptation_limit:settings.weekly_adaptation_limit};
}
