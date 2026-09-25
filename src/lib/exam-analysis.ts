import type {ExamRecord} from './domain/types';

export type ExamPeriod='week'|'month'|'two-months'|'all'|'custom';
export type ExamGrouping='exam'|'week'|'month';
export type ExamMeasure='net'|'accuracy'|'seconds-per-question';
export type ExamPoint={key:string;label:string;value:number|null;count:number;date:string};

function day(value:string){return new Date(`${value}T12:00:00Z`)}
function shift(value:string,days:number){const date=day(value);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
function monday(value:string){return shift(value,-((day(value).getUTCDay()+6)%7))}
function monthStart(value:string){return value.slice(0,7)+'-01'}
function nextMonth(value:string){const date=day(monthStart(value));date.setUTCMonth(date.getUTCMonth()+1);return date.toISOString().slice(0,10)}
function label(value:string,grouping:ExamGrouping){
 if(grouping==='month')return new Intl.DateTimeFormat('tr-TR',{month:'short',year:'2-digit',timeZone:'UTC'}).format(day(value));
 return new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'short',timeZone:'UTC'}).format(day(value));
}
export function examRange(period:ExamPeriod,today:string,customStart?:string,customEnd?:string){
 const end=period==='custom'&&customEnd?customEnd:today;
 const start=period==='week'?monday(today):period==='month'?monthStart(today):period==='two-months'?monthStart(shift(monthStart(today),-1)):period==='custom'?customStart||today:'0001-01-01';
 return {start,end};
}
export function examValue(exam:ExamRecord,sectionKey:string,measure:ExamMeasure):number|null{
 const result=sectionKey==='total'?null:exam.results.find(item=>item.section_key===sectionKey);
 if(measure==='net')return sectionKey==='total'?exam.total_net:result?.net??null;
 const questions=sectionKey==='total'?exam.format_snapshot.total_questions:exam.format_snapshot.sections.find(item=>item.key===sectionKey)?.question_count;
 if(!questions)return null;
 if(measure==='accuracy'){
  if(sectionKey==='total'){
   if(exam.results.length!==exam.format_snapshot.sections.length||exam.results.some(item=>item.correct===null))return null;
   return 100*exam.results.reduce((sum,item)=>sum+(item.correct??0),0)/questions;
  }
  return result?.correct===null||result?.correct===undefined?null:100*result.correct/questions;
 }
 if(exam.duration_minutes===null||sectionKey!=='total')return null;
 return exam.duration_minutes*60/questions;
}
export function examSeries(exams:ExamRecord[],options:{format:string;publisher:string;section:string;measure:ExamMeasure;grouping:ExamGrouping;start:string;end:string}):ExamPoint[]{
 const selected=exams.filter(exam=>exam.format_code===options.format&&(!options.publisher||exam.publisher===options.publisher)&&exam.exam_date>=options.start&&exam.exam_date<=options.end).sort((a,b)=>a.exam_date.localeCompare(b.exam_date)||a.created_at.localeCompare(b.created_at));
 if(options.grouping==='exam')return selected.map(exam=>({key:exam.id,label:label(exam.exam_date,'exam'),value:examValue(exam,options.section,options.measure),count:examValue(exam,options.section,options.measure)===null?0:1,date:exam.exam_date}));
 if(!selected.length&&options.start==='0001-01-01')return [];
 const from=options.start==='0001-01-01'?(selected[0]?.exam_date??options.end):options.start;
 const first=options.grouping==='week'?monday(from):monthStart(from);
 const last=options.grouping==='week'?monday(options.end):monthStart(options.end);
 const byBucket=new Map<string,number[]>();
 for(const exam of selected){const value=examValue(exam,options.section,options.measure);if(value===null)continue;const key=options.grouping==='week'?monday(exam.exam_date):monthStart(exam.exam_date);const bucket=byBucket.get(key)??[];bucket.push(value);byBucket.set(key,bucket)}
 const points:ExamPoint[]=[];
 for(let cursor=first;cursor<=last;cursor=options.grouping==='week'?shift(cursor,7):nextMonth(cursor)){
  const values=byBucket.get(cursor)??[];
  points.push({key:cursor,label:label(cursor,options.grouping),date:cursor,value:values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null,count:values.length});
 }
 return points;
}
