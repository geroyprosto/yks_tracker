'use client';
import {useState} from 'react';
import {GraduationCap} from 'lucide-react';
import {academicYear} from '@/lib/education-ui';
import {useMedicine} from './provider';
import {Card} from '../primitives';
import styles from './workspace.module.css';

export function MedicineSettings(){const {state}=useMedicine();return <><MedicineNotice/><MedicineSetup key={state.profile?.revision??0}/></>;}

export function MedicineNotice(){
 const {error,loading,busy,refresh}=useMedicine();
 return <>{loading&&<p role="status" className="soft-copy">Tıp çalışma alanın yükleniyor…</p>}{error&&<div role="alert" className="notice error"><span>{error}</span><button className="button secondary" disabled={busy||loading} onClick={()=>void refresh()}>Yeniden yükle</button></div>}</>;
}
export function MedicineSetup(){
 const {state,save,busy,loading}=useMedicine();
 const profile=state.profile;
 const [year,setYear]=useState(profile?.active_year??1),[academic,setAcademic]=useState(profile?.academic_year??academicYear().replace('–','-'));
 const [notice,setNotice]=useState('');
 return <Card title="Kırklareli Tıp çalışma alanı" action={<GraduationCap size={23}/>}>
  <p className="soft-copy">2026–2027 resmî programından Dönem 1–4 konuları, kurul ve staj notları, KEG takibi.</p>
  <form className={styles.setup} onSubmit={async event=>{event.preventDefault();if(await save('profile.save',{academic_year:academic,active_year:year,enabled:true,expected_revision:profile?.revision??0}))setNotice('Tıp çalışma alanın kaydedildi.');}}>
   <label>Akademik yıl<input required value={academic} placeholder="2026-2027" maxLength={9} pattern="20[0-9]{2}-20[0-9]{2}" onChange={event=>setAcademic(event.target.value.replace('–','-'))}/></label>
   <label>Tıp dönemin<select value={year} onChange={event=>setYear(Number(event.target.value))}>{[1,2,3,4].map(value=><option key={value} value={value}>Dönem {value}</option>)}</select></label>
   <button className="button primary" disabled={busy||loading}>{busy?'Kaydediliyor…':profile?.enabled?'Tıp alanını güncelle':'Kırklareli Tıp alanını aç'}</button>
  </form>
  {profile?.enabled&&<button className="text-button" disabled={busy||loading} onClick={()=>void save('profile.save',{academic_year:profile.academic_year,active_year:profile.active_year,enabled:false,expected_revision:profile.revision})}>Tıp alanını gizle</button>}
  {notice&&<p role="status" className="soft-copy">{notice}</p>}
  <p className={styles.sourceNote}>Akademik yıl değiştirdiğinde önceki kayıtların saklanır. Hazır müfredatın sürümü: 2026–2027.</p>
 </Card>;
}
export function MedicineYearSelector(){
 const {state,save,busy,loading}=useMedicine();const profile=state.profile;
 if(!profile)return null;
 return <label className={styles.year}>Tıp dönemi<select aria-label="Aktif tıp dönemi" value={profile.active_year} disabled={busy||loading} onChange={event=>void save('profile.save',{academic_year:profile.academic_year,active_year:Number(event.target.value),enabled:true,expected_revision:profile.revision})}>{[1,2,3,4].map(year=><option value={year} key={year}>Dönem {year}</option>)}</select><small>{profile.academic_year}</small></label>;
}
