import { createHash } from 'node:crypto';
import type { AppState, JournalEntry, Task, Topic } from './domain/types';
import { taskCompletion } from './progress';
import { buildStudyReport } from './study-report';
import { localDate } from './ui';
import {GUIDANCE_SOURCES,REPORT_SCHEMA_VERSION} from './ai-report';
import {secondsByDay} from './timing';

const DAY=/^\d{4}-\d{2}-\d{2}$/;

export function validAnalysisRange(start:string,end:string,today:string):boolean {
  if(!DAY.test(start)||!DAY.test(end)||start>end||end>today)return false;
  const first=new Date(`${start}T12:00:00Z`),last=new Date(`${end}T12:00:00Z`);
  if(!Number.isFinite(first.getTime())||!Number.isFinite(last.getTime()))return false;
  return first.toISOString().slice(0,10)===start&&last.toISOString().slice(0,10)===end
    &&(last.getTime()-first.getTime())/86400000<=365;
}

function permittedJournal(entry:JournalEntry) {
  const fields:Record<string,unknown>={};
  if(entry.original_text.trim())fields.original_text=entry.original_text;
  for(const [name,value] of Object.entries(entry.structured_fields))fields[name]=value;
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
  const journalByDate=new Map((state.settings?.journal_analysis_enabled===true?state.journal_entries:[])
    .filter(entry=>entry.journal_date>=start&&entry.journal_date<=end)
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

/** A versioned, bounded student snapshot; no names, email, raw PDFs or full history. */
export function buildStudentAnalysisSnapshot(state:AppState,start:string,end:string) {
  const base=buildAnalysisSnapshot(state,start,end);
  const education=state.education;
  const profile=education?.profile;
  const timezone=state.settings?.timezone??'Europe/Istanbul';
  const selectedSessions=state.sessions.filter(row=>localDate(Date.parse(row.started_at),timezone)<=end&&localDate(Date.parse(row.finished_at??state.server_now),timezone)>=start);
  const selectedTasks=state.tasks.filter(row=>row.plan_date>=start&&row.plan_date<=end);
  const selected=(education?.results??[]).filter(row=>row.exam_date>=start&&row.exam_date<=end);
  const selectedIds=new Set(selected.map(row=>row.course_id));
  for(const row of [...selectedSessions,...selectedTasks])if(row.course_id)selectedIds.add(row.course_id);
  const courses=(education?.courses??[]).filter(course=>selectedIds.has(course.id)||(!course.archived&&(course.term_id===profile?.active_term_id||(course.context==='yks'&&profile?.yks_goal!==false))))
    .slice(0,80).map(course=>({id:course.id,name:course.name,context:course.context,exam:course.exam,term_id:course.term_id}));
  const allowedCourses=new Set(courses.map(course=>course.id));
  const results=selected.filter(row=>allowedCourses.has(row.course_id)).slice(0,120).map(row=>({evidence_id:`result:${row.id}`,
    course_id:row.course_id,course_name:row.course_name,date:row.exam_date,assessment_type:row.assessment_type,
    assessment_name:row.assessment_name,score:row.score,scale:row.scale,percentage:Math.round(row.score/row.scale*10000)/100}));
  const sourceDays=[...new Set([...base.snapshot.summary.source_days,...results.map(row=>row.date)])].sort();
  const evidence=[...sourceDays.map(day=>({id:`day:${day}`,date:day})),...results.map(row=>({id:row.evidence_id,date:row.date}))];
  const courseStudy=courses.map(course=>{
    const sessions=selectedSessions.filter(row=>row.course_id===course.id),ids=new Set(sessions.map(row=>row.id));
    const totals=secondsByDay({sessions,intervals:state.intervals.filter(row=>ids.has(row.session_id)),manual_study_entries:(state.manual_study_entries??[]).filter(row=>row.course_id===course.id)},timezone,Date.parse(state.server_now));
    const tasks=selectedTasks.filter(row=>row.course_id===course.id);
    return {course_id:course.id,context:course.context,exam:course.exam,term_id:course.term_id,
      seconds:Object.entries(totals).filter(([date])=>date>=start&&date<=end).reduce((n,[,seconds])=>n+seconds,0),
      task_count:tasks.length,completed_task_count:tasks.filter(task=>taskCompletion(task)===1).length};
  });
  const recordCount=base.snapshot.days.reduce((n,day)=>n+day.task_count+day.exam_count+(day.journal?1:0),0)
    +selectedSessions.length+selected.length
    +state.practice_entries.filter(row=>row.practice_date>=start&&row.practice_date<=end).length
    +(state.manual_study_entries??[]).filter(row=>row.study_date>=start&&row.study_date<=end).length;
  const snapshot={schema_version:2,period:base.snapshot.period,
    education:profile?{level:profile.education_level,grade:profile.grade,department:profile.department,university_year:profile.university_year,yks_goal:profile.yks_goal,active_term_id:profile.active_term_id}:{level:'graduate',yks_goal:true},
    courses,results,evidence,course_study:courseStudy,summary:{...base.snapshot.summary,subjects:undefined,source_days:sourceDays,data_days:sourceDays.length,
      record_count:recordCount,course_result_count:selected.length,omitted_result_count:selected.length-results.length},days:base.snapshot.days};
  return {snapshot,sourceHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}

function shiftDay(day:string,amount:number){
  const value=new Date(`${day}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+amount);return value.toISOString().slice(0,10);
}
function weekBounds(day:string){
  const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekStart=shiftDay(day,-((weekday+6)%7));
  return {weekStart,weekEnd:shiftDay(weekStart,6)};
}
function percent(numerator:number,denominator:number){return denominator?Math.round(numerator/denominator*1000)/10:null;}

function topicStatusBySubject(topics:Topic[]){
  type Counts={not_started:number;learning:number;instruction_finished:number;solving_questions:number;mastered:number};
  const groups=new Map<string,{exam:Topic['exam'];subject:string;total:number;mastery_counts:Counts;topics:Topic[]}>();
  const masteryKeys=(['not_started','learning','instruction_finished','solving_questions','mastered'] as const);
  for(const topic of topics){
    const key=JSON.stringify([topic.exam,topic.subject]);
    let group=groups.get(key);
    if(!group){group={exam:topic.exam,subject:topic.subject,total:0,
      mastery_counts:{not_started:0,learning:0,instruction_finished:0,solving_questions:0,mastered:0},topics:[]};groups.set(key,group)}
    group.total++;
    const mastery=Number.isInteger(topic.mastery)&&topic.mastery>=0&&topic.mastery<=4?topic.mastery:0;
    group.mastery_counts[masteryKeys[mastery]]++;
    group.topics.push(topic);
  }
  return [...groups.values()].sort((a,b)=>a.exam.localeCompare(b.exam)||a.subject.localeCompare(b.subject,'tr'))
    .map(({exam,subject,total,mastery_counts,topics:groupTopics})=>{
      const unfinished=groupTopics.filter(topic=>topic.mastery<4)
        .sort((a,b)=>Number(b.review_requested)-Number(a.review_requested)
          ||Number(a.mastery===0)-Number(b.mastery===0)
          ||b.updated_at.localeCompare(a.updated_at)
          ||a.name.localeCompare(b.name,'tr')||a.id.localeCompare(b.id));
      return {exam,subject,total,mastery_counts,
        next_topics:unfinished.slice(0,5).map(topic=>({id:topic.id,name:topic.name,mastery:topic.mastery,
          next_step:topic.next_step,review_requested:topic.review_requested})),
        omitted_next_topics_count:Math.max(0,unfinished.length-5)};
    });
}

function taskPrioritySummary(tasks:Task[]){
  type Priority=Task['priority'];
  const priorities:Priority[]=['high','normal','low'];
  const groups=new Map<string,{exam:Task['exam'];subject:Task['subject'];priority:Priority;total:number;done:number}>();
  const overall={high:{total:0,done:0},normal:{total:0,done:0},low:{total:0,done:0}};
  for(const task of tasks){
    const done=taskCompletion(task)===1?1:0;
    const priority=task.priority;
    const key=JSON.stringify([task.exam,task.subject,priority]);
    let group=groups.get(key);
    if(!group){group={exam:task.exam,subject:task.subject,priority,total:0,done:0};groups.set(key,group)}
    group.total++;group.done+=done;
    overall[priority].total++;overall[priority].done+=done;
  }
  const totalDone=priorities.reduce((sum,priority)=>sum+overall[priority].done,0);
  return {by_subject:[...groups.values()].sort((a,b)=>(a.exam??'').localeCompare(b.exam??'')
    ||(a.subject??'').localeCompare(b.subject??'','tr')||priorities.indexOf(a.priority)-priorities.indexOf(b.priority))
    .map(group=>({...group,completion_rate_percent:percent(group.done,group.total)})),
    overall:{total_done:totalDone,...Object.fromEntries(priorities.map(priority=>[priority,{
      ...overall[priority],completion_rate_percent:percent(overall[priority].done,overall[priority].total),
      share_of_completed_percent:percent(overall[priority].done,totalDone)}])) as Record<Priority,{total:number;done:number;completion_rate_percent:number|null;share_of_completed_percent:number|null}>}};
}
function preparationPhase(daysUntilExam:number|null,month:number){
  if(daysUntilExam===null){
    if(month>=9&&month<=11)return 'Takvime göre temel ve düzen (örnek)';
    if(month===12||month===1)return 'Takvime göre konu ve ilk denemeler (örnek)';
    if(month>=2&&month<=3)return 'Takvime göre deneme ve hedefli tekrar (örnek)';
    if(month>=4&&month<=6)return 'Takvime göre sınav provası (örnek)';
    return 'Temel ve çalışma düzeni (örnek)';
  }
  if(daysUntilExam>180)return 'Temel ve düzen';
  if(daysUntilExam>90)return 'Konu ve ilk denemeler';
  if(daysUntilExam>30)return 'Deneme ve hedefli tekrar';
  if(daysUntilExam>7)return 'Sınav provaları';
  return 'Son hafta';
}

/** New six-card input. The v2 builder above remains stable for saved report hashes. */
export function buildSixInsightSnapshot(state:AppState,start:string,end:string,guidanceAsOf?:string){
  const base=buildStudentAnalysisSnapshot(state,start,end);
  const timezone=state.settings?.timezone??'Europe/Istanbul';
  const asOf=guidanceAsOf??localDate(Date.parse(state.server_now),timezone);
  if(!DAY.test(asOf)||Number.isNaN(Date.parse(`${asOf}T12:00:00Z`)))throw new Error('Geçerli rehberlik tarihi gerekli.');
  const periodDays=Math.round((Date.parse(`${end}T12:00:00Z`)-Date.parse(`${start}T12:00:00Z`))/86400000)+1;
  const priorStart=shiftDay(start,-periodDays),priorEnd=shiftDay(start,-1);
  const previous=buildStudyReport(state,{start:priorStart,end:priorEnd},Date.parse(state.server_now));
  const current=base.snapshot.days;
  const observed=(days:typeof current)=>days.filter(day=>day.status==='worked'||day.status==='zero').length;
  const priorObserved=previous.days.filter(day=>day.status==='worked'||day.status==='zero').length;
  const topicById=new Map(state.topics.map(topic=>[topic.id,topic]));
  const changes=new Map<string,{id:string;exam:'TYT'|'AYT';subject:string;name:string;from_mastery:number;to_mastery:number;last_changed_at:string;date:string}>();
  const history=[...state.topic_history].filter(row=>{
    const date=localDate(Date.parse(row.changed_at),timezone);
    return date>=start&&date<=end&&topicById.has(row.topic_id)&&row.old_mastery!==row.new_mastery;
  }).sort((a,b)=>a.changed_at.localeCompare(b.changed_at));
  for(const row of history){
    const topic=topicById.get(row.topic_id)!;
    const date=localDate(Date.parse(row.changed_at),timezone);
    const previousChange=changes.get(row.topic_id);
    changes.set(row.topic_id,{id:row.topic_id,exam:topic.exam,subject:topic.subject,name:topic.name,
      from_mastery:previousChange?.from_mastery??row.old_mastery,to_mastery:row.new_mastery,last_changed_at:row.changed_at,date});
  }
  const allProgress=[...changes.values()].sort((a,b)=>b.last_changed_at.localeCompare(a.last_changed_at));
  const completed=allProgress.filter(topic=>topic.from_mastery<2&&topic.to_mastery>=2).length;
  const progressed=allProgress.filter(topic=>topic.to_mastery>topic.from_mastery).length;
  const topicProgress=allProgress.slice(0,40);
  const topicDays=allProgress.map(row=>row.date);
  const sourceDays=[...new Set([...base.snapshot.summary.source_days,...topicDays])].sort();
  const evidence=[...base.snapshot.evidence,...sourceDays.filter(date=>!base.snapshot.summary.source_days.includes(date)).map(date=>({id:`day:${date}`,date})),
    ...previous.days.filter(day=>day.seconds>0||day.status==='zero').map(day=>({id:`day:${day.date}`,date:day.date}))];
  const examDate=state.settings?.exam_date??null;
  const daysUntilExam=examDate&&DAY.test(examDate)&&examDate>=asOf
    ?Math.round((Date.parse(`${examDate}T12:00:00Z`)-Date.parse(`${asOf}T12:00:00Z`))/86400000):null;
  const yksGoal=base.snapshot.education.yks_goal!==false;
  const phase=yksGoal?preparationPhase(daysUntilExam,Number(asOf.slice(5,7))):'Ders planı ve düzen';
  const periodTasks=state.tasks.filter(task=>task.plan_date>=start&&task.plan_date<=end);
  const periodPriority=taskPrioritySummary(periodTasks);
  const {weekStart,weekEnd}=weekBounds(asOf);
  const weekPriority=taskPrioritySummary(state.tasks.filter(task=>task.plan_date>=weekStart&&task.plan_date<=asOf));
  const pastDueThrough=shiftDay(asOf,-1);
  const pastDuePriority=taskPrioritySummary(state.tasks.filter(task=>task.plan_date>=weekStart&&task.plan_date<=pastDueThrough));
  const sharedDayCount=current.filter(day=>day.journal!==null).length;
  const currentStudySeconds=current.reduce((sum,day)=>sum+day.seconds,0);
  const reportMetrics={
    topics:{completed,progressed},
    regularity:{days:current.slice(-7).map(day=>({date:day.date,seconds:day.seconds>0||day.status==='zero'?day.seconds:null,status:day.status}))},
    journal:{shared_day_count:sharedDayCount},
    wins:{current:{observed_days:observed(current),study_seconds:currentStudySeconds},previous:{observed_days:priorObserved,study_seconds:previous.totalSeconds}},
    improvements:{task_done:periodPriority.overall.total_done,task_count:periodTasks.length,priority:periodPriority.overall},
    timing:{month:Number(asOf.slice(5,7)),phase,as_of:asOf},
  };
  const snapshot={...base.snapshot,schema_version:REPORT_SCHEMA_VERSION,
    summary:{...base.snapshot.summary,source_days:sourceDays,data_days:sourceDays.length},evidence,
    topic_progress:topicProgress,omitted_topic_progress_count:allProgress.length-topicProgress.length,
    topic_status_by_subject:topicStatusBySubject(state.topics),
    task_priority_by_subject:periodPriority.by_subject,
    weekly_task_priority:{week_start:weekStart,week_end:weekEnd,observed_through:asOf,...weekPriority,
      past_due:{through:pastDueThrough,...pastDuePriority}},
    prior_period:{start:priorStart,end:priorEnd,observed_days:priorObserved,worked_days:previous.workedDays,
      study_seconds:previous.totalSeconds,exam_count:previous.days.reduce((sum,day)=>sum+day.exams,0)},
    timing_guidance:{as_of:asOf,exam_date:daysUntilExam===null?null:examDate,
      exam_date_source:daysUntilExam===null?null:'user_setting' as const,days_until_exam:daysUntilExam,
      target_rank:state.settings?.target_rank??null,
      phase,month:Number(asOf.slice(5,7)),sources:yksGoal?GUIDANCE_SOURCES.map(source=>({title:source.title,url:source.url,principle:source.principle})):[]},
    report_metrics:reportMetrics};
  return {snapshot,sourceHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}
