'use client';
import {useState} from 'react';
import {Check,Clock3,ListTodo,MoreHorizontal,Play,Plus,ArrowUp,ArrowDown} from 'lucide-react';
import type {AppState,Task} from '@/lib/domain/types';
import {localDate,studyTypes,type CommandFn} from '@/lib/ui';
import {Card,Empty,AddButton} from './primitives';
import {Modal} from './modal';
export function Tasks({state,command,busy,requestNew,onNewHandled}:{state:AppState;command:CommandFn;busy:boolean;requestNew:boolean;onNewHandled:()=>void}){
 const [date,setDate]=useState(localDate());const [filter,setFilter]=useState('all');const [draft,setDraft]=useState<Task|null|false>(false);
 const tasks=state.tasks.filter(t=>t.plan_date===date&&(filter==='all'||(filter==='done'?t.progress===1:t.progress<1))).sort((a,b)=>a.position-b.position);
 const close=()=>{setDraft(false);onNewHandled()};
 return <>
 <div className="toolbar"><div className="toolbar-group"><label className="inline-label">Plan tarihi<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><select aria-label="Görev durumu" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Tüm görevler</option><option value="open">Devam edenler</option><option value="done">Tamamlananlar</option></select></div><AddButton onClick={()=>setDraft(null)}/></div>
 <Card className={tasks.length===0?'ambient-card':''} title={date===localDate()?'Bugünün planı':'Günlük plan'} action={<span className="pill">{tasks.length} görev</span>}>
 {tasks.length===0?<Empty icon={<ListTodo size={30}/>} title="Planına yer aç" text="Bir görev ekle, çalışma süresini belirle ve ilerlemeyi adım adım takip et." action={<button className="button secondary" onClick={()=>setDraft(null)}><Plus size={17}/>İlk görevi ekle</button>}/>:<div className="task-list">{tasks.map((task,i)=><article className="task-item" key={task.id}>
 <div className="task-main"><button className={'check-button '+(task.progress===1?'checked':'')} aria-label={task.title+(task.progress===1?' tamamlamasını geri al':' görevini tamamla')} disabled={busy} onClick={()=>void command('task.update',{id:task.id,expected_revision:task.revision,progress:task.progress===1?0:1,steps:task.steps.map(s=>({...s,completed:task.progress!==1}))})}>{task.progress===1?<Check size={15}/>:task.progress>0?<span/>:null}</button><div className="task-description"><div className="task-tags">{task.exam&&<span className="pill">{task.exam} {task.subject}</span>}<span>{task.study_type}</span>{task.priority==='high'&&<span className="priority">Öncelikli</span>}</div><h3 className={task.progress===1?'done':''}>{task.title}</h3>{task.resource&&<p>{task.resource}</p>}<div className="task-meta"><span><Clock3 size={14}/>{task.planned_minutes} dk</span><span>{{easy:'Kolay',medium:'Orta',hard:'Zor'}[task.difficulty]}</span><span>%{Math.round(task.progress*100)} tamamlandı</span></div></div><button className="icon-button" aria-label={task.title+' düzenle'} onClick={()=>setDraft(task)}><MoreHorizontal size={20}/></button></div>
 {task.steps.length>0&&<div className="substeps">{task.steps.map(step=><label key={step.id}><input type="checkbox" checked={step.completed} disabled={busy} onChange={e=>void command('task.update',{id:task.id,expected_revision:task.revision,steps:task.steps.map(s=>s.id===step.id?{...s,completed:e.target.checked}:s)})}/>{step.title}</label>)}</div>}
 <div className="task-actions"><div><button className="icon-button" aria-label={task.title+' yukarı taşı'} disabled={busy||i===0} onClick={()=>void command('task.move',{id:task.id,expected_revision:task.revision,direction:'up'})}><ArrowUp size={16}/></button><button className="icon-button" aria-label={task.title+' aşağı taşı'} disabled={busy||i===tasks.length-1} onClick={()=>void command('task.move',{id:task.id,expected_revision:task.revision,direction:'down'})}><ArrowDown size={16}/></button></div><button className="text-button" disabled={busy||state.sessions.some(s=>s.status!=='finished')} onClick={()=>void command('timer.start',{title:task.title,task_id:task.id,topic_id:task.topic_id,subject:task.subject,study_type:task.study_type,mode:'stopwatch',target_seconds:null})}><Play size={15}/>Çalışmaya başla</button></div>
 </article>)}</div>}
 </Card>
 <p className="footnote">Görev tamamlamak konunun öğrenme düzeyini değiştirmez. Alt adımlar varsa her adım eşit pay alır.</p>
 {(requestNew||draft!==false)&&<Modal title={draft?'Görevi düzenle':'Yeni görev'} onClose={close}><TaskForm key={draft?draft.id:'new'} state={state} task={draft||null} date={date} busy={busy} onClose={close} onSave={async payload=>{if(await command(draft?'task.update':'task.create',draft?{...payload,id:draft.id,expected_revision:draft.revision}:payload))close()}}/></Modal>}
 </>;
}
function TaskForm({state,task,date,busy,onSave,onClose}:{state:AppState;task:Task|null;date:string;busy:boolean;onSave:(payload:Record<string,unknown>)=>Promise<void>;onClose:()=>void}){
 const [topic,setTopic]=useState(task?.topic_id??'');
 const [steps,setSteps]=useState(task?.steps??[]);
 return <form className="form-grid" onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const chosen=state.topics.find(t=>t.id===topic);await onSave({title:form.get('title'),plan_date:form.get('plan_date'),topic_id:topic||null,exam:chosen?.exam??null,subject:chosen?.subject??(String(form.get('subject')||'')||null),planned_minutes:Number(form.get('planned_minutes')),difficulty:form.get('difficulty'),progress:Number(form.get('progress'))/100,resource:form.get('resource'),notes:form.get('notes'),completion_criteria:form.get('completion_criteria'),study_type:form.get('study_type'),priority:form.get('priority'),weight_override:form.get('weight_override')?Number(form.get('weight_override')):null,steps})}}>
 <label className="span-2">Görev başlığı<input name="title" required maxLength={240} defaultValue={task?.title} placeholder="Örn. Polinomlar: iki test ve yanlış analizi" autoFocus/></label>
 <label>Tarih<input type="date" name="plan_date" required defaultValue={task?.plan_date??date}/></label><label>Planlanan net dakika<input type="number" min="0" max="1440" name="planned_minutes" defaultValue={task?.planned_minutes??40} required/></label>
 <label className="span-2">İlgili konu<select value={topic} onChange={e=>setTopic(e.target.value)}><option value="">Konu seçmeden çalış</option>{state.topics.map(t=><option key={t.id} value={t.id}>{t.exam} / {t.subject} / {t.name}</option>)}</select></label>
 {!topic&&<label className="span-2">Ders (isteğe bağlı)<input name="subject" defaultValue={task?.subject??''} placeholder="Örn. AYT Fizik"/></label>}
 <label>Çalışma türü<select name="study_type" defaultValue={task?.study_type??'Soru çözümü'}>{studyTypes.map(s=><option key={s}>{s}</option>)}</select></label>
 <label>Kişisel zorluk<select name="difficulty" defaultValue={task?.difficulty??'medium'}><option value="easy">Kolay</option><option value="medium">Orta</option><option value="hard">Zor</option></select></label>
 <label>Kaynak / test / sayfa<input name="resource" defaultValue={task?.resource} placeholder="Kitap ve test numarası"/></label>
 <label>Öncelik<select name="priority" defaultValue={task?.priority??'normal'}><option value="low">Düşük</option><option value="normal">Normal</option><option value="high">Yüksek</option></select></label>
 <label className="span-2">Tamamlanma ölçütü<input name="completion_criteria" defaultValue={task?.completion_criteria} placeholder="Hangi adımlar bittiğinde tamamlanmış sayılır?"/></label>
 <label>İlerleme (%)<input name="progress" type="number" min="0" max="100" step="1" defaultValue={Math.round((task?.progress??0)*100)} disabled={steps.length>0}/><small>Alt adımlar varsa onlardan hesaplanır.</small></label>
 <label>Özel ağırlık (isteğe bağlı)<input name="weight_override" type="number" min="0" step=".01" defaultValue={task?.weight_override??''}/><small>Boşsa dakika × zorluk katsayısı.</small></label>
 <fieldset className="span-2"><legend>Alt adımlar</legend>{steps.map((step,i)=><div className="step-edit" key={step.id}><input aria-label={(i+1)+'. alt adım'} required value={step.title} onChange={e=>setSteps(steps.map(s=>s.id===step.id?{...s,title:e.target.value}:s))}/><button type="button" className="text-button" onClick={()=>setSteps(steps.filter(s=>s.id!==step.id))}>Kaldır</button></div>)}<button type="button" className="text-button" onClick={()=>setSteps([...steps,{id:crypto.randomUUID(),title:'',completed:false}])}><Plus size={15}/>Alt adım ekle</button></fieldset>
 <label className="span-2">Notlar<textarea name="notes" rows={3} defaultValue={task?.notes}/></label>
 {!state.authenticated&&<p className="notice span-2">Kaydetmek için Supabase ve kişisel hesap kurulumu gerekli.</p>}
 <div className="form-actions span-2"><button className="button secondary" type="button" onClick={onClose}>Vazgeç</button><button className="button primary" disabled={busy||!state.authenticated}>{busy?'Kaydediliyor…':'Görevi kaydet'}</button></div>
 </form>
}

