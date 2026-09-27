'use client';

import {createContext,useContext,useRef,useState} from 'react';
import type {AppState} from '@/lib/domain/types';
import type {EducationCommand} from '@/lib/education-ui';
import styles from './education-setup.module.css';

export const EducationCommandContext=createContext<EducationCommand>(async()=>false);
export function CourseSelector({state,value,onChange,label='Ders',disabled=false,allowEmpty=true}:{state:AppState;value:string;onChange:(id:string)=>void;label?:string;disabled?:boolean;allowEmpty?:boolean}){
 const command=useContext(EducationCommandContext);
 const [adding,setAdding]=useState(false);
 const [name,setName]=useState('');
 const [context,setContext]=useState<'school'|'TYT'|'AYT'>('school');
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const attempts=useRef(new Map<string,{id:string;requestId:string}>());
 const education=state.education;
 const term=education?.profile?.active_term_id;
 const effectiveContext=education?.profile?.yks_goal?context:'school';
 const courses=(education?.courses??[]).filter(course=>course.id===value||(!course.archived&&(course.context==='yks'?education?.profile?.yks_goal:course.term_id===term)));
 const create=async()=>{
   if(!name.trim())return;
   if(effectiveContext==='school'&&!term){setError('Önce Ayarlar → Dönemler ve Dersler alanında bir dönem oluştur.');return;}
   const key=JSON.stringify({name:name.trim(),context:effectiveContext,term});
   const attempt=attempts.current.get(key)??{id:crypto.randomUUID(),requestId:crypto.randomUUID()};attempts.current.set(key,attempt);
   setSaving(true);setError('');
   try{if(await command('course.create',{id:attempt.id,term_id:effectiveContext==='school'?term:null,name:name.trim(),context:effectiveContext==='school'?'school':'yks',exam:effectiveContext==='school'?null:effectiveContext},attempt.requestId)){attempts.current.delete(key);onChange(attempt.id);setAdding(false);setName('');}}
   finally{setSaving(false);}
 };
 return <div className={styles.selector}>
   <label>{label}<select value={value} disabled={disabled||saving} required={!allowEmpty} onChange={e=>onChange(e.target.value)}><option value="">{allowEmpty?'Ders seçmeden devam et':'Ders seç'}</option>{courses.map(course=>{const retired=course.archived||(course.context==='school'&&course.term_id!==term);return <option key={course.id} value={course.id} disabled={retired}>{course.context==='yks'?course.exam+' · ':''}{course.name}{course.archived?' · Arşiv':retired?' · Önceki dönem':''}</option>;})}</select></label>
   {adding?<div className={styles.fields}><div className={styles.addInline}><input aria-label="Yeni ders adı" value={name} maxLength={120} placeholder="Ders adı" onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void create();}}}/>{education?.profile?.yks_goal&&<select aria-label="Yeni ders bağlamı" value={context} onChange={e=>setContext(e.target.value as typeof context)}><option value="school">Okul / Üniversite</option><option value="TYT">TYT</option><option value="AYT">AYT</option></select>}<button className="button secondary" type="button" disabled={saving||disabled||!name.trim()} onClick={()=>void create()}>Dersi ekle</button><button className="text-button" type="button" onClick={()=>{setAdding(false);setError('');}}>Vazgeç</button></div>{error&&<p role="alert" className={styles.error}>{error}</p>}</div>:<button type="button" className="text-button" disabled={disabled} onClick={()=>setAdding(true)}>+ Yeni ders ekle</button>}
 </div>;
}
