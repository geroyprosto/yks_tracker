'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, CalendarDays, FlaskConical, RefreshCw, Trophy} from 'lucide-react';
import Link from 'next/link';
import type {NovaWebState} from '@/lib/nova/web-types';
import {NovaAvatar} from './avatar';
import {NovaLab} from './lab';
import {NovaRace, NovaToday} from './overview';
import {readNova, type Command} from './view-utils';
import styles from './workspace.module.css';

type Tab = 'today' | 'race' | 'lab';
const tabs = [{id: 'today', label: 'Nova Bugün', icon: CalendarDays}, {id: 'race', label: 'Yarış', icon: Trophy}, {id: 'lab', label: 'Nova Lab', icon: FlaskConical}] as const;

export function NovaWorkspace({standalone = false}: {standalone?: boolean}) {
  const [tab, setTab] = useState<Tab>('today');
  const [data, setData] = useState<NovaWebState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const fetching = useRef<AbortController | null>(null);
  const mutationActive = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (fetching.current && !force) return;
    fetching.current?.abort();
    const controller = new AbortController();
    fetching.current = controller;
    try {
      const response = await fetch('/api/nova', {cache: 'no-store', signal: controller.signal});
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? 'Nova yüklenemedi.');
      if (controller.signal.aborted) return;
      setData(value as NovaWebState);
      setError('');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Nova’nın günü yüklenemedi.');
    } finally {
      if (fetching.current === controller) fetching.current = null;
    }
  }, []);

  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && navigator.onLine;
    const onVisible = () => {if (visible() && !mutationActive.current) void refresh();};
    const updateNetwork = () => {setOnline(navigator.onLine); if (navigator.onLine) onVisible();};
    const initial = setTimeout(() => {setOnline(navigator.onLine); if (visible()) void refresh();}, 0);
    const timer = setInterval(onVisible, 30000);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
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
      await refresh(true);
      return true;
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'İşlem kaydedilmedi.'); return false;}
    finally {mutationActive.current = false; setBusy(false);}
  };
  return <section className={`${styles.workspace} ${standalone ? styles.standalone : ''}`} aria-label="Nova çalışma arkadaşı">
    {standalone && <Link href="/" className={styles.backLink}><ArrowLeft size={15}/>Çalışma alanına dön</Link>}
    <header className={styles.heading}><div className={styles.identity}><NovaAvatar/><div>{standalone ? <h1 aria-label="Nova">Nova<span>Çalışma arkadaşın</span></h1> : <h2 aria-label="Nova">Nova<span>Çalışma arkadaşın</span></h2>}<p>Günlük ritim · Simüle yaşam ve yarış</p></div></div><button className={styles.refreshButton} disabled={busy || !online} onClick={() => void refresh(true)} aria-label="Nova durumunu yenile" title="Yenile"><RefreshCw size={18}/><span>Yenile</span></button></header>
    <nav className={styles.tabs} aria-label="Nova bölümleri">{tabs.map(({id, label, icon: Icon}) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={17}/>{label}</button>)}</nav>
    {!online && <p className={styles.offlineNote} role="status">İnternet bağlantısı yok. Nova’nın günü yeniden bağlandığında güncellenecek.</p>}
    {error && <div className={styles.errorBanner} role="alert"><span>{error}</span><button disabled={busy || !online} onClick={() => void refresh(true)}>Tekrar dene</button></div>}
    {!data && !error && online && <div className={styles.loading} role="status"><NovaAvatar large/><p>Nova’nın günü hazırlanıyor…</p></div>}
    {data && <>
      {data.demo && <p className={styles.demoNote}>Yerel test ortamı. Bu kayıtlar gerçek hesabından ayrıdır.</p>}
      {data.catchupRemaining && <p className={styles.demoNote}>Geçmiş günler sırayla tamamlanıyor. Her yenilemede en fazla yedi gün işlenir.</p>}
      {tab === 'today' && <NovaToday data={data} openRace={() => setTab('race')}/>}
      {tab === 'race' && <NovaRace data={data}/>}
      {tab === 'lab' && <NovaLab data={data} command={command} busy={busy || !online}/>}
    </>}
  </section>;
}
