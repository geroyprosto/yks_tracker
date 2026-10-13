'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import type {EducationState} from '@/lib/education';
import type {EducationResultCommand} from '../school-results-entry';
import {SchoolResults} from '../school-results';
import {useMedicine} from './provider';
const MedicineResults=dynamic(()=>import('./results').then(module=>module.MedicineResults));

export function MedicineSchoolResults({education,command,busy}:{education:EducationState;command:EducationResultCommand;busy:boolean}){
 const {state}=useMedicine();const [choice,setChoice]=useState<string|null>(null);
 const view=choice??(state.profile?.enabled?'medicine':'school');
 return <><div className="settings-tabs"><button className={view==='medicine'?'active':''} aria-pressed={view==='medicine'} onClick={()=>setChoice('medicine')}>Kurul ve staj notları</button><button className={view==='school'?'active':''} aria-pressed={view==='school'} onClick={()=>setChoice('school')}>Diğer ders sınavları</button></div>{view==='medicine'?<MedicineResults key={`${state.profile?.academic_year}-${state.profile?.active_year}`}/>:<SchoolResults education={education} command={command} busy={busy}/>}</>;
}
