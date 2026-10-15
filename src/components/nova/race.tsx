import {CalendarDays, CheckCheck, ChevronDown, CircleHelp, Flag, Target, Trophy, UserRound} from 'lucide-react';
import {Donut} from '@/components/progress-ring';
import {weeklyRaceSummary} from '@/lib/nova/race-summary';
import type {NovaMetrics, NovaScore} from '@/lib/nova/types';
import type {NovaWebState} from '@/lib/nova/web-types';
import {NovaAvatar} from './avatar';
import {RaceComponentChart, RaceWeeklyChart} from './race-charts';
import {number} from './view-utils';
import styles from './race.module.css';

const names = {tasks: 'Görev tamamlama', study: 'Çalışma hedefi', questions: 'Soru çalışması', topics: 'Konu ilerlemesi', consistency: 'İstikrar'};
const keys = Object.keys(names) as (keyof typeof names)[];
const percentage = (value: number | null, target: number | null) => value !== null && target !== null && Number.isFinite(value) && Number.isFinite(target) && value >= 0 && target > 0 ? value / target * 100 : null;

function Goal({name, label, value, target, unit}: {name: string; label: string; value: number | null; target: number | null; unit: string}) {
  const percent = percentage(value, target);
  return <div className={styles.goal}>
    <div><span>{label}</span><strong>{percent === null ? '—' : `%${number(percent)}`}</strong></div>
    <div className={styles.track} role={percent === null ? undefined : 'progressbar'} aria-label={`${name}: ${label.toLocaleLowerCase('tr-TR')}`} aria-valuemin={percent === null ? undefined : 0} aria-valuemax={percent === null ? undefined : 100} aria-valuenow={percent === null ? undefined : Math.min(100, percent)} aria-valuetext={percent === null ? undefined : `%${number(percent)} tamamlandı`}>
      {percent !== null && <span style={{width: `${Math.min(100, percent)}%`}}/>}
    </div>
    <small>{value === null ? 'Kayıt yok' : target === null || target <= 0 ? `${number(value)} ${unit} · Hedef yok` : `${number(value)} / ${number(target)} ${unit}`}</small>
  </div>;
}

function ScoreCard({name, score, metrics, leading}: {name: 'Sen' | 'Nova'; score: NovaScore; metrics: NovaMetrics; leading: boolean}) {
  const isNova = name === 'Nova';
  return <article className={styles.scoreCard} data-player={isNova ? 'nova' : 'user'} aria-label={`${name}: günlük yarış puanı`}>
    <header className={styles.playerHeading}>
      <span className={styles.playerAvatar}>{isNova ? <NovaAvatar/> : <UserRound size={20}/>}</span>
      <div><h3>{name}</h3><span>{isNova ? 'Simülasyon' : 'Gerçek kayıtların'}</span></div>
      {leading && <span className={styles.leader}><Trophy size={12}/>Önde</span>}
    </header>
    <div className={styles.scoreBody}>
      <div className={styles.scoreRing}>
        <Donut segments={score.total === null ? [] : [{key: 'score', label: 'Yarış puanı', value: score.total, color: isNova ? 2 : 0}]} center={score.total === null ? '—' : number(score.total)} caption={score.total === null ? 'KAYIT YOK' : '/ 100 PUAN'} label={`${name}: ${score.total === null ? 'Kayıt yok' : `${number(score.total)} / 100 puan`}`} empty={score.total === null} rounded/>
        <span className={styles.ringCaption}>Günlük yarış puanı</span>
      </div>
      <div className={styles.goals}>
        <Goal name={name} label="Çalışma hedefi" value={metrics.studyMinutes} target={metrics.studyTargetMinutes} unit="dk"/>
        <Goal name={name} label="Soru hedefi" value={metrics.questions} target={metrics.questionTarget} unit="soru"/>
        <Goal name={name} label="Görev tamamlama" value={metrics.tasksCompleted} target={metrics.taskTotal} unit="görev"/>
      </div>
    </div>
    <footer className={styles.scoreFooter}><CheckCheck size={14}/><span>Doğruluk</span><strong>{metrics.accuracyPercent === null ? 'Kayıt yok' : `%${number(metrics.accuracyPercent)}`}</strong></footer>
  </article>;
}

export function NovaRace({data}: {data: NovaWebState}) {
  const race = data.race;
  if (!race) return <div className={styles.empty}><Flag size={28}/><h2>Yarış kaydı henüz oluşmadı.</h2><p>Ortak çalışma kayıtları oluştuğunda puanların ve grafiklerin burada görünecek.</p></div>;
  const weekly = weeklyRaceSummary(data.weekly);
  const difference = race.user.total !== null && race.nova.total !== null ? race.user.total - race.nova.total : null;
  const shared = keys.filter(key => race.user.weights[key] > 0 && race.user.components[key] !== null && race.nova.components[key] !== null);
  const strongest = shared.reduce<keyof typeof names | null>((best, key) => best === null || race.user.components[key]! > race.user.components[best]! ? key : best, null);
  const status = difference === null ? 'Ortak kayıtlar bekleniyor' : difference === 0 ? 'Şu an aynı puandasınız' : difference > 0 ? `${number(difference)} puan öndesin` : `Nova ${number(-difference)} puan önde`;
  return <section className={styles.race} aria-label="Yarış özeti">
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>BİRLİKTE İLERLE, KENDİNİ GELİŞTİR</p><h2>Bugünün adil yarışı</h2><p>Her çalışma, günün puanına bir adım daha ekler.</p></div>
      <span className={styles.date}><CalendarDays size={14}/>{data.dayInfo ? new Intl.DateTimeFormat('tr-TR', {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(new Date(`${data.dayInfo.localDate}T12:00:00Z`)) : 'Bugün'}</span>
    </header>
    <div className={styles.summary}>
      <div><span className={styles.summaryIcon}><Trophy size={17}/></span><div><span>Yarışın durumu</span><strong>{status}</strong></div></div>
      <div><span className={styles.summaryIcon}><Target size={17}/></span><div><span>En yüksek bileşenin</span><strong>{strongest ? `${names[strongest]} · ${number(race.user.components[strongest])} puan` : 'Kayıtlar bekleniyor'}</strong></div></div>
      <div><span className={styles.summaryIcon}><CheckCheck size={17}/></span><div><span>Ortak ölçüm</span><strong>{shared.length} / 5 bileşen</strong></div></div>
    </div>
    <div className={styles.scores}>
      <ScoreCard name="Sen" score={race.user} metrics={race.userMetrics} leading={difference !== null && difference > 0}/>
      <ScoreCard name="Nova" score={race.nova} metrics={race.novaMetrics} leading={difference !== null && difference < 0}/>
    </div>
    <p className={styles.fairness}><CircleHelp size={14}/>Yalnızca ortak ölçümler puana katılır. Eksik kayıt sıfır başarı sayılmaz.</p>
    <div className={styles.chartGrid}>
      <section className={styles.chartCard} aria-label="Puan bileşenleri karşılaştırması"><header><p className={styles.eyebrow}>NEREDEN PUAN KAZANDIN?</p><h3>Performans dengesi</h3><p>Beş bileşende senin ve Nova’nın puanları.</p></header><RaceComponentChart race={race}/></section>
      <section className={styles.chartCard} aria-label="Haftalık yarış grafiği"><header><p className={styles.eyebrow}>SON 7 KAYITLI GÜN</p><h3>Biriken emek</h3><p>Günlük puanların zaman içindeki değişimi.</p></header>
        <div className={styles.weeklyScores}><div><span>Sen · toplam</span><strong>{number(weekly.userTotal)}{weekly.userTotal !== null && <small> puan</small>}</strong></div><div><span>Nova · toplam</span><strong>{number(weekly.novaTotal)}{weekly.novaTotal !== null && <small> puan</small>}</strong></div></div>
        <RaceWeeklyChart days={data.weekly}/><p className={styles.chartNote}>{weekly.includedDays} kesinleşmiş ortak gün · Devam eden gün toplama dahil değil.</p>
      </section>
    </div>
    <details className={styles.details}><summary><span><CircleHelp size={16}/>Puanın ayrıntıları</span><ChevronDown size={16}/></summary><div className={styles.detailsBody}>
      <div className={styles.tableWrap}><table><caption>0–100 aralığında puan bileşenleri</caption><thead><tr><th scope="col">Bileşen</th><th scope="col">Sen</th><th scope="col">Nova</th><th scope="col">Ağırlık</th></tr></thead><tbody>{keys.map(key => <tr key={key}><th scope="row">{names[key]}</th><td>{number(race.user.components[key])}</td><td>{number(race.nova.components[key])}</td><td>{race.user.weights[key] > 0 ? `%${number(race.user.weights[key] * 100)}` : 'Katılmıyor'}</td></tr>)}<tr><th scope="row">Doğruluk</th><td>{race.userMetrics.accuracyPercent === null ? 'Kayıt yok' : `%${number(race.userMetrics.accuracyPercent)}`}</td><td>{race.novaMetrics.accuracyPercent === null ? 'Kayıt yok' : `%${number(race.novaMetrics.accuracyPercent)}`}</td><td>{race.userMetrics.accuracyPercent === null || race.novaMetrics.accuracyPercent === null ? 'Katılmıyor' : 'Soru bileşeninde'}</td></tr></tbody></table></div>
      <p>Soru doğruluğu kaydedilmemişse iki tarafta da puana katılmaz. Ağırlıklar ürün tercihidir; bilimsel başarı tahmini değildir.</p><p>Nova’nın günü sabah dondurulur; bugün seni yakalamak için yeniden yazılmaz.</p>
    </div></details>
    <details className={styles.details}><summary><span><CalendarDays size={16}/>Yakın günleri gör</span><ChevronDown size={16}/></summary><div className={styles.detailsBody}><ul className={styles.history}>{[...data.weekly].sort((a, b) => b.localDate.localeCompare(a.localDate)).map(day => <li key={day.localDate}><strong>{day.localDate}</strong><span>Sen {number(day.userScore)} · Nova {number(day.novaScore)}</span><small>{day.finalized ? 'Kesinleşti' : 'Gün sürüyor'}</small></li>)}</ul><p>Son yedi kayıtlı tarihte, iki tarafın da puanı bulunan kesinleşmiş günlerin toplamı; en fazla 700 puan.</p></div></details>
  </section>;
}
