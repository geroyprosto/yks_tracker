'use client';

import { useState } from 'react';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

export function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return <main className="login-page"><div className="login-card"><div className="brand"><span className="brand-mark">y</span>YKSim.</div><p className="eyebrow">SANA AİT BİR ALAN</p><h1>Yolculuğuna devam et.</h1><p>Hesabınla giriş yap. Öğretmenin yoksa bireysel öğrenci hesabı açabilirsin.</p><form onSubmit={async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(fields))});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Giriş yapılamadı.');
      // A fresh request lets the server verify the new session and account role.
      window.location.assign(body.redirect ?? '/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.');
      setBusy(false);
    }
  }}><label>E-posta<input required type="email" name="email" autoComplete="username"/></label><label>Parola<input required type="password" name="password" autoComplete="current-password"/></label>{error&&<p role="alert" className="error-text">{error}</p>}<button className="button primary wide" disabled={busy}>{busy?'Giriş yapılıyor…':'Giriş yap'}<ArrowUpRight size={18}/></button></form><p className="footnote"><a href="/forgot-password">Şifremi unuttum</a></p><p className="footnote"><a href="/register">Bireysel öğrenci hesabı aç</a> · <a href="/register?role=teacher">Öğretmen başvurusu</a></p><p className="footnote"><a href="/about">Uygulama hakkında</a> · <a href="/privacy">Gizlilik</a> · <a href="/terms">Koşullar</a></p><p className="footnote"><ShieldCheck size={15}/>Hesap başvurun onaylandığında çalışmaya başlayabilirsin.</p></div></main>;
}
