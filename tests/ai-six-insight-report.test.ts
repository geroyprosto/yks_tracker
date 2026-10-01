import assert from 'node:assert/strict';
import test from 'node:test';
import {REPORT_HEADINGS, REPORT_SCHEMA_VERSION, validateStructuredReport} from '../src/lib/ai-report';
import {providerPayload,REPORT_INSTRUCTIONS} from '../src/lib/server/analysis-provider';
import {buildSixInsightSnapshot, buildStudentAnalysisSnapshot} from '../src/lib/analysis-snapshot';
import {emptyState, type Task} from '../src/lib/domain/types';
import {defaultModules,emptyEducation} from '../src/lib/education';

const card=(headline:string,text:string,evidence_ids:string[]=[])=>({headline,text,evidence_ids,course_id:null});
const report={schema_version:3,topics:card('Konu kaydı','Bir konu tamamlandı.',['day:2026-11-10']),
  regularity:card('Kayıtlı günler','İki gün çalışma kaydı var.',['day:2026-11-10']),
  journal:card('Günlük notu','Geç kalkılan gün daha kısa çalışılmış; ilişkiyi kesin neden sayma.',['day:2026-11-10']),
  wins:card('Geçen döneme göre','Kayıtlı süre artmış.',['day:2026-11-10']),
  improvements:card('Küçük adım','İki çalışma gününe kısa tekrar ekle.',['day:2026-11-10']),
  timing:card('Dönem önerisi','Konu eksiklerine göre bir mini denemeyi değerlendir.')};

test('six required cards have strict, bounded text and verified evidence',()=>{
  assert.equal(REPORT_SCHEMA_VERSION,3);
  assert.equal(REPORT_HEADINGS.length,6);
  assert.deepEqual(validateStructuredReport(report,['day:2026-11-10'],[]),report);
  assert.throws(()=>validateStructuredReport({...report,journal:undefined},['day:2026-11-10'],[]));
  assert.throws(()=>validateStructuredReport({...report,topics:{...report.topics,text:'x '.repeat(61)}},['day:2026-11-10'],[]));
  assert.throws(()=>validateStructuredReport(report,[],[]));
});

test('current coach instructions use saved plan and verified metrics while retaining legacy validation separately',()=>{
  for(const key of ['annual_plan','coaching.context.current_cutoff','priority_summary','homework_results',
    'repetition_results','diary_insights','weekly_exam'])assert.match(REPORT_INSTRUCTIONS,new RegExp(key.replaceAll('.','\\.')));
  assert.match(REPORT_INSTRUCTIONS,/Kasım.*zorunlu/);
  assert.match(REPORT_INSTRUCTIONS,/sebep-sonuç/);
  assert.match(REPORT_INSTRUCTIONS,/En çok üç directions/);
  assert.match(REPORT_INSTRUCTIONS,/Şimdi 20 soru çöz.*verme/);
  assert.match(REPORT_INSTRUCTIONS,/Eski topics, regularity, journal, wins, improvements, timing kartlarını üretme/);
});

test('oversized prompts are rejected before any journal excerpt is dropped',()=>{
  const days=Array.from({length:16},(_,index)=>({date:`2026-11-${String(index+1).padStart(2,'0')}`,
    journal:{date:`2026-11-${String(index+1).padStart(2,'0')}`,fields:{original_text:`Late wake ${index}. `+'x'.repeat(10000)}}}));
  assert.throws(()=>providerPayload({period:{start:'2026-11-01',end:'2026-11-16'},summary:{data_days:16},days}),/daha kısa bir dönem seç/);
  const short=providerPayload({period:{start:'2026-11-15',end:'2026-11-16'},summary:{data_days:2},days:days.slice(-2)});
  assert.ok(short.includes('Late wake 14'));
  assert.ok(short.includes('Late wake 15'));
});

test('six insight snapshot uses dated topic transitions, shared journals, comparable prior period, and frozen guidance date',()=>{
  const state=emptyState(true);
  state.server_now='2026-11-16T12:00:00Z';
  state.settings={journal_analysis_enabled:true} as typeof state.settings;
  state.topics=[{id:'algebra',exam:'TYT',subject:'Matematik',name:'Denklemler',parent_id:null,mastery:2,notes:'private',review_requested:false,source:'user',next_step:'',revision:2,updated_at:'2026-11-10T12:00:00Z'},
    {id:'geometry',exam:'TYT',subject:'Matematik',name:'Üçgenler',parent_id:null,mastery:2,notes:'private',review_requested:false,source:'user',next_step:'',revision:1,updated_at:'2026-11-01T12:00:00Z'}];
  state.topic_history=[{id:'h1',topic_id:'algebra',old_mastery:1,new_mastery:2,changed_at:'2026-11-10T12:00:00Z'},
    {id:'h2',topic_id:'geometry',old_mastery:0,new_mastery:2,changed_at:'2026-11-01T12:00:00Z'}];
  state.manual_study_entries=[{id:'before',study_date:'2026-11-03',subject:'Matematik',duration_seconds:3600,created_at:'2026-11-03T12:00:00Z'},
    {id:'now',study_date:'2026-11-10',subject:'Matematik',duration_seconds:7200,created_at:'2026-11-10T12:00:00Z'}];
  state.journal_entries=[{id:'j1',journal_date:'2026-11-10',original_text:'Bugün geç kalktım.',structured_fields:{wake_at:'10:30'},exclude_from_analysis:false,ai_shared_fields:['original_text','wake_at'],revision:1,created_at:'2026-11-10T12:00:00Z',updated_at:'2026-11-10T12:00:00Z'},
    {id:'j2',journal_date:'2026-11-11',original_text:'GİZLİ GÜNLÜK',structured_fields:{wake_at:'07:00'},exclude_from_analysis:false,ai_shared_fields:['wake_at'],revision:1,created_at:'2026-11-11T12:00:00Z',updated_at:'2026-11-11T12:00:00Z'}];
  const legacy=buildStudentAnalysisSnapshot(state,'2026-11-09','2026-11-15');
  assert.equal(legacy.snapshot.schema_version,2);
  const {snapshot,sourceHash}=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15');
  assert.equal(snapshot.schema_version,3);
  assert.deepEqual(snapshot.topic_progress.map(topic=>topic.id),['algebra']);
  assert.equal(snapshot.report_metrics.topics.completed,1);
  assert.equal(snapshot.report_metrics.topics.progressed,1);
  assert.equal(snapshot.report_metrics.wins.previous.study_seconds,3600);
  assert.equal(snapshot.report_metrics.wins.current.study_seconds,7200);
  assert.equal(snapshot.report_metrics.journal.shared_day_count,2);
  assert.equal(snapshot.timing_guidance.as_of,'2026-11-16');
  assert.equal(snapshot.timing_guidance.exam_date_source,null);
  assert.equal(snapshot.report_metrics.timing.phase,'Takvime göre temel ve düzen (örnek)');
  assert.ok(JSON.stringify(snapshot).includes('Bugün geç kalktım.'));
  assert.ok(JSON.stringify(snapshot).includes('GİZLİ GÜNLÜK'));
  assert.ok(!JSON.stringify(snapshot).includes('private'));
  assert.equal(snapshot.report_metrics.regularity.days.find(day=>day.date==='2026-11-11')?.seconds,null);
  state.server_now='2026-11-17T12:00:00Z';
  assert.equal(buildSixInsightSnapshot(state,'2026-11-09','2026-11-15','2026-11-16').sourceHash,sourceHash);
});

test('non-YKS students do not receive a YKS seasonal phase or source playbook',()=>{
  const state=emptyState(true);
  state.server_now='2026-11-16T12:00:00Z';
  state.education={...emptyEducation(),profile:{education_level:'university',yks_goal:false,grade:null,
    department:'İktisat',university_year:'1',yks_track:'undecided',modules:defaultModules,
    active_term_id:'fall',revision:1,onboarding_completed_at:state.server_now}};
  const {snapshot}=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15');
  assert.equal(snapshot.timing_guidance.phase,'Ders planı ve düzen');
  assert.deepEqual(snapshot.timing_guidance.sources,[]);
});

test('a configured YKS date is identified as a user planning date rather than an official exam date',()=>{
  const state=emptyState(true);
  state.server_now='2026-11-16T12:00:00Z';
  state.settings={exam_date:'2027-06-15',target_rank:1000} as typeof state.settings;
  const {snapshot}=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15');
  assert.equal(snapshot.timing_guidance.exam_date,'2027-06-15');
  assert.equal(snapshot.timing_guidance.exam_date_source,'user_setting');
  assert.equal(snapshot.timing_guidance.target_rank,1000);
});

test('current topic status gives subject totals and concrete unfinished next topics without private notes',()=>{
  const state=emptyState(true);
  state.server_now='2026-11-18T12:00:00Z';
  state.topics=[
    {id:'functions',exam:'TYT',subject:'Matematik',name:'Fonksiyonlar',parent_id:null,mastery:1,notes:'gizli konu notu',review_requested:false,source:'user',next_step:'Kalan anlatımı tamamla',revision:1,updated_at:'2026-09-01T12:00:00Z'},
    {id:'polynomials',exam:'TYT',subject:'Matematik',name:'Polinomlar',parent_id:null,mastery:0,notes:'',review_requested:false,source:'user',next_step:'',revision:1,updated_at:'2026-09-01T12:00:00Z'},
    {id:'sets',exam:'TYT',subject:'Matematik',name:'Kümeler',parent_id:null,mastery:4,notes:'',review_requested:false,source:'user',next_step:'',revision:1,updated_at:'2026-09-01T12:00:00Z'},
    {id:'equilibrium',exam:'AYT',subject:'Kimya',name:'Kimyasal Denge',parent_id:null,mastery:2,notes:'',review_requested:true,source:'user',next_step:'Bağımsız soru çöz',revision:1,updated_at:'2026-09-01T12:00:00Z'},
  ];
  const {snapshot}=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15');
  const math=snapshot.topic_status_by_subject.find(row=>row.exam==='TYT'&&row.subject==='Matematik');
  assert.deepEqual(math?.mastery_counts,{not_started:1,learning:1,instruction_finished:0,solving_questions:0,mastered:1});
  assert.equal(math?.total,3);
  assert.deepEqual(math?.next_topics.map(topic=>topic.id),['functions','polynomials']);
  assert.equal(math?.next_topics[0].next_step,'Kalan anlatımı tamamla');
  assert.equal(math?.omitted_next_topics_count,0);
  assert.deepEqual(snapshot.topic_status_by_subject.find(row=>row.exam==='AYT')?.next_topics.map(topic=>topic.id),['equilibrium']);
  assert.ok(!JSON.stringify(snapshot).includes('gizli konu notu'));
});

test('a recently updated active topic remains visible beyond five older alphabetical topics',()=>{
  const state=emptyState(true);
  state.server_now='2026-11-18T12:00:00Z';
  state.topics=['A','B','C','D','E','Z'].map((name,index)=>({id:name,exam:'AYT' as const,
    subject:'Matematik',name,parent_id:null,mastery:1,notes:'',review_requested:false,
    source:'user',next_step:'',revision:1,
    updated_at:index===5?'2026-11-17T12:00:00Z':'2026-09-01T12:00:00Z'}));
  const {snapshot}=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15');
  const math=snapshot.topic_status_by_subject.find(row=>row.exam==='AYT'&&row.subject==='Matematik');
  assert.equal(math?.next_topics[0].id,'Z');
  assert.equal(math?.next_topics.length,5);
  assert.equal(math?.omitted_next_topics_count,1);
});

test('task completion rates distinguish priority, subject and the as-of Monday to Sunday week',()=>{
  const state=emptyState(true);
  state.server_now='2026-11-18T12:00:00Z';
  const task=(id:string,plan_date:string,exam:'TYT'|'AYT',subject:string,priority:'low'|'normal'|'high',progress:number):Task=>
    ({id,title:id,plan_date,exam,subject,priority,progress,steps:[],course_id:null,topic_id:null,
      resource:'',completion_criteria:'',planned_minutes:30,difficulty:'medium',weight_override:null,
      position:0,notes:'',study_type:'Soru çözümü',revision:1,
      created_at:`${plan_date}T12:00:00Z`,updated_at:`${plan_date}T12:00:00Z`});
  state.tasks=[
    task('prior-high','2026-11-10','TYT','Matematik','high',1),
    task('prior-normal','2026-11-11','TYT','Matematik','normal',0),
    task('high-done','2026-11-16','TYT','Matematik','high',1),
    task('high-open','2026-11-17','TYT','Matematik','high',0),
    task('high-partial','2026-11-18','TYT','Matematik','high',0.5),
    task('normal-done','2026-11-18','TYT','Matematik','normal',1),
    task('low-done','2026-11-19','TYT','Kimya','low',1),
    task('physics-high','2026-11-20','AYT','Fizik','high',1),
  ];
  const {snapshot}=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15','2026-11-18');
  assert.deepEqual({start:snapshot.weekly_task_priority.week_start,end:snapshot.weekly_task_priority.week_end},
    {start:'2026-11-16',end:'2026-11-22'});
  assert.equal(snapshot.weekly_task_priority.observed_through,'2026-11-18');
  const mathHigh=snapshot.weekly_task_priority.by_subject.find(row=>row.exam==='TYT'&&row.subject==='Matematik'&&row.priority==='high');
  assert.deepEqual(mathHigh,{exam:'TYT',subject:'Matematik',priority:'high',total:3,done:1,completion_rate_percent:33.3});
  assert.equal(snapshot.weekly_task_priority.overall.high.total,3);
  assert.equal(snapshot.weekly_task_priority.overall.high.done,1);
  assert.equal(snapshot.weekly_task_priority.overall.high.completion_rate_percent,33.3);
  assert.equal(snapshot.weekly_task_priority.overall.high.share_of_completed_percent,50);
  assert.equal(snapshot.weekly_task_priority.overall.total_done,2);
  assert.equal(snapshot.weekly_task_priority.past_due.through,'2026-11-17');
  assert.equal(snapshot.weekly_task_priority.past_due.overall.high.total,2);
  assert.equal(snapshot.weekly_task_priority.past_due.overall.high.done,1);
  assert.equal(snapshot.weekly_task_priority.past_due.overall.high.completion_rate_percent,50);
  assert.equal(snapshot.weekly_task_priority.by_subject.some(row=>row.subject==='Fizik'||row.subject==='Kimya'),false);
  assert.deepEqual(snapshot.task_priority_by_subject.find(row=>row.priority==='high'),
    {exam:'TYT',subject:'Matematik',priority:'high',total:1,done:1,completion_rate_percent:100});
  assert.equal(snapshot.report_metrics.improvements.priority.high.total,1);
  state.server_now='2026-11-16T12:00:00Z';
  state.tasks=[task('today-open','2026-11-16','TYT','Matematik','high',0)];
  const monday=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15').snapshot;
  assert.equal(monday.weekly_task_priority.overall.high.total,1);
  assert.equal(monday.weekly_task_priority.past_due.overall.high.total,0);
  assert.equal(monday.weekly_task_priority.past_due.overall.high.completion_rate_percent,null);
});

test('priority rates use null instead of claiming a percentage without a denominator',()=>{
  const state=emptyState(true);
  state.server_now='2026-11-18T12:00:00Z';
  const {snapshot}=buildSixInsightSnapshot(state,'2026-11-09','2026-11-15');
  assert.equal(snapshot.weekly_task_priority.overall.high.completion_rate_percent,null);
  assert.equal(snapshot.weekly_task_priority.overall.high.share_of_completed_percent,null);
  assert.equal(snapshot.report_metrics.improvements.priority.high.completion_rate_percent,null);
});
