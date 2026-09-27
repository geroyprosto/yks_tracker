import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { commandSchema } from "../../src/lib/domain/commands";
import type { AppState } from "../../src/lib/domain/types";

// Genuine embedded Postgres, with only Supabase Auth's identity source stubbed.
// This is never imported by application code and cannot enable a demo login.
const OWNER="11111111-1111-4111-8111-111111111111";
const OTHER="22222222-2222-4222-8222-222222222222";
let db:PGlite;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 insert into auth.users values('${OWNER}'),('${OTHER}');`);
 const migrations = new URL("../migrations/", import.meta.url);
 for (const name of (await readdir(migrations)).filter(name=>name.endsWith(".sql")).sort()) {
  await db.exec(await readFile(new URL(name,migrations),"utf8"));
 }
 await db.query("insert into public.owner_allowlist(user_id) values($1)",[OWNER]);
 await asOwner();
});
after(async()=>{await db?.close();});
async function asOwner(){await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${OWNER}',false);`);}
async function admin(sql:string,values:unknown[]=[]){await db.exec("reset role");try{return await db.query(sql,values);}finally{await asOwner();}}
async function state(){return (await db.query<{value:AppState}>("select public.yks_state() as value")).rows[0].value;}
async function command(type:string,payload:Record<string,unknown>,request_id:string=randomUUID()){
 return (await db.query<{value:{id:string;request_id:string;replayed:boolean}}>("select public.yks_command($1,$2,$3::jsonb) as value",[request_id,type,JSON.stringify(payload)])).rows[0].value;
}
async function ageActive(seconds:number){await admin("update public.study_sessions set started_at=started_at-make_interval(secs=>$1),active_since=active_since-make_interval(secs=>$1) where status='running'",[seconds]);await admin("update public.study_intervals set started_at=started_at-make_interval(secs=>$1) where ended_at is null",[seconds]);}

test("first owner load has settings and editable zero-progress topics, no invented records",async()=>{
 const value=await state();assert.equal(value.settings?.display_name,"Sümeyra");assert.ok(value.topics.length>60);assert.ok(value.topics.every(t=>t.mastery===0));assert.equal(value.tasks.length,0);assert.equal(value.sessions.length,0);assert.equal(value.practice_entries.length,0);assert.equal(value.day_plans.length,1);
});
test("an anonymous or non-owner account cannot read records or call the service",async()=>{
 await db.exec(`select set_config('request.jwt.claim.sub','${OTHER}',false)`);
 assert.equal((await db.query("select * from public.topics")).rows.length,0);
 await assert.rejects(state,/OWNER_REQUIRED/);
 await db.exec("reset role;set role anon");await assert.rejects(()=>db.query("select * from public.topics"),/permission denied/);await assert.rejects(state,/permission denied/);await asOwner();
 await assert.rejects(()=>db.query("update public.profiles set daily_target_minutes=0"),/permission denied/);
 await assert.rejects(()=>db.query("select private.initialize_owner($1)",[OWNER]),/permission denied/);
});
test("same request is replayed once; changed request payload is rejected",async()=>{
 const id=randomUUID();const payload={title:"İşlem testi",plan_date:"2026-09-23",planned_minutes:80,difficulty:"hard"};
 const first=await command("task.create",payload,id);const second=await command("task.create",payload,id);
 assert.equal(first.id,second.id);assert.equal(second.replayed,true);await assert.rejects(()=>command("task.create",{...payload,title:"Farklı"},id),/IDEMPOTENCY_CONFLICT/);
 assert.equal((await state()).tasks.filter(t=>t.id===first.id).length,1);
});
test("partial task edits preserve other fields and stale revisions are rejected",async()=>{
 const created=await command("task.create",{title:"Kısmi görev",plan_date:"2026-09-23",planned_minutes:80,difficulty:"hard",progress:.7});
 const parsed=commandSchema.parse({request_id:randomUUID(),type:"task.update",payload:{id:created.id,expected_revision:1,title:"Yeni başlık"}});
 assert.deepEqual(Object.keys(parsed.payload).sort(),["expected_revision","id","title"]);
 await command(parsed.type,parsed.payload);
 const task=(await state()).tasks.find(t=>t.id===created.id)!;assert.equal(task.progress,.7);assert.equal(task.planned_minutes,80);assert.equal(task.difficulty,"hard");assert.equal(task.revision,2);
 await assert.rejects(()=>command("task.update",{id:created.id,expected_revision:1,progress:1}),/CONFLICT/);
 await assert.rejects(()=>command("task.update",{id:created.id,expected_revision:2,user_id:OTHER}),/INVALID_INPUT/);
});
test("substeps use equal shares and do not add duplicate workload",async()=>{
 const created=await command("task.create",{title:"Adımlar",plan_date:"2026-09-23",planned_minutes:100,progress:1,steps:[{id:randomUUID(),title:"Bir",completed:true},{id:randomUUID(),title:"İki",completed:false}]});
 const task=(await state()).tasks.find(t=>t.id===created.id)!;assert.equal(task.progress,.5);assert.equal(task.planned_minutes,100);
});
test("review does not downgrade mastery, and mastery changes have history",async()=>{
 let topic=(await state()).topics[0];await command("topic.update",{id:topic.id,expected_revision:topic.revision,mastery:4});
 topic=(await state()).topics.find(t=>t.id===topic.id)!;await command("topic.update",{id:topic.id,expected_revision:topic.revision,review_requested:true});
 const result=await state();assert.equal(result.topics.find(t=>t.id===topic.id)!.mastery,4);assert.equal(result.topic_history.filter(h=>h.topic_id===topic.id).length,1);
});
test("settings updates version today's goals while previous days keep their snapshots",async()=>{
 const old=await state();const past=old.day_plans.filter(p=>p.plan_date==="2026-09-23");
 await command("settings.update",{expected_revision:old.settings!.revision,daily_target_minutes:180,task_share:.6});
 const next=await state();assert.deepEqual(next.day_plans.filter(p=>p.plan_date==="2026-09-23"),past);assert.equal(next.settings!.daily_target_minutes,180);assert.ok(next.day_plans.some(p=>p.target_minutes===180));assert.ok(next.day_plans.some(p=>p.version===1&&p.target_minutes===360));
});
test("timer prevents duplicate active sessions, persists intervals, excludes pauses and replays finish",async()=>{
 const started=await command("timer.start",{title:"Sayaç testi",mode:"stopwatch"});
 await assert.rejects(()=>command("timer.start",{title:"İkinci sayaç"}),/ACTIVE_SESSION/);
 await ageActive(120);let session=(await state()).sessions.find(s=>s.id===started.id)!;
 await command("timer.pause",{id:session.id,expected_revision:session.revision});session=(await state()).sessions.find(s=>s.id===started.id)!;
 assert.ok(session.accumulated_seconds>=120&&session.accumulated_seconds<123);const paused=session.accumulated_seconds;
 await command("timer.resume",{id:session.id,expected_revision:session.revision});await ageActive(60);session=(await state()).sessions.find(s=>s.id===started.id)!;
 const request_id=randomUUID();const payload={id:session.id,expected_revision:session.revision};await command("timer.finish",payload,request_id);await command("timer.finish",payload,request_id);
 const result=await state();session=result.sessions.find(s=>s.id===started.id)!;assert.equal(session.status,"finished");assert.ok(session.accumulated_seconds>=paused+60&&session.accumulated_seconds<paused+63);assert.equal(result.intervals.filter(i=>i.session_id===session.id).length,2);assert.ok(result.intervals.filter(i=>i.session_id===session.id).every(i=>i.ended_at));
});
test("countdown caps at target after the browser was closed",async()=>{
 const started=await command("timer.start",{title:"Geri sayım testi",mode:"countdown",target_seconds:60});await ageActive(3600);
 const result=await state();const session=result.sessions.find(s=>s.id===started.id)!;assert.equal(session.status,"finished");assert.equal(session.accumulated_seconds,60);
 const interval=result.intervals.find(i=>i.session_id===started.id)!;assert.equal((Date.parse(interval.ended_at!)-Date.parse(interval.started_at))/1000,60);
});
test("forgotten stopwatch requires confirmation before finish and finalized duration is immutable",async()=>{
 const started=await command("timer.start",{title:"Unutulan sayaç",mode:"stopwatch"});await ageActive(7*3600);let session=(await state()).sessions.find(s=>s.id===started.id)!;
 await assert.rejects(()=>command("timer.finish",{id:session.id,expected_revision:session.revision}),/CONFIRM_DURATION/);
 assert.equal((await state()).sessions.find(s=>s.id===started.id)!.status,"running");
 await command("timer.finish",{id:session.id,expected_revision:session.revision,confirmed_seconds:1800});session=(await state()).sessions.find(s=>s.id===started.id)!;assert.equal(session.accumulated_seconds,1800);
 await assert.rejects(()=>command("timer.correct",{id:session.id,expected_revision:session.revision,confirmed_seconds:1200,reason:"Fazla süre düzeltmesi"}),/DURATION_IMMUTABLE/);
 assert.equal((await state()).sessions.find(s=>s.id===started.id)!.accumulated_seconds,1800);
 assert.equal((await db.query("select id from public.audit_log where entity_id=$1 and action='timer.correct'",[started.id])).rows.length,0);
});
test("topic hierarchy rejects cycles and other-account foreign references",async()=>{
 const a=await command("topic.create",{exam:"AYT",subject:"Test dersi",name:"Üst konu"});const b=await command("topic.create",{exam:"AYT",subject:"Test dersi",name:"Alt konu",parent_id:a.id});
 await assert.rejects(()=>command("topic.update",{id:a.id,expected_revision:1,parent_id:b.id}),/INVALID_INPUT/);
 await admin("insert into public.topics(id,user_id,exam,subject,name) values($1,$2,'TYT','Özel','Diğer hesap')",[OTHER,OTHER]);
 await assert.rejects(()=>command("task.create",{title:"Yabancı ilişki",plan_date:"2026-09-24",topic_id:OTHER}),/foreign key constraint/);
});

test("direct RPC rejects invalid nested JSON and every exposed table has RLS",async()=>{
 await assert.rejects(()=>command("task.create",{title:"Geçersiz adım",plan_date:"2026-09-24",steps:[{id:null,title:null,completed:true}]}),/INVALID_INPUT|check constraint/);
 const profile=(await state()).settings!;
 await assert.rejects(()=>command("settings.update",{expected_revision:profile.revision,difficulty_factors:{easy:null,medium:1.25,hard:1.5}}),/check constraint/);
 const tables=await admin("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
 assert.ok(tables.rows.length>=10);assert.ok(tables.rows.every(row=>(row as {relrowsecurity:boolean}).relrowsecurity));
});

test("shared service validates commands and maps conflicts through a database adapter",async()=>{
 const {executeCommand,getState}=await import("../../src/lib/server/service");
 const {ApiError}=await import("../../src/lib/server/http");
 const adapter={rpc:async(name:string,args?:Record<string,unknown>)=>{
  try{
   const query=name==="yks_state"?"select public.yks_state() as value":"select public.yks_command($1,$2,$3::jsonb) as value";
   const values=name==="yks_state"?[]:[args!.request_id,args!.command_type,JSON.stringify(args!.payload)];
   return {data:(await db.query<{value:unknown}>(query,values)).rows[0].value,error:null};
  }catch(error){const failure=error as {message:string;code:string};return {data:null,error:{message:failure.message,code:failure.code}};}
 }} as unknown as import("@supabase/supabase-js").SupabaseClient;
 const current=await getState(adapter);assert.equal(current.configured,true);assert.equal(current.authenticated,true);
 await assert.rejects(()=>executeCommand(adapter,{type:"task.create",payload:{}}),(error:unknown)=>error instanceof ApiError&&error.status===400);
 const request_id=randomUUID();const input={request_id,type:"task.create",payload:{title:"Servis katmanı testi",plan_date:"2026-09-24"}};
 const created=await executeCommand(adapter,input);assert.equal(created.ok,true);assert.ok(created.state.tasks.some(t=>t.id===created.id));
 await assert.rejects(()=>executeCommand(adapter,{...input,payload:{...input.payload,title:"Başka veri"}}),(error:unknown)=>error instanceof ApiError&&error.code==="IDEMPOTENCY_CONFLICT");
});


test("HTTP mutations accept the actual same-origin host and reject cross-site requests",async()=>{
 const {sameOrigin,ApiError}=await import("../../src/lib/server/http");
 sameOrigin(new Request("http://localhost:3000/api/command",{headers:{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000"}}));
 sameOrigin(new Request("https://yksim.example/api/command",{headers:{host:"yksim.example",origin:"https://yksim.example"}}));
 assert.throws(()=>sameOrigin(new Request("http://localhost:3000/api/command",{headers:{host:"127.0.0.1:3000",origin:"https://external.example","x-forwarded-host":"external.example"}})),(error:unknown)=>error instanceof ApiError&&error.status===403);
 assert.throws(()=>sameOrigin(new Request("http://localhost:3000/api/command",{headers:{host:"localhost:3000"}})),/aynı uygulamadan/);
});

test("atomic task moves swap adjacent same-day tasks, normalize ties, and reject stale revisions",async()=>{
 const day="2026-10-01";
 const a=await command("task.create",{title:"Sıra A",plan_date:day});
 const b=await command("task.create",{title:"Sıra B",plan_date:day});
 const c=await command("task.create",{title:"Sıra C",plan_date:day});
 let tasks=(await state()).tasks.filter(t=>t.plan_date===day);assert.deepEqual(tasks.map(t=>t.id),[a.id,b.id,c.id]);assert.deepEqual(tasks.map(t=>t.position),[0,1,2]);
 let beforePlans=(await state()).day_plans.filter(p=>p.plan_date===day).length;
 const up={id:c.id,expected_revision:1,direction:"up"};await command("task.move",up);
 tasks=(await state()).tasks.filter(t=>t.plan_date===day);assert.deepEqual(tasks.map(t=>t.id),[a.id,c.id,b.id]);assert.deepEqual(tasks.map(t=>t.position),[0,1,2]);assert.equal((await state()).day_plans.filter(p=>p.plan_date===day).length,beforePlans+1);
 await assert.rejects(()=>command("task.move",up),/CONFLICT/);
 await command("task.move",{id:a.id,expected_revision:tasks.find(t=>t.id===a.id)!.revision,direction:"down"});
 tasks=(await state()).tasks.filter(t=>t.plan_date===day);assert.deepEqual(tasks.map(t=>t.id),[c.id,a.id,b.id]);
 // Legacy equal positions are canonicalized in a single transaction too.
 await admin("update public.tasks set position=0 where plan_date=$1",[day]);
 tasks=(await state()).tasks.filter(t=>t.plan_date===day);const moving=tasks[2];
 beforePlans=(await state()).day_plans.filter(p=>p.plan_date===day).length;
 await command("task.move",{id:moving.id,expected_revision:moving.revision,direction:"up"});
 const normalized=(await state()).tasks.filter(t=>t.plan_date===day);assert.deepEqual(normalized.map(t=>t.id),[tasks[0].id,tasks[2].id,tasks[1].id]);assert.deepEqual(normalized.map(t=>t.position),[0,1,2]);assert.equal((await state()).day_plans.filter(p=>p.plan_date===day).length,beforePlans+1);
});


test("neutral themes persist through the settings command while invalid themes are rejected",async()=>{
 for (const theme of ["white","black"] as const) {
  const previous=(await state()).settings!;
  const input=commandSchema.parse({request_id:randomUUID(),type:"settings.update",payload:{expected_revision:previous.revision,theme}});
  await command(input.type,input.payload,input.request_id);
  const saved=(await state()).settings!;
  assert.equal(saved.theme,theme);
  assert.equal(saved.revision,previous.revision+1);
  assert.equal(saved.appearance,previous.appearance);
  assert.equal(saved.daily_target_minutes,previous.daily_target_minutes);
 }
 const previous=(await state()).settings!;
 const invalid={request_id:randomUUID(),type:"settings.update",payload:{expected_revision:previous.revision,theme:"unknown-theme"}};
 assert.equal(commandSchema.safeParse(invalid).success,false);
 await assert.rejects(()=>command(invalid.type,invalid.payload,invalid.request_id),/profiles_theme_check/);
 const unchanged=(await state()).settings!;
 assert.equal(unchanged.theme,previous.theme);
 assert.equal(unchanged.revision,previous.revision);
});

test("practice entries persist by local date, exam and subject with idempotent edits",async()=>{
 const payload={practice_date:"2026-09-24",exam:"TYT",subject:"Matematik",question_count:75,test_count:3};
 const request_id=randomUUID();
 const parsed=commandSchema.parse({request_id,type:"practice.create",payload});
 const first=await command(parsed.type,parsed.payload,request_id);
 const replay=await command(parsed.type,parsed.payload,request_id);
 assert.equal(replay.id,first.id);assert.equal(replay.replayed,true);
 let saved=(await state()).practice_entries.find(entry=>entry.id===first.id)!;
 assert.equal(saved.practice_date,"2026-09-24");
 assert.equal(saved.exam,"TYT");assert.equal(saved.subject,"Matematik");
 assert.equal(saved.question_count,75);assert.equal(saved.test_count,3);
 assert.equal(saved.revision,1);
 await command("practice.update",{id:first.id,expected_revision:1,question_count:90});
 saved=(await state()).practice_entries.find(entry=>entry.id===first.id)!;
 assert.equal(saved.question_count,90);assert.equal(saved.test_count,3);
 assert.equal(saved.revision,2);
 await assert.rejects(()=>command("practice.update",{id:first.id,expected_revision:1,test_count:4}),/CONFLICT/);
 await command("practice.delete",{id:first.id,expected_revision:2});
 assert.equal((await state()).practice_entries.some(entry=>entry.id===first.id),false);
 const audit=await admin("select action from public.audit_log where entity_id=$1 order by occurred_at",[first.id]);
 assert.deepEqual(audit.rows.map(row=>(row as {action:string}).action),["practice.create","practice.update","practice.delete"]);
});

test("practice validation and ownership reject invalid counts, hidden fields and cross-account access",async()=>{
 const base={practice_date:"2026-09-24",exam:"AYT",subject:"Fizik",question_count:0,test_count:2};
 assert.equal(commandSchema.safeParse({request_id:randomUUID(),type:"practice.create",payload:{...base,test_count:0}}).success,false);
 assert.equal(commandSchema.safeParse({request_id:randomUUID(),type:"practice.create",payload:{...base,question_count:-1}}).success,false);
 await assert.rejects(()=>command("practice.create",{...base,test_count:0}),/check constraint/);
 await assert.rejects(()=>command("practice.create",{...base,user_id:OTHER}),/INVALID_INPUT/);
 const created=await command("practice.create",base);
 await assert.rejects(()=>command("practice.update",{id:created.id,expected_revision:1,question_count:-1}),/INVALID_INPUT/);
 await assert.rejects(()=>command("practice.delete",{id:created.id,expected_revision:1,subject:"Kimya"}),/INVALID_INPUT/);
 await assert.rejects(()=>db.query("insert into public.practice_entries(user_id,practice_date,exam,subject,question_count,test_count) values($1,'2026-09-24','TYT','Matematik',1,0)",[OWNER]),/permission denied/);
 try{
  await db.exec("select set_config('request.jwt.claim.sub','" + OTHER + "',false)");
  assert.equal((await db.query("select * from public.practice_entries")).rows.length,0);
  await assert.rejects(()=>command("practice.update",{id:created.id,expected_revision:1,test_count:9}),/OWNER_REQUIRED/);
 }finally{await asOwner();}
 assert.equal((await state()).practice_entries.find(entry=>entry.id===created.id)!.test_count,2);
});



test("exam formats stay versioned and full TYT totals count each section exactly once",async()=>{
 const formats=(await state()).exam_formats;
 assert.equal(formats.find(f=>f.code==="TYT")?.total_questions,120);
 assert.equal(formats.find(f=>f.code==="AYT_SAYISAL")?.total_questions,80);
 assert.equal(formats.find(f=>f.code==="TYT")!.sections.reduce((n,s)=>n+s.question_count,0),120);
 assert.equal(formats.find(f=>f.code==="AYT_SAYISAL")!.sections.reduce((n,s)=>n+s.question_count,0),80);
 const sections=formats.find(f=>f.code==="TYT")!.sections;
 const results=sections.map(s=>s.key==="matematik"
  ? {section_key:s.key,correct:10,wrong:4,blank:26}
  : s.key==="fizik"
   ? {section_key:s.key,correct:0,wrong:7,blank:0}
   : {section_key:s.key,correct:0,wrong:0,blank:s.question_count});
 const payload={name:"Eylül TYT",publisher:"Yayın",exam_date:"2026-09-24",
  format_code:"TYT",duration_minutes:165,score:312.5,rank:62000,results};
 const parsed=commandSchema.parse({request_id:randomUUID(),type:"exam.create",payload});
 const created=await command(parsed.type,parsed.payload);
 const exam=(await state()).exams.find(e=>e.id===created.id)!;
 assert.equal(exam.format_code,"TYT");assert.equal(exam.format_version,1);
 assert.equal(exam.format_snapshot.total_questions,120);
 assert.equal(exam.total_net,7.25);
 assert.equal(exam.score,312.5);assert.equal(exam.rank,62000);
 assert.equal(exam.results.find(r=>r.section_key==="matematik")!.net,9);
 assert.equal(exam.results.find(r=>r.section_key==="fizik")!.net,-1.75);
 assert.equal(exam.source_document_id,null);
 assert.equal(exam.import_metadata,null);
});

test("net-only and incomplete results remain honest, edits are atomic and revisioned",async()=>{
 const payload={name:"AYT provaları",exam_date:"2026-09-23",format_code:"AYT_SAYISAL",
  results:[{section_key:"matematik",net:18.25}]};
 const request_id=randomUUID();
 const first=await command("exam.create",payload,request_id);
 assert.equal((await command("exam.create",payload,request_id)).replayed,true);
 let exam=(await state()).exams.find(e=>e.id===first.id)!;
 assert.equal(exam.total_net,null);
 assert.deepEqual([exam.results[0].correct,exam.results[0].wrong,exam.results[0].blank],[null,null,null]);
 assert.equal(exam.results[0].net,18.25);
 const replacement=[
  {section_key:"matematik",net:18.25},{section_key:"fizik",correct:0,wrong:14,blank:0},
  {section_key:"kimya",net:5},{section_key:"biyoloji",net:4}
 ];
 await command("exam.update",{id:first.id,expected_revision:1,
  name:"AYT son kayıt",results:replacement});
 exam=(await state()).exams.find(e=>e.id===first.id)!;
 assert.equal(exam.total_net,23.75);
 assert.equal(exam.results.find(r=>r.section_key==="fizik")!.net,-3.5);
 assert.equal(exam.revision,2);assert.equal(exam.name,"AYT son kayıt");
 assert.deepEqual([exam.results.find(r=>r.section_key==="matematik")!.correct,
  exam.results.find(r=>r.section_key==="matematik")!.wrong],[null,null]);
 await assert.rejects(()=>command("exam.update",{id:first.id,expected_revision:1,name:"Eski sürüm"}),/CONFLICT/);
 await command("exam.update",{id:first.id,expected_revision:2,notes:"Dikkat hatası",score:340});
 exam=(await state()).exams.find(e=>e.id===first.id)!;
 assert.equal(exam.total_net,23.75);assert.equal(exam.score,340);
 assert.equal(exam.results.length,4);assert.equal(exam.revision,3);
 await assert.rejects(()=>command("exam.create",{...payload,name:"Başka deneme"},request_id),/IDEMPOTENCY_CONFLICT/);
});

test("branch formats use their real question counts and keep rank apart from net",async()=>{
 const first=await command("exam.create",{name:"Fizik branş",exam_date:"2026-09-22",
  format_code:"BRANCH",branch_subject:"Fizik",branch_question_count:20,
  score:312,rank:80000,results:[{section_key:"branch",net:-5}]});
 const exam=(await state()).exams.find(e=>e.id===first.id)!;
 assert.equal(exam.format_snapshot.total_questions,20);
 assert.equal(exam.format_snapshot.sections[0].label,"Fizik");
 assert.equal(exam.total_net,-5);assert.equal(exam.score,312);assert.equal(exam.rank,80000);
 await assert.rejects(()=>command("exam.create",{name:"Geçersiz branş",exam_date:"2026-09-22",
  format_code:"BRANCH",branch_subject:"Fizik",branch_question_count:20,
  results:[{section_key:"branch",net:-5.1}]}),/INVALID_INPUT/);
});

test("exam validation rejects overflow, duplicate sections, mixed modes and hidden provenance",async()=>{
 const base={name:"Geçersiz",exam_date:"2026-09-21",format_code:"AYT_SAYISAL"};
 const fails=[
  [{section_key:"fizik",correct:15,wrong:0,blank:0}],
  [{section_key:"fizik",correct:2,wrong:2,blank:11}],
  [{section_key:"fizik",correct:0,wrong:-1,blank:0}],
  [{section_key:"fizik",correct:0,wrong:14}],
  [{section_key:"fizik",correct:0,wrong:14,blank:0,net:-3.5}],
  [{section_key:"fizik",net:15}],
  [{section_key:"fizik",net:2},{section_key:"fizik",net:3}],
 ];
 for(const results of fails){
  await assert.rejects(()=>command("exam.create",{...base,results}),/INVALID_INPUT/);
 }
 const parsed=commandSchema.safeParse({request_id:randomUUID(),type:"exam.create",
  payload:{...base,results:[{section_key:"fizik",net:2},{section_key:"fizik",net:3}]}});
 assert.equal(parsed.success,false);
 await assert.rejects(()=>command("exam.create",{...base,
  results:[{section_key:"fizik",net:2}],source_document_id:randomUUID()}),/INVALID_INPUT/);
 await assert.rejects(()=>command("exam.create",{...base,
  results:[{section_key:"fizik",net:2}],branch_question_count:20}),/INVALID_INPUT/);
});

test("exam writes are owner-only; deletion records audit and removes child results",async()=>{
 const created=await command("exam.create",{name:"Silinecek",exam_date:"2026-09-20",
  format_code:"BRANCH",branch_subject:"Matematik",branch_question_count:40,
  results:[{section_key:"branch",correct:20,wrong:8,blank:12}]});
 await assert.rejects(()=>db.query("insert into public.exams(user_id,name,exam_date,format_code,format_version,format_snapshot) values($1,'Doğrudan','2026-09-20','TYT',1,'{}'::jsonb)",[OWNER]),/permission denied/);
 try {
  await db.exec("select set_config('request.jwt.claim.sub','" + OTHER + "',false)");
  assert.equal((await db.query("select * from public.exams")).rows.length,0);
  assert.equal((await db.query("select * from public.exam_results")).rows.length,0);
  await assert.rejects(()=>command("exam.delete",{id:created.id,expected_revision:1}),/OWNER_REQUIRED/);
 } finally { await asOwner(); }
 await command("exam.delete",{id:created.id,expected_revision:1});
 assert.equal((await state()).exams.some(e=>e.id===created.id),false);
 const remaining=await admin("select count(*)::integer as n from public.exam_results where exam_id=$1",[created.id]);
 assert.equal((remaining.rows[0] as {n:number}).n,0);
 const audit=await admin("select action from public.audit_log where entity_id=$1 order by occurred_at",[created.id]);
 assert.deepEqual(audit.rows.map(row=>(row as {action:string}).action),["exam.create","exam.delete"]);
});

test("journal preserves the exact original text and only shares chosen fields",async()=>{
 const original="  Bugün biraz yoruldum.\nAkşam matematik daha iyi gitti.  ";
 const payload={journal_date:"2026-09-24",original_text:original,
  structured_fields:{sleep_at:"23:30",wake_at:"07:10",mood:"Sakin",energy:3,
   interruptions:2,activities:["Yürüyüş"]},
  exclude_from_analysis:true,ai_shared_fields:["mood","energy"]};
 const request_id=randomUUID();
 const parsed=commandSchema.parse({request_id,type:"journal.create",payload});
 const created=await command(parsed.type,parsed.payload,request_id);
 assert.equal((await command(parsed.type,parsed.payload,request_id)).replayed,true);
 let journal=(await state()).journal_entries.find(e=>e.id===created.id)!;
 assert.equal(journal.original_text,original);
 assert.deepEqual(journal.structured_fields,payload.structured_fields);
 assert.equal(journal.exclude_from_analysis,true);
 assert.deepEqual(journal.ai_shared_fields,["mood","energy"]);
 assert.equal(journal.revision,1);
 await assert.rejects(()=>command("journal.create",{...payload,original_text:"Farklı"}),/JOURNAL_EXISTS/);
 await command("journal.update",{id:created.id,expected_revision:1,
  structured_fields:{mood:"Daha iyi",thoughts:"Tekrar gerekli"},
  ai_shared_fields:["original_text","mood"],exclude_from_analysis:false});
 journal=(await state()).journal_entries.find(e=>e.id===created.id)!;
 assert.equal(journal.original_text,original);
 assert.equal(journal.structured_fields.mood,"Daha iyi");
 assert.equal(journal.structured_fields.energy,undefined);
 assert.deepEqual(journal.ai_shared_fields,["original_text","mood"]);
 assert.equal(journal.revision,2);
 await assert.rejects(()=>command("journal.update",{id:created.id,expected_revision:1,
  original_text:"Eski sürüm"}),/CONFLICT/);
 const audit=await admin("select old_value,new_value from public.audit_log where entity_id=$1 and action='journal.update'",[created.id]);
 assert.equal((audit.rows[0] as {old_value:{original_text:string}}).old_value.original_text,original);
 await command("journal.delete",{id:created.id,expected_revision:2});
 assert.equal((await state()).journal_entries.some(e=>e.id===created.id),false);
});

test("journal rejects invented fields, unselected private data and invalid time or lists",async()=>{
 const base={journal_date:"2026-09-19",original_text:"Kısa kayıt"};
 const invalid=[
  {...base,structured_fields:{wake_at:"25:10"}},
  {...base,structured_fields:{unknown:"Uydurma"}},
  {...base,structured_fields:{energy:6}},
  {...base,structured_fields:{activities:[""]}},
  {...base,structured_fields:{mood:"İyi"},ai_shared_fields:["mood","mood"]},
  {...base,structured_fields:{mood:"İyi"},ai_shared_fields:["energy"]},
  {...base,original_text:"",structured_fields:{}},
  {...base,ai_shared_fields:["unknown"]},
 ];
 for(const payload of invalid){
  await assert.rejects(()=>command("journal.create",payload),/INVALID_INPUT|check constraint/);
 }
 const parsed=commandSchema.safeParse({request_id:randomUUID(),type:"journal.create",
  payload:{...base,structured_fields:{wake_at:"25:10"}}});
 assert.equal(parsed.success,false);
});

test("rest and confirmed-zero day markers are explicit, revisioned and removable",async()=>{
 const request_id=randomUUID();
 const marked=await command("day.mark",{mark_date:"2026-09-18",kind:"rest"},request_id);
 assert.equal((await command("day.mark",{mark_date:"2026-09-18",kind:"rest"},request_id)).replayed,true);
 let day=(await state()).day_marks.find(e=>e.id===marked.id)!;
 assert.equal(day.mark_date,"2026-09-18");assert.equal(day.kind,"rest");assert.equal(day.revision,1);
 const unchanged=await command("day.mark",{mark_date:"2026-09-18",kind:"rest"});
 assert.equal(unchanged.id,marked.id);
 day=(await state()).day_marks.find(e=>e.id===marked.id)!;
 assert.equal(day.revision,1);
 await command("day.mark",{mark_date:"2026-09-18",kind:"zero"});
 day=(await state()).day_marks.find(e=>e.id===marked.id)!;
 assert.equal(day.kind,"zero");assert.equal(day.revision,2);
 await assert.rejects(()=>command("day.unmark",{id:marked.id,expected_revision:1}),/CONFLICT/);
 await command("day.unmark",{id:marked.id,expected_revision:2});
 assert.equal((await state()).day_marks.some(e=>e.id===marked.id),false);
 const parsed=commandSchema.safeParse({request_id:randomUUID(),type:"day.mark",
  payload:{mark_date:"2026-09-18",kind:"unknown"}});
 assert.equal(parsed.success,false);
});

test("journal and day marks do not leak to another account and cannot be directly written",async()=>{
 const journal=await command("journal.create",{journal_date:"2026-09-17",
  original_text:"Özel not",exclude_from_analysis:true});
 const day=await command("day.mark",{mark_date:"2026-09-17",kind:"rest"});
 await assert.rejects(()=>db.query("update public.journal_entries set original_text='sızma' where id=$1",[journal.id]),/permission denied/);
 await assert.rejects(()=>db.query("insert into public.day_marks(user_id,mark_date,kind) values($1,'2026-09-16','zero')",[OWNER]),/permission denied/);
 try {
  await db.exec("select set_config('request.jwt.claim.sub','" + OTHER + "',false)");
  assert.equal((await db.query("select * from public.journal_entries")).rows.length,0);
  assert.equal((await db.query("select * from public.day_marks")).rows.length,0);
  await assert.rejects(()=>command("journal.delete",{id:journal.id,expected_revision:1}),/OWNER_REQUIRED/);
  await assert.rejects(()=>command("day.unmark",{id:day.id,expected_revision:1}),/OWNER_REQUIRED/);
 } finally { await asOwner(); }
 assert.equal((await state()).journal_entries.find(e=>e.id===journal.id)!.original_text,"Özel not");
 assert.equal((await state()).day_marks.find(e=>e.id===day.id)!.kind,"rest");
});

test("reported overall exam net is stored without guessed subject results",async()=>{
 const created=await command("exam.create",{name:"TYT toplam net",exam_date:"2026-09-15",
  format_code:"TYT",results:[],reported_total_net:72.25});
 let exam=(await state()).exams.find(e=>e.id===created.id)!;
 assert.equal(exam.results.length,0);
 assert.equal(exam.reported_total_net,72.25);
 assert.equal(exam.total_net,72.25);
 assert.equal(exam.total_net_source,"reported");
 await command("exam.update",{id:created.id,expected_revision:1,reported_total_net:73.5});
 exam=(await state()).exams.find(e=>e.id===created.id)!;
 assert.equal(exam.total_net,73.5);
 assert.equal(exam.total_net_source,"reported");
 await assert.rejects(()=>command("exam.create",{name:"Boş",exam_date:"2026-09-15",
  format_code:"TYT",results:[]}),/INVALID_INPUT/);
 await assert.rejects(()=>command("exam.create",{name:"Sınır",exam_date:"2026-09-15",
  format_code:"TYT",results:[],reported_total_net:121}),/INVALID_INPUT/);
 await assert.rejects(()=>command("exam.create",{name:"Uyuşmazlık",exam_date:"2026-09-15",
  format_code:"BRANCH",branch_subject:"Fizik",branch_question_count:20,
  results:[{section_key:"branch",correct:10,wrong:0,blank:10}],reported_total_net:11}),/INVALID_INPUT/);
});

test("PDF import registration hashes documents and commit is atomic, reviewed and idempotent",async()=>{
 const candidates=[{index:0,label:"TYT",student_label:null,format_code:"TYT",
  exam_date:"2026-09-14",name:"PDF deneme",publisher:null,results:[],
  source_pages:[1],warnings:["İncele"]}];
 const register=async(hash:string)=>(
  await db.query<{value:{id:string;duplicate_upload:boolean}}>(
   "select public.exam_import_register($1,$2,$3,$4,$5,$6::jsonb) as value",
   [hash,"sonuc.pdf",1024,1,"needs_visual_review",JSON.stringify(candidates)])
 ).rows[0].value;
 const hash1="a".repeat(64);
 const document=await register(hash1);
 assert.equal(document.duplicate_upload,false);
 assert.equal((await db.query<{visual_extraction_status:string}>(
  "select visual_extraction_status from public.exam_documents where id=$1",
  [document.id])).rows[0].visual_extraction_status,"not_needed");
 const visualDocument=(await db.query<{value:{id:string}}>(
  "select public.exam_import_register($1,$2,$3,$4,$5,$6::jsonb,$7) as value",
  ["f".repeat(64),"taranmis.pdf",1024,1,"ready",JSON.stringify(candidates),"succeeded"]
 )).rows[0].value;
 assert.equal((await db.query<{visual_extraction_status:string}>(
  "select visual_extraction_status from public.exam_documents where id=$1",
  [visualDocument.id])).rows[0].visual_extraction_status,"succeeded");
 await assert.rejects(()=>db.query(
  "select public.exam_import_register($1,$2,$3,$4,$5,$6::jsonb,$7)",
  ["e".repeat(64),"bad.pdf",1024,1,"ready",JSON.stringify(candidates),"invented"]
 ),/INVALID_INPUT/);
 assert.equal((await register(hash1)).id,document.id);
 assert.equal((await register(hash1)).duplicate_upload,true);
 const dbDocument=(await state());assert.ok(dbDocument.exams.every(e=>e.source_document_id!==document.id));
 const payload={name:"PDF deneme",exam_date:"2026-09-14",format_code:"TYT",
  results:[],reported_total_net:61.5};
 const commit=async(docId:string,requestId:string,accept=false,exam=payload)=>(
  await db.query<{value:{id:string;replayed:boolean}}>(
   "select public.exam_import_commit($1,$2,$3,$4::jsonb,$5) as value",
   [requestId,docId,0,JSON.stringify(exam),accept])
 ).rows[0].value;
 const request_id=randomUUID();
 const saved=await commit(document.id,request_id);
 assert.equal((await commit(document.id,request_id)).replayed,true);
 const exam=(await state()).exams.find(e=>e.id===saved.id)!;
 assert.equal(exam.source_document_id,document.id);
 assert.equal(exam.total_net,61.5);
 assert.equal(exam.total_net_source,"reported");
 assert.equal(exam.results.length,0);
 assert.equal(exam.import_metadata?.document_sha256,hash1);
 await assert.rejects(()=>commit(document.id,randomUUID()),/IMPORT_ALREADY_SAVED/);
 const imports=await db.query("select * from public.exam_imports where document_id=$1",[document.id]);
 assert.equal(imports.rows.length,1);
 const doc2=await register("b".repeat(64));
 await assert.rejects(()=>commit(doc2.id,randomUUID()),/POSSIBLE_DUPLICATE/);
 const accepted=await commit(doc2.id,randomUUID(),true);
 assert.notEqual(accepted.id,saved.id);
 const doc3=await register("c".repeat(64));
 await assert.rejects(()=>commit(doc3.id,randomUUID(),false,
  {...payload,exam_date:"2026-09-13",reported_total_net:121}),/INVALID_INPUT/);
 assert.equal((await db.query<{n:number}>("select count(*)::integer as n from public.exam_imports where document_id=$1",[doc3.id])).rows[0].n,0);
 await assert.rejects(()=>db.query("insert into public.exam_documents(user_id,original_filename,sha256,storage_path,byte_size,page_count,extraction_status,candidates) values($1,'bad.pdf',$2,$3,1024,1,'ready','[]'::jsonb)",
   [OWNER,"d".repeat(64),OWNER+"/"+"d".repeat(64)+".pdf"]),/permission denied/);
});
