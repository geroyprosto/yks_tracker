import type {AppState} from './domain/types';
import {secondsByDay} from './timing';
import {localDate} from './ui';

export type StudyReportPeriod='day'|'week'|'month'|'year'|'custom';
export type StudyDayStatus='ongoing'|'worked'|'rest'|'zero'|'planned-missing'|'missing';
export type StudyDay={date:string;seconds:number;targetMinutes:number|null;status:StudyDayStatus;goalMet:boolean;tasks:number;sessions:number;exams:number;hasJournal:boolean};
export type StudyFacet={label:string;seconds:number};
export type StudyReport={start:string;end:string;days:StudyDay[];totalSeconds:number;averageAllSeconds:number|null;averageWorkedSeconds:number|null;highestDay:StudyDay|null;workedDays:number;goalMetDays:number;restDays:number;zeroDays:number;missingDays:number;subjects:StudyFacet[];topics:StudyFacet[];studyTypes:StudyFacet[]};

function date(value:string){return new Date(`${value}T12:00:00Z`)}
function shift(value:string,amount:number){const d=date(value);d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10)}
export function studyReportRange(period:StudyReportPeriod,today:string,customStart?:string,customEnd?:string){
 if(period==='custom')return {start:customStart||today,end:customEnd||today};
 if(period==='day')return {start:today,end:today};
 if(period==='week')return {start:shift(today,-((date(today).getUTCDay()+6)%7)),end:today};
 if(period==='month')return {start:today.slice(0,7)+'-01',end:today};
 return {start:today.slice(0,4)+'-01-01',end:today};
}
export function buildStudyReport(state:AppState,range:{start:string;end:string},now=Date.parse(state.server_now)):StudyReport{
 const timezone=state.settings?.timezone??'Europe/Istanbul';const today=localDate(now,timezone);
 const first=Date.parse(range.start+'T12:00:00Z'),last=Date.parse(range.end+'T12:00:00Z');
 if(!Number.isFinite(first)||!Number.isFinite(last)||first>last||last-first>3660*86400000)throw new Error('Geçerli, en fazla 10 yıllık tarih aralığı gerekli.');
 const daily=secondsByDay(state,timezone,now);
 const latestPlans=new Map<string,(typeof state.day_plans)[number]>();
 for(const plan of state.day_plans){const previous=latestPlans.get(plan.plan_date);if(!previous||previous.version<plan.version)latestPlans.set(plan.plan_date,plan)}
 const marks=new Map((state.day_marks??[]).map(mark=>[mark.mark_date,mark.kind]));
 const countByDate=(dates:string[])=>{const counts=new Map<string,number>();for(const day of dates)counts.set(day,(counts.get(day)??0)+1);return counts};
 const taskCounts=countByDate(state.tasks.map(task=>task.plan_date));
 const sessionCounts=countByDate([...state.sessions.map(session=>localDate(Date.parse(session.started_at),timezone)),...(state.manual_study_entries??[]).map(entry=>entry.study_date)]);
 const examCounts=countByDate(state.exams.map(exam=>exam.exam_date));
 const journalDates=new Set(state.journal_entries.map(entry=>entry.journal_date));
 const dayList:StudyDay[]=[];
 for(let cursor=range.start;cursor<=range.end;cursor=shift(cursor,1)){
  const seconds=daily[cursor]??0;const plan=latestPlans.get(cursor);const mark=marks.get(cursor);
  const status:StudyDayStatus=seconds>0?(cursor===today?'ongoing':'worked'):mark==='rest'?'rest':mark==='zero'?'zero':cursor===today?'ongoing':plan?'planned-missing':'missing';
  dayList.push({date:cursor,seconds,targetMinutes:plan?.target_minutes??null,status,goalMet:seconds>0&&!!plan?.target_minutes&&seconds>=plan.target_minutes*60,tasks:taskCounts.get(cursor)??0,sessions:sessionCounts.get(cursor)??0,exams:examCounts.get(cursor)??0,hasJournal:journalDates.has(cursor)});
 }
 const inRange=new Set(dayList.map(day=>day.date));
 const topicNames=new Map(state.topics.map(topic=>[topic.id,`${topic.subject} / ${topic.name}`]));
 const facetMaps={subjects:new Map<string,number>(),topics:new Map<string,number>(),studyTypes:new Map<string,number>()};
 const add=(map:Map<string,number>,key:string,seconds:number)=>map.set(key,(map.get(key)??0)+seconds);
 const intervalsBySession=new Map<string,typeof state.intervals>();
 for(const interval of state.intervals){const items=intervalsBySession.get(interval.session_id)??[];items.push(interval);intervalsBySession.set(interval.session_id,items)}
 for(const session of state.sessions){
  const intervals=intervalsBySession.get(session.id)??[];if(!intervals.length)continue;
  const totals=secondsByDay({sessions:[session],intervals},timezone,now);
  const seconds=Object.entries(totals).reduce((sum,[day,value])=>sum+(inRange.has(day)?value:0),0);if(!seconds)continue;
  add(facetMaps.subjects,session.subject??'Ders belirtilmedi',seconds);
  add(facetMaps.topics,session.topic_id?topicNames.get(session.topic_id)??'Konu silinmiş':'Konu belirtilmedi',seconds);
  add(facetMaps.studyTypes,session.study_type,seconds);
 }
 for(const entry of state.manual_study_entries??[]){
  if(!inRange.has(entry.study_date))continue;
  add(facetMaps.subjects,entry.subject,entry.duration_seconds);
  add(facetMaps.topics,'Konu belirtilmedi',entry.duration_seconds);
  add(facetMaps.studyTypes,'Tür belirtilmedi',entry.duration_seconds);
 }
 const facets=(map:Map<string,number>):StudyFacet[]=>[...map].map(([label,seconds])=>({label,seconds})).sort((a,b)=>b.seconds-a.seconds||a.label.localeCompare(b.label,'tr'));
 const closedObserved=dayList.filter(day=>day.date<today&&(day.status==='worked'||day.status==='zero'));
 const closedWorked=closedObserved.filter(day=>day.seconds>0);
 const totalSeconds=dayList.reduce((sum,day)=>sum+day.seconds,0);
 const highestDay=dayList.reduce<StudyDay|null>((best,day)=>day.seconds>0&&(!best||day.seconds>best.seconds)?day:best,null);
 return {start:range.start,end:range.end,days:dayList,totalSeconds,
  averageAllSeconds:closedObserved.length?closedObserved.reduce((sum,day)=>sum+day.seconds,0)/closedObserved.length:null,
  averageWorkedSeconds:closedWorked.length?closedWorked.reduce((sum,day)=>sum+day.seconds,0)/closedWorked.length:null,
  highestDay,workedDays:dayList.filter(day=>day.seconds>0).length,goalMetDays:dayList.filter(day=>day.goalMet).length,
  restDays:dayList.filter(day=>day.status==='rest').length,zeroDays:dayList.filter(day=>day.status==='zero').length,
  missingDays:dayList.filter(day=>day.status==='missing'||day.status==='planned-missing').length,
  subjects:facets(facetMaps.subjects),topics:facets(facetMaps.topics),studyTypes:facets(facetMaps.studyTypes)};
}
