import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCoachingReportMetrics, formatHoursMinutes} from '../src/lib/coaching-report';
import {emptyState, type ExamRecord, type JournalEntry, type Task} from '../src/lib/domain/types';

const stamp='2026-10-01T09:00:00Z';
function task(id:string,plan_date:string,priority:Task['priority'],done:boolean,subject='Matematik',exam:Task['exam']='TYT'):Task{
  return {id,title:id,plan_date,exam,subject,topic_id:null,resource:'',completion_criteria:'',planned_minutes:30,
    difficulty:'medium',progress:done?1:0,weight_override:null,priority,position:0,notes:'',study_type:'Soru çözümü',
    steps:[],revision:1,created_at:stamp,updated_at:stamp};
}
function journal(id:string,date:string,fields:JournalEntry['structured_fields'],shared=Object.keys(fields)):JournalEntry{
  return {id,journal_date:date,original_text:'Özel metin',structured_fields:fields,exclude_from_analysis:false,
    ai_shared_fields:shared,revision:1,created_at:stamp,updated_at:stamp};
}
function day(date:string,offset:number){const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10)}
function tytExam():ExamRecord{
  const sections=[
    {key:'turkce',label:'Türkçe',question_count:40},
    {key:'tarih',label:'Tarih',question_count:5},
    {key:'cografya',label:'Coğrafya',question_count:5},
    {key:'felsefe',label:'Felsefe',question_count:5},
    {key:'din',label:'Din',question_count:5},
    {key:'matematik',label:'Matematik',question_count:40},
  ];
  return {id:'exam-1',name:'TYT 1',publisher:'',exam_date:'2026-09-30',format_code:'TYT',format_version:1,
    format_snapshot:{code:'TYT',version:1,label:'TYT',total_questions:100,wrong_divisor:4,sections},duration_minutes:null,
    notes:'',score:null,rank:null,source_document_id:null,import_metadata:null,
    results:[{section_key:'tarih',correct:5,wrong:0,blank:0,net:5},{section_key:'cografya',correct:0,wrong:0,blank:5,net:0},
      {section_key:'felsefe',correct:5,wrong:0,blank:0,net:5},{section_key:'din',correct:4,wrong:0,blank:1,net:4}],
    reported_total_net:null,total_net:null,total_net_source:null,revision:1,created_at:stamp,updated_at:stamp};
}

test('weekly high priority denominator includes the full Monday–Sunday cohort; future tasks are not overdue',()=>{
  const state=emptyState(true);
  state.tasks=[...Array.from({length:5},(_,n)=>task(`done-${n}`,'2026-09-30','high',true)),
    task('overdue-1','2026-09-30','high',false),task('today','2026-10-01','high',false),
    task('future','2026-10-04','high',false),task('normal','2026-10-01','normal',true)];
  const metrics=buildCoachingReportMetrics(state,{cutoff:stamp});
  assert.equal(metrics.context.week_start,'2026-09-28');
  assert.equal(metrics.context.week_end,'2026-10-04');
  assert.deepEqual(metrics.priority_summary.high,{done:5,total:8,remaining:3,rate_percent:62.5});
  assert.deepEqual(metrics.priority_summary.all,{done:6,total:9,remaining:3,rate_percent:66.7});
  assert.equal(metrics.priority_summary.completed_high_share_percent,83.3);
  assert.deepEqual(metrics.priority_summary.overdue,{high:1,count:1,task_ids:['overdue-1']});
  assert.equal(metrics.retrospective_changes.length,0);
});

test('zero denominator stays null and a prior report at a different week position is not compared',()=>{
  const before=buildCoachingReportMetrics(emptyState(true),{cutoff:'2026-09-23T09:00:00Z'});
  const metrics=buildCoachingReportMetrics(emptyState(true),{cutoff:stamp,previous:before,previousAnalysisId:'report-1'});
  assert.equal(metrics.priority_summary.high.rate_percent,null);
  assert.equal(metrics.priority_summary.completed_high_share_percent,null);
  assert.equal(metrics.context.previous_analysis_id,'report-1');
  assert.deepEqual(metrics.retrospective_changes,[]);
});

test('comparable frozen snapshots produce percentage point changes with evidence IDs',()=>{
  const earlier=emptyState(true);
  earlier.tasks=[task('p1','2026-09-21','high',true),task('p2','2026-09-22','high',false)];
  const prior=buildCoachingReportMetrics(earlier,{cutoff:'2026-09-24T09:00:00Z'});
  const current=emptyState(true);
  current.tasks=[task('c1','2026-09-28','high',true),task('c2','2026-09-29','high',true),
    task('c3','2026-09-30','high',true),task('c4','2026-10-01','high',false)];
  const metrics=buildCoachingReportMetrics(current,{cutoff:stamp,previous:prior,previousAnalysisId:'prior-id'});
  assert.deepEqual(metrics.retrospective_changes[0],{metric:'high_priority_rate',previous:50,current:75,
    difference:25,unit:'percentage_points',evidence_ids:['prior-id',`cutoff:${stamp}`]});
});

test('diary cards use account opt-in, actual matched study days, and conservative thresholds',()=>{
  const state=emptyState(true);state.settings={display_name:'',exam_year:2027,exam_date:null,target_rank:null,
    timezone:'Europe/Istanbul',daily_target_minutes:480,task_share:.5,difficulty_factors:{easy:1,medium:1,hard:1},
    weekday_targets:[],theme:'graphite',appearance:'dark',reduced_motion:false,simple_view:false,journal_analysis_enabled:true,revision:1};
  for(let i=0;i<14;i++){
    const date=day('2026-09-18',i),early=i<7;
    state.journal_entries.push(journal(`j${i}`,date,{wake_at:early?'07:00':'10:00',stress:early?1:5,
      sleep_at:early?'23:00':'05:00',mood:early?'iyi':'kötü'}));
    state.manual_study_entries!.push({id:`s${i}`,study_date:date,subject:'Matematik',duration_seconds:early?7200:3600,created_at:stamp});
  }
  state.journal_entries[0].ai_shared_fields=[];
  state.journal_entries[0].exclude_from_analysis=true;
  const metrics=buildCoachingReportMetrics(state,{cutoff:stamp,start:'2026-09-18',end:'2026-10-01'});
  const wake=metrics.diary_insights.find(item=>item.kind==='early_wake')!;
  assert.equal(wake.type,'association');
  assert.equal(wake.matched_days,14);
  assert.equal(wake.group_a.count,7);
  assert.equal(wake.group_a.average_seconds,7200);
  assert.equal(wake.group_b.average_seconds,3600);
  assert.equal(metrics.diary_insights.find(item=>item.kind==='sleep')!.type,'association');
  assert.equal(metrics.diary_insights.find(item=>item.kind==='mood')!.type,'association');
  assert.equal(metrics.diary_observations.length,3);
  assert.ok(!JSON.stringify(metrics).includes('Özel metin'));
  assert.equal(formatHoursMinutes(44817),'12 sa 27 dk');
});

test('sparse diary data remains observation and unknown exam sections never become zero',()=>{
  const state=emptyState(true);state.settings={display_name:'',exam_year:2027,exam_date:null,target_rank:null,
    timezone:'Europe/Istanbul',daily_target_minutes:480,task_share:.5,difficulty_factors:{easy:1,medium:1,hard:1},
    weekday_targets:[],theme:'graphite',appearance:'dark',reduced_motion:false,simple_view:false,journal_analysis_enabled:true,revision:1};
  state.journal_entries=[journal('j','2026-09-30',{wake_at:'07:00',stress:5,mood:'iyi'}),
    journal('without-study','2026-09-29',{wake_at:'09:00'})];
  state.journal_entries[0].ai_shared_fields=[];
  state.manual_study_entries=[{id:'s',study_date:'2026-09-30',subject:'Matematik',duration_seconds:9900,created_at:stamp}];
  state.exams=[tytExam()];
  const metrics=buildCoachingReportMetrics(state,{cutoff:stamp,start:'2026-09-18',end:'2026-10-01'});
  assert.ok(metrics.diary_insights.every(item=>item.type==='observation'));
  assert.equal(metrics.diary_insights.find(item=>item.kind==='early_wake')!.matched_days,1);
  assert.match(metrics.diary_insights.find(item=>item.kind==='stress')!.text,/2026-09-30.*stres 5\/5.*2 sa 45 dk/);
  assert.deepEqual(metrics.diary_observations,[{date:'2026-09-30',text:'07:00 kalkış, stres 5/5, olumlu ruh hâli',
    study_label:'2 sa 45 dk'}]);
  assert.equal(metrics.weekly_exam.TYT.exams[0].sections.length,4);
  assert.equal(metrics.weekly_exam.TYT.exams[0].total_net,null);
  assert.ok(metrics.weekly_exam.TYT.warnings.some(text=>text.includes('Coğrafya')));
});

test('disabled account diary analysis exposes neither observations nor structured field values',()=>{
  const state=emptyState(true);
  state.journal_entries=[journal('j','2026-09-30',{wake_at:'10:08',stress:5,mood:'iyi'})];
  state.manual_study_entries=[{id:'s',study_date:'2026-09-30',subject:'Matematik',duration_seconds:9900,created_at:stamp}];
  const metrics=buildCoachingReportMetrics(state,{cutoff:stamp});
  assert.deepEqual(metrics.diary_observations,[]);
  assert.ok(metrics.diary_insights.every(item=>item.matched_days===0));
  assert.ok(!JSON.stringify(metrics).includes('10:08'));
});
