import {createServer,type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {expect,test,type Page} from '@playwright/test';
import {emptyState,type AppState,type Task} from '../../src/lib/domain/types';
import {localDate} from '../../src/lib/ui';

const channel='yksim:study:v1:'+'a'.repeat(64);
function task():Task{
  return {id:'22222222-2222-4222-8222-222222222222',title:'Canlı görev',plan_date:localDate(),
    exam:null,subject:null,topic_id:null,resource:'',completion_criteria:'',planned_minutes:30,
    difficulty:'medium',progress:0,weight_override:null,priority:'normal',position:0,notes:'',study_type:'Tekrar',
    steps:[],revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
}
function initialState():AppState{return {...emptyState(true),authenticated:true,tasks:[task()]};}
async function openTasks(page:Page){
  await page.goto('/');
  await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:'Görevlerim',exact:true}).click();
}

/** Native EventSource consumes a real chunked SSE response; the SDK is unmocked. */
async function realtimeFixture(page:Page){
  const streams=new Set<ServerResponse>();
  let connections=0;let sequence=0;
  const server=createServer((request,response)=>{
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store',Connection:'keep-alive',
      'Access-Control-Allow-Origin':request.headers.origin??'http://127.0.0.1:3100','Access-Control-Allow-Credentials':'true'});
    streams.add(response);connections++;
    response.on('close',()=>streams.delete(response));
    response.write(`data: ${JSON.stringify({type:'connected',channel})}\n\n`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as AddressInfo).port;
  await page.route('**/api/realtime?*',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('session')==='1')return route.fulfill({json:{enabled:true,channel}});
    expect(url.searchParams.getAll('channel')).toEqual([channel]);
    return route.fulfill({status:307,headers:{Location:`http://127.0.0.1:${port}/events?${url.searchParams}`}});
  });
  return {
    get connections(){return connections;},
    dirty(){
      const frame=JSON.stringify({id:`${Date.now()}-${++sequence}`,event:'study.dirty',channel,data:{}});
      for(const response of streams)response.write(`data: ${frame}\n\n`);
    },
    reconnect(){for(const response of streams)response.write(`data: ${JSON.stringify({type:'reconnect',timestamp:Date.now()})}\n\n`);},
    async close(){
      for(const response of streams)response.end();
      server.closeAllConnections();
      await new Promise<void>(resolve=>server.close(()=>resolve()));
    }
  };
}

test('typed dirty and reconnect frames refresh an external change without the 30 second poll',async({page})=>{
  const state=initialState();let reads=0;
  await page.route('**/api/state',route=>{reads++;return route.fulfill({json:state});});
  const realtime=await realtimeFixture(page);
  try{
    await openTasks(page);
    await expect.poll(()=>realtime.connections).toBe(1);
    // The first connection repairs any hints missed during initial setup.
    await expect.poll(()=>reads).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    const before=reads;
    state.tasks[0]={...state.tasks[0],title:'Diğer oturumdan değişti',revision:2};
    realtime.dirty();
    await expect(page.getByRole('button',{name:'Diğer oturumdan değişti görevini tamamla'})).toBeVisible({timeout:3000});
    expect(reads).toBeGreaterThan(before);
    const afterDirty=reads;
    state.tasks[0]={...state.tasks[0],title:'Bağlantı boşluğunda değişti',revision:3};
    realtime.reconnect();
    await expect.poll(()=>realtime.connections).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('button',{name:'Bağlantı boşluğunda değişti görevini tamamla'})).toBeVisible({timeout:3000});
    expect(reads).toBeGreaterThan(afterDirty);
  }finally{await realtime.close();}
});

test('dirty received during a held save waits for the queue and preserves the optimistic task',async({page})=>{
  const state=initialState();let reads=0;let writes=0;
  let releaseWrite!:()=>void;const heldWrite=new Promise<void>(resolve=>{releaseWrite=resolve;});
  await page.route('**/api/state',route=>{reads++;return route.fulfill({json:state});});
  await page.route('**/api/command',async route=>{
    const command=route.request().postDataJSON();writes++;
    await heldWrite;
    expect(command).toMatchObject({type:'task.update',payload:{id:state.tasks[0].id,expected_revision:1,progress:1}});
    state.tasks[0]={...state.tasks[0],progress:1,revision:2};
    return route.fulfill({json:{ok:true,id:state.tasks[0].id,request_id:command.request_id,replayed:false}});
  });
  const realtime=await realtimeFixture(page);
  try{
    await openTasks(page);
    await expect.poll(()=>realtime.connections).toBe(1);
    await expect.poll(()=>reads).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    const before=reads;
    await page.getByRole('button',{name:'Canlı görev görevini tamamla'}).click();
    await expect.poll(()=>writes).toBe(1);
    const undo=page.getByRole('button',{name:'Canlı görev tamamlamasını geri al'});
    await expect(undo).toBeEnabled({timeout:1000});
    realtime.dirty();
    // Longer than the quiet window: an unguarded refresh would restore progress0.
    await page.waitForTimeout(700);
    expect(reads).toBe(before);await expect(undo).toBeEnabled();
    releaseWrite();
    await expect.poll(()=>reads).toBeGreaterThan(before);
    await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
    await expect(undo).toBeEnabled();
    expect(state.tasks[0]).toMatchObject({progress:1,revision:2});
    await expect(page.locator('.notice.error[role="alert"]')).toHaveCount(0);
  }finally{releaseWrite();await realtime.close();}
});

for(const unavailable of ['disabled','error'] as const){
  test(`realtime ${unavailable} keeps the existing fallback state poll`,async({page})=>{
    const state=initialState();let reads=0;let streams=0;
    await page.clock.install();
    await page.route('**/api/state',route=>{reads++;return route.fulfill({json:state});});
    await page.route('**/api/realtime?*',route=>{
      const url=new URL(route.request().url());
      if(url.searchParams.get('session')!=='1')streams++;
      return route.fulfill(unavailable==='disabled'?{json:{enabled:false}}:
        {status:503,json:{ok:false,error:{code:'REALTIME_UNAVAILABLE',message:'Unavailable'}}});
    });
    await openTasks(page);
    await expect(page.getByRole('button',{name:'Canlı görev görevini tamamla'})).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
    const before=reads;
    state.tasks[0]={...state.tasks[0],title:'Periyodik kontrolde değişti',revision:2};
    await page.clock.runFor(30000);
    await expect(page.getByRole('button',{name:'Periyodik kontrolde değişti görevini tamamla'})).toBeVisible();
    expect(reads).toBeGreaterThan(before);expect(streams).toBe(0);
    await expect(page.locator('.notice.error[role="alert"]')).toHaveCount(0);
  });
}
