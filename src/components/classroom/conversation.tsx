'use client';

import { useState } from 'react';
import { BellRing, Check, CheckCheck, Send } from 'lucide-react';
import { categories, formatDate, type Category, type ClassroomState, type Command } from './api';
import styles from './classroom.module.css';

export function Conversation({ state, studentId, command, busy, teacher = false }: { state: ClassroomState; studentId: string; command: Command; busy: boolean; teacher?: boolean }) {
  const [mode, setMode] = useState<'message' | 'alert'>('message');
  const [category, setCategory] = useState<Category>('continue');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const messages = state.messages.filter(message => message.student_id === studentId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const roots = messages.filter(message => !message.parent_id);
  const selectedReply = replyTo || roots.at(-1)?.id || '';
  const feedback = state.feedback.filter(item => item.student_id === studentId).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return <section className={styles.conversation} aria-label="Öğretmen öğrenci konuşması">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>İLETİŞİM</p><h3>{teacher ? 'Mesajlar ve çalışma uyarıları' : 'Öğretmeninden mesajlar'}</h3></div><span className={styles.muted}>{messages.length} mesaj</span></div>
    <div className={styles.messageList} role="log" aria-label="Mesaj geçmişi" tabIndex={0}>
      {!messages.length && <p className={styles.emptySmall}>Henüz mesaj yok. {teacher ? 'Kısa bir notla öğrencine ulaş.' : 'Öğretmeninin mesajları burada görünecek.'}</p>}
      {messages.map(message => { const own = message.sender_id === state.account?.id; const categoryInfo = categories[message.category] ?? categories.continue; return <article key={message.id} className={`${styles.message} ${own ? styles.ownMessage : ''}`} data-category={message.category}>
        <header><span className={styles.category}><b aria-hidden="true">{categoryInfo.icon}</b>{message.parent_id ? 'Cevap' : categoryInfo.label}</span><time dateTime={message.created_at}>{formatDate(message.created_at)}</time></header>
        <p>{message.body}</p><footer><span>{own ? 'Sen' : teacher ? 'Öğrenci' : 'Öğretmenin'} · {message.read_at ? <><CheckCheck size={13} /> Okundu</> : <><Check size={13} /> {own ? 'İletildi' : 'Okunmadı'}</>}</span>
        {!own && !message.read_at && <button type="button" disabled={busy} onClick={() => void command('message.read', { id: message.id })}>Okundu işaretle</button>}
        {!teacher && !message.parent_id && <button type="button" onClick={() => setReplyTo(message.id)} aria-pressed={selectedReply === message.id}>Cevapla</button>}</footer>
      </article>; })}
    </div>
    {(teacher || roots.length > 0) && <form className={styles.compose} onSubmit={async event => { event.preventDefault(); if (!body.trim()) return; const type = teacher ? mode === 'alert' ? 'alert.send' : 'message.send' : 'message.reply'; const payload = teacher ? { student_id: studentId, body: body.trim(), ...(mode === 'message' ? { category } : {}) } : { id: selectedReply, body: body.trim() }; if (await command(type, payload)) setBody(''); }}>
      {teacher && <><div className={styles.segment} role="group" aria-label="Gönderi türü"><button type="button" aria-pressed={mode === 'message'} onClick={() => setMode('message')}>Normal mesaj</button><button type="button" aria-pressed={mode === 'alert'} onClick={() => setMode('alert')}><BellRing size={15} /> Tam ekran çalışma uyarısı</button></div>
        {mode === 'message' ? <div className={styles.categoryChoices} role="group" aria-label="Mesaj kategorisi">{Object.entries(categories).map(([value, item]) => <button key={value} type="button" data-category={value} aria-pressed={category === value} onClick={() => setCategory(value as Category)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</div> : <div className={styles.alertHint}><p>Öğrencinin uygulama ekranında açılır. Onay, gerçek çalışma başlangıcı ve 15 dakika takibi ayrı kaydedilir.</p><div><button type="button" onClick={() => setBody('HEMEN MASANA GEÇ!!')}>HEMEN MASANA GEÇ!!</button><button type="button" onClick={() => setBody('Hemen kütüphaneye git :)')}>Hemen kütüphaneye git :)</button></div></div>}</>}
      {!teacher && <label>Yanıtlanan mesaj<select value={selectedReply} onChange={event => setReplyTo(event.target.value)}>{roots.map(message => <option value={message.id} key={message.id}>{message.body.slice(0, 75)}</option>)}</select></label>}
      <label htmlFor={`message-${studentId}`}>{teacher ? mode === 'alert' ? 'Çalışma uyarısı' : 'Mesajın' : 'Cevabın'}</label><textarea id={`message-${studentId}`} value={body} onChange={event => setBody(event.target.value)} rows={3} maxLength={mode === 'alert' ? 240 : 2000} required placeholder={teacher ? 'Öğrencine bir not yaz…' : 'Öğretmenine cevap yaz…'} />
      <div className={styles.composeFooter}><small>{body.length}/{mode === 'alert' ? 240 : 2000}</small><button className={styles.primaryButton} disabled={busy || !body.trim() || body.length > (mode === 'alert' ? 240 : 2000)}><Send size={16} />{busy ? 'Gönderiliyor…' : teacher && mode === 'alert' ? 'Tam ekran uyarı gönder' : 'Gönder'}</button></div>
    </form>}
    {teacher && feedback.length > 0 && <div className={styles.feedback}><h4>Uyarı geri bildirimleri</h4>{feedback.slice(0, 12).map(item => <div key={item.id}><span className={styles.feedbackDot} /><p>{item.body}<time dateTime={item.created_at}>{formatDate(item.created_at)}</time></p></div>)}</div>}
  </section>;
}
