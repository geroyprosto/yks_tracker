import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {classroomContext} from './classroom';
import {getConfiguration} from './auth';
import {demoEnabled,demoQuery} from './classroom-demo';
import {ApiError} from './http';
import {getState} from './service';
import {DEMO_STUDENT_IDS} from '../classroom/demo-seed';
import {adaptWeekly,boundedCalibrationStudyMinutes,buildBaseline,createDay,DEFAULT_PERSONALITY,ENGINE_VERSION,getProactiveOpportunity,localDateAt,projectDay,userMetrics} from '../nova/core';
import {catchupDates,comparisonScores,deviceAuthorization,nextDate,sha256} from '../nova/presentation';
import {agentContextSchema,selectAgentContext,validateAgentOutput,type AgentContext} from '../nova/agent';
import type {NovaBaseline,NovaDay,NovaPersonality,NovaProactiveHistory,NovaState} from '../nova/types';
import type {NovaDevice,NovaJob,NovaMemory,NovaMessage,NovaSettings,NovaWebState} from '../nova/web-types';
import type {AppState} from '../domain/types';

type RowMessage=Omit<NovaMessage,'sender'|'duel_decision'>&{sender:'USER'|'NOVA';sequence:number;action_status:string|null};
type DayRow={day_snapshot:NovaDay;local_date:string;finalized:boolean;user_score:{total:number|null}|null;nova_score:{total:number|null}|null};
type RaceSnapshot={localDate:string;user:number|null;nova:number|null;observedAt:string;leader:'user'|'nova'|'tie'|'unknown'};
type Profile={id:string;owner_id:string;name:string;baseline:NovaBaseline;personality:NovaPersonality;engine_version:string;created_at:string;race_snapshot?:RaceSnapshot|null};
type RawState={profile:Profile|null;settings:NovaSettings;relationship:Record<string,unknown>|null;days:DayRow[];messages:RowMessage[];jobs:(NovaJob&{trigger?:string;trigger_key?:string})[];memories:NovaMemory[];devices:NovaDevice[];forgotten_source_ids:string[]};
type Rpc=<T=unknown>(name:string,args?:Record<string,unknown>)=>Promise<T>;
type BrowserContext={rpc:Rpc;userId:string;client:SupabaseClient;demo:boolean};
export function novaEnabled(){return process.env.NOVA_ENABLED==='true';}
function requireEnabled(){if(!novaEnabled())throw new ApiError(503,'NOVA_DISABLED','Nova henüz etkin değil. Kurulum ve erişim izni tamamlanmalı.');}
function novaDemo(){return demoEnabled()&&process.env.NOVA_DEMO_ENABLED==='true';}
const browserFunctions=new Set(['nova_access','nova_state','nova_enqueue','nova_settings_update','nova_memory_update','nova_job_retry','nova_duel_decide','nova_pair_approve','nova_device_revoke','nova_messages_page','nova_message_source']);
const serverFunctions=new Set(['nova_engine_initialize','nova_engine_day','nova_engine_state','nova_engine_race','nova_pair_begin','nova_pair_exchange','nova_device_call','nova_proactive_enqueue']);
function storageError(error:{message:string;code?:string}):never{
 const code=error.message;
 const known:Record<string,[number,string]>={
  NOVA_ACCESS_REQUIRED:[403,'Bu hesap için Nova erişim izni yok.'],NOVA_DEVICE_REVOKED:[401,'Cihazın erişimi iptal edildi.'],NOVA_DEVICE_REQUIRED:[401,'Geçerli Nova cihaz kimliği gerekli.'],NOVA_DEVICE_INVALID:[401,'Geçerli Nova cihaz kimliği gerekli.'],NOVA_DEVICE_UNAUTHORIZED:[401,'Cihazın erişimi geçersiz veya iptal edilmiş.'],NOVA_LEASE_INVALID:[409,'İş sahipliği sona erdi.'],
  NOVA_PAIR_PENDING:[409,'Eşleştirme tarayıcı onayı bekliyor.'],NOVA_PAIRING_PENDING:[409,'Eşleştirme tarayıcı onayı bekliyor.'],NOVA_PAIRING_INVALID:[410,'Eşleştirme geçersiz veya süresi dolmuş.'],NOVA_PAIRING_RATE_LIMIT:[429,'Çok sayıda eşleştirme isteği var. Biraz sonra yeniden dene.'],
  NOVA_STALE_CLAIM:[409,'İş sahipliği sona erdi.'],NOVA_LEASE_EXPIRED:[409,'İş sahipliği sona erdi.'],NOVA_IDEMPOTENCY_CONFLICT:[409,'İstek kimliği farklı bir mesaj için kullanılmış.'],NOVA_QUEUE_FULL:[429,'Mesaj kuyruğu dolu. Bekleyen yanıtları tamamla.'],
  NOVA_NOT_FOUND:[404,'Nova kaydı bulunamadı.'],NOVA_INVALID_INPUT:[400,'Alanları kontrol edin.'],NOVA_INVALID_TRANSITION:[409,'İş durumu değişti. Görünümü yenileyin.'],NOVA_MEMORY_BLOCKED:[409,'Bu kaynak unutuldu; tekrar hafızaya alınamaz.'],
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
 const observation=current&&race?await server<{previousLeader:RaceSnapshot['leader']|null;race:RaceSnapshot}>('nova_engine_race',{p_owner_id:context.userId,p_local_date:localToday,p_user_score:race.user.total,p_nova_score:race.nova.total}):null;
 if(raw.profile&&observation)raw.profile.race_snapshot=observation.race;
 if(current&&raw.settings.proactive_enabled){
  const history:NovaProactiveHistory[]=raw.jobs.filter(j=>j.kind==='PROACTIVE'&&j.status!=='CANCELLED').map(j=>({trigger:j.trigger as NovaProactiveHistory['trigger'],sentAt:j.created_at,answered:raw.messages.some(m=>m.sender==='USER'&&m.created_at>j.created_at)}));
  const chance=getProactiveOpportunity({day:current.day_snapshot,nowIso:now,history,userScore:race?.user.total,novaScore:race?.nova.total,previousLeader:observation?.previousLeader&&observation.previousLeader!=='unknown'?observation.previousLeader:undefined,settings:{enabled:raw.settings.proactive_enabled,pushEnabled:false,maxPerDay:raw.settings.proactive_daily_limit,quietStartHour:raw.settings.quiet_start,quietEndHour:raw.settings.quiet_end,maxDuelsPerWeek:raw.settings.duel_weekly_limit}});
  if(chance)await server('nova_proactive_enqueue',{p_owner_id:context.userId,p_key:chance.key,p_trigger:chance.trigger,p_expires_at:chance.expiresAt,p_context:{trigger:chance.trigger}});
 }
 return {raw,state,now,current,race,localToday};
}
function webMessage(m:RowMessage):NovaMessage{return {...m,sender:m.sender==='USER'?'user':'nova',duel_decision:m.action_status==='ACCEPTED'?'accepted':m.action_status==='REJECTED'?'rejected':null};}
export async function novaState():Promise<NovaWebState>{
 const context=await browserContext();const {raw,now,current,race,localToday}=await synchronize(context);
 return {serverNow:now,demo:context.demo,profile:raw.profile!,today:current?projectDay(current.day_snapshot,now):null,dayInfo:current?{seed:current.day_snapshot.seed,engineVersion:current.day_snapshot.engineVersion,localDate:current.local_date,startState:current.day_snapshot.startState}:null,race,
  weekly:raw.days.slice(-7).map(d=>({localDate:d.local_date,userScore:d.finalized?d.user_score?.total??null:d.local_date===localToday?race?.user.total??null:null,novaScore:d.finalized?d.nova_score?.total??null:d.local_date===localToday?race?.nova.total??null:null,finalized:d.finalized})),
  messages:raw.messages.map(webMessage),jobs:raw.jobs.map(({id,status,kind,source_message_id,attempt_count,error,created_at,completed_at})=>({id,status,kind,source_message_id,attempt_count,error,created_at,completed_at})),memories:raw.memories,devices:raw.devices,settings:raw.settings,relationship:raw.relationship,catchupRemaining:!current,proactiveCount:raw.jobs.filter(j=>j.kind==='PROACTIVE'&&localDateAt(j.created_at,raw.settings.timezone)===localToday&&j.status!=='CANCELLED').length};
}
const uuid=z.string().uuid();
const settingsSchema=z.object({timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('tr',{timeZone:v});return true;}catch{return false;}}).optional(),quiet_start:z.number().int().min(0).max(23).optional(),quiet_end:z.number().int().min(0).max(23).optional(),proactive_enabled:z.boolean().optional(),proactive_daily_limit:z.number().int().min(0).max(4).optional(),duel_weekly_limit:z.number().int().min(0).max(5).optional(),memory_enabled:z.boolean().optional(),notifications_enabled:z.literal(false).optional(),weekly_adaptation_limit:z.number().min(0).max(.05).optional()}).strict();
const commandSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('message'),requestId:uuid,content:z.string().trim().min(1).max(4000)}).strict(),
 z.object({operation:z.literal('retry'),jobId:uuid}).strict(),z.object({operation:z.literal('settings'),settings:settingsSchema}).strict(),
 z.object({operation:z.literal('memory'),memoryId:uuid,action:z.enum(['approve','edit','pin','unpin','forget','reject']),content:z.string().trim().min(1).max(500).optional()}).strict(),
 z.object({operation:z.literal('duel'),messageId:uuid,accept:z.boolean()}).strict(),z.object({operation:z.literal('pair.approve'),code:z.string().regex(/^[a-fA-F0-9]{12}$/)}).strict(),
 z.object({operation:z.literal('device.revoke'),deviceId:uuid}).strict(),z.object({operation:z.literal('history'),beforeSequence:z.number().int().positive().optional()}).strict(),z.object({operation:z.literal('source'),messageId:uuid}).strict(),
]);
export async function novaCommand(input:unknown){
 const parsed=commandSchema.safeParse(input);if(!parsed.success)throw new ApiError(400,'NOVA_INVALID_INPUT','Alanları kontrol edin.');
 const c=await browserContext(),value=parsed.data;
 switch(value.operation){
  case 'message':return c.rpc('nova_enqueue',{p_request_id:value.requestId,p_content:value.content});
  case 'retry':return c.rpc('nova_job_retry',{p_job_id:value.jobId});
  case 'settings':return c.rpc('nova_settings_update',{p_settings:value.settings});
  case 'memory':return c.rpc('nova_memory_update',{p_memory_id:value.memoryId,p_action:value.action,p_content:value.content??null});
  case 'duel':return c.rpc('nova_duel_decide',{p_message_id:value.messageId,p_accept:value.accept});
  case 'pair.approve':return c.rpc('nova_pair_approve',{p_code:value.code});
  case 'device.revoke':return c.rpc('nova_device_revoke',{p_device_id:value.deviceId});
  case 'history':return (await c.rpc<RowMessage[]>('nova_messages_page',{p_before_seq:value.beforeSequence??null})).map(webMessage);
  case 'source':return c.rpc('nova_message_source',{p_message_id:value.messageId});
 }
}

type DeviceContext=RawState&{job:{id:string;kind:string;created_at:string;context_hint?:{trigger?:string};bound_context?:AgentContext|null;context_version?:string};source_message:RowMessage|null;bound_context?:AgentContext|null;context_version?:string};
function makeAgentContext(raw:DeviceContext):AgentContext{
 const now=new Date().toISOString(),zone=raw.settings.timezone,day=raw.days.find(d=>d.local_date===localDateAt(now,zone));
 const projection=day?projectDay(day.day_snapshot,now):null;
 const facts:AgentContext['facts']=[{id:'profile:nova',text:'Nova yapay zekâ destekli bir dijital çalışma arkadaşıdır. Yaşamı ve çalışmaları simülasyondur.',kind:'profile'}];
 if(projection){facts.push({id:`state:${day!.local_date}`,text:`Nova'nın mevcut modu: ${projection.mood}.`,kind:'state'});
  for(const event of projection.timeline.filter(e=>e.status==='completed').slice(-12))facts.push({id:event.id,text:`${event.label} etkinliği tamamlandı.`,kind:'event'});
 }
 const source=raw.source_message;
 const race=raw.profile?.race_snapshot?.localDate===localDateAt(now,zone)?raw.profile.race_snapshot:null;
 if(race)facts.push({id:'race:last',kind:'score',text:race.leader==='user'?'Son kayıtlı yarış karşılaştırmasında kullanıcı önde.':race.leader==='nova'?'Son kayıtlı yarış karşılaştırmasında Nova önde.':race.leader==='tie'?'Son kayıtlı yarış karşılaştırmasında puanlar eşit.':'Yarış için yeterli kayıt yok.'});
 const relationship=Object.fromEntries(Object.entries(raw.relationship??{}).filter(([key,value])=>['familiarity','warmth','rivalry'].includes(key)&&typeof value==='number'));
 return selectAgentContext(agentContextSchema.parse({schemaVersion:1,trustedNow:now,generatedAt:now,message:{id:source?.id??raw.job.id,content:source?.content??`Kayıtlı proaktif tetikleyici: ${raw.job.context_hint?.trigger??'kontrol'}. Kısa, baskı kurmayan bir yoklama öner.`,sentAt:source?.created_at??raw.job.created_at},facts,personality:raw.profile?.personality??DEFAULT_PERSONALITY,currentState:projection?{...projection.state,...relationship,mood:projection.mood,...(race?{raceObservedAt:race.observedAt}:{})}:{...relationship},currentEvent:projection?.currentEvent?{id:projection.currentEvent.id,label:projection.currentEvent.label,status:projection.currentEvent.status}:null,score:race?{user:race.user,nova:race.nova}:null,
  history:raw.messages.filter(m=>m.id!==source?.id).map(m=>({id:m.id,role:m.sender==='USER'?'user':'assistant',content:m.content,sentAt:m.created_at})),memories:raw.settings.memory_enabled?raw.memories.filter(m=>m.status==='active').map(m=>({id:m.id,content:m.content,sourceMessageId:m.source_message_id,pinned:m.pinned,tags:m.tags,importance:m.importance,updatedAt:m.updated_at})):[],forgottenSourceIds:raw.forgotten_source_ids??[]}));
}
const bridgeInput=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('pair.begin'),challenge:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().min(1).max(100)}).strict(),
 z.object({operation:z.literal('pair.exchange'),pairing_id:uuid,challenge:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({operation:z.enum(['heartbeat','claim','renew','context','complete','fail']),payload:z.record(z.string(),z.unknown()).default({})}).strict(),
]);
export async function novaBridge(request:Request,input:unknown){
 requireEnabled();const parsed=bridgeInput.safeParse(input);if(!parsed.success)throw new ApiError(400,'NOVA_INVALID_INPUT','Bridge isteği geçerli değil.');
 const value=parsed.data,rpc=serviceRpc();
 if(value.operation==='pair.begin')return rpc('nova_pair_begin',{p_challenge_hash:sha256(value.challenge),p_name:value.name});
 if(value.operation==='pair.exchange'){
  const token=randomBytes(32).toString('hex');const paired=await rpc<{device_id:string}>('nova_pair_exchange',{p_pairing_id:value.pairing_id,p_challenge_hash:sha256(value.challenge),p_secret_hash:sha256(token)});
  return {device_id:paired.device_id,token};
 }
 let credential;try{credential=deviceAuthorization(request.headers.get('authorization'));}catch{throw new ApiError(401,'NOVA_DEVICE_REQUIRED','Geçerli Nova cihaz kimliği gerekli.');}
 const call=<T=unknown>(operation:string,payload:Record<string,unknown>)=>rpc<T>('nova_device_call',{p_device_id:credential.deviceId,p_secret_hash:credential.secretHash,p_operation:operation,p_payload:payload});
 // Caller-controlled data never chooses an owner or binds trusted facts.
 const claimPayload=z.object({job_id:uuid,claim_token:uuid}).strict();
 if(value.operation==='heartbeat'){
  const payload=z.object({version:z.string().max(60),model:z.string().max(100),model_available:z.boolean()}).strict().safeParse(value.payload);
  if(!payload.success)throw new ApiError(400,'NOVA_INVALID_INPUT','Bridge durumu geçerli değil.');return call('heartbeat',payload.data);
 }
 if(value.operation==='claim')return call('claim',{});
 if(value.operation==='context'){
  const payload=claimPayload.safeParse(value.payload);if(!payload.success)throw new ApiError(400,'NOVA_INVALID_INPUT','İş kimliği geçerli değil.');
  const raw=await call<DeviceContext>('context',payload.data);
  const stored=raw.bound_context??raw.job.bound_context;
  const context=stored??makeAgentContext(raw);
  if(!stored)await call('bind_context',{...payload.data,context,context_version:sha256(JSON.stringify(context))});
  return {context};
 }
 if(value.operation==='complete'){
  const payload=z.object({job_id:uuid,claim_token:uuid,result:z.unknown(),metrics:z.object({durationMs:z.number().min(0).max(3600000),inputTokens:z.number().int().min(0).max(1000000),outputTokens:z.number().int().min(0).max(1000000)}).strict().optional()}).strict().safeParse(value.payload);
  if(!payload.success)throw new ApiError(400,'NOVA_INVALID_INPUT','Yanıt kaydı geçerli değil.');
  const raw=await call<DeviceContext>('context',{job_id:payload.data.job_id,claim_token:payload.data.claim_token});const context=raw.bound_context??raw.job.bound_context;
  if(!context)throw new ApiError(409,'NOVA_CONTEXT_REQUIRED','İşin doğrulanmış bağlamı bulunamadı.');
  let result;try{result=validateAgentOutput(payload.data.result,{...context,forgottenSourceIds:raw.forgotten_source_ids??[]});}catch{throw new ApiError(422,'NOVA_MODEL_OUTPUT_REJECTED','Model yanıtı doğrulamadan geçemedi.');}
  if(!raw.settings.memory_enabled)result={...result,memoryCandidates:[]};
  // Postgres JSONB changes object key order. Reuse the persisted version rather than rehashing serialization.
  return call('complete',{...payload.data,result,context_version:raw.context_version??raw.job.context_version});
 }
 if(value.operation==='fail'){
  const payload=z.object({job_id:uuid,claim_token:uuid,error:z.string().regex(/^[A-Z_]{1,80}$/),retryable:z.boolean()}).strict().safeParse(value.payload);
  if(!payload.success)throw new ApiError(400,'NOVA_INVALID_INPUT','İş hata kaydı geçerli değil.');return call('fail',payload.data);
 }
 const payload=claimPayload.safeParse(value.payload);if(!payload.success)throw new ApiError(400,'NOVA_INVALID_INPUT','İş kimliği geçerli değil.');return call('renew',payload.data);
}
