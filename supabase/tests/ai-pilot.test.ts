import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
let db:PGlite;
before(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;");
 await db.query('insert into auth.users values($1),($2)',[OWNER,OTHER]);
 const directory=new URL('../migrations/',import.meta.url);for(const name of (await readdir(directory)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
 await db.query('insert into public.owner_allowlist(user_id) values($1)',[OWNER]);
 await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Synthetic','student@example.test','student','approved')",[OTHER]);
});
after(async()=>{await db?.close();});
async function reset(){await db.exec('reset role;truncate public.analysis_reports,public.analysis_report_requests,public.analysis_usage,public.journal_ai_suggestions,private.ai_application_usage cascade;update private.ai_budget_policy set enabled=true,monthly_budget_usd=2;set role service_role;');}
type Claim={report:{id:string;request_id:string;status:string};claimed:boolean};
async function claim(user=OWNER,index=1,reserve=.1){const id=randomUUID();const query=await db.query<{value:Claim}>("select public.analysis_report_claim_for_owner($1,$2,'2026-09-01','2026-09-14',$3,999,100,$4) as value",[user,id,index.toString(16).padStart(64,'0'),reserve]);return query.rows[0].value;}

test('default DB kill switch and browser edits fail closed',async()=>{
 await db.exec('set role service_role');await assert.rejects(()=>claim(),/AI_DISABLED/);
 await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
 await assert.rejects(()=>db.exec('update private.ai_budget_policy set enabled=true'),/permission denied/);
 await assert.rejects(()=>db.query("select public.ai_mark_sent($1,'report',$2,$3)",[OWNER,randomUUID(),randomUUID()]),/permission denied/);
});
test('four shared report/diary requests, fifth rejection, cached read free and profile-independent account quota',async()=>{
 await reset();const first=await claim();await claim(OWNER,2);
 await db.query('select public.journal_ai_suggestion_claim($1,$2,$3,999,100,.1)',[OWNER,randomUUID(),'e'.repeat(64)]);
 await claim(OWNER,3);await assert.rejects(()=>claim(OWNER,4),/AI_LIMIT_REACHED/);
 const cached=await claim(OWNER,1);assert.equal(cached.report.id,first.report.id);assert.equal(cached.claimed,false);
 await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
 const status=await db.query<{value:{requests:number;monthly_requests:number;month:string;resets_at:string}}>('select public.ai_usage_status() as value');
 assert.equal(status.rows[0].value.requests,4);assert.equal(status.rows[0].value.monthly_requests,4);
 assert.match(status.rows[0].value.month,/^\d{4}-\d{2}-01$/);assert.ok(status.rows[0].value.resets_at);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);assert.equal((await db.query('select * from public.analysis_reports')).rows.length,0);
});
test('two queued device requests cannot both take the last account slot',async()=>{
 await reset();for(let i=1;i<=3;i++)await claim(OWNER,i);
 const outcomes=await Promise.allSettled([claim(OWNER,4),claim(OWNER,5)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
});
test('application USD reservation covers all accounts, not a separate allowance per user',async()=>{
 await reset();await db.exec('reset role;update private.ai_budget_policy set monthly_budget_usd=.15;set role service_role');
 await claim(OWNER,1,.1);await assert.rejects(()=>claim(OTHER,1,.1),/AI_APP_BUDGET_REACHED/);
});
test('deleting an account ledger cannot erase the application spending reservation',async()=>{
 await reset();await db.exec('reset role;update private.ai_budget_policy set monthly_budget_usd=.15;set role service_role');
 await claim(OWNER,1,.1);
 await db.exec('reset role');await db.query('delete from public.analysis_usage where user_id=$1',[OWNER]);await db.exec('set role service_role');
 await assert.rejects(()=>claim(OTHER,1,.1),/AI_APP_BUDGET_REACHED/);
});
test('not-sent failure refunds once; sent ambiguity retains quota and cannot retry or be user-reconciled',async()=>{
 await reset();const before=await claim();
 await db.query('select public.analysis_report_fail($1,$2,$3,$4)',[OWNER,before.report.id,before.report.request_id,'Preflight failed']);
 const after=await claim(OWNER,2);await db.query("select public.ai_mark_sent($1,'report',$2,$3)",[OWNER,after.report.id,after.report.request_id]);
 await assert.rejects(()=>db.query("select public.ai_mark_sent($1,'report',$2,$3)",[OWNER,after.report.id,after.report.request_id]),/STALE_ATTEMPT/);
 await db.query('select public.analysis_report_fail($1,$2,$3,$4)',[OWNER,after.report.id,after.report.request_id,'Response uncertain']);
 const retry=await claim(OWNER,2);assert.equal(retry.claimed,false);assert.equal(retry.report.status,'uncertain');
 await assert.rejects(()=>db.query("select private.ai_reconcile_unbilled('report',$1,'proof-123')",[after.report.id]),/permission denied/);
 await db.exec('reset role');const usage=await db.query<{requests:number;estimated_cost_usd:string}>('select requests,estimated_cost_usd from public.analysis_usage where user_id=$1',[OWNER]);assert.equal(usage.rows[0].requests,1);assert.equal(Number(usage.rows[0].estimated_cost_usd),.1);
 await db.query("select private.ai_reconcile_unbilled('report',$1,'synthetic-provider-confirmed-unbilled')",[after.report.id]);assert.equal((await db.query<{requests:number}>('select requests from public.analysis_usage where user_id=$1',[OWNER])).rows[0].requests,0);
 await assert.rejects(()=>db.query("select private.ai_reconcile_unbilled('report',$1,'proof-123')",[after.report.id]),/STALE_ATTEMPT/);
});
test('server timezone boundary is Istanbul, old month rows never reset or mix current account usage',async()=>{
 await reset();await db.exec("reset role;alter table public.analysis_usage disable trigger ai_shared_budget");
 await db.query("insert into public.analysis_usage(user_id,month,requests,estimated_cost_usd) values($1,(date_trunc('month',clock_timestamp() at time zone 'Europe/Istanbul')-interval '1 month')::date,4,.1)",[OWNER]);
 await db.exec('alter table public.analysis_usage enable trigger ai_shared_budget;set role service_role');await claim();
 await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
 const status=await db.query<{value:{requests:number}}>('select public.ai_usage_status() as value');assert.equal(status.rows[0].value.requests,1);
 const boundary=await db.query<{month:string}>("select to_char('2026-09-30T21:00:00Z'::timestamptz at time zone 'Europe/Istanbul','YYYY-MM') as month");assert.equal(boundary.rows[0].month,'2026-10');
});
test('automatic schedule cannot be enabled even by the service',async()=>{await reset();await assert.rejects(()=>db.query("select public.analysis_schedule_set_for_owner($1,true,'2026-09-01')",[OWNER]),/AUTOMATIC_AI_DISABLED/);});
