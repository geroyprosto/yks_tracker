'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, CheckCircle2, KeyRound } from 'lucide-react';
import { errorMessage } from './api';
import styles from './classroom.module.css';

function RecoveryShell({ children }: { children: ReactNode }) {
  return <main className={`${styles.workspace} ${styles.accountPage}`} data-appearance="light" data-accent="sage"><div className={styles.accountCard}>
    <Link href="/" className={styles.brand}><span>y</span>YKSim<span className={styles.brandPeriod}>.</span></Link>
    <p className={styles.eyebrow}>HESABINA GÜVENLE DÖN</p>{children}
    <Link className={styles.backLink} href="/"><ArrowLeft size={14} />Girişe dön</Link>
  </div></main>;
}

export function ForgotPassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  return <RecoveryShell><h1>{notice ? 'E-postanı kontrol et.' : 'Şifreni mi unuttun?'}</h1>
    {notice ? <div className={styles.registrationDone} role="status"><CheckCircle2 size={36} /><p>{notice}</p><p>Bağlantıyı bu tarayıcıda aç. E-posta ulaşmazsa birkaç dakika bekleyip tekrar deneyebilirsin.</p><button className={styles.secondaryButton} onClick={() => setNotice('')}>Yeniden dene</button></div> : <>
      <p className={styles.intro}>Kayıt olduğun e-posta adresini yaz. Yeni şifreni e-postana gelen güvenli bağlantıyla kendin belirleyebilirsin.</p>
      <form className={styles.accountForm} onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError('');
        const email = new FormData(event.currentTarget).get('email');
        try {
          const response = await fetch('/api/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
          const body = await response.json();
          if (!response.ok) throw new Error(errorMessage(body, 'Bağlantı istenemedi. Yeniden dene.'));
          setNotice(body.message);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.'); }
        finally { setBusy(false); }
      }}>
        <label>E-posta adresin<input name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} /></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primaryButton} disabled={busy}>{busy ? 'İsteğin gönderiliyor…' : 'Şifre yenileme bağlantısı iste'}<ArrowUpRight size={17} /></button>
      </form>
    </>}
  </RecoveryShell>;
}

export function ResetPassword({ invalidLink = false }: { invalidLink?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired' | 'done'>(invalidLink ? 'expired' : 'loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(true);
  useEffect(() => {
    if (invalidLink) return;
    const controller = new AbortController();
    void fetch('/api/reset-password', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Yeni bir şifre yenileme bağlantısı iste.'));
      setStatus('ready');
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.'); setStatus('expired');
    });
    return () => controller.abort();
  }, [invalidLink]);

  return <RecoveryShell><h1>{status === 'done' ? 'Şifren yenilendi.' : 'Yeni şifreni belirle.'}</h1>
    {status === 'loading' && <p className={styles.intro} role="status">Şifre yenileme bağlantın kontrol ediliyor…</p>}
    {status === 'expired' && <div className={styles.registrationDone}><p role="alert">{error || 'Bu bağlantı geçersiz veya süresi dolmuş. Yeni bir şifre yenileme bağlantısı iste.'}</p><Link className={styles.primaryButton} href="/forgot-password">Yeni bağlantı iste<ArrowUpRight size={17} /></Link></div>}
    {status === 'done' && <div className={styles.registrationDone} role="status"><CheckCircle2 size={36} /><p>{signedOut ? 'Yeni şifrenle tekrar giriş yapabilirsin. Hesabının onay durumu değişmedi.' : 'Şifren kaydedildi. Oturumunu kapatıp yeni şifrenle tekrar giriş yap.'}</p>
      {signedOut ? <Link className={styles.primaryButton} href="/">Giriş yap<ArrowUpRight size={17} /></Link> : <button className={styles.primaryButton} disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { const response = await fetch('/api/logout', { method: 'POST' }); if (!response.ok) throw new Error('Çıkış tamamlanamadı. Yeniden dene.'); router.replace('/'); router.refresh(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Çıkış tamamlanamadı.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Çıkış yapılıyor…' : 'Çıkış yap ve girişe dön'}</button>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>}
    {status === 'ready' && <><p className={styles.intro}>En az 10 karakterli, daha önce kullanmadığın bir şifre seç. Şifren yöneticiler dahil kimseyle paylaşılmaz.</p><form className={styles.accountForm} onSubmit={async event => {
      event.preventDefault(); if (busy) return; setError('');
      const form = event.currentTarget; const data = new FormData(form); const password = data.get('password');
      if (password !== data.get('confirmation')) { setError('İki şifre aynı olmalı.'); return; }
      setBusy(true);
      try {
        const response = await fetch('/api/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
        const body = await response.json();
        if (!response.ok) { if (response.status === 401) setStatus('expired'); throw new Error(errorMessage(body, 'Şifre yenilenemedi.')); }
        form.reset(); setSignedOut(Boolean(body.signedOut)); setStatus('done');
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.'); }
      finally { setBusy(false); }
    }}>
      <label>Yeni şifren<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy} /></label>
      <label>Yeni şifreni tekrar yaz<input name="confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy} /></label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.primaryButton} disabled={busy}>{busy ? 'Şifren yenileniyor…' : 'Yeni şifremi kaydet'}<KeyRound size={17} /></button>
    </form></>}
  </RecoveryShell>;
}
