import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildWeeklyHomeworkCandidates, SUMEYRA_2027_PLAN, type CoachingPlan} from '../src/lib/coaching-plan';
import {buildCoachingReportMetrics} from '../src/lib/coaching-report';
import {emptyState, type ExamRecord, type Task, type Topic} from '../src/lib/domain/types';

const now='2026-10-01T09:00:00Z';
const tinyPlan:CoachingPlan={source:{id:'owner-plan',title:'Kişisel plan',kind:'student_personalized'},
  daily_minutes:480,buffer_ratio:.15,milestones:[],months:[{month:'2026-10',targets:[
    {exam:'AYT',subject:'Kimya',topic_keywords:['Sıvı Çözeltiler ve Çözünürlük'],priority:'high',
      prerequisites:[{exam:'TYT',subject:'Kimya',topic_keywords:['Kimyanın Temel Kanunları ve Mol Kavramı']},
        {exam:'TYT',subject:'Kimya',topic_keywords:['Kimyasal Tepkimeler - Kimyasal Tepkimelerde Hesaplamalar']}]},
  ]}]};
function topic(id:string,exam:Topic['exam'],subject:string,name:string,mastery:number,review_requested=false):Topic{
  return {id,exam,subject,name,parent_id:null,mastery,notes:'',review_requested,source:'OGM',next_step:'',revision:1,updated_at:now};
}
function task(id:string,date:string,topicId:string|null,minutes:number,studyType:Task['study_type']='Tekrar'):Task{
  return {id,title:id,plan_date:date,exam:'TYT',subject:'Kimya',topic_id:topicId,resource:'',completion_criteria:'',
    planned_minutes:minutes,difficulty:'medium',progress:0,weight_override:null,priority:'low',position:0,notes:'',
    study_type:studyType,steps:[],revision:1,created_at:now,updated_at:now};
}
function run(plan=tinyPlan,state=emptyState(true)){
  return buildWeeklyHomeworkCandidates(state,plan,buildCoachingReportMetrics(state,{cutoff:now}));
}

test('prerequisites are assigned in order before dependent chemistry topic',()=>{
  const state=emptyState(true);
  state.topics=[topic('mol','TYT','Kimya','Kimyanın Temel Kanunları ve Mol Kavramı',1),
    topic('reaction','TYT','Kimya','Kimyasal Tepkimeler - Kimyasal Tepkimelerde Hesaplamalar',0),
    topic('solutions','AYT','Kimya','Sıvı Çözeltiler ve Çözünürlük',0)];
  let result=run(tinyPlan,state);
  assert.deepEqual(result.candidates.map(item=>item.topic_id),['mol']);
  assert.equal(result.candidates[0].study_type,'Konu anlatımı');
  assert.equal(result.candidates[0].planned_minutes,180);
  assert.match(result.candidates[0].completion_criteria,/bağımsız/i);
  state.topics[0].mastery=3;
  result=run(tinyPlan,state);
  assert.deepEqual(result.candidates.map(item=>item.topic_id),['reaction']);
  state.topics[1].mastery=3;
  result=run(tinyPlan,state);
  assert.deepEqual(result.candidates.map(item=>item.topic_id),['solutions']);
});

test('existing repeat tasks consume capacity and are never overwritten by new learning tasks',()=>{
  const state=emptyState(true);
  state.topics=[topic('mol','TYT','Kimya','Kimyanın Temel Kanunları ve Mol Kavramı',1),
    topic('reaction','TYT','Kimya','Kimyasal Tepkimeler - Kimyasal Tepkimelerde Hesaplamalar',0),
    topic('solutions','AYT','Kimya','Sıvı Çözeltiler ve Çözünürlük',0)];
  for(let offset=0;offset<14;offset++){
    const date=new Date(Date.UTC(2026,9,1+offset,12)).toISOString().slice(0,10);
    state.tasks.push(task(`repeat-${offset}`,date,null,300));
  }
  const result=run(tinyPlan,state);
  assert.deepEqual(result.candidates,[]);
  assert.ok(result.data_gaps.some(message=>message.includes('kapasite')));
});

test('finished instruction becomes independent practice; mastery four requires explicit weakness',()=>{
  const plan:CoachingPlan={...tinyPlan,months:[{month:'2026-10',targets:[
    {exam:'AYT',subject:'Matematik',topic_keywords:['Yönlü Açılar'],priority:'high'}]}]};
  const state=emptyState(true);
  state.topics=[topic('angles','AYT','Matematik','Yönlü Açılar',2)];
  let result=run(plan,state);
  assert.equal(result.candidates[0].study_type,'Soru çözümü');
  assert.equal(result.candidates[0].planned_minutes,120);
  state.topics[0].mastery=4;
  result=run(plan,state);
  assert.equal(result.candidates.length,0);
  state.topics[0].review_requested=true;
  result=run(plan,state);
  assert.equal(result.candidates[0].study_type,'Soru çözümü');
});

test('candidate keys are stable and existing same-topic phase tasks prevent duplicates',()=>{
  const plan:CoachingPlan={...tinyPlan,months:[{month:'2026-10',targets:[
    {exam:'AYT',subject:'Matematik',topic_keywords:['Yönlü Açılar'],priority:'high'}]}]};
  const state=emptyState(true);state.topics=[topic('angles','AYT','Matematik','Yönlü Açılar',2)];
  const first=run(plan,state),second=run(plan,state);
  assert.equal(first.candidates[0].key,second.candidates[0].key);
  state.tasks=[task('existing','2026-10-02','angles',120,'Soru çözümü')];
  assert.equal(run(plan,state).candidates.length,0);
});

test('a task assigned next Monday uses that Monday in its key and a concrete finish instruction',()=>{
  const plan:CoachingPlan={...tinyPlan,months:[{month:'2026-10',targets:[
    {exam:'AYT',subject:'Matematik',topic_keywords:['Yönlü Açılar'],priority:'low'}]}]};
  const state=emptyState(true);state.topics=[topic('angles','AYT','Matematik','Yönlü Açılar',0)];
  for(let day=1;day<=4;day++)state.tasks.push(task(`repeat-${day}`,`2026-10-0${day}`,null,300));
  const result=run(plan,state);
  assert.equal(result.candidates[0].plan_date,'2026-10-05');
  assert.equal(result.candidates[0].key,'2026-10-05:angles:instruction');
  assert.equal(result.candidates[0].priority,'normal');
  assert.match(result.directions[0].text,/Gelecek hafta.*tamamla/);
  assert.doesNotMatch(result.candidates[0].completion_criteria,/oturum/i);
});

test('weak recorded TYT mathematics and geography sections enter the six candidate slots',()=>{
  const plan:CoachingPlan={...tinyPlan,months:[{month:'2026-10',targets:[
    ...['Matematik','Fizik','Kimya','Biyoloji','Türkçe','Coğrafya'].map(subject=>({exam:'AYT' as const,subject,
      topic_keywords:[`AYT ${subject}`],priority:'high' as const})),
    {exam:'TYT',subject:'Matematik',topic_keywords:['Denklemler'],priority:'high'},
    {exam:'TYT',subject:'Coğrafya',topic_keywords:['Harita'],priority:'high'},
  ]}]};
  const state=emptyState(true);
  state.topics=[...['Matematik','Fizik','Kimya','Biyoloji','Türkçe','Coğrafya'].map(subject=>topic(`ayt-${subject}`,'AYT',subject,`AYT ${subject}`,0)),
    topic('tyt-math','TYT','Matematik','Denklemler',0),topic('tyt-geo','TYT','Coğrafya','Harita',0)];
  const sections=[{key:'matematik',label:'Temel Matematik',question_count:40},
    {key:'cografya',label:'Coğrafya',question_count:5}];
  const exam:ExamRecord={id:'tyt',name:'TYT',publisher:'',exam_date:'2026-09-30',format_code:'TYT',format_version:1,
    format_snapshot:{code:'TYT',version:1,label:'TYT',total_questions:45,wrong_divisor:4,sections},duration_minutes:null,
    notes:'',score:null,rank:null,source_document_id:null,import_metadata:null,
    results:[{section_key:'matematik',correct:null,wrong:null,blank:null,net:1.75},
      {section_key:'cografya',correct:null,wrong:null,blank:null,net:0}],reported_total_net:null,total_net:null,
    total_net_source:null,revision:1,created_at:now,updated_at:now};
  state.exams=[exam];
  const result=run(plan,state);
  assert.ok(result.candidates.length<=6);
  assert.ok(result.candidates.some(item=>item.topic_id==='tyt-math'));
  assert.ok(result.candidates.some(item=>item.topic_id==='tyt-geo'));
  assert.ok(result.candidates.some(item=>item.exam==='AYT'));
});

test('a newer canonical catalog topic wins over an old editable duplicate',()=>{
  const plan:CoachingPlan={...tinyPlan,months:[{month:'2026-10',targets:[
    {exam:'AYT',subject:'Matematik',topic_keywords:['Yönlü Açılar'],priority:'high'}]}]};
  const state=emptyState(true);
  state.topics=[topic('canonical','AYT','Matematik','Yönlü Açılar',0),
    {...topic('old','AYT','Matematik','Yönlü Açılar',0),source:'Önceki plan',updated_at:'2026-10-01T10:00:00Z'}];
  assert.equal(run(plan,state).candidates[0].topic_id,'canonical');
});

test('personal plan is explicit and October targets include parallel TYT and AYT work',()=>{
  assert.equal(SUMEYRA_2027_PLAN.daily_minutes,480);
  assert.ok(SUMEYRA_2027_PLAN.buffer_ratio>=.1&&SUMEYRA_2027_PLAN.buffer_ratio<=.15);
  assert.deepEqual(SUMEYRA_2027_PLAN.milestones.map(item=>item.due_date),
    ['2026-12-31','2027-01-31','2027-02-28']);
  const october=SUMEYRA_2027_PLAN.months.find(item=>item.month==='2026-10')!;
  assert.ok(october.targets.some(item=>item.exam==='TYT'&&item.subject==='Matematik'));
  assert.ok(october.targets.some(item=>item.exam==='AYT'&&item.subject==='Matematik'));
  assert.ok(run({...tinyPlan,months:[]}).candidates.length===0);
});

test('every personal monthly target and prerequisite resolves to a current OGM catalog topic',()=>{
  const catalog=JSON.parse(readFileSync(join(process.cwd(),'supabase/catalog/ogm-topic-headings.json'),'utf8')) as
    {exam:'TYT'|'AYT';subject:string;topics:string[]}[];
  const fold=(text:string)=>text.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
  const missing:string[]=[];
  for(const month of SUMEYRA_2027_PLAN.months)for(const target of month.targets){
    for(const reference of [target,...(target.prerequisites??[]),...(target.sequence_after??[])]){
      const group=catalog.find(item=>item.exam===reference.exam&&fold(item.subject)===fold(reference.subject));
      if(!group||!reference.topic_keywords.some(keyword=>group.topics.some(name=>fold(name)===fold(keyword))))
        missing.push(`${month.month} ${reference.exam} ${reference.subject} ${reference.topic_keywords[0]}`);
    }
  }
  assert.deepEqual(missing,[]);
});
