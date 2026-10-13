'use client';
import {useEffect, useLayoutEffect, useRef} from 'react';
import {ArrowDown, ArrowUp, Check, Clock3} from 'lucide-react';
import {normalizeNovaReplyText} from '@/lib/nova/terminology';
import {jobStatusLabels, novaConnection, novaReplyProgress} from '@/lib/nova/chat-presentation';
import type {NovaMessage, NovaWebState} from '@/lib/nova/web-types';
import {NovaAvatar} from './avatar';
import {clock, type Command} from './view-utils';
import styles from './workspace.module.css';

type Props = {
  data: NovaWebState; messages: NovaMessage[]; online: boolean; busy: boolean;
  draft: string; setDraft: (text: string) => void; send: () => Promise<void>;
  command: Command; loadOlder: () => Promise<void>; historyEnd: boolean;
};
export function NovaChat({data, messages, online, busy, draft, setDraft, send, command, loadOlder, historyEnd}: Props) {
  const conversation = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followsLatest = useRef(true);
  const beforeHistory = useRef<{height: number; top: number} | null>(null);
  const connection = novaConnection(data, online);
  const progress = novaReplyProgress(data, connection.kind === 'ready');
  const lastMessageId = messages.at(-1)?.id;
  const firstMessageId = messages[0]?.id;
  useLayoutEffect(() => {
    const node = conversation.current;
    if (!node) return;
    if (messages.length === 0) {node.scrollTop = 0; return;}
    if (beforeHistory.current) {
      node.scrollTop = node.scrollHeight - beforeHistory.current.height + beforeHistory.current.top;
      beforeHistory.current = null;
    } else if (followsLatest.current) node.scrollTop = node.scrollHeight;
  }, [firstMessageId, lastMessageId, messages.length, progress?.kind]);
  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = 'auto';
      composer.current.style.height = `${Math.min(composer.current.scrollHeight, 160)}px`;
    }
  }, [draft]);
  const older = async () => {
    const node = conversation.current;
    if (node) beforeHistory.current = {height: node.scrollHeight, top: node.scrollTop};
    await loadOlder();
    // A failed or empty history read must not change the next incoming message's scroll position.
    requestAnimationFrame(() => {beforeHistory.current = null;});
  };
  const suggest = (text: string) => {setDraft(text); composer.current?.focus();};
  return <div className={styles.chat}>
    <div className={styles.chatContext}>
      <div><span className={styles.presenceDot}/><strong>{data.today?.currentEvent?.label ?? 'Günü hazırlanıyor'}</strong></div>
      <span>Nova’nın simüle günü</span>
    </div>
    <div ref={conversation} className={styles.messages} role="log" aria-label="Konuşma geçmişi" aria-live="polite" aria-relevant="additions text"
      onScroll={event => {const node = event.currentTarget; followsLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;}}>
      {messages.length > 0 && !historyEnd && messages[0].sequence > 1 && <button className={styles.historyButton} disabled={busy} onClick={() => void older()}>Önceki mesajları yükle</button>}
      {!messages.length && <div className={styles.welcome}>
        <NovaAvatar large/>
        <p className={styles.eyebrow}>KENDİ RİTMİNDE, BİRLİKTE</p>
        <h2>Bir merhaba ile başla.</h2>
        <p>Biraz sohbet, küçük bir plan ya da kısa bir mola.<br/>Bugün neye ihtiyacın var?</p>
        <div className={styles.suggestions}>
          {['Küçük bir başlangıç yapalım.', 'Bugün odaklanmakta zorlanıyorum.', 'Günüm nasıl gidiyor?'].map(text => <button key={text} onClick={() => suggest(text)}>{text}</button>)}
        </div>
      </div>}
      {messages.map(message => {
        const isUser = message.sender === 'user';
        const job = data.jobs.find(item => item.source_message_id === message.id);
        const deliveryLabel = job && ['GENERATING', 'CLAIMED'].includes(job.status) && connection.kind !== 'ready' ? 'Bağlantı bekleniyor' : job ? jobStatusLabels[job.status] ?? 'Kaydedildi' : '';
        const action = message.result?.proposedAction;
        return <article key={message.id} className={`${styles.messageRow} ${isUser ? styles.userRow : ''}`} id={`nova-message-${message.id}`} aria-label={isUser ? 'Senin mesajın' : 'Nova’nın mesajı'}>
          {!isUser && <NovaAvatar/>}
          <div className={styles.messageContent}>
            <div className={styles.message}><p>{isUser ? message.content : normalizeNovaReplyText(message.content)}</p></div>
            <div className={styles.messageMeta}><strong>{isUser ? 'Sen' : 'Nova'}</strong><time dateTime={message.created_at}>{clock(message.created_at, data.settings.timezone)}</time>
              {job && <span className={styles.delivery}>{job.status === 'COMPLETED' ? <Check size={13}/> : ['QUEUED', 'RETRY_WAIT'].includes(job.status) ? <Clock3 size={12}/> : null}{deliveryLabel}</span>}
            </div>
            {job?.status === 'FAILED' && <div className={styles.replyError}><span>Bu yanıt tamamlanamadı. Mesajın kaydedildi.</span><button disabled={busy} onClick={() => void command({operation: 'retry', jobId: job.id})}>Yanıtı yeniden dene</button></div>}
            {action && <div className={styles.duel}><span className={styles.eyebrow}>BİRLİKTE ODAKLANALIM</span><p>{action.durationMinutes ?? 25} dakikalık odak düellosu teklifi</p>
              {message.duel_decision ? <strong>{message.duel_decision === 'accepted' ? 'Kabul ettin' : 'Reddettin'}</strong> : <div className={styles.actions}><button className="button secondary" disabled={busy} onClick={() => void command({operation: 'duel', messageId: message.id, accept: true})}>Kabul et</button><button className="text-button" disabled={busy} onClick={() => void command({operation: 'duel', messageId: message.id, accept: false})}>Reddet</button></div>}
            </div>}
          </div>
        </article>;
      })}
      {progress && <div className={styles.replyProgress} role="status" data-kind={progress.kind}>
        {progress.kind === 'generating' ? <span className={styles.typing} aria-hidden="true"><i/><i/><i/></span> : <Clock3 size={15}/>}
        <span>{progress.label}</span>
      </div>}
    </div>
    <form className={styles.composer} onSubmit={event => {event.preventDefault(); followsLatest.current = true; void send();}}>
      <label className="sr-only" htmlFor="nova-message">Nova’ya mesajın</label>
      <div className={styles.composerInput}><textarea ref={composer} id="nova-message" maxLength={4000} rows={1} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Nova’ya bir şey yaz…"
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); if (!busy && online && draft.trim()) {followsLatest.current = true; void send();}}}}/>
        <button className={styles.sendButton} disabled={busy || !draft.trim() || !online} aria-label={busy ? 'Mesaj kaydediliyor' : 'Gönder'} title="Gönder"><ArrowUp size={22}/></button>
      </div>
      <div className={styles.composerNote}><span>{busy ? 'Mesajın kaydediliyor…' : !online ? 'Çevrimdışısın; yazdığın metin burada kalır.' : connection.kind === 'ready' ? 'Yapay zekâ ile sohbet · Nova’nın yaşamı simülasyondur.' : 'Mesajın kaydedilir, bilgisayar bağlanınca yanıtlanır.'}</span><span className={styles.keyboardHint}>Enter gönderir · Shift + Enter yeni satır</span></div>
      <button type="button" className={styles.latestButton} onClick={() => {followsLatest.current = true; conversation.current?.scrollTo({top: conversation.current.scrollHeight});}}><ArrowDown size={13}/>Son mesaja git</button>
    </form>
  </div>;
}
