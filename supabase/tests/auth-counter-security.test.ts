import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const OWNER='11111111-1111-4111-8111-111111111111';
const STUDENT='22222222-2222-4222-8222-222222222222';
const PENDING='33333333-3333-4333-8333-333333333333';
const TEACHER='44444444-4444-4444-8444-444444444444';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
let db:PGlite;

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;`);
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
  if(name.includes('auth_rate_limit_and_usage_guard'))await db.query(`insert into private.classroom_registration_attempts(key,attempts,reset_at)
   values($1,2,now()+interval '15 minutes')`,['email:'+hash('existing registration')]);
  const sql=await readFile(new URL(name,directory),'utf8');if(sql.trim())await db.exec(sql);
 }
 for(const id of [OWNER,STUDENT,PENDING,TEACHER])await db.query('insert into auth.users values($1)',[id]);
 await db.query('insert into public.owner_allowlist(user_id) values($1)',[OWNER]);
 for(const [id,role,status] of [[OWNER,'admin','approved'],[STUDENT,'student','approved'],[PENDING,'student','pending'],[TEACHER,'teacher','approved']])
  await db.query('insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,$4,$5)',[id,'Synthetic',`${id}@example.test`,role,status]);
 await db.exec('update private.ai_budget_policy set enabled=true,monthly_budget_usd=2');
 for(const [id,requests,cost] of [[OWNER,2,.04],[STUDENT,1,.02]])await db.query(`insert into public.analysis_usage(user_id,month,requests,estimated_cost_usd)
  values($1,date_trunc('month',clock_timestamp() at time zone 'Europe/Istanbul')::date,$2,$3)`,[id,requests,cost]);
});
after(async()=>{await db?.close();});

async function service(){await db.exec('reset role;set role service_role');}
async function countersReset(){await db.exec('reset role;truncate private.classroom_registration_attempts');await service();}
async function attempt(scope:'registration'|'login',ip:string|null,email:string){
 return (await db.query<{allowed:boolean}>(`select public.classroom_${scope}_allowed($1,$2) allowed`,[ip,email])).rows[0].allowed;
}
async function counterCount(scope?:string){
 await db.exec('reset role');
 const result=await db.query<{count:number}>('select count(*)::int count from private.classroom_registration_attempts'+(scope?' where scope=$1':''),scope?[scope]:[]);
 await service();return result.rows[0].count;
}

test('existing registration counters retain their scope and throttle state during migration',async()=>{
 await db.exec('reset role');
 const row=(await db.query<{scope:string;attempts:number}>('select scope,attempts from private.classroom_registration_attempts where key=$1',['email:'+hash('existing registration')])).rows[0];
 assert.deepEqual(row,{scope:'registration',attempts:2});
});

test('one blocked registration IP cannot create counters for 1000 different emails',async()=>{
 await countersReset();const ip=hash('one IP');let accepted=0;
 for(let n=0;n<1000;n++)accepted+=Number(await attempt('registration',ip,hash(`different email ${n}`)));
 assert.equal(accepted,5);assert.equal(await counterCount(),6);
 await db.exec('reset role');
 assert.equal((await db.query<{attempts:number}>('select attempts from private.classroom_registration_attempts where key=$1',['ip:'+ip])).rows[0].attempts,5);
});

test('registration retains 3/email and 5/IP limits with fixed, expiring windows',async()=>{
 await countersReset();const ip=hash('IP'),email=hash('email');
 for(let n=0;n<3;n++)assert.equal(await attempt('registration',ip,email),true);
 for(let n=0;n<10;n++)assert.equal(await attempt('registration',ip,email),false);
 await db.exec('reset role');
 const before=(await db.query<{key:string;attempts:number;reset_at:string}>('select key,attempts,reset_at::text from private.classroom_registration_attempts order by key')).rows;
 assert.equal(before.find(row=>row.key==='email:'+email)!.attempts,3);
 assert.equal(before.find(row=>row.key==='ip:'+ip)!.attempts,5);
 await service();assert.equal(await attempt('registration',ip,email),false);await db.exec('reset role');
 assert.deepEqual((await db.query('select key,attempts,reset_at::text from private.classroom_registration_attempts order by key')).rows,before);
 await db.exec("update private.classroom_registration_attempts set reset_at=now()-interval '1 second'");
 await service();assert.equal(await attempt('registration',ip,email),true);
 await db.exec('reset role');
 assert.ok((await db.query<{attempts:number;future:boolean}>("select attempts,reset_at>now() future from private.classroom_registration_attempts")).rows.every(row=>row.attempts===1&&row.future));
});

test('login uses independent 10/email and 50/IP minute windows',async()=>{
 await countersReset();const ip=hash('login IP'),email=hash('login email');
 for(let n=0;n<10;n++)assert.equal(await attempt('login',ip,email),true);
 assert.equal(await attempt('login',ip,email),false);
 // Reusing digests across scopes must not consume the registration allowance.
 for(let n=0;n<3;n++)assert.equal(await attempt('registration',ip,email),true);
 assert.equal(await attempt('registration',ip,email),false);
 await countersReset();let accepted=0;
 for(let n=0;n<100;n++)accepted+=Number(await attempt('login',ip,hash(`login ${n}`)));
 assert.equal(accepted,50);assert.equal(await counterCount(),51);
 await db.exec('reset role');
 assert.ok((await db.query<{seconds:number}>("select extract(epoch from (reset_at-now())) seconds from private.classroom_registration_attempts")).rows.every(row=>Number(row.seconds)>0&&Number(row.seconds)<=60));
});

test('missing IPs share a bounded fallback rather than bypassing IP limits',async()=>{
 await countersReset();
 for(let n=0;n<5;n++)assert.equal(await attempt('registration',null,hash(`fallback ${n}`)),true);
 assert.equal(await attempt('registration',null,hash('fallback denied')),false);
 assert.equal(await counterCount(),6);
});

test('expiry cleanup is bounded to 128 counters per request and preserves active limits',async()=>{
 await countersReset();const blocked=hash('blocked');await db.exec('reset role');
 await db.query(`insert into private.classroom_registration_attempts(scope,key,attempts,reset_at)
  values('registration',$1,5,now()+interval '15 minutes')`,['ip:'+blocked]);
 await db.exec(`insert into private.classroom_registration_attempts(scope,key,attempts,reset_at)
  select 'registration','email:'||lpad(to_hex(n),64,'0'),1,now()-interval '1 minute' from generate_series(1,300) n`);
 await service();assert.equal(await attempt('registration',blocked,hash('no new email')),false);
 assert.equal(await counterCount(),173);
 assert.equal(await attempt('registration',blocked,hash('still no new email')),false);
 assert.equal(await counterCount(),45);
 assert.equal(await attempt('registration',blocked,hash('also no new email')),false);
 assert.equal(await counterCount(),1);
});

test('per-scope capacity denies new allocations without blocking the other auth flow',async()=>{
 await countersReset();await db.exec('reset role');
 await db.exec(`insert into private.classroom_registration_attempts(scope,key,attempts,reset_at)
  select 'registration','email:'||lpad(to_hex(n),64,'0'),1,now()+interval '15 minutes' from generate_series(1,5000) n`);
 await service();assert.equal(await attempt('registration',hash('new ip'),hash('new email')),false);
 assert.equal(await counterCount('registration'),5000);
 assert.equal(await attempt('login',hash('new ip'),hash('new email')),true);
 assert.equal(await counterCount('login'),2);
});

test('pre-existing active legacy counters above capacity are preserved and cannot grow',async()=>{
 await countersReset();await db.exec('reset role');
 await db.exec(`insert into private.classroom_registration_attempts(scope,key,attempts,reset_at)
  select 'registration','email:'||lpad(to_hex(n),64,'0'),1,now()+interval '15 minutes' from generate_series(1,5001) n`);
 await service();assert.equal(await attempt('registration',hash('legacy overcapacity IP'),hash('legacy overcapacity email')),false);
 assert.equal(await counterCount(),5001);
 await db.exec('reset role');
 assert.equal((await db.query<{count:number}>("select count(*)::int count from private.classroom_registration_attempts where attempts=1 and reset_at>now()")).rows[0].count,5001);
});

test('queued independent requests cannot exceed shared throttle or available capacity',async()=>{
 await countersReset();const ip=hash('concurrent IP');
 const outcomes=await Promise.all(Array.from({length:20},(_,i)=>attempt('registration',ip,hash(`queued ${i}`))));
 assert.equal(outcomes.filter(Boolean).length,5);assert.equal(await counterCount(),6);
 await countersReset();await db.exec('reset role');
 await db.exec(`insert into private.classroom_registration_attempts(scope,key,attempts,reset_at)
  select 'registration','email:'||lpad(to_hex(n),64,'0'),1,now()+interval '15 minutes' from generate_series(1,4998) n`);
 await service();const capacity=await Promise.all(Array.from({length:10},(_,i)=>attempt('registration',hash(`IP ${i}`),hash(`capacity email ${i}`))));
 assert.equal(capacity.filter(Boolean).length,1);assert.equal(await counterCount(),5000);
});

test('only service RPCs can access counters and invalid digests cannot allocate rows',async()=>{
 await countersReset();
 for(const scope of ['registration','login'] as const)for(const [ip,email] of [[null,null],['not a digest',hash('email')],[hash('ip'),'short']])
  await assert.rejects(()=>db.query(`select public.classroom_${scope}_allowed($1,$2)`,[ip,email]),/INVALID_INPUT/);
 assert.equal(await counterCount(),0);
 for(const role of ['anon','authenticated','service_role']){
  await db.exec(`reset role;set role ${role}`);
  await assert.rejects(()=>db.query('select * from private.classroom_registration_attempts'),/permission denied/);
  if(role!=='service_role')for(const scope of ['registration','login'] as const)await assert.rejects(()=>attempt(scope,null,hash('email')),/permission denied/);
 }
});

async function browser(id:string,oauth:'claims'|'legacy'|null=null){
 await db.exec('reset role;set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 await db.query("select set_config('request.jwt.claim.client_id',$1,false)",[oauth==='legacy'?'oauth-client':'']);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',...(oauth==='claims'?{client_id:'oauth-client'}:{})})]);
}

test('AI usage preserves browser owner/student access and exact account-isolated usage',async()=>{
 for(const [id,requests,cost] of [[OWNER,2,.04],[STUDENT,1,.02]] as const){
  await browser(id);
  const value=(await db.query<{value:{requests:number;estimated_cost_usd:number;monthly_requests:number;month:string;resets_at:string;enabled:boolean}}>('select public.ai_usage_status() value')).rows[0].value;
  assert.equal(value.requests,requests);assert.equal(value.estimated_cost_usd,cost);assert.equal(value.monthly_requests,4);
  assert.equal(value.enabled,true);assert.match(value.month,/^\d{4}-\d{2}-01$/);assert.ok(Number.isFinite(Date.parse(value.resets_at)));
 }
 for(const id of [PENDING,TEACHER]){await browser(id);await assert.rejects(()=>db.query('select public.ai_usage_status()'),/STUDENT_REQUIRED/);}
});

test('OAuth access tokens cannot call AI usage RPC using either claim format',async()=>{
 for(const id of [OWNER,STUDENT])for(const mode of ['claims','legacy'] as const){
  await browser(id,mode);await assert.rejects(()=>db.query('select public.ai_usage_status()'),/STUDENT_REQUIRED/);
 }
 for(const role of ['anon','service_role']){
  await db.exec(`reset role;set role ${role}`);
  await assert.rejects(()=>db.query('select public.ai_usage_status()'),/permission denied/);
 }
});
