import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {AppState} from '../../src/lib/domain/types';

const [OWNER,STUDENT,OTHER,PENDING,TEACHER,MISSING]=Array.from({length:6},()=>randomUUID());
const past='2026-09-15';
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
 for(const id of [OWNER,STUDENT,OTHER,PENDING,TEACHER,MISSING]){
  await db.query('insert into auth.users values($1,$2,now())',[id,`${id}@example.test`]);
  if(id===MISSING)continue;
  await db.query('insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,$4,$5)',
   [id,'Sentetik hesap',`${id}@example.test`,id===OWNER?'admin':id===TEACHER?'teacher':'student',id===PENDING?'pending':'approved']);
 }
 await db.query('insert into public.owner_allowlist(user_id) values($1)',[OWNER]);
 await browser();await legacy();
 await command('task.create',{title:'Plan geçmişi',plan_date:past,notes:'sentetik '.repeat(600)});
 await command('practice.create',{practice_date:past,question_count:12,test_count:1});
 await command('journal.create',{journal_date:past,original_text:'Sentetik günlük'});
 await command('day.mark',{mark_date:past,kind:'rest'});
 await command('manual_study.create',{study_date:past,subject:'Matematik',minutes:25,confirmed_by_user:true});
 await command('exam.create',{name:'Sentetik deneme',exam_date:past,format_code:'BRANCH',branch_subject:'Matematik',branch_question_count:20,results:[{section_key:'branch',correct:16,wrong:4,blank:0}]});
 const timer=await command('timer.start',{title:'Tamamlanan süre'});
 await admin("update public.study_sessions set started_at=now()-interval '1 minute',active_since=now()-interval '1 minute' where id=$1",[timer.id]);
 await admin("update public.study_intervals set started_at=now()-interval '1 minute' where session_id=$1",[timer.id]);
 await browser();await command('timer.finish',{id:timer.id,expected_revision:1});
 const topic=(await legacy()).topics[0];
 await admin('insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery) values($1,$2,0,1)',[OWNER,topic.id]);
 await admin(`insert into public.daily_plan_versions(user_id,plan_date,version,target_minutes,task_share,difficulty_factors,snapshot)
  select user_id,plan_date,n,case when n=101 then 0 else 120 end,task_share,difficulty_factors,snapshot
  from public.daily_plan_versions cross join generate_series(2,101) n where user_id=$1 and plan_date=$2 and version=1`,[OWNER,past]);
 await admin(`insert into public.daily_plan_versions(user_id,plan_date,version,target_minutes,task_share,difficulty_factors)
  values($1,'2025-01-01',1,40,.7,'{"easy":1,"medium":1.25,"hard":1.5}'),($1,'2027-12-31',1,80,.7,'{"easy":1,"medium":1.25,"hard":1.5}')`,[OWNER]);
 await admin('update public.profiles set daily_target_minutes=0 where user_id=$1',[OWNER]);
 await admin("insert into public.education_profiles(user_id,education_level,yks_goal) values($1,'graduate',true)",[OWNER]);
 await admin("insert into public.education_drafts(user_id,step,data) values($1,0,'{\"synthetic\":true}')",[OWNER]);
 await admin("insert into public.education_terms(user_id,academic_year,name) values($1,'2026-2027','Sentetik dönem')",[OWNER]);
 const course=(await admin("insert into public.education_courses(user_id,name,context,exam) values($1,'Matematik','yks','TYT') returning id",[OWNER])).rows[0] as {id:string};
 await admin("insert into public.course_exam_results(user_id,course_id,course_name,exam_date,assessment_type,score,scale) values($1,$2,'Matematik',$3,'Sentetik',75,100)",[OWNER,course.id,past]);
 await browser(OTHER);await command('task.create',{title:'Diğer hesabın özel görevi',plan_date:past});await browser();
});
after(async()=>{await db?.close();});

async function browser(id:string|null=OWNER,oauth=false){
 await db.exec('reset role;set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
 await db.query("select set_config('request.jwt.claim.client_id',$1,false)",[oauth?'oauth-client':'']);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',...(oauth?{client_id:'oauth-client'}:{})})]);
}
async function admin(sql:string,args:unknown[]=[]){await db.exec('reset role');return db.query(sql,args);}
async function adminExec(sql:string){await db.exec('reset role');return db.exec(sql);}
async function command(type:string,payload:unknown){
 return (await db.query<{value:{id:string}}>('select public.yks_command($1,$2,$3::jsonb) value',[randomUUID(),type,JSON.stringify(payload)])).rows[0].value;
}
async function legacy(){return (await db.query<{value:AppState}>('select public.yks_state() value')).rows[0].value;}
async function dashboard(){return (await db.query<{value:AppState}>('select public.yks_dashboard_state() value')).rows[0].value;}
async function snapshot(){return (await db.query<{value:{state:AppState;version:string}}>('select public.yks_state_cache_snapshot() value')).rows[0].value;}
function latestPlans(state:AppState){
 const plans=new Map<string,AppState['day_plans'][number]>();
 for(const plan of state.day_plans)if(!plans.has(plan.plan_date)||plans.get(plan.plan_date)!.version<plan.version)plans.set(plan.plan_date,plan);
 return [...plans.values()].sort((a,b)=>a.plan_date.localeCompare(b.plan_date));
}

test('cache projection returns the latest plan per date while legacy RPC retains every audit version',async()=>{
 await browser();const full=await legacy(),cached=(await snapshot()).state;
 assert.equal(cached.day_plans.length,latestPlans(full).length);
 assert.deepEqual(cached.day_plans,latestPlans(full));
 assert.equal(full.day_plans.filter(row=>row.plan_date===past).length,101);
 assert.equal((await legacy()).day_plans.length,full.day_plans.length);
 assert.equal(cached.day_plans.find(row=>row.plan_date===past)?.target_minutes,0);
 assert.equal(cached.settings?.daily_target_minutes,0);
 assert.ok(cached.day_plans.some(row=>row.plan_date==='2025-01-01'));
 assert.ok(cached.day_plans.some(row=>row.plan_date==='2027-12-31'));
 assert.ok(JSON.stringify(cached).length<JSON.stringify(full).length/5);
});

test('dashboard preserves every other array and education field without first constructing legacy state',async()=>{
 await browser();const full=await legacy(),compact=await dashboard();
 const {server_now:fullNow,day_plans:fullPlans,...rest}=full;
 const {server_now:compactNow,day_plans:compactPlans,...compactRest}=compact;
 assert.ok(Number.isFinite(Date.parse(fullNow))&&Number.isFinite(Date.parse(compactNow)));
 assert.deepEqual(compactRest,rest);assert.deepEqual(compactPlans,latestPlans({...full,day_plans:fullPlans}));
 for(const key of ['tasks','topics','sessions','intervals','manual_study_entries','topic_history','practice_entries','exam_formats','exams','journal_entries','day_marks'] as const)
  assert.ok(compact[key]!.length>0,key);
 assert.ok(compact.education?.profile);assert.ok(compact.education?.draft);assert.ok(compact.education?.terms.length);assert.ok(compact.education?.courses.length);assert.ok(compact.education?.results.length);
 await adminExec(`alter function public.yks_state() rename to dashboard_test_legacy;
  create function public.yks_state() returns jsonb language plpgsql as $$begin raise exception 'LEGACY_PROJECTION_MUST_NOT_RUN';end $$`);
 try{await browser();assert.ok((await dashboard()).day_plans.length);assert.ok((await snapshot()).state.day_plans.length);}
 finally{await adminExec('drop function public.yks_state();alter function public.dashboard_test_legacy() rename to yks_state');await browser();}
});

test('first dashboard read initializes the approved student and creates today plan',async()=>{
 await browser(STUDENT);const value=await dashboard();
 const today=(await db.query<{value:string}>("select (clock_timestamp() at time zone 'Europe/Istanbul')::date::text value")).rows[0].value;
 assert.ok(value.settings);assert.ok(value.topics.length);assert.equal(value.tasks.length,0);
 assert.ok(value.day_plans.some(row=>row.plan_date===today));assert.equal(value.education?.can_commit,true);
 await browser();
});

test('dashboard settles expired countdowns and includes finalized intervals',async()=>{
 await browser();const timer=await command('timer.start',{title:'Biten geri sayım',mode:'countdown',target_seconds:60});
 await admin("update public.study_sessions set started_at=now()-interval '2 minutes',active_since=now()-interval '2 minutes' where id=$1",[timer.id]);
 await admin("update public.study_intervals set started_at=now()-interval '2 minutes' where session_id=$1",[timer.id]);
 await browser();const value=await dashboard(),session=value.sessions.find(row=>row.id===timer.id)!;
 assert.equal(session.status,'finished');assert.equal(session.accumulated_seconds,60);
 assert.ok(value.intervals.find(row=>row.session_id===timer.id)?.ended_at);
});

test('dashboard and cache retain live approval, OAuth and missing-identity gates',async()=>{
 for(const id of [PENDING,TEACHER,MISSING,null]){
  await browser(id);await assert.rejects(dashboard,/OWNER_REQUIRED/);await assert.rejects(snapshot,/OWNER_REQUIRED/);
 }
 await browser(OWNER,true);await assert.rejects(dashboard,/OWNER_REQUIRED/);await assert.rejects(snapshot,/OWNER_REQUIRED/);
 await admin("update public.classroom_accounts set status='suspended' where id=$1",[STUDENT]);
 try{await browser(STUDENT);await assert.rejects(dashboard,/OWNER_REQUIRED/);await assert.rejects(snapshot,/OWNER_REQUIRED/);}
 finally{await admin("update public.classroom_accounts set status='approved' where id=$1",[STUDENT]);await browser();}
});

test('anonymous and service roles cannot call either dashboard helper even with forged owner claims',async()=>{
 for(const role of ['anon','service_role']){
  await browser();await db.exec(`reset role;set role ${role}`);
  await assert.rejects(dashboard,/permission denied/);
  await assert.rejects(()=>db.query('select private.dashboard_state()'),/permission denied/);
 }
 await browser();
});

test('dashboard isolates approved accounts and never exposes another student records',async()=>{
 await browser(OTHER);const other=await dashboard();assert.equal(other.tasks.length,1);
 assert.equal(other.tasks[0].title,'Diğer hesabın özel görevi');assert.equal(other.journal_entries.length,0);
 await browser();assert.ok((await dashboard()).tasks.every(row=>row.title!=='Diğer hesabın özel görevi'));
});
