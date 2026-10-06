import type {ReactNode} from 'react';
import type {AppState,Task} from '@/lib/domain/types';
import styles from './tasks.module.css';

type CourseGroup={id:string;label:string;term:string|null;tasks:Task[]};
const priorities=[{id:'high',label:'Yüksek öncelik'},{id:'normal',label:'Normal öncelik'},{id:'low',label:'Düşük öncelik'}] as const;
const priorityOrder={high:0,normal:1,low:2};

export function PendingTasks({state,tasks,renderTasks}:{state:AppState;tasks:Task[];renderTasks:(tasks:Task[])=>ReactNode}){
 const courses=new Map(state.education?.courses.map(course=>[course.id,course]));
 const terms=new Map(state.education?.terms.map(term=>[term.id,term]));
 const byCourse=new Map<string,CourseGroup>();
 for(const task of tasks){
  const course=task.course_id?courses.get(task.course_id):undefined;
  const id=task.course_id?'course:'+task.course_id:'legacy:'+JSON.stringify([task.exam,task.subject]);
  const label=[course?.exam??task.exam,course?.name??task.subject].filter(Boolean).join(' ')||'Ders belirtilmemiş';
  const term=course?.term_id?terms.get(course.term_id):undefined;
  let group=byCourse.get(id);
  if(!group){group={id,label,term:term?term.academic_year+' · '+term.name:null,tasks:[]};byCourse.set(id,group);}
  group.tasks.push(task);
 }
 const groups=Array.from(byCourse.values());
 for(const group of groups)group.tasks.sort((a,b)=>priorityOrder[a.priority]-priorityOrder[b.priority]||a.plan_date.localeCompare(b.plan_date)||a.position-b.position||a.id.localeCompare(b.id));
 groups.sort((a,b)=>priorityOrder[a.tasks[0].priority]-priorityOrder[b.tasks[0].priority]||a.label.localeCompare(b.label,'tr')||(a.term??'').localeCompare(b.term??'','tr')||a.id.localeCompare(b.id));
 return <section className={styles.archive+' '+styles.pending} aria-label="Bekleyen görevler">{groups.map(group=><section key={group.id} className={styles.courseGroup} data-testid="pending-course" aria-label={group.label}>
  <header className={styles.pendingCourseHeading}><div><h2>{group.label}</h2>{group.term&&<p>{group.term}</p>}</div><span className={styles.groupCount}>{group.tasks.length} görev</span></header>
  {priorities.map(priority=>{
   const items=group.tasks.filter(task=>task.priority===priority.id);
   return items.length>0&&<div key={priority.id} className={styles.pendingPriority} data-priority={priority.id}>
    <p className={styles.pendingPriorityHeading}><span>{priority.label}</span><span>{items.length} görev</span></p>
    {renderTasks(items)}
   </div>;
  })}
 </section>)}</section>;
}
