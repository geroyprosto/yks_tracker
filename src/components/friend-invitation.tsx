'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Check, HeartHandshake, UsersRound } from 'lucide-react';
import styles from './friend-invitation.module.css';

type Preview = { display_name: string; expires_at: string };
type Account = { name: string; role: 'student' | 'teacher' | 'admin'; status: string };

function message(body: { error?: { message?: string } }, fallback: string) {
  return body.error?.message ?? fallback;
}

export function FriendInvitation() {
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') ?? '';
    queueMicrotask(() => setToken(value));
    if (!/^[a-f0-9]{64}$/.test(value)) {
      queueMicrotask(() => { setError('Davet bağlantısı geçersiz.'); setLoading(false); });
      return;
    }
    void Promise.all([
      fetch(`/api/friends/invite?token=${encodeURIComponent(value)}`, { cache: 'no-store' }),
      fetch('/api/classroom/session', { cache: 'no-store' }),
    ]).then(async ([inviteResponse, sessionResponse]) => {
      const invite = await inviteResponse.json();
      if (!inviteResponse.ok) throw new Error(message(invite, 'Davet bağlantısı kullanılmış veya süresi dolmuş.'));
      const session = await sessionResponse.json();
      setPreview(invite as Preview);
      setAccount((session.account ?? null) as Account | null);
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Davet yüklenemedi.'))
      .finally(() => setLoading(false));
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fields)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(message(body, 'Giriş yapılamadı.'));
      const sessionResponse = await fetch('/api/classroom/session', { cache: 'no-store' });
      const session = await sessionResponse.json();
      setAccount((session.account ?? null) as Account | null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Giriş yapılamadı.');
    } finally { setBusy(false); }
  }

  async function accept() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/friends/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(message(body, 'Davet kabul edilemedi.'));
      setJoined(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Davet kabul edilemedi.');
    } finally { setBusy(false); }
  }

  return <main className="login-page"><div className={`login-card ${styles.card}`}>
    <Link href="/" className="brand"><span className="brand-mark">y</span>YKSim.</Link>
    <span className={styles.icon}><UsersRound size={24} /></span>
    <p className="eyebrow">ARKADAŞ DAVETİ</p>
    <h1>{joined ? 'Artık birlikte çalışıyorsunuz!' : preview ? `${preview.display_name} seni davet etti.` : 'Birlikte daha keyifli.'}</h1>
    <p>Günlük ve haftalık çalışma özetlerinizi yan yana görebilir, birbirinize tatlı bir motivasyon verebilirsiniz.</p>
    {loading && <p role="status">Davet kontrol ediliyor…</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {joined && <Link className="button primary wide" href="/?page=friends"><Check size={17} />Arkadaşlar alanına git</Link>}
    {!joined && preview && !loading && <>
      <p className={styles.privacy}>Yalnızca çalışma süresi, soru ve test sayısı ile tamamlanan görev sayısı paylaşılır. Arkadaşlığı istediğiniz zaman kaldırabilirsiniz.</p>
      {account?.role === 'student' && account.status === 'approved' && <button className="button primary wide" disabled={busy} onClick={() => void accept()}><HeartHandshake size={18} />{busy ? 'Katılım kaydediliyor…' : 'Daveti kabul et'}</button>}
      {account?.role === 'student' && account.status !== 'approved' && <div className={styles.notice}><p>Öğrenci hesabının onaylanması gerekiyor. Onaylandıktan sonra bu bağlantıyı yeniden açabilirsin.</p><Link href="/classroom">Başvuru durumuma git</Link></div>}
      {account && account.role !== 'student' && <div className={styles.notice}><p>Arkadaş yarışmasına katılmak için onaylı öğrenci hesabı gerekiyor.</p><Link href="/classroom">Hesabıma git</Link></div>}
      {!account && <><form onSubmit={event => void signIn(event)}><label>E-posta<input required type="email" name="email" autoComplete="username" /></label><label>Şifre<input required type="password" name="password" autoComplete="current-password" /></label><button className="button primary wide" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap ve devam et'}</button></form><p className="footnote">Hesabın yok mu? <Link href={`/register?friend_invite=${encodeURIComponent(token)}`}>Öğrenci hesabı oluştur</Link></p></>}
    </>}
    <p className="footnote"><Link href="/">Ana sayfaya dön</Link></p>
  </div></main>;
}
