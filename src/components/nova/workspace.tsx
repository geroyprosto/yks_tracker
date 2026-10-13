'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, CalendarDays, FlaskConical, MessageCircle, RefreshCw, Trophy} from 'lucide-react';
import Link from 'next/link';
import {hasPendingNovaReply, novaConnection} from '@/lib/nova/chat-presentation';
import type {NovaChatState, NovaMessage, NovaWebState} from '@/lib/nova/web-types';
import {NovaAvatar} from './avatar';
import {NovaChat} from './chat';
import {NovaLab} from './lab';
import {NovaRace, NovaToday} from './overview';
import {readNova, type Command} from './view-utils';
import styles from './workspace.module.css';

type Tab = 'today' | 'chat' | 'race' | 'lab';
const tabs = [{id: 'chat', label: 'Sohbet', icon: MessageCircle}, {id: 'today', label: 'Nova Bugün', icon: CalendarDays}, {id: 'race', label: 'Yarış', icon: Trophy}, {id: 'lab', label: 'Nova Lab', icon: FlaskConical}] as const;

export function NovaWorkspace({standalone = false}: {standalone?: boolean}) {
  const [tab, setTab] = useState<Tab>('chat');
  const [data, setData] = useState<NovaWebState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [draft, setDraft] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [older, setOlder] = useState<NovaMessage[]>([]);
  const [historyEnd, setHistoryEnd] = useState(false);
  const pending = useRef<{id: string; content: string} | null>(null);
  const currentData = useRef<NovaWebState | null>(null);
  const fetching = useRef<AbortController | null>(null);
  const mutationActive = useRef(false);
  const lastFullAttempt = useRef(0);

  const refresh = useCallback(async (mode: 'full' | 'chat' = 'full', force = false) => {
    if (fetching.current && !force) return;
    fetching.current?.abort();
    const controller = new AbortController();
    fetching.current = controller;
    const light = mode === 'chat' && currentData.current !== null;
    // Failures still consume the full-read interval; pending replies can continue using the light endpoint.
    if (!light) lastFullAttempt.current = Date.now();
    try {
      const response = await fetch(light ? '/api/nova/chat' : '/api/nova', {cache: 'no-store', signal: controller.signal});
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? 'Nova yüklenemedi.');
      if (controller.signal.aborted) return;
      const chat = value as NovaChatState;
      const next = light && currentData.current ? {...currentData.current, serverNow: chat.serverNow, messages: chat.messages, jobs: chat.jobs, devices: chat.devices} : value as NovaWebState;
      currentData.current = next;
      setData(next);
      setError('');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Bağlantı kurulamadı.');
    } finally {
      if (fetching.current === controller) fetching.current = null;
    }
  }, []);

  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && navigator.onLine;
    const onVisible = () => {if (visible() && !mutationActive.current) void refresh();};
    const updateNetwork = () => {setOnline(navigator.onLine); if (navigator.onLine) onVisible();};
    const initial = setTimeout(() => {setOnline(navigator.onLine); if (visible()) void refresh();}, 0);
    // Two-second light reads only while a reply is pending. The daily engine stays on its thirty-second cadence.
    const timer = setInterval(() => {
      if (!visible() || mutationActive.current) return;
      if (Date.now() - lastFullAttempt.current >= 30000) void refresh();
      else if (hasPendingNovaReply(currentData.current)) void refresh('chat');
    }, 2000);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const code = new URLSearchParams(window.location.search).get('pair');
    if (code) queueMicrotask(() => {setPairCode(code); setTab('lab');});
    return () => {
      clearTimeout(initial); clearInterval(timer); fetching.current?.abort();
      window.removeEventListener('online', updateNetwork); window.removeEventListener('offline', updateNetwork);
      window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const command: Command = async value => {
    if (mutationActive.current) return false;
    if (!navigator.onLine) {setError('İnternet bağlantısı yok. İşlem sunucuya kaydedilmedi; tekrar bağlanınca yeniden dene.'); return false;}
    mutationActive.current = true; fetching.current?.abort();
    setBusy(true); setError('');
    try {
      await readNova(value);
      await refresh(value.operation === 'message' || value.operation === 'retry' ? 'chat' : 'full', true);
      return true;
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'İşlem kaydedilmedi.'); return false;}
    finally {mutationActive.current = false; setBusy(false);}
  };
  const send = async () => {
    const content = draft.trim(); if (!content) return;
    if (!pending.current || pending.current.content !== content) pending.current = {id: crypto.randomUUID(), content};
    if (await command({operation: 'message', requestId: pending.current.id, content})) {setDraft(value => value.trim() === content ? '' : value); pending.current = null;}
  };
  const messages = [...new Map([...older, ...(data?.messages ?? [])].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence);
  const loadOlder = async () => {
    setBusy(true);
    try {const batch = await readNova({operation: 'history', beforeSequence: messages[0]?.sequence}) as NovaMessage[]; setOlder(previous => [...batch, ...previous]); setHistoryEnd(batch.length < 50);}
    catch (cause) {setError(cause instanceof Error ? cause.message : 'Geçmiş okunamadı.');}
    finally {setBusy(false);}
  };
  const connection = data ? novaConnection(data, online) : null;
  return <section className={`${styles.workspace} ${standalone ? styles.standalone : ''}`} aria-label="Nova çalışma arkadaşı">
    {standalone && <Link href="/" className={styles.backLink}><ArrowLeft size={15}/>Çalışma alanına dön</Link>}
    <header className={styles.heading}><div className={styles.identity}><NovaAvatar/><div>{standalone ? <h1 aria-label="Nova">Nova<span>Çalışma arkadaşın</span></h1> : <h2 aria-label="Nova">Nova<span>Çalışma arkadaşın</span></h2>}<p>Yapay zekâ ile sohbet · Simüle yaşam ve yarış</p></div></div><button className={styles.refreshButton} disabled={busy} onClick={() => void refresh('full', true)} aria-label="Nova durumunu yenile" title="Yenile"><RefreshCw size={18}/><span>Yenile</span></button></header>
    <nav className={styles.tabs} aria-label="Nova bölümleri">{tabs.map(({id, label, icon: Icon}) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={17}/>{label}</button>)}</nav>
    {error && <div className={styles.errorBanner} role="alert"><span>{error}</span><button onClick={() => void refresh('full', true)}>Tekrar dene</button></div>}
    {!data && !error && <div className={styles.loading} role="status"><NovaAvatar large/><p>Nova’ya bağlanılıyor…</p></div>}
    {data && <>
      {data.demo && <p className={styles.demoNote}>Yerel test ortamı. Bu kayıtlar gerçek hesabından ayrıdır.</p>}
      {connection && <div className={styles.connection} data-kind={connection.kind} role="status"><span className={styles.connectionDot}/><div><strong>{connection.label}</strong><span>{connection.detail}</span></div>{['unpaired', 'model-missing'].includes(connection.kind) && tab !== 'lab' && <button onClick={() => setTab('lab')}>Nova Lab’i aç <ArrowLeft size={14}/></button>}</div>}
      {data.catchupRemaining && <p className={styles.demoNote}>Geçmiş günler sırayla tamamlanıyor. Her yenilemede en fazla yedi gün işlenir.</p>}
      {tab === 'chat' && <NovaChat data={data} messages={messages} online={online} busy={busy} draft={draft} setDraft={setDraft} send={send} command={command} loadOlder={loadOlder} historyEnd={historyEnd}/>}
      {tab === 'today' && <NovaToday data={data} openChat={() => setTab('chat')}/>}
      {tab === 'race' && <NovaRace data={data}/>}
      {tab === 'lab' && <NovaLab data={data} command={command} busy={busy} pairCode={pairCode} setPairCode={setPairCode}/>}
    </>}
  </section>;
}
