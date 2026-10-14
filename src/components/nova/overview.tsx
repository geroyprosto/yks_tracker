import {ArrowUpRight, Coffee, Moon, Sparkles} from 'lucide-react';
import {weeklyRaceSummary} from '@/lib/nova/race-summary';
import type {NovaWebState} from '@/lib/nova/web-types';
import {NovaAvatar} from './avatar';
import {clock, number} from './view-utils';
import styles from './workspace.module.css';

const reasons: Record<string, string> = {GOOD_SLEEP: 'Simüle uykusu dinlendiriciydi.', SHORT_SLEEP: 'Simüle uykusu kısa sürdü.', RECOVERY: 'Dinlenerek toparlandı.', STUDY_LOAD: 'Çalışma yükü enerjisini etkiledi.', DISTRACTION: 'Dikkati bir süre dağıldı.', TASK_COMPLETED: 'Planındaki bir çalışmayı tamamladı.', TASK_MISSED: 'Planındaki bir çalışma aksadı.', CALIBRATION: 'Başlangıç seviyesi henüz kalibre ediliyor.', PREVIOUS_DAY: 'Önceki günün etkileri sürüyor.'};
export function NovaToday({data, openRace}: {data: NovaWebState; openRace: () => void}) {
  const day = data.today;
  if (!day) return <div className={styles.emptyState}>Nova’nın günü hazırlanıyor.</div>;
  return <div className={styles.today}>
    <section className={styles.dayHero}>
      <div className={styles.dayPortrait}><NovaAvatar large/><span>Nova’nın simüle yaşamı</span></div>
      <div className={styles.dayIntro}><p className={styles.eyebrow}>BUGÜN NOVA</p><h2>{day.mood}</h2><p className={styles.currentActivity}>{day.currentEvent?.label ?? 'Günlük program tamamlandı.'}</p>
        <p className={styles.softText}>Onun da çalışma saatleri, molaları ve kendi temposu var.</p>
        <button className={styles.quietButton} onClick={openRace}>Yarışı gör <ArrowUpRight size={17}/></button>
      </div>
    </section>
    <div className={styles.dayColumns}>
      <section className={styles.timeline}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ADIM ADIM</p><h3>Günün akışı</h3></div><span>{data.dayInfo?.localDate && new Intl.DateTimeFormat('tr-TR', {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(new Date(`${data.dayInfo.localDate}T12:00:00Z`))}</span></div>
        <ol>{day.timeline.map(event => <li key={event.id} data-status={event.status}><time>{clock(event.startsAt, data.settings.timezone)}</time><span className={styles.timelinePoint}/><div><strong>{event.label}</strong><span>{event.status === 'completed' ? 'Tamamlandı' : event.status === 'active' ? 'Şu anda' : 'Planlandı'} · {clock(event.endsAt, data.settings.timezone)}{event.result && event.result.studyMinutes > 0 ? ` · ${number(event.result.studyMinutes)} dk çalışma` : ''}</span></div></li>)}</ol>
      </section>
      <aside className={styles.dayAside}>
        <section><p className={styles.eyebrow}>BUGÜNKÜ RİTMİ</p><div className={styles.tempo}><strong>{number(day.metrics.studyMinutes)}</strong><span>dakika<br/>çalışma tamamlandı</span></div><p className={styles.softText}>Güne yayılan hedefi {number(day.metrics.studyTargetMinutes)} dakika.</p></section>
        <section className={styles.moodDetails}><h3>Nasıl hissediyor?</h3><ul className={styles.vitals}>{([['energy', 'Enerji', Coffee], ['focus', 'Odak', Sparkles], ['stress', 'Stres', Moon]] as const).map(([key, label, Icon]) => <li key={key}><Icon size={17}/><span>{label}</span><strong>{day.state[key] < 35 ? 'Düşük' : day.state[key] < 70 ? 'Dengeli' : 'Yüksek'}</strong></li>)}</ul><details><summary>Ruh hâlinin ayrıntıları</summary><div className={styles.bars}>{([['energy', 'Enerji'], ['focus', 'Odak'], ['stress', 'Stres']] as const).map(([key, label]) => <label key={key}>{label}<span>{number(day.state[key])} / 100</span><progress max={100} value={day.state[key]} aria-label={label}/></label>)}</div><ul>{day.reasonCodes.map(code => <li key={code}>{reasons[code] ?? code}</li>)}</ul><p>Bu değerler Nova’nın simüle durumunu anlatır.</p></details></section>
        {data.profile.baseline.missingData.length > 0 && <details className={styles.calibration}><summary>Başlangıç seviyesi oluşuyor</summary><p>Nova’nın çalışma temposu kayıtlı çalışma verilerinden hazırlanır. Eksik ölçümler yarışta sıfır sayılmaz.</p><p>{data.profile.baseline.missingData.join(' ')}</p></details>}
        <p className={styles.smallNote}>Nova’nın çalışmaları simülasyondur; senin gerçek kayıtlarına eklenmez.</p>
      </aside>
    </div>
  </div>;
}

export function NovaRace({data}: {data: NovaWebState}) {
  const race = data.race;
  if (!race) return <div className={styles.emptyState}>Yarış kaydı henüz oluşmadı.</div>;
  const weekly = weeklyRaceSummary(data.weekly);
  const difference = race.user.total !== null && race.nova.total !== null ? race.user.total - race.nova.total : null;
  const names = {tasks: 'Görev tamamlama', study: 'Çalışma hedefi', questions: 'Soru çalışması', topics: 'Konu ilerlemesi', consistency: 'İstikrar'};
  return <section className={styles.race}>
    <header className={styles.raceHeading}><p className={styles.eyebrow}>KÜÇÜK BİR REKABET, ORTAK BİR RİTİM</p><h2>Bugünün adil yarışı</h2><p>{difference === null ? 'Karşılaştırma için ortak kayıtlar bekleniyor.' : difference === 0 ? 'Şu an aynı puandasınız.' : difference > 0 ? `${number(difference)} puan öndesin.` : `Nova ${number(-difference)} puan önde.`}</p></header>
    <div className={styles.scores}><article><span className={styles.scoreIdentity}>Sen <span>Gerçek kayıtların</span></span><strong>{number(race.user.total)}{race.user.total !== null && <small>/ 100</small>}</strong><p>{number(race.userMetrics.studyMinutes)} dk çalışma · {number(race.userMetrics.questions)} soru</p></article><article className={styles.novaScore}><span className={styles.scoreIdentity}><NovaAvatar/>Nova <span>Simülasyon</span></span><strong>{number(race.nova.total)}{race.nova.total !== null && <small>/ 100</small>}</strong><p>{number(race.novaMetrics.studyMinutes)} dk çalışma · {number(race.novaMetrics.questions)} soru</p></article></div>
    <p className={styles.raceNote}>Yalnızca ikinizde de bulunan ölçümler karşılaştırılır. Eksik kayıt sıfır başarı sayılmaz.</p>
    <details className={styles.scoreDetails}><summary>Puanın ayrıntıları</summary><div className={styles.tableWrap}><table><caption>0–100 aralığında puan bileşenleri</caption><thead><tr><th scope="col">Bileşen</th><th scope="col">Sen</th><th scope="col">Nova</th><th scope="col">Ağırlık</th></tr></thead><tbody>{(Object.keys(names) as (keyof typeof names)[]).map(key => <tr key={key}><th scope="row">{names[key]}</th><td>{number(race.user.components[key])}</td><td>{number(race.nova.components[key])}</td><td>{number(race.user.weights[key] * 100)}%</td></tr>)}<tr><th scope="row">Doğruluk</th><td>{number(race.userMetrics.accuracyPercent)}</td><td>{number(race.novaMetrics.accuracyPercent)}</td><td>%</td></tr></tbody></table></div><p>Soru doğruluğu kaydedilmemişse iki tarafta da puana katılmaz. Ağırlıklar ürün tercihidir; bilimsel başarı tahmini değildir.</p><p>Nova’nın günü sabah dondurulur; bugün seni yakalamak için yeniden yazılmaz.</p></details>
    <section className={styles.weekly}><div><p className={styles.eyebrow}>BİR HAFTALIK BAKIŞ</p><h3>Biriken emek</h3><p>{weekly.includedDays} kesinleşmiş gün · Devam eden gün dahil değil.</p></div><div className={styles.weeklyScores}><span>Sen <strong>{number(weekly.userTotal)}</strong></span><span>Nova <strong>{number(weekly.novaTotal)}</strong></span></div></section>
    <details className={styles.scoreDetails}><summary>Yakın günleri gör</summary><ul className={styles.list}>{data.weekly.map(day => <li key={day.localDate}><strong>{day.localDate}</strong><span>Sen {number(day.userScore)} · Nova {number(day.novaScore)} · {day.finalized ? 'Kesinleşti' : 'Gün sürüyor'}</span></li>)}</ul><p>Son yedi kayıtlı tarihte, iki tarafın da puanı bulunan günlerin toplamı; en fazla 700 puan.</p></details>
  </section>;
}
