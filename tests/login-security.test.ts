import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {test} from 'node:test';
import {authAttemptDigests, requireLoginAttempt} from '../src/lib/server/auth-rate-limit';
import nextConfig from '../next.config';
import {POST as login} from '../src/app/api/login/route';

const secret='synthetic-server-only-key';
const request=(headers:Record<string,string>={})=>new Request('https://study.example.test/api/login',{headers});
const digest=(text:string)=>createHmac('sha256',secret).update(text).digest('hex');

test('auth limiter digests normalize email and trust only Vercel-added valid IPs',()=>{
  assert.deepEqual(authAttemptDigests(request({'x-vercel-forwarded-for':'203.0.113.7','x-forwarded-for':'192.0.2.9'}),' Owner@Example.Test ',secret,true),
    {ip_digest:digest('ip:203.0.113.7'),email_digest:digest('email:owner@example.test')});
  const untrustedHeaders:Record<string,string>[]=[
    {'x-vercel-forwarded-for':'not-an-ip'}, {'x-forwarded-for':'203.0.113.8'}, {},
  ];
  for(const headers of untrustedHeaders)assert.equal(authAttemptDigests(request(headers),'owner@example.test',secret,true).ip_digest,null);
  assert.equal(authAttemptDigests(request({'x-vercel-forwarded-for':'203.0.113.7'}),'owner@example.test',secret,false).ip_digest,null);
  assert.notEqual(digest('email:203.0.113.7'),digest('ip:203.0.113.7'));
});

test('login limiter uses a shared RPC with digests and no raw email, IP or password',async()=>{
  const calls:Array<{name:string;args:unknown}>=[];
  const service={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:true,error:null};}};
  await requireLoginAttempt(request({'x-vercel-forwarded-for':'203.0.113.7'}),'Owner@Example.Test',
    {service:service as never,secret,trustedProxy:true});
  assert.deepEqual(calls,[{name:'classroom_login_allowed',args:{ip_digest:digest('ip:203.0.113.7'),email_digest:digest('email:owner@example.test')}}]);
  assert.doesNotMatch(JSON.stringify(calls),/owner@example|203\.0\.113|password/i);
});

test('login limiter separates shared denial from outages and never falls back to local admission',async t=>{
  const log=t.mock.method(console,'error',()=>{});
  let calls=0;
  await assert.rejects(()=>requireLoginAttempt(request(),'owner@example.test',{
    secret,service:{rpc:async()=>{calls++;return {data:false,error:null};}} as never,
  }),{status:429,code:'RATE_LIMITED'});
  for(const reply of [
    {data:null,error:{message:'PRIVATE SQL password secret'}}, {data:null,error:null}, {data:'true',error:null},
  ])await assert.rejects(()=>requireLoginAttempt(request(),'owner@example.test',{
    secret,service:{rpc:async()=>{calls++;return reply;}} as never,
  }),{status:503,code:'LOGIN_UNAVAILABLE'});
  await assert.rejects(()=>requireLoginAttempt(request(),'owner@example.test',{
    secret,service:{rpc:async()=>{calls++;throw new Error('PRIVATE network token secret');}} as never,
  }),{status:503,code:'LOGIN_UNAVAILABLE'});
  assert.equal(calls,5);
  assert.equal(log.mock.callCount(),4);
  assert.ok(log.mock.calls.every(call=>JSON.stringify(call.arguments)==='["LOGIN_RATE_LIMIT_UNAVAILABLE"]'));
});

test('login limiter requires its server secret and does not contact the store without it',async t=>{
  t.mock.method(console,'error',()=>{});
  let calls=0;
  await assert.rejects(()=>requireLoginAttempt(request(),'owner@example.test',{
    secret:'',service:{rpc:async()=>{calls++;return {data:true,error:null};}} as never,
  }),{status:503,code:'LOGIN_UNAVAILABLE'});
  assert.equal(calls,0);
});

test('login rejects cross-origin requests before configuration or shared rate checks',async()=>{
  const response=await login(new Request('https://study.example.test/api/login',{
    method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},
    body:JSON.stringify({email:'owner@example.test',password:'synthetic-password'}),
  }));
  assert.equal(response.status,403);
  assert.equal((await response.json()).error.code,'ORIGIN_REJECTED');
});

test('login route stops before Auth when the shared limiter denies or cannot answer',async t=>{
  t.mock.method(console,'error',()=>{});
  const environment={APP_ORIGIN:process.env.APP_ORIGIN,NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ALLOWED_USER_EMAIL:process.env.ALLOWED_USER_EMAIL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY};
  Object.assign(process.env,{APP_ORIGIN:'https://study.example.test',NEXT_PUBLIC_SUPABASE_URL:'https://database.example.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',ALLOWED_USER_EMAIL:'owner@example.test',
    SUPABASE_SECRET_KEY:'sb_secret_synthetic'});
  let storeAvailable=true;
  const paths:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    paths.push(url.pathname);
    assert.equal(url.pathname,'/rest/v1/rpc/classroom_login_allowed');
    return storeAvailable?Response.json(false):Response.json({message:'PRIVATE database error'},{status:503});
  });
  try{
    for(const [available,status,code] of [[true,429,'RATE_LIMITED'],[false,503,'LOGIN_UNAVAILABLE']] as const){
      storeAvailable=available;
      const response=await login(new Request('https://study.example.test/api/login',{
        method:'POST',headers:{origin:'https://study.example.test','content-type':'application/json'},
        body:JSON.stringify({email:'owner@example.test',password:'synthetic-password'}),
      }));
      assert.equal(response.status,status);
      const body=await response.json();
      assert.equal(body.error.code,code);
      assert.doesNotMatch(JSON.stringify(body),/PRIVATE|synthetic-password/);
    }
    assert.deepEqual(paths,['/rest/v1/rpc/classroom_login_allowed','/rest/v1/rpc/classroom_login_allowed']);
  }finally{
    for(const [key,value] of Object.entries(environment)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('all routes have frame protection without adding script or connection restrictions',async()=>{
  assert.ok(nextConfig.headers);
  const rules=await nextConfig.headers();
  const global=rules.find(rule=>rule.source==='/:path*');
  assert.ok(global);
  const headers=Object.fromEntries(global.headers.map(header=>[header.key.toLowerCase(),header.value]));
  assert.equal(headers['content-security-policy'],"frame-ancestors 'none'");
  assert.equal(headers['x-frame-options'],'DENY');
  assert.equal(headers['x-content-type-options'],'nosniff');
});
