import type {AppState, StudyType, Task, Topic} from './domain/types';
import type {CoachingReportMetrics} from './coaching-report';
import {taskCompletion} from './progress';

export type PlanTopicRef={exam:'TYT'|'AYT';subject:string;topic_keywords:string[]};
export type PlanTarget=PlanTopicRef&{priority:'high'|'normal'|'low';prerequisites?:PlanTopicRef[];
  /** A study order in the student's plan, not necessarily a subject-matter prerequisite. */
  sequence_after?:PlanTopicRef[];focus?:string};
export type CoachingPlan={source:{id:string;title:string;kind:'student_personalized'|'imported'};
  daily_minutes:number;buffer_ratio:number;milestones:{id:string;label:string;due_date:string}[];
  months:{month:string;targets:PlanTarget[]}[]};
export type HomeworkCandidate={key:string;topic_id:string;title:string;exam:'TYT'|'AYT';subject:string;
  study_type:StudyType;planned_minutes:number;priority:Task['priority'];plan_date:string;
  completion_criteria:string;notes:string;reason:string};
export type HomeworkDirection={title:string;text:string;topic_id:string;task_keys:string[]};
export type HomeworkProposal={candidates:HomeworkCandidate[];directions:HomeworkDirection[];data_gaps:string[]};

const DAY=/^\d{4}-\d{2}-\d{2}$/;
function shift(day:string,amount:number){const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}
function fold(value:string){return value.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();}
function legacy(topic:Topic){return /önceki plan|old plan/i.test(`${topic.source} ${topic.notes}`)?1:0;}
function topicMatch(topics:Topic[],ref:PlanTopicRef){
  const candidates=topics.filter(topic=>topic.exam===ref.exam&&fold(topic.subject)===fold(ref.subject));
  for(const keyword of ref.topic_keywords){
    const exact=candidates.filter(topic=>fold(topic.name)===fold(keyword));
    if(exact.length)return exact.sort((a,b)=>legacy(a)-legacy(b)
      ||b.updated_at.localeCompare(a.updated_at))[0];
  }
  for(const keyword of ref.topic_keywords){
    const normalized=fold(keyword);
    if(normalized.length<4)continue;
    const partial=candidates.filter(topic=>fold(topic.name).includes(normalized));
    if(partial.length)return partial.sort((a,b)=>legacy(a)-legacy(b)||b.updated_at.localeCompare(a.updated_at)
      ||a.name.length-b.name.length)[0];
  }
  return null;
}
function phase(topic:Topic){return topic.mastery<=1?'instruction':'practice';}
function actionable(topic:Topic){return topic.mastery<4||topic.review_requested;}
function workload(topic:Topic){return phase(topic)==='instruction'?180:120;}
function studyType(topic:Topic):StudyType{return phase(topic)==='instruction'?'Konu anlatımı':'Soru çözümü';}
function completionCriteria(topic:Topic){return phase(topic)==='instruction'
  ?'Konunun kalan anlatımını tamamla; kaynağı kapatıp yeni örnekleri bağımsız çöz ve takıldığın adımı kaydet.'
  :'Farklı türlerde yeni soruları yardımsız çöz; yanlış ve boşları bilgi, yöntem, işlem veya süre nedeni ile sınıflandır; sonraki kontrol için açıkları kaydet.';}
function label(ref:PlanTopicRef){return `${ref.exam} ${ref.subject} · ${ref.topic_keywords[0]}`;}
function weekStart(day:string){const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();return shift(day,-((weekday+6)%7));}
function weakExamSubjects(metrics:CoachingReportMetrics){
  const weak=new Set<string>();
  const latest=metrics.weekly_exam.TYT.exams.at(-1);
  if(!latest)return weak;
  for(const section of latest.sections){
    if(!section.question_count||section.net/section.question_count>.2)continue;
    const name=fold(section.label);
    if(name.includes('matematik'))weak.add('TYT:matematik');
    if(name.includes('cografya'))weak.add('TYT:cografya');
    if(name.includes('turkce'))weak.add('TYT:turkce');
    if(name.includes('kimya'))weak.add('TYT:kimya');
    if(name.includes('fizik'))weak.add('TYT:fizik');
    if(name.includes('biyoloji'))weak.add('TYT:biyoloji');
  }
  return weak;
}

/** Builds reviewable proposals only. The task service must validate and persist them idempotently. */
export function buildWeeklyHomeworkCandidates(state:AppState,plan:CoachingPlan,metrics:CoachingReportMetrics):HomeworkProposal{
  if(!Number.isFinite(plan.daily_minutes)||plan.daily_minutes<=0||plan.daily_minutes>1440
    ||!Number.isFinite(plan.buffer_ratio)||plan.buffer_ratio<.1||plan.buffer_ratio>.15)
    throw new Error('Günlük kapasite ve %10–15 telafi payı gerekli.');
  const today=metrics.context.cutoff_local_date,windowEnd=shift(today,13),monthEnd=windowEnd.slice(0,7);
  if(!DAY.test(today)||!DAY.test(metrics.context.week_start))throw new Error('Geçerli analiz haftası gerekli.');
  const gaps:string[]=[],raw:{topic:Topic;target:PlanTarget;month:string;order:number;why:string}[]=[];
  const weak=weakExamSubjects(metrics);
  const targets=plan.months.filter(month=>month.month<=monthEnd).sort((a,b)=>a.month.localeCompare(b.month));
  let order=0;
  for(const month of targets)for(const target of month.targets){
    const targetOrder=order++,topic=topicMatch(state.topics,target);
    if(!topic){gaps.push(`Plan konusu uygulama kayıtlarında bulunamadı: ${label(target)}.`);continue;}
    if(!actionable(topic))continue;
    let blocked=false;
    for(const ref of [...(target.prerequisites??[]),...(target.sequence_after??[])]){
      const prior=topicMatch(state.topics,ref);
      if(!prior){gaps.push(`Ön koşul veya plan sırası kaydı bulunamadı: ${label(ref)}.`);blocked=true;break;}
      if(prior.mastery<3){
        raw.push({topic:prior,target,month:month.month,order:targetOrder,
          why:`${topic.name} öncesinde ${prior.name} bağımsız soru aşamasına ulaşmalı.`});
        blocked=true;break;
      }
    }
    if(!blocked)raw.push({topic,target,month:month.month,order:targetOrder,
      why:`${month.month} kişisel planında ${topic.name} açık; kayıtlı düzey ${topic.mastery}/4.`});
  }
  const rank={high:0,normal:1,low:2};
  const unique=new Map<string,(typeof raw)[number]>();
  for(const item of raw.sort((a,b)=>a.month.localeCompare(b.month)
    ||Number(weak.has(`${b.topic.exam}:${fold(b.topic.subject)}`))-Number(weak.has(`${a.topic.exam}:${fold(a.topic.subject)}`))
    ||rank[a.target.priority]-rank[b.target.priority]
    ||a.order-b.order)){
    const key=`${item.topic.id}:${phase(item.topic)}`;
    if(!unique.has(key))unique.set(key,item);
  }
  const planned=state.tasks.filter(task=>task.plan_date>=today&&task.plan_date<=windowEnd);
  const used=new Map<string,number>();
  for(const task of planned)used.set(task.plan_date,(used.get(task.plan_date)??0)+Math.max(0,task.planned_minutes));
  // Open overdue tasks still occupy today's practical capacity even though their original date is past.
  for(const task of state.tasks.filter(task=>task.plan_date<today&&taskCompletion(task)<1))
    used.set(today,(used.get(today)??0)+Math.max(0,task.planned_minutes));
  const capacity=Math.floor(plan.daily_minutes*(1-plan.buffer_ratio));
  const candidates:HomeworkCandidate[]=[],subjectCounts=new Map<string,number>();
  const examCounts={TYT:0,AYT:0};
  // One task per course first; a second pass can use remaining room without suppressing another subject.
  const rows=[...unique.values()];
  for(let pass=0;pass<2&&candidates.length<6;pass++)for(const row of rows){
    if(candidates.length>=6)break;
    const {topic,target}=row,subjectKey=`${topic.exam}:${fold(topic.subject)}`;
    if((subjectCounts.get(subjectKey)??0)!==pass)continue;
    if(examCounts[topic.exam]>=3&&rows.some(item=>item.topic.exam!==topic.exam&&examCounts[item.topic.exam]<3
      &&!candidates.some(candidate=>candidate.topic_id===item.topic.id)))continue;
    const type=studyType(topic);
    if(candidates.some(candidate=>candidate.topic_id===topic.id&&candidate.study_type===type))continue;
    if(state.tasks.some(task=>task.topic_id===topic.id&&task.study_type===type
      &&(task.plan_date>=today||taskCompletion(task)<1)))continue;
    const minutes=workload(topic);
    let date:string|null=null;
    for(let offset=0;offset<14;offset++){
      const candidateDate=shift(today,offset);
      if((used.get(candidateDate)??0)+minutes<=capacity){date=candidateDate;break;}
    }
    if(!date)continue;
    const key=`${weekStart(date)}:${topic.id}:${phase(topic)}`;
    if(state.tasks.some(task=>task.notes.includes(`coach-key:${key}`)))continue;
    used.set(date,(used.get(date)??0)+minutes);
    const title=`${topic.exam} ${topic.subject} · ${topic.name} — ${phase(topic)==='instruction'?'konu öğrenimi':'bağımsız soru çözümü'}`;
    const reason=target.focus?`${row.why} Odak: ${target.focus}`:row.why;
    candidates.push({key,topic_id:topic.id,title,exam:topic.exam,subject:topic.subject,study_type:type,
      planned_minutes:minutes,priority:target.priority==='low'?'normal':target.priority,plan_date:date,completion_criteria:completionCriteria(topic),
      notes:`Kişisel plan: ${plan.source.title}. ${target.focus??''} coach-key:${key}`.trim(),reason});
    subjectCounts.set(subjectKey,(subjectCounts.get(subjectKey)??0)+1);
    examCounts[topic.exam]++;
  }
  if(raw.length&&candidates.length===0&&!gaps.some(message=>message.includes('kapasite')))
    gaps.push('Mevcut görevler ve tekrarlar nedeniyle gelecek 14 günde yeni ödev kapasitesi yok veya aynı işler zaten planlı.');
  const directions:HomeworkDirection[]=[],seenSubjects=new Set<string>();
  for(const candidate of candidates){
    const subjectKey=`${candidate.exam}:${fold(candidate.subject)}`;
    if(seenSubjects.has(subjectKey))continue;
    seenSubjects.add(subjectKey);
    const when=candidate.plan_date<=metrics.context.week_end?'Bu hafta'
      :candidate.plan_date<=shift(metrics.context.week_end,7)?'Gelecek hafta':'İki hafta içinde';
    directions.push({title:`${candidate.exam} ${candidate.subject}: ${state.topics.find(topic=>topic.id===candidate.topic_id)?.name??candidate.title}`,
      text:`${when} ${candidate.study_type==='Konu anlatımı'?'konu anlatımını ve bağımsız uygulamayı tamamla':'bağımsız soru çözümünü ve yanlış analizini bitir'}. ${candidate.reason}`,
      topic_id:candidate.topic_id,task_keys:candidates.filter(item=>item.exam===candidate.exam&&fold(item.subject)===fold(candidate.subject)).map(item=>item.key)});
    if(directions.length===3)break;
  }
  return {candidates,directions,data_gaps:[...new Set(gaps)]};
}

const r=(exam:PlanTopicRef['exam'],subject:string,topic_keywords:string[]):PlanTopicRef=>({exam,subject,topic_keywords});
const t=(exam:PlanTopicRef['exam'],subject:string,topic_keywords:string[],priority:PlanTarget['priority']='high',
  extra:Partial<Pick<PlanTarget,'prerequisites'|'sequence_after'|'focus'>>={}):PlanTarget=>
  ({exam,subject,topic_keywords,priority,...extra});

/** Owner-specific import source from the 1 October 2026 personal monthly plan. Never apply to all accounts. */
export const SUMEYRA_2027_PLAN:CoachingPlan={
  source:{id:'sumeyra-2027-october-personal-plan',title:'Ekim 2026–Haziran 2027 kişisel YKS yol haritası',kind:'student_personalized'},
  daily_minutes:480,buffer_ratio:.125,
  milestones:[
    {id:'tyt-bio-first-pass',label:'TYT ilk öğrenme işleri ve AYT biyoloji ilk turu',due_date:'2026-12-31'},
    {id:'geometry-first-pass',label:'Geometri ilk turu',due_date:'2027-01-31'},
    {id:'ayt-first-pass',label:'Bütün AYT ilk turu',due_date:'2027-02-28'},
  ],
  months:[
    {month:'2026-10',targets:[
      t('TYT','Matematik',['Denklemler ve Eşitsizliklerle İlgili Uygulamalar'],'high',
        {focus:'Oran–orantı, kesir, yaş ve yüzde problemlerinde bilgi, yöntem, işlem ve süre ayrımı yap.'}),
      t('AYT','Matematik',['İkinci Dereceden Bir Bilinmeyenli Eşitsizlik Sistemleri']),
      t('AYT','Matematik',['Yönlü Açılar'],'high',
        {sequence_after:[r('AYT','Matematik',['İkinci Dereceden Bir Bilinmeyenli Eşitsizlik Sistemleri'])]}),
      t('AYT','Matematik',['Trigonometrik Fonksiyonlar'],'high',{prerequisites:[r('AYT','Matematik',['Yönlü Açılar'])]}),
      t('TYT','Kimya',['Kimyanın Temel Kanunları ve Mol Kavramı']),
      t('TYT','Kimya',['Kimyasal Tepkimeler - Kimyasal Tepkimelerde Hesaplamalar'],'high',
        {prerequisites:[r('TYT','Kimya',['Kimyanın Temel Kanunları ve Mol Kavramı'])]}),
      t('AYT','Kimya',['Sıvı Çözeltiler ve Çözünürlük'],'high',
        {prerequisites:[r('TYT','Kimya',['Kimyanın Temel Kanunları ve Mol Kavramı']),
          r('TYT','Kimya',['Kimyasal Tepkimeler - Kimyasal Tepkimelerde Hesaplamalar'])]}),
      t('AYT','Matematik',['Doğrunun Analitik İncelenmesi']),
      t('AYT','Fizik',['İtme ve Çizgisel Momentum']),t('AYT','Fizik',['Tork ve Denge']),
      t('AYT','Fizik',['Basit Makineler']),
      t('AYT','Biyoloji',['Nükleik Asitlerin Keşfi ve Önemi']),
      t('AYT','Biyoloji',['Genetik Şifre ve Protein Sentezi'],'high',
        {prerequisites:[r('AYT','Biyoloji',['Nükleik Asitlerin Keşfi ve Önemi'])]}),
      t('AYT','Biyoloji',['Genetik Mühendisliği ve Biyoteknoloji']),
      t('TYT','Türkçe',['Yazım Kuralları']),t('TYT','Türkçe',['Noktalama İşaretleri']),
      t('TYT','Coğrafya',['Harita Bilimi']),t('TYT','Coğrafya',['Yer ve Zaman, Koordinat Sistemi']),
      t('TYT','Coğrafya',['Dünya’nın Şekli ve Hareketleri']),t('TYT','Coğrafya',['İklim Tipleri ve Türkiye İklimi']),
      t('TYT','Biyoloji',['Mitoz ve Eşeysiz Üreme'],'normal'),
      t('TYT','Biyoloji',['Kalıtımın Genel Esasları - Mendel İlkeleri ve Çaprazlamalar'],'normal'),
    ]},
    {month:'2026-11',targets:[
      t('TYT','Matematik',['Denklemler ve Eşitsizliklerle İlgili Uygulamalar'],'high',
        {focus:'Hareket, işçi–havuz, karışım ve tablo–grafik problemlerini karma uygulamada sürdür.'}),
      t('TYT','Matematik',['Kümelerde Temel Kavramlar']),t('TYT','Matematik',['Önermeler ve Bileşik Önermeler']),
      t('AYT','Matematik',['Toplam - Fark ve İki Kat Açı Formülleri']),t('AYT','Matematik',['Trigonometrik Denklemler']),
      t('AYT','Matematik',['Üstel Fonksiyon']),t('AYT','Matematik',['Logaritma Fonksiyonu']),
      t('AYT','Matematik',['Çemberin Temel Elemanları - Çemberde Açılar']),
      t('AYT','Matematik',['Çemberde Teğet - Dairenin Çevresi ve Alanı']),
      t('AYT','Fizik',['Elektriksel Kuvvet - Elektrik Alan']),t('AYT','Fizik',['Elektriksel Potansiyel']),
      t('AYT','Fizik',['Düzgün Elektrik Alan ve Sığa']),
      t('AYT','Kimya',['Kimyasal Tepkimelerde Enerji']),t('AYT','Kimya',['Kimyasal Tepkimelerde Hız']),
      t('AYT','Biyoloji',['Canlılık ve Enerji - Fotosentez - Kemosentez']),
      t('AYT','Biyoloji',['Hücresel Solunum - Fermantasyon - Fotosentez ve Solunum İlişkisi']),
      t('TYT','Coğrafya',['Basınç ve Rüzgâr, Nem ve Yağış'],'normal'),
      t('TYT','Coğrafya',['Dünya’nın Tektonik Oluşumu ve İç Kuvvetler'],'normal'),
    ]},
    {month:'2026-12',targets:[
      t('TYT','Matematik',['Sıralama ve Seçme']),t('TYT','Matematik',['Basit Olayların Olasılıkları']),
      t('AYT','Matematik',['Üstel, Logaritmik Denklemler ve Eşitsizlikler']),
      t('AYT','Matematik',['Gerçek Sayı Dizileri']),t('AYT','Matematik',['Limit ve Süreklilik']),
      t('AYT','Matematik',['Katı Cisimler']),t('AYT','Matematik',['Çemberin Analitik İncelenmesi']),
      t('AYT','Fizik',['Manyetizma ve Elektromanyetik İndüklenme']),
      t('AYT','Fizik',['Alternatif Akım ve Transformatörler']),
      t('AYT','Kimya',['Kimyasal Tepkimelerde Denge']),
      t('AYT','Biyoloji',['Komünite Ekolojisi']),t('AYT','Biyoloji',['Popülasyon Ekolojisi']),
      t('AYT','Biyoloji',['Bitkilerin Yapısı']),t('AYT','Biyoloji',['Bitkilerde Madde Taşınması']),
      t('AYT','Biyoloji',['Bitkilerde Eşeyli Üreme']),t('AYT','Biyoloji',['Canlılar ve Çevre']),
      t('TYT','Coğrafya',['Nüfus'],'normal'),t('TYT','Coğrafya',['Göçler'],'normal'),
    ]},
    {month:'2027-01',targets:[
      t('AYT','Matematik',['Anlık Değişim Oranı ve Türev']),t('AYT','Matematik',['Türevin Uygulamaları']),
      t('AYT','Matematik',['Analitik Düzlemde Temel Dönüşümler']),
      t('AYT','Fizik',['Çembersel Hareket']),t('AYT','Fizik',['Basit Harmonik Hareket']),
      t('AYT','Fizik',['Dalgalarda Kırınım, Girişim, Doppler Olayı']),
      t('AYT','Kimya',['Kimya ve Elektrik']),t('AYT','Kimya',['Karbon Kimyasına Giriş']),
    ]},
    {month:'2027-02',targets:[
      t('AYT','Matematik',['Belirsiz İntegral']),t('AYT','Matematik',['Belirli İntegral ve Uygulamaları']),
      t('AYT','Matematik',['Koşullu Olasılık, Deneysel ve Teorik Olasılık']),
      t('AYT','Fizik',['Atom Kavramının Tarihsel Gelişimi']),t('AYT','Fizik',['Büyük Patlama ve Evrenin Oluşumu']),
      t('AYT','Fizik',['Radyoaktivite']),t('AYT','Fizik',['Özel Görelilik ve Kuantum Fiziğine Giriş']),
      t('AYT','Fizik',['Fotoelektrik Olay']),t('AYT','Fizik',['Compton Saçılması ve de Broglie Dalga Boyu']),
      t('AYT','Fizik',['Elektromanyetik Dalgalar']),t('AYT','Fizik',['Modern Fiziğin Teknolojideki Uygulamaları']),
      t('AYT','Kimya',['Organik Bileşikler']),t('AYT','Kimya',['Enerji Kaynakları ve Bilimsel Gelişmeler']),
    ]},
    // In the second pass, only unfinished or explicitly review-requested topics produce proposals.
    {month:'2027-03',targets:[t('AYT','Matematik',['Limit ve Süreklilik']),t('AYT','Matematik',['Türevin Uygulamaları']),
      t('AYT','Kimya',['Organik Bileşikler']),t('AYT','Fizik',['Elektriksel Kuvvet - Elektrik Alan']),
      t('AYT','Biyoloji',['Genetik Şifre ve Protein Sentezi'])]},
    {month:'2027-04',targets:[]},
    {month:'2027-05',targets:[]},
    {month:'2027-06',targets:[]},
  ],
};
