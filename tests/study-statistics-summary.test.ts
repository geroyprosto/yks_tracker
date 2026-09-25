import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyState,type AppState,type StudySession,type Task} from '../src/lib/domain/types';
import {buildStudyStatisticsSummary} from '../src/lib/study-statistics-summary';

function session(id:string,started_at:string,seconds:number):StudySession{
 return {id,title:id,task_id:null,topic_id:null,subject:'Matematik',study_type:'Soru çözümü',mode:'stopwatch',target_seconds:null,status:'finished',started_at,active_since:null,accumulated_seconds:seconds,finished_at:new Date(Date.parse(started_at)+seconds*1000).toISOString(),revision:1};
}
function task(plan_date:string,progress:number):Task{
 return {id:plan_date+progress,title:'Görev',plan_date,progress,exam:null,subject:null,topic_id:null,resource:'',completion_criteria:'',planned_minutes:30,difficulty:'medium',weight_override:null,priority:'normal',position:0,notes:'',study_type:'Tekrar',steps:[],revision:1,created_at:'2026-09-01T09:00:00Z',updated_at:'2026-09-24T09:00:00Z'};
}
function withSessions(state:AppState,sessions:StudySession[]):AppState{
 return {...state,sessions,intervals:sessions.map(s=>({id:`i-${s.id}`,session_id:s.id,started_at:s.started_at,ended_at:s.finished_at}))};
}

test('six summary metrics include all-time, current week, and saved time today',()=>{
 const state=withSessions({...emptyState(),server_now:'2026-09-24T10:00:00Z',tasks:[
  task('2026-01-01',1),task('2026-09-20',1),task('2026-09-21',1),task('2026-09-24',1),task('2026-09-24',.5),
 ]},[
  session('past','2025-12-01T09:00:00Z',7200),session('sun','2026-09-20T09:00:00Z',3600),
  session('mon','2026-09-21T09:00:00Z',1800),session('today','2026-09-24T09:00:00Z',2700),
 ]);
 assert.deepEqual(buildStudyStatisticsSummary(state),{
  totalSeconds:15300,weekSeconds:4500,todaySeconds:2700,completedTasks:4,weekCompletedTasks:2,todayCompletedTasks:1,today:'2026-09-24',weekStart:'2026-09-21',
 });
});

test('week boundary and midnight split follow the configured local calendar',()=>{
 const state=withSessions({...emptyState(),server_now:'2026-01-04T21:30:00Z',tasks:[task('2026-01-04',1),task('2026-01-05',1)]},[
  session('overnight','2026-01-04T20:30:00Z',3600),
 ]);
 assert.deepEqual(buildStudyStatisticsSummary(state),{
  totalSeconds:3600,weekSeconds:1800,todaySeconds:1800,completedTasks:2,weekCompletedTasks:1,todayCompletedTasks:1,today:'2026-01-05',weekStart:'2026-01-05',
 });
});

test('current countdown interval is included only up to its target',()=>{
 const now=Date.parse('2026-09-24T10:00:00Z');
 const current={...session('active','2026-09-24T09:00:00Z',0),status:'running' as const,mode:'countdown' as const,target_seconds:2700,active_since:'2026-09-24T09:00:00Z',finished_at:null};
 const state=withSessions({...emptyState(),server_now:new Date(now).toISOString()},[current]);
 const summary=buildStudyStatisticsSummary(state);
 assert.equal(summary.todaySeconds,2700);
 assert.equal(summary.weekSeconds,2700);
 assert.equal(summary.totalSeconds,2700);
});

test('empty history is zero without dividing by recorded days',()=>{
 const state={...emptyState(),server_now:'2026-09-24T10:00:00Z'};
 const summary=buildStudyStatisticsSummary(state);
 assert.equal(summary.totalSeconds,0);
 assert.equal(summary.weekSeconds,0);
 assert.equal(summary.todaySeconds,0);
 assert.equal(summary.completedTasks,0);
});
