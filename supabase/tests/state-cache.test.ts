import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {AppState} from '../../src/lib/domain/types';
import {defaultSetup} from '../../src/lib/education';

const [OWNER,STUDENT,OTHER,PENDING,TEACHER,DELETED]=Array.from({length:6},()=>randomUUID());
type Context={user_id:string;version:string;server_now:string};
type Snapshot=Context&{state:AppState};
let db:PGlite;

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;`);
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())
  await db.exec(await readFile(new URL(name,directory),'utf8'));
 for(const id of [OWNER,STUDENT,OTHER,PENDING,TEACHER,DELETED]){
  await db.query('insert into auth.users values($1,$2,now())',[id,`${id}@example.test`]);
  await db.query('insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,$4,$5)',
   [id,'Sentetik hesap',`${id}@example.test`,id===OWNER?'admin':id===TEACHER?'teacher':'student',id===PENDING?'pending':'approved']);
 }
 await db.query('insert into public.owner_allowlist(user_id) values($1)',[OWNER]);
 await browser(STUDENT);
});
after(async()=>{await db?.close();});

async function browser(id=STUDENT){
 await db.exec('reset role;set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 await db.query("select set_config('request.jwt.claim.client_id','',false)");
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);
}
async function admin(sql:string,args:unknown[]=[]){await db.exec('reset role');return db.query(sql,args);}
async function adminExec(sql:string){await db.exec('reset role');return db.exec(sql);}
async function context(){return (await db.query<{value:Context}>('select public.yks_state_cache_context() value')).rows[0].value;}
async function snapshot(){return (await db.query<{value:Snapshot}>('select public.yks_state_cache_snapshot() value')).rows[0].value;}
async function validateCache(version:string){
 return (await db.query<{value:Context&{state:AppState|null}}>('select public.yks_state_cache_snapshot($1) value',[version])).rows[0].value;
}
async function command(type:string,payload:unknown,requestId=randomUUID()){
 return (await db.query<{value:{id:string;replayed:boolean}}>('select public.yks_command($1,$2,$3::jsonb) value',
  [requestId,type,JSON.stringify(payload)])).rows[0].value;
}
async function service(){
 await db.exec('reset role;set role service_role');
 await db.query("select set_config('request.jwt.claim.sub','',false)");
 await db.query("select set_config('request.jwt.claims','{}',false)");
}

test('context preserves first-load initialization and stable snapshots share the same generation',async()=>{
 const first=await context(),second=await context(),full=await snapshot();
 assert.equal(first.user_id,STUDENT);
 assert.equal(typeof first.version,'string');assert.ok(first.version.length>0);
 assert.ok(Number.isFinite(Date.parse(first.server_now)));
 assert.equal(second.version,first.version);assert.equal(full.version,second.version);
 assert.equal(full.state.server_now,full.server_now);
 assert.ok(full.state.settings);assert.ok(full.state.topics.length>0);
 assert.ok(full.state.day_plans.length>0);assert.ok(full.state.education);
 await browser(OWNER);assert.equal((await snapshot()).user_id,OWNER);
 await browser(STUDENT);
});

test('a known cache generation skips projection but a post-save miss returns fresh data in that same RPC',async()=>{
 const cached=await snapshot(),validated=await validateCache(cached.version);
 assert.equal(validated.version,cached.version);assert.equal(validated.user_id,STUDENT);
 assert.equal(validated.state,null);
 const task=await command('task.create',{title:'Önbellek sonrası görev',plan_date:'2026-10-05'});
 const fresh=await validateCache(cached.version);assert.notEqual(fresh.version,cached.version);
 assert.ok(fresh.state?.tasks.some(row=>row.id===task.id));
 assert.equal(fresh.server_now,fresh.state?.server_now);
 // A hit must not execute the expensive projection, while live authorization
 // and time-driven settlement still run inside the validation RPC.
 await adminExec(`alter function public.yks_state() rename to state_cache_test_original;
 create function public.yks_state() returns jsonb language plpgsql security definer set search_path='' as $$
 begin raise exception 'PROJECTION_MUST_NOT_RUN';end $$;
 revoke all on function public.yks_state() from public,anon,service_role;
 grant execute on function public.yks_state() to authenticated;`);
 try{
  await browser(STUDENT);assert.equal((await validateCache(fresh.version)).state,null);
  await assert.rejects(()=>validateCache('unknown-generation'),/PROJECTION_MUST_NOT_RUN/);
 }finally{
  await adminExec('drop function public.yks_state();alter function public.state_cache_test_original() rename to yks_state;');
  await browser(STUDENT);
 }
});

test('task, journal, manual-time and education commits advance generations; replay does not',async()=>{
 let previous=(await context()).version;
 const id=randomUUID();
 const task=await command('task.create',{title:'Yeni görev',plan_date:'2026-10-05'},id);
 const afterTask=(await context()).version;assert.notEqual(afterTask,previous);
 await command('task.create',{title:'Yeni görev',plan_date:'2026-10-05'},id);
 assert.equal((await context()).version,afterTask);
 await command('task.update',{id:task.id,expected_revision:1,progress:1});
 previous=(await context()).version;assert.notEqual(previous,afterTask);
 const journal=await command('journal.create',{journal_date:'2026-10-05',original_text:'Özel günlük'});
 assert.notEqual((await context()).version,previous);previous=(await context()).version;
 const manual=await command('manual_study.create',{confirmed_by_user:true,study_date:'2026-10-05',subject:'TYT Matematik',minutes:25});
 assert.notEqual((await context()).version,previous);previous=(await context()).version;
 await db.query('select public.education_command($1,$2,$3::jsonb)',
  [randomUUID(),'draft.save',JSON.stringify({expected_revision:0,step:0,data:defaultSetup()})]);
 const full=await snapshot();assert.notEqual(full.version,previous);
 assert.equal(full.state.tasks.find(row=>row.id===task.id)?.progress,1);
 assert.equal(full.state.journal_entries.find(row=>row.id===journal.id)?.original_text,'Özel günlük');
 assert.equal(full.state.manual_study_entries?.find(row=>row.id===manual.id)?.duration_seconds,1500);
 assert.equal(full.state.education?.draft?.step,0);
});

test('a different student write does not invalidate this student; privileged writes do',async()=>{
 await browser(STUDENT);const before=(await context()).version;
 await browser(OTHER);await command('task.create',{title:'Başka öğrencinin görevi',plan_date:'2026-10-05'});
 await browser(STUDENT);assert.equal((await context()).version,before);
 await admin('update public.tasks set notes=$2 where user_id=$1',[STUDENT,'Sunucu güncellemesi']);
 await browser(STUDENT);const full=await snapshot();assert.notEqual(full.version,before);
 assert.ok(full.state.tasks.every(row=>row.notes==='Sunucu güncellemesi'));
});

test('failed transactions roll back the cache generation together with their study writes',async()=>{
 const before=(await context()).version;
 await db.exec('begin');
 try{
  await command('task.create',{title:'Geri alınan görev',plan_date:'2026-10-05'});
  assert.notEqual((await context()).version,before);
 }finally{await db.exec('rollback');}
 const full=await snapshot();assert.equal(full.version,before);
 assert.ok(full.state.tasks.every(row=>row.title!=='Geri alınan görev'));
});

test('the cache-hit context settles an expired countdown before returning a generation',async()=>{
 const timer=await command('timer.start',{title:'Geri sayım',mode:'countdown',target_seconds:60});
 await admin("update public.study_sessions set started_at=now()-interval '2 minutes',active_since=now()-interval '2 minutes' where id=$1",[timer.id]);
 await admin("update public.study_intervals set started_at=now()-interval '2 minutes' where session_id=$1",[timer.id]);
 const before=(await admin('select generation::text value from private.state_cache_generations where user_id=$1',[STUDENT])).rows[0] as {value:string};
 await browser(STUDENT);const settled=await context(),full=await snapshot();
 assert.notEqual(settled.version.split(':')[0],before.value);
 assert.equal(full.version,settled.version);
 assert.equal(full.state.sessions.find(row=>row.id===timer.id)?.status,'finished');
 assert.equal(full.state.sessions.find(row=>row.id===timer.id)?.accumulated_seconds,60);
 assert.ok(full.state.intervals.find(row=>row.session_id===timer.id)?.ended_at);
});

test('MCP and generated coaching tasks invalidate the same browser projection',async()=>{
 await browser(OWNER);const before=(await context()).version;
 await service();
 const mcp=(await db.query<{value:{id:string}}>('select public.mcp_owner_command($1,$2,$3,$4::jsonb) value',
  [OWNER,randomUUID(),'task.create',JSON.stringify({title:'MCP görevi',plan_date:'2026-10-05'})])).rows[0].value;
 await browser(OWNER);const afterMcp=await snapshot();assert.notEqual(afterMcp.version,before);
 assert.ok(afterMcp.state.tasks.some(row=>row.id===mcp.id));
 const topic=afterMcp.state.topics.find(row=>row.exam==='AYT'&&row.subject==='Matematik')!;
 const runId=randomUUID();
 const day=(await admin("select (clock_timestamp() at time zone 'Europe/Istanbul')::date::text value")).rows[0] as {value:string};
 await service();await db.query('select public.coaching_plan_set($1,$2::jsonb)',
  [OWNER,JSON.stringify({months:[],daily_minutes:300,buffer_ratio:0.15})]);
 await db.query('select public.coaching_run_begin($1,$2)',[OWNER,runId]);
 await db.query('select public.coaching_homework_create($1,$2,$3::jsonb)',
  [OWNER,runId,JSON.stringify([{key:'cache-homework',topic_id:topic.id,title:'Koçluk görevi',plan_date:day.value,
   planned_minutes:20,priority:'high',study_type:'Soru çözümü',completion_criteria:'20 soru',reason:'Tekrar'}])]);
 await browser(OWNER);const afterCoaching=await snapshot();assert.notEqual(afterCoaching.version,afterMcp.version);
 assert.ok(afterCoaching.state.tasks.some(row=>row.title==='Koçluk görevi'));
 await browser(STUDENT);
});

test('reference catalogs, bulk truncation and local-date boundaries cannot reuse an old generation',async()=>{
 await browser(STUDENT);
 const before=(await context()).version;
 await admin("update public.exam_format_versions set label=label||' (test)' where code='BRANCH'");
 await browser(STUDENT);assert.notEqual((await context()).version,before);
 const times=(await admin(`select private.state_cache_version($1,'2026-10-05T20:59:59Z') before,
  private.state_cache_version($1,'2026-10-05T21:00:00Z') after`,[STUDENT])).rows[0] as {before:string;after:string};
 assert.notEqual(times.before,times.after);
 await browser(STUDENT);const previous=(await context()).version;
 await admin('truncate public.practice_entries');
 await browser(STUDENT);assert.notEqual((await context()).version,previous);
});

test('cached-read RPCs preserve browser, approval and owner gates and expose no generation table',async()=>{
 await browser(STUDENT);const cachedVersion=(await context()).version;
 for(const id of [PENDING,TEACHER]){
  await browser(id);await assert.rejects(()=>context(),/OWNER_REQUIRED/);
  await assert.rejects(()=>snapshot(),/OWNER_REQUIRED/);
  await assert.rejects(()=>validateCache(cachedVersion),/OWNER_REQUIRED/);
 }
 await browser(STUDENT);
 for(const relation of ['state_cache_generations','state_cache_global_generation'])
  await assert.rejects(()=>db.query(`select * from private.${relation}`),/permission denied/);
 await assert.rejects(()=>db.query('select private.state_cache_version($1,now())',[STUDENT]),/permission denied/);
 await db.query("select set_config('request.jwt.claim.client_id','oauth-client',false)");
 await assert.rejects(()=>context(),/OWNER_REQUIRED/);await assert.rejects(()=>snapshot(),/OWNER_REQUIRED/);
 await assert.rejects(()=>validateCache(cachedVersion),/OWNER_REQUIRED/);
 await browser(STUDENT);await admin("update public.classroom_accounts set status='suspended' where id=$1",[STUDENT]);
 await browser(STUDENT);await assert.rejects(()=>context(),/OWNER_REQUIRED/);
 await assert.rejects(()=>validateCache(cachedVersion),/OWNER_REQUIRED/);
 await admin("update public.classroom_accounts set status='approved' where id=$1",[STUDENT]);
 for(const role of ['anon','service_role']){
  await db.exec(`reset role;set role ${role}`);
  await assert.rejects(()=>context(),/permission denied/);await assert.rejects(()=>snapshot(),/permission denied/);
 }
 await browser(STUDENT);
});

test('snapshot retries a generation change during projection and refuses repeated changes',async()=>{
 await adminExec(`alter function public.yks_state() rename to state_cache_test_original;
 create table private.state_cache_test_hook(remaining integer);
 insert into private.state_cache_test_hook values(1);
 create function public.yks_state() returns jsonb language plpgsql security definer set search_path='' as $$
 declare value jsonb;begin
  value:=public.state_cache_test_original();
  if exists(select 1 from private.state_cache_test_hook where remaining<>0) then
   update public.exam_format_versions set label=label||' changed' where code='BRANCH';
   update private.state_cache_test_hook set remaining=remaining-1;
  end if;
  return value;
 end $$;
 revoke all on function public.yks_state() from public,anon,service_role;
 grant execute on function public.yks_state() to authenticated;`);
 try{
  await browser(STUDENT);const result=await snapshot();
  assert.ok(result.state.exam_formats.some(row=>row.label.includes(' changed')));
  assert.equal(result.version,(await context()).version);
  await admin('update private.state_cache_test_hook set remaining=-1');
  await browser(STUDENT);await assert.rejects(()=>snapshot(),/CACHE_SNAPSHOT_CHANGED/);
 }finally{
  await adminExec(`drop function public.yks_state();alter function public.state_cache_test_original() rename to yks_state;
   drop table private.state_cache_test_hook;`);
  await browser(STUDENT);
 }
});

test('Auth account cascade removes the generation without recreating it',async()=>{
 await browser(DELETED);await context();await command('task.create',{title:'Silinecek görev',plan_date:'2026-10-05'});
 await admin('delete from auth.users where id=$1',[DELETED]);
 const rows=await admin('select user_id from private.state_cache_generations where user_id=$1',[DELETED]);
 assert.equal(rows.rows.length,0);
 await browser(DELETED);await assert.rejects(()=>context(),/OWNER_REQUIRED/);
});
