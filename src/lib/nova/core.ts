import type { AppState } from '../domain/types';
import type { NovaBaseline, NovaDay, NovaDayInput, NovaEvent, NovaEventKind, NovaMetrics, NovaPersonality, NovaProjection, NovaProactiveHistory, NovaProactiveOpportunity, NovaProactiveSettings, NovaReasonCode, NovaRelationship, NovaRelationshipEvent, NovaScore, NovaScoreComponent, NovaState, NovaWeeklyResult } from './types';

export const ENGINE_VERSION = 'nova-1.0.0';
/** Product threshold for a supportive check-in; not an academic success criterion. */
export const POOR_EXAM_ACCURACY_PERCENT = 60;
export const CALIBRATION_MIN_STEP_MINUTES = 5;
export const STATE_DELTA_LIMITS: NovaState = {energy:25,stress:20,focus:20,confidence:12,socialEnergy:20,competition:15};
export const DEFAULT_PERSONALITY: NovaPersonality = {discipline:65,ambition:60,resilience:65,sociability:55,humor:50,emotionalStability:65,competitiveness:60,strategy:60};
export const DEFAULT_PROACTIVE_SETTINGS: NovaProactiveSettings = {enabled:true,pushEnabled:false,maxPerDay:2,quietStartHour:23,quietEndHour:8,maxDuelsPerWeek:3};
export const REASON_LABELS: Record<NovaReasonCode,string> = {GOOD_SLEEP:'Simüle uykusu dinlendiriciydi.',SHORT_SLEEP:'Simüle uykusu biraz kısa kaldı.',RECOVERY:'Dinlenmek toparlanmasına yardımcı oldu.',STUDY_LOAD:'Çalışma yükü enerjisini azalttı.',DISTRACTION:'Dikkati dağıldı; kısa bir ara verdi.',TASK_COMPLETED:'Planladığı çalışmayı tamamladı.',TASK_MISSED:'Planladığı bir çalışmayı aksattı.',CALIBRATION:'Veri az olduğu için ilk günlerde temkinli kalibrasyon yapılıyor.',PREVIOUS_DAY:'Önceki günün durumu başlangıca taşındı.'};
const DEFAULT_STATE: NovaState = {energy:65,stress:30,focus:60,confidence:55,socialEnergy:55,competition:60};
const KEYS = Object.keys(DEFAULT_STATE) as (keyof NovaState)[];
const MINUTE = 60_000;
const clamp = (v:number,min=0,max=100) => Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
const round = (v:number) => Math.round(v*100)/100;
const positive = (v:number|null|undefined) => typeof v==='number' && Number.isFinite(v) && v>0;
const finite = (v:number|null|undefined): v is number => typeof v==='number' && Number.isFinite(v);
const mean = (values:number[]) => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const unique = <T extends {id:string}>(values:T[]) => [...new Map(values.map(value=>[value.id,value])).values()];

function dateParts(instant:number,timezone:string) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
}
/** Clock always supplied by caller; all returned timestamps are UTC. */
export function localDateAt(nowIso:string|number,timezone:string):string {
  const time=typeof nowIso==='number'?nowIso:Date.parse(nowIso);
  if(!Number.isFinite(time)) throw new Error('Geçersiz zaman.');
  const parts=dateParts(time,timezone);
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
}
export function addLocalDays(date:string,count:number):string {
  const parsed=Date.parse(`${date}T12:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date) throw new Error('Geçersiz yerel tarih.');
  return new Date(parsed+count*86400_000).toISOString().slice(0,10);
}
function midnight(date:string,timezone:string):number {
  addLocalDays(date,0);
  const center=Date.parse(`${date}T12:00:00Z`);
  let low=center-48*3600_000,high=center+36*3600_000;
  // Binary search finds the first instant on the date; handles DST offset changes.
  while(high-low>1) {
    const mid=Math.floor((low+high)/2);
    if(localDateAt(mid,timezone)<date) low=mid; else high=mid;
  }
  if(localDateAt(high,timezone)!==date) throw new Error('Bu saat diliminde yerel gün bulunamadı.');
  return high;
}
export function dayBounds(localDate:string,timezone:string):{startsAt:string;endsAt:string} {
  return {startsAt:new Date(midnight(localDate,timezone)).toISOString(),endsAt:new Date(midnight(addLocalDays(localDate,1),timezone)).toISOString()};
}
function localMinute(instant:number,timezone:string):number {
  const parts=dateParts(instant,timezone);
  return Number(parts.find(p=>p.type==='hour')!.value)*60+Number(parts.find(p=>p.type==='minute')!.value);
}
function seeded(seed:string):()=>number {
  let value=2166136261;
  for(let i=0;i<seed.length;i++) value=Math.imul(value^seed.charCodeAt(i),16777619);
  return () => {value=(value+0x6D2B79F5)|0;let t=Math.imul(value^(value>>>15),1|value);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
}

/** Closed intervals are the evidence. Overlap/duplicate rows cannot inflate elapsed time. */
function actualSeconds(state:AppState,date:string,timezone:string,now:number):number {
  const bounds=dayBounds(date,timezone),start=Date.parse(bounds.startsAt),end=Math.min(now,Date.parse(bounds.endsAt));
  if(end<=start) return 0;
  const sessions=new Map(state.sessions.map(s=>[s.id,s]));
  const intervals=unique(state.intervals);
  const spans:[number,number][]=[];
  for(const interval of intervals) {
    const session=sessions.get(interval.session_id);
    if(!session) continue;
    // An open timer has no historical endpoint. Use it only for the currently observed date.
    if(!interval.ended_at && localDateAt(now,timezone)!==date) continue;
    let finish=interval.ended_at?Date.parse(interval.ended_at):now;
    if(!interval.ended_at&&session.mode==='countdown'&&session.target_seconds!==null) finish=Math.min(finish,Date.parse(interval.started_at)+Math.max(0,session.target_seconds-session.accumulated_seconds)*1000);
    const a=Math.max(start,Date.parse(interval.started_at)),b=Math.min(end,finish);
    if(Number.isFinite(a)&&Number.isFinite(b)&&b>a) spans.push([a,b]);
  }
  // Legacy records without intervals retain their actual accumulated time. No target used.
  let legacy=0;
  for(const session of unique(state.sessions)) {
    if(session.status!=='finished'||!session.finished_at||intervals.some(i=>i.session_id===session.id)) continue;
    if(Date.parse(session.finished_at)>now||localDateAt(session.finished_at,timezone)!==date) continue;
    legacy+=Math.max(0,session.accumulated_seconds);
  }
  spans.sort((a,b)=>a[0]-b[0]);
  let total=0,lastEnd=-Infinity;
  for(const [a,b] of spans) {total+=Math.max(0,b-Math.max(a,lastEnd));lastEnd=Math.max(lastEnd,b);}
  const manual=unique(state.manual_study_entries??[]).filter(e=>e.study_date===date&&Date.parse(e.created_at)<=now).reduce((sum,e)=>sum+Math.max(0,e.duration_seconds),0);
  return Math.min((end-start)/1000,Math.floor(total/1000)+legacy+manual);
}
function targetFor(state:AppState,date:string):number|null {
  const plan=state.day_plans.filter(p=>p.plan_date===date).sort((a,b)=>b.version-a.version)[0];
  return plan?.target_minutes??state.settings?.weekday_targets[(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7]??state.settings?.daily_target_minutes??null;
}
/** User practice schema has no correct/wrong field: never fabricate accuracy. */
export function userMetrics(state:AppState,date:string,timezone:string,nowIso:string):NovaMetrics {
  const now=Date.parse(nowIso);
  if(!Number.isFinite(now)) throw new Error('Geçersiz zaman.');
  const currentDate=localDateAt(now,timezone);
  if(date>currentDate) return {tasksCompleted:null,taskTotal:null,studyMinutes:null,studyTargetMinutes:targetFor(state,date),questions:null,questionTarget:null,accuracyPercent:null,topicProgress:null,topicTarget:null,activeDays:null,observedDays:null};
  const cutoff=Math.min(now,Date.parse(dayBounds(addLocalDays(date,1),timezone).startsAt));
  const tasks=unique(state.tasks).filter(t=>t.plan_date===date&&Date.parse(t.updated_at)<=cutoff);
  const practice=unique(state.practice_entries).filter(p=>p.practice_date===date&&Date.parse(p.updated_at)<=cutoff);
  const topics=unique(state.topic_history).filter(t=>Date.parse(t.changed_at)<=cutoff&&localDateAt(t.changed_at,timezone)===date);
  const studyMinutes=actualSeconds(state,date,timezone,now)/60;
  const questions=practice.reduce((sum,p)=>sum+Math.max(0,p.question_count),0);
  return {tasksCompleted:tasks.length?tasks.reduce((sum,t)=>sum+clamp(t.progress,0,1),0):null,taskTotal:tasks.length||null,studyMinutes:round(studyMinutes),studyTargetMinutes:targetFor(state,date),questions:practice.length?questions:null,questionTarget:null,accuracyPercent:null,topicProgress:topics.length?topics.reduce((sum,t)=>sum+Math.max(0,t.new_mastery-t.old_mastery),0):null,topicTarget:null,activeDays:studyMinutes>0||questions>0?1:0,observedDays:1};
}

export function buildBaseline(state:AppState,beforeLocalDate:string,timezone:string):NovaBaseline {
  const windowStart=addLocalDays(beforeLocalDate,-14),cutoff=dayBounds(beforeLocalDate,timezone).startsAt;
  const valid=(date:string)=>date>=windowStart&&date<beforeLocalDate;
  const days=Array.from({length:14},(_,i)=>addLocalDays(windowStart,i));
  const values=days.map(date=>({date,metrics:userMetrics(state,date,timezone,cutoff)}));
  const observed=values.filter(({date,metrics:m})=>m.studyMinutes!>0||m.taskTotal!==null||m.questions!==null||m.topicProgress!==null||state.day_marks.some(mark=>mark.mark_date===date&&Date.parse(mark.updated_at)<Date.parse(cutoff)));
  // A task/question record proves activity, not a measured duration of zero.
  const explicitZeroDates=new Set(state.day_marks.filter(mark=>valid(mark.mark_date)&&Date.parse(mark.updated_at)<Date.parse(cutoff)).map(mark=>mark.mark_date));
  const study=observed.filter(v=>v.metrics.studyMinutes!>0||explicitZeroDates.has(v.date)).map(v=>v.metrics.studyMinutes??0);
  const tasks=observed.filter(v=>positive(v.metrics.taskTotal));
  const questions=observed.filter(v=>v.metrics.questions!==null).map(v=>v.metrics.questions!);
  const topics=observed.filter(v=>v.metrics.topicProgress!==null).map(v=>v.metrics.topicProgress!);
  const taskTotal=tasks.reduce((sum,v)=>sum+v.metrics.taskTotal!,0),taskDone=tasks.reduce((sum,v)=>sum+v.metrics.tasksCompleted!,0);
  const exams=unique(state.exams).filter(e=>valid(e.exam_date)&&Date.parse(e.updated_at)<Date.parse(cutoff)&&e.total_net!==null);
  const subjectMinutes:Record<string,number>={};
  const studyHours:number[]=[];
  for(const s of unique(state.sessions)) {
    if(s.status!=='finished'||!s.finished_at||Date.parse(s.finished_at)>=Date.parse(cutoff)||!valid(localDateAt(s.finished_at,timezone))) continue;
    if(s.subject) subjectMinutes[s.subject]=(subjectMinutes[s.subject]??0)+Math.max(0,s.accumulated_seconds)/60;
    studyHours.push(localMinute(Date.parse(s.started_at),timezone)/60);
  }
  for(const e of unique(state.manual_study_entries??[])) if(valid(e.study_date)&&Date.parse(e.created_at)<Date.parse(cutoff)) subjectMinutes[e.subject]=(subjectMinutes[e.subject]??0)+Math.max(0,e.duration_seconds)/60;
  const subjects=Object.keys(subjectMinutes).sort(),totalSubject=Object.values(subjectMinutes).reduce((a,b)=>a+b,0);
  const missingData:string[]=[];
  if(observed.length<14) missingData.push(`${14-observed.length} gün için tamamlanmış ölçüm yok; bu günler sıfır kabul edilmedi.`);
  if(!study.length) missingData.push('Gerçek çalışma süresi kaydı yok.');
  if(!taskTotal) missingData.push('Görev tamamlama verisi yok.');
  if(!questions.length) missingData.push('Soru sayısı kaydı yok.');
  missingData.push('Soru kayıtları doğru/yanlış bilgisi içermiyor; doğruluk puana eklenmedi.');
  if(!topics.length) missingData.push('Konu ilerleme geçmişi yok.');
  if(!exams.length) missingData.push('Deneme sonucu yok.');
  if(!state.settings) missingData.push('Günlük hedef ayarı yok; Nova için geçici 60 dakikalık simülasyon hedefi kullanılır.');
  return {windowStart,windowEndExclusive:beforeLocalDate,timezone,observedDays:observed.length,activeDays:observed.filter(v=>v.metrics.activeDays!>0).length,averageStudyMinutes:study.length?round(mean(study)!):null,dailyTargetMinutes:state.settings?.daily_target_minutes??null,weekdayTargets:state.settings?.weekday_targets.slice()??null,averageQuestions:mean(questions),questionAccuracyPercent:null,taskCompletionPercent:taskTotal?round(taskDone/taskTotal*100):null,averageTopicProgress:mean(topics),averageExamNet:mean(exams.map(e=>e.total_net!)),typicalStudyHour:mean(studyHours),subjectStrengths:Object.fromEntries(subjects.map(subject=>[subject,totalSubject?round(subjectMinutes[subject]/totalSubject*100):0])),missingData,calibrationDaysRemaining:Math.max(0,7-observed.length)};
}

export function scoreDay(metrics:NovaMetrics):NovaScore {
  const ratio=(value:number|null,target:number|null)=>finite(value)&&positive(target)?clamp(value/target!*100):null;
  const questionVolume=ratio(metrics.questions,metrics.questionTarget);
  const components:Record<NovaScoreComponent,number|null>={tasks:ratio(metrics.tasksCompleted,metrics.taskTotal),study:ratio(metrics.studyMinutes,metrics.studyTargetMinutes),questions:questionVolume===null?null:finite(metrics.accuracyPercent)?0.5*questionVolume+0.5*clamp(metrics.accuracyPercent):questionVolume,topics:ratio(metrics.topicProgress,metrics.topicTarget),consistency:ratio(metrics.activeDays,metrics.observedDays)};
  const base={tasks:.30,study:.25,questions:.20,topics:.15,consistency:.10};
  const keys=Object.keys(base) as NovaScoreComponent[];
  const available=keys.reduce((sum,key)=>sum+(components[key]===null?0:base[key]),0);
  const weights=Object.fromEntries(keys.map(key=>[key,components[key]===null?0:base[key]/available])) as Record<NovaScoreComponent,number>;
  const total=available?round(keys.reduce((sum,key)=>sum+(components[key]??0)*weights[key],0)):null;
  return {total,components,weights,missing:keys.filter(key=>components[key]===null)};
}

function boundedState(candidate:NovaState,anchor:NovaState):NovaState {
  return Object.fromEntries(KEYS.map(key=>[key,round(clamp(candidate[key],Math.max(0,anchor[key]-STATE_DELTA_LIMITS[key]),Math.min(100,anchor[key]+STATE_DELTA_LIMITS[key])))])) as NovaState;
}
function mood(state:NovaState):string {
  if(state.energy<35) return 'Uykulu ama kararlı';
  if(state.stress>65) return 'Gergin ve sessiz';
  if(state.focus<40) return 'Biraz dağılmış';
  if(state.confidence<35) return 'Morali bozulmuş ama toparlanıyor';
  if(state.energy>75&&state.stress<35) return 'Enerjik ve rahat';
  if(state.competition>70&&state.confidence>65) return 'Hırslı ve kendinden emin';
  return 'Sakin ve odaklı';
}

/** A simulation parameter; measured baseline data remains unchanged. Persist once per new day. */
export function boundedCalibrationStudyMinutes(previousBudget:number,observedAverage:number|null,maxDailyChange=.05):number {
  const previous=clamp(previousBudget,0,300);
  if(!finite(observedAverage)) return previous;
  const limit=clamp(maxDailyChange,0,.05);
  if(limit===0) return previous;
  const step=Math.max(CALIBRATION_MIN_STEP_MINUTES,previous*limit);
  return Math.round(clamp(observedAverage,Math.max(0,previous-step),Math.min(300,previous+step))*1_000_000)/1_000_000;
}

export function createDay(input:NovaDayInput):NovaDay {
  const snapshot=JSON.parse(JSON.stringify(input)) as NovaDayInput;
  const {localDate,timezone,seed,baseline}=snapshot;
  if(baseline.windowEndExclusive>localDate) throw new Error('Başlangıç profili gelecekteki verileri içeremez.');
  const engineVersion=input.engineVersion??ENGINE_VERSION;
  const random=seeded(`${engineVersion}|${localDate}|${timezone}|${seed}`);
  const personality={...DEFAULT_PERSONALITY,...input.personality};
  const previous=Object.fromEntries(KEYS.map(key=>[key,clamp(input.previousState?.[key]??DEFAULT_STATE[key])])) as NovaState;
  const rested=random()>.18;
  const startState=boundedState({...previous,energy:previous.energy+(rested?12:-7)+random()*6,stress:previous.stress-4+(random()-.5)*6,focus:previous.focus+(personality.discipline-50)/10+(random()-.5)*8,confidence:previous.confidence+(random()-.5)*8,socialEnergy:previous.socialEnergy+(personality.sociability-50)/10,competition:previous.competition+(personality.competitiveness-50)/10},previous);
  const bounds=dayBounds(localDate,timezone),start=Date.parse(bounds.startsAt),end=Date.parse(bounds.endsAt);
  // Schedule daytime anchors from a UTC candidate adjusted to the local wall clock.
  const at=(minute:number)=>{let guess=start+minute*MINUTE;for(let i=0;i<3;i++) guess+=(minute-localMinute(guess,timezone))*MINUTE;return Math.max(start,Math.min(end,guess));};
  const weekday=(new Date(`${localDate}T12:00:00Z`).getUTCDay()+6)%7;
  const goal=clamp(baseline.weekdayTargets?.[weekday]??baseline.dailyTargetMinutes??60,0,1440);
  const baseWork=clamp(input.calibrationStudyMinutes??baseline.averageStudyMinutes??45,0,300);
  const strength=clamp(input.strengthMultiplier??1,.5,1.5);
  const calibration=clamp(input.calibrationDay??7-baseline.calibrationDaysRemaining,0,7);
  const variance=baseline.calibrationDaysRemaining>0?.06+calibration*.006:.12;
  const planned=goal===0||baseWork===0?0:Math.round(clamp(baseWork*strength*(1+(random()-.5)*2*variance),0,300));
  const subjectNames=Object.keys(baseline.subjectStrengths).sort();
  if(!subjectNames.length) subjectNames.push('Matematik','Türkçe');
  // Balanced ±5% subject offsets change style, never the total daily study budget.
  const subjectOffsets=subjectNames.map(()=>random()*.1-.05);
  const offsetMean=mean(subjectOffsets)!;
  const subjectFactors=subjectOffsets.map(value=>1+value-offsetMean);
  const events:NovaEvent[]=[];
  let cursor=start;
  const add=(kind:NovaEventKind,label:string,until:number,delta:Partial<NovaState>={},reasons:NovaReasonCode[]=[],result:NovaEvent['result']=null,subject:string|null=null)=>{
    if(until<=cursor) return;
    events.push({id:`${localDate}:${events.length}`,kind,label,startsAt:new Date(cursor).toISOString(),endsAt:new Date(Math.min(until,end)).toISOString(),subject,result,stateDelta:delta,reasonCodes:reasons});
    cursor=Math.min(until,end);
  };
  add('sleep','Uyku',at(rested?450:420));
  add('wake','Uyanma ve hazırlanma',at(480),{energy:2},[rested?'GOOD_SLEEP':'SHORT_SLEEP']);
  add('breakfast','Kahvaltı',at(510),{energy:3,stress:-2},['RECOVERY']);
  add('commute','Kısa yürüyüş / ulaşım',at(540),{focus:2});
  add('routine','Günlük rutin',at(720),{energy:-3});
  add('meal','Öğle yemeği',at(750),{energy:3},['RECOVERY']);
  add('rest','Dinlenme',at(780),{energy:4,stress:-3},['RECOVERY']);
  let remaining=planned,index=0;
  const questionRate=(baseline.averageQuestions??20)/Math.max(30,baseline.averageStudyMinutes??60);
  const topicRate=(baseline.averageTopicProgress??.1)/Math.max(30,baseline.averageStudyMinutes??60);
  const work=(limit:number)=>{
    while(remaining>0&&cursor+15*MINUTE<limit) {
      const duration=Math.min(45,remaining,Math.floor((limit-cursor)/MINUTE)-10);
      if(duration<=0) break;
      const subjectIndex=index%subjectNames.length,subject=subjectNames[subjectIndex];
      const kinds:NovaEventKind[]=['study','questions','analysis','exam'];
      const kind=kinds[index%4];
      const missed=index>0&&random()<.12;
      const questions=kind==='questions'||kind==='exam'?Math.max(1,Math.round(duration*questionRate*subjectFactors[subjectIndex])):0;
      const accuracy=clamp((baseline.questionAccuracyPercent??65)+(random()-.5)*14,20,95);
      const result={studyMinutes:duration,questions,correct:questions?Math.round(questions*accuracy/100):null,topicProgress:kind==='study'?round(duration*topicRate):0,tasksCompleted:random()<clamp((baseline.taskCompletionPercent??85)/100,.35,.95)?1:0,...(kind==='exam'?{simulatedExamNet:round(questions*accuracy/100-(questions-questions*accuracy/100)/4)}:{})};
      add(missed?'distraction':kind,missed?'Dikkat dağıldı; toparlanma arası':({study:'Konu çalışması',questions:'Soru çözümü',analysis:'Yanlış analizi',exam:'Simüle kısa deneme'}[kind as 'study'|'questions'|'analysis'|'exam']),cursor+duration*MINUTE,missed?{focus:-4,stress:2}:{energy:-5,focus:-2,confidence:result.tasksCompleted?1:-1,stress:2},missed?['DISTRACTION','TASK_MISSED']:['STUDY_LOAD',result.tasksCompleted?'TASK_COMPLETED':'TASK_MISSED'],missed?null:result,subject);
      remaining-=duration;index++;
      add('rest','Kısa mola',Math.min(cursor+10*MINUTE,limit),{energy:3,focus:3,stress:-2},['RECOVERY']);
    }
  };
  work(at(1080));
  add('free_time','Serbest zaman',at(1080),{socialEnergy:3,stress:-2});
  add('meal','Akşam yemeği',at(1140),{energy:4},['RECOVERY']);
  work(at(1260));
  add('free_time','Serbest zaman',at(1290),{socialEnergy:3,stress:-2});
  add('reflection','Gün değerlendirmesi',at(1320),{focus:2});
  add('rest','Uykuya hazırlık',at(1350),{stress:-3},['RECOVERY']);
  add('sleep','Uyku',end,{energy:3},['RECOVERY']);
  return {identity:localDate,localDate,timezone,seed,engineVersion,...bounds,inputSnapshot:snapshot,startState,reasonCodes:[rested?'GOOD_SLEEP':'SHORT_SLEEP',...(input.previousState?['PREVIOUS_DAY' as const]:[]),...(baseline.calibrationDaysRemaining>0?['CALIBRATION' as const]:[])],events,targets:{studyMinutes:goal,questions:Math.max(1,Math.round(baseline.averageQuestions??20)),topicProgress:Math.max(.01,baseline.averageTopicProgress??.1),tasks:index}};
}

export function projectDay(day:NovaDay,nowIso:string):NovaProjection {
  const now=Date.parse(nowIso);
  if(!Number.isFinite(now)) throw new Error('Geçersiz zaman.');
  const anchor=day.inputSnapshot.previousState??DEFAULT_STATE;
  let state={...day.startState};
  const completed=unique(day.events).filter(e=>Date.parse(e.endsAt)<=now);
  const reasonCodes=new Set(day.reasonCodes);
  let studyMinutes=0,questions=0,correct=0,topicProgress=0,tasksCompleted=0;
  for(const event of completed) {
    state=boundedState(Object.fromEntries(KEYS.map(key=>[key,state[key]+(event.stateDelta[key]??0)])) as NovaState,anchor);
    event.reasonCodes.forEach(reason=>reasonCodes.add(reason));
    if(event.result) {studyMinutes+=event.result.studyMinutes;questions+=event.result.questions;correct+=event.result.correct??0;topicProgress+=event.result.topicProgress;tasksCompleted+=event.result.tasksCompleted;}
  }
  const timeline:NovaProjection['timeline']=unique(day.events).map(event=>{
    const completed=Date.parse(event.endsAt)<=now;
    const started=Date.parse(event.startsAt)<=now;
    const hideDistraction=!started&&event.kind==='distraction';
    return {id:event.id,kind:hideDistraction?'study':event.kind,label:hideDistraction?'Çalışma bloğu':event.label,
      startsAt:event.startsAt,endsAt:event.endsAt,subject:event.subject,status:completed?'completed':started?'active':'planned',
      result:completed?event.result:null,reasonCodes:completed?event.reasonCodes:[]};
  });
  const baseline=day.inputSnapshot.baseline;
  const metrics:NovaMetrics={studyMinutes:round(studyMinutes),studyTargetMinutes:day.targets.studyMinutes,tasksCompleted:baseline.taskCompletionPercent===null?null:tasksCompleted,taskTotal:baseline.taskCompletionPercent===null?null:day.targets.tasks,questions:baseline.averageQuestions===null?null:questions,questionTarget:baseline.averageQuestions===null?null:day.targets.questions,accuracyPercent:baseline.questionAccuracyPercent!==null&&questions?round(correct/questions*100):null,topicProgress:baseline.averageTopicProgress===null?null:round(topicProgress),topicTarget:baseline.averageTopicProgress===null?null:day.targets.topicProgress,activeDays:studyMinutes>0?1:0,observedDays:1};
  return {localDate:day.localDate,now:nowIso,completed:now>=Date.parse(day.endsAt),state,mood:mood(state),reasonCodes:[...reasonCodes],currentEvent:timeline.find(e=>e.status==='active')??null,timeline,metrics,score:scoreDay(metrics)};
}

/** Caller persists one adaptation per week. Current/incomplete/duplicate dates never enter it. */
export function adaptWeekly(input:{currentMultiplier:number;days:NovaWeeklyResult[];beforeLocalDate:string;maxWeeklyChange?:number}):number {
  const byDate=new Map(input.days.filter(d=>d.completed&&d.localDate<input.beforeLocalDate&&d.localDate>=addLocalDays(input.beforeLocalDate,-7)&&finite(d.userScore)&&finite(d.novaScore)).map(d=>[d.localDate,d]));
  if(byDate.size<7) return input.currentMultiplier;
  const gap=mean([...byDate.values()].map(d=>clamp(d.userScore!)-clamp(d.novaScore!)))!;
  const limit=clamp(input.maxWeeklyChange??.05,0,.05);
  return Math.round(clamp(input.currentMultiplier,.5,1.5)*(1+clamp(gap/100,-limit,limit))*1_000_000)/1_000_000;
}

export function applyRelationshipEvent(previous:NovaRelationship,event:NovaRelationshipEvent):NovaRelationship {
  const next={...previous};
  if(event==='friendly_exchange') {next.familiarity+=1;next.warmth+=1;}
  if(event==='duel_accepted') {next.familiarity+=1;next.rivalry+=1;}
  return {familiarity:clamp(next.familiarity),warmth:clamp(next.warmth),rivalry:clamp(next.rivalry)};
}

export function getProactiveOpportunity(input:{day:NovaDay;nowIso:string;history:NovaProactiveHistory[];settings?:Partial<NovaProactiveSettings>;userScore?:number|null;novaScore?:number|null;previousLeader?:'user'|'nova'|'tie'}):NovaProactiveOpportunity|null {
  const settings={...DEFAULT_PROACTIVE_SETTINGS,...input.settings};
  const now=Date.parse(input.nowIso),{day}=input;
  if(!settings.enabled||!Number.isFinite(now)||localDateAt(now,day.timezone)!==day.localDate) return null;
  const hour=localMinute(now,day.timezone)/60;
  const quiet=settings.quietStartHour>settings.quietEndHour?hour>=settings.quietStartHour||hour<settings.quietEndHour:hour>=settings.quietStartHour&&hour<settings.quietEndHour;
  if(quiet||input.history.some(h=>!h.answered)) return null;
  const today=input.history.filter(h=>localDateAt(h.sentAt,day.timezone)===day.localDate);
  if(today.length>=clamp(settings.maxPerDay,0,10)) return null;
  const projection=projectDay(day,input.nowIso);
  const candidates:NovaProactiveTriggerCandidate[]=[];
  if(hour>=8&&hour<10) candidates.push({trigger:'morning_checkin',expiresAt:now+Math.min(60,600-localMinute(now,day.timezone))*MINUTE});
  if(projection.currentEvent&&['study','questions','analysis','exam'].includes(projection.currentEvent.kind)&&now-Date.parse(projection.currentEvent.startsAt)<15*MINUTE) candidates.push({trigger:'study_start',expiresAt:Date.parse(projection.currentEvent.startsAt)+15*MINUTE});
  if(finite(input.userScore)&&finite(input.novaScore)) {
    if(input.userScore>input.novaScore&&input.previousLeader==='nova') candidates.push({trigger:'user_ahead',expiresAt:now+30*MINUTE});
    if(input.novaScore>input.userScore&&input.previousLeader==='user') candidates.push({trigger:'nova_ahead',expiresAt:now+30*MINUTE});
  }
  const poorExam=projection.timeline.find(e=>e.kind==='exam'&&e.status==='completed'&&now-Date.parse(e.endsAt)<30*MINUTE&&e.result?.questions&&e.result.correct!==null&&e.result.correct/e.result.questions<POOR_EXAM_ACCURACY_PERCENT/100);
  if(poorExam) candidates.push({trigger:'poor_exam',expiresAt:Date.parse(poorExam.endsAt)+30*MINUTE});
  const weekStart=addLocalDays(day.localDate,-6);
  const duels=input.history.filter(h=>h.trigger==='focus_duel'&&localDateAt(h.sentAt,day.timezone)>=weekStart).length;
  if(hour>=17&&hour<19&&duels<settings.maxDuelsPerWeek&&projection.state.energy>=50) candidates.push({trigger:'focus_duel',expiresAt:now+30*MINUTE});
  if(hour>=21&&hour<23) candidates.push({trigger:'day_end',expiresAt:Math.min(now+30*MINUTE,Date.parse(day.endsAt))});
  const candidate=candidates.find(c=>!today.some(h=>h.trigger===c.trigger)&&c.expiresAt>now);
  return candidate?{key:`${day.localDate}:${candidate.trigger}`,trigger:candidate.trigger,expiresAt:new Date(candidate.expiresAt).toISOString(),pushAllowed:settings.pushEnabled}:null;
}
type NovaProactiveTriggerCandidate={trigger:NovaProactiveOpportunity['trigger'];expiresAt:number};
