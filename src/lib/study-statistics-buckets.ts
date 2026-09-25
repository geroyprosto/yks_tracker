import type {Task} from './domain/types';
import type {StudyReport, StudyReportPeriod} from './study-report';

export type StudyChartGranularity='day'|'week'|'month'|'year';

/** A chart interval. `taskCount` counts planned tasks; completion uses plan_date. */
export type StudyChartBucket = {
 key:string;
 label:string;
 start:string;
 end:string;
 granularity:StudyChartGranularity;
 averageSeconds:number|null;
 totalSeconds:number;
 taskCount:number;
 completedTaskCount:number;
 observedDays:number;
};

export type StudyChartSummary={
 totalSeconds:number;
 averageBucketSeconds:number;
 bestBucket:StudyChartBucket|null;
 completedTaskCount:number;
 averageCompletedTasks:number;
};

type BucketRange=Pick<StudyChartBucket,'key'|'label'|'start'|'end'>;
type CompletionTask=Pick<Task,'plan_date'|'progress'>;

const dayLabel=new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'short',timeZone:'UTC'});
const monthLabel=new Intl.DateTimeFormat('tr-TR',{month:'short',timeZone:'UTC'});

function utcDate(value:string){return new Date(`${value}T12:00:00Z`)}
function addDays(value:string,amount:number){
 const date=utcDate(value);
 date.setUTCDate(date.getUTCDate()+amount);
 return date.toISOString().slice(0,10);
}
function nextMonth(value:string){
 const year=Number(value.slice(0,4));
 const month=Number(value.slice(5,7));
 return new Date(Date.UTC(year,month,1,12)).toISOString().slice(0,10);
}
function shortDay(value:string){return dayLabel.format(utcDate(value))}
function rangeDayCount(start:string,end:string){
 return Math.floor((utcDate(end).getTime()-utcDate(start).getTime())/86400000)+1;
}

function dailyRanges(start:string,end:string):BucketRange[]{
 const ranges:BucketRange[]=[];
 const crossesMonth=start.slice(0,7)!==end.slice(0,7);
 for(let date=start;date<=end;date=addDays(date,1)){
  ranges.push({key:date,label:crossesMonth?shortDay(date):String(Number(date.slice(8,10))),start:date,end:date});
 }
 return ranges;
}

function weeklyRanges(start:string,end:string):BucketRange[]{
 const ranges:BucketRange[]=[];
 const weekday=(utcDate(start).getUTCDay()+6)%7;
 for(let monday=addDays(start,-weekday);monday<=end;monday=addDays(monday,7)){
  const first=monday<start?start:monday;
  const sunday=addDays(monday,6);
  const last=sunday>end?end:sunday;
  ranges.push({key:`week-${monday}`,label:`${shortDay(first)}–${shortDay(last)}`,start:first,end:last});
 }
 return ranges;
}

function monthlyRanges(start:string,end:string,showYear:boolean):BucketRange[]{
 const ranges:BucketRange[]=[];
 for(let month=`${start.slice(0,7)}-01`;month<=end;month=nextMonth(month)){
  const first=month<start?start:month;
  const monthEnd=addDays(nextMonth(month),-1);
  const last=monthEnd>end?end:monthEnd;
  const label=monthLabel.format(utcDate(month));
  ranges.push({key:month.slice(0,7),label:showYear?`${label} ${month.slice(0,4)}`:label,start:first,end:last});
 }
 return ranges;
}

function yearlyRanges(start:string,end:string):BucketRange[]{
 const ranges:BucketRange[]=[];
 for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++){
  const first=`${year}-01-01`;
  const last=`${year}-12-31`;
  ranges.push({key:String(year),label:String(year),start:first<start?start:first,end:last>end?end:last});
 }
 return ranges;
}

/**
 * Graphs show totals per day, calendar week, month, or year.
 * `averageSeconds` is retained for report consumers: it describes only closed
 * observed days. The chart summary instead averages displayed bucket totals.
 * Neither calculation changes missing/rest/ongoing day status in the report.
 */
export function buildStudyChartBuckets(report:StudyReport,period:StudyReportPeriod,tasks:readonly CompletionTask[]=[],granularityOverride?:StudyChartGranularity):StudyChartBucket[]{
 const {start,end}=report;
 if(start>end)return [];
 let granularity:StudyChartGranularity;
 if(granularityOverride)granularity=granularityOverride;
 else if(period==='month')granularity='week';
 else if(period==='year')granularity='month';
 else if(period==='custom'){
  const days=rangeDayCount(start,end);
  granularity=days<=14?'day':days<=120?'week':days<=731?'month':'year';
 }else granularity='day';
 const ranges=granularity==='year'?yearlyRanges(start,end):
  granularity==='month'?monthlyRanges(start,end,start.slice(0,4)!==end.slice(0,4)):
  granularity==='week'?weeklyRanges(start,end):dailyRanges(start,end);
 const buckets:StudyChartBucket[]=ranges.map(range=>({...range,granularity,averageSeconds:null,totalSeconds:0,taskCount:0,completedTaskCount:0,observedDays:0}));
 const bucketByDay=new Map<string,StudyChartBucket>();
 for(const bucket of buckets){
  for(let date=bucket.start;date<=bucket.end;date=addDays(date,1))bucketByDay.set(date,bucket);
 }
 for(const day of report.days){
  const bucket=bucketByDay.get(day.date);
  if(!bucket)continue;
  bucket.totalSeconds+=day.seconds;
  bucket.taskCount+=day.tasks;
  if(day.status==='worked'||day.status==='zero'){
   bucket.observedDays++;
   bucket.averageSeconds=(bucket.averageSeconds??0)+day.seconds;
  }
 }
 for(const bucket of buckets){
  if(bucket.averageSeconds!==null)bucket.averageSeconds/=bucket.observedDays;
 }
 for(const task of tasks){
  if(task.progress>=1){
   const bucket=bucketByDay.get(task.plan_date);
   if(bucket)bucket.completedTaskCount++;
  }
 }
 return buckets;
}

/** Mean of recorded totals across every displayed interval, including empty ones. */
export function summarizeStudyChartBuckets(buckets:readonly StudyChartBucket[]):StudyChartSummary{
 const totalSeconds=buckets.reduce((sum,bucket)=>sum+bucket.totalSeconds,0);
 const completedTaskCount=buckets.reduce((sum,bucket)=>sum+bucket.completedTaskCount,0);
 const bestBucket=buckets.reduce<StudyChartBucket|null>((best,bucket)=>
  bucket.totalSeconds>0&&(!best||bucket.totalSeconds>best.totalSeconds)?bucket:best,null);
 return {totalSeconds,averageBucketSeconds:buckets.length?totalSeconds/buckets.length:0,bestBucket,
  completedTaskCount,averageCompletedTasks:buckets.length?completedTaskCount/buckets.length:0};
}

