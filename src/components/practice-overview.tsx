'use client';
import { useState } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import type { AppState } from '@/lib/domain/types';
import { summarizePractice } from '@/lib/practice-summary';
import { localDate, type CommandFn } from '@/lib/ui';
import { Card } from './primitives';
import { Modal } from './modal';
import { PracticeEntryForm } from './practice-entry-form';

export function PracticeOverview({ state, preview, command, busy, onOpen }: { state: AppState; preview: boolean; command: CommandFn; busy: boolean; onOpen: () => void }) {
  const [adding, setAdding] = useState(false);
  const today = localDate(Date.parse(state.server_now), state.settings?.timezone ?? 'Europe/Istanbul');
  const summary = summarizePractice(state.practice_entries ?? [], today, 'day');
  const subjects = summary.subjectRows;
  const maximumQuestions = Math.max(1, ...subjects.map(subject => subject.questionCount));
  const maximumTests = Math.max(1, ...subjects.map(subject => subject.testCount));
  const writable = state.authenticated && !preview;

  return <><Card className="insight-card practice-overview-card" title="Soru ve testlerin" eyebrow="BUGÜN · ÇÖZÜM TAKİBİ" action={<button type="button" className="button small primary practice-overview-add" disabled={!writable || busy} onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true"/>Kayıt ekle</button>}>
    {preview && <span className="practice-preview-badge">Örnek veri</span>}
    <div className="practice-overview-totals" aria-label={`Bugün ${summary.totalQuestions} soru ve ${summary.totalTests} test`}>
      <div><strong>{summary.totalQuestions.toLocaleString('tr-TR')}</strong><span>soru</span></div>
      <div><strong>{summary.totalTests.toLocaleString('tr-TR')}</strong><span>test</span></div>
    </div>
    {subjects.length ? <div className="practice-overview-subjects" aria-label="Bugün derslere göre çözümler">
      {subjects.slice(0, 3).map(subject => <div className="practice-overview-subject" key={subject.key}>
        <div><span>{subject.exam ? `${subject.exam} · ` : ''}{subject.subject}</span><strong>{subject.questionCount} soru · {subject.testCount} test</strong></div>
        <div className="practice-overview-bars">
          {summary.totalQuestions > 0 && <div className="practice-overview-bar"><small>Soru</small><div className="practice-overview-track" role="img" aria-label={`${subject.subject}: ${subject.questionCount} soru`}><span style={{ width: `${100 * subject.questionCount / maximumQuestions}%` }}/></div></div>}
          {summary.totalTests > 0 && <div className="practice-overview-bar practice-overview-test"><small>Test</small><div className="practice-overview-track" role="img" aria-label={`${subject.subject}: ${subject.testCount} test`}><span style={{ width: `${100 * subject.testCount / maximumTests}%` }}/></div></div>}
        </div>
      </div>)}
      {subjects.length > 3 && <span className="practice-overview-more">+{subjects.length - 3} ders daha</span>}
    </div> : <p className="practice-overview-empty">Bugün için soru veya test kaydı yok. Kayıt ekle ile başla.</p>}
    <button type="button" className="practice-overview-link" onClick={onOpen}>Gün · hafta · ay analizi <ArrowUpRight size={16}/></button>
  </Card>
    {adding && <Modal title="Yeni çözüm kaydı" onClose={() => setAdding(false)}>
      <PracticeEntryForm state={state} entry={null} date={today} today={today} busy={busy} writable={writable} onCancel={() => setAdding(false)} onSave={async payload => {
        if (await command('practice.create', payload)) setAdding(false);
      }}/>
    </Modal>}
  </>;
}
