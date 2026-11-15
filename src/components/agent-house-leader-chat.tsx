'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { leaderChatMessagesSchema, type LeaderChatMessage } from '@/lib/agent-house-chat';
import styles from './agent-house.module.css';

export function AgentHouseLeaderChat() {
  const [messages, setMessages] = useState<LeaderChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const request = useRef<AbortController | null>(null);
  const submission = useRef<{ id: string; content: string } | null>(null);

  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch('/api/agent-house/chat', { cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 403) setAvailable(false);
        throw new Error(body.error?.message ?? 'Liderin defteri şu anda açılamıyor.');
      }
      const parsed = leaderChatMessagesSchema.parse(body.messages);
      if (!controller.signal.aborted) { setMessages(parsed); setLoaded(true); setError(''); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Notlar yüklenemedi.');
    } finally { if (request.current === controller) request.current = null; }
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => { if (mounted) void load(); });
    // Read replies only while this room is open. This never publishes a report.
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mounted = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh);
      request.current?.abort(); request.current = null;
    };
  }, [load]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    if (submission.current?.content !== content) submission.current = { id: crypto.randomUUID(), content };
    setSending(true); setError('');
    try {
      const response = await fetch('/api/agent-house/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission.current),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Not gönderilemedi. Yeniden deneyebilirsin.');
      if (body.id !== submission.current.id) throw new Error('Notun kaydı doğrulanamadı. Yeniden deneyebilirsin.');
      const saved = submission.current;
      setMessages(previous => [...previous.filter(message => message.id !== saved.id), {
        ...saved, author: 'user', status: 'pending', reply_to: null, created_at: new Date().toISOString(),
      }]);
      setText(''); submission.current = null; setLoaded(true);
      request.current?.abort(); request.current = null;
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Not gönderilemedi.'); }
    finally { setSending(false); }
  };

  return <section className={styles.leaderChat} aria-labelledby="leader-chat-title">
    <h3 id="leader-chat-title">Liderle konuş</h3>
    <div className={styles.conversation} role="log" aria-label="Liderle konuşmanız" aria-live="polite">
      {messages.map(message => <div key={message.id} className={message.author === 'user' ? styles.userNote : styles.leaderNote}>
        <span className={styles.noteAuthor}>{message.author === 'user' ? 'Sen' : 'Lider'}</span>
        <p>{message.content}</p>
        {message.author === 'user' && message.status === 'expired' && <small>Bu not yanıtsız kaldı. İstersen yeniden sorabilirsin.</small>}
      </div>)}
    </div>
    {messages.some(message => message.author === 'user' && message.status === 'pending')
      ? <p className={styles.chatHint} role="status">Notun liderin masasında. Yanıtı hazır olduğunda burada kendiliğinden görünecek.</p>
      : <p className={styles.chatHint}>{loaded && !messages.length ? 'Aklındakini bırak; birlikte bir sonraki adımı bulalım.' : 'Yanıt hazır olduğunda burada buluşalım.'}</p>}
    <form onSubmit={event => void send(event)}>
      <label className={styles.chatLabel} htmlFor="leader-note">Lidere notun</label>
      <textarea id="leader-note" value={text} onChange={event => setText(event.target.value)} maxLength={4000}
        rows={3} disabled={sending || !available} placeholder="Bugün nereden başlamalıyım?"/>
      <button type="submit" disabled={!text.trim() || sending || !available}>{sending ? 'Bırakılıyor…' : 'Not bırak'}</button>
    </form>
    {error && <p className={styles.chatError} role="alert">{error}</p>}
  </section>;
}
