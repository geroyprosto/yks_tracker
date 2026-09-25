'use client';
import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Link2Off, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card } from './primitives';
import type { CalendarStatus } from '@/lib/google-calendar';

const blank: CalendarStatus = { configured: false, connected: false, calendars: [], selectedCalendarIds: [], lastSuccessAt: null };
export function GoogleCalendarSettings({ authenticated }: { authenticated: boolean }) {
  const [status, setStatus] = useState<CalendarStatus>(blank);
  const [selection, setSelection] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!navigator.onLine) { setError('Çevrimdışıyken Google Takvim yenilenemez.'); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/calendar/status', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Takvim bağlantısı okunamadı.');
      setStatus(body as CalendarStatus); setSelection((body as CalendarStatus).selectedCalendarIds); setError('');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Takvim bağlantısı okunamadı.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
    const query = new URLSearchParams(window.location.search);
    const result = query.get('calendar');
    const callbackNotice = result === 'connected' ? 'Google Takvim bağlandı. Görüntülenecek takvimleri seçebilirsin.'
      : result === 'denied' ? 'Google Takvim izni verilmedi; bağlantı kurulmadı.'
      : result === 'error' ? 'Google Takvim bağlantısı tamamlanamadı. Tekrar deneyin.' : '';
    if (callbackNotice) queueMicrotask(() => setNotice(callbackNotice));
    if (result) { query.delete('calendar'); query.delete('settings'); window.history.replaceState({}, '', window.location.pathname + (query.size ? '?' + query.toString() : '')); }
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); };
  }, [load]);
  async function submit(path: string, body?: unknown) {
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await fetch(path, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'İşlem tamamlanamadı.');
      await load();
      if (path.endsWith('disconnect')) setNotice(result.revoked
        ? 'Google Takvim bağlantısı kesildi ve izin iptal edildi.'
        : 'Yerel bağlantı silindi. Google izni çevrimdışı olduğu için iptal edilemedi; Google Hesabı izinlerinden de kaldır.');
      else setNotice('Takvim seçimi kaydedildi.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'İşlem tamamlanamadı.'); }
    finally { setBusy(false); }
  }
  const selected = new Set(selection);
  const changed = JSON.stringify([...selection].sort()) !== JSON.stringify([...status.selectedCalendarIds].sort());
  return <Card className="ambient-card google-calendar-settings" title="Google Takvim" action={<CalendarDays size={20}/> }>
    <p className="soft-copy">Bugünün programını yalnızca oku. Takvimde değişiklik yapılmaz; etkinlik süresi çalışma kaydına eklenmez.</p>
    {loading && <p className="calendar-message" role="status">Bağlantı durumu yükleniyor…</p>}
    {error && <div className="calendar-message calendar-error" role="alert">{error} <button className="text-button" type="button" onClick={() => void load()}>Tekrar dene</button></div>}
    {notice && <p className="calendar-message" role="status">{notice}</p>}
    {!status.configured && !loading && !error && <p className="calendar-message">Google OAuth kurulumu henüz tamamlanmadı. Kurulum adımları için README’ye bak.</p>}
    {status.configured && !status.connected && !loading && !error && <form method="post" action="/api/calendar/connect">
      <button className="button primary" disabled={!authenticated || busy} type="submit"><ShieldCheck size={16}/>Google Takvim’i bağla</button>
    </form>}
    {status.connected && <>
      <div className="calendar-connection-state"><ShieldCheck size={17}/><strong>Bağlı · Yalnız okuma</strong>
        <button className="icon-button" type="button" title="Takvimleri yenile" aria-label="Takvimleri yenile" disabled={loading || busy}
          onClick={() => void load()}><RefreshCw size={16}/></button></div>
      <p className="calendar-selection-label">Görüntülenecek takvimler</p>
      <div className="calendar-choice-list">{status.calendars.length ? status.calendars.map(calendar => <label key={calendar.id} className="calendar-choice">
        <input type="checkbox" checked={selected.has(calendar.id) || (calendar.primary && selected.has('primary'))}
          disabled={busy} onChange={event => setSelection(previous => event.target.checked
            ? [...new Set([...previous.filter(id => id !== 'primary'), calendar.id])]
            : previous.filter(id => id !== calendar.id && !(calendar.primary && id === 'primary')))} />
        <span className="calendar-choice-color" style={{ background: calendar.color ?? 'var(--primary)' }}/>
        <span>{calendar.name}{calendar.primary ? ' · Birincil' : ''}</span>
      </label>) : <p className="calendar-message">Görüntülenebilir takvim bulunamadı.</p>}</div>
      <div className="calendar-connection-actions"><button className="button primary" type="button" disabled={!changed || busy || loading}
        onClick={() => void submit('/api/calendar/select', { calendarIds: selection })}>Seçimi kaydet</button>
        <button className="button secondary" type="button" disabled={busy || loading}
          onClick={() => void submit('/api/calendar/disconnect')}><Link2Off size={16}/>Bağlantıyı kes</button></div>
      <p className="footnote">Son bağlantı: {status.lastSuccessAt
        ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(status.lastSuccessAt))
        : 'Henüz yenilenmedi'}. Google izni uygulama girişinden ayrıdır.</p>
    </>}
  </Card>;
}





