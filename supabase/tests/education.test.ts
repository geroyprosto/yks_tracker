import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {defaultSetup,type EducationState,type SetupInput} from '../../src/lib/education';
import type {AppState} from '../../src/lib/domain/types';
const [STUDENT,OTHER,PENDING,TEACHER,UNVERIFIED,LEGACY]=Array.from({length:6},()=>randomUUID());
let db:PGlite;let legacyBefore:unknown;
async function actor(id:string){await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
async function admin(sql:string,args:unknown[]=[]){await db.exec('reset role');return db.query(sql,args);}
async function command(type:string,payload:unknown,requestId=randomUUID()){return (await db.query<{value:{id:string;replayed:boolean}}>('select public.education_command($1,$2,$3::jsonb) as value',[requestId,type,JSON.stringify(payload)])).rows[0].value;}
async function study(type:string,payload:unknown){return (await db.query<{value:{id:string}}>('select public.yks_command($1,$2,$3::jsonb) as value',[randomUUID(),type,JSON.stringify(payload)])).rows[0].value;}
async function state(){return (await db.query<{value:EducationState}>('select public.education_state() as value')).rows[0].value;}
async function app(){return (await db.query<{value:AppState}>('select public.yks_state() as value')).rows[0].value;}
function university():SetupInput{return {profile:{...defaultSetup().profile,education_level:'university',grade:null,department:'Uluslararası Ticaret',yks_goal:false},term:{academic_year:'2026–2027',name:'Güz'},courses:['Matematik','Bilişim','Yabancı Dil','İktisat'].map(name=>({name,context:'school'}))};}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 const base=new URL('../migrations/',import.meta.url),names=(await readdir(base)).filter(n=>n.endsWith('.sql')).sort();
 for(const name of names){
  if(name.includes('student_personalization')){
   await db.query('insert into auth.users values($1,$2,now())',[LEGACY,'legacy@example.test']);
   await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Eski YKS','legacy@example.test','student','approved')",[LEGACY]);
   await actor(LEGACY);await app();
   const s=await study('timer.start',{title:'YKS geçmişi'});await study('timer.finish',{id:s.id,expected_revision:1});
   const explicit=await study('timer.start',{title:'Açık YKS bağlamı',subject:'TYT Matematik'});await study('timer.finish',{id:explicit.id,expected_revision:1});
   await study('manual_study.create',{confirmed_by_user:true,study_date:'2026-09-26',subject:'TYT Matematik',minutes:30});
   await study('manual_study.create',{confirmed_by_user:true,study_date:'2026-09-26',subject:'Matematik',minutes:15});
   await study('task.create',{title:'Korunacak görev',plan_date:'2026-09-27',exam:'TYT',subject:'Matematik'});
   const topic=(await app()).topics[0];await study('topic.update',{id:topic.id,expected_revision:topic.revision,mastery:3});
   await study('exam.create',{name:'Korunacak deneme',exam_date:'2026-09-27',format_code:'BRANCH',branch_subject:'Matematik',branch_question_count:20,results:[{section_key:'branch',correct:16,wrong:4,blank:0}]});
   legacyBefore=await snapshot();await db.exec('reset role');
  }
  await db.exec(await readFile(new URL(name,base),'utf8'));
 }
 for(const id of [STUDENT,OTHER,PENDING,TEACHER,UNVERIFIED]){
  await db.query('insert into auth.users values($1,$2,$3)',[id,`${id}@example.test`,id===UNVERIFIED?null:new Date().toISOString()]);
  await db.query('insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,$4,$5)',[id,'Sentetik öğrenci',`${id}@example.test`,id===TEACHER?'teacher':'student',id===PENDING?'pending':'approved']);
 }
 await actor(STUDENT);
});
after(async()=>{await db?.close();});
async function snapshot(){const s=await app();const legacy=<T extends {course_id?:string|null}>(r:T)=>{const copy={...r};delete copy.course_id;return copy;};return {tasks:s.tasks.map(legacy),topics:s.topics,exams:s.exams,sessions:s.sessions.map(legacy),manual:s.manual_study_entries?.map(legacy),intervals:s.intervals,history:s.topic_history};}
test('migration keeps existing YKS topics, mastery, net, intervals and time without mandatory setup',async()=>{
 await actor(LEGACY);
 const before=legacyBefore as Awaited<ReturnType<typeof snapshot>>;
 const after=await snapshot();
 const originalTaskIds=new Set(before.tasks.map(task=>task.id));
 assert.deepEqual({...after,tasks:after.tasks.filter(task=>originalTaskIds.has(task.id))},before);
 assert.equal(after.tasks.filter(task=>!originalTaskIds.has(task.id)).length,5);
 assert.equal((await state()).needs_onboarding,false);
 const counts=(await state()).courses;assert.ok(counts.some(c=>c.context==='yks'&&c.exam==='TYT'&&c.name==='Matematik'));
 const linked=(await app()),math=counts.find(c=>c.context==='yks'&&c.exam==='TYT'&&c.name==='Matematik')!;
 assert.equal(linked.tasks[0].course_id,math.id);assert.equal(linked.sessions.find(s=>s.subject==='TYT Matematik')?.course_id,math.id);
 assert.equal(linked.manual_study_entries?.find(s=>s.subject==='TYT Matematik')?.course_id,math.id);
 assert.equal(linked.manual_study_entries?.find(s=>s.subject==='Matematik')?.course_id,null);
});
test('verified pending student can save an incomplete private draft but cannot read or commit study records',async()=>{
 await actor(PENDING);const setup=defaultSetup();setup.profile.grade=null;setup.term={academic_year:'',name:''};
 const id=randomUUID();await command('draft.save',{expected_revision:0,step:1,data:setup},id);
 assert.equal((await command('draft.save',{expected_revision:0,step:1,data:setup},id)).replayed,true);
 const s=await state();assert.equal(s.draft?.step,1);assert.equal(s.can_commit,false);assert.deepEqual(s.courses,[]);
 await assert.rejects(()=>command('profile.save',{expected_revision:0,...university()}),/APPROVAL_REQUIRED/);
 await assert.rejects(()=>app(),/OWNER_REQUIRED/);
 assert.equal((await db.query('select * from public.education_courses')).rows.length,0);
 await actor(OTHER);assert.equal((await db.query('select * from public.education_drafts')).rows.length,0);
 for(const user of [UNVERIFIED,TEACHER]){await actor(user);await assert.rejects(()=>state(),/STUDENT_REQUIRED/);await assert.rejects(()=>command('draft.save',{expected_revision:0,step:0,data:defaultSetup()}),/STUDENT_REQUIRED/);}
});
test('university catalog feeds tasks, timer and manual entries through stable owner-scoped identities',async()=>{
 await actor(STUDENT);assert.equal((await state()).needs_onboarding,true);await command('profile.save',{expected_revision:0,...university()});
 const s=await state();assert.equal(s.courses.length,4);assert.equal(s.needs_onboarding,false);
 const course=s.courses[0];const task=await study('task.create',{title:'Ortak ders',plan_date:'2026-09-27',course_id:course.id});
 assert.equal((await app()).tasks.find(t=>t.id===task.id)?.subject,course.name);
 const topic=(await app()).topics[0];await assert.rejects(()=>study('task.update',{id:task.id,expected_revision:1,topic_id:topic.id}),/INVALID_INPUT/);
 const timer=await study('timer.start',{task_id:task.id});assert.equal((await app()).sessions.find(t=>t.id===timer.id)?.course_id,course.id);
 await study('task.update',{id:task.id,expected_revision:1,course_id:s.courses[1].id});
 assert.equal((await app()).sessions.find(t=>t.id===timer.id)?.course_id,course.id);
 await assert.rejects(()=>command('profile.save',{expected_revision:1,...university()}),/ACTIVE_SESSION/);
 await study('timer.pause',{id:timer.id,expected_revision:1});await study('timer.resume',{id:timer.id,expected_revision:2});await study('timer.finish',{id:timer.id,expected_revision:3});
 const manual=await study('manual_study.create',{course_id:course.id,subject:'Kullanıcının eski etiketi',study_date:'2026-09-26',minutes:50,confirmed_by_user:true});
 assert.equal((await app()).manual_study_entries?.find(e=>e.id===manual.id)?.subject,course.name);
 await actor(OTHER);await assert.rejects(()=>study('task.create',{title:'Yabancı ders',plan_date:'2026-09-27',course_id:course.id}),/INVALID_INPUT/);
});
test('batch saves four marks atomically, replays only same operation and permits real identical exams',async()=>{
 await actor(STUDENT);const s=await state();const rows=s.courses.map((c,i)=>({course_id:c.id,exam_date:'2026-09-27',assessment_type:'Vize',score:[0,87.5,16,79][i],scale:i===2?20:100}));const id=randomUUID();
 await command('results.batch',{rows},id);assert.equal((await command('results.batch',{rows},id)).replayed,true);assert.equal((await state()).results.length,4);
 await assert.rejects(()=>command('results.batch',{rows:rows.map(r=>({...r,score:1}))},id),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>command('results.batch',{rows:[rows[0],{...rows[1],score:101}]}),/check constraint/);assert.equal((await state()).results.length,4);
 await command('results.batch',{rows:[rows[0]]});assert.equal((await state()).results.length,5);
 for(const invalid of [{score:null},{score:''},{scale:0},{exam_date:'2026-02-31'},{course_id:randomUUID()}])await assert.rejects(()=>command('results.batch',{rows:[{...rows[0],...invalid}]}));
 const result=(await state()).results[0];await command('result.update',{id:result.id,expected_revision:1,score:9});assert.equal((await state()).results.find(r=>r.id===result.id)?.score,9);
 await assert.rejects(()=>command('result.update',{id:result.id,expected_revision:1,score:10}),/CONFLICT/);
 await actor(OTHER);await assert.rejects(()=>command('result.update',{id:result.id,expected_revision:2,score:12}),/NOT_FOUND/);
});
test('renaming and switching terms preserve result snapshots, old records and separate YKS math',async()=>{
 await actor(STUDENT);const s=await state(),math=s.courses.find(c=>c.name==='Matematik')!;const oldResult=s.results.find(r=>r.course_id===math.id)!;
 await command('course.update',{id:math.id,expected_revision:1,name:'Ticaret Matematiği'});assert.equal((await state()).results.find(r=>r.id===oldResult.id)?.course_name,'Matematik');
 await command('course.create',{term_id:null,name:'Matematik',context:'yks',exam:'TYT'});
 const yks=(await state()).courses.find(c=>c.context==='yks'&&c.exam==='TYT'&&c.name==='Matematik')!;
 const topic=(await app()).topics.find(t=>t.exam==='TYT'&&t.subject==='Matematik')!;
 const timer=await study('timer.start',{course_id:yks.id,topic_id:topic.id});assert.equal((await app()).sessions.find(r=>r.id===timer.id)?.subject,'TYT Matematik');
 await command('course.update',{id:yks.id,expected_revision:1,name:'Matematik çalışmalarım'});await study('timer.finish',{id:timer.id,expected_revision:1});
 assert.equal((await app()).sessions.find(r=>r.id===timer.id)?.subject,'TYT Matematik');
 const renamedTask=await study('task.create',{title:'Yeniden adlandırılmış YKS dersi',plan_date:'2026-09-27',course_id:yks.id,topic_id:topic.id});
 const renamedTimer=await study('timer.start',{task_id:renamedTask.id});
 assert.equal((await app()).sessions.find(r=>r.id===renamedTimer.id)?.subject,'TYT Matematik çalışmalarım');
 await study('timer.finish',{id:renamedTimer.id,expected_revision:1});
 assert.equal((await state()).courses.find(c=>c.id===yks.id)?.catalog_subject,'Matematik');
 await command('course.update',{id:yks.id,expected_revision:2,name:'Matematik'});
 const manual=await study('manual_study.create',{course_id:yks.id,study_date:'2026-09-26',minutes:15,confirmed_by_user:true});assert.equal((await app()).manual_study_entries!.find(r=>r.id===manual.id)?.subject,'TYT Matematik');
 await assert.rejects(()=>study('manual_study.create',{study_date:'2026-09-26',minutes:15,confirmed_by_user:true}),/INVALID_INPUT/);
 await command('course.create',{term_id:s.profile!.active_term_id,name:' IŞIK ',context:'school'});
 await assert.rejects(()=>command('course.create',{term_id:s.profile!.active_term_id,name:'ışık',context:'school'}),/DUPLICATE_COURSE/);
 const next=university();next.term!.name='Bahar';next.profile.yks_goal=true;await command('profile.save',{expected_revision:1,...next});
 const current=await state();assert.equal(current.terms.filter(t=>t.archived).length,1);assert.equal(current.results.length,5);
 assert.equal(current.courses.filter(c=>c.name==='Matematik'&&c.context==='school').length,1);assert.ok(current.courses.some(c=>c.name==='Matematik'&&c.context==='yks'));
 await command('term.activate',{id:s.profile!.active_term_id});assert.equal((await state()).profile!.active_term_id,s.profile!.active_term_id);
});
test('all finalized time and interval mutation paths reject changes while scores remain editable',async()=>{
 await actor(STUDENT);const s=await app(),session=s.sessions.find(r=>r.status==='finished')!,interval=s.intervals.find(r=>r.session_id===session.id)!,manual=s.manual_study_entries![0];
 await assert.rejects(()=>study('timer.correct',{id:session.id,expected_revision:session.revision,confirmed_seconds:0,reason:'test'}),/DURATION_IMMUTABLE/);
 for(const [sql,args] of [
  ['update public.study_sessions set accumulated_seconds=accumulated_seconds+1 where id=$1',[session.id]],
  ['delete from public.study_sessions where id=$1',[session.id]],
  ["update public.study_intervals set ended_at=ended_at+interval '1 second' where id=$1",[interval.id]],
  ['delete from public.study_intervals where id=$1',[interval.id]],
  ['insert into public.study_intervals(user_id,session_id,started_at,ended_at) values($1,$2,now(),now())',[STUDENT,session.id]],
  ['update public.manual_study_entries set duration_seconds=duration_seconds+60 where id=$1',[manual.id]],
  ['delete from public.manual_study_entries where id=$1',[manual.id]],
 ] as [string,string[]][])await assert.rejects(()=>admin(sql,args),/DURATION_IMMUTABLE/);
 await actor(STUDENT);const active=await study('timer.start',{title:'Yeniden ilişkilendirme denetimi'});const activeInterval=(await app()).intervals.find(i=>i.session_id===active.id)!;
 await assert.rejects(()=>admin('update public.study_intervals set session_id=$1 where id=$2',[session.id,activeInterval.id]),/DURATION_IMMUTABLE/);
 await actor(STUDENT);await study('timer.finish',{id:active.id,expected_revision:1});
 await actor(STUDENT);assert.equal((await app()).manual_study_entries![0].duration_seconds,manual.duration_seconds);
 await db.query("select set_config('request.jwt.claim.client_id','untrusted-oauth',false)");assert.equal((await db.query('select * from public.education_courses')).rows.length,0);await assert.rejects(()=>state(),/STUDENT_REQUIRED/);
 await db.query("select set_config('request.jwt.claim.client_id','',false)");
});
test('six months of synthetic data remain isolated under 20 simultaneous local submissions',async(context)=>{
 const users=Array.from({length:20},()=>randomUUID());
 await db.exec('reset role');
 for(const user of users){
  await db.query('insert into auth.users values($1,$2,now())',[user,`${user}@load.example.test`]);
  await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Yük testi',$2,'student','approved')",[user,`${user}@load.example.test`]);
  await actor(user);await command('profile.save',{expected_revision:0,...university()});const courses=(await state()).courses;
  await db.exec('reset role');
  await db.query("select set_config('test.load_user',$1,false)",[user]);
  await db.exec(`do $$ declare actor uuid:=current_setting('test.load_user')::uuid;session uuid;day integer;at_time timestamptz;begin
    for day in 1..180 loop
      at_time:=date_trunc('day',now())-make_interval(days=>day);
      insert into public.study_sessions(user_id,title,status,started_at,accumulated_seconds) values(actor,'Sentetik çalışma','paused',at_time,1800) returning id into session;
      insert into public.study_intervals(user_id,session_id,started_at,ended_at) values(actor,session,at_time,at_time+interval '30 minutes');
      update public.study_sessions set status='finished',finished_at=at_time+interval '30 minutes' where id=session;
    end loop;end $$;`);
  for(const course of courses)await db.query(`insert into public.course_exam_results(user_id,course_id,term_id,course_name,exam_date,assessment_type,score,scale)
    select $1,$2,$3,$4,current_date-day*14,'Kısa sınav',60+day,100 from generate_series(1,12) day`,[user,course.id,course.term_id,course.name]);
 }
 const started=performance.now(),latencies:number[]=[];
 // PGlite serializes transactions internally; this measures local queue/correctness,
 // not PostgreSQL network throughput or production concurrent connection capacity.
 await Promise.all(users.map(user=>{const requestStart=performance.now();return db.transaction(async tx=>{
  await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  const s=(await tx.query<{value:AppState}>('select public.yks_state() as value')).rows[0].value;
  assert.equal(s.education?.results.length,48);assert.equal(s.sessions.length,180);assert.equal(s.intervals.length,180);
  assert.equal(s.sessions.reduce((sum,r)=>sum+r.accumulated_seconds,0),324000);
  assert.equal((await tx.query('select distinct user_id from public.education_courses')).rows.length,1);
 }).then(()=>{latencies.push(performance.now()-requestStart);});}));
 latencies.sort((a,b)=>a-b);context.diagnostic(`PGlite local queue: 20 submissions, 3600 sessions + 3600 intervals + 960 results; total ${Math.round(performance.now()-started)} ms; p95 ${Math.round(latencies[18])} ms. Production/PostgreSQL concurrency was not measured.`);
});
test('only authorized Auth account closure may cascade immutable history deletion',async()=>{
 const user=randomUUID();await admin('insert into auth.users values($1,$2,now())',[user,`${user}@closure.example.test`]);
 await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Kapatılacak hesap',$2,'student','approved')",[user,`${user}@closure.example.test`]);
 await actor(user);await command('profile.save',{expected_revision:0,...university()});const course=(await state()).courses[0];
 const timer=await study('timer.start',{course_id:course.id});await study('timer.finish',{id:timer.id,expected_revision:1});
 await study('manual_study.create',{course_id:course.id,study_date:'2026-09-26',minutes:15,confirmed_by_user:true});
 await command('results.batch',{rows:[{course_id:course.id,exam_date:'2026-09-26',assessment_type:'Vize',score:72,scale:100}]});
 await assert.rejects(()=>db.query('delete from auth.users where id=$1',[user]),/permission denied/);
 await assert.rejects(()=>admin('delete from public.study_sessions where id=$1',[timer.id]),/DURATION_IMMUTABLE/);
 await admin('delete from auth.users where id=$1',[user]);
 for(const table of ['study_sessions','study_intervals','manual_study_entries','education_profiles','education_courses','education_terms','course_exam_results'])assert.equal((await db.query(`select 1 from public.${table} where user_id=$1`,[user])).rows.length,0,table);
});
