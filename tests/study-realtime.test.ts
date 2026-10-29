import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Redis} from '@upstash/redis';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ApiError} from '../src/lib/server/http';
import {createStudyRealtimeGet} from '../src/lib/server/study-realtime-route';
import {publishStudyDirty,scheduleStudyDirty,studyRealtimeChannel,studyRealtimeRedis,studyRealtimeVersionKey} from '../src/lib/server/study-realtime';
import {executeCommand,executeStudentCommand} from '../src/lib/server/service';
import {executeEducationCommand} from '../src/lib/server/education';
import {executeMcpOwnerCommand} from '../src/lib/server/mcp-gateway';

const userId='11111111-1111-4111-8111-111111111111';
const otherUser='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const taskId='44444444-4444-4444-8444-444444444444';
const version='55555555-5555-4555-8555-555555555555';
const input={request_id:requestId,type:'task.delete',payload:{id:taskId,expected_revision:1}};
const receipt={id:taskId,request_id:requestId,replayed:false};
const response=(path:string,options:RequestInit={})=>new Request('https://yksim.example/api/realtime'+path,options);

function versionRedis(value:unknown=version){
  const reads:string[]=[];
  const redis={get:async(key:string)=>{reads.push(key);return value;},
    subscribe:()=>{throw new Error('Version requests must never subscribe');}} as unknown as Pick<Redis,'get'>;
  return {redis,reads};
}

test('version checks read only the live authorized identity and remain private',async()=>{
  let authorized=0;let available=0;const store=versionRedis();
  const get=createStudyRealtimeGet({authorize:async()=>{authorized++;return {userId};},redis:()=>{available++;return store.redis;}});
  const result=await get(response('?session=1&userId='+otherUser+'&key='+studyRealtimeVersionKey(otherUser)));
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{enabled:true,version});
  assert.deepEqual(store.reads,[studyRealtimeVersionKey(userId)]);
  assert.equal(authorized,1);assert.equal(available,1);
  assert.match(result.headers.get('cache-control')??'',/private, no-store/);
  assert.equal(result.headers.get('access-control-allow-origin'),null);
  assert.ok(!studyRealtimeVersionKey(userId).includes(userId));
});

test('a missing version is different from unconfigured Redis',async()=>{
  const enabled=createStudyRealtimeGet({authorize:async()=>({userId}),redis:()=>versionRedis(null).redis});
  const disabled=createStudyRealtimeGet({authorize:async()=>({userId}),redis:()=>null});
  assert.deepEqual(await (await enabled(response('?session=1'))).json(),{enabled:true,version:null});
  assert.deepEqual(await (await disabled(response('?session=1'))).json(),{enabled:false});
});

test('legacy own channels stop EventSource reconnects without reading Redis or subscribing',async()=>{
  let authorized=0;
  const get=createStudyRealtimeGet({authorize:async()=>{authorized++;return {userId};},
    redis:()=>{throw new Error('Legacy stream must not touch Redis');}});
  const result=await get(response('?channel='+studyRealtimeChannel(userId)));
  assert.equal(result.status,204);assert.equal(result.body,null);assert.equal(authorized,1);
  assert.match(result.headers.get('cache-control')??'',/private, no-store/);
  assert.equal(result.headers.get('content-type'),null);
});

test('default, public, other users, environment channels and multichannel requests never read Redis',async()=>{
  let redisCalls=0;let authorized=0;
  const get=createStudyRealtimeGet({authorize:async()=>{authorized++;return {userId};},redis:()=>{redisCalls++;return versionRedis().redis;}});
  const own=studyRealtimeChannel(userId);
  for(const path of ['', '?channel=default','?channel=PUBLIC',`?channel=${studyRealtimeChannel(otherUser)}`,
    '?channel=yksim:study:v1:'+'0'.repeat(64),`?channel=${own}&channel=${own}`,`?session=1&channel=${own}`]){
    assert.equal((await get(response(path))).status,403,path);
  }
  assert.equal(authorized,7);assert.equal(redisCalls,0);
});

test('a denied or revoked live account cannot create even a Redis client',async()=>{
  let allowed=true;let redisCalls=0;
  const get=createStudyRealtimeGet({authorize:async()=>{
    if(!allowed)throw new ApiError(403,'APPROVAL_REQUIRED','Denied');
    return {userId};
  },redis:()=>{redisCalls++;return null;}});
  assert.deepEqual(await (await get(response('?session=1'))).json(),{enabled:false});
  allowed=false;
  assert.equal((await get(response('?session=1'))).status,403);
  assert.equal((await get(response('?channel='+studyRealtimeChannel(userId)))).status,403);
  assert.equal(redisCalls,1);
  for(const [code,status] of [['SIGN_IN_REQUIRED',401],['STUDENT_REQUIRED',403],['DEMO_INTEGRATION_DISABLED',403],['DATABASE_TIMEOUT',503]] as const){
    const denied=createStudyRealtimeGet({authorize:async()=>{throw new ApiError(status,code,'Denied');},
      redis:()=>{throw new Error('Forbidden route touched Redis');}});
    const result=await denied(response('?session=1'));
    assert.equal(result.status,status);
    assert.deepEqual(await result.json(),{ok:false,error:{code,message:'Denied'}});
  }
});

test('foreign origins cannot read a private version even with cookies',async()=>{
  const get=createStudyRealtimeGet({authorize:async()=>{throw new Error('Auth should not run');},redis:()=>null});
  assert.equal((await get(response('?session=1',{headers:{origin:'https://attacker.example'}}))).status,403);
  assert.equal((await get(response('?session=1',{headers:{'sec-fetch-site':'cross-site'}}))).status,403);
  assert.equal((await get(response('?session=1',{headers:{'sec-fetch-site':'same-site'}}))).status,403);
  assert.equal((await get(response('?channel='+studyRealtimeChannel(userId),{headers:{origin:'https://attacker.example'}}))).status,403);
});

test('same-origin metadata respects the actual host when Next canonicalizes a loopback URL',async()=>{
  const previous=process.env.APP_ORIGIN;delete process.env.APP_ORIGIN;
  try{
    const get=createStudyRealtimeGet({authorize:async()=>({userId}),redis:()=>null});
    const result=await get(new Request('http://localhost:3000/api/realtime?session=1',
      {headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin'}}));
    assert.equal(result.status,200);
  }finally{if(previous!==undefined)process.env.APP_ORIGIN=previous;}
});

test('Redis errors and invalid stored versions disable optional version checks with a private redacted fallback',async()=>{
  const unavailable={get:async()=>{throw new Error('Bearer secret https://private-redis.example');}} as unknown as Pick<Redis,'get'>;
  const factories=[()=>unavailable,()=>versionRedis({journal:'private text'}).redis,()=>versionRedis('Bearer secret').redis,
    ()=>{throw new Error('Bearer secret https://private-redis.example');}];
  for(const redis of factories){
    const get=createStudyRealtimeGet({authorize:async()=>({userId}),redis});
    const result=await get(response('?session=1'));const body=await result.text();
    assert.equal(result.status,200);
    assert.deepEqual(JSON.parse(body),{enabled:false,reason:'unavailable'});
    assert.match(result.headers.get('cache-control')??'',/private, no-store/);
    assert.equal(result.headers.get('vary'),'Cookie');
    assert.equal(result.headers.get('access-control-allow-origin'),null);
    assert.ok(!body.includes('secret'));assert.ok(!body.includes('private-redis'));assert.ok(!body.includes('journal'));
  }
});

test('version keys validate verified identities and isolate users, databases and environments',()=>{
  const saved={database:process.env.NEXT_PUBLIC_SUPABASE_URL,environment:process.env.VERCEL_ENV};
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://database-one.example';process.env.VERCEL_ENV='production';
  try{
    const key=studyRealtimeVersionKey(userId);
    assert.match(key,/^yksim:study:version:v1:[a-f0-9]{64}$/);
    assert.notEqual(key,studyRealtimeVersionKey(otherUser));
    assert.notEqual(key,studyRealtimeChannel(userId));
    assert.throws(()=>studyRealtimeVersionKey('unverified-input'),/Invalid verified identity/);
    process.env.VERCEL_ENV='preview';assert.notEqual(key,studyRealtimeVersionKey(userId));
    process.env.VERCEL_ENV='production';process.env.NEXT_PUBLIC_SUPABASE_URL='https://database-two.example';
    assert.notEqual(key,studyRealtimeVersionKey(userId));
  }finally{
    for(const [name,value] of [['NEXT_PUBLIC_SUPABASE_URL',saved.database],['VERCEL_ENV',saved.environment]] as const){
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  }
});

test('minimal save registers a hint only after commit and returns before background verified claims/publish',async()=>{
  const calls:string[]=[];const jobs:(()=>Promise<void>)[]=[];const targets:string[]=[];
  const client={rpc:async(name:string)=>{calls.push(name);return {data:receipt,error:null};},
    auth:{getClaims:async()=>{calls.push('verifiedClaims');return {data:{claims:{sub:userId}},error:null};}}} as unknown as SupabaseClient;
  const result=await executeStudentCommand(client,input,{defer:work=>jobs.push(work),publish:async user=>{targets.push(user);}});
  assert.deepEqual(result,{...receipt,ok:true});assert.deepEqual(calls,['yks_student_command']);assert.equal(jobs.length,1);
  assert.deepEqual(targets,[]);await jobs[0]();assert.deepEqual(targets,[userId]);
  assert.deepEqual(calls,['yks_student_command','verifiedClaims']);
});

test('invalid inputs and failed RPCs publish nothing; verified claims errors do not alter receipts',async()=>{
  const jobs:(()=>Promise<void>)[]=[];const targets:string[]=[];
  const options={defer:(work:()=>Promise<void>)=>jobs.push(work),publish:async(user:string)=>{targets.push(user);}};
  const failed={rpc:async()=>({data:null,error:{message:'CONFLICT'}})} as unknown as SupabaseClient;
  await assert.rejects(()=>executeStudentCommand(failed,input,options),{code:'CONFLICT'});
  await assert.rejects(()=>executeStudentCommand(failed,{...input,request_id:'bad'},options),{code:'INVALID_INPUT'});
  assert.equal(jobs.length,0);
  const expired={rpc:async()=>({data:receipt,error:null}),auth:{getClaims:async()=>({data:{claims:{sub:otherUser}},error:{message:'Invalid signature'}})}} as unknown as SupabaseClient;
  assert.deepEqual(await executeStudentCommand(expired,input,options),{...receipt,ok:true});
  await jobs[0]();assert.deepEqual(targets,[]);
});

test('web full/minimal, education and MCP commits notify their verified actor without mutation payload',async()=>{
  const jobs:(()=>Promise<void>)[]=[];const targets:string[]=[];const calls:string[]=[];
  const options={defer:(work:()=>Promise<void>)=>jobs.push(work),publish:async(user:string)=>{targets.push(user);}};
  const client={rpc:async(name:string)=>{calls.push(name);return {data:name==='yks_dashboard_state'?{server_now:new Date().toISOString()}:receipt,error:null};},
    auth:{getClaims:async()=>({data:{claims:{sub:userId}},error:null})}} as unknown as SupabaseClient;
  await executeCommand(client,input,{minimal:false,notification:options});
  await executeCommand(client,input,{minimal:true,notification:options});
  await executeEducationCommand(client,{request_id:requestId,type:'draft.discard',payload:{expected_revision:1}},{minimal:true,notification:options});
  await executeMcpOwnerCommand(client,otherUser,input,options);
  assert.equal(jobs.length,4);assert.deepEqual(targets,[]);
  for(const job of jobs)await job();
  assert.deepEqual(targets,[userId,userId,userId,otherUser]);
  assert.deepEqual(calls,['yks_command','yks_dashboard_state','yks_command','education_command','mcp_owner_command']);
});

test('Redis failure never rejects a durable receipt and demo never schedules live work',async()=>{
  const jobs:(()=>Promise<void>)[]=[];
  const options={verifiedUserId:userId,defer:(work:()=>Promise<void>)=>jobs.push(work),publish:async()=>{throw new Error('Redis unavailable');}};
  const client={rpc:async()=>({data:receipt,error:null})} as unknown as SupabaseClient;
  assert.deepEqual(await executeStudentCommand(client,input,options),{...receipt,ok:true});await jobs[0]();
  const previous=process.env.CLASSROOM_DEMO_ENABLED;process.env.CLASSROOM_DEMO_ENABLED='true';
  try{scheduleStudyDirty(client,options);assert.equal(jobs.length,1);assert.equal(studyRealtimeRedis(),null);}
  finally{if(previous===undefined)delete process.env.CLASSROOM_DEMO_ENABLED;else process.env.CLASSROOM_DEMO_ENABLED=previous;}
});

test('publishing replaces one expiring opaque version without history or PubSub',async(t)=>{
  const saved={url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN,
    environment:process.env.VERCEL_ENV,demo:process.env.CLASSROOM_DEMO_ENABLED};
  process.env.UPSTASH_REDIS_REST_URL='https://test-redis.example';process.env.UPSTASH_REDIS_REST_TOKEN='fake-secret';
  delete process.env.CLASSROOM_DEMO_ENABLED;process.env.VERCEL_ENV='production';
  try{
    const redis=studyRealtimeRedis()!;const writes:unknown[][]=[];
    t.mock.method(redis,'set',async(...args:unknown[])=>{writes.push(args);return 'OK';});
    for(const method of ['xadd','pipeline','subscribe','publish'] as const){
      t.mock.method(redis,method,()=>{throw new Error('Study versions must not use '+method);});
    }
    const key=studyRealtimeVersionKey(userId);await publishStudyDirty(userId);await publishStudyDirty(userId);
    assert.equal(writes.length,2);
    for(const write of writes){
      assert.equal(write[0],key);assert.match(write[1] as string,/^[0-9a-f-]{36}$/);
      assert.deepEqual(write[2],{ex:604800});assert.equal(write.length,3);
    }
    assert.notEqual(writes[0][1],writes[1][1]);
    const encoded=JSON.stringify(writes);assert.ok(!encoded.includes(userId));assert.ok(!encoded.includes('fake-secret'));
  }finally{
    for(const [name,value] of [['UPSTASH_REDIS_REST_URL',saved.url],['UPSTASH_REDIS_REST_TOKEN',saved.token],
      ['VERCEL_ENV',saved.environment],['CLASSROOM_DEMO_ENABLED',saved.demo]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});
