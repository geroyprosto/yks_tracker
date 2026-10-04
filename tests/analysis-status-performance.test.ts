import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {emptyState} from '../src/lib/domain/types';
import {buildAnalysisSnapshot} from '../src/lib/analysis-snapshot';
import {analysisAdmin, getAnalysisStatus, ownerId} from '../src/lib/server/analysis';
import {coachingRpc, loadCoachingContext} from '../src/lib/server/coaching';
import {getState} from '../src/lib/server/service';
import {ApiError} from '../src/lib/server/http';

const userId='11111111-1111-4111-8111-111111111111';
const cutoff='2026-10-01T09:00:00Z';
const state={...emptyState(true),server_now:cutoff,manual_study_entries:[{
  id:'study-1',study_date:'2026-10-01',subject:'Matematik',duration_seconds:3600,created_at:cutoff,
}]};
const sourceHash=buildAnalysisSnapshot(state,'2026-09-25','2026-10-01').sourceHash;
const reports=[{
  id:'saved-report',user_id:userId,start_date:'2026-09-25',end_date:'2026-10-01',source_hash:sourceHash,
  status:'completed',body:'Kayıtlı rapor',summary:{schema_version:1},usage:null,error_message:null,
  request_id:'report-request',created_at:cutoff,updated_at:cutoff,
}];
const homework={title:'Matematik konu öğrenimi',topic_id:'topic-1',status:'created',task_ids:['task-1']};
const repetition={title:'Problemler tekrar',topic_id:'topic-2',status:'created',task_ids:['task-2']};

type Call={name:string;method:string;started:number;ended:number;url:URL;body:unknown};
async function withFixture<T>(run:(fixture:{client:SupabaseClient;calls:Call[];authCalls:()=>number})=>Promise<T>,
  {latency=0,signIn=true,failure=''}:{latency?:number;signIn?:boolean;failure?:string}={}){
  const values={
    NEXT_PUBLIC_SUPABASE_URL:'https://analysis-fixture.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
    ALLOWED_USER_EMAIL:'owner@fixture.test',SUPABASE_SECRET_KEY:'sb_secret_fixture',
    AI_ENABLED:'true',OPENAI_API_KEY:'fixture-openai-key',OPENAI_MODEL:'fixture-coach',
    AI_INPUT_PRICE_PER_1M_USD:'1',AI_OUTPUT_PRICE_PER_1M_USD:'1',AI_MONTHLY_BUDGET_USD:'1',
  };
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch;
  const calls:Call[]=[];
  let authCalls=0;
  Object.assign(process.env,values);
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    assert.equal(url.hostname,'analysis-fixture.supabase.co','Opening analysis must never call an AI provider');
    const name=url.pathname.split('/').at(-1)!;
    const method=init?.method??'GET';
    const body=init?.body?JSON.parse(String(init.body)):null;
    const call={name,method,started:performance.now(),ended:0,url,body};calls.push(call);
    await delay(latency);call.ended=performance.now();
    if(name===failure)return Response.json({code:'XX000',message:'fixture unavailable'},{status:400});
    const data:Record<string,unknown>={
      analysis_settings:[{enabled:false,start_date:null}],analysis_reports:reports,
      ai_usage_status:{requests:1,estimated_cost_usd:.1,resets_at:'2026-11-01T00:00:00Z',enabled:true,month:'2026-10'},
      yks_state:state,
      coaching_context:{plan:null,previous_cutoff:null,previous_report_id:null,previous_metrics:null,homework_results:[homework]},
      topic_review_receipt:{results:[repetition],current_cutoff:cutoff},
    };
    assert.ok(name in data,`Opening analysis must not run a write RPC: ${name}`);
    return Response.json(data[name]);
  };
  try{
    const client=createClient(values.NEXT_PUBLIC_SUPABASE_URL,values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {auth:{autoRefreshToken:false,persistSession:false}});
    client.auth.getUser=(async()=>{
      authCalls++;await delay(latency);
      return signIn?{data:{user:{id:userId}},error:null}:{data:{user:null},error:null};
    }) as typeof client.auth.getUser;
    return await run({client,calls,authCalls:()=>authCalls});
  }finally{
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}

// The former request waterfall, retained as the identical-delay comparison workload.
async function sequentialStatusReads(client:SupabaseClient){
  const id=await ownerId(client);
  await Promise.all([
    client.from('analysis_settings').select('enabled,start_date').eq('user_id',id).maybeSingle(),
    client.from('analysis_reports').select('*').eq('user_id',id).order('created_at',{ascending:false}).limit(25),
    client.rpc('ai_usage_status'),
  ]);
  await getState(client);
  const admin=analysisAdmin();
  await loadCoachingContext(admin,id);
  await coachingRpc(admin,'topic_review_receipt',{p_user_id:id});
}

test('analysis opening overlaps independent reads and avoids a repeated verified-user lookup',async context=>{
  await withFixture(async({client,calls,authCalls})=>{
    const baselineStart=performance.now();await sequentialStatusReads(client);
    const baseline=performance.now()-baselineStart;
    calls.length=0;
    const beforeAuth=authCalls(),start=performance.now();
    const result=await getAnalysisStatus(client,userId);
    const optimized=performance.now()-start;
    context.diagnostic(`100 ms per remote call: sequential ${Math.round(baseline)} ms → parallel ${Math.round(optimized)} ms`);
    assert.ok(optimized<baseline*.65,`Expected a meaningful latency reduction: ${optimized} vs ${baseline} ms`);
    assert.equal(authCalls(),beforeAuth,'The route already verified this user');
    assert.deepEqual(calls.map(call=>call.name).sort(),[
      'analysis_settings','analysis_reports','ai_usage_status','yks_state','coaching_context','topic_review_receipt',
    ].sort());
    assert.ok(Math.max(...calls.map(call=>call.started))<Math.min(...calls.map(call=>call.ended)),
      'All independent reads must start before the first one finishes');
    assert.equal(result.configured,true);
    assert.equal(result.current_coaching.study.total_seconds,3600);
    assert.deepEqual(result.current_coaching.homework_results,[homework]);
    assert.equal(result.current_coaching.directions[0].topic_id,'topic-1');
    assert.deepEqual(result.current_repetition_results,[repetition]);
    assert.equal(result.current_repetition_cutoff,cutoff);
    assert.equal(result.reports[0].body,'Kayıtlı rapor');
    assert.equal(result.reports[0].stale,false,'Legacy report source hashes still use fresh state');
    assert.equal(result.used.requests,1);
    for(const call of calls){
      if(call.name.startsWith('analysis_'))assert.equal(call.url.searchParams.get('user_id'),`eq.${userId}`);
      if(call.name==='coaching_context'||call.name==='topic_review_receipt')assert.deepEqual(call.body,{p_user_id:userId});
    }
  },{latency:100});
});

test('status still verifies direct callers and refuses unauthenticated reads before accessing data',async()=>{
  await withFixture(async({client,calls,authCalls})=>{
    await getAnalysisStatus(client);
    assert.equal(authCalls(),1);assert.equal(calls.length,6);
  });
  await withFixture(async({client,calls,authCalls})=>{
    await assert.rejects(()=>getAnalysisStatus(client),error=>error instanceof ApiError&&error.code==='SIGN_IN_REQUIRED');
    assert.equal(authCalls(),1);assert.equal(calls.length,0);
  },{signIn:false});
});

test('unconfigured AI storage still opens the analysis page with current local metrics',async()=>{
  await withFixture(async({client,calls})=>{
    delete process.env.SUPABASE_SECRET_KEY;
    const result=await getAnalysisStatus(client,userId);
    assert.equal(result.configured,false);
    assert.equal(result.current_coaching.study.total_seconds,3600);
    assert.deepEqual(result.current_coaching.homework_results,[]);
    assert.deepEqual(result.current_repetition_results,[]);
    assert.equal(result.annual_plan,null);
    assert.equal(calls.length,4);
  });
});

test('failed analysis reads report an error without requesting AI or assigning tasks',async()=>{
  for(const failure of ['analysis_reports','yks_state','coaching_context','topic_review_receipt']){
    await withFixture(async({client,calls})=>{
      await assert.rejects(()=>getAnalysisStatus(client,userId),error=>error instanceof ApiError&&error.status===503);
      assert.ok(calls.every(call=>['analysis_settings','analysis_reports','ai_usage_status','yks_state','coaching_context','topic_review_receipt'].includes(call.name)));
      await delay(0); // Let the other independent fixture reads settle before restoring fetch.
    },{failure});
  }
});
