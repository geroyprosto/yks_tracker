'use client';
import type {NovaWebState} from '@/lib/nova/web-types';
import {number, type Command} from './view-utils';
import styles from './workspace.module.css';

export function NovaLab({data, command, busy}: {data: NovaWebState; command: Command; busy: boolean}) {
  const baseline = data.profile.baseline;
  return <div className={styles.lab}>
    <section className="card">
      <h2>Nova’nın çalışma ritmi</h2>
      <p className="subtle">Nova’nın günü çalışma, mola ve dinlenme saatlerinden oluşan bir simülasyondur. Günün planı hazırlandıktan sonra bugünkü puanına göre yeniden yazılmaz.</p>
      <p className={styles.smallNote}>Tamamlanan çalışmalar ve ruh hâli Nova Bugün’de, gerçek kayıtlarınla karşılaştırma Yarış’ta görünür.</p>
    </section>
    <section className="card">
      <h2>Başlangıç seviyesi</h2>
      <p className="subtle">Son çalışma kayıtların Nova’nın başlangıç temposunu belirler. Simülasyon sonuçları kendi çalışma kayıtlarına eklenmez.</p>
      <dl className={styles.diagnostics}>
        <dt>Kayıt aralığı</dt><dd>{baseline.windowStart} – {baseline.windowEndExclusive} (son tarih hariç)</dd>
        <dt>Gözlenen gün</dt><dd>{number(baseline.observedDays)}</dd>
        <dt>Aktif gün</dt><dd>{number(baseline.activeDays)}</dd>
        <dt>Ortalama çalışma</dt><dd>{number(baseline.averageStudyMinutes)}{baseline.averageStudyMinutes !== null && ' dk / gün'}</dd>
        <dt>Günlük çalışma hedefi</dt><dd>{number(baseline.dailyTargetMinutes)}{baseline.dailyTargetMinutes !== null && ' dk'}</dd>
        <dt>Ortalama soru</dt><dd>{number(baseline.averageQuestions)}{baseline.averageQuestions !== null && ' / gün'}</dd>
      </dl>
      {baseline.missingData.length > 0 && <details>
        <summary>Eksik çalışma verileri</summary>
        <ul>{baseline.missingData.map(item => <li key={item}>{item}</li>)}</ul>
        <p>Yarış yalnızca iki tarafta da bulunan ölçümleri kullanır; eksik kayıt sıfır başarı sayılmaz.</p>
      </details>}
    </section>
    <section className="card">
      <h2>Yarışın temposu</h2>
      <p className="subtle">İki tarafın da puanı bulunan yedi tamamlanmış gün oluştuğunda Nova’nın temposu haftalık sonuçlara göre ayarlanabilir. Değişim sonraki günlerin planlarına uygulanır.</p>
      <label className={styles.adaptationSetting}>
        Haftalık tempo değişimi sınırı
        <select value={data.settings.weekly_adaptation_limit} disabled={busy} onChange={event => void command({operation: 'settings', settings: {weekly_adaptation_limit: Number(event.target.value)}})}>
          {Array.from({length: 6}, (_, percent) => <option key={percent} value={percent / 100}>{percent === 0 ? 'Sabit tempo' : `En fazla %${percent}`}</option>)}
        </select>
      </label>
      <p className={styles.smallNote}>Mevcut sınır: %{number(data.settings.weekly_adaptation_limit * 100)}. Bugünün planı bu ayarla değişmez.</p>
    </section>
    <details className="card">
      <summary>Simülasyon kaydı ve ham durum</summary>
      <dl className={styles.diagnostics}>
        <dt>Motor sürümü</dt><dd>{data.dayInfo?.engineVersion ?? data.profile.engine_version}</dd>
        <dt>Gün tohumu</dt><dd>{data.dayInfo?.seed ?? 'Henüz yok'}</dd>
        <dt>Yerel gün</dt><dd>{data.dayInfo?.localDate ?? 'Henüz yok'}</dd>
        <dt>Saat dilimi</dt><dd>{data.settings.timezone}</dd>
      </dl>
      <pre>{JSON.stringify({durum: data.today?.state, nedenler: data.today?.reasonCodes, olaylar: data.today?.timeline}, null, 2)}</pre>
      <p className="subtle">Planlanan olayların sonuçları tamamlanmadan gösterilmez. Durum sayıları oyun parametreleridir.</p>
    </details>
  </div>;
}
