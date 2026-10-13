'use client';
import {useState} from 'react';
import {medicineKegLabels,type MedicineKeg} from '@/lib/medicine';
import {useMedicine} from './provider';
import {Card} from '../primitives';
import styles from './workspace.module.css';

export function MedicineKegPanel(){
 const {state,save,busy,loading}=useMedicine(),profile=state.profile;
 const record=state.keg.find(row=>row.year===profile?.active_year);
 const [status,setStatus]=useState<MedicineKeg['status']>(record?.status??'not_recorded');
 const [date,setDate]=useState(record?.assessment_date??''),[notes,setNotes]=useState(record?.notes??''),[notice,setNotice]=useState('');
 if(!profile||profile.active_year===4)return null;
 return <Card title="KEG yeterlilik sonucu">
  <p className="soft-copy">Dönem {profile.active_year} Kliniğe Erken Giriş dersinin fakülte tarafından açıklanan sonucunu kaydet. Bu yeterlilik dönem notundan ayrı değerlendirilir.</p>
  <form className="form-grid" onSubmit={async event=>{event.preventDefault();if(await save('keg.save',{academic_year:profile.academic_year,year:profile.active_year,status,assessment_date:date||null,notes,expected_revision:record?.revision??0}))setNotice('KEG sonucu kaydedildi.');}}>
   <label>KEG sonucu<select aria-label="KEG sonucu" value={status} onChange={event=>setStatus(event.target.value as MedicineKeg['status'])}>{Object.entries(medicineKegLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label>Değerlendirme tarihi (isteğe bağlı)<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
   <label className="span-2">KEG notum<textarea value={notes} maxLength={2000} rows={3} onChange={event=>setNotes(event.target.value)}/></label>
   <div className="form-actions span-2"><button className="button primary" disabled={busy||loading}>KEG sonucunu kaydet</button>{notice&&<span role="status">{notice}</span>}</div>
  </form>
  <p className={styles.sourceNote}>Aşağıdaki uygulama ilerlemesi kişisel çalışma takibindir. Dersin açıklanan yeterlilik sonucunu ayrıca gir.</p>
 </Card>;
}
