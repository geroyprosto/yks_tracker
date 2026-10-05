'use client';

import {useMemo,useState} from 'react';
import {CheckCircle2,ChevronRight,ListTodo,Pencil,Undo2} from 'lucide-react';
import type {AppState,Task} from '@/lib/domain/types';
import {formatDay,type CommandFn} from '@/lib/ui';
import {Empty} from './primitives';
import styles from './tasks.module.css';

type ArchiveProps={state:AppState;tasks:Task[];command:CommandFn;busy:boolean;onEdit:(task:Task)=>void};
type CourseGroup={id:string;label:string;term:string|null;tasks:Task[]};
const pageSize=20;

export function CompletedTasks({state,tasks,command,busy,onEdit}:ArchiveProps){
 const groups=useMemo(()=>{
  const courses=new Map(state.education?.courses.map(course=>[course.id,course]));
  const terms=new Map(state.education?.terms.map(term=>[term.id,term]));
  const result=new Map<string,CourseGroup>();
  for(const task of tasks){
   const course=task.course_id?courses.get(task.course_id):undefined;
   const id=task.course_id?'course:'+task.course_id:'legacy:'+JSON.stringify([task.exam,task.subject]);
   const label=[course?.exam??task.exam,course?.name??task.subject].filter(Boolean).join(' ')||'Ders belirtilmemiş';
   const term=course?.term_id?terms.get(course.term_id):undefined;
   let group=result.get(id);
   if(!group){group={id,label,term:term?term.academic_year+' · '+term.name:null,tasks:[]};result.set(id,group);}
   group.tasks.push(task);
  }
  return Array.from(result.values()).map(group=>({...group,tasks:group.tasks.sort((a,b)=>b.plan_date.localeCompare(a.plan_date)||a.position-b.position||a.id.localeCompare(b.id))})).sort((a,b)=>a.label.localeCompare(b.label,'tr')||(a.term??'').localeCompare(b.term??'','tr')||a.id.localeCompare(b.id));
 },[tasks,state.education?.courses,state.education?.terms]);
 if(!groups.length)return <div className={styles.archiveEmpty}><Empty icon={<ListTodo size={30}/>} title="Henüz tamamlanan görev yok" text="Tamamladığın görevler burada derslerine göre listelenir."/></div>;
 return <section className={styles.archive} aria-label="Tamamlanan görevler">{groups.map(group=><CompletedCourse key={group.id} group={group} command={command} busy={busy} onEdit={onEdit}/>)}</section>;
}

function CompletedCourse({group,command,busy,onEdit}:{group:CourseGroup}&Pick<ArchiveProps,'command'|'busy'|'onEdit'>){
 const [open,setOpen]=useState(false);
 return <details className={styles.courseGroup} data-testid="completed-course" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className={styles.courseSummary}><ChevronRight size={17} aria-hidden="true"/><span className={styles.courseName}><strong>{group.label}</strong>{group.term&&<small>{group.term}</small>}</span><span className={styles.groupCount}>{group.tasks.length} görev</span></summary>
  {open&&<CompletedCourseRows tasks={group.tasks} command={command} busy={busy} onEdit={onEdit}/>}
 </details>;
}

function CompletedCourseRows({tasks,command,busy,onEdit}:Pick<ArchiveProps,'tasks'|'command'|'busy'|'onEdit'>){
 const [visible,setVisible]=useState(pageSize);
 return <div className={styles.archiveRows}>{tasks.slice(0,visible).map(task=><CompletedTask key={task.id} task={task} command={command} busy={busy} onEdit={onEdit}/>)}
  {tasks.length>visible&&<button type="button" className={'text-button '+styles.showMore} onClick={()=>setVisible(count=>count+pageSize)}>Daha fazla göster ({tasks.length-visible} görev)</button>}
 </div>;
}

function CompletedTask({task,command,busy,onEdit}:{task:Task}&Pick<ArchiveProps,'command'|'busy'|'onEdit'>){
 const [open,setOpen]=useState(false);
 return <details className={styles.completedTask} data-testid="completed-task" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className={styles.completedSummary}><CheckCircle2 size={18} className={styles.completedIcon} aria-label="Tamamlandı"/><span className={styles.completedTitle}>{task.title}</span><span className={styles.planDate}>Plan: {formatDay(task.plan_date,{day:'numeric',month:'short',year:'numeric'})}</span><ChevronRight size={15} aria-hidden="true"/></summary>
  {open&&<div className={styles.completedDetails}>
   <dl><dt>Plan tarihi</dt><dd>{formatDay(task.plan_date,{day:'numeric',month:'long',year:'numeric'})}</dd><dt>Planlanan süre</dt><dd>{task.planned_minutes} dakika</dd><dt>Çalışma türü</dt><dd>{task.study_type}</dd><dt>Zorluk</dt><dd>{{easy:'Kolay',medium:'Orta',hard:'Zor'}[task.difficulty]}</dd><dt>Öncelik</dt><dd>{{low:'Düşük',normal:'Normal',high:'Yüksek'}[task.priority]}</dd>{task.resource&&<><dt>Kaynak</dt><dd>{task.resource}</dd></>}{task.completion_criteria&&<><dt>Tamamlanma ölçütü</dt><dd>{task.completion_criteria}</dd></>}{task.notes&&<><dt>Notlar</dt><dd>{task.notes}</dd></>}</dl>
   {task.steps.length>0&&<div className={'substeps '+styles.archiveSteps}>{task.steps.map(step=><label key={step.id}><input type="checkbox" checked={step.completed} disabled={busy} onChange={event=>void command('task.update',{id:task.id,expected_revision:task.revision,steps:task.steps.map(item=>item.id===step.id?{...item,completed:event.target.checked}:item)})}/><span>{step.title}</span></label>)}</div>}
   <div className={styles.detailActions}><button type="button" className="text-button" aria-label={task.title+' düzenle'} disabled={busy} onClick={()=>onEdit(task)}><Pencil size={14} aria-hidden="true"/>Düzenle</button><button type="button" className="text-button" aria-label={task.title+' — Tamamlamayı geri al'} disabled={busy} onClick={()=>void command('task.update',{id:task.id,expected_revision:task.revision,progress:0,steps:task.steps.map(step=>({...step,completed:false}))})}><Undo2 size={14} aria-hidden="true"/>Tamamlamayı geri al</button></div>
  </div>}
 </details>;
}
