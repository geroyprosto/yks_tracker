'use client';
import {useState} from 'react';
import {calculateMedicineResult,calculateMedicineYear,effectiveMedicineResult,type MedicineResult,type MedicineUnit} from '@/lib/medicine';
import {localDate} from '@/lib/ui';
import {medicineCatalog} from './catalog';
import {useMedicine} from './provider';
import {MedicineNotice,MedicineSetup,MedicineYearSelector} from './setup';
import {Modal} from '../modal';
import {Card} from '../primitives';
import styles from './workspace.module.css';

const tr=(value:number|null)=>value===null?'—':new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2}).format(value);
const statusLabels={incomplete:'Notlar tamamlanmadı',passed:'Girilen kayıtlara göre koşullar sağlandı',failed:'Başarı koşulları sağlanmadı',keg_pending:'Not yeterli; KEG sonucu bekleniyor',keg_failed:'Not yeterli; KEG yeterliliği eksik'};
const markLabels={missing:'Not girilmedi',incomplete:'Diğer sınav notu bekleniyor',passed:'Başarılı',failed:'60 puanın altında',theory_failed:'Teorik sınav barajı sağlanmadı'};
type ResultUnit=Pick<MedicineUnit,'id'|'name'|'year'> & {kind:'kurul'|'staj'|'final'};
export function MedicineResults(){
 const {state,loading}=useMedicine(),profile=state.profile;
 const [editing,setEditing]=useState<ResultUnit|null>(null);
 if(!profile?.enabled)return <div className={styles.page}><MedicineNotice/><MedicineSetup key={profile?.revision??0}/></div>;
 const units=medicineCatalog.units.filter(unit=>unit.year===profile.active_year&&unit.kind!=='keg');
 const summary=calculateMedicineYear(profile.active_year,units,state.results,state.keg[0]?.status??null);
 const final:ResultUnit={id:`final-${profile.active_year}`,name:'Dönem finali / bütünleme',year:profile.active_year,kind:'final'};
 const visible:ResultUnit[]=[...units as ResultUnit[],...(profile.active_year<4?[final]:[])];
 return <div className={styles.page}>
  <MedicineNotice/><MedicineYearSelector/>
  <div className={styles.summary}>
   <div className={styles.metric}><span>{profile.active_year===4?'Staj':'Kurul'} ortalaması</span><strong>{tr(summary.currentAverage)}</strong><small>{summary.recorded} / {summary.total} sonuç · ders yüküne göre ağırlıklı{summary.recorded<summary.total?' · geçici ortalama':''}</small></div>
   <div className={styles.metric}><span>Dönem başarı notu</span><strong>{tr(summary.periodScore)}</strong><small>{statusLabels[summary.status]}</small></div>
   <div className={styles.metric}><span>{profile.active_year===4?'Staj durumu':'Final / bütünleme hedefi'}</span><strong>{profile.active_year===4?`${summary.marks.filter(mark=>mark.status==='passed').length} / ${summary.total}`:summary.finalNeeded===null?'—':summary.finalNeeded>100?'100 üzeri':tr(Math.ceil(summary.finalNeeded*100)/100)}</strong><small>{profile.active_year===4?'Her stajın başarı koşulu ayrı sağlanmalı.':summary.finalNeeded===null?'Hedef için tüm kurul notlarını gir.':summary.finalNeeded>100?'Girilen kurul notlarıyla 60 hedefi sağlanamıyor.':'Dönem notunun 60 olması için gereken puan; KEG ayrıca gerekli.'}</small></div>
  </div>
  <p className={styles.note}>{profile.active_year===4?'Staj hesabı: teorik %40 + pratik %60. Teorik sınav en az 60, nihai staj notu en az 60 olmalı.':'Dönem hesabı: ağırlıklı kurul ortalaması %50 + final/bütünleme %50. Kurul notunu fakültenin açıkladığı, ders barajları uygulanmış puan olarak gir.'}</p>
  <Card title={profile.active_year===4?'Staj notların':'Kurul ve dönem sınavları'}>
   {visible.map(unit=>{
    const record=effectiveMedicineResult(state.results,unit.id),mark=calculateMedicineResult(record,unit.kind);
    return <div className={styles.row} key={unit.id}><div><strong>{unit.name}</strong><small>{record?`${record.attempt==='resit'?'Bütünleme':'Normal sınav'} · ${record.exam_date}`:'Henüz sonuç yok'}{record?.theory_score!==null&&record?.theory_score!==undefined?` · Teorik ${tr(record.theory_score)} / Pratik ${tr(record.practical_score)}`:''}</small>{unit.kind==='staj'&&<small>{markLabels[mark.status]}</small>}</div><div className={styles.marks}><span className={styles.score}>{tr(mark.score)} / 100</span><button className="button secondary" disabled={loading} aria-label={`${unit.name} notunu ${record?'düzenle':'gir'}`} onClick={()=>setEditing(unit)}>{record?'Notu düzenle':'Not gir'}</button></div></div>;
   })}
  </Card>
  <p className={styles.sourceNote}>Bütünleme girildiğinde hesapta normal sınavın yerini alır; iki kayıt da saklanır. Boş puanlar sıfır sayılmaz. KEG sonucunu Konularım → KEG takibi bölümünden girebilirsin.</p>
  {editing&&<ResultDialog key={editing.id} unit={editing} onClose={()=>setEditing(null)}/>}
 </div>;
}
function ResultDialog({unit,onClose}:{unit:ResultUnit;onClose:()=>void}){
 const {state}=useMedicine();
 const [attempt,setAttempt]=useState<MedicineResult['attempt']>(effectiveMedicineResult(state.results,unit.id)?.attempt??'regular');
 return <Modal title={`${unit.name} · not girişi`} onClose={onClose}>
  <label>Sınav<select aria-label="Tıp sınav türü" value={attempt} onChange={event=>setAttempt(event.target.value as MedicineResult['attempt'])}><option value="regular">{unit.kind==='final'?'Final':'Normal sınav'}</option><option value="resit">Bütünleme</option></select></label>
  <ResultForm key={attempt} unit={unit} attempt={attempt} onClose={onClose}/>
 </Modal>;
}
const parseScore=(value:string)=>value.trim()===''?null:Number(value.replace(',','.'));
function ResultForm({unit,attempt,onClose}:{unit:ResultUnit;attempt:MedicineResult['attempt'];onClose:()=>void}){
 const {state,save,busy,error}=useMedicine(),profile=state.profile!;
 const record=state.results.find(row=>row.unit_id===unit.id&&row.attempt===attempt);
 const [mode,setMode]=useState(record?.reported_score!==null&&record?.reported_score!==undefined||unit.kind!=='staj'?'official':'components');
 const [score,setScore]=useState(record?.reported_score?.toString()??''),[theory,setTheory]=useState(record?.theory_score?.toString()??''),[practical,setPractical]=useState(record?.practical_score?.toString()??'');
 const [date,setDate]=useState(record?.exam_date??localDate()),[notes,setNotes]=useState(record?.notes??''),[deleting,setDeleting]=useState(false);
 const preview=calculateMedicineResult({reported_score:mode==='official'?parseScore(score):null,theory_score:mode==='components'?parseScore(theory):null,practical_score:mode==='components'?parseScore(practical):null} as MedicineResult,unit.kind);
 return <form className="form-grid" onSubmit={async event=>{event.preventDefault();if(await save('result.save',{academic_year:profile.academic_year,year:unit.year,unit_id:unit.id,attempt,exam_date:date,reported_score:mode==='official'?parseScore(score):null,theory_score:mode==='components'?parseScore(theory):null,practical_score:mode==='components'?parseScore(practical):null,notes,expected_revision:record?.revision??0}))onClose();}}>
  {error&&<p role="alert" className="notice error span-2">{error}</p>}
  <label>Sınav tarihi<input type="date" required value={date} onChange={event=>setDate(event.target.value)}/></label>
  {unit.kind==='staj'&&<label>Not giriş biçimi<select value={mode} onChange={event=>setMode(event.target.value)}><option value="components">Teorik ve pratik puanları</option><option value="official">Açıklanan staj notu</option></select></label>}
  {mode==='official'?<label className="span-2">Açıklanan not<input aria-label="Açıklanan tıp notu" inputMode="decimal" required value={score} onChange={event=>setScore(event.target.value)}/><small>0–100 arası. Kurullarda baraj uygulanmış açıklanan puanı kullan.</small></label>:<><label>Teorik puanı<input inputMode="decimal" value={theory} onChange={event=>setTheory(event.target.value)}/></label><label>Pratik puanı<input inputMode="decimal" value={practical} onChange={event=>setPractical(event.target.value)}/></label><p className="span-2 soft-copy" aria-live="polite">Hesaplanan staj notu: {Number.isFinite(preview.score)?tr(preview.score):'—'} · {markLabels[preview.status]}</p></>}
  <label className="span-2">Sınav notum<textarea value={notes} maxLength={2000} rows={3} onChange={event=>setNotes(event.target.value)}/></label>
  <div className="form-actions span-2"><button className="button primary" disabled={busy}>Tıp notunu kaydet</button>{record&&<button type="button" className="text-button" disabled={busy} onClick={()=>setDeleting(true)}>Sonucu sil</button>}</div>
  {deleting&&record&&<div className="span-2 notice"><p>Bu sınav sonucu silinecek; diğer sınav kayıtları korunacak.</p><button type="button" className="button secondary" disabled={busy} onClick={async()=>{if(await save('result.delete',{id:record.id,expected_revision:record.revision}))onClose();}}>Silme işlemini tamamla</button><button type="button" className="text-button" onClick={()=>setDeleting(false)}>Vazgeç</button></div>}
 </form>;
}
