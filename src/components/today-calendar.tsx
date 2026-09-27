'use client';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, RefreshCw } from 'lucide-react';
import { Card } from './primitives';
import type { CalendarToday } from '@/lib/google-calendar';

const empty: CalendarToday = { connected: false, date: '', timezone: 'Europe/Istanbul', events: [], refreshedAt: null };
function clock(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function updated(value: string | null) {
  return value ? new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : null;
}
function eventColorStyle(color?: string | null): CSSProperties | undefined {
  return color && /^#[\da-f]{6}$/i.test(color)
    ? { '--calendar-event-source': color } as CSSProperties
    : undefined;
}
export function TodayCalendar({ authenticated, onOpenSettings }: { authenticated: boolean; onOpenSettings: () => void }) {
  const [data, setData] = useState<CalendarToday>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const lastFetch = useRef(0);
  const pending = useRef(false);
  const alive = useRef(true);
  const load = useCallback(async (force = false) => {
    if (pending.current || (!force && Date.now() - lastFetch.current < 5 * 60_000)) return;
    if (!navigator.onLine) { setOffline(true); setLoading(false); return; }
    pending.current = true; setOffline(false); setLoading(true);
    try {
      const response = await fetch('/api/calendar/today', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Takvim yüklenemedi.');
      if (alive.current) { setData(body as CalendarToday); setError(''); lastFetch.current = Date.now(); }
    } catch (issue) {
      if (alive.current) setError(issue instanceof Error ? issue.message : 'Takvim yüklenemedi.');
    } finally { pending.current = false; if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => void load(true));
    const foreground = () => { if (document.visibilityState === 'visible') void load(); };
    const online = () => void load(true);
    window.addEventListener('focus', foreground);
    window.addEventListener('online', online);
    const wentOffline = () => { setOffline(true); setLoading(false); };
    window.addEventListener('offline', wentOffline);
    document.addEventListener('visibilitychange', foreground);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => { alive.current = false; window.removeEventListener('focus', foreground); window.removeEventListener('online', online);
      window.removeEventListener('offline', wentOffline); document.removeEventListener('visibilitychange', foreground); clearInterval(interval); };
  }, [load]);
  const hasEvents = data.events.length > 0;
  return <Card className="program-card calendar-program-card" title="Bugünün programı" action={<button
    className="calendar-refresh icon-button" type="button" onClick={() => void load(true)} disabled={loading || !authenticated}
    title="Takvimi yenile" aria-label="Takvimi yenile"><RefreshCw size={18}/></button>}>
    {offline && <p className="calendar-message" role="status">{data.refreshedAt ? 'Çevrimdışısın. Son görülen program gösteriliyor; yenilemek için internete bağlan.' : 'Çevrimdışısın. Takvimi görmek için internete bağlan.'}</p>}
    {error && <p className="calendar-message calendar-error" role="alert">{error}</p>}
    {!data.connected && !loading && !error && <div className="connection-empty"><span className="calendar-logo"><CalendarDays size={20}/></span><div>
      <h3>Takvimini burada gör</h3><p>{authenticated ? 'Google Takvim’i bağla, görüntülenecek takvimleri seç.' : 'Takvim için önce kişisel hesabınla giriş yapmalısın.'}</p>
    </div></div>}
    {loading && !hasEvents && <p className="calendar-message" role="status">Takvim yükleniyor…</p>}
    {data.connected && !hasEvents && !loading && !error && <div className="calendar-empty"><CalendarDays size={23}/><div><strong>Bugün planlı etkinlik yok</strong><span>Seçtiğin takvimlerde bugüne denk gelen bir etkinlik bulunamadı.</span></div></div>}
    {hasEvents && <ol className="calendar-event-list">{data.events.map(event => <li key={`${event.calendarId}:${event.id}`} className="calendar-event" style={eventColorStyle(event.color)}>
      <span className="calendar-event-time">{event.allDay ? 'Tüm gün' : `${clock(event.start, data.timezone)}–${clock(event.end, data.timezone)}`}</span>
      <div className="calendar-event-detail"><strong>{event.htmlLink ? <a href={event.htmlLink} target="_blank" rel="noopener noreferrer">{event.title}<ArrowUpRight size={13}/></a> : event.title}</strong>
        {(event.continuesFromPreviousDay || event.continuesIntoNextDay) && <small>
          {event.continuesFromPreviousDay && 'Önceki günden'}
          {event.continuesFromPreviousDay && event.continuesIntoNextDay && ' · '}
          {event.continuesIntoNextDay && 'Yarın da sürüyor'}
        </small>}</div>
    </li>)}</ol>}
    <div className="card-bottom"><span>{data.connected ? updated(data.refreshedAt) ? `Son yenileme ${updated(data.refreshedAt)}` : 'Bağlı' : 'Yalnız okuma erişimi'}</span>
      <button className="text-button" type="button" onClick={onOpenSettings}>Bağlantı ayarları<ArrowUpRight size={16}/></button></div>
  </Card>;
}


