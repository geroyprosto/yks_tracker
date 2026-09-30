'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock3, Copy, Link2, LogOut, RefreshCw, Send, UserMinus, UsersRound, X } from 'lucide-react';
import { Modal } from './modal';
import styles from './friends-workspace.module.css';

type Period = 'today' | 'week';
type ScoreField = 'seconds' | 'questions' | 'tests' | 'tasks';

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

type FriendGroup = { id: string; name: string; owner_id: string; member_count: number; timezone?: string };
type FriendsResponse = {
  today: string;
  week_start: string;
  me: FriendScore;
  friends: FriendScore[];
  groups: FriendGroup[];
  group: FriendGroup | null;
};
type Invite = { url: string; expiresAt: string; groupName: string };
type Removal = { person: FriendScore; kind: 'remove' | 'leave' };

function count(score: FriendScore, period: Period, field: ScoreField) {
  return score[`${period}_${field}`];
}

function duration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole === 0) return '0 dk';
  if (whole < 60) return `${whole} sn`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} sa ${minutes % 60} dk` : `${hours} sa`;
}

function dateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(date);
}

function initials(name: string) {
  return name.trim().split(/\s+/).map(part => Array.from(part)[0]).filter(Boolean).slice(0, 2).join('').toLocaleUpperCase('tr-TR') || '?';
}

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  }
  return fallback;
}

function errorCode(body: unknown) {
  if (!body || typeof body !== 'object' || !('error' in body) || !body.error || typeof body.error !== 'object' || !('code' in body.error)) return null;
  return typeof body.error.code === 'string' ? body.error.code : null;
}

function isScore(value: unknown): value is FriendScore {
  if (!value || typeof value !== 'object') return false;
  const score = value as Record<string, unknown>;
  return typeof score.user_id === 'string' && typeof score.display_name === 'string' &&
    ['today_seconds', 'week_seconds', 'today_questions', 'week_questions', 'today_tests', 'week_tests', 'today_tasks', 'week_tasks']
      .every(field => typeof score[field] === 'number' && Number.isFinite(score[field]));
}

function isGroup(value: unknown): value is FriendGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Record<string, unknown>;
  return typeof group.id === 'string' && typeof group.name === 'string' && typeof group.owner_id === 'string' && typeof group.member_count === 'number';
}

function isFriendsResponse(value: unknown): value is FriendsResponse {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.today === 'string' && typeof result.week_start === 'string' && isScore(result.me) &&
    Array.isArray(result.friends) && result.friends.every(isScore) && Array.isArray(result.groups) &&
    result.groups.every(isGroup) && (result.group === null || isGroup(result.group));
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function setGroupQuery(groupId: string | null) {
  const url = new URL(window.location.href);
  if (groupId) url.searchParams.set('group', groupId);
  else url.searchParams.delete('group');
  window.history.replaceState(window.history.state, '', url);
}

function Duel({ participants, period, meId, memberCount }: { participants: FriendScore[]; period: Period; meId: string; memberCount: number }) {
  const [first, second] = participants;
  const firstSeconds = first ? count(first, period, 'seconds') : 0;
  const secondSeconds = second ? count(second, period, 'seconds') : 0;
  const total = firstSeconds + secondSeconds;
  const tied = Boolean(second && firstSeconds === secondSeconds);
  const noStudy = Boolean(second && total === 0);
  const firstShare = total === 0 ? 0 : firstSeconds / total * 100;
  const secondShare = total === 0 ? 0 : secondSeconds / total * 100;
  const status = !second ? 'İlk arkadaşın katıldığında yarış burada başlayacak.'
    : noStudy ? 'Henüz çalışma süresi yok. İlk turu kim başlatacak? ✦'
      : tied ? `Ortak liderlik! İlk iki kişi de ${duration(firstSeconds)} çalıştı. ✦`
        : `Lider ile ikinci arasında ${duration(firstSeconds - secondSeconds)} var. Yarış daha yeni başlıyor! 🔥`;

  return <section className={styles.duel} role="region" aria-label="İkili karşılaşma">
    <div className={styles.duelTop}><div><p className={styles.eyebrow}>Tatlı yarış</p><h2>{period === 'today' ? 'Bugünün' : 'Bu haftanın'} yarışı 🏁</h2></div><span className={styles.pill}>{memberCount} üye</span></div>
    <div className={styles.vs}>
      <div className={`${styles.player} ${styles.first}`}>
        <div className={styles.avatar}>{first && firstSeconds > 0 && !noStudy && <span className={styles.crown} aria-label={tied ? 'Ortak lider' : 'Lider'}>👑</span>}{first ? initials(first.display_name) : '?'}</div>
        <div className={styles.playerName}>{first?.display_name || 'Öğrenci'}{first?.user_id === meId && <span className={styles.youChip}>Sen</span>}</div>
        <strong className={styles.playerTime}>{duration(firstSeconds)}</strong>
        <span className={styles.playerTag}>{!second ? 'İlk sıradasın' : noStudy ? 'Henüz süre yok' : tied ? 'Ortak lider' : 'Şu an lider'}</span>
      </div>
      <div className={styles.vsBadge} aria-hidden="true">VS</div>
      {second ? <div className={`${styles.player} ${styles.second}`}>
        <div className={styles.avatar}>{tied && !noStudy && <span className={styles.crown} aria-label="Ortak lider">👑</span>}{initials(second.display_name)}</div>
        <div className={styles.playerName}>{second.display_name}{second.user_id === meId && <span className={styles.youChip}>Sen</span>}</div>
        <strong className={styles.playerTime}>{duration(secondSeconds)}</strong>
        <span className={styles.playerTag}>{noStudy ? 'Henüz süre yok' : tied ? 'Ortak lider' : '2. sıra'}</span>
      </div> : <div className={`${styles.player} ${styles.second} ${styles.waitingPlayer}`}><div className={styles.avatar}>+</div><div className={styles.playerName}>Bir arkadaşın</div><strong className={styles.playerTime}>—</strong><span className={styles.playerTag}>Davet bekleniyor</span></div>}
    </div>
    {second && <div className={styles.tug} role="img" aria-label={`${first.display_name}: ${duration(firstSeconds)}, ${second.display_name}: ${duration(secondSeconds)}`}>
      {total > 0 && <><span className={styles.tugFirst} style={{ width: `${firstShare}%` }}/><span className={styles.tugSecond} style={{ width: `${secondShare}%` }}/></>}
    </div>}
    <p className={styles.gap}>{status}</p>
    {second && <div className={styles.mini} aria-label="Diğer çalışmaların karşılaştırması">
      {([['questions', 'Çözülen soru'], ['tests', 'Çözülen test'], ['tasks', 'Tamamlanan görev']] as const).map(([field, label]) => {
        const a = count(first, period, field);
        const b = count(second, period, field);
        return <div className={styles.miniStat} role="group" aria-label={`${label}: ${first.display_name} ${a}, ${second.display_name} ${b}`} key={field}><small>{label}</small><strong><span>{a.toLocaleString('tr-TR')}</span><i aria-hidden="true"> · </i><em>{b.toLocaleString('tr-TR')}</em></strong><span className={styles.miniLead}>{a === b ? 'Eşit ✦' : a > b ? '1. sıradaki önde ✦' : '2. sıradaki önde ✦'}</span></div>;
      })}
    </div>}
  </section>;
}

function Ranking({ participants, period, meId, canRemove, onRemove }: { participants: FriendScore[]; period: Period; meId: string; canRemove: boolean; onRemove: (person: FriendScore) => void }) {
  const max = participants.length ? count(participants[0], period, 'seconds') : 0;
  return <section className={styles.card} aria-labelledby="friends-ranking-title">
    <p className={styles.eyebrow}>Sıralama</p><h2 id="friends-ranking-title">Çalışma süresine göre</h2>
    <ol className={styles.rankList}>{participants.map((person, index) => {
      const seconds = count(person, period, 'seconds');
      const rank = seconds === 0 ? '–' : participants.findIndex(other => count(other, period, 'seconds') === seconds) + 1;
      const isMe = person.user_id === meId;
      return <li className={`${styles.rank} ${isMe ? styles.youRow : ''}`} key={person.user_id}>
        <span className={styles.rankBadge} aria-label={seconds === 0 ? 'Henüz sıralama yok' : `${rank}. sıra`}>{index === 0 && seconds > 0 ? '🏆' : rank}</span>
        <div className={styles.rankInfo}><strong>{person.display_name}</strong>{isMe && <span className={styles.youChip}>Sen</span>}<p>{count(person, period, 'questions').toLocaleString('tr-TR')} soru · {count(person, period, 'tests').toLocaleString('tr-TR')} test · {count(person, period, 'tasks').toLocaleString('tr-TR')} görev</p><div className={styles.rankTrack}><span className={isMe ? styles.trackYou : styles.trackOther} style={{ width: `${max > 0 ? seconds / max * 100 : 0}%` }}/></div></div>
        <strong className={styles.rankTime}>{duration(seconds)}</strong>
        {canRemove && !isMe && <button type="button" className={styles.removeButton} aria-label={`${person.display_name} adlı üyeyi çıkar`} title="Gruptan çıkar" onClick={() => onRemove(person)}><UserMinus size={16}/></button>}
      </li>;
    })}</ol>
  </section>;
}

function MyStats({ me, period }: { me: FriendScore; period: Period }) {
  return <section className={styles.card} aria-labelledby="my-friends-score-title"><p className={styles.eyebrow}>Benim emeğim</p><h2 id="my-friends-score-title">{period === 'today' ? 'Bugünkü' : 'Bu haftaki'} ritmin</h2><div className={styles.stats}>
    <div className={`${styles.stat} ${styles.statHighlight}`}><small><Clock3 size={14}/>Çalışma süresi</small><strong>{duration(count(me, period, 'seconds'))}</strong></div>
    <div className={styles.stat}><small>Çözülen soru</small><strong>{count(me, period, 'questions').toLocaleString('tr-TR')}</strong></div>
    <div className={styles.stat}><small>Çözülen test</small><strong>{count(me, period, 'tests').toLocaleString('tr-TR')}</strong></div>
    <div className={styles.stat}><small>Tamamlanan görev</small><strong>{count(me, period, 'tasks').toLocaleString('tr-TR')}</strong></div>
  </div></section>;
}

export function FriendsWorkspace() {
  const [period, setPeriod] = useState<Period>('today');
  const [scores, setScores] = useState<FriendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingGroup, setSwitchingGroup] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [shareError, setShareError] = useState('');
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const activeGroup = useRef<string | null>(null);
  const readSequence = useRef(0);
  const inviteInput = useRef<HTMLInputElement>(null);

  const loadScores = useCallback(async (groupId: string | null, signal?: AbortSignal) => {
    const sequence = ++readSequence.current;
    setLoading(true);
    setError('');
    try {
      let requestedGroup = groupId;
      for (let attempt = 0; attempt < 2; attempt++) {
        const query = requestedGroup ? `?group_id=${encodeURIComponent(requestedGroup)}` : '';
        const response = await fetch(`/api/friends${query}`, { cache: 'no-store', signal });
        const body = await responseBody(response);
        if (signal?.aborted || sequence !== readSequence.current) return false;
        if (!response.ok) {
          if (requestedGroup && errorCode(body) === 'GROUP_NOT_FOUND') {
            setScores(null);
            setInvite(null);
            setGroupQuery(null);
            activeGroup.current = null;
            requestedGroup = null;
            continue;
          }
          if (response.status === 401 || response.status === 403) { setScores(null); setInvite(null); }
          throw new Error(errorMessage(body, 'Arkadaş grubun yüklenemedi.'));
        }
        if (!isFriendsResponse(body)) throw new Error('Arkadaş verileri beklenen biçimde gelmedi.');
        setScores(body);
        activeGroup.current = body.group?.id ?? null;
        return true;
      }
      throw new Error('Arkadaş grubun yüklenemedi.');
    } catch (cause) {
      if (!signal?.aborted && sequence === readSequence.current) setError(cause instanceof Error ? cause.message : 'Bağlantı kurulamadı.');
      return false;
    } finally {
      if (!signal?.aborted && sequence === readSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requested = new URLSearchParams(window.location.search).get('group');
    const initialGroup = requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : null;
    activeGroup.current = initialGroup;
    queueMicrotask(() => { if (!controller.signal.aborted) void loadScores(initialGroup, controller.signal); });
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void loadScores(activeGroup.current, controller.signal); }, 60_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [loadScores]);

  async function selectGroup(groupId: string) {
    if (groupId === scores?.group?.id) return;
    setSwitchingGroup(true);
    const loaded = await loadScores(groupId);
    if (loaded) { setGroupQuery(activeGroup.current); setInvite(null); }
    setSwitchingGroup(false);
  }

  async function createInvite() {
    if (inviteBusy || loading || switchingGroup) return;
    setInviteBusy(true);
    setInviteError('');
    setShareError('');
    setCopyState('idle');
    try {
      const groupId = scores?.group?.id;
      const response = await fetch('/api/friends/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(groupId ? { group_id: groupId } : {}) });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Davet bağlantısı oluşturulamadı.'));
      if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string' || !('expires_at' in body) || typeof body.expires_at !== 'string' || !('group_id' in body) || typeof body.group_id !== 'string') throw new Error('Davet bağlantısı beklenen biçimde gelmedi.');
      const name = 'group_name' in body && typeof body.group_name === 'string' ? body.group_name : scores?.group?.name || 'arkadaş grubun';
      setInvite({ url: `${window.location.origin}/friend-invite?token=${encodeURIComponent(body.token)}`, expiresAt: body.expires_at, groupName: name });
      if (body.group_id !== groupId && await loadScores(body.group_id)) setGroupQuery(activeGroup.current);
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : 'Davet bağlantısı oluşturulamadı.');
    } finally { setInviteBusy(false); }
  }

  async function copyInvite() {
    if (!invite) return;
    setShareError('');
    try { await navigator.clipboard.writeText(invite.url); setCopyState('copied'); }
    catch { inviteInput.current?.focus(); inviteInput.current?.select(); setCopyState('failed'); }
  }

  async function shareInvite() {
    if (!invite) return;
    setShareError('');
    if (!navigator.share) { await copyInvite(); return; }
    try { await navigator.share({ title: 'YKSim arkadaş daveti', text: `${invite.groupName} grubunda birlikte çalışalım!`, url: invite.url }); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setShareError('Paylaşım açılamadı. Bağlantıyı kopyalayıp gönderebilirsin.'); }
  }

  async function removeMember() {
    if (!removing || !scores?.group || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError('');
    try {
      const response = await fetch('/api/friends', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friend_id: removing.person.user_id, group_id: scores.group.id }) });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorMessage(body, 'Üyelik değiştirilemedi.'));
      if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) throw new Error('Üyelik değiştirilemedi.');
      const leaving = removing.kind === 'leave';
      setRemoving(null);
      if (leaving) { setGroupQuery(null); setScores(null); setInvite(null); activeGroup.current = null; void loadScores(null); }
      else void loadScores(scores.group.id);
    } catch (cause) { setRemoveError(cause instanceof Error ? cause.message : 'Üyelik değiştirilemedi.'); }
    finally { setRemoveBusy(false); }
  }

  const participants = scores ? [scores.me, ...scores.friends].sort((a, b) =>
    count(b, period, 'seconds') - count(a, period, 'seconds') || a.user_id.localeCompare(b.user_id)) : [];
  const group = scores?.group ?? null;
  const isOwner = Boolean(group && group.owner_id === scores?.me.user_id);
  const expiry = invite ? new Date(invite.expiresAt) : null;

  return <div className={styles.workspace}>
    <section className={styles.groupBar} aria-label="Yarışma grubu">
      <div className={styles.groupIdentity}><UsersRound size={17}/>{scores && scores.groups.length > 1 ? <label className={styles.groupSelect}><span className={styles.srOnly}>Yarışma grubu</span><select aria-label="Yarışma grubu" disabled={loading || switchingGroup} value={group?.id ?? ''} onChange={event => void selectGroup(event.currentTarget.value)}>{scores.groups.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> : <strong>{group?.name ?? 'Arkadaş grubun'}</strong>}{group && <span className={styles.groupMeta}>{group.member_count} üye{isOwner ? ' · Grup yöneticisi' : ''}</span>}{scores && !group && <span className={styles.groupMeta}>İlk davetinle bir grup oluştur</span>}</div>
      {group && <button type="button" className={styles.leaveButton} onClick={() => { setRemoveError(''); setRemoving({ person: scores!.me, kind: 'leave' }); }}><LogOut size={15}/>Gruptan ayrıl</button>}
    </section>

    <div className={styles.toolbar}>
      <div className={styles.tabs} role="group" aria-label="Yarışma dönemi"><button type="button" aria-pressed={period === 'today'} onClick={() => setPeriod('today')}>Bugün</button><button type="button" aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>Bu hafta</button></div>
      <div className={styles.toolbarRight}><span>{scores ? period === 'today' ? dateLabel(scores.today) : `${dateLabel(scores.week_start)} haftası` : ''}</span><button type="button" className={styles.refreshButton} title="Skorları yenile" aria-label="Skorları yenile" disabled={loading || switchingGroup} onClick={() => void loadScores(activeGroup.current)}><RefreshCw size={16}/></button><button type="button" className={styles.inviteButton} disabled={inviteBusy || loading || switchingGroup} onClick={() => void createInvite()}><Link2 size={16}/>{inviteBusy ? 'Hazırlanıyor…' : '+ Arkadaş davet et'}</button></div>
    </div>

    {inviteError && <div className={styles.noticeError} role="alert"><span>{inviteError}</span><button type="button" onClick={() => void createInvite()}>Tekrar dene</button></div>}
    {invite && <section className={styles.inviteLink} aria-label="Davet bağlantın"><div className={styles.inviteLinkHead}><div><strong>{invite.groupName} grubuna davet hazır</strong><p>Bağlantıyı göndereceğin kişi kabul ederse gruptaki herkes birbirinin çalışma özetini görür.</p></div><button type="button" className={styles.closeButton} aria-label="Davet bağlantısını gizle" onClick={() => { setInvite(null); setCopyState('idle'); }}><X size={18}/></button></div><div className={styles.inviteControls}><input ref={inviteInput} aria-label="Davet bağlantısı" readOnly value={invite.url} onFocus={event => event.currentTarget.select()}/><button type="button" onClick={() => void copyInvite()}>{copyState === 'copied' ? <Check size={15}/> : <Copy size={15}/>} {copyState === 'copied' ? 'Kopyalandı' : 'Kopyala'}</button><button type="button" onClick={() => void shareInvite()}><Send size={15}/>Paylaş</button></div>{expiry && !Number.isNaN(expiry.getTime()) && <p className={styles.inviteExpiry}>Bağlantı {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(expiry)} tarihine kadar geçerli.</p>}{copyState === 'failed' && <p className={styles.inviteFeedback} role="status">Panoya kopyalanamadı. Bağlantı seçildi; elle kopyalayabilirsin.</p>}{shareError && <p className={styles.inviteFeedback} role="status">{shareError}</p>}</section>}
    {error && <div className={styles.noticeError} role="alert"><span>{error}</span><button type="button" onClick={() => void loadScores(activeGroup.current)}>Tekrar dene</button></div>}

    {(loading && (!scores || switchingGroup)) ? <div className={styles.loading} role="status" aria-label="Arkadaş grubun yükleniyor"><div/><div/><div/></div> : scores ? <>
      <Duel participants={participants} period={period} meId={scores.me.user_id} memberCount={group?.member_count ?? 1}/>
      <Ranking participants={participants} period={period} meId={scores.me.user_id} canRemove={isOwner} onRemove={person => { setRemoveError(''); setRemoving({ person, kind: 'remove' }); }}/>
      <MyStats me={scores.me} period={period}/>
      <section className={`${styles.card} ${styles.inviteFooter}`}><div><strong>Küçük bir çalışma yarışı</strong><p>{group ? 'Yeni katılan herkes bu gruptaki üyelerin günlük ve haftalık çalışma özetini görebilir.' : 'Arkadaşlarınla bugünkü ve haftalık emeğini yan yana gör. Her adım kendi hızında değerli.'}</p></div><button type="button" className={styles.inviteButton} disabled={inviteBusy || loading || switchingGroup} onClick={() => void createInvite()}>Arkadaş davet et</button></section>
      <p className={styles.foot}>Bugün az çalışmış olmak geri kalmak demek değil. Yarın yeni bir gün. ✦</p>
    </> : !loading && <section className={styles.unavailable}><UsersRound size={28}/><h2>Yarışma alanı açılamadı</h2><p>Biraz sonra yeniden deneyebilirsin.</p><button type="button" onClick={() => void loadScores(activeGroup.current)}>Tekrar dene</button></section>}

    {removing && <Modal title={removing.kind === 'leave' ? 'Gruptan ayrıl' : 'Üyeyi gruptan çıkar'} onClose={() => { if (!removeBusy) setRemoving(null); }}><div className={styles.removeDialog}><p>{removing.kind === 'leave' && group ? group.owner_id === scores?.me.user_id ? group.member_count > 1 ? <><strong>{group.name}</strong> grubundan ayrılırsan yöneticilik kalan üyelerden birine geçecek. Bu grubun çalışmalarını artık göremeyeceksin.</> : <><strong>{group.name}</strong> grubundan ayrılırsan grup kapanacak.</> : <><strong>{group.name}</strong> grubundan ayrılacaksın. Yeniden katılmak için yeni bir davet bağlantısı gerekir.</> : removing.kind === 'leave' ? 'Bu gruptan ayrılacaksın.' : <><strong>{removing.person.display_name}</strong> gruptan çıkarılacak. Grubun çalışma özetlerini artık göremeyecek.</>}</p>{removeError && <p className={styles.removeError} role="alert">{removeError}</p>}<div className={styles.dialogActions}><button type="button" data-initial-focus disabled={removeBusy} onClick={() => setRemoving(null)}>Vazgeç</button><button type="button" className={styles.confirmRemove} disabled={removeBusy} onClick={() => void removeMember()}>{removeBusy ? 'İşleniyor…' : removing.kind === 'leave' ? 'Gruptan ayrıl' : 'Üyeyi çıkar'}</button></div></div></Modal>}
  </div>;
}
