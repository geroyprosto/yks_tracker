'use client';

import {ArrowRight, BookOpen, CheckCircle2, ChevronDown, ClipboardList, Clock3, Moon, Smile, Sun, TriangleAlert, Zap} from 'lucide-react';
import type {CoachingReportMetrics} from '@/lib/coaching-report';
import {formatDay} from '@/lib/ui';
import styles from './analysis.module.css';

export type CoachingView = CoachingReportMetrics & {
  directions?: unknown[];
  repetition_results?: unknown[];
  homework_results?: unknown[];
  diary_observations?: {date: string; text: string; study_label: string}[];
  journal_note?: string;
  exam_note?: string;
};

type Props = {
  metrics: CoachingView;
  directions?: unknown[];
  repetitionResults?: unknown[];
  repetitionCutoff?: string | null;
  homeworkResults?: unknown[];
  journalNote?: string | null;
  examNote?: string | null;
  live: boolean;
  savedCutoff?: string | null;
  onOpenTasks?: () => void;
  onOpenJournal?: () => void;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateLabel(value: string | null | undefined) {
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDay(date, {day: 'numeric', month: 'long', year: 'numeric'}) : null;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `%${new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1}).format(value)}`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1}).format(value);
}

function netNumber(value: number) {
  return new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2}).format(value);
}

function formatHoursMinutes(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} sa ${minutes % 60} dk` : `${minutes % 60} dk`;
}

function changeValue(value: number, unit: 'percentage_points' | 'seconds') {
  return unit === 'seconds' ? formatHoursMinutes(value) : `%${compactNumber(value)}`;
}

function changeDifference(value: number, unit: 'percentage_points' | 'seconds') {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${unit === 'seconds' ? formatHoursMinutes(Math.abs(value)) : `${compactNumber(Math.abs(value))} yüzde puan`}`;
}

const changeLabels = {high_priority_rate: 'Yüksek öncelikli görevler', all_task_rate: 'Tüm görevler', study_duration: 'Çalışma süresi'};

function directionParts(value: unknown) {
  const item = record(value);
  if (!item) return null;
  const subject = string(item.subject) ?? string(item.course) ?? string(item.label);
  const candidate = string(item.title) ?? string(item.headline) ?? string(item.focus) ?? subject;
  const text = string(item.text) ?? string(item.reason) ?? string(item.rationale) ?? string(item.evidence);
  const thisWeek = string(item.this_week) ?? string(item.action_this_week) ?? string(item.week_action);
  const nextWeek = string(item.next_week) ?? string(item.action_next_week);
  const twoWeeks = string(item.within_two_weeks) ?? string(item.two_weeks) ?? string(item.action_two_weeks);
  if (!candidate && !text && !thisWeek && !nextWeek && !twoWeeks) return null;
  return {title: candidate ?? 'Bu dönem odaklan', text, thisWeek, nextWeek, twoWeeks};
}

function RepetitionRow({item, onOpenTasks}: {item: unknown; onOpenTasks?: () => void}) {
  const value = record(item);
  if (!value) return null;
  const taskIds = Array.isArray(value.task_ids) ? value.task_ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  const stages = Array.isArray(value.stages) ? value.stages.map(record).filter((stage): stage is Record<string, unknown> => stage !== null) : [];
  const status = string(value.status) ?? '';
  const topic = string(value.topic_name) ?? string(value.topic_title) ?? string(value.title) ?? string(value.topic) ?? 'Konu';
  const subject = string(value.subject);
  const name = subject ? `${subject} · ${topic}` : topic;
  const message = string(value.message) ?? string(value.display_text);
  const retry = status === 'retry_pending' || status === 'failed' || status === 'error' || stages.some(stage => stage.status === 'retry_pending');
  const skipped = status === 'skipped_past' || status === 'skipped' || (taskIds.length === 0 && !retry && stages.length > 0 && stages.every(stage => stage.status === 'skipped_past'));
  const newlyAdded = !retry && !skipped && status === 'created' && taskIds.length > 0;
  const copy = retry ? 'Eklenemedi, yeniden deneniyor.' : skipped ? 'Tekrar tarihleri geçti; yeni görev eklenmedi.'
    : newlyAdded ? 'konusu tekrar görevlerine eklendi.'
      : taskIds.length > 0 ? 'için mevcut tekrar görevleri Görevlerim’de.' : message ?? 'Tekrar işlemi doğrulanıyor.';
  const showName = retry || skipped || taskIds.length > 0;
  return <div className={styles.repetitionRow}>
    {retry ? <TriangleAlert size={18} aria-hidden="true"/> : taskIds.length > 0 ? <CheckCircle2 size={18} aria-hidden="true"/> : <Clock3 size={18} aria-hidden="true"/>}
    <span>{showName && <><strong>{name}</strong> </>}{copy}</span>
    {taskIds.length > 0 && onOpenTasks && <button type="button" onClick={onOpenTasks}>Görevlerim’de gör <ArrowRight size={14} aria-hidden="true"/></button>}
  </div>;
}

const diaryInfo = {
  early_wake: {label: 'ERKEN KALKIŞ', Icon: Sun, className: styles.diaryEarly},
  stress: {label: 'STRES', Icon: Zap, className: styles.diaryStress},
  sleep: {label: 'UYKU SÜRESİ', Icon: Moon, className: styles.diarySleep},
  mood: {label: 'RUH HÂLİ', Icon: Smile, className: styles.diaryMood},
} as const;

function DiaryCard({insight}: {insight: CoachingReportMetrics['diary_insights'][number]}) {
  const meta = diaryInfo[insight.kind];
  const groupsReady = insight.type === 'association' && insight.sufficient_data && insight.group_a.count > 0 && insight.group_b.count > 0;
  return <article className={`${styles.diaryCard} ${meta.className}`} data-testid={`diary-${insight.kind}`}>
    <div className={styles.diaryTitle}><span className={styles.diaryIcon}><meta.Icon size={23} aria-hidden="true"/></span><div><strong>{meta.label}</strong><p>{insight.text}</p></div></div>
    {groupsReady ? <div className={styles.diaryComparison}>
      <span>{insight.group_a.label}<strong>{insight.group_a.average_label}</strong><small>{insight.group_a.count} gün</small></span>
      <span>{insight.group_b.label}<strong>{insight.group_b.average_label}</strong><small>{insight.group_b.count} gün</small></span>
    </div> : <p className={styles.diarySample}>{insight.matched_days} eşleşen günlük ve çalışma günü · Şimdilik gözlem</p>}
  </article>;
}

function ExamWeek({type, period}: {type: 'TYT' | 'AYT'; period: CoachingReportMetrics['weekly_exam']['TYT']}) {
  if (!period.exams.length) return <div className={styles.examEmpty}><strong>{type}</strong><span>Bu hafta kayıtlı deneme yok.</span></div>;
  const multiple = period.exams.length > 1;
  const latest = period.exams[period.exams.length - 1];
  const totalNets = period.exams.map(exam => exam.total_net).filter((net): net is number => net !== null && Number.isFinite(net));
  const averageTotal = totalNets.length ? totalNets.reduce((sum, net) => sum + net, 0) / totalNets.length : null;
  const sectionGroups = new Map<string, {key: string; label: string; total: number; count: number}>();
  for (const exam of period.exams) {
    const recorded = new Set<string>();
    for (const section of exam.sections) {
      if (!Number.isFinite(section.net) || recorded.has(section.key)) continue;
      recorded.add(section.key);
      const group = sectionGroups.get(section.key) ?? {key: section.key, label: section.label, total: 0, count: 0};
      group.label = section.label;
      group.total += section.net;
      group.count += 1;
      sectionGroups.set(section.key, group);
    }
  }
  const sections = [...sectionGroups.values()].map(section => ({...section, net: section.total / section.count}));
  const maximum = Math.max(1, ...sections.map(section => Math.abs(section.net)));
  return <article className={styles.examCard} data-testid={`weekly-exam-${type.toLowerCase()}`}>
    <div className={styles.examTop}><span>{type}</span><div><strong>{multiple ? 'Haftalık ortalama' : latest.name}</strong><small>{multiple ? `${period.exams.length} deneme · ${totalNets.length} toplam net kaydı` : `${dateLabel(latest.date)} · 1 deneme`}</small></div><strong>{averageTotal === null ? 'Toplam net eksik' : `${netNumber(averageTotal)} net`}</strong></div>
    {sections.length ? <div className={styles.examBars}>{sections.map(section => <div className={`${styles.examBar} ${section.net < 0 ? styles.examNegative : ''}`} key={section.key} role="group" aria-label={`${section.label}: ${netNumber(section.net)} net${multiple ? `, ${section.count} kayıt ortalaması` : ''}`}>
      <span>{section.label}{multiple && <small>{section.count} kayıt</small>}</span><div className={styles.examTrack} aria-hidden="true"><span style={{width: `${Math.min(100, Math.abs(section.net) / maximum * 100)}%`}}/></div><strong>{netNumber(section.net)}</strong>
    </div>)}</div> : <p className={styles.examEmptyText}>Ders bazında net kaydı yok.</p>}
    {period.warnings.length > 0 && <div className={styles.examWarnings}><strong>Alt ders odağı</strong>{period.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
  </article>;
}

export function AnalysisCoachingPanel({metrics, directions = [], repetitionResults = [], repetitionCutoff, homeworkResults = [], journalNote, examNote, live, savedCutoff, onOpenTasks, onOpenJournal}: Props) {
  const high = metrics.priority_summary.high;
  const completed = high.done;
  const total = high.total;
  const remaining = high.remaining;
  const date = dateLabel(metrics.context.current_cutoff);
  const savedDate = dateLabel(savedCutoff);
  const previousDate = dateLabel(metrics.context.previous_cutoff);
  const shownDirections = directions.map(directionParts).filter((item): item is NonNullable<typeof item> => item !== null).slice(0, 3);
  const diary = metrics.diary_insights.filter(item => item && item.kind in diaryInfo);
  const repetitionTaskCount = new Set(repetitionResults.flatMap(item => {
    const ids = record(item)?.task_ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && !!id) : [];
  })).size;
  return <div className={styles.coaching} data-testid="analysis-coaching">
    <div className={styles.contextLine}>
      <span className={styles.contextBadge}>{live ? 'Canlı durum' : 'Kaydedilmiş rapor'}</span>
      <span>{previousDate ? `Önceki analiz: ${previousDate} → ` : 'Önceki karşılaştırma yok · '}{date ? `Veri kesimi: ${date}` : 'Kesim tarihi bilinmiyor'}</span>
      {live && savedDate && <small>Yönlendirmeler son kaydedilmiş rapordan: {savedDate}</small>}
    </div>
    <div className={styles.topGrid}>
      <section className={`${styles.panel} ${styles.priorityPanel}`} aria-labelledby="priority-title">
        <div className={styles.panelHeading}><span className={styles.panelIcon}><ClipboardList size={23} aria-hidden="true"/></span><div><h3 id="priority-title">Öncelikli görevler</h3><p>Bu haftaya planlanan yüksek öncelikli görevler</p></div></div>
        <div className={styles.priorityHero}><strong>{percent(high.rate_percent)}</strong><div><b>{completed} / {total} tamamlandı</b><span>{remaining} açık</span></div></div>
        {total === 0 && <p className={styles.mutedText}>Bu hafta yüksek öncelikli görev yok.</p>}
        <div className={styles.priorityTrack} role="progressbar" aria-label="Yüksek öncelikli görev tamamlama oranı" aria-valuemin={0} aria-valuemax={100} aria-valuenow={high.rate_percent ?? 0}><span style={{width: `${Math.max(0, Math.min(100, high.rate_percent ?? 0))}%`}}/></div>
        <p className={styles.allRate}>Tüm görevler: {metrics.priority_summary.all.done} / {metrics.priority_summary.all.total} tamamlandı · {percent(metrics.priority_summary.all.rate_percent)}</p>
        <div className={styles.subjectList}>{metrics.priority_summary.by_subject.slice(0, 3).map(item => <div className={styles.subjectRow} key={`${item.exam}:${item.subject}`}><BookOpen size={17} aria-hidden="true"/><span>{item.exam} {item.subject}</span><strong>{item.done} / {item.total}</strong><small>{percent(item.rate_percent)}</small>{item.remaining ? <TriangleAlert size={16} aria-label="Açık görev var"/> : <CheckCircle2 size={16} aria-label="Tamamlandı"/>}</div>)}</div>
        {metrics.priority_summary.by_subject.length > 3 && <details className={styles.subjectDetails}><summary>Ders ayrıntıları <ChevronDown size={16} aria-hidden="true"/></summary><div className={styles.subjectList}>{metrics.priority_summary.by_subject.slice(3).map(item => <div className={styles.subjectRow} key={`${item.exam}:${item.subject}`}><BookOpen size={17} aria-hidden="true"/><span>{item.exam} {item.subject}</span><strong>{item.done} / {item.total}</strong><small>{percent(item.rate_percent)}</small></div>)}</div></details>}
        <div className={styles.overdue}><TriangleAlert size={17} aria-hidden="true"/><span><strong>{metrics.priority_summary.overdue.high} gecikmiş yüksek öncelikli görev</strong> · Bugünden önce vadesi dolan açık görevler</span></div>
        {onOpenTasks && <button type="button" className={styles.inlineAction} onClick={onOpenTasks}>Görevlerim’e git <ArrowRight size={15} aria-hidden="true"/></button>}
      </section>
      <section className={`${styles.panel} ${styles.directionPanel}`} aria-labelledby="direction-title">
        <div className={styles.panelHeading}><span className={styles.panelIcon}><Sun size={23} aria-hidden="true"/></span><div><h3 id="direction-title">Gelişim ve yönlendirme</h3><p>Kayıtlarına göre sıradaki çalışma adımları</p></div></div>
        {metrics.retrospective_changes.length > 0 && <div className={styles.comparisonList}>{metrics.retrospective_changes.slice(0, 2).map((change, index) => <p key={`${change.metric}:${index}`}><strong>{changeLabels[change.metric]}:</strong> {changeValue(change.previous, change.unit)} → {changeValue(change.current, change.unit)} <b>({changeDifference(change.difference, change.unit)})</b></p>)}</div>}
        {metrics.retrospective_changes.length === 0 && <p className={styles.periodFacts}>Bu dönemde <strong>{metrics.study.duration_label}</strong> çalışma, <strong>{metrics.study.question_count}</strong> soru ve <strong>{metrics.study.test_count}</strong> test kaydedildi. Karşılaştırılabilir önceki analiz yoksa değişim iddiası yapılmaz.</p>}
        {shownDirections.length ? <ol className={styles.directions}>{shownDirections.map((item, index) => <li key={index}><span className={styles.directionNumber}>{index + 1}</span><div><strong>{item.title}</strong>{item.text && <p>{item.text}</p>}{item.thisWeek && <p><b>Bu hafta:</b> {item.thisWeek}</p>}{item.nextWeek && <p><b>Gelecek hafta:</b> {item.nextWeek}</p>}{item.twoWeeks && <p><b>İki hafta içinde:</b> {item.twoWeeks}</p>}</div></li>)}</ol> : <p className={styles.mutedText}>Somut yönlendirme için son raporun doğrulanmış konu ve görev kayıtları bekleniyor.</p>}
        {homeworkResults.length > 0 && <details className={styles.homeworkDetails}><summary>Görevlerim’e aktarılan ödevler <ChevronDown size={15} aria-hidden="true"/></summary><div>{homeworkResults.map((entry, index) => {
          const item = record(entry); if (!item) return null;
          const title = string(item.title) ?? 'Ödev';
          const status = string(item.status);
          const saved = status === 'created' || status === 'existing';
          return <p key={index}><span>{title} · {status === 'created' ? 'Eklendi' : status === 'existing' ? 'Zaten kayıtlı' : status === 'capacity_exceeded' ? 'Kapasite nedeniyle eklenmedi' : 'Plan değişti'}</span>{saved && onOpenTasks && <button type="button" onClick={onOpenTasks}>Görevlerim <ArrowRight size={13} aria-hidden="true"/></button>}</p>;
        })}</div></details>}
      </section>
    </div>
    <section className={`${styles.panel} ${styles.repetitionPanel}`} aria-labelledby="repetition-title"><div className={styles.panelHeading}><span className={styles.panelIcon}><ClipboardList size={22} aria-hidden="true"/></span><div><h3 id="repetition-title">Tekrar görevlerine eklenenler</h3><p>Gerçek görev kaydıyla doğrulanan pekiştirmeler{repetitionResults.length > 0 && dateLabel(repetitionCutoff) ? ` · ${dateLabel(repetitionCutoff)} analizinde` : ''}</p></div><span className={styles.lowBadge}>Düşük öncelik</span></div>
      {repetitionResults.length ? <><p className={styles.repetitionSummary}><strong>{repetitionResults.length} konu</strong> · <strong>{repetitionTaskCount} görev</strong> Görevlerim’de kayıtlı</p>
        <div className={styles.repetitionRows}>{repetitionResults.slice(0, 4).map((item, index) => <RepetitionRow key={index} item={item} onOpenTasks={onOpenTasks}/>)}</div>
        {repetitionResults.length > 4 && <details className={styles.moreRepetitions}><summary>{repetitionResults.length - 4} konuyu daha göster <ChevronDown size={15} aria-hidden="true"/></summary><div className={styles.repetitionRows}>{repetitionResults.slice(4).map((item, index) => <RepetitionRow key={index + 4} item={item} onOpenTasks={onOpenTasks}/>)}</div></details>}</>
        : <p className={styles.mutedText}>Bu analizde yeni tekrar görevi kaydı yok.</p>}
    </section>
    <section className={`${styles.panel} ${styles.diaryPanel}`} aria-labelledby="diary-title"><div className={styles.panelHeading}><span className={styles.panelIcon}><Sun size={22} aria-hidden="true"/></span><div><h3 id="diary-title">Günlüklerin ne söylüyor?</h3><p>Günlük kayıtlarınla aynı günün çalışma süresi</p></div>{onOpenJournal && <button type="button" className={styles.outlineAction} onClick={onOpenJournal}>Günlük kayıtlarını gör <ArrowRight size={15} aria-hidden="true"/></button>}</div>
      {diary.length ? <div className={styles.diaryGrid}>{diary.map(item => <DiaryCard key={item.kind} insight={item}/>)}</div> : <p className={styles.mutedText}>Günlük ve çalışma günleri arasında henüz eşleşen kayıt yok.</p>}
      {Array.isArray(metrics.diary_observations) && metrics.diary_observations.length > 0 && <div className={styles.diaryObservations}><strong>Kayıtlı günlerden gözlemler</strong><div>{metrics.diary_observations.slice(0, 4).map((item, index) => <p key={`${item.date}:${index}`}><b>{dateLabel(item.date) ?? item.date}</b><span>{item.text}</span><strong>{item.study_label} çalışma</strong></p>)}</div></div>}
      {journalNote && <div className={styles.reportNote}><strong>Son raporun günlük yorumu</strong><p>{journalNote}</p></div>}
      <p className={styles.diaryCaveat}>Günlük gözlemleri neden–sonuç kanıtı değildir. Kayıt sayısı sınırlıysa ilişki yorumu yapılmaz.</p>
    </section>
    <section className={`${styles.panel} ${styles.weeklyPanel}`} aria-labelledby="weekly-title"><div className={styles.panelHeading}><span className={styles.panelIcon}><BookOpen size={22} aria-hidden="true"/></span><div><h3 id="weekly-title">Bu haftanın TYT ve AYT netleri</h3><p>Kaydedilen denemelerin ders netleri ve alt ders odağı</p></div></div><div className={styles.examGrid}><ExamWeek type="TYT" period={metrics.weekly_exam.TYT}/><ExamWeek type="AYT" period={metrics.weekly_exam.AYT}/></div>{examNote && <div className={styles.reportNote}><strong>Son raporun deneme yorumu</strong><p>{examNote}</p></div>}</section>
  </div>;
}
