import { createHash } from 'node:crypto';
import type { AppState, JournalEntry, Task } from './domain/types';
import { taskCompletion } from './progress';
import { buildStudyReport } from './study-report';
import { localDate } from './ui';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const JOURNAL_FIELDS=new Set(['original_text','sleep_at','wake_at','sleep_quality','mood','energy','stress','environment','interruptions','activities','people_tags','food_drink','thoughts']);

export function validAnalysisRange(start:string,end:string,today:string):boolean {
  if(!DAY.test(start)||!DAY.test(end)||start>end||end>today)return false;
  const first=new Date(`${start}T12:00:00Z`),last=new Date(`${end}T12:00:00Z`);
  if(!Number.isFinite(first.getTime())||!Number.isFinite(last.getTime()))return false;
  return first.toISOString().slice(0,10)===start&&last.toISOString().slice(0,10)===end
    &&(last.getTime()-first.getTime())/86400000<=365;
}

function permittedJournal(entry:JournalEntry) {
  if(entry.exclude_from_analysis)return null;
  const allowed=new Set(entry.ai_shared_fields.filter(field=>JOURNAL_FIELDS.has(field)));
  const fields:Record<string,unknown>={};
  if(allowed.has('original_text')&&entry.original_text.trim())fields.original_text=entry.original_text.slice(0,4000);
  for(const [name,value] of Object.entries(entry.structured_fields))if(allowed.has(name))fields[name]=value;
  return Object.keys(fields).length?{date:entry.journal_date,fields}:null;
}

function taskWeights(tasks:Task[],factors:Record<'easy'|'medium'|'hard',number>) {
  return tasks.reduce((result,task)=>{
    const weight=task.weight_override??task.planned_minutes*factors[task.difficulty];
    result.planned+=weight;
    result.completed+=weight*taskCompletion(task);
    if(taskCompletion(task)===1)result.done++;
    return result;
  },{planned:0,completed:0,done:0});
}

export function buildAnalysisSnapshot(state:AppState,start:string,end:string,now=Date.parse(state.server_now)) {
  const timezone=state.settings?.timezone??'Europe/Istanbul';
  const today=localDate(now,timezone);
  if(!validAnalysisRange(start,end,today))throw new Error('Geçerli ve en fazla bir yıllık tarih aralığı gerekli.');
  const report=buildStudyReport(state,{start,end},now);
  const latestPlans=new Map<string,(typeof state.day_plans)[number]>();
  for(const plan of state.day_plans){const old=latestPlans.get(plan.plan_date);if(!old||old.version<plan.version)latestPlans.set(plan.plan_date,plan)}
  const journalByDate=new Map(state.journal_entries.filter(entry=>entry.journal_date>=start&&entry.journal_date<=end)
    .map(entry=>[entry.journal_date,permittedJournal(entry)]));
  const days=report.days.map(day=>{
    const plan=latestPlans.get(day.date);
    const tasks=plan?.snapshot??state.tasks.filter(task=>task.plan_date===day.date);
    const weights=taskWeights(tasks,plan?.difficulty_factors??state.settings?.difficulty_factors??{easy:1,medium:1.25,hard:1.5});
    const practice=state.practice_entries.filter(entry=>entry.practice_date===day.date);
    const examRows=state.exams.filter(exam=>exam.exam_date===day.date);
    return {date:day.date,status:day.status,seconds:day.seconds,target_minutes:day.targetMinutes,
      task_count:tasks.length,task_done:weights.done,task_weight:Math.round(weights.planned*100)/100,
      task_weight_done:Math.round(weights.completed*100)/100,
      question_count:practice.reduce((n,row)=>n+row.question_count,0),test_count:practice.reduce((n,row)=>n+row.test_count,0),
      exam_count:examRows.length,exam_nets:examRows.map(exam=>({id:exam.id,format:exam.format_code,net:exam.total_net})),
      journal:journalByDate.get(day.date)??null};
  });
  const sourceDays=days.filter(day=>day.seconds>0||day.task_count>0||day.question_count>0||day.exam_count>0||day.journal!==null)
    .map(day=>day.date);
  const half=Math.ceil(days.length/2);
  const summarizeHalf=(items:typeof days)=>({days:items.length,worked_days:items.filter(day=>day.seconds>0).length,
    observed_days:items.filter(day=>day.status==='worked'||day.status==='zero').length,
    total_seconds:items.reduce((sum,day)=>sum+day.seconds,0),exam_count:items.reduce((sum,day)=>sum+day.exam_count,0)});
  const examFormats=new Map<string,{format:string;sample_count:number;net_sample_count:number;net_sum:number}>();
  for(const exam of state.exams.filter(exam=>exam.exam_date>=start&&exam.exam_date<=end)){
    const row=examFormats.get(exam.format_code)??{format:exam.format_code,sample_count:0,net_sample_count:0,net_sum:0};
    row.sample_count++;if(exam.total_net!==null){row.net_sample_count++;row.net_sum+=exam.total_net}
    examFormats.set(exam.format_code,row);
  }
  const snapshot={period:{start,end,timezone},summary:{
    total_seconds:report.totalSeconds,average_observed_seconds:report.averageAllSeconds,
    average_worked_seconds:report.averageWorkedSeconds,worked_days:report.workedDays,
    rest_days:report.restDays,zero_days:report.zeroDays,missing_days:report.missingDays,
    source_days:sourceDays,data_days:sourceDays.length,
    question_count:days.reduce((n,day)=>n+day.question_count,0),test_count:days.reduce((n,day)=>n+day.test_count,0),
    exam_count:days.reduce((n,day)=>n+day.exam_count,0),
    first_half:summarizeHalf(days.slice(0,half)),second_half:summarizeHalf(days.slice(half)),
    exam_samples:[...examFormats.values()].map(row=>({format:row.format,sample_count:row.sample_count,net_sample_count:row.net_sample_count,average_net:row.net_sample_count?row.net_sum/row.net_sample_count:null})),
    subjects:report.subjects.slice(0,15),study_types:report.studyTypes.slice(0,15),
  },days};
  const sourceHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return {snapshot,sourceHash};
}
