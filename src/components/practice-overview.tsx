'use client';
import { BarChart3, ArrowUpRight } from 'lucide-react';
import type { AppState } from '@/lib/domain/types';
import { localDate } from '@/lib/ui';
import { Card } from './primitives';

export function PracticeOverview({ state, preview, onOpen }: { state: AppState; preview: boolean; onOpen: () => void }) {
  const today = localDate(Date.parse(state.server_now), state.settings?.timezone ?? 'Europe/Istanbul');
  const entries = (state.practice_entries ?? []).filter(entry => entry.practice_date === today);
  const questions = entries.reduce((total, entry) => total + entry.question_count, 0);
  const tests = entries.reduce((total, entry) => total + entry.test_count, 0);
  const subjects = Array.from(entries.reduce((map, entry) => {
    const label = `${entry.exam} · ${entry.subject}`;
    const previous = map.get(label) ?? { label, questions: 0, tests: 0 };
    map.set(label, { label, questions: previous.questions + entry.question_count, tests: previous.tests + entry.test_count });
    return map;
  }, new Map<string, { label: string; questions: number; tests: number }>()).values())
    .sort((left, right) => right.questions - left.questions || right.tests - left.tests);
  const maximum = Math.max(1, ...subjects.map(subject => subject.questions));

  return <Card className="insight-card practice-overview-card" title="Soru ve testlerin" eyebrow="BUGÜN · ÇÖZÜM TAKİBİ" action={<BarChart3 size={20} className="muted-icon"/>}>
    {preview && <span className="practice-preview-badge">Örnek veri</span>}
    <div className="practice-overview-totals" aria-label={`Bugün ${questions} soru ve ${tests} test`}>
      <div><strong>{questions.toLocaleString('tr-TR')}</strong><span>soru</span></div>
      <div><strong>{tests.toLocaleString('tr-TR')}</strong><span>test</span></div>
    </div>
    {subjects.length ? <div className="practice-overview-subjects" aria-label="Bugün derslere göre çözümler">
      {subjects.slice(0, 3).map(subject => <div className="practice-overview-subject" key={subject.label}>
        <div><span>{subject.label}</span><strong>{subject.questions} soru · {subject.tests} test</strong></div>
        <div className="practice-overview-track"><span style={{ width: `${Math.max(4, 100 * subject.questions / maximum)}%` }}/></div>
      </div>)}
      {subjects.length > 3 && <span className="practice-overview-more">+{subjects.length - 3} ders daha</span>}
    </div> : <p className="practice-overview-empty">Bugün için soru veya test kaydı yok. İlk çözümünü ekleyerek başla.</p>}
    <button className="practice-overview-link" onClick={onOpen}>Gün · hafta · ay analizi <ArrowUpRight size={16}/></button>
  </Card>;
}
