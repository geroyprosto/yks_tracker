import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyState,type StudySession} from '../src/lib/domain/types';
import {buildStudyReport,studyReportRange} from '../src/lib/study-report';

function session(id:string,started_at:string,seconds:number):StudySession{
 return {id,title:id,task_id:null,topic_id:null,subject:'Matematik',study_type:'Soru çözümü',mode:'stopwatch',target_seconds:null,status:'finished',started_at,active_since:null,accumulated_seconds:seconds,finished_at:new Date(Date.parse(started_at)+seconds*1000).toISOString(),revision:1};
}
test('gün, hafta, ay, yıl başlangıçları İstanbul yerel takvimine göre seçilir',()=>{
 assert.deepEqual(studyReportRange('week','2026-09-24'),{start:'2026-09-21',end:'2026-09-24'});
 assert.deepEqual(studyReportRange('month','2026-09-24'),{start:'2026-09-01',end:'2026-09-24'});
 assert.deepEqual(studyReportRange('year','2026-09-24'),{start:'2026-01-01',end:'2026-09-24'});
});
test('dinlenme, doğrulanmış sıfır, eksik ve açık gün ayrılır; ortalamalar eksik günü sıfır saymaz',()=>{
 const state={...emptyState(),server_now:'2026-09-24T10:00:00Z',
  sessions:[session('wed','2026-09-23T09:00:00Z',3600),session('thu','2026-09-24T07:00:00Z',1800)],
  intervals:[{id:'i1',session_id:'wed',started_at:'2026-09-23T09:00:00Z',ended_at:'2026-09-23T10:00:00Z'},{id:'i2',session_id:'thu',started_at:'2026-09-24T07:00:00Z',ended_at:'2026-09-24T07:30:00Z'}],
  day_plans:[{id:'p',plan_date:'2026-09-23',version:1,target_minutes:60,task_share:.7,difficulty_factors:{easy:1,medium:1.25,hard:1.5},snapshot:[],changed_at:'2026-09-23T08:00:00Z'}],
  day_marks:[{id:'r',mark_date:'2026-09-21',kind:'rest' as const,revision:1,created_at:'2026-09-21T00:00:00Z',updated_at:'2026-09-21T00:00:00Z'},{id:'z',mark_date:'2026-09-22',kind:'zero' as const,revision:1,created_at:'2026-09-22T00:00:00Z',updated_at:'2026-09-22T00:00:00Z'}]};
 const report=buildStudyReport(state,{start:'2026-09-20',end:'2026-09-24'});
 assert.deepEqual(report.days.map(day=>day.status),['missing','rest','zero','worked','ongoing']);
 assert.equal(report.totalSeconds,5400);
 assert.equal(report.averageAllSeconds,1800);
 assert.equal(report.averageWorkedSeconds,3600);
 assert.deepEqual([report.workedDays,report.goalMetDays,report.restDays,report.zeroDays,report.missingDays],[2,1,1,1,1]);
 assert.deepEqual(report.subjects,[{label:'Matematik',seconds:5400}]);
 assert.equal(report.highestDay?.date,'2026-09-23');
});
