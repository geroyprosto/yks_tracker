import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const HASH_A='a'.repeat(64), HASH_B='b'.repeat(64), HASH_C='c'.repeat(64);
let db:PGlite;
before(async()=>{
  db=new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth;"+
    "create table auth.users(id uuid primary key);"+
    "create function auth.uid() returns uuid language sql stable as $$"+
    " select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;"+
    "grant usage on schema public,auth to anon,authenticated,service_role;"+
    "grant execute on function auth.uid() to anon,authenticated,service_role;");
  await db.query('insert into auth.users values($1),($2)',[OWNER,OTHER]);
  const migrations=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(name,migrations),'utf8'));
  await db.query('insert into public.owner_allowlist(user_id) values($1)',[OWNER]);
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await db.query('select public.yks_state()');
});
after(async()=>{await db?.close()});
async function asService(){await db.exec('reset role; set role service_role; reset request.jwt.claim.sub')}
async function asOwner(){await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER])}
async function claim(requestId:string,hash:string,maxRequests=2,budget=1,reserved=0.2){
  await asService();
  const response=await db.query<{value:{suggestion:{id:string;status:string};claimed:boolean;replayed:boolean}}>(
    'select public.journal_ai_suggestion_claim($1::uuid,$2::uuid,$3::text,$4::integer,$5::numeric,$6::numeric) as value',
    [OWNER,requestId,hash,maxRequests,budget,reserved]);
  return response.rows[0].value;
}

test('diary and period reports share an atomic monthly request and USD reservation',async()=>{
  await asService();
  await db.query('select public.analysis_report_claim_for_owner($1::uuid,$2::uuid,$3::date,$4::date,$5::text,$6::integer,$7::numeric,$8::numeric)',
    [OWNER,randomUUID(),'2026-09-01','2026-09-14',HASH_A,2,1,0.3]);
  const requestId=randomUUID();
  const first=await claim(requestId,HASH_B);
  assert.equal(first.claimed,true);
  const replay=await claim(requestId,HASH_B);
  assert.equal(replay.claimed,false);
  assert.equal(replay.replayed,true);
  assert.equal(replay.suggestion.id,first.suggestion.id);
  const sameSource=await claim(randomUUID(),HASH_B);
  assert.equal(sameSource.claimed,false);
  assert.equal(sameSource.suggestion.id,first.suggestion.id);
  await assert.rejects(()=>claim(requestId,HASH_C),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>claim(randomUUID(),HASH_C),/AI_LIMIT_REACHED/);
  await asOwner();
  const usage=await db.query<{requests:number;estimated_cost_usd:string}>(
    'select requests,estimated_cost_usd from public.analysis_usage where user_id=$1',[OWNER]);
  assert.equal(usage.rows[0].requests,2);
  assert.equal(Number(usage.rows[0].estimated_cost_usd),0.5);
  await asService();
  const sql='select to_jsonb(public.journal_ai_suggestion_finalize($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb,$6::numeric)) as value';
  const params=[OWNER,first.suggestion.id,requestId,JSON.stringify({mood:'iyi'}),
    JSON.stringify({input_tokens:100,output_tokens:50,estimated_cost_usd:0.1}),0.1];
  const completed=await db.query<{value:{status:string;fields:{mood:string}}}>(sql,params);
  assert.equal(completed.rows[0].value.status,'completed');
  assert.equal(completed.rows[0].value.fields.mood,'iyi');
  await db.query(sql,params);
  await asOwner();
  const finalUsage=await db.query<{requests:number;estimated_cost_usd:string}>(
    'select requests,estimated_cost_usd from public.analysis_usage where user_id=$1',[OWNER]);
  assert.equal(finalUsage.rows[0].requests,2);
  assert.equal(Number(finalUsage.rows[0].estimated_cost_usd),0.4);
  const cached=await claim(randomUUID(),HASH_B);
  assert.equal(cached.suggestion.status,'completed');
  assert.equal(cached.claimed,false);
  await asOwner();
});

test('browser cannot claim/finalize and another user cannot read private suggestions',async()=>{
  await asOwner();
  await assert.rejects(()=>db.query('select public.journal_ai_suggestion_claim($1::uuid,$2::uuid,$3::text,$4::integer,$5::numeric,$6::numeric)',
    [OWNER,randomUUID(),HASH_C,5,1,0.1]),/permission denied/);
  await assert.rejects(()=>db.query('update public.journal_ai_suggestions set fields=$1::jsonb',[JSON.stringify({mood:'changed'})]),/permission denied/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
  const rows=await db.query('select * from public.journal_ai_suggestions');
  assert.equal(rows.rows.length,0);
  await asService();
  await assert.rejects(()=>db.query('select public.journal_ai_suggestion_claim($1::uuid,$2::uuid,$3::text,$4::integer,$5::numeric,$6::numeric)',
    [OTHER,randomUUID(),HASH_C,5,1,0.1]),/OWNER_REQUIRED/);
  await asOwner();
});

test('failed provider attempt keeps its reservation and is never sent again',async()=>{
 const requestId=randomUUID();
 const first=await claim(requestId,HASH_C,5,1,0.1);
 assert.equal(first.claimed,true);
 await asService();
 const failed=await db.query<{value:{status:string}}>([
  'select to_jsonb(public.journal_ai_suggestion_fail(',
  '$1::uuid,$2::uuid,$3::uuid,$4::text)) as value'
 ].join(''),[OWNER,first.suggestion.id,requestId,'Provider response uncertain']);
 assert.equal(failed.rows[0].value.status,'failed');
 const again=await claim(randomUUID(),HASH_C,5,1,0.1);
 assert.equal(again.claimed,false);
 assert.equal(again.suggestion.status,'failed');
 await asOwner();
 const usage=await db.query<{requests:number;estimated_cost_usd:string}>(
  'select requests,estimated_cost_usd from public.analysis_usage where user_id=$1',[OWNER]);
 assert.equal(usage.rows[0].requests,3);
 assert.equal(Number(usage.rows[0].estimated_cost_usd),0.5);
});