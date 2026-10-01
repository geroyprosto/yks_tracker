import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyState, type Task, type Topic} from '../src/lib/domain/types';
import type {CoachingPlan} from '../src/lib/coaching-plan';
import {prepareCoachingRun,receiptDirections} from '../src/lib/server/coaching';

const cutoff='2026-10-01T09:00:00Z';
const plan:CoachingPlan={source:{id:'owner-plan',title:'Kişisel Ekim planı',kind:'student_personalized'},
  daily_minutes:480,buffer_ratio:.15,milestones:[],months:[{month:'2026-10',targets:[
    {exam:'AYT',subject:'Matematik',topic_keywords:['Yönlü Açılar'],priority:'high'}]}]};
const angles:Topic={id:'angles',exam:'AYT',subject:'Matematik',name:'Yönlü Açılar',parent_id:null,mastery:0,
  notes:'',review_requested:false,source:'OGM',next_step:'',revision:1,updated_at:cutoff};
function task(id:string,date:string,priority:Task['priority'],minutes:number,progress=0):Task{
  return {id,title:id,plan_date:date,exam:'AYT',subject:'Matematik',topic_id:null,resource:'',completion_criteria:'',
    planned_minutes:minutes,difficulty:'medium',progress,weight_override:null,priority,position:0,notes:'',
    study_type:'Tekrar',steps:[],revision:1,created_at:cutoff,updated_at:cutoff};
}
function mockClient(sourceTasks:Task[],liveTasks:Task[],receiptTaskIds:string[]){
  const calls:{name:string;args:Record<string,unknown>}[]=[];
  const source={...emptyState(true),server_now:cutoff,topics:[angles],tasks:sourceTasks};
  const client={rpc:async(name:string,args:Record<string,unknown>)=>{
    calls.push({name,args});
    if(name==='coaching_run_begin')return {data:{run_id:'run-1',cutoff,previous_cutoff:null,previous_report_id:null,
      source_state:source,previous_metrics:null,plan,status:'running',report_id:'report-1'},error:null};
    if(name==='topic_review_reconcile')return {data:{results:[{title:'Parabol Pekiştirme',topic_id:'parabol',
      status:'created',task_ids:['review-1']}]},error:null};
    if(name==='analysis_source_state')return {data:{...source,tasks:liveTasks},error:null};
    if(name==='coaching_homework_create')return {data:{results:receiptTaskIds.length?[{title:'Yönlü Açılar',
      topic_id:'angles',status:'created',task_ids:receiptTaskIds,reason:'Kişisel plandaki konu açık.'}]:[]},error:null};
    throw new Error(`Unexpected RPC ${name}`);
  }} as unknown as Parameters<typeof prepareCoachingRun>[0];
  return {client,calls};
}

test('only persisted task receipts become directions',()=>{
  assert.deepEqual(receiptDirections([{title:'Denied',topic_id:'a',status:'failed',task_ids:[]},
    {title:'Created',topic_id:'b',status:'created',task_ids:['task-1'],reason:'Konu açık.'}]),
  [{title:'Created',topic_id:'b',text:'Konu açık.',task_ids:['task-1']}]);
});

test('orchestration freezes pre-assignment metrics and counts just-created reviews before homework',async()=>{
  const sourceTasks=[task('high-done','2026-09-30','high',30,1),task('high-open','2026-10-01','high',30)];
  const liveTasks=[...sourceTasks];
  for(let i=0;i<14;i++){
    const date=new Date(Date.UTC(2026,9,1+i,12)).toISOString().slice(0,10);
    liveTasks.push(task(`review-${i}`,date,'low',300));
  }
  const {client,calls}=mockClient(sourceTasks,liveTasks,[]);
  const result=await prepareCoachingRun(client,'owner-1','run-1','2026-09-18','2026-10-01');
  assert.deepEqual(calls.map(call=>call.name),['coaching_run_begin','topic_review_reconcile',
    'analysis_source_state','coaching_homework_create']);
  assert.equal(result.coaching.priority_summary.high.rate_percent,50);
  assert.equal(result.coaching.priority_summary.all.total,2);
  assert.equal((calls[3].args.p_candidates as unknown[]).length,0);
  assert.deepEqual(result.coaching.directions,[]);
  assert.ok(result.coaching.data_gaps.some(message=>message.includes('kapasite')));
});

test('orchestration proposes only real topic IDs and reports confirmed homework IDs',async()=>{
  const {client,calls}=mockClient([],[],['persisted-task-1']);
  const result=await prepareCoachingRun(client,'owner-1','run-1','2026-09-18','2026-10-01');
  const candidates=calls[3].args.p_candidates as Array<{topic_id:string;key:string;plan_date:string}>;
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].topic_id,'angles');
  assert.match(candidates[0].key,/angles:instruction$/);
  assert.deepEqual(result.coaching.directions,[{title:'Yönlü Açılar',text:'Kişisel plandaki konu açık.',
    topic_id:'angles',task_ids:['persisted-task-1']}]);
  assert.equal(result.coaching.context.current_cutoff,cutoff);
});

test('a busy run is rejected before reconciliation or any failure checkpoint',async()=>{
  const names:string[]=[];
  const fake={rpc:async(name:string)=>{names.push(name);return {data:null,error:{message:'COACHING_BUSY'}};}};
  const client=fake as unknown as Parameters<typeof prepareCoachingRun>[0];
  await assert.rejects(()=>prepareCoachingRun(client,'owner-1','run-2','2026-09-18','2026-10-01'),
    (error:unknown)=>typeof error==='object'&&error!==null&&'code' in error&&error.code==='COACHING_BUSY');
  assert.deepEqual(names,['coaching_run_begin']);
});

test('pending review writes stop before homework or a paid model request',async()=>{
  const calls:string[]=[];
  const source={...emptyState(true),server_now:cutoff};
  const client={rpc:async(name:string)=>{
    calls.push(name);
    if(name==='coaching_run_begin')return {data:{run_id:'run-1',cutoff,source_state:source,plan,status:'running'},error:null};
    if(name==='topic_review_reconcile')return {data:{results:[{status:'retry_pending',task_ids:[]}]},error:null};
    if(name==='coaching_run_fail')return {data:null,error:null};
    throw new Error('Later operations must not run');
  }} as unknown as Parameters<typeof prepareCoachingRun>[0];
  await assert.rejects(()=>prepareCoachingRun(client,'owner-1','run-1','2026-09-18','2026-10-01'),/AI hakkın kullanılmadı/);
  assert.deepEqual(calls,['coaching_run_begin','topic_review_reconcile','coaching_run_fail']);
});
