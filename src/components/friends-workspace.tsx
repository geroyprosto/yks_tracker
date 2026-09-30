'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock3, Copy, HeartHandshake, Link2, ListChecks, RefreshCw, Send, Sparkles, Trophy, UserMinus, UsersRound, X } from 'lucide-react';
import { Modal } from './modal';
import styles from './friends-workspace.module.css';

type Period = 'today' | 'week';

export type FriendScore = {
  user_id: string;
  display_name: string;
  today_seconds: number;
  week_seconds: number;
  today_questions: number;
  week_questions: number;
  today_tests: number;
  week_tests: number;
  today_tasks: number;
  week_tasks: number;
};

type FriendsResponse = {
  today: string;
  week_start: string;
  me: FriendScore;
  friends: FriendScore[];
};

type Invite = { url: string; expiresAt: string };

function duration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} sa ${minutes % 60} dk` : `${hours} sa`;
}

function count(score: FriendScore, period: Period, field: 'questions' | 'tests' | 'tasks' | 'seconds') {
  return score[`${period}_${field}`];
}

function dateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(date);
}

function requestError(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  }
  return fallback;
}

function isFriendScore(value: unknown): value is FriendScore {
  if (!value || typeof value !== 'object') return false;
  const score = value as Record<string, unknown>;
  return typeof score.user_id === 'string' && typeof score.display_name === 'string' &&
    ['today_seconds', 'week_seconds', 'today_questions', 'week_questions', 'today_tests', 'week_tests', 'today_tasks', 'week_tasks']
      .every(field => typeof score[field] === 'number');
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

export function FriendsWorkspace() {
  const [period, setPeriod] = useState<Period>('today');
  const [scores, setScores] = useState<FriendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [shareError, setShareError] = useState('');
  const [removing, setRemoving] = useState<FriendScore | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const inviteInput = useRef<HTMLInputElement>(null);

  const loadScores = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/friends', { cache: 'no-store', signal });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(body, 'Arkadaşlarının çalışmaları yüklenemedi.'));
      if (!body || typeof body !== 'object' || !('me' in body) || !isFriendScore(body.me) || !('friends' in body) ||
        !Array.isArray(body.friends) || !body.friends.every(isFriendScore) || !('today' in body) || typeof body.today !== 'string' ||
        !('week_start' in body) || typeof body.week_start !== 'string') {
        throw new Error('Arkadaş verileri beklenen biçimde gelmedi.');
      }
      if (!signal?.aborted) setScores(body as FriendsResponse);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Bağlantı kurulamadı.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void loadScores(controller.signal); });
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void loadScores(controller.signal); }, 60_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [loadScores]);

  async function createInvite() {
    if (inviteBusy) return;
    setInviteBusy(true);
    setCopyState('idle');
    setShareError('');
    setInviteError('');
    try {
      const response = await fetch('/api/friends/invite', { method: 'POST' });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(body, 'Davet bağlantısı oluşturulamadı.'));
      if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string' || !('expires_at' in body) || typeof body.expires_at !== 'string') {
        throw new Error('Davet bağlantısı beklenen biçimde gelmedi.');
      }
      setInvite({ url: `${window.location.origin}/friend-invite?token=${encodeURIComponent(body.token)}`, expiresAt: body.expires_at });
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : 'Davet bağlantısı oluşturulamadı.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    if (!invite) return;
    setShareError('');
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopyState('copied');
    } catch {
      inviteInput.current?.focus();
      inviteInput.current?.select();
      setCopyState('failed');
    }
  }

  async function shareInvite() {
    if (!invite) return;
    setShareError('');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'YKSim çalışma daveti', text: 'YKSim’de birlikte çalışalım!', url: invite.url });
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setShareError('Paylaşım açılamadı. Bağlantıyı Kopyala ile gönderebilirsin.');
      }
    } else {
      await copyInvite();
    }
  }

  async function removeFriend() {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError('');
    try {
      const response = await fetch('/api/friends', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friend_id: removing.user_id }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(body, 'Arkadaş kaldırılamadı.'));
      if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) throw new Error('Arkadaş kaldırılamadı.');
      setScores(current => current ? { ...current, friends: current.friends.filter(friend => friend.user_id !== removing.user_id) } : current);
      setRemoving(null);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : 'Arkadaş kaldırılamadı.');
    } finally {
      setRemoveBusy(false);
    }
  }

  const participants = scores ? [scores.me, ...scores.friends]
    .sort((a, b) => count(b, period, 'seconds') - count(a, period, 'seconds') || a.display_name.localeCompare(b.display_name, 'tr')) : [];
  const mine = scores?.me;
  const otherCount = scores?.friends.length ?? 0;

  return <div className={styles.workspace}>
    <section className={styles.welcome} aria-labelledby="friends-welcome-title">
      <span className={styles.welcomeIcon} aria-hidden="true"><HeartHandshake size={26}/></span>
      <div className={styles.welcomeCopy}>
        <p className="eyebrow">BİRLİKTE DAHA KEYİFLİ</p>
        <h2 id="friends-welcome-title">Küçük bir çalışma yarışı</h2>
        <p>Arkadaşlarınla bugünkü ve haftalık emeğini yan yana gör. Her adım kendi hızında değerli.</p>
      </div>
      <button className="button primary" type="button" disabled={inviteBusy} onClick={() => void createInvite()}>
        <Link2 size={16}/>{inviteBusy ? 'Bağlantı hazırlanıyor…' : 'Arkadaş davet et'}
      </button>
    </section>

    {inviteError && <div className="notice error" role="alert"><span>{inviteError}</span><button type="button" className="button secondary small" onClick={() => void createInvite()}>Tekrar dene</button></div>}

    {invite && <section className={styles.inviteCard} aria-label="Davet bağlantın">
      <div className={styles.inviteHeading}><div><strong>Davet bağlantın hazır</strong><p>Arkadaşına gönder; kabul ettiğinde burada yan yana görünürsünüz.</p></div><button type="button" className="icon-button" aria-label="Davet bağlantısını gizle" onClick={() => { setInvite(null); setCopyState('idle'); }}><X size={17}/></button></div>
      <div className={styles.inviteControls}><input ref={inviteInput} type="text" readOnly aria-label="Davet bağlantısı" value={invite.url} onFocus={event => event.currentTarget.select()}/><button type="button" className="button secondary" onClick={() => void copyInvite()}>{copyState === 'copied' ? <Check size={16}/> : <Copy size={16}/>} {copyState === 'copied' ? 'Kopyalandı' : 'Kopyala'}</button><button type="button" className="button secondary" onClick={() => void shareInvite()}><Send size={16}/>Paylaş</button></div>
      <p className={styles.inviteHint}>Bağlantı {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(invite.expiresAt))} tarihine kadar geçerli.</p>
      {copyState === 'failed' && <p className={styles.copyHint} role="status">Panoya kopyalanamadı. Bağlantı seçildi; elle kopyalayabilirsin.</p>}
      {shareError && <p className={styles.copyHint} role="status">{shareError}</p>}
    </section>}

    {error && <div className="notice error" role="alert"><span>{error}</span><button type="button" className="button secondary small" onClick={() => void loadScores()}>Tekrar dene</button></div>}

    <div className={styles.periodBar}>
      <div className={styles.periodTabs} role="group" aria-label="Yarışma dönemi">
        <button type="button" aria-pressed={period === 'today'} onClick={() => setPeriod('today')}>Bugün</button>
        <button type="button" aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>Bu hafta</button>
      </div>
      <div className={styles.periodEnd}>{scores && <span className={styles.periodDate}>{period === 'today' ? dateLabel(scores.today) : `${dateLabel(scores.week_start)} haftası`}</span>}<button type="button" className={styles.refreshButton} disabled={loading} aria-label="Skorları yenile" title="Skorları yenile" onClick={() => void loadScores()}><RefreshCw size={16}/></button></div>
    </div>

    {loading && !scores ? <div className={styles.loading} role="status" aria-label="Arkadaşların yükleniyor"><div/><div/><div/></div> : scores && mine ? <>
      <section className={styles.mySummary} aria-labelledby="my-friends-score-title">
        <div className={styles.mySummaryHead}><div><p className="eyebrow">BENİM EMEĞİM</p><h2 id="my-friends-score-title">{period === 'today' ? 'Bugünkü' : 'Bu haftaki'} ritmin</h2></div><Sparkles size={21} aria-hidden="true"/></div>
        <div className={styles.statsGrid}>
          <div className={styles.mainMetric}><Clock3 size={18} aria-hidden="true"/><span>Çalışma süresi</span><strong>{duration(count(mine, period, 'seconds'))}</strong></div>
          <div className={styles.metric}><span>Çözülen soru</span><strong>{count(mine, period, 'questions').toLocaleString('tr-TR')}</strong></div>
          <div className={styles.metric}><span>Çözülen test</span><strong>{count(mine, period, 'tests').toLocaleString('tr-TR')}</strong></div>
          <div className={styles.metric}><span>Tamamlanan görev</span><strong>{count(mine, period, 'tasks').toLocaleString('tr-TR')}</strong></div>
        </div>
      </section>

      <section className={styles.ranking} aria-labelledby="friends-ranking-title">
        <header className={styles.rankingHead}><div><p className="eyebrow">TATLI YARIŞMA</p><h2 id="friends-ranking-title">{period === 'today' ? 'Bugünün' : 'Bu haftanın'} sıralaması</h2><p>Çalışma süresine göre sıralanır; soru, test ve görevler de görünür.</p></div><span className={styles.friendCount}><UsersRound size={15}/>{otherCount} arkadaş</span></header>
        {otherCount === 0 && <div className={styles.emptyFriends}><div className={styles.emptyIcon}><UsersRound size={27}/></div><h3>Beraber çalışmaya davet et</h3><p>Henüz arkadaşın yok. İlk davet bağlantını paylaş, sonra günlük ve haftalık ilerlemenizi birlikte görün.</p><button type="button" className="button secondary" disabled={inviteBusy} onClick={() => void createInvite()}><Link2 size={16}/>Davet bağlantısı oluştur</button></div>}
        <ol className={styles.rankList}>{participants.map((person, index) => {
          const isMe = person.user_id === mine.user_id;
          const seconds = count(person, period, 'seconds');
          return <li className={`${styles.rankRow} ${isMe ? styles.myRow : ''}`} key={person.user_id}>
            <span className={styles.rankNumber} aria-label={`${index + 1}. sıra`}>{index === 0 && otherCount > 0 ? <Trophy size={18} aria-hidden="true"/> : index + 1}</span>
            <span className={styles.person}><strong>{person.display_name || 'Öğrenci'} {isMe && <span className={styles.meTag}>Sen</span>}</strong><span><ListChecks size={13} aria-hidden="true"/>{count(person, period, 'questions').toLocaleString('tr-TR')} soru <span aria-hidden="true">·</span> {count(person, period, 'tests').toLocaleString('tr-TR')} test <span aria-hidden="true">·</span> {count(person, period, 'tasks').toLocaleString('tr-TR')} görev</span></span>
            <strong className={styles.rankTime}>{duration(seconds)}</strong>
            {!isMe && <button type="button" className={styles.removeButton} aria-label={`${person.display_name || 'Öğrenci'} adlı arkadaşı kaldır`} onClick={() => { setRemoveError(''); setRemoving(person); }}><UserMinus size={17}/></button>}
          </li>;
        })}</ol>
        {otherCount > 0 && <p className={styles.kindNote}>Bugün az çalışmış olmak geri kalmak demek değil. Yarın yeni bir gün. <span aria-hidden="true">✦</span></p>}
      </section>
    </> : !loading && <section className={styles.unavailable}><UsersRound size={28}/><h2>Yarışma alanı açılamadı</h2><p>Biraz sonra yeniden deneyebilirsin.</p><button type="button" className="button secondary" onClick={() => void loadScores()}>Tekrar dene</button></section>}

    {removing && <Modal title="Arkadaşı kaldır" onClose={() => { if (!removeBusy) setRemoving(null); }}><div className={styles.removeDialog}><p><strong>{removing.display_name || 'Bu öğrenci'}</strong> arkadaş listesinden kaldırılacak. Birbirinizin günlük ve haftalık çalışmalarını artık göremeyeceksiniz.</p>{removeError && <p role="alert" className="error-text">{removeError}</p>}<div className="form-actions"><button type="button" className="button secondary" data-initial-focus disabled={removeBusy} onClick={() => setRemoving(null)}>Vazgeç</button><button type="button" className={styles.confirmRemove} disabled={removeBusy} onClick={() => void removeFriend()}><UserMinus size={16}/>{removeBusy ? 'Kaldırılıyor…' : 'Arkadaşı kaldır'}</button></div></div></Modal>}
  </div>;
}
