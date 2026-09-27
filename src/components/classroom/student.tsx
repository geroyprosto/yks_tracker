'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, BookOpen, Clock3, MessageCircle, X } from 'lucide-react';
import type { AppState } from '@/lib/domain/types';
import { useClassroom, type Command, type StudyAlert } from './api';
import { Conversation } from './conversation';
import { useStudentPresence } from './presence';
import styles from './classroom.module.css';

const motivation = [
  'Küçük bir başlangıç, büyük bir fark yaratabilir.', 'Rakiplerin ilerlerken sen de bir adım atabilirsin.',
  'Gelecekteki sen, bugünkü emeğine teşekkür edecek.', 'Bir soru bile sıfır sorudan daha ileridir.',
  'Motivasyonu bekleme; ilk adım bazen motivasyonu getirir.', 'Hedefine yaklaşmak için mükemmel bir gün gerekmiyor.',
  'Bugünün küçük çabası, yarının güçlü alışkanlığı olabilir.', 'Kendi dünkü halini bir adım geçmeye ne dersin?',
  'Beş dakika odaklanmayı deneyebilirsin.', 'Karar senin. Hazır olduğunda yeni bir başlangıç yapabilirsin.',
];

function useServerClock(serverNow: string) {
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    const serverStart = Date.parse(serverNow);
    const clientStart = performance.now();
    const update = () => setNow(serverStart + performance.now() - clientStart);
    queueMicrotask(update);
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return now;
}

function countdown(seconds: number) {
  const remaining = Math.max(0, seconds);
  return `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
}

function AcceptedCountdown({ alert, serverNow, refresh }: { alert: StudyAlert; serverNow: string; refresh: () => Promise<void> }) {
  const now = useServerClock(serverNow);
  const remaining = Math.max(0, Math.ceil((Date.parse(alert.followup_due_at!) - now) / 1000));
  useEffect(() => {
    if (remaining > 0) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    queueMicrotask(() => void refresh());
    return () => window.clearInterval(timer);
  }, [remaining, refresh]);
  return <section className={styles.studyCountdown} aria-label="Çalışma emri sayacı">
    <Clock3 size={22} aria-hidden="true" />
    <div><strong>Tamam dedin; şimdi bir ders başlat.</strong><p>Ders zamanlayıcısını açıp çalışmaya başladığında öğretmenin bunu görür.</p></div>
    <div className={styles.countdownValue}><span>Derse başlamak için kalan süre</span><time dateTime={`PT${remaining}S`}>{countdown(remaining)}</time></div>
  </section>;
}

function FullscreenAlert({ alert, serverNow, command, busy, error }: { alert: StudyAlert; serverNow: string; command: Command; busy: boolean; error: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const noButton = useRef<HTMLButtonElement>(null);
  const acceptButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const finished = alert.refusal_count >= 10 || alert.status === 'declined';
  const now = useServerClock(serverNow);
  const unlockAt = alert.closed_at ? Date.parse(alert.closed_at) + 5 * 60_000 : Number.POSITIVE_INFINITY;
  const lockSeconds = Math.max(0, Math.ceil((unlockAt - now) / 1000));
  const locked = finished && lockSeconds > 0;
  useEffect(() => {
    const element = dialog.current; const previous = document.activeElement as HTMLElement | null;
    element?.showModal(); (acceptButton.current ?? element)?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => { const reposition = () => setPosition(null); window.addEventListener('resize', reposition); return () => window.removeEventListener('resize', reposition); }, []);
  useEffect(() => { if (finished) (locked ? dialog.current : acceptButton.current)?.focus(); }, [finished, locked]);
  function moveButton() {
    const bounds = dialog.current?.getBoundingClientRect(); if (!bounds) return;
    const width = noButton.current?.offsetWidth ?? 112; const height = noButton.current?.offsetHeight ?? 48;
    const minX = 18; const maxX = Math.max(minX, bounds.width - width - 18);
    const acceptTop = (acceptButton.current?.getBoundingClientRect().top ?? bounds.height - 80) - bounds.top;
    const contentBottom = (content.current?.getBoundingClientRect().bottom ?? bounds.height * .48) - bounds.top;
    const maxY = Math.max(18, acceptTop - height - 18);
    const minY = Math.min(maxY, Math.max(18, contentBottom + 12));
    let next = { left: minX, top: minY };
    for (let attempt = 0; attempt < 12; attempt++) { next = { left: minX + Math.random() * (maxX - minX), top: minY + Math.random() * (maxY - minY) }; if (!position || Math.hypot(next.left - position.left, next.top - position.top) > 60) break; }
    if (position && Math.hypot(next.left - position.left, next.top - position.top) < 40) next.left = position.left > (maxX + minX) / 2 ? minX : maxX;
    setPosition(next);
  }
  return <dialog ref={dialog} tabIndex={-1} className={`${styles.fullscreenAlert} ${styles.studentTheme} ${locked ? styles.lockedAlert : ''}`} aria-labelledby="study-alert-title" aria-describedby="study-alert-description" onCancel={event => event.preventDefault()}>
    <div className={styles.alertContent} ref={content}><span className={styles.alertIcon}><BookOpen size={30} /></span><p className={styles.eyebrow}>ÖĞRETMENİNDEN BİR HATIRLATMA</p>
      <h2 id="study-alert-title">{finished ? 'Peki, sen bilirsin.' : alert.kind === 'followup' ? 'E hani başlıyordun?' : alert.body}</h2>
      <p id="study-alert-description" className={styles.alertDescription}>{finished ? '10 kez Hayır dedin. Beş dakikalık bekleme bitince ekranı kapatabilirsin.' : alert.kind === 'followup' ? 'Tamam demiştin ama 15 dakika içinde bir ders başlatmadın. Hazır olduğunda ders zamanlayıcısını kendin başlatabilirsin.' : 'Tamam dediğinde öğretmenine çalışacağını onayladığın bildirilir. Bir ders başlatmak için zamanlayıcını ayrıca açmalısın.'}</p>
      <p className={styles.motivation} aria-live="polite">{alert.refusal_count > 0 && !finished ? motivation[Math.min(alert.refusal_count - 1, motivation.length - 1)] : '\u00a0'}</p>
      {!finished && alert.kind === 'initial' && <small className={styles.muted}>{alert.refusal_count}/10 Hayır</small>}
      {locked && <div className={styles.lockCountdown}><span>Ekran kilidi</span><time dateTime={`PT${lockSeconds}S`}>{countdown(lockSeconds)}</time><small>Süre bitince kapatma düğmesi açılacak.</small></div>}
      {alert.kind === 'followup' && !finished && <p className={styles.followupElapsed}>15 dakikalık sayaç doldu.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
    {!locked && <div className={styles.alertAccept}><button ref={acceptButton} className={styles.primaryButton} disabled={busy} onClick={() => void command('alert.respond', { id: alert.id, response: finished ? 'dismiss' : 'accept' })}>{finished ? 'Kapat ve devam et' : alert.kind === 'followup' ? 'Haklısın...' : 'Tamam'}</button></div>}
    {!finished && alert.kind === 'initial' && <button ref={noButton} className={`${styles.noButton} ${position ? styles.movedNo : ''}`} style={position ?? undefined} disabled={busy} onClick={async () => { if (await command('alert.respond', { id: alert.id, response: 'refuse' })) { moveButton(); requestAnimationFrame(() => noButton.current?.focus()); } }}>Hayır</button>}
  </dialog>;
}

export function StudentClassroom({ state: studentState }: { state?: AppState }) {
  const [enabled, setEnabled] = useState(false);
  const { state, error, busy, command, refresh } = useClassroom(enabled);
  const [open, setOpen] = useState(false);
  const [hiddenError, setHiddenError] = useState(false);
  const account = state?.account;
  useStudentPresence(account);
  useEffect(() => {
    let active = true;
    if (studentState?.authenticated === false) { queueMicrotask(() => { if (active) setEnabled(false); }); return () => { active = false; }; }
    void fetch('/api/classroom/session', { cache: 'no-store' }).then(response => response.json()).then(body => {
      if (active) setEnabled(body.account?.role === 'student' && body.account.status === 'approved');
    }).catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, [studentState?.authenticated]);
  if (!state || account?.role !== 'student' || account.status !== 'approved') return null;
  const alert = state.alerts.filter(item => item.student_id === account.id && (item.status === 'pending' || item.status === 'declined')).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const accepted = state.alerts.filter(item => item.student_id === account.id && item.kind === 'initial' && item.status === 'accepted' && item.followup_due_at && !item.started_at && !state.alerts.some(followup => followup.parent_id === item.id)).sort((a, b) => a.followup_due_at!.localeCompare(b.followup_due_at!))[0];
  const unread = state.messages.filter(message => message.sender_id !== account.id && !message.read_at).length;
  const pendingClassInvite = state.applications.some(application => application.requested_role === 'student' && application.status === 'pending' && application.teacher_id);
  return <div className={styles.studentTheme}>
    {accepted && <AcceptedCountdown key={accepted.id} alert={accepted} serverNow={state.server_now} refresh={refresh} />}
    {pendingClassInvite && <Link className={styles.inlineInfo} href="/classroom">Sınıfa katılım isteğin yönetici onayı bekliyor. Başvuru durumunu gör.</Link>}
    {account.teacher_id && <section className={styles.studentInbox}><button className={styles.inboxToggle} aria-expanded={open} aria-controls="student-classroom-messages" onClick={() => setOpen(!open)}><MessageCircle size={19} /><span>Öğretmen mesajları<small>{unread ? `${unread} okunmamış mesaj` : 'Mesajlar ve cevapların'}</small></span>{unread > 0 && <b className={styles.unreadCount}>{unread}</b>}<span className={styles.inboxChevron}>{open ? '−' : '+'}</span></button>
      {open && <div id="student-classroom-messages" className={styles.inboxBody}><Conversation state={state} studentId={account.id} command={command} busy={busy} /></div>}
    </section>}
    {error && !hiddenError && <div className={styles.error} role="alert"><Bell size={16} />{error}<button type="button" aria-label="Hata bildirimini kapat" onClick={() => setHiddenError(true)}><X size={16} /></button></div>}
    {alert && <FullscreenAlert key={alert.id} alert={alert} serverNow={state.server_now} command={command} busy={busy} error={error} />}
  </div>;
}
