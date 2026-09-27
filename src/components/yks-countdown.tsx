'use client';

import { useEffect, useState } from 'react';
import { Card } from './primitives';
import { formatDay, localDate } from '@/lib/ui';
import { addCalendarDays, countdownParts, istanbulDayStart } from '@/lib/yks-countdown';

type Clock = { now: number; sampleDate: string };

type Props = {
  examDate: string | null;
  preview: boolean;
  examYear: number;
  onSetDate: () => void;
};

export function YksCountdown({ examDate, preview, examYear, onSetDate }: Props) {
  const [clock, setClock] = useState<Clock | null>(null);

  useEffect(() => {
    if (!examDate && !preview) return;
    // The first server and client render both show placeholders; the browser
    // supplies its current instant only after hydration to avoid a time mismatch.
    const sampleDate = addCalendarDays(localDate(), 180) ?? '';
    const tick = () => setClock({ now: Date.now(), sampleDate });
    const animation = window.requestAnimationFrame(tick);
    const interval = window.setInterval(tick, 1000);
    return () => {
      window.cancelAnimationFrame(animation);
      window.clearInterval(interval);
    };
  }, [examDate, preview]);

  const sample = !examDate && preview;
  const targetDate = examDate || (sample ? clock?.sampleDate : null);
  const target = targetDate ? istanbulDayStart(targetDate) : null;
  const remaining = clock && target !== null ? countdownParts(target, clock.now) : null;
  const elapsed = clock !== null && target !== null && clock.now >= target;
  const invalidDate = Boolean(examDate) && target === null;
  const units = [
    { label: 'GÜN', value: remaining ? String(remaining.days).padStart(2, '0') : '--' },
    { label: 'SAAT', value: remaining ? String(remaining.hours).padStart(2, '0') : '--' },
    { label: 'DAKİKA', value: remaining ? String(remaining.minutes).padStart(2, '0') : '--' },
    { label: 'SANİYE', value: remaining ? String(remaining.seconds).padStart(2, '0') : '--' },
  ];

  const lead = invalidDate
    ? 'Kayıtlı sınav tarihi geçersiz. Tarihi yeniden ayarla.'
    : elapsed
      ? 'Seçtiğin sınav günü başladı.'
      : sample
        ? 'Geri sayımın nasıl görüneceğine dair bir örnek.'
        : targetDate
          ? 'Seçtiğin sınav gününe kalan zaman.'
          : 'Sınav tarihini eklediğinde geri sayım burada başlayacak.';
  const dateLabel = target !== null && targetDate
    ? formatDay(targetDate, { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Tarih bekleniyor';
  const disclosure = sample
    ? 'Örnek tarih · Resmî YKS tarihi değildir.'
    : target !== null
      ? 'İstanbul saatiyle seçtiğin günün başlangıcına kadar.'
      : 'Hedef tarihi Plan ve hedefler bölümünden belirle.';
  const accessibleTime = remaining
    ? `${remaining.days} gün, ${remaining.hours} saat, ${remaining.minutes} dakika, ${remaining.seconds} saniye`
    : 'Sınav tarihi bekleniyor';

  return <Card className="yks-countdown-card" eyebrow="YKS GERİ SAYIMI" title="Sınava kalan zaman" action={<span className="countdown-year">YKS {examYear}</span>}>
    <p className="countdown-lead">{lead}</p>
    <div className="countdown-grid" role="timer" aria-live="off" aria-label={accessibleTime}>
      {units.map(unit => <div className="countdown-unit" key={unit.label}>
        <strong className="countdown-value">{unit.value}</strong>
        <span className="countdown-label">{unit.label}</span>
      </div>)}
    </div>
    <div className="countdown-meta">
      <div><strong>{dateLabel}</strong><span>{disclosure}</span></div>
      <button className="text-button" type="button" onClick={onSetDate}>Sınav tarihini ayarla</button>
    </div>
  </Card>;
}
