'use client';
import {useMemo,useState} from 'react';
import {ArrowUpRight,ChartNoAxesCombined,FileUp,PenLine,Plus,Trash2} from 'lucide-react';
import type {AppState,ExamFormat,ExamRecord} from '@/lib/domain/types';
import {examRange,examSeries,type ExamGrouping,type ExamMeasure,type ExamPeriod,type ExamPoint} from '@/lib/exam-analysis';
import {formatDay,localDate,type CommandFn} from '@/lib/ui';
import {Card,Empty} from './primitives';
import {Modal} from './modal';
import {PdfExamImport} from './pdf-exam-import';
import {MonthlyExamChart} from './monthly-exam-chart';
import styles from './exams-analysis.module.css';

type RowDraft={mode:'counts'|'net';correct:string;wrong:string;blank:string;net:string};
const emptyRow=():RowDraft=>({mode:'counts',correct:'',wrong:'',blank:'',net:''});
const n=(value:number|null|undefined)=>value===null||value===undefined?'':String(value);
const tr=(value:number)=>new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2}).format(value);
const codes=[['TYT','TYT genel'],['AYT_SAYISAL','AYT sayısal'],['BRANCH','Branş denemesi']] as const;

export function Exams({state,command,busy,onImported,preview=false,initialDate}:{state:AppState;command:CommandFn;busy:boolean;onImported:()=>Promise<void>;preview?:boolean;initialDate?:string}){
 const exams=state.exams;const formats=state.exam_formats;
 const [analysisView,setAnalysisView]=useState<'monthly'|'details'>(initialDate?'details':'monthly');
 const [editing,setEditing]=useState<ExamRecord|null|undefined>(undefined);
 const [importOpen,setImportOpen]=useState(false);
 const [deleting,setDeleting]=useState<ExamRecord|null>(null);
 const [format,setFormat]=useState<'TYT'|'AYT_SAYISAL'|'BRANCH'>('TYT');
 const [publisher,setPublisher]=useState('');
 const [period,setPeriod]=useState<ExamPeriod>(initialDate?'custom':'two-months');
 const [customStart,setCustomStart]=useState(initialDate??localDate());
 const [customEnd,setCustomEnd]=useState(initialDate??localDate());
 const [section,setSection]=useState('total');
 const [measure,setMeasure]=useState<ExamMeasure>('net');
 const [grouping,setGrouping]=useState<ExamGrouping>('exam');
 const selectedFormat=formats.find(item=>item.code===format);
 const sectionOptions=selectedFormat?.sections??[];
 const sectionKey=section==='total'||sectionOptions.some(item=>item.key===section)?section:'total';
 const today=localDate();const {start,end}=examRange(period,today,customStart,customEnd);
 const publishers=[...new Set(exams.filter(item=>item.format_code===format&&item.publisher).map(item=>item.publisher))].sort((a,b)=>a.localeCompare(b,'tr'));
 const filtered=exams.filter(item=>item.format_code===format&&(!publisher||item.publisher===publisher)&&item.exam_date>=start&&item.exam_date<=end);
 const points=useMemo(()=>examSeries(exams,{format,publisher,section:sectionKey,measure,grouping,start,end}),[exams,format,publisher,sectionKey,measure,grouping,start,end]);
 const valid=points.filter(point=>point.value!==null);const latest=valid.at(-1);const previous=valid.at(-2);
 return <div className="exam-page">
  <div className="exam-intro"><div><p className="eyebrow">{preview?'ÖRNEK ÖNİZLEME':'GERÇEK KAYITLAR'}</p><h2>Denemelerini birlikte oku.</h2><p>Net, puan ve sıralama ayrı tutulur. Grafik yalnız kaydettiğin sonuçlardan oluşur.</p></div><div className="exam-intro-actions"><button className="button secondary" disabled={!state.authenticated} onClick={()=>setImportOpen(true)}><FileUp size={17}/>PDF yükle</button><button className="button primary" disabled={!state.authenticated} onClick={()=>setEditing(null)}><Plus size={17}/>Deneme ekle</button></div></div>
  {preview&&<p className="practice-preview-note">Bu denemeler yalnız grafik önizlemesidir; gerçek sonuçlar değildir ve kaydedilmez.</p>}
  <div className="exam-overview">
   <div className={styles.analysis}>
    <div className={styles.tabs} role="tablist" aria-label="Deneme analizi görünümü" onKeyDown={event=>{
     if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
     event.preventDefault();
     const next=event.key==='Home'?'monthly':event.key==='End'?'details':analysisView==='monthly'?'details':'monthly';
     setAnalysisView(next);
     event.currentTarget.querySelector<HTMLButtonElement>(`[aria-controls="exam-${next}-panel"]`)?.focus();
    }}>
     <button type="button" role="tab" id="exam-monthly-tab" aria-controls="exam-monthly-panel" aria-selected={analysisView==='monthly'} tabIndex={analysisView==='monthly'?0:-1} onClick={()=>setAnalysisView('monthly')}>Aylık görünüm</button>
     <button type="button" role="tab" id="exam-details-tab" aria-controls="exam-details-panel" aria-selected={analysisView==='details'} tabIndex={analysisView==='details'?0:-1} onClick={()=>setAnalysisView('details')}>Ayrıntılı analiz</button>
    </div>
    <div className={styles.panel} role="tabpanel" id="exam-monthly-panel" aria-labelledby="exam-monthly-tab" hidden={analysisView!=='monthly'}>
     <MonthlyExamChart exams={exams} preview={preview} onOpen={()=>setAnalysisView('details')}/>
    </div>
    <div className={styles.panel} role="tabpanel" id="exam-details-panel" aria-labelledby="exam-details-tab" hidden={analysisView!=='details'}>
   <Card className="ambient-card exam-chart-card" title="Net gelişimi" eyebrow="DENEME ANALİZİ" action={<ChartNoAxesCombined size={18}/> }>
    <div className="exam-filters">
     <label>Tür<select value={format} onChange={event=>{setFormat(event.target.value as typeof format);setSection('total');setPublisher('')}}>{codes.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
     <label>Yayın<select value={publisher} onChange={event=>setPublisher(event.target.value)}><option value="">Tüm yayınlar</option>{publishers.map(name=><option key={name}>{name}</option>)}</select></label>
     <label>Sonuç<select value={sectionKey} onChange={event=>{setSection(event.target.value);if(event.target.value!=='total'&&measure==='seconds-per-question')setMeasure('accuracy')}}><option value="total">Toplam</option>{sectionOptions.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
     <label>Ölçü<select value={measure} onChange={event=>setMeasure(event.target.value as ExamMeasure)}><option value="net">Net</option><option value="accuracy">Doğruluk %</option><option value="seconds-per-question" disabled={sectionKey!=='total'}>Soru başına saniye (tüm deneme)</option></select></label>
     <label>Dönem<select value={period} onChange={event=>setPeriod(event.target.value as ExamPeriod)}><option value="week">Bu hafta</option><option value="month">Bu ay</option><option value="two-months">Son iki ay</option><option value="all">Tüm geçmiş</option><option value="custom">Özel aralık</option></select></label>
     <label>Gösterim<select value={grouping} onChange={event=>setGrouping(event.target.value as ExamGrouping)}><option value="exam">Tek denemeler</option><option value="week">Haftalık ortalama</option><option value="month">Aylık ortalama</option></select></label>
    </div>
    {period==='custom'&&<div className="exam-dates"><label>Başlangıç<input type="date" value={customStart} onChange={event=>setCustomStart(event.target.value)}/></label><label>Bitiş<input type="date" value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></label></div>}
    <div className="exam-chart-summary"><div><span>Son kayıt</span><strong>{latest?.value===null||latest?.value===undefined?'—':tr(latest.value)}</strong><small>{measure==='net'?'net':measure==='accuracy'?'doğruluk %':'sn / soru'}</small></div><div><span>Karşılaştırma</span><strong>{latest?.value===null||latest?.value===undefined||previous?.value===null||previous?.value===undefined?'—':`${latest.value-previous.value>=0?'+':''}${tr(latest.value-previous.value)}`}</strong><small>{measure==='net'?'net farkı':'önceki kayda göre'}</small></div><div><span>Veri sayısı</span><strong>{filtered.length}</strong><small>deneme</small></div></div>
    {valid.length?<><ExamPlot points={points} measure={measure}/><p className="exam-chart-note">{grouping==='exam'?'Her nokta bir deneme.':'Boş dönemler sıfır olarak çizilmez; n ilgili dönemin deneme sayısıdır.'} {format==='BRANCH'&&measure==='net'?'Branş soru sayıları farklıysa doğruluk oranını da karşılaştır.':''}</p><div className="exam-point-table"><span>Dönem / tarih</span><span>{measure==='net'?'Net':measure==='accuracy'?'Doğruluk':'Sn / soru'}</span><span>Örnek</span>{points.map(point=><div className="exam-point-row" key={point.key}><span>{point.label}</span><strong>{point.value===null?'—':tr(point.value)}</strong><span>{point.count?`n=${point.count}`:'veri yok'}</span></div>)}</div></>:<Empty icon={<ChartNoAxesCombined/>} title="Bu seçimde sonuç yok" text="İlk denemeni eklediğinde gerçek net grafiğin burada oluşacak."/>}
    <p className="footnote">Az sayıdaki veya farklı zorluktaki denemeler kesin gelişim yargısı vermez. Farklı soru sayıları için doğruluk oranını ve soru başına süreyi ayrıca incele.</p>
   </Card>
    </div>
   </div>
   <Card className="ambient-card exam-list-card" title="Deneme kayıtların" eyebrow="SONUÇ ARŞİVİ" action={<span className="pill">{exams.length} kayıt</span>}>
    {exams.length===0?<Empty icon={<FileUp/>} title="Henüz deneme kaydı yok" text="İlk sonucunu doğru, yanlış ve boş sayılarıyla veya yalnız net olarak kaydedebilirsin."/>:<div className="exam-records">{[...exams].sort((a,b)=>b.exam_date.localeCompare(a.exam_date)||b.created_at.localeCompare(a.created_at)).map(exam=><article className="exam-record" key={exam.id}><div className="exam-record-main"><span className="exam-record-date">{formatDay(exam.exam_date,{day:'numeric',month:'short',year:'numeric'})}</span><strong>{exam.name}</strong><small>{exam.format_snapshot.label} · {exam.publisher||'Yayın belirtilmedi'}</small></div><div className="exam-record-score"><strong>{exam.total_net===null?'—':tr(exam.total_net)}</strong><span>toplam net</span></div><div className="exam-record-actions"><button className="icon-button" aria-label={`${exam.name} düzenle`} onClick={()=>setEditing(exam)} disabled={busy||preview}><PenLine size={16}/></button><button className="icon-button" aria-label={`${exam.name} sil`} onClick={()=>setDeleting(exam)} disabled={busy||preview}><Trash2 size={16}/></button></div>{(exam.score!==null||exam.rank!==null)&&<p className="exam-record-extra">{exam.score!==null?`Puan: ${tr(exam.score)}`:''}{exam.score!==null&&exam.rank!==null?' · ':''}{exam.rank!==null?`Sıralama: ${tr(exam.rank)}`:''}</p>}</article>)}</div>}
    <p className="footnote">Eksik ders sonuçlarında genel net yalnız ayrıca raporlandıysa gösterilir; bilinmeyen dersler tahmin edilmez.</p>
   </Card>
  </div>
  {importOpen&&<PdfExamImport formats={formats} onClose={()=>setImportOpen(false)} onImported={onImported}/>}
  {editing!==undefined&&<ExamEditor key={editing?.id??'new'} record={editing} formats={formats} busy={busy} onClose={()=>setEditing(undefined)} onSave={async(type,payload)=>{if(await command(type,payload))setEditing(undefined)}}/>}
  {deleting&&<Modal title="Denemeyi sil" onClose={()=>setDeleting(null)}><div className="exam-delete-dialog"><p><strong>{deleting.name}</strong> kaydı ve grafiklerdeki sonucu silinecek.</p><div className="form-actions"><button className="button secondary" onClick={()=>setDeleting(null)}>Vazgeç</button><button className="button primary" disabled={busy} onClick={async()=>{if(await command('exam.delete',{id:deleting.id,expected_revision:deleting.revision}))setDeleting(null)}}>Kaydı sil</button></div></div></Modal>}
 </div>
}

function ExamPlot({points,measure}:{points:ExamPoint[];measure:ExamMeasure}){
 const width=Math.max(420,points.length*76+56);const values=points.flatMap(point=>point.value===null?[]:[point.value]);const min=Math.min(0,...values),max=Math.max(0,...values);const span=Math.max(1,max-min);
 const x=(i:number)=>36+i*(width-72)/Math.max(1,points.length-1);const y=(value:number)=>128-(value-min)/span*94;
 const segments:string[]=[];let current='';points.forEach((point,i)=>{if(point.value===null){if(current)segments.push(current);current='';return}current+=`${current?' L':'M'} ${x(i)} ${y(point.value)}`});if(current)segments.push(current);
 return <div className="exam-plot-scroll"><svg className="exam-plot" width={width} height="172" viewBox={`0 0 ${width} 172`} role="img" aria-label={`${points.length} dönemlik ${measure==='net'?'net':measure==='accuracy'?'doğruluk':'hız'} grafiği`}><defs><linearGradient id="exam-line-gradient" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="var(--feature-mid)"/><stop offset="1" stopColor="var(--feature-glow)"/></linearGradient></defs><line x1="22" x2={width-22} y1={y(0)} y2={y(0)} className="exam-zero-line"/>{segments.map((path,i)=><path key={i} d={path} fill="none" stroke="url(#exam-line-gradient)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>)}{points.map((point,i)=><g key={point.key}>{point.value!==null&&<><circle cx={x(i)} cy={y(point.value)} r="6" className="exam-plot-dot"/><text x={x(i)} y={Math.max(15,y(point.value)-12)} textAnchor="middle" className="exam-plot-value">{tr(point.value)}</text></>}<text x={x(i)} y="159" textAnchor="middle" className="exam-plot-date">{point.label}</text></g>)}</svg></div>;
}

function ExamEditor({record,formats,busy,onClose,onSave}:{record:ExamRecord|null;formats:ExamFormat[];busy:boolean;onClose:()=>void;onSave:(type:string,payload:Record<string,unknown>)=>Promise<void>}){
 const [formatCode,setFormatCode]=useState<'TYT'|'AYT_SAYISAL'|'BRANCH'>(record?.format_code??'TYT');
 const [branchSubject,setBranchSubject]=useState(record?.format_code==='BRANCH'?record.format_snapshot.sections[0]?.label??'':'');
 const [branchCount,setBranchCount]=useState(record?.format_code==='BRANCH'?String(record.format_snapshot.total_questions):'40');
 const [rows,setRows]=useState<Record<string,RowDraft>>(()=>Object.fromEntries((record?.results??[]).map(item=>[item.section_key,{mode:item.correct===null?'net':'counts',correct:n(item.correct),wrong:n(item.wrong),blank:n(item.blank),net:n(item.net)}])));
 const [error,setError]=useState('');
 const format=record?.format_snapshot??formats.find(item=>item.code===formatCode);
 const sections=formatCode==='BRANCH'&&!record?[{key:'branch',label:branchSubject||'Branş',question_count:Number(branchCount)||0}]:format?.sections??[];
 const totalQuestions=sections.reduce((sum,part)=>sum+part.question_count,0);
 const update=(key:string,field:keyof RowDraft,value:string)=>setRows(current=>({...current,[key]:{...(current[key]??emptyRow()),[field]:value}}));
 return <Modal title={record?'Denemeyi düzenle':'Yeni deneme ekle'} onClose={onClose}><form className="exam-editor" onSubmit={async event=>{
  event.preventDefault();setError('');const form=new FormData(event.currentTarget);
  const results:Record<string,unknown>[]=[];
  for(const part of sections){const row=rows[part.key]??emptyRow();if(row.mode==='net'){
    if(!row.net.trim())continue;const net=Number(row.net.replace(',','.'));if(!Number.isFinite(net)){setError(`${part.label} netini kontrol et.`);return}results.push({section_key:part.key,net});
  }else{if(!row.correct&&!row.wrong&&!row.blank)continue;if(row.correct===''||row.wrong===''){setError(`${part.label} için doğru ve yanlış sayısını gir.`);return}
    const correct=Number(row.correct),wrong=Number(row.wrong),blank=row.blank===''?part.question_count-correct-wrong:Number(row.blank);
    if(!Number.isInteger(correct)||!Number.isInteger(wrong)||!Number.isInteger(blank)||Math.min(correct,wrong,blank)<0||correct+wrong+blank>part.question_count){setError(`${part.label} soru sayılarını kontrol et.`);return}results.push({section_key:part.key,correct,wrong,blank});
  }}
  if(!results.length&&!String(form.get('reported_total_net')??'').trim()){setError('En az bir ders sonucu veya genel net gir.');return}
  const optionalNumber=(name:string)=>{const value=String(form.get(name)??'').trim();return value?Number(value.replace(',','.')):null};
  const payload:Record<string,unknown>={name:String(form.get('name')??'').trim(),publisher:String(form.get('publisher')??'').trim(),exam_date:String(form.get('exam_date')??''),duration_minutes:optionalNumber('duration'),notes:String(form.get('notes')??'').trim(),score:optionalNumber('score'),rank:optionalNumber('rank'),reported_total_net:optionalNumber('reported_total_net'),results};
  if(record){payload.id=record.id;payload.expected_revision=record.revision;await onSave('exam.update',payload)}else{payload.format_code=formatCode;payload.format_version=format?.version??1;if(formatCode==='BRANCH'){payload.branch_subject=branchSubject.trim();payload.branch_question_count=Number(branchCount)}await onSave('exam.create',payload)}
 }}>
  <div className="exam-editor-grid"><label>Deneme adı<input name="name" required maxLength={240} defaultValue={record?.name??''} placeholder="Örn. TYT 1. deneme"/></label><label>Yayın<input name="publisher" maxLength={120} defaultValue={record?.publisher??''} placeholder="Yayın adı"/></label><label>Deneme tarihi<input name="exam_date" type="date" required defaultValue={record?.exam_date??localDate()}/></label><label>Tür<select value={formatCode} disabled={Boolean(record)} onChange={event=>{setFormatCode(event.target.value as typeof formatCode);setRows({})}}>{codes.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>{formatCode==='BRANCH'&&<><label>Branş<input value={branchSubject} disabled={Boolean(record)} onChange={event=>setBranchSubject(event.target.value)} required maxLength={120} placeholder="Örn. TYT Matematik"/></label><label>Soru sayısı<input type="number" min="1" max="500" value={branchCount} disabled={Boolean(record)} onChange={event=>setBranchCount(event.target.value)} required/></label></>}<label>Uygulama süresi (dk)<input name="duration" type="number" min="1" max="1440" defaultValue={n(record?.duration_minutes)}/></label><label>Puan<input name="score" type="number" min="0" max="1000" step="0.001" defaultValue={n(record?.score)}/></label><label>Sıralama<input name="rank" type="number" min="1" max="10000000" defaultValue={n(record?.rank)}/></label><label>Yalnız genel net<input name="reported_total_net" type="number" step="0.01" min={format?-(totalQuestions/format.wrong_divisor):undefined} max={totalQuestions||undefined} defaultValue={n(record?.reported_total_net)} placeholder="Alt dersler bilinmiyorsa"/></label></div>
  <div className="exam-section-intro"><strong>Ders sonuçları</strong><span>Doğru ve yanlış yazınca boş sayısı otomatik tamamlanır. Yalnız net biliniyorsa modu değiştir.</span></div>
  {sections.map(part=>{const row=rows[part.key]??emptyRow();return <div className="exam-section-row" key={part.key}><div><strong>{part.label}</strong><small>{part.question_count} soru</small></div><select aria-label={`${part.label} giriş türü`} value={row.mode} onChange={event=>update(part.key,'mode',event.target.value)}><option value="counts">D / Y / B</option><option value="net">Yalnız net</option></select>{row.mode==='counts'?<div className="exam-section-counts"><label>Doğru<input type="number" min="0" max={part.question_count} value={row.correct} onChange={event=>update(part.key,'correct',event.target.value)}/></label><label>Yanlış<input type="number" min="0" max={part.question_count} value={row.wrong} onChange={event=>update(part.key,'wrong',event.target.value)}/></label><label>Boş<input type="number" min="0" max={part.question_count} value={row.blank} onChange={event=>update(part.key,'blank',event.target.value)} placeholder="Otomatik"/></label></div>:<label className="exam-net-input">Net<input type="number" step="0.01" min={-part.question_count/4} max={part.question_count} value={row.net} onChange={event=>update(part.key,'net',event.target.value)}/></label>}</div>})}
  <label>Notların<textarea name="notes" maxLength={10000} defaultValue={record?.notes??''} placeholder="Bu denemede neler dikkatini çekti?"/></label>
  {error&&<p className="error-text" role="alert">{error}</p>}
  <p className="footnote">Net = doğru − yanlış / 4. Eksik dersler toplam nete eklenmez; puan ve sıralama ayrı tutulur.</p>
  <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Vazgeç</button><button className="button primary" disabled={busy||!format||sections.some(item=>!item.question_count)}>{busy?'Kaydediliyor…':'Denemeyi kaydet'}<ArrowUpRight size={16}/></button></div>
 </form></Modal>;
}


