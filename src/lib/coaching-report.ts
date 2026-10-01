import type {AppState, ExamRecord, JournalEntry, Task} from './domain/types';
import {taskCompletion} from './progress';
import {secondsByDay} from './timing';
import {localDate} from './ui';

const TIMEZONE='Europe/Istanbul';
const DAY=/^\d{4}-\d{2}-\d{2}$/;
type ExamKind='TYT'|'AYT';
type DiaryKind='early_wake'|'stress'|'sleep'|'mood';
type Group={label:string;count:number;average_seconds:number|null;average_label:string};
type Rate={done:number;total:number;remaining:number;rate_percent:number|null};
export type DiaryObservation={date:string;text:string;study_label:string};

export type CoachingReportMetrics={
  schema_version:1;
  context:{timezone:string;current_cutoff:string;current_analysis_id:string|null;cutoff_local_date:string;
    previous_cutoff:string|null;previous_analysis_id:string|null;week_start:string;week_end:string};
  priority_summary:{high:Rate;all:Rate;completed_high_share_percent:number|null;
    by_subject:(Rate&{exam:Task['exam'];subject:string})[];
    overdue:{high:number;count:number;task_ids:string[]}};
  study:{start:string;end:string;total_seconds:number;duration_label:string;question_count:number;test_count:number};
  retrospective_changes:{metric:'high_priority_rate'|'all_task_rate'|'study_duration';previous:number;current:number;
    difference:number;unit:'percentage_points'|'seconds';evidence_ids:string[]}[];
  diary_insights:{kind:DiaryKind;type:'observation'|'association';sufficient_data:boolean;matched_days:number;
    group_a:Group;group_b:Group;text:string}[];
  diary_observations:DiaryObservation[];
  weekly_exam:{start:string;end:string;TYT:ExamSeries;AYT:ExamSeries};
  data_gaps:string[];
};
type ExamSeries={exams:{id:string;date:string;name:string;total_net:number|null;
  sections:{key:string;label:string;net:number;question_count:number|null}[]}[];warnings:string[]};

export type CoachingReportOptions={cutoff:string;start?:string;end?:string;previous?:CoachingReportMetrics|null;
  previousAnalysisId?:string|null;currentAnalysisId?:string|null};

function shiftDay(day:string,amount:number){
  const value=new Date(`${day}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+amount);
  return value.toISOString().slice(0,10);
}
function weekBounds(day:string){
  const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
  const start=shiftDay(day,-((weekday+6)%7));return {start,end:shiftDay(start,6)};
}
function rate(done:number,total:number):Rate{
  return {done,total,remaining:total-done,rate_percent:total?Math.round(done/total*1000)/10:null};
}
/** Round to the nearest minute, including values such as 44,817 s → 12 sa 27 dk. */
export function formatHoursMinutes(seconds:number){
  const minutes=Math.max(0,Math.round(seconds/60));
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return hours?`${hours} sa ${rest} dk`:`${rest} dk`;
}
function localClock(timestamp:number){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(timestamp);
  return `${parts.find(part=>part.type==='hour')?.value}:${parts.find(part=>part.type==='minute')?.value}`;
}
function sameElapsedWeekPosition(now:string,prior:string){
  const a=Date.parse(now),b=Date.parse(prior);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<=b)return false;
  const currentDay=localDate(a,TIMEZONE),previousDay=localDate(b,TIMEZONE);
  const days=(Date.parse(`${currentDay}T12:00:00Z`)-Date.parse(`${previousDay}T12:00:00Z`))/86400000;
  return days>0&&days%7===0&&localClock(a)===localClock(b);
}
function priorityMetrics(tasks:Task[],weekStart:string,weekEnd:string,today:string){
  const cohort=tasks.filter(task=>task.plan_date>=weekStart&&task.plan_date<=weekEnd);
  const high=cohort.filter(task=>task.priority==='high');
  const completed=(rows:Task[])=>rows.filter(task=>taskCompletion(task)===1).length;
  const bySubject=new Map<string,{exam:Task['exam'];subject:string;items:Task[]}>();
  for(const task of high){
    const subject=task.subject??'Ders belirtilmedi',key=JSON.stringify([task.exam,subject]);
    const group=bySubject.get(key)??{exam:task.exam,subject,items:[]};group.items.push(task);bySubject.set(key,group);
  }
  const overdue=cohort.filter(task=>task.plan_date<today&&taskCompletion(task)<1);
  const completedHigh=completed(high),completedAll=completed(cohort);
  return {high:rate(completedHigh,high.length),all:rate(completedAll,cohort.length),
    completed_high_share_percent:completedAll?Math.round(completedHigh/completedAll*1000)/10:null,
    by_subject:[...bySubject.values()].map(group=>({...rate(completed(group.items),group.items.length),
      exam:group.exam,subject:group.subject})).sort((a,b)=>(a.exam??'').localeCompare(b.exam??'')||a.subject.localeCompare(b.subject,'tr')),
    overdue:{high:overdue.filter(task=>task.priority==='high').length,count:overdue.length,
      task_ids:overdue.map(task=>task.id).sort()}};
}
function clockMinutes(value:unknown){
  if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
  return Number(value.slice(0,2))*60+Number(value.slice(3));
}
function normalizedMood(value:unknown){
  if(typeof value!=='string')return null;
  const mood=value.trim().toLocaleLowerCase('tr');
  if(['iyi','mutlu','sakin','keyifli','enerjik','happy','good'].includes(mood))return 'good';
  if(['kötü','üzgün','mutsuz','kaygılı','gergin','berbat','bad'].includes(mood))return 'low';
  return null;
}
function sleepMinutes(entry:JournalEntry){
  // One entry's sleep_at is the preceding night; wake_at is the morning of journal_date.
  const sleep=clockMinutes(entry.structured_fields.sleep_at),wake=clockMinutes(entry.structured_fields.wake_at);
  if(sleep===null||wake===null)return null;
  const duration=(wake-sleep+1440)%1440;
  return duration>0&&duration<=960?duration:null;
}
function group(label:string,values:number[]):Group{
  const average=values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
  return {label,count:values.length,average_seconds:average,average_label:average===null?'—':formatHoursMinutes(average)};
}
function diaryMetrics(state:AppState,start:string,end:string,seconds:Record<string,number>){
  const allowed=state.settings?.journal_analysis_enabled===true;
  const zeroDays=new Set(state.day_marks.filter(mark=>mark.kind==='zero').map(mark=>mark.mark_date));
  // Current account-wide opt-in supersedes legacy per-entry sharing and exclusion flags.
  const entries=allowed?state.journal_entries.filter(entry=>entry.journal_date>=start&&entry.journal_date<=end
    &&((seconds[entry.journal_date]??0)>0||zeroDays.has(entry.journal_date))):[];
  const definitions:{kind:DiaryKind;key:JournalEntry['ai_shared_fields'][number];a:string;b:string;
    classify:(entry:JournalEntry)=>'a'|'b'|null;describe:(entry:JournalEntry)=>string|null}[]=[
    {kind:'early_wake',key:'wake_at',a:'08.00 öncesi',b:'08.00 ve sonrası',classify:entry=>{
      const minute=clockMinutes(entry.structured_fields.wake_at);return minute===null?null:minute<480?'a':'b';},
      describe:entry=>clockMinutes(entry.structured_fields.wake_at)===null?null:`${entry.structured_fields.wake_at} kalkış`},
    {kind:'stress',key:'stress',a:'Düşük stres (1–2)',b:'Yüksek stres (4–5)',classify:entry=>{
      const value=entry.structured_fields.stress;return value===1||value===2?'a':value===4||value===5?'b':null;},
      describe:entry=>{const value=entry.structured_fields.stress;return typeof value==='number'&&value>=1&&value<=5?`stres ${value}/5`:null;}},
    {kind:'sleep',key:'sleep_at',a:'En az 7 saat uyku',b:'7 saatten az uyku',classify:entry=>{
      const duration=sleepMinutes(entry);return duration===null?null:duration>=420?'a':'b';},
      describe:entry=>{const duration=sleepMinutes(entry);return duration===null?null:`${formatHoursMinutes(duration*60)} uyku`;}},
    {kind:'mood',key:'mood',a:'Olumlu ruh hâli',b:'Olumsuz ruh hâli',classify:entry=>{
      const value=normalizedMood(entry.structured_fields.mood);return value==='good'?'a':value==='low'?'b':null;},
      describe:entry=>{const value=normalizedMood(entry.structured_fields.mood);return value==='good'?'olumlu ruh hâli':value==='low'?'olumsuz ruh hâli':null;}},
  ];
  const insights=definitions.map(({kind,a,b,classify,describe})=>{
    const first:number[]=[],second:number[]=[];
    const examples:{date:string;text:string}[]=[];
    for(const entry of entries){
      const category=classify(entry);
      if(category==='a')first.push(seconds[entry.journal_date]??0);
      if(category==='b')second.push(seconds[entry.journal_date]??0);
      const detail=describe(entry);
      if(category&&detail)examples.push({date:entry.journal_date,
        text:`${entry.journal_date}: ${detail}, ${formatHoursMinutes(seconds[entry.journal_date]??0)} çalışma`});
    }
    const matched=first.length+second.length,sufficient=matched>=14&&first.length>=5&&second.length>=5;
    const groupA=group(a,first),groupB=group(b,second);
    const recent=examples.sort((x,y)=>y.date.localeCompare(x.date)).slice(0,2).map(item=>item.text);
    return {kind,type:sufficient?'association' as const:'observation' as const,sufficient_data:sufficient,
      matched_days:matched,group_a:groupA,group_b:groupB,
      text:sufficient?`${a} (${first.length} gün) ve ${b} (${second.length} gün) için kayıtlı çalışma ortalamaları ${groupA.average_label} ve ${groupB.average_label}; bu birlikte görülmedir, neden-sonuç kanıtı değildir.`:
        `Günlük–çalışma ilişkisi için kayıt sayısı sınırlı (${matched} eşleşmiş gün). ${recent.length?`Kayıtlı örnekler: ${recent.join('; ')}.`:'Şimdilik gün bazındaki gözlemleri izliyoruz.'}`};
  });
  const observations:DiaryObservation[]=entries.map(entry=>{
    const fields=entry.structured_fields,parts:string[]=[];
    if(clockMinutes(fields.wake_at)!==null)parts.push(`${fields.wake_at} kalkış`);
    const sleep=sleepMinutes(entry);if(sleep!==null)parts.push(`${formatHoursMinutes(sleep*60)} uyku`);
    if(typeof fields.stress==='number'&&fields.stress>=1&&fields.stress<=5)parts.push(`stres ${fields.stress}/5`);
    if(typeof fields.energy==='number'&&fields.energy>=1&&fields.energy<=5)parts.push(`enerji ${fields.energy}/5`);
    const mood=normalizedMood(fields.mood);if(mood)parts.push(mood==='good'?'olumlu ruh hâli':'olumsuz ruh hâli');
    return {date:entry.journal_date,text:parts.join(', '),study_label:formatHoursMinutes(seconds[entry.journal_date]??0)};
  }).filter(item=>item.text).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
  return {insights,observations};
}
function foldKey(value:string){return value.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');}
function examSeries(exams:ExamRecord[],kind:ExamKind):ExamSeries{
  const selected=exams.filter(exam=>kind==='TYT'?exam.format_code==='TYT':exam.format_code==='AYT_SAYISAL')
    .sort((a,b)=>a.exam_date.localeCompare(b.exam_date)||a.id.localeCompare(b.id));
  const warnings:string[]=[];
  const rows=selected.map(exam=>{
    const sections=exam.results.filter(result=>Number.isFinite(result.net)).map(result=>{
      const format=exam.format_snapshot.sections.find(item=>item.key===result.section_key);
      return {key:result.section_key,label:format?.label??result.section_key,net:result.net,question_count:format?.question_count??null};
    });
    const indexed=new Map(sections.map(section=>[foldKey(section.key),section]));
    if(kind==='TYT'){
      const social=['tarih','cografya','felsefe','din'].map(key=>indexed.get(key));
      if(social.every(Boolean)){
        const total=social.reduce((sum,item)=>sum+item!.net,0),questions=social.reduce((sum,item)=>sum+(item!.question_count??0),0);
        const geography=indexed.get('cografya')!;
        if(questions>0&&total>=questions*.7&&geography.net<=0.5)
          warnings.push(`${exam.name}: Sosyal ${Math.round(total*100)/100} net görünürken Coğrafya ${geography.net} net; toplam sonuç alt ders eksiğini gizleyebilir.`);
      }
    }
    for(const section of sections){
      if(section.question_count!==null&&section.question_count>0&&section.net/section.question_count<.25
        &&!warnings.some(text=>text.includes(exam.name)&&text.includes(section.label)))
        warnings.push(`${exam.name}: ${section.label} ${section.net} / ${section.question_count} net; bu dersin yanlış ve boşlarını inceleyip açık konusuna haftalık planda yer ayır.`);
    }
    return {id:exam.id,date:exam.exam_date,name:exam.name,total_net:exam.total_net,sections};
  });
  return {exams:rows,warnings};
}

/** Uses only persisted task, study, journal and exam records. It never mutates AppState. */
export function buildCoachingReportMetrics(state:AppState,options:CoachingReportOptions):CoachingReportMetrics{
  const cutoffMs=Date.parse(options.cutoff);
  if(!Number.isFinite(cutoffMs))throw new Error('Geçerli analiz kesim zamanı gerekli.');
  const today=localDate(cutoffMs,TIMEZONE),{start:weekStart,end:weekEnd}=weekBounds(today);
  const start=options.start??shiftDay(today,-13),end=options.end??today;
  if(!DAY.test(start)||!DAY.test(end)||start>end||end>today||!Number.isFinite(Date.parse(`${start}T12:00:00Z`))
    ||!Number.isFinite(Date.parse(`${end}T12:00:00Z`)))throw new Error('Geçerli ve geçmiş analiz dönemi gerekli.');
  const daily=secondsByDay(state,TIMEZONE,cutoffMs);
  const studySeconds=Object.entries(daily).filter(([date])=>date>=start&&date<=end).reduce((sum,[,value])=>sum+value,0);
  const practice=state.practice_entries.filter(entry=>entry.practice_date>=start&&entry.practice_date<=end);
  const currentPriority=priorityMetrics(state.tasks,weekStart,weekEnd,today);
  const weekExams=state.exams.filter(exam=>exam.exam_date>=weekStart&&exam.exam_date<=today);
  const previous=options.previous??null;
  const comparable=previous?.context.timezone===TIMEZONE&&sameElapsedWeekPosition(options.cutoff,previous.context.current_cutoff);
  const changes:CoachingReportMetrics['retrospective_changes']=[];
  if(comparable&&previous){
    const evidenceIds=[options.previousAnalysisId??`cutoff:${previous.context.current_cutoff}`,
      options.currentAnalysisId??`cutoff:${options.cutoff}`];
    const addRate=(metric:'high_priority_rate'|'all_task_rate',before:number|null,after:number|null)=>{
      if(before===null||after===null)return;
      changes.push({metric,previous:before,current:after,difference:Math.round((after-before)*10)/10,
        unit:'percentage_points',evidence_ids:evidenceIds});
    };
    addRate('high_priority_rate',previous.priority_summary.high.rate_percent,currentPriority.high.rate_percent);
    addRate('all_task_rate',previous.priority_summary.all.rate_percent,currentPriority.all.rate_percent);
    const currentDays=(Date.parse(`${end}T12:00:00Z`)-Date.parse(`${start}T12:00:00Z`))/86400000+1;
    const priorDays=(Date.parse(`${previous.study.end}T12:00:00Z`)-Date.parse(`${previous.study.start}T12:00:00Z`))/86400000+1;
    if(currentDays===priorDays)changes.push({metric:'study_duration',previous:previous.study.total_seconds,current:studySeconds,
      difference:studySeconds-previous.study.total_seconds,unit:'seconds',
      evidence_ids:evidenceIds});
  }
  const diary=diaryMetrics(state,start,end,daily),insights=diary.insights;
  const gaps:string[]=[];
  if(!previous)gaps.push('Önceki başarılı analiz bulunmadığından dönem değişimi hesaplanmadı.');
  else if(!comparable)gaps.push('Önceki analiz aynı hafta günü ve saatinde kesilmediğinden haftalık oranlar kıyaslanmadı.');
  if(state.settings?.journal_analysis_enabled!==true)gaps.push('Günlük analizi kapalı; günlük alanları rapora alınmadı.');
  else if(insights.every(item=>item.matched_days<14))gaps.push('Günlük ve çalışma eşleşmeleri ilişki yorumu için yetersiz.');
  if(weekExams.length===0)gaps.push('Bu hafta kayıtlı TYT veya AYT denemesi yok.');
  return {schema_version:1,context:{timezone:TIMEZONE,current_cutoff:options.cutoff,current_analysis_id:options.currentAnalysisId??null,
      cutoff_local_date:today,previous_cutoff:previous?.context.current_cutoff??null,
      previous_analysis_id:options.previousAnalysisId??null,week_start:weekStart,week_end:weekEnd},
    priority_summary:currentPriority,
    study:{start,end,total_seconds:studySeconds,duration_label:formatHoursMinutes(studySeconds),
      question_count:practice.reduce((sum,row)=>sum+row.question_count,0),
      test_count:practice.reduce((sum,row)=>sum+row.test_count,0)},
    retrospective_changes:changes,diary_insights:insights,diary_observations:diary.observations,
    weekly_exam:{start:weekStart,end:weekEnd,TYT:examSeries(weekExams,'TYT'),AYT:examSeries(weekExams,'AYT')},
    data_gaps:gaps};
}
