'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownUp, ArrowUpRight, BellRing, BookOpen, CalendarDays, Check, ChevronDown, Clipboard, GraduationCap, Link2, LogOut, Moon, Plus, Search, Send, ShieldCheck, Sun, UserMinus, Users, X } from 'lucide-react';
import { studentMetrics, type ExamComparison } from '@/lib/classroom/metrics';
import { Conversation } from './conversation';
import { AccountDeleteDialog } from './account-delete-dialog';
import { StudentExamProgress } from './exam-progress';
import { formatDate, roleLabel, statusLabel, useClassroom, type Account, type Application, type ClassroomState, type Command, type Student } from './api';
import { useStudentPresence } from './presence';
import styles from './classroom.module.css';

function duration(seconds: number | null) { if (seconds === null) return '—'; const minutes = Math.floor(seconds / 60); return minutes < 60 ? `${minutes} dk` : `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`; }
function net(value: number | null | undefined) { return value == null ? '—' : value.toLocaleString('tr-TR', { maximumFractionDigits: 2 }); }
function delta(value: number | null) { return value === null ? 'Önceki veri yok' : `${value > 0 ? '+' : ''}${net(value)} net`; }
const presenceLabels = { working: 'Çalışıyor', break: 'Molada', online: 'Çevrimiçi', offline: 'Çevrimdışı' };

function ExamCard({ data, label }: { data: ExamComparison | null; label: string }) {
  return <section className={styles.detailCard}><div className={styles.sectionHeading}><h3>Son {label} denemesi</h3>{data && <strong className={styles.examNet}>{net(data.exam.total_net)}<small> net</small></strong>}</div>
    {data ? <><p className={styles.examCaption}>{data.exam.name} · {formatDate(`${data.exam.exam_date}T12:00:00+03:00`, false)}</p><p className={styles.examDelta} data-trend={data.delta === null ? 'none' : data.delta >= 0 ? 'up' : 'down'}>{delta(data.delta)}{data.previous && <span> · {formatDate(`${data.previous.exam_date}T12:00:00+03:00`, false)} tarihli denemeye göre</span>}</p>
      <div className={styles.tableWrap}><table><caption className="sr-only">{label} ders sonuçları ve önceki denemeye göre değişimler</caption><thead><tr><th>Ders</th><th title="Doğru">D</th><th title="Yanlış">Y</th><th title="Boş">B</th><th>Net</th><th>Değişim</th></tr></thead><tbody>{data.sections.map(section => <tr key={section.key}><th scope="row">{section.label}</th><td>{section.correct ?? '—'}</td><td>{section.wrong ?? '—'}</td><td>{section.blank ?? '—'}</td><td><strong>{net(section.net)}</strong></td><td data-trend={section.delta === null ? 'none' : section.delta >= 0 ? 'up' : 'down'}>{section.delta === null ? '—' : `${section.delta > 0 ? '+' : ''}${net(section.delta)}`}</td></tr>)}</tbody></table></div>
    </> : <p className={styles.emptySmall}>Henüz tamamlanmış {label} denemesi yok.</p>}
  </section>;
}

function StudentRow({ student, state, command, busy, onRemoved }: { student: Student; state: ClassroomState; command: Command; busy: boolean; onRemoved: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderBody, setOrderBody] = useState('');
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const removeTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRemovalRef = useRef<HTMLButtonElement>(null);
  const restoreFocusAfterCancelRef = useRef(false);
  useEffect(() => {
    if (confirmRemoval) cancelRemovalRef.current?.focus();
    else if (restoreFocusAfterCancelRef.current) {
      restoreFocusAfterCancelRef.current = false;
      removeTriggerRef.current?.focus();
    }
  }, [confirmRemoval]);
  const metrics = useMemo(() => studentMetrics(student.state, new Date(state.server_now)), [student.state, state.server_now]);
  const unread = state.messages.filter(message => message.student_id === student.id && message.sender_id !== state.account?.id && !message.read_at).length;
  const maximum = Math.max(3600, ...metrics.weeklyStudy.map(day => day.seconds ?? 0));
  const values = [{ label: 'Bugün çalışma', value: duration(metrics.todaySeconds), empty: metrics.todaySeconds === null }, { label: 'Bu hafta', value: duration(metrics.weekSeconds), empty: metrics.weekSeconds === null }, { label: 'TYT neti', value: net(metrics.latestTYT?.exam.total_net), empty: metrics.latestTYT?.exam.total_net == null }, { label: 'AYT neti', value: net(metrics.latestAYT?.exam.total_net), empty: metrics.latestAYT?.exam.total_net == null }, { label: 'Bugün soru', value: metrics.todayQuestions === null ? '—' : String(metrics.todayQuestions), empty: metrics.todayQuestions === null }];
  return <article className={`${styles.studentRow} ${expanded ? styles.expandedRow : ''}`}>
    <button className={styles.rowToggle} onClick={() => { setExpanded(!expanded); setConfirmRemoval(false); setRemoveError(''); }} aria-expanded={expanded} aria-controls={`student-detail-${student.id}`}>
      <span className={styles.studentIdentity}><span className={styles.studentAvatar}>{student.name.split(' ').slice(0, 2).map(name => name[0]).join('')}</span><span><strong>{student.name}</strong><span className={styles.presence} data-status={student.presence.status}><i />{presenceLabels[student.presence.status]}{unread > 0 && <b>{unread} yeni cevap</b>}</span></span></span>
      <span className={styles.rowMetrics}>{values.map(item => <span className={styles.metricBox} key={item.label} title={item.empty ? 'Henüz veri yok' : undefined}><strong>{item.value}</strong><small>{item.label}</small></span>)}</span><ChevronDown className={styles.chevron} size={19} />
    </button>
    {expanded && <div id={`student-detail-${student.id}`} className={styles.studentDetail}>
      <div className={styles.detailNote}><ShieldCheck size={15} /><span>Öğrenci istatistikleri salt okunur.</span><span>Son görülme: {formatDate(student.presence.last_seen)}</span></div>
      <section className={styles.membershipPanel} aria-label={`${student.name} sınıf üyeliği`}>
        <div><strong>Sınıf üyeliği</strong><p>Bu öğrenci artık sınıfında olmamalıysa bağlantısını kaldırabilirsin.</p></div>
        {!confirmRemoval ? <button ref={removeTriggerRef} type="button" className={styles.dangerButton} disabled={busy} onClick={() => { setRemoveError(''); setConfirmRemoval(true); }}><UserMinus size={16} />Sınıftan çıkar</button> : <div className={styles.removeConfirmation}>
          <p><strong>{student.name}</strong> adlı öğrenciyi sınıfından çıkarmak istediğine emin misin? Öğrencinin hesabı ve çalışma kayıtları korunur.</p>
          <div className={styles.actions}><button ref={cancelRemovalRef} type="button" className={styles.secondaryButton} disabled={removing} onClick={() => { restoreFocusAfterCancelRef.current = true; setConfirmRemoval(false); setRemoveError(''); }}>Vazgeç</button><button type="button" className={styles.dangerButton} disabled={busy || removing} onClick={async () => { setRemoving(true); setRemoveError(''); try { if (await command('student.remove', { id: student.id })) onRemoved(student.name); else setRemoveError('Öğrenci sınıftan çıkarılamadı. Lütfen tekrar dene.'); } finally { setRemoving(false); } }}><UserMinus size={16} />{removing ? 'Çıkarılıyor…' : 'Evet, sınıftan çıkar'}</button></div>
          {removeError && <p role="alert" className={styles.removeError}>{removeError}</p>}
        </div>}
      </section>
      <div className={styles.detailGrid}><ExamCard data={metrics.latestTYT} label="TYT" /><ExamCard data={metrics.latestAYT} label="AYT" />
        <StudentExamProgress exams={student.state.exams} today={metrics.today} studentId={student.id} />
        <section className={styles.detailCard}><div className={styles.sectionHeading}><h3>Bu haftanın çalışma ritmi</h3><span className={styles.muted}>Net süre</span></div><div className={styles.weekChart} role="img" aria-label={metrics.weeklyStudy.map(day => `${day.label}: ${day.seconds === null ? 'henüz veri yok' : duration(day.seconds)}`).join(', ')}>{metrics.weeklyStudy.map(day => <div key={day.date} className={styles.dayColumn}><span>{duration(day.seconds)}</span><div className={styles.barTrack}><i style={{ height: `${((day.seconds ?? 0) / maximum) * 100}%` }} /></div><strong>{day.label}</strong></div>)}</div><p className={styles.mutedSmall}>Pazartesi–pazar · İstanbul saati · Molalar hariç</p></section>
        <section className={styles.detailCard}><div className={styles.sectionHeading}><h3>Konu tamamlama</h3><BookOpen size={17} /></div>{metrics.topicProgress.length ? <div className={styles.topicList} tabIndex={0} role="region" aria-label="Ders bazında konu tamamlama">{metrics.topicProgress.map(subject => <div key={`${subject.exam}-${subject.subject}`}><div><span>{subject.exam} · {subject.subject}</span><strong>{subject.completed}/{subject.total}</strong></div><progress value={subject.completed} max={subject.total} aria-label={`${subject.exam} ${subject.subject} konu tamamlama`} /></div>)}</div> : <p className={styles.emptySmall}>Henüz konu verisi yok.</p>}<p className={styles.mutedSmall}>Konu anlatımı tamamlanan konuların oranı.</p></section>
      </div>
      <div className={styles.questionSummary}><strong>Bugün {metrics.todayQuestions === null ? 'henüz soru kaydı yok' : `${metrics.todayQuestions} soru`}</strong><div>{metrics.questionSubjects.map(subject => <span key={subject.key}>{subject.exam ? `${subject.exam} · ` : ''}{subject.subject}<b>{subject.questions}</b></span>)}</div></div>
      <section className={styles.studyOrder} aria-label={`${student.name} için çalışma emri`}>
        <div className={styles.orderToolbar}><div><strong>Çalışma emri</strong><p>Öğrencinin ekranında Tamam ve Hayır seçenekleriyle tam ekran açılır.</p></div><button type="button" className={styles.orderButton} aria-expanded={orderOpen} aria-controls={`study-order-${student.id}`} onClick={() => setOrderOpen(!orderOpen)}><BellRing size={17} />Çalışma emri gönder</button></div>
        {orderOpen && <form id={`study-order-${student.id}`} className={styles.orderComposer} onSubmit={async event => { event.preventDefault(); if (!orderBody.trim()) return; if (await command('alert.send', { student_id: student.id, body: orderBody.trim() })) { setOrderBody(''); setOrderOpen(false); } }}>
          <label htmlFor={`study-order-body-${student.id}`}>Çalışma emri</label><textarea id={`study-order-body-${student.id}`} value={orderBody} onChange={event => setOrderBody(event.target.value)} maxLength={240} rows={3} required placeholder="Örneğin: Matematik tekrarına şimdi başla." />
          <div className={styles.orderFooter}><small>{orderBody.length}/240 · Tamam demek ders zamanlayıcısını başlatmaz.</small><button className={styles.primaryButton} disabled={busy || !orderBody.trim()}><Send size={16} />{busy ? 'Gönderiliyor…' : 'Emri gönder'}</button></div>
        </form>}
      </section>
      <Conversation state={state} studentId={student.id} command={command} busy={busy} teacher />
    </div>}
  </article>;
}

function TeacherStudents({ state, command, busy }: { state: ClassroomState; command: Command; busy: boolean }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [removedName, setRemovedName] = useState('');
  const students = useMemo(() => {
    const selected = state.students.filter(student => student.name.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR').trim()));
    const scores = new Map(selected.map(student => [student.id, studentMetrics(student.state, new Date(state.server_now))]));
    return selected.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'tr') : sort === 'status' ? Number(b.presence.online) - Number(a.presence.online) || a.name.localeCompare(b.name, 'tr') : sort === 'week' ? (scores.get(b.id)?.weekSeconds ?? -1) - (scores.get(a.id)?.weekSeconds ?? -1) : (scores.get(b.id)?.todayQuestions ?? -1) - (scores.get(a.id)?.todayQuestions ?? -1));
  }, [state.students, state.server_now, query, sort]);
  return <>{removedName && <div className={styles.membershipNotice} role="status"><Check size={17} /><span>{removedName} sınıfından çıkarıldı. Hesabı ve çalışma kayıtları korundu.</span><button type="button" onClick={() => setRemovedName('')} aria-label="Bildirimi kapat"><X size={16} /></button></div>}<div className={styles.listToolbar}><label className={styles.search}><Search size={18} /><input aria-label="Öğrenci adına göre ara" placeholder="Öğrenci ara…" value={query} onChange={event => setQuery(event.target.value)} /></label><label className={styles.sort}><ArrowDownUp size={16} /><select aria-label="Öğrencileri sırala" value={sort} onChange={event => setSort(event.target.value)}><option value="name">İsim, A–Z</option><option value="status">Çevrimiçi olanlar önce</option><option value="week">Haftalık çalışma, çoktan aza</option><option value="questions">Bugünkü soru, çoktan aza</option></select></label></div>
    <div className={styles.listCaption}><span>{students.length} öğrenci</span><span>Detayları ve mesajları görmek için bir satırı aç.</span></div>
    <div className={styles.studentList}>{students.map(student => <StudentRow key={student.id} student={student} state={state} command={command} busy={busy} onRemoved={setRemovedName} />)}</div>
    {!students.length && <div className={styles.emptyState}><Users size={30} /><h2>{query ? 'Bu isimle öğrenci bulunamadı.' : 'Sınıfın yeni başlangıçlara hazır.'}</h2><p>{query ? 'Aramanı kısaltarak tekrar deneyebilirsin.' : 'Davet bağlantını paylaş. Başvuran öğrencileri onayladıktan sonra burada görünecekler.'}</p></div>}
    <p className={styles.metricExplanation}>Çalışma süreleri mola ve duraklamalar hariçtir. Gün ve pazartesi başlayan hafta İstanbul saatine göre hesaplanır. TYT / AYT, son tamamlanmış ilgili denemenin toplam netidir. “—” henüz veri olmadığını belirtir.</p>
  </>;
}

function Invitations({ state, command, busy }: { state: ClassroomState; command: Command; busy: boolean }) {
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const [days, setDays] = useState('7');
  return <section className={styles.panel}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SINIFINA DAVET ET</p><h2>Yeni bir yolculuk, tek bağlantı.</h2></div><Link2 size={26} /></div><p className={styles.intro}>Aynı bağlantıyla birden fazla öğrenci başvurabilir. Öğrencilerin başvurularını Başvurular sekmesinden sen onaylar veya reddedersin; yönetici de gerektiğinde bu başvuruları yönetebilir. Başvuru için e-posta iletisi gerekmez.</p>
    <div className={styles.inviteCreate}><label>Bağlantının süresi<select value={days} onChange={event => setDays(event.target.value)}><option value="1">1 gün</option><option value="7">7 gün</option><option value="14">14 gün</option><option value="30">30 gün</option></select></label><button className={styles.primaryButton} disabled={busy} onClick={() => void command('invite.create', { expires_in_days: Number(days) })}><Plus size={17} />Davet bağlantısı oluştur</button></div>
    {copyError && <p role="alert" className={styles.error}>{copyError}</p>}
    <div className={styles.inviteList}>{state.invites.map(invite => { const active = !invite.revoked_at && new Date(invite.expires_at).getTime() > new Date(state.server_now).getTime(); return <article key={invite.id}><div><span className={styles.statusPill} data-status={active ? 'approved' : 'rejected'}>{invite.revoked_at ? 'İptal edildi' : active ? 'Aktif davet' : 'Süresi doldu'}</span><p>Son kullanım: {formatDate(invite.expires_at)}</p><code>/join?token={invite.token.slice(0, 12)}…</code></div><div className={styles.actions}><button className={styles.secondaryButton} disabled={!active} onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/join?token=${encodeURIComponent(invite.token)}`); setCopied(invite.id); setCopyError(''); } catch { setCopyError('Kopyalama kullanılamıyor. Bağlantıyı açıp adres çubuğundan kopyalayabilirsin.'); } }}>{copied === invite.id ? <Check size={16} /> : <Clipboard size={16} />}{copied === invite.id ? 'Kopyalandı' : 'Kopyala'}</button>{active && <><Link className={styles.secondaryButton} href={`/join?token=${encodeURIComponent(invite.token)}`} target="_blank">Aç<ArrowUpRight size={15} /></Link><button className={styles.dangerButton} disabled={busy} onClick={() => void command('invite.revoke', { id: invite.id })}><X size={16} />İptal et</button></>}</div></article>; })}</div>
    {!state.invites.length && <p className={styles.emptySmall}>Henüz davet bağlantısı oluşturmadın.</p>}
  </section>;
}

function ApplicationCard({ application, command, busy, teacherName, teacherActive = true, highlighted = false }: {
  application: Application;
  command: Command;
  busy: boolean;
  teacherName?: string;
  teacherActive?: boolean;
  highlighted?: boolean;
}) {
  const role = application.requested_role === 'teacher' ? 'Öğretmen' : application.teacher_id ? 'Davetli öğrenci' : 'Bireysel öğrenci';
  return <article id={`application-${application.id}`} className={highlighted ? styles.highlightApplication : undefined}>
    <div className={styles.applicationTop}><div><h3>{application.name}</h3><p>{application.email}</p></div><span className={styles.statusPill} data-status={application.status}>{statusLabel[application.status] ?? application.status}</span></div>
    <p className={styles.mutedSmall}>{role} başvurusu · {formatDate(application.created_at)}</p>
    {application.teacher_id && teacherName && <p className={styles.inlineInfo}>Davet eden öğretmen: {teacherName}</p>}
    {application.status === 'pending' && application.teacher_id && !teacherActive && <p className={styles.mutedSmall}>Davet eden öğretmen etkin olmadığı için bu başvuru onaylanamaz.</p>}
    {application.status === 'pending' && <div className={styles.actions}>
      <button className={styles.primaryButton} disabled={busy || !teacherActive} onClick={() => void command('application.review', { id: application.id, decision: 'approved' })}><Check size={16} />Onayla</button>
      <button className={styles.dangerButton} disabled={busy} onClick={() => void command('application.review', { id: application.id, decision: 'rejected' })}><X size={16} />Reddet</button>
    </div>}
  </article>;
}

function TeacherApplications({ state, command, busy }: { state: ClassroomState; command: Command; busy: boolean }) {
  const [show, setShow] = useState<'pending' | 'all'>('pending');
  const ownApplications = state.applications.filter(application => application.requested_role === 'student' && application.teacher_id === state.account?.id);
  const applications = ownApplications.filter(application => show === 'all' || application.status === 'pending');
  return <section className={styles.panel}>
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SINIF ERİŞİMİ</p><h2>Öğrenci başvuruları</h2></div><select className={styles.compactSelect} aria-label="Öğrenci başvuru durumu" value={show} onChange={event => setShow(event.target.value as 'pending' | 'all')}><option value="pending">Bekleyenler</option><option value="all">Tümü</option></select></div>
    <p className={styles.intro}>Davet bağlantınla kayıt olan öğrencilerin adını ve e-posta adresini inceleyip sınıfına kabul edebilirsin. E-posta adresinin başvurana ait olduğu otomatik doğrulanmaz; yalnızca tanıdığın öğrencileri onayla.</p>
    <div className={styles.applicationList}>{applications.map(application => <ApplicationCard key={application.id} application={application} command={command} busy={busy} />)}</div>
    {!applications.length && <p className={styles.emptySmall}>{show === 'pending' ? 'Bekleyen öğrenci başvurusu yok.' : 'Henüz öğrenci başvurusu yok.'}</p>}
  </section>;
}

function Administration({ state, command, busy, error }: { state: ClassroomState; command: Command; busy: boolean; error: string }) {
  const [show, setShow] = useState<'pending' | 'all'>('pending');
  const [targetId, setTargetId] = useState('');
  const [deleteAccount, setDeleteAccount] = useState<Account | null>(null);
  const [deletedNotice, setDeletedNotice] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountsHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreDeleteFocusRef = useRef<'trigger' | 'heading' | null>(null);
  useEffect(() => {
    if (deleteAccount || !restoreDeleteFocusRef.current) return;
    if (restoreDeleteFocusRef.current === 'heading') accountsHeadingRef.current?.focus();
    else deleteTriggerRef.current?.focus();
    restoreDeleteFocusRef.current = null;
  }, [deleteAccount]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('application');
    if (id) queueMicrotask(() => { setTargetId(id); setShow('all'); });
  }, []);
  useEffect(() => { if (targetId) document.getElementById(`application-${targetId}`)?.scrollIntoView({ block: 'center' }); }, [targetId]);
  const approvedTeachers = (state.accounts ?? []).filter(account => account.role === 'teacher' && account.status === 'approved');
  const applications = state.applications.filter(application => show === 'all' || application.status === 'pending');
  return <div className={styles.adminGrid}><section className={styles.panel}>
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ERİŞİM YÖNETİMİ</p><h2>Başvurular</h2></div><select className={styles.compactSelect} aria-label="Başvuru durumu" value={show} onChange={event => setShow(event.target.value as 'pending' | 'all')}><option value="pending">Bekleyenler</option><option value="all">Tümü</option></select></div>
    <p className={styles.intro}>Öğretmen ve bireysel öğrenci başvurularını burada onayla veya reddet. Davetli öğrencileri kendi öğretmenleri değerlendirir; gerektiğinde sen de bu başvuruları yönetebilirsin.</p>
    <p className={styles.mutedSmall}>Başvuru için e-posta iletisi gönderilmez ve e-posta adresinin başvurana ait olduğu otomatik doğrulanmaz. Onaylamadan önce adı, adresi ve rolü kontrol et. Şifreler görüntülenmez.</p>
    <div className={styles.applicationList}>{applications.map(application => {
      const invitedTeacher = application.teacher_id ? (state.accounts ?? []).find(account => account.id === application.teacher_id) : null;
      const teacherActive = !application.teacher_id || invitedTeacher?.role === 'teacher' && invitedTeacher.status === 'approved';
      return <ApplicationCard key={application.id} application={application} command={command} busy={busy} teacherName={invitedTeacher?.name ?? (application.teacher_id ? 'Öğretmen bulunamadı' : undefined)} teacherActive={teacherActive} highlighted={targetId === application.id} />;
    })}</div>
    {!applications.length && <p className={styles.emptySmall}>{show === 'pending' ? 'Bekleyen başvuru yok.' : 'Henüz başvuru yok.'}</p>}
  </section><section className={styles.panel}>
    <div className={styles.sectionHeading}><h2 ref={accountsHeadingRef} tabIndex={-1}>Kullanıcılar</h2><span className={styles.muted}>{state.accounts?.length ?? 0} hesap</span></div>
    {deletedNotice && <div className={styles.membershipNotice} role="status"><Check size={17} aria-hidden="true" /><span>Kişinin hesabı ve veritabanındaki tüm verileri kalıcı olarak silindi.</span><button type="button" onClick={() => setDeletedNotice(false)} aria-label="Bildirimi kapat"><X size={16} /></button></div>}
    <div className={styles.accountList}>{(state.accounts ?? []).map(account => <article key={account.id}>
      <div><h3>{account.name}</h3><p>{account.email}</p><small>{roleLabel[account.role]} · {statusLabel[account.status]}{account.teacher_id && ` · ${approvedTeachers.find(teacher => teacher.id === account.teacher_id)?.name ?? 'Atanmış sınıf'}`}</small></div>
      {account.role !== 'admin' && account.id !== state.account?.id && <div className={styles.accountActions}>
        {(account.status === 'approved' || account.status === 'suspended') && <button className={account.status === 'suspended' ? styles.secondaryButton : styles.dangerButton} disabled={busy} onClick={() => void command('account.suspend', { id: account.id, suspended: account.status !== 'suspended' })}>{account.status === 'suspended' ? 'Erişimi aç' : 'Erişimi durdur'}</button>}
        <button type="button" className={styles.dangerButton} disabled={busy} aria-label={`${account.name} kişisini sil`} onClick={event => { deleteTriggerRef.current = event.currentTarget; setDeleteAccount(account); }}><UserMinus size={15} aria-hidden="true" />Kişiyi sil</button>
      </div>}
    </article>)}</div>
  </section>
  {deleteAccount && <AccountDeleteDialog account={deleteAccount} command={command} busy={busy} error={error} onCancel={() => { restoreDeleteFocusRef.current = 'trigger'; setDeleteAccount(null); }} onDeleted={() => { restoreDeleteFocusRef.current = 'heading'; setDeleteAccount(null); setDeletedNotice(true); }} />}
  </div>;
}

export function ClassroomWorkspace() {
  const router = useRouter();
  const { state, error, busy, command, refresh } = useClassroom();
  const [tab, setTab] = useState<'students' | 'applications' | 'invites'>('students');
  const [appearance, setAppearance] = useState('light');
  const [accent, setAccent] = useState('sage');
  useEffect(() => { queueMicrotask(() => { setAppearance(localStorage.getItem('yksim-teacher-appearance') === 'dark' ? 'dark' : 'light'); const saved = localStorage.getItem('yksim-teacher-accent'); if (saved && ['sage', 'slate', 'plum'].includes(saved)) setAccent(saved); }); }, []);
  const account = state?.account;
  useStudentPresence(account);
  useEffect(() => {
    if (account?.role !== 'teacher' || account.status !== 'approved') return;
    // Expired device leases and finished countdowns have no event until read again.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [account?.role, account?.status, refresh]);
  const pendingAccount = account && account.status !== 'approved';
  const activeStudents = state?.students.filter(student => student.presence.status === 'working').length ?? 0;
  const pendingStudentApplications = state?.applications.filter(application => application.requested_role === 'student' && application.teacher_id === account?.id && application.status === 'pending').length ?? 0;
  const pendingMessage = account?.role === 'teacher'
    ? 'Öğretmen başvurun yönetici onayı bekliyor.'
    : account?.teacher_id
      ? 'Öğrenci başvurun davet eden öğretmenin onayını bekliyor.'
      : 'Bireysel öğrenci başvurun yönetici onayı bekliyor.';
  if (!state) return <div className={styles.workspace} data-appearance={appearance} data-accent={accent}><main className={styles.main}>
    {error ? <div className={styles.error} role="alert">{error}<button className={styles.secondaryButton} onClick={() => void refresh()}>Tekrar dene</button></div>
      : <div className={styles.emptyState} role="status"><GraduationCap size={30} /><p>Sınıfın hazırlanıyor…</p></div>}
  </main></div>;
  return <div className={styles.workspace} data-appearance={appearance} data-accent={accent}>
    <header className={styles.topbar}><Link href="/classroom" className={styles.brand}><span>y</span>YKSim<span className={styles.brandPeriod}>.</span><small>{account?.role === 'admin' ? 'yönetim' : account?.role === 'student' ? 'öğrenci' : 'öğretmen'}</small></Link><div className={styles.topActions}>{state?.demo && <Link href="/demo" className={styles.demoLink}>Demo hesapları<ArrowUpRight size={14} /></Link>}{account?.status === 'approved' && !state?.demo && account.role !== 'student' && <Link href="/calendar" className={styles.iconButton} aria-label="Google Takvim bağlantısı" title="Google Takvim bağlantısı"><CalendarDays size={18} /></Link>}<button className={styles.iconButton} aria-label={appearance === 'light' ? 'Koyu görünüme geç' : 'Açık görünüme geç'} onClick={() => { const next = appearance === 'light' ? 'dark' : 'light'; setAppearance(next); localStorage.setItem('yksim-teacher-appearance', next); }}>{appearance === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button><label className={styles.accentSelect}><span className="sr-only">Vurgu rengi</span><select aria-label="Vurgu rengi" value={accent} onChange={event => { setAccent(event.target.value); localStorage.setItem('yksim-teacher-accent', event.target.value); }}><option value="sage">Adaçayı</option><option value="slate">Mavi gri</option><option value="plum">Mürdüm</option></select></label>{account && <button className={styles.iconButton} aria-label="Çıkış yap" onClick={async () => { await fetch('/api/logout', { method: 'POST' }); router.replace('/'); router.refresh(); }}><LogOut size={18} /></button>}</div></header>
    <main className={styles.main}>
      {error && <div className={styles.error} role="alert">{error}<button className={styles.secondaryButton} onClick={() => void refresh()}>Tekrar dene</button></div>}
      {state && !account && <div className={styles.emptyState}><ShieldCheck size={32} /><h1>Hesabınla giriş yap.</h1><p>Sınıf alanı yalnızca onaylı hesaplara açıktır.</p><Link href="/" className={styles.primaryButton}>Giriş yap</Link><Link href="/register" className={styles.secondaryButton}>Başvuru oluştur</Link></div>}
      {pendingAccount && <div className={styles.statusScreen}><span className={styles.alertIcon}><ShieldCheck size={32} /></span><p className={styles.eyebrow}>HESAP DURUMUN</p><h1>{statusLabel[account.status]}</h1><p>{account.status === 'pending' ? pendingMessage : account.status === 'rejected' ? 'Başvurun onaylanmadı. Ayrıntılar için uygulama yöneticisiyle iletişime geçebilirsin.' : 'Hesabının erişimi yönetici tarafından durduruldu.'}</p><div className={styles.statusFacts}><strong>{account.name}</strong><span>{account.email}</span><span>{roleLabel[account.role]}</span></div>{state.applications.map(application => <p key={application.id} className={styles.mutedSmall}>{roleLabel[application.requested_role]} başvurusu · {statusLabel[application.status]} · {formatDate(application.created_at)}</p>)}{account.role==='student'&&account.status==='pending'&&<Link className={styles.primaryButton} href="/personalize">Öğrenci profilimi hazırla</Link>}<button className={styles.secondaryButton} onClick={() => void refresh()}>Durumu yenile</button></div>}
      {account?.status === 'approved' && account.role === 'student' && <div className={styles.emptyState}><BookOpen size={32} /><h1>Çalışma alanın hazır.</h1><p>{account.teacher_id ? 'Planların, denemelerin ve öğretmen mesajların öğrenci alanında.' : 'Bireysel hesabınla planlarını, çalışmalarını ve denemelerini hemen kullanabilirsin.'}</p><Link href="/" className={styles.primaryButton}>Öğrenci alanına geç<ArrowUpRight size={17} /></Link></div>}
      {account?.status === 'approved' && account.role !== 'student' && state && <><div className={styles.pageHeading}><div><p className={styles.eyebrow}>{account.role === 'admin' ? 'UYGULAMA YÖNETİMİ' : 'BİRLİKTE DAHA İLERİ'}</p><h1>{account.role === 'admin' ? 'Güvenli bir başlangıç.' : 'Sınıfına bir bakış.'}</h1><p>{account.role === 'admin' ? `${account.name}, başvuruları değerlendir ve hesap erişimlerini yönet.` : `${account.name}, öğrencilerinin çalışma yolculuğunu takip et.`}</p></div>{account.role === 'teacher' && (pendingStudentApplications > 0 ? <button className={styles.primaryButton} onClick={() => setTab('applications')}><ShieldCheck size={17} />{pendingStudentApplications} başvuruyu incele</button> : <button className={styles.primaryButton} onClick={() => setTab('invites')}><Plus size={17} />Öğrenci davet et</button>)}</div>
        {state.demo && <div className={styles.demoBanner}><span>DEMO</span>Bu alan simülasyon verileri içerir. Gerçek kullanıcı kayıtlarından ayrıdır.</div>}
        {account.role === 'teacher' ? <>
          <div className={styles.overview}><div><Users size={20} /><span><strong>{state.students.length}</strong><small>Sınıfındaki öğrenci</small></span></div><div><span className={styles.workingDot} /><span><strong>{activeStudents}</strong><small>Şu an çalışıyor{state.demo ? ' · simülasyon' : ''}</small></span></div><div><span className={styles.onlineDot} /><span><strong>{state.students.filter(student => student.presence.online).length}</strong><small>Uygulamada çevrimiçi</small></span></div></div>
          <nav className={styles.tabs} aria-label="Öğretmen alanları">
            <button onClick={() => setTab('students')} aria-current={tab === 'students' ? 'page' : undefined}><Users size={17} />Öğrencilerim<span>{state.students.length}</span></button>
            <button onClick={() => setTab('applications')} aria-current={tab === 'applications' ? 'page' : undefined}><ShieldCheck size={17} />Başvurular<span>{pendingStudentApplications}</span></button>
            <button onClick={() => setTab('invites')} aria-current={tab === 'invites' ? 'page' : undefined}><Link2 size={17} />Davet bağlantıları</button>
          </nav>
          {tab === 'students' ? <TeacherStudents state={state} command={command} busy={busy} /> : tab === 'applications' ? <TeacherApplications state={state} command={command} busy={busy} /> : <Invitations state={state} command={command} busy={busy} />}
        </> : <Administration state={state} command={command} busy={busy} error={error} />}
      </>}
      <footer className={styles.footer}><span>YKSim · Her gün bir adım.</span><span>İstanbul saati · Öğrenci verileri korumalı</span></footer>
    </main>
  </div>;
}
