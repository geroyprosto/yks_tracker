import {expect,test,type Page} from '@playwright/test';
import {emptyState,type AppState,type Task} from '../../src/lib/domain/types';
import {localDate} from '../../src/lib/ui';

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
async function versionFixture(page:Page,state=initialState()){
  let reads=0;let checks=0;let version='initial';
  await page.clock.install();
  await page.route('**/api/state',route=>{reads++;return route.fulfill({json:state});});
  await page.route('**/api/realtime?*',route=>{
    expect(new URL(route.request().url()).searchParams.get('session')).toBe('1');
    checks++;return route.fulfill({json:{enabled:true,version}});
  });
  await page.addInitScript(()=>{
    window.EventSource=class extends EventSource {constructor(url:string|URL){super(url);throw new Error('Persistent connection opened');}};
  });
  await openTasks(page);
  await expect(page.getByRole('button',{name:'Canlı görev görevini tamamla'})).toBeVisible();
  await expect.poll(()=>checks).toBe(1);
  await page.clock.runFor(1000);
  await expect(page.locator('.sync-status')).toContainText('Hesabın güncel');
  return {state,get reads(){return reads;},get checks(){return checks;},dirty(){version+='-changed';}};
}
async function visibility(page:Page,value:'hidden'|'visible'){
  await page.evaluate(value=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value});
    document.dispatchEvent(new Event('visibilitychange'));
  },value);
}

test('short version checks skip unchanged state and load an external change',async({page})=>{
  const fixture=await versionFixture(page);const before=fixture.reads;
  await page.clock.runFor(30_000);
  await expect.poll(()=>fixture.checks).toBe(2);
  expect(fixture.reads).toBe(before);
  fixture.state.tasks[0]={...fixture.state.tasks[0],title:'Diğer oturumdan değişti',revision:2};
  fixture.dirty();await page.clock.runFor(30_000);
  await expect.poll(()=>fixture.checks).toBe(3);
  await page.clock.runFor(1000);
  await expect(page.getByRole('button',{name:'Diğer oturumdan değişti görevini tamamla'})).toBeVisible();
  expect(fixture.reads).toBe(before+1);
});

test('hidden and offline tabs do no version or state polling and catch up on return',async({page,context})=>{
  const fixture=await versionFixture(page);const reads=fixture.reads;const checks=fixture.checks;
  await visibility(page,'hidden');
  fixture.state.tasks[0]={...fixture.state.tasks[0],title:'Arka plandayken değişti',revision:2};fixture.dirty();
  await page.clock.runFor(600_000);
  expect(fixture.reads).toBe(reads);expect(fixture.checks).toBe(checks);
  await visibility(page,'visible');
  await expect.poll(()=>fixture.checks).toBe(checks+1);await page.clock.runFor(1000);
  await expect(page.getByRole('button',{name:'Arka plandayken değişti görevini tamamla'})).toBeVisible();
  const onlineChecks=fixture.checks;const onlineReads=fixture.reads;
  await context.setOffline(true);await page.clock.runFor(600_000);
  expect(fixture.checks).toBe(onlineChecks);expect(fixture.reads).toBe(onlineReads);
  await context.setOffline(false);
  await expect.poll(()=>fixture.checks).toBe(onlineChecks+1);
});

test('hiding before a queued version refresh defers the state read until the tab returns',async({page})=>{
  const fixture=await versionFixture(page);const reads=fixture.reads;
  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
  fixture.state.tasks[0]={...fixture.state.tasks[0],title:'Sekmeye dönünce güncel',revision:2};fixture.dirty();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect.poll(()=>fixture.checks).toBe(2);
  // The dirty hint has scheduled the dashboard's 500ms trailing state read.
  await expect(page.locator('.sync-status')).toContainText('Görünüm güncelleniyor');
  await visibility(page,'hidden');
  await page.clock.runFor(2000);
  expect(fixture.reads).toBe(reads);
  await visibility(page,'visible');
  await expect.poll(()=>fixture.checks).toBe(3);
  await page.clock.runFor(1000);
  await expect(page.getByRole('button',{name:'Sekmeye dönünce güncel görevini tamamla'})).toBeVisible();
  expect(fixture.reads).toBe(reads+1);
});

test('a changed version during a held save preserves the optimistic task until the queue settles',async({page})=>{
  const state=initialState();let writes=0;
  let releaseWrite!:()=>void;const heldWrite=new Promise<void>(resolve=>{releaseWrite=resolve;});
  await page.route('**/api/command',async route=>{
    const command=route.request().postDataJSON();writes++;
    await heldWrite;
    expect(command).toMatchObject({type:'task.update',payload:{id:state.tasks[0].id,expected_revision:1,progress:1}});
    state.tasks[0]={...state.tasks[0],progress:1,revision:2};
    return route.fulfill({json:{ok:true,id:state.tasks[0].id,request_id:command.request_id,replayed:false}});
  });
  const fixture=await versionFixture(page,state);
  try{
    const before=fixture.reads;
    await page.getByRole('button',{name:'Canlı görev görevini tamamla'}).click();
    await expect.poll(()=>writes).toBe(1);
    const undo=page.getByRole('button',{name:'Canlı görev tamamlamasını geri al'});
    await expect(undo).toBeEnabled();
    fixture.dirty();await page.clock.runFor(30_000);
    await expect.poll(()=>fixture.checks).toBe(2);await page.clock.runFor(1000);
    expect(fixture.reads).toBe(before);await expect(undo).toBeEnabled();
    releaseWrite();await expect(page.locator('.sync-status')).not.toContainText('Kaydediliyor');
    await page.clock.runFor(1000);
    await expect.poll(()=>fixture.reads).toBeGreaterThan(before);
    await expect(undo).toBeEnabled();expect(state.tasks[0]).toMatchObject({progress:1,revision:2});
  }finally{releaseWrite();}
});

for(const unavailable of ['disabled','error'] as const){
  test(`version check ${unavailable} uses slower visible-only fallback reads`,async({page})=>{
    const state=initialState();let reads=0;
    await page.clock.install();
    await page.route('**/api/state',route=>{reads++;return route.fulfill({json:state});});
    await page.route('**/api/realtime?*',route=>route.fulfill(unavailable==='disabled'?{json:{enabled:false}}:
      {status:503,json:{error:{code:'REALTIME_UNAVAILABLE'}}}));
    await openTasks(page);
    await expect(page.getByRole('button',{name:'Canlı görev görevini tamamla'})).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-realtime-status',unavailable);
    const before=reads;
    state.tasks[0]={...state.tasks[0],title:'Yedek kontrolde değişti',revision:2};
    await page.clock.runFor(30_000);expect(reads).toBe(before);
    await page.clock.runFor(91_000);await page.clock.runFor(1000);
    await expect(page.getByRole('button',{name:'Yedek kontrolde değişti görevini tamamla'})).toBeVisible();
    expect(reads).toBeGreaterThan(before);
    await visibility(page,'hidden');const hiddenReads=reads;
    await page.clock.runFor(600_000);expect(reads).toBe(hiddenReads);
  });
}
