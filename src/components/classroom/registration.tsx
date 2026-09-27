'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, CheckCircle2, GraduationCap, ShieldCheck, Users } from 'lucide-react';
import { registrationSchema } from '@/lib/classroom/registration';
import { errorMessage, roleLabel, type Account } from './api';
import styles from './classroom.module.css';

function AccountShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={`${styles.workspace} ${styles.accountPage}`} data-appearance="light" data-accent="sage"><div className={wide ? styles.wideAccountCard : styles.accountCard}><Link href="/" className={styles.brand}><span>y</span>YKSim<span className={styles.brandPeriod}>.</span></Link>{children}</div></main>;
}

export function Registration() {
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [token, setToken] = useState('');
  const [invitedTeacher, setInvitedTeacher] = useState('');
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'approved' | 'pending' | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('token') ?? '';
    queueMicrotask(() => { setToken(inviteToken); if (params.get('role') === 'teacher' && !inviteToken) setRole('teacher'); if (params.get('error') === 'verification') setError('E-posta doğrulama bağlantısı geçersiz veya süresi dolmuş. En son gelen bağlantıyı dene; doğrulamayı tamamladıysan giriş yap.'); });
    if (inviteToken) void fetch(`/api/classroom/invite?token=${encodeURIComponent(inviteToken)}`, { cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Bu davet bağlantısı geçersiz, iptal edilmiş veya süresi dolmuş.'));
      setInvitedTeacher(body.teacher_name ?? 'Öğretmen');
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Davet bilgisi alınamadı.'));
    void fetch('/api/classroom/session', { cache: 'no-store' }).then(response => response.json()).then(body => setDemoEnabled(Boolean(body.demoEnabled))).catch(() => {});
  }, []);
  const soloStudent = role === 'student' && !token;
  return <AccountShell><p className={styles.eyebrow}>HER GÜN BİR ADIM</p><h1>{done === 'approved' ? 'Hesabın hazır.' : done === 'pending' ? 'Başvurun alındı.' : token ? 'Sınıf davetiyle katıl.' : soloStudent ? 'Bireysel öğrenci başvurusu.' : 'Öğretmen başvurusu.'}</h1><p className={styles.intro}>{done === 'approved' ? 'Çalışma alanını hemen kullanabilirsin.' : done === 'pending' ? token ? 'Öğretmenin başvurunu uygulama içinden inceleyecek. Yönetici de gerektiğinde karar verebilir.' : 'Yönetici başvurunu uygulama içinden inceleyecek.' : token ? `${invitedTeacher || 'Davet eden öğretmen'} sınıfına katılmak için hesabını oluştur. Başvurunu öğretmenin uygulama içinden onaylar.` : soloStudent ? 'Öğretmen bağlantısı gerekmiyor. Başvurun yönetici ekranına düşecek; onaydan sonra çalışmaya başlayabilirsin.' : 'Öğretmen hesabını oluştur. Başvurun e-posta beklemeden yönetici ekranına düşer.'}</p>
    {done ? <div className={styles.registrationDone}><CheckCircle2 size={36} /><p>{notice || (done === 'approved' ? 'Hesabın hazır.' : token ? 'Öğretmen onayını bekle.' : 'Yönetici onayını bekle.')}</p><Link className={styles.primaryButton} href={done === 'approved' ? '/' : '/classroom'}>{done === 'approved' ? 'Çalışma alanına git' : 'Başvuru durumum'}<ArrowUpRight size={16} /></Link>{demo && done !== 'approved' && <Link href="/demo" className={styles.secondaryButton}>Demo yöneticisine geç</Link>}</div> : <form className={styles.accountForm} onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
      try {
        const input = registrationSchema.safeParse({ first_name: form.get('first_name'), last_name: form.get('last_name'), email: form.get('email'), password: form.get('password'), password_confirmation: form.get('password_confirmation'), role, ...(token ? { invite_token: token } : {}), ...(demo ? { demo: true } : {}) });
        if (!input.success) throw new Error(input.error.issues[0]?.message ?? 'Başvuru bilgilerini kontrol et.');
        const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.data) }); const body = await response.json(); if (!response.ok) throw new Error(errorMessage(body, 'Hesap oluşturulamadı.')); setNotice(body.message ?? ''); setDone(body.status === 'approved' ? 'approved' : 'pending');
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.'); } finally { setBusy(false); }
    }}>
      {!token && <fieldset className={styles.roleChoices}><legend>Hesap türü</legend><button type="button" aria-pressed={role === 'student'} onClick={() => setRole('student')}><Users size={19} />Bireysel öğrenci hesabı</button><button type="button" aria-pressed={role === 'teacher'} onClick={() => setRole('teacher')}><GraduationCap size={20} />Öğretmen başvurusu</button></fieldset>}
      {token && <p className={styles.inlineInfo}><ShieldCheck size={17} />{invitedTeacher ? `${invitedTeacher} öğretmeninin sınıfına başvuruyorsun. Katılımını öğretmenin onaylayacak; yönetici de başvurunu görebilir.` : 'Davet bilgisi kontrol ediliyor…'}</p>}
      <label>Adın<input name="first_name" autoComplete="given-name" maxLength={50} required /></label><label>Soyadın<input name="last_name" autoComplete="family-name" maxLength={50} required /></label><label>E-posta adresin<input name="email" type="email" autoComplete="email" maxLength={254} required /></label><label>Şifren<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /><small>En az 10 karakter. Uygulama için yeni bir şifre belirle; Gmail şifreni kullanma. Şifren yöneticiyle paylaşılmaz.</small></label><label>Şifreni tekrar gir<input name="password_confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      <p className={styles.mutedSmall}>E-posta doğrulama iletisi gönderilmez. Girişte kullanacağın adresi doğru yaz; bu adrese sahip olduğun otomatik olarak doğrulanmaz.</p>
      {demoEnabled && <label className={styles.demoCheckbox}><input type="checkbox" checked={demo} onChange={event => setDemo(event.target.checked)} /><span>Başvuruyu demo olarak dene<small>Yerel simülasyon; gerçek e-posta gönderilmez, şifre saklanmaz.</small></span></label>}
      {error && <p className={styles.error} role="alert">{error}</p>}<button className={styles.primaryButton} disabled={busy || Boolean(token && !invitedTeacher)}>{busy ? 'Hesabın oluşturuluyor…' : soloStudent ? 'Bireysel hesabımı oluştur' : 'Başvurumu oluştur'}<ArrowUpRight size={17} /></button>
    </form>}
    <p className={styles.accountFooter}>Zaten hesabın var mı? <Link href="/">Giriş yap</Link></p><Link className={styles.backLink} href="/"><ArrowLeft size={14} />Ana sayfaya dön</Link>
  </AccountShell>;
}

export function Invitation() {
  const [token, setToken] = useState('');
  const [teacher, setTeacher] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') ?? '';
    queueMicrotask(() => setToken(value));
    void Promise.all([fetch(`/api/classroom/invite?token=${encodeURIComponent(value)}`, { cache: 'no-store' }), fetch('/api/classroom/session', { cache: 'no-store' })]).then(async ([invitation, session]) => { const body = await invitation.json(); if (!invitation.ok) throw new Error(errorMessage(body, 'Bu davet bağlantısı geçersiz, iptal edilmiş veya süresi dolmuş.')); setTeacher(body.teacher_name ?? body.teacher?.name ?? 'Öğretmen'); const sessionBody = await session.json(); setAccount(sessionBody.account ?? null); setLoaded(true); }).catch(reason => { setError(reason instanceof Error ? reason.message : 'Davet bilgisi alınamadı.'); setLoaded(true); });
  }, []);
  async function apply(name: string) {
    const response = await fetch('/api/classroom/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, role: 'student', invite_token: token }) });
    const body = await response.json(); if (!response.ok) throw new Error(errorMessage(body, 'Sınıf başvurusu oluşturulamadı.')); setDone(true);
  }
  return <AccountShell><span className={styles.invitationMark}><GraduationCap size={30} /></span><p className={styles.eyebrow}>SINIF DAVETİ</p><h1>{done ? 'Sınıf başvurun alındı.' : teacher ? `${teacher} seni bekliyor.` : 'Davetin kontrol ediliyor.'}</h1>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {done ? <><p className={styles.intro}>Katılımın öğretmeninin onayını bekliyor. Yönetici de başvurunu görebilir ve karar verebilir. Mevcut bir sınıf ilişkin varsa yeni isteğin onaylanana kadar korunur.</p><Link href="/classroom" className={styles.primaryButton}>Başvuru durumum</Link></> : loaded && teacher && <><p className={styles.intro}>{teacher} öğretmeninin sınıfına katılacaksın. Sınıfa katılımı onaylıyor musun?</p><p className={styles.mutedSmall}>Bu davet tek başına erişim sağlamaz. Sınıf üyeliğini öğretmenin veya uygulama yöneticisi onaylar.</p>
      {!accepted ? <div className={styles.invitationActions}><button className={styles.primaryButton} onClick={() => setAccepted(true)}>Evet, katılmak istiyorum<CheckCircle2 size={17} /></button><Link className={styles.secondaryButton} href="/">Hayır, katılmak istemiyorum</Link></div> : account ? <div className={styles.invitationActions}><p className={styles.inlineInfo}>{account.name} hesabıyla başvuruyorsun. {teacher} öğretmeninin sınıfına katılımın öğretmen onayı bekleyecek.</p><button disabled={busy} className={styles.primaryButton} onClick={async () => { setBusy(true); setError(''); try { await apply(account.name); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Başvuru başarısız.'); } finally { setBusy(false); } }}>Katılım başvurusu gönder</button></div> : <><Link className={styles.primaryButton} href={`/register?token=${encodeURIComponent(token)}`}>Yeni öğrenci hesabı oluştur<ArrowUpRight size={16} /></Link><details className={styles.existingAccount}><summary>Hesabım var, giriş yaparak katıl</summary><form className={styles.accountForm} onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); try { const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) }); const body = await response.json(); if (!response.ok) throw new Error(errorMessage(body, 'Giriş yapılamadı.')); const session = await fetch('/api/classroom/session', { cache: 'no-store' }); const current = await session.json(); await apply(current.account?.name ?? 'Öğrenci'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.'); } finally { setBusy(false); } }}><label>E-posta<input name="email" type="email" autoComplete="username" required /></label><label>Şifre<input name="password" type="password" autoComplete="current-password" required /></label><button className={styles.primaryButton} disabled={busy}>{busy ? 'Başvurun gönderiliyor…' : 'Giriş yap ve katılım iste'}</button></form></details></>}
    </>}
    <Link className={styles.backLink} href="/"><ArrowLeft size={14} />Ana sayfaya dön</Link>
  </AccountShell>;
}

export function DemoAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { void fetch('/api/demo', { cache: 'no-store' }).then(async response => { const body = await response.json(); setEnabled(Boolean(body.enabled)); setAccounts(body.accounts ?? []); if (!response.ok && response.status !== 404) setError(errorMessage(body, 'Demo hesapları yüklenemedi.')); }).catch(() => setError('Demo sunucusuna bağlanılamadı.')); }, []);
  async function choose(id: string) { setBusy(id); setError(''); try { const response = await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: id }) }); const body = await response.json(); if (!response.ok) throw new Error(errorMessage(body, 'Demo hesabı açılamadı.')); window.location.assign(body.redirect ?? (accounts.find(account => account.id === id)?.role === 'student' ? '/' : '/classroom')); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.'); setBusy(''); } }
  return <AccountShell wide><p className={styles.eyebrow}>GELİŞTİRME DEMOSU</p><h1>İki sınıf. Otuz beş yolculuk.</h1><p className={styles.intro}>Öğretmen, öğrenci ve yönetici deneyimini birbirine bağlı örnek hesaplarla dene. Bu hesaplar ve canlı durumlar simülasyondur; gerçek kullanıcı verilerinden ayrıdır.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}{enabled === null && !error && <p className={styles.emptySmall}>Demo hesapları hazırlanıyor…</p>}{enabled === false && <p className={styles.inlineInfo}>Demo geçişi bu ortamda etkin değil. Geliştirme ortamında CLASSROOM_DEMO_ENABLED=true ile açılabilir.</p>}
    {enabled && <><div className={styles.demoTeachers}>{accounts.filter(account => account.role !== 'student').map(account => <button key={account.id} onClick={() => void choose(account.id)} disabled={Boolean(busy)}><span className={styles.demoRoleIcon}>{account.role === 'admin' ? <ShieldCheck size={25} /> : <GraduationCap size={25} />}</span><small>{roleLabel[account.role]}</small><strong>{account.name}</strong><span>{account.role === 'teacher' ? `${accounts.filter(student => student.teacher_id === account.id).length} öğrenci` : 'Başvurular ve erişim yönetimi'}</span><b>{busy === account.id ? 'Açılıyor…' : 'Hesabı aç'}<ArrowUpRight size={16} /></b></button>)}</div><div className={styles.sectionHeading}><h2>Öğrenci deneyimini aç</h2><span className={styles.muted}>{accounts.filter(account => account.role === 'student').length} öğrenci</span></div><input aria-label="Demo öğrencisi ara" placeholder="Öğrenci ara…" value={query} onChange={event => setQuery(event.target.value)} /><div className={styles.demoStudents}>{accounts.filter(account => account.role === 'student' && account.name.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'))).map(account => <button key={account.id} disabled={Boolean(busy)} onClick={() => void choose(account.id)}><strong>{account.name}</strong><small>{accounts.find(teacher => teacher.id === account.teacher_id)?.name ?? 'Atama bekliyor'}</small><ArrowUpRight size={15} /></button>)}</div><Link href="/register" className={styles.secondaryButton}>Kayıt ve onay akışını dene</Link></>}
    <Link className={styles.backLink} href="/"><ArrowLeft size={14} />Ana sayfaya dön</Link>
  </AccountShell>;
}
