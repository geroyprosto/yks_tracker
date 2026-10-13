'use client';
import {useState,type ReactNode} from 'react';
import {useMedicine} from './provider';
import {MedicineTopics} from './topics';

export function StudentTopics({yksEnabled,legacy}:{yksEnabled:boolean;legacy:ReactNode}){
 const {state}=useMedicine();
 const [view,setView]=useState('medicine');
 return <>{yksEnabled&&<div className="settings-tabs"><button className={view==='medicine'?'active':''} aria-pressed={view==='medicine'} onClick={()=>setView('medicine')}>Tıp konuları</button><button className={view==='yks'?'active':''} aria-pressed={view==='yks'} onClick={()=>setView('yks')}>YKS konuları</button></div>}{view==='medicine'?<MedicineTopics key={`${state.profile?.academic_year}-${state.profile?.active_year}`}/>:legacy}</>;
}
