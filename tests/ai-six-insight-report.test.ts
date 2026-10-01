import assert from 'node:assert/strict';
import test from 'node:test';
import {REPORT_HEADINGS, REPORT_SCHEMA_VERSION, validateStructuredReport} from '../src/lib/ai-report';
import {providerPayload,REPORT_INSTRUCTIONS} from '../src/lib/server/analysis-provider';
import {buildSixInsightSnapshot, buildStudentAnalysisSnapshot} from '../src/lib/analysis-snapshot';
import {emptyState} from '../src/lib/domain/types';
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

test('report instructions map every section and keep diary, comparison, and calendar claims conditional',()=>{
  for(const key of ['topics','regularity','journal','wins','improvements','timing'])assert.match(REPORT_INSTRUCTIONS,new RegExp(key));
  assert.match(REPORT_INSTRUCTIONS,/Kasım.*zorunlu/);
  assert.match(REPORT_INSTRUCTIONS,/sebep-sonuç/);
  assert.match(REPORT_INSTRUCTIONS,/as_of/);
  assert.match(REPORT_INSTRUCTIONS,/günlük/);
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
