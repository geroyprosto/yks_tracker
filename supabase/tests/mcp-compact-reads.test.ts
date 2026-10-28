import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const TASKS=[randomUUID(),randomUUID(),randomUUID()];
const FINISHED=randomUUID(),MANUAL=randomUUID(),OPEN=randomUUID();
const EXAMS=[randomUUID(),randomUUID()];
let db:PGlite;
type Row=Record<string,unknown>;
type List={count:number;tasks?:Row[];topics?:Row[];sessions?:Row[];exams?:Row[]};

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;`);
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
  const sql=await readFile(new URL(name,directory),'utf8');
  if(sql.trim())await db.exec(sql);
 }
 await db.query('insert into auth.users(id) values($1),($2)',[OWNER,OTHER]);
 await db.query('insert into public.owner_allowlist(user_id) values($1)',[OWNER]);
 await db.query("insert into public.profiles(user_id,timezone) values($1,'Europe/Istanbul')",[OWNER]);
 for(let i=0;i<TASKS.length;i++)await db.query(`insert into public.tasks(id,user_id,title,plan_date,progress,notes,updated_at)
  values($1,$2,$3,$4,$5,'PRIVATE TASK NOTES',$6)`,[TASKS[i],OWNER,`Görev ${i}`,'2026-10-'+(20+i),i===1?1:0,`2026-10-2${i}T12:00:00Z`]);
 await db.query("insert into public.tasks(user_id,title,plan_date,notes) values($1,'OTHER PRIVATE TASK','2026-10-22','OTHER NOTES')",[OTHER]);
 for(const [subject,name] of [['FİZİK','Elektrik'],['Fizik','Hareket'],['Isı','Sıcaklık']]){
  await db.query("insert into public.topics(user_id,exam,subject,name,notes) values($1,'TYT',$2,$3,'PRIVATE TOPIC NOTES')",[OWNER,subject,name]);
 }
 await db.query("insert into public.topics(user_id,exam,subject,name) values($1,'TYT','Fizik','OTHER PRIVATE TOPIC')",[OTHER]);
 await db.query(`insert into public.study_sessions(id,user_id,subject,status,started_at,finished_at,accumulated_seconds)
  values($1,$2,'Fizik','finished','2026-10-20T22:30:00Z','2026-10-20T23:00:00Z',1800)`,[FINISHED,OWNER]);
 await db.query(`insert into public.study_sessions(id,user_id,subject,status,started_at,active_since,mode,target_seconds)
  values($1,$2,'Açık sayaç','running',now(),now(),'countdown',60)`,[OPEN,OWNER]);
 await db.query("insert into public.manual_study_entries(id,user_id,study_date,subject,duration_seconds) values($1,$2,'2026-10-21','Matematik',1200)",[MANUAL,OWNER]);
 await db.query("insert into public.manual_study_entries(user_id,study_date,subject,duration_seconds) values($1,'2026-10-21','OTHER PRIVATE SESSION',600)",[OTHER]);
 for(let i=0;i<EXAMS.length;i++){
  await db.query(`insert into public.exams(id,user_id,name,exam_date,format_code,format_version,format_snapshot,notes,total_net)
   values($1,$2,$3,$4,'TYT',1,'{}','PRIVATE EXAM NOTES',30)`,[EXAMS[i],OWNER,`Deneme ${i}`,`2026-10-2${i}`]);
  await db.query("insert into public.exam_results(exam_id,user_id,section_key,correct,wrong,blank,net) values($1,$2,'turkce',32,8,0,30)",[EXAMS[i],OWNER]);
 }
 await db.query(`insert into public.exams(user_id,name,exam_date,format_code,format_version,format_snapshot)
  values($1,'OTHER PRIVATE EXAM','2026-10-22','TYT',1,'{}')`,[OTHER]);
 await db.query(`insert into public.daily_plan_versions(user_id,plan_date,version,target_minutes,task_share,difficulty_factors,snapshot)
  select $1::uuid,'2026-10-20',n,n,.7,'{"easy":1,"medium":1.25,"hard":1.5}',jsonb_build_array(jsonb_build_object('notes',repeat('history',500)))
  from generate_series(1,60) n`,[OWNER]);
});
after(async()=>{await db?.close();});

async function service(){
 await db.exec('reset role;set role service_role');
 await db.query("select set_config('request.jwt.claim.sub','',false)");
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role',aud:'service_role'})]);
 await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function read(resource:string,filters:unknown={},owner:string|null=OWNER){
 return (await db.query<{value:List}>('select public.mcp_owner_read($1::uuid,$2,$3::jsonb) value',[owner,resource,JSON.stringify(filters)])).rows[0].value;
}

test('MCP state projects the latest plan while legacy state preserves immutable history',async()=>{
 await service();
 const compact=(await db.query<{value:{day_plans:Row[]}}>('select public.mcp_owner_state($1::uuid) value',[OWNER])).rows[0].value;
 assert.equal(compact.day_plans.filter(row=>row.plan_date==='2026-10-20').length,1);
 assert.equal(compact.day_plans.find(row=>row.plan_date==='2026-10-20')!.version,60);
 assert.equal((await db.query<{value:string}>("select current_setting('request.jwt.claim.sub',true) value")).rows[0].value,'');
 await db.exec('reset role;set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:OWNER,role:'authenticated'})]);
 const full=(await db.query<{value:{day_plans:Row[]}}>('select public.yks_state() value')).rows[0].value;
 assert.equal(full.day_plans.filter(row=>row.plan_date==='2026-10-20').length,60);
});

test('task lists filter before limiting, sort by update and disclose only public fields',async()=>{
 await service();
 const value=await read('tasks',{from_date:'2026-10-20',to_date:'2026-10-22',status:'open',limit:1});
 assert.equal(value.count,1);assert.equal(value.tasks![0].id,TASKS[2]);
 assert.deepEqual(Object.keys(value.tasks![0]).sort(),['exam','id','plan_date','planned_minutes','priority','progress','subject','title']);
 assert.deepEqual((await read('tasks',{status:'done'})).tasks!.map(row=>row.id),[TASKS[1]]);
 assert.deepEqual((await read('tasks',{from_date:'2026-10-20',to_date:'2026-10-20'})).tasks!.map(row=>row.id),[TASKS[0]]);
 assert.equal((await read('tasks',{from_date:'2027-01-01'})).count,0);
});

test('topics support Turkish case comparison, exam filtering, limits and narrow projection',async()=>{
 await service();
 const value=await read('topics',{exam:'TYT',subject:'fizik',limit:1});
 assert.equal(value.count,1);assert.equal(value.topics![0].exam,'TYT');
 assert.deepEqual(Object.keys(value.topics![0]).sort(),['exam','id','mastery','name','parent_id','review_requested','revision','subject']);
 assert.equal((await read('topics',{subject:'FİZİK'})).count,2);
 assert.equal((await read('topics',{subject:'ısı'})).count,1);
 assert.equal((await read('topics',{exam:'AYT'})).count,0);
});

test('topic limits select Turkish alphabetical names before aggregation',async()=>{
 await db.exec('reset role');
 for(const name of ['Türev','Zaman','İntegral','Işık'])await db.query(
  "insert into public.topics(user_id,exam,subject,name) values($1,'AYT','Matematik',$2)",[OWNER,name]);
 for(const subject of ['Türev','Zaman','İntegral','Işık'])await db.query(
  "insert into public.topics(user_id,exam,subject,name) values($1,'AYT',$2,'Alfabe test konusu')",[OWNER,subject]);
 try{
  await service();
  assert.deepEqual((await read('topics',{exam:'AYT',subject:'Matematik',limit:2})).topics!.map(row=>row.name),['Işık','İntegral']);
  assert.deepEqual((await read('topics',{exam:'AYT',limit:2})).topics!.map(row=>row.subject),['Işık','İntegral']);
 }finally{
  await db.exec('reset role');
  await db.query("delete from public.topics where user_id=$1 and exam='AYT' and (subject='Matematik' or name='Alfabe test konusu')",[OWNER]);
  await service();
 }
});

test('sessions merge finished timers and manual entries using profile timezone and one limit',async()=>{
 await service();
 const value=await read('sessions',{from_date:'2026-10-21',to_date:'2026-10-21',limit:100});
 assert.equal(value.count,2);
 assert.deepEqual(value.sessions!.map(row=>row.id),[FINISHED,MANUAL].sort());
 for(const row of value.sessions!)assert.deepEqual(Object.keys(row).sort(),['duration_seconds','id','kind','study_date','subject']);
 assert.equal(value.sessions!.find(row=>row.id===FINISHED)!.study_date,'2026-10-21');
 assert.equal((await read('sessions',{from_date:'2026-10-20',to_date:'2026-10-20'})).count,0);
 assert.equal((await read('sessions',{limit:1})).count,1);
 assert.ok(value.sessions!.every(row=>row.id!==OPEN));
});

test('exam lists limit parents before nested results and do not expose notes or document metadata',async()=>{
 await service();const value=await read('exams',{limit:1});
 assert.equal(value.count,1);assert.equal(value.exams![0].id,EXAMS[1]);
 assert.deepEqual(Object.keys(value.exams![0]).sort(),['exam_date','format_code','id','name','rank','results','score','total_net']);
 assert.deepEqual(value.exams![0].results,[{section_key:'turkce',correct:32,wrong:8,blank:0,net:30}]);
});

test('all lists isolate owner data and reject non-allowlisted or missing owners',async()=>{
 await service();
 for(const resource of ['tasks','topics','sessions','exams']){
  assert.ok(!JSON.stringify(await read(resource)).includes('OTHER PRIVATE'));
  await assert.rejects(()=>read(resource,{},OTHER),/OWNER_REQUIRED/);
  await assert.rejects(()=>read(resource,{},null),/OWNER_REQUIRED/);
 }
});

test('lists retain classroom eligibility and reject suspended or rejected owners',async()=>{
 await db.exec('reset role');
 await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Synthetic owner','owner@example.test','admin','approved')",[OWNER]);
 try{
  for(const status of ['approved','pending','suspended','rejected']){
   await db.exec('reset role');
   await db.query('update public.classroom_accounts set status=$1 where id=$2',[status,OWNER]);
   await service();
   for(const resource of ['tasks','topics','sessions','exams']){
    if(status==='suspended'||status==='rejected')await assert.rejects(()=>read(resource),/OWNER_REQUIRED/);
    else assert.ok((await read(resource)).count>=0);
   }
  }
 }finally{
  await db.exec('reset role');
  await db.query("update public.classroom_accounts set status='approved' where id=$1",[OWNER]);
  await service();
 }
});

test('browser, OAuth and anonymous callers cannot use the service-only list gateway',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:OWNER,role,client_id:'oauth-client'})]);
  await assert.rejects(()=>read('tasks'),/permission denied/);
  await assert.rejects(()=>db.query("select private.mcp_turkish_sort_key('İntegral')"),/permission denied/);
 }
 await service();
});

test('list reads do not acquire owner advisory locks, initialize owners or settle timers',async()=>{
 await db.exec('reset role');
 await db.query("update public.study_sessions set started_at=now()-interval '2 minutes',active_since=now()-interval '2 minutes' where id=$1",[OPEN]);
 await db.exec('begin');
 try{
  await db.exec('set local role service_role');
  for(const resource of ['tasks','topics','sessions','exams'])await read(resource);
  await db.exec('reset role');
  const locks=await db.query<{count:number}>("select count(*)::int count from pg_locks where locktype='advisory' and pid=pg_backend_pid()");
  assert.equal(locks.rows[0].count,0);
  const session=await db.query<{status:string;accumulated_seconds:number}>('select status,accumulated_seconds from public.study_sessions where id=$1',[OPEN]);
  assert.equal(session.rows[0].status,'running');assert.equal(session.rows[0].accumulated_seconds,0);
  const body=(await db.query<{body:string}>("select pg_get_functiondef('public.mcp_owner_read(uuid,text,jsonb)'::regprocedure) body")).rows[0].body;
  assert.doesNotMatch(body,/analysis_require_target_owner|require_owner\(|initialize_owner|settle_countdown|advisory|yks_state\(/i);
 }finally{await db.exec('rollback');await service();}
});

test('database enforces resource-specific filter keys, types, date bounds and result limits',async()=>{
 await service();
 const invalid:[string,unknown][]=[
  ['journal',{}],['tasks',null],['tasks',[]],['tasks',{notes:true}],['tasks',{limit:0}],['tasks',{limit:101}],
  ['tasks',{limit:1.5}],['tasks',{limit:'2'}],['tasks',{limit:null}],['tasks',{status:'pending'}],
  ['tasks',{from_date:'2026-02-30'}],['tasks',{from_date:'2026-1-01'}],['tasks',{from_date:123}],
  ['tasks',{from_date:'2026-10-22',to_date:'2026-10-20'}],['topics',{subject:''}],['topics',{subject:' '.repeat(2)}],
  ['topics',{subject:'x'.repeat(121)}],['topics',{exam:'YKS'}],['topics',{subject:null}],['topics',{status:'open'}],
  ['sessions',{status:'running'}],['sessions',{to_date:'yesterday'}],['exams',{limit:51}],['exams',{from_date:'2026-10-20'}],
 ];
 for(const [resource,filters] of invalid)await assert.rejects(()=>read(resource,filters),/INVALID_INPUT/,JSON.stringify({resource,filters}));
});
