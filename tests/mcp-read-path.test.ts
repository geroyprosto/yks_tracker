import assert from 'node:assert/strict';
import test from 'node:test';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {emptyState} from '../src/lib/domain/types';
import {createStudyMcpServer} from '../src/lib/server/mcp-tools';
import {executeMcpOwnerCommand,getMcpOwnerState} from '../src/lib/server/mcp-gateway';

const ownerId='22222222-2222-4222-8222-222222222222';
const otherId='33333333-3333-4333-8333-333333333333';
const requestId='11111111-1111-4111-8111-111111111111';

function toolCaller(client:unknown){
  const handler=createMcpHandler(()=>createStudyMcpServer(client as never,ownerId,'https://study.example.com/'),{responseMode:'json'});
  return async(name:string,args:Record<string,unknown>={})=>{
    const response=await handler.fetch(new Request('https://study.example.com/api/mcp',{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),
    }));
    assert.equal(response.status,200);
    const raw=await response.text();
    const payload=raw.startsWith('event:')?raw.split(/\r?\n/).find(line=>line.startsWith('data: '))?.slice(6):raw;
    assert.ok(payload);
    return JSON.parse(payload).result as {isError?:boolean;content:Array<{text:string}>};
  };
}

test('MCP lists send their bounded filters to the narrow owner read without loading full state',async()=>{
  const cases=[
    {name:'list_tasks',resource:'tasks',args:{from_date:'2026-10-01',to_date:'2026-10-28',status:'done',limit:7},
      filters:{from_date:'2026-10-01',to_date:'2026-10-28',status:'done',limit:7},
      rows:[{id:'task-1',title:'Fizik çalış',plan_date:'2026-10-28',exam:'TYT',subject:'Fizik',progress:1,planned_minutes:45,priority:'high'}]},
    {name:'list_topics',resource:'topics',args:{exam:'AYT',subject:'  FİZİK  ',limit:4},
      filters:{exam:'AYT',subject:'FİZİK',limit:4},
      rows:[{id:'topic-1',exam:'AYT',subject:'Fizik',name:'Kuvvet',parent_id:null,mastery:2,revision:3,review_requested:false}]},
    {name:'list_study_sessions',resource:'sessions',args:{from_date:'2026-10-27',to_date:'2026-10-28',limit:8},
      filters:{from_date:'2026-10-27',to_date:'2026-10-28',limit:8},
      rows:[{kind:'timer',id:'session-1',study_date:'2026-10-28',subject:'AYT Fizik',duration_seconds:1800}]},
    {name:'list_exams',resource:'exams',args:{limit:3},filters:{limit:3},
      rows:[{id:'exam-1',name:'TYT denemesi',exam_date:'2026-10-28',format_code:'TYT',total_net:75,score:null,rank:null,
        results:[{section_key:'turkish',correct:35,wrong:4,blank:1,net:34}]}]},
  ];
  for(const item of cases){
    const calls:Array<{name:string;args:unknown}>=[];
    const expected={[item.resource]:item.rows,count:item.rows.length};
    const call=toolCaller({rpc:async(name:string,args:Record<string,unknown>)=>{
      calls.push({name,args});
      if(name!=='mcp_owner_read')throw new Error('Lists must not load private full state');
      return {data:expected,error:null};
    }});
    const result=await call(item.name,item.args);
    assert.equal(result.isError,undefined,item.name);
    assert.deepEqual(JSON.parse(result.content[0].text),expected,item.name);
    assert.deepEqual(calls,[{name:'mcp_owner_read',args:{p_user_id:ownerId,p_resource:item.resource,p_filters:item.filters}}]);
    assert.doesNotMatch(result.content[0].text,/notes|journal|original_text|user_id/);
  }
});

test('MCP narrow list defaults remain bounded and invalid date ranges do not read the database',async()=>{
  const calls:Array<Record<string,unknown>>=[];
  const call=toolCaller({rpc:async(name:string,args:Record<string,unknown>)=>{
    assert.equal(name,'mcp_owner_read');calls.push(args);
    return {data:{[args.p_resource as string]:[],count:0},error:null};
  }});
  for(const name of ['list_tasks','list_topics','list_study_sessions','list_exams']){
    assert.equal((await call(name)).isError,undefined);
  }
  assert.deepEqual(calls.map(row=>row.p_filters),[{status:'all',limit:25},{limit:25},{limit:25},{limit:20}]);
  for(const name of ['list_tasks','list_study_sessions']){
    const result=await call(name,{from_date:'2026-10-28',to_date:'2026-10-01'});
    assert.equal(result.isError,true);
    assert.match(result.content[0].text,/Bitiş tarihi başlangıçtan önce olamaz/);
  }
  assert.equal(calls.length,4);
});

function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}

test('MCP full-state reads share only the pending request for the same client and verified owner',async()=>{
  const pending=deferred<{data:unknown;error:null}>();
  const calls:Array<string>=[];
  const client={rpc:async(_name:string,args:{p_user_id:string})=>{calls.push(args.p_user_id);return pending.promise;}};
  const first=getMcpOwnerState(client as never,ownerId);
  const joined=getMcpOwnerState(client as never,ownerId);
  const other=getMcpOwnerState(client as never,otherId);
  const separate=getMcpOwnerState({rpc:client.rpc} as never,ownerId);
  assert.deepEqual(calls,[ownerId,otherId,ownerId]);
  pending.resolve({data:{...emptyState(true),server_now:'2026-10-28T10:00:00Z'},error:null});
  const states=await Promise.all([first,joined,other,separate]);
  assert.deepEqual(states[0],states[1]);
  await getMcpOwnerState(client as never,ownerId);
  assert.equal(calls.length,4,'a completed read must not remain cached');
});

test('failed full-state reads are evicted and a confirmed MCP write separates the next read from a pending snapshot',async()=>{
  const stale=deferred<{data:unknown;error:null}>();
  const fresh=deferred<{data:unknown;error:null}>();
  let reads=0;
  const client={rpc:async(name:string)=>{
    if(name==='mcp_owner_command')return {data:{id:'task-1',request_id:requestId,replayed:false},error:null};
    reads++;
    if(reads===1)return {data:null,error:{code:'57014',message:'canceling statement due to statement timeout'}};
    if(reads===2)return stale.promise;
    return fresh.promise;
  }};
  const failures=await Promise.allSettled([getMcpOwnerState(client as never,ownerId),getMcpOwnerState(client as never,ownerId)]);
  assert.ok(failures.every(result=>result.status==='rejected'));
  assert.equal(reads,1);
  const beforeWrite=getMcpOwnerState(client as never,ownerId);
  await executeMcpOwnerCommand(client as never,ownerId,{request_id:requestId,type:'task.create',payload:{title:'Fizik',plan_date:'2026-10-28'}},
    {publish:async()=>{},defer:()=>{}});
  const afterWrite=getMcpOwnerState(client as never,ownerId);
  assert.equal(reads,3);
  stale.resolve({data:{...emptyState(true),server_now:'2026-10-28T10:00:00Z'},error:null});
  await beforeWrite;
  const joinedFresh=getMcpOwnerState(client as never,ownerId);
  assert.equal(reads,3,'the older read must not evict the newer pending snapshot');
  fresh.resolve({data:{...emptyState(true),server_now:'2026-10-28T12:00:00Z'},error:null});
  assert.equal((await afterWrite).server_now,'2026-10-28T12:00:00Z');
  assert.equal((await joinedFresh).server_now,'2026-10-28T12:00:00Z');
});

test('MCP study summary keeps computed durations and excludes private record content',async()=>{
  const state=emptyState(true);
  state.server_now='2026-10-28T12:00:00Z';
  state.manual_study_entries=[{id:'manual-1',study_date:'2026-10-28',subject:'TYT Fizik',duration_seconds:3600,created_at:'2026-10-28T10:00:00Z'}];
  state.journal_entries=[{original_text:'PRIVATE-JOURNAL'}] as typeof state.journal_entries;
  const call=toolCaller({rpc:async(name:string)=>{assert.equal(name,'mcp_owner_state');return {data:state,error:null};}});
  const result=await call('get_study_summary',{period:'day'});
  assert.equal(result.isError,undefined);
  assert.equal(JSON.parse(result.content[0].text).total_seconds,3600);
  assert.doesNotMatch(result.content[0].text,/PRIVATE-JOURNAL|original_text|journal_entries/);
});
