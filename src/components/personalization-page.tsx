'use client';

import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {EducationState} from '@/lib/education';
import type {EducationCommand} from '@/lib/education-ui';
import {optimisticEducationCommand} from '@/lib/optimistic-education';
import {normalizeTheme} from '@/lib/ui';
import {EducationSetup} from './education-setup';
import styles from './education-setup.module.css';

export function PersonalizationPage({initialEducation}:{initialEducation:EducationState}){
 const router=useRouter();
 const [education,setEducation]=useState(initialEducation);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const pending=useRef(false);
 const requests=useRef(new Map<string,string>());
 useEffect(()=>{
   const theme=normalizeTheme(localStorage.getItem('yksim-theme')??'ocean')??'ocean';
   const appearance=localStorage.getItem('yksim-appearance')??'system';
   document.documentElement.dataset.theme=theme;
   document.documentElement.dataset.appearance=theme==='white'?'light':theme==='black'?'dark':appearance==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):appearance;
   document.documentElement.dataset.reduced=localStorage.getItem('yksim-reduced')??'false';
   document.documentElement.dataset.simple=localStorage.getItem('yksim-simple')??'false';
 },[]);
 const command:EducationCommand=async(type,payload,requestId)=>{
   if(pending.current)return false;
   const key=JSON.stringify({type,payload});const id=requestId??requests.current.get(key)??crypto.randomUUID();requests.current.set(key,id);
   pending.current=true;setBusy(true);setError('');
   const previous=education;
   const optimistic=optimisticEducationCommand(education,type,payload,id,new Date().toISOString());
   if(optimistic)setEducation(optimistic);
   let syncing=false;
   try{
     const response=await fetch('/api/education',{method:'POST',headers:{'Content-Type':'application/json',...(optimistic?{Prefer:'return=minimal'}:{})},body:JSON.stringify({type,payload,request_id:id})});
     const body=await response.json();if(!response.ok){if(response.status<500)requests.current.delete(key);throw new Error(body.error?.message??'Kaydedilemedi.');}
     requests.current.delete(key);
     if(optimistic){
       syncing=true;
       void (async()=>{
         try{
           const refreshed=await fetch('/api/education',{cache:'no-store'});
           const current=await refreshed.json();
           if(!refreshed.ok)throw new Error(current.error?.message??'Güncel bilgiler yüklenemedi.');
           setEducation(current as EducationState);
         }catch{setError('Kayıt tamamlandı, ancak güncel görünüm yüklenemedi. Sayfayı yenile.');}
         finally{pending.current=false;setBusy(false);}
       })();
     }else setEducation(body.state);
     return true;
   }catch(cause){if(optimistic)setEducation(previous);setError(cause instanceof Error?cause.message:'Bağlantı kurulamadı.');return false;}
   finally{if(!syncing){pending.current=false;setBusy(false);}}
 };
 return <main className={styles.standalone}><a className={styles.back} href={education.can_commit?'/':'/classroom'}>← {education.can_commit?'Çalışma alanıma dön':'Hesap durumuma dön'}</a>{error&&<p className="notice error" role="alert">{error}</p>}<EducationSetup education={education} command={command} busy={busy} editing={Boolean(education.profile?.onboarding_completed_at)} onDone={()=>{router.push('/');router.refresh();}}/></main>;
}
