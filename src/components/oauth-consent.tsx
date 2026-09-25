"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, LockKeyhole, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import styles from "./oauth-consent.module.css";

type ConsentDetails = {
  authorizationId: string;
  csrf: string;
  ownerEmail: string;
  client: { name: string; uri: string };
  redirectUri: string;
  scopes: string[];
};

const scopeNames: Record<string, string> = {
  openid: "Kimlik doğrulaması",
  email: "E-posta adresi",
  profile: "Profil bilgileri",
  phone: "Telefon numarası",
};

export function OAuthConsent({ authorizationId }: { authorizationId: string }) {
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [status, setStatus] = useState<"loading" | "login" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch("/api/oauth/consent?authorization_id=" + encodeURIComponent(authorizationId), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!active) return;
        if (response.status === 401) { setStatus("login"); return; }
        if (!response.ok) throw new Error(result.error?.message ?? "Bağlantı isteği okunamadı.");
        if (typeof result.redirectUrl === "string") { window.location.replace(result.redirectUrl); return; }
        setDetails(result as ConsentDetails);
        setStatus("ready");
      })
      .catch(cause => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Bağlantı isteği okunamadı.");
        setStatus("error");
      });
    return () => { active = false; controller.abort(); };
  }, [authorizationId, reload]);
  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Giriş yapılamadı.");
      setStatus("loading");
      setReload(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Giriş yapılamadı.");
    } finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="consent-title">
      <div className={styles.brand}><span className={styles.brandMark}>y</span><span>YKSim.</span></div>
      <div className={styles.icon}><ShieldCheck size={24} strokeWidth={1.8} /></div>
      {status === "loading" && <><p className={styles.eyebrow}>BAĞLANTI İSTEĞİ</p><h1 id="consent-title">İzinler kontrol ediliyor</h1><p className={styles.description}>Güvenli bağlantı bilgileri yükleniyor…</p></>}
      {status === "error" && <><p className={styles.eyebrow}>BAĞLANTI İSTEĞİ</p><h1 id="consent-title">Bağlantı açılamadı</h1><p className={styles.description} role="alert">{error}</p><Link className={styles.secondary} href="/">YKSim&apos;e dön <ArrowRight size={16} /></Link></>}
      {status === "login" && <>
        <p className={styles.eyebrow}>GÜVENLİ BAĞLANTI</p><h1 id="consent-title">Önce hesabına giriş yap</h1>
        <p className={styles.description}>Bağlantı isteğini yalnızca YKSim sahibinin onaylamasına izin verilir.</p>
        <form className={styles.loginForm} onSubmit={signIn}>
          <label>E-posta<input name="email" type="email" autoComplete="username" required /></label>
          <label>Parola<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.primary} disabled={busy}>{busy ? "Giriş yapılıyor…" : "Giriş yap"}<ArrowRight size={16} /></button>
        </form>
      </>}
      {status === "ready" && details && <>
        <p className={styles.eyebrow}>BAĞLANTI İZNİ</p><h1 id="consent-title">{details.client.name || "Bir uygulama"} bağlanmak istiyor</h1>
        <p className={styles.description}>Bu isteği onaylarsan uygulama, YKSim&apos;in bağlantı araçlarını senin hesabın adına kullanabilir.</p>
        <div className={styles.client}><span className={styles.clientAvatar}>{(details.client.name || "U").slice(0, 1).toUpperCase()}</span><div><strong>{details.client.name || "Adsız uygulama"}</strong><span>{details.client.uri || details.redirectUri}</span></div></div>
        <div className={styles.section}><span className={styles.label}>İSTENEN KİMLİK BİLGİLERİ</span>
          <ul className={styles.scopes}>{details.scopes.map((scope, index) => <li key={`${scope}-${index}`}><Check size={14}/>{scopeNames[scope] || scope}</li>)}</ul>
          <p className={styles.note}>Bu OAuth kapsamları kimlik bilgilerini belirtir; YKSim verilerindeki yetkiler ayrıca sunucu tarafından denetlenir.</p>
        </div>
        <div className={styles.owner}><LockKeyhole size={16}/><span>Şu hesapla bağlanıyorsun: <strong>{details.ownerEmail}</strong></span></div>
        <form action="/api/oauth/decision" method="post" className={styles.actions}>
          <input type="hidden" name="authorization_id" value={details.authorizationId}/>
          <input type="hidden" name="csrf" value={details.csrf}/>
          <button className={styles.primary} name="decision" value="approve" type="submit">İzin ver <ArrowRight size={16}/></button>
          <button className={styles.secondary} name="decision" value="deny" type="submit"><X size={16}/> Reddet</button>
        </form>
        <p className={styles.footer}>Kararın ardından <strong>{details.redirectUri}</strong> adresine yönlendirileceksin.</p>
      </>}
    </section>
  </main>;
}
