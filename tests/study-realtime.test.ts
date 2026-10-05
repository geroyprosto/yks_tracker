import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import type {Redis} from '@upstash/redis';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ApiError} from '../src/lib/server/http';
import {createStudyRealtimeGet,studyRealtimeStream} from '../src/lib/server/study-realtime-route';
import {publishStudyDirty,scheduleStudyDirty,studyRealtimeChannel,studyRealtimeRedis} from '../src/lib/server/study-realtime';
import {executeCommand,executeStudentCommand} from '../src/lib/server/service';
import {executeEducationCommand} from '../src/lib/server/education';
import {executeMcpOwnerCommand} from '../src/lib/server/mcp-gateway';

const userId='11111111-1111-4111-8111-111111111111';
const otherUser='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const taskId='44444444-4444-4444-8444-444444444444';
const input={request_id:requestId,type:'task.delete',payload:{id:taskId,expected_revision:1}};
const receipt={id:taskId,request_id:requestId,replayed:false};
const response=(path:string,options:RequestInit={})=>new Request('https://yksim.example/api/realtime'+path,options);

function subscription(){
  const events=new EventEmitter();let unsubscribed=0;let subscribed=0;
  const handle={on:(name:string,listener:(...args:unknown[])=>void)=>events.on(name,listener),
    unsubscribe:async()=>{unsubscribed++;}};
  const redis={subscribe:()=>{subscribed++;return handle;}} as unknown as Pick<Redis,'subscribe'>;
  return {redis,events,get unsubscribed(){return unsubscribed;},get subscribed(){return subscribed;}};
}

test('realtime metadata is private and only a live authorized identity determines its channel',async()=>{
  let authorized=0;let available=0;
  const get=createStudyRealtimeGet({authorize:async()=>{authorized++;return {userId};},redis:()=>{available++;return subscription().redis;}});
  const result=await get(response('?session=1'));
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{enabled:true,channel:studyRealtimeChannel(userId)});
  assert.equal(authorized,1);assert.equal(available,1);
  assert.match(result.headers.get('cache-control')??'',/private, no-store/);
  assert.equal(result.headers.get('access-control-allow-origin'),null);
  assert.ok(!studyRealtimeChannel(userId).includes(userId));
});

test('default, public, other users, environment channels and multichannel requests never subscribe',async()=>{
  let subscriptions=0;let authorized=0;
  const get=createStudyRealtimeGet({authorize:async()=>{authorized++;return {userId};},redis:()=>{subscriptions++;return subscription().redis;}});
  const own=studyRealtimeChannel(userId);
  for(const path of ['', '?channel=default','?channel=PUBLIC',`?channel=${studyRealtimeChannel(otherUser)}`,
    '?channel=yksim:study:v1:'+'0'.repeat(64),`?channel=${own}&channel=${own}`,`?session=1&channel=${own}`]){
    assert.equal((await get(response(path))).status,403,path);
  }
  assert.equal(authorized,7);assert.equal(subscriptions,0);
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
  for(const [code,status] of [['SIGN_IN_REQUIRED',401],['STUDENT_REQUIRED',403],['DEMO_INTEGRATION_DISABLED',403]] as const){
    const denied=createStudyRealtimeGet({authorize:async()=>{throw new ApiError(status,code,'Denied');},
      redis:()=>{throw new Error('Forbidden route touched Redis');}});
    assert.equal((await denied(response('?session=1'))).status,status);
  }
});

test('foreign origins cannot open a private stream even with cookies',async()=>{
  const get=createStudyRealtimeGet({authorize:async()=>{throw new Error('Auth should not run');},redis:()=>null});
  assert.equal((await get(response('?session=1',{headers:{origin:'https://attacker.example'}}))).status,403);
  assert.equal((await get(response('?session=1',{headers:{'sec-fetch-site':'cross-site'}}))).status,403);
  assert.equal((await get(response('?session=1',{headers:{'sec-fetch-site':'same-site'}}))).status,403);
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

test('SSE forwards only strict empty dirty hints from the bound channel and cleans up on cancel',async()=>{
  const sub=subscription();const channel=studyRealtimeChannel(userId);
  const result=studyRealtimeStream(response(''),sub.redis,channel);
  const reader=result.body!.getReader();
  sub.events.emit('subscribe');
  const connected=new TextDecoder().decode((await reader.read()).value);
  assert.ok(connected.includes('"type":"connected"'));
  sub.events.emit('message',{message:{id:'10-0',event:'study.dirty',channel:studyRealtimeChannel(otherUser),data:{}}});
  sub.events.emit('message',{message:{id:'11-0',event:'study.dirty',channel,data:{journal:'private text'}}});
  sub.events.emit('message',{message:{id:'12-0',event:'task.update',channel,data:{}}});
  sub.events.emit('message',{message:{id:'13-0',event:'study.dirty',channel,data:{},token:'must not travel'}});
  const dirty=new TextDecoder().decode((await reader.read()).value);
  assert.equal(dirty,`data: ${JSON.stringify({event:'study.dirty',channel,data:{},id:'13-0'})}\n\n`);
  await reader.cancel();assert.equal(sub.unsubscribed,1);
  assert.equal(result.headers.get('access-control-allow-origin'),null);
});

test('preaborted and pending subscriptions close without leaking a subscriber',async()=>{
  const already=new AbortController();already.abort();const untouched=subscription();
  const empty=studyRealtimeStream(response('',{signal:already.signal}),untouched.redis,studyRealtimeChannel(userId));
  assert.equal((await empty.body!.getReader().read()).done,true);assert.equal(untouched.subscribed,0);
  const pending=new AbortController();const sub=subscription();
  const stream=studyRealtimeStream(response('',{signal:pending.signal}),sub.redis,studyRealtimeChannel(userId));
  pending.abort();
  assert.equal((await stream.body!.getReader().read()).done,true);assert.equal(sub.unsubscribed,1);
  pending.abort();assert.equal(sub.unsubscribed,1);
});

test('Redis errors and handshake timeout redact upstream details and release handles',async()=>{
  const sub=subscription();
  const stream=studyRealtimeStream(response(''),sub.redis,studyRealtimeChannel(userId));
  sub.events.emit('error',new Error('Bearer secret https://private-redis.example'));
  const body=await stream.text();
  assert.ok(body.includes('Realtime temporarily unavailable'));
  assert.ok(!body.includes('secret'));assert.ok(!body.includes('private-redis'));assert.equal(sub.unsubscribed,1);
  const pending=subscription();
  const timeout=studyRealtimeStream(response(''),pending.redis,studyRealtimeChannel(userId),{lifetime:100,handshake:5,heartbeat:50});
  assert.ok((await timeout.text()).includes('Realtime temporarily unavailable'));assert.equal(pending.unsubscribed,1);
});

test('lifetime sends graceful reconnect and releases the Redis connection',async()=>{
  const sub=subscription();
  const stream=studyRealtimeStream(response(''),sub.redis,studyRealtimeChannel(userId),{lifetime:5,handshake:100,heartbeat:50});
  sub.events.emit('subscribe');
  const body=await stream.text();assert.ok(body.includes('"type":"reconnect"'));assert.equal(sub.unsubscribed,1);
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
  const client={rpc:async(name:string)=>{calls.push(name);return {data:name==='yks_state'?{server_now:new Date().toISOString()}:receipt,error:null};},
    auth:{getClaims:async()=>({data:{claims:{sub:userId}},error:null})}} as unknown as SupabaseClient;
  await executeCommand(client,input,{minimal:false,notification:options});
  await executeCommand(client,input,{minimal:true,notification:options});
  await executeEducationCommand(client,{request_id:requestId,type:'draft.discard',payload:{expected_revision:1}},{minimal:true,notification:options});
  await executeMcpOwnerCommand(client,otherUser,input,options);
  assert.equal(jobs.length,4);assert.deepEqual(targets,[]);
  for(const job of jobs)await job();
  assert.deepEqual(targets,[userId,userId,userId,otherUser]);
  assert.deepEqual(calls,['yks_command','yks_state','yks_command','education_command','mcp_owner_command']);
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

test('SDK emit stores/publishes only the typed empty hint in the shared database/environment scope',async(t)=>{
  const saved={url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN,
    environment:process.env.VERCEL_ENV,demo:process.env.CLASSROOM_DEMO_ENABLED};
  process.env.UPSTASH_REDIS_REST_URL='https://test-redis.example';process.env.UPSTASH_REDIS_REST_TOKEN='fake-secret';
  delete process.env.CLASSROOM_DEMO_ENABLED;process.env.VERCEL_ENV='production';
  try{
    const redis=studyRealtimeRedis()!;const writes:unknown[]=[];
    t.mock.method(redis,'xadd',async(...args:unknown[])=>{writes.push(args);return '1-0';});
    const pipeline={expire:(...args:unknown[])=>{writes.push(['expire',...args]);return pipeline;},
      publish:(...args:unknown[])=>{writes.push(['publish',...args]);return pipeline;},exec:async()=>[]};
    t.mock.method(redis,'pipeline',()=>pipeline);
    const channel=studyRealtimeChannel(userId);await publishStudyDirty(userId);
    assert.deepEqual(writes,[[channel,'*',{data:{},event:'study.dirty',channel},{trim:{type:'MAXLEN',threshold:32,comparison:'='}}],
      ['expire',channel,60],['publish',channel,{data:{},event:'study.dirty',channel,id:'1-0'}]]);
    const encoded=JSON.stringify(writes);assert.ok(!encoded.includes(userId));assert.ok(!encoded.includes('fake-secret'));
    process.env.VERCEL_ENV='preview';assert.notEqual(studyRealtimeChannel(userId),channel);
  }finally{
    for(const [name,value] of [['UPSTASH_REDIS_REST_URL',saved.url],['UPSTASH_REDIS_REST_TOKEN',saved.token],
      ['VERCEL_ENV',saved.environment],['CLASSROOM_DEMO_ENABLED',saved.demo]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});
