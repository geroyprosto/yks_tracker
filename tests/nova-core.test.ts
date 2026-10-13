import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, StudySession, Task } from '../src/lib/domain/types';
import { adaptWeekly, applyRelationshipEvent, boundedCalibrationStudyMinutes, buildBaseline, createDay, dayBounds, getProactiveOpportunity, localDateAt, projectDay, scoreDay, STATE_DELTA_LIMITS, userMetrics } from '../src/lib/nova/core';
import type { NovaMetrics, NovaState } from '../src/lib/nova/types';

function state(): AppState {
  return {configured:true,authenticated:true,server_now:'2026-10-13T12:00:00Z',settings:null,tasks:[],topics:[],sessions:[],intervals:[],manual_study_entries:[],day_plans:[],topic_history:[],practice_entries:[],exam_formats:[],exams:[],journal_entries:[],day_marks:[]};
}
function session(id: string, start: string, end: string): StudySession {
  return {id,title:'Çalışma',task_id:null,topic_id:null,subject:'Matematik',study_type:'Tekrar',mode:'stopwatch',target_seconds:28800,status:'finished',started_at:start,active_since:null,accumulated_seconds:(Date.parse(end)-Date.parse(start))/1000,finished_at:end,revision:1};
}
const baseline = () => buildBaseline(state(), '2026-10-13', 'Europe/Istanbul');
const day = (seed = 'stable') => createDay({localDate:'2026-10-13',timezone:'Europe/Istanbul',seed,baseline:baseline()});
const emptyMetrics: NovaMetrics = {tasksCompleted:null,taskTotal:null,studyMinutes:null,studyTargetMinutes:null,questions:null,questionTarget:null,accuracyPercent:null,topicProgress:null,topicTarget:null,activeDays:null,observedDays:null};

test('same seed/input/version yields same immutable snapshot and projected result', () => {
  const input = {localDate:'2026-10-13',timezone:'Europe/Istanbul',seed:'s',baseline:baseline()};
  const a = createDay(input), b = createDay(input);
  assert.deepEqual(a,b);
  input.baseline.averageStudyMinutes = 900;
  assert.equal(a.inputSnapshot.baseline.averageStudyMinutes, null);
  assert.deepEqual(projectDay(a,'2026-10-14T00:00:00Z'),projectDay(b,'2026-10-14T00:00:00Z'));
  assert.equal(createDay({...input,engineVersion:'future'}).identity,a.identity);
});

test('IANA day boundaries respect Istanbul midnight and 23/25 hour DST dates', () => {
  assert.equal(localDateAt('2026-10-12T21:01:00Z','Europe/Istanbul'),'2026-10-13');
  const tr = dayBounds('2026-10-13','Europe/Istanbul');
  assert.equal(tr.startsAt,'2026-10-12T21:00:00.000Z');
  for (const [date,hours] of [['2026-03-08',23],['2026-11-01',25]] as const) {
    const bounds = dayBounds(date,'America/New_York');
    assert.equal((Date.parse(bounds.endsAt)-Date.parse(bounds.startsAt))/3600000,hours);
  }
  assert.throws(() => dayBounds('2026-02-30','Europe/Istanbul'));
});

test('seed sweep maintains bounded states, daily deltas and complete nonoverlapping schedules', () => {
  const previous: NovaState = {energy:8,stress:94,focus:16,confidence:92,socialEnergy:7,competition:97};
  const initialBaseline=baseline();
  for(let i=0;i<80;i++) {
    const generated = createDay({localDate:'2026-10-13',timezone:'Europe/Istanbul',seed:String(i),baseline:initialBaseline,previousState:previous});
    assert.equal(generated.events[0].startsAt,generated.startsAt);
    assert.equal(generated.events.at(-1)?.endsAt,generated.endsAt);
    for(let j=0;j<generated.events.length;j++) {
      const event = generated.events[j];
      assert.ok(Date.parse(event.endsAt)>Date.parse(event.startsAt));
      if(j) assert.equal(generated.events[j-1].endsAt,event.startsAt);
      const projection = projectDay(generated,event.endsAt);
      for(const key of Object.keys(previous) as (keyof NovaState)[]) {
        assert.ok(projection.state[key]>=0 && projection.state[key]<=100);
        assert.ok(Math.abs(projection.state[key]-previous[key])<=STATE_DELTA_LIMITS[key]);
      }
    }
    for(const kind of ['sleep','rest','meal','study']) assert.ok(generated.events.some(e=>e.kind===kind));
  }
});

test('future event results remain hidden and score only once after completion', () => {
  const generated = createDay({localDate:'2026-10-13',timezone:'Europe/Istanbul',seed:'stable',baseline:{...baseline(),averageQuestions:20}});
  const before = projectDay(generated,generated.startsAt);
  assert.equal(before.metrics.studyMinutes,0);
  assert.equal(before.metrics.questions,0);
  assert.ok(before.timeline.every(e=>e.result===null));
  assert.ok(before.timeline.every(e=>e.reasonCodes.length===0));
  const study = generated.events.find(e=>e.kind==='study')!;
  const during = projectDay(generated,study.startsAt);
  assert.equal(during.timeline.find(e=>e.id===study.id)?.result,null);
  const done = projectDay(generated,generated.endsAt);
  const duplicated = {...generated,events:[...generated.events,...generated.events]};
  assert.deepEqual(projectDay(duplicated,generated.endsAt).metrics,done.metrics);
  assert.ok(done.metrics.studyMinutes!>0);
});

test('planned distractions stay neutral until their start without changing the official day', () => {
  const generated=day();
  const event=generated.events.find(e=>e.kind==='study')!;
  event.kind='distraction';
  event.label='Dikkat dağıldı; toparlanma arası';
  event.reasonCodes=['DISTRACTION','TASK_MISSED'];
  const snapshot=JSON.stringify(generated);
  const before=projectDay(generated,new Date(Date.parse(event.startsAt)-1).toISOString()).timeline.find(e=>e.id===event.id)!;
  assert.equal(before.status,'planned');
  assert.equal(before.kind,'study');
  assert.equal(before.label,'Çalışma bloğu');
  assert.equal(before.result,null);
  assert.deepEqual(before.reasonCodes,[]);
  const active=projectDay(generated,event.startsAt).currentEvent!;
  assert.equal(active.kind,'distraction');
  assert.equal(active.label,event.label);
  assert.equal(active.result,null);
  const completed=projectDay(generated,event.endsAt).timeline.find(e=>e.id===event.id)!;
  assert.equal(completed.kind,event.kind);
  assert.equal(completed.label,event.label);
  assert.deepEqual(completed.result,event.result);
  assert.deepEqual(completed.reasonCodes,event.reasonCodes);
  assert.equal(JSON.stringify(generated),snapshot);
});

test('baseline uses recorded actual time, deduplicates intervals and excludes today', () => {
  const s = state();
  const yesterday = session('old','2026-10-12T09:00:00Z','2026-10-12T10:00:00Z');
  const today = session('today','2026-10-13T09:00:00Z','2026-10-13T12:00:00Z');
  s.sessions=[yesterday,today];
  s.intervals=[{id:'i',session_id:'old',started_at:yesterday.started_at,ended_at:yesterday.finished_at},{id:'i',session_id:'old',started_at:yesterday.started_at,ended_at:yesterday.finished_at}];
  const b = buildBaseline(s,'2026-10-13','Europe/Istanbul');
  assert.equal(b.averageStudyMinutes,60);
  assert.equal(b.observedDays,1);
  assert.equal(b.dailyTargetMinutes,null);
  assert.equal(b.questionAccuracyPercent,null);
  assert.ok(b.missingData.length>0);
  assert.equal(b.calibrationDaysRemaining,6);
});

test('baseline splits actual time at local midnight and never mutates real input', () => {
  const s = state();
  s.sessions=[session('cross','2026-10-11T20:30:00Z','2026-10-11T21:30:00Z')];
  s.intervals=[{id:'i',session_id:'cross',started_at:s.sessions[0].started_at,ended_at:s.sessions[0].finished_at}];
  const copy = JSON.stringify(s);
  assert.equal(userMetrics(s,'2026-10-11','Europe/Istanbul',s.server_now).studyMinutes,30);
  assert.equal(userMetrics(s,'2026-10-12','Europe/Istanbul',s.server_now).studyMinutes,30);
  assert.equal(JSON.stringify(s),copy);
});

test('score components clamp and missing weights redistribute with explicit null no-data score', () => {
  assert.equal(scoreDay(emptyMetrics).total,null);
  const value = scoreDay({...emptyMetrics,tasksCompleted:1,taskTotal:2,studyMinutes:60,studyTargetMinutes:60});
  assert.equal(value.total,72.73);
  assert.ok(Math.abs(value.weights.tasks+value.weights.study-1)<1e-10);
  assert.equal(value.weights.questions,0);
  assert.equal(scoreDay({...emptyMetrics,studyMinutes:1e6,studyTargetMinutes:1}).total,100);
  assert.equal(scoreDay({...emptyMetrics,questions:20,questionTarget:40,accuracyPercent:null}).components.questions,50);
});

test('question accuracy stays unavailable because practice entries do not record correct answers', () => {
  const s = state();
  s.practice_entries=[{id:'p',practice_date:'2026-10-12',exam:null,subject:'Matematik',question_count:40,test_count:2,revision:1,created_at:'2026-10-12T08:00:00Z',updated_at:'2026-10-12T08:00:00Z'}];
  assert.equal(buildBaseline(s,'2026-10-13','Europe/Istanbul').questionAccuracyPercent,null);
});

test('historical task updates after cutoff do not leak into baseline', () => {
  const s=state();
  s.tasks=[{id:'late',plan_date:'2026-10-12',progress:1,updated_at:'2026-10-13T10:00:00Z'} as Task];
  assert.equal(buildBaseline(s,'2026-10-13','Europe/Istanbul').taskCompletionPercent,null);
});

test('weekly adaptation only uses seven completed historical days and caps strength change at five percent', () => {
  const days=Array.from({length:7},(_,i)=>({localDate:`2026-10-${String(i+6).padStart(2,'0')}`,completed:true,userScore:100,novaScore:0}));
  assert.equal(adaptWeekly({currentMultiplier:1,days,beforeLocalDate:'2026-10-13'}),1.05);
  assert.equal(adaptWeekly({currentMultiplier:1,days:days.map(d=>({...d,userScore:0,novaScore:100})),beforeLocalDate:'2026-10-13'}),0.95);
  assert.equal(adaptWeekly({currentMultiplier:1,days:days.slice(1),beforeLocalDate:'2026-10-13'}),1);
  assert.equal(adaptWeekly({currentMultiplier:1,days:days.map(d=>({...d,completed:false})),beforeLocalDate:'2026-10-13'}),1);
});

test('proactive opportunities enforce silence, unanswered suppression, expiry, and daily caps', () => {
  const generated=day();
  const common={day:generated,history:[]};
  assert.equal(getProactiveOpportunity({...common,nowIso:'2026-10-13T04:00:00Z'}),null);
  assert.equal(getProactiveOpportunity({...common,nowIso:'2026-10-13T20:30:00Z'}),null);
  const opportunity=getProactiveOpportunity({...common,nowIso:'2026-10-13T05:30:00Z'});
  assert.equal(opportunity?.trigger,'morning_checkin');
  assert.equal(getProactiveOpportunity({...common,nowIso:'2026-10-13T05:30:00Z',history:[{trigger:'study_start',sentAt:'2026-10-12T08:00:00Z',answered:false}]}),null);
  assert.notEqual(getProactiveOpportunity({...common,nowIso:'2026-10-13T16:00:00Z'})?.trigger,'morning_checkin');
});

test('relationship never penalizes absence, unanswered messages or declined duels', () => {
  const relation={familiarity:40,warmth:60,rivalry:50};
  for(const event of ['user_absent','message_unanswered','duel_declined'] as const) assert.deepEqual(applyRelationshipEvent(relation,event),relation);
});

test('current-day question and topic records are excluded from historical calibration', () => {
  const s=state();
  s.practice_entries=[{id:'today',practice_date:'2026-10-13',question_count:1000,updated_at:s.server_now} as AppState['practice_entries'][number]];
  s.topic_history=[{id:'today',topic_id:'t',old_mastery:0,new_mastery:1,changed_at:s.server_now}];
  const result=buildBaseline(s,'2026-10-13','Europe/Istanbul');
  assert.equal(result.averageQuestions,null);
  assert.equal(result.averageTopicProgress,null);
});

test('daily settings and Monday-first weekday targets are preserved without fixed eight-hour goal', () => {
  const s=state();
  s.settings={daily_target_minutes:120,weekday_targets:[60,90,120,150,180,210,0]} as AppState['settings'];
  const b=buildBaseline(s,'2026-10-13','Europe/Istanbul');
  assert.equal(b.dailyTargetMinutes,120);
  const tuesday=createDay({localDate:'2026-10-13',timezone:'Europe/Istanbul',seed:'goal',baseline:b});
  assert.equal(tuesday.targets.studyMinutes,90);
  const sunday=createDay({localDate:'2026-10-18',timezone:'Europe/Istanbul',seed:'rest',baseline:b});
  assert.equal(sunday.targets.studyMinutes,0);
  assert.equal(projectDay(sunday,sunday.endsAt).metrics.studyMinutes,0);
});

test('proactive messages honor opt-out, daily cap, repeat trigger and three weekly duel offers', () => {
  const generated=day();
  const nowIso='2026-10-13T05:30:00Z';
  assert.equal(getProactiveOpportunity({day:generated,nowIso,history:[],settings:{enabled:false}}),null);
  const history=[{trigger:'morning_checkin' as const,sentAt:'2026-10-13T05:01:00Z',answered:true},{trigger:'day_end' as const,sentAt:'2026-10-13T05:02:00Z',answered:true}];
  assert.equal(getProactiveOpportunity({day:generated,nowIso,history}),null);
  assert.equal(getProactiveOpportunity({day:generated,nowIso,history:history.slice(0,1)}),null);
  const duels=[9,10,11].map(d=>({trigger:'focus_duel' as const,sentAt:`2026-10-${d.toString().padStart(2,'0')}T14:00:00Z`,answered:true}));
  assert.notEqual(getProactiveOpportunity({day:generated,nowIso:'2026-10-13T14:30:00Z',history:duels})?.trigger,'focus_duel');
});

test('known zero history does not invent completed study work', () => {
  const generated=createDay({localDate:'2026-10-13',timezone:'Europe/Istanbul',seed:'zero',baseline:{...baseline(),averageStudyMinutes:0}});
  assert.equal(projectDay(generated,generated.endsAt).metrics.studyMinutes,0);
});

test('first-week calibration has a bounded five-minute or five-percent step and preserves measured averages', () => {
  assert.equal(boundedCalibrationStudyMinutes(60,300),65);
  assert.equal(boundedCalibrationStudyMinutes(60,0),55);
  assert.equal(boundedCalibrationStudyMinutes(60,null),60);
  assert.equal(boundedCalibrationStudyMinutes(200,300),210);
  assert.equal(boundedCalibrationStudyMinutes(200,300,.02),205);
  assert.equal(boundedCalibrationStudyMinutes(60,300,0),60);
  assert.equal(boundedCalibrationStudyMinutes(60,61),61);
  assert.equal(boundedCalibrationStudyMinutes(0,60),5);
  assert.equal(boundedCalibrationStudyMinutes(0,0),0);
  assert.equal(boundedCalibrationStudyMinutes(0,null),0);
  const real={...baseline(),averageStudyMinutes:300};
  const generated=createDay({localDate:'2026-10-13',timezone:'Europe/Istanbul',seed:'calibration',baseline:real,calibrationStudyMinutes:63});
  assert.equal(generated.inputSnapshot.baseline.averageStudyMinutes,300);
  assert.equal(generated.inputSnapshot.calibrationStudyMinutes,63);
  assert.ok(projectDay(generated,generated.endsAt).metrics.studyMinutes!<75);
});

test('poor simulated exam opportunity uses the documented below-sixty-percent threshold', () => {
  const generated=day();
  const exam=generated.events.find(e=>e.kind==='study')!;
  exam.kind='exam';
  exam.result={studyMinutes:45,questions:100,correct:58,topicProgress:0,tasksCompleted:1,simulatedExamNet:47.5};
  const nowIso=new Date(Date.parse(exam.endsAt)+5*60000).toISOString();
  assert.equal(getProactiveOpportunity({day:generated,nowIso,history:[]})?.trigger,'poor_exam');
  exam.result.correct=80;
  assert.notEqual(getProactiveOpportunity({day:generated,nowIso,history:[]})?.trigger,'poor_exam');
});

test('task and question evidence without time records leaves study average unknown rather than zero', () => {
  const s=state();
  s.tasks=[{id:'task',plan_date:'2026-10-12',progress:1,updated_at:'2026-10-12T09:00:00Z'} as Task];
  s.practice_entries=[{id:'questions',practice_date:'2026-10-11',question_count:40,updated_at:'2026-10-11T09:00:00Z'} as AppState['practice_entries'][number]];
  const unknown=buildBaseline(s,'2026-10-13','Europe/Istanbul');
  assert.equal(unknown.observedDays,2);
  assert.equal(unknown.averageStudyMinutes,null);
  const generated=createDay({localDate:'2026-10-13',timezone:'Europe/Istanbul',seed:'unknown-time',baseline:unknown});
  assert.ok(projectDay(generated,generated.endsAt).metrics.studyMinutes!>0);
  s.manual_study_entries=[{id:'actual',study_date:'2026-10-10',subject:'Matematik',duration_seconds:3600,created_at:'2026-10-10T12:00:00Z'}];
  assert.equal(buildBaseline(s,'2026-10-13','Europe/Istanbul').averageStudyMinutes,60);
  s.day_marks=[{id:'zero',mark_date:'2026-10-09',kind:'zero',revision:1,created_at:'2026-10-09T12:00:00Z',updated_at:'2026-10-09T12:00:00Z'}];
  assert.equal(buildBaseline(s,'2026-10-13','Europe/Istanbul').averageStudyMinutes,30);
});
