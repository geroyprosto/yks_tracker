import type { AgentContext } from './agent';
import type { NovaProjection, NovaVisibleEvent } from './types';

const workKinds = new Set(['study', 'questions', 'exam', 'analysis']);

/** Trusted qualitative sentences, derived from completed simulation events only. */
export function completedEventSentence(event: NovaVisibleEvent): string {
  const subject = event.subject && event.subject !== 'Genel'
    ? `${event.subject.slice(0, 100)} üzerine ` : '';
  switch (event.kind) {
    case 'study': return `${subject}konu çalışması yaptım.`;
    case 'questions': return `${subject}soru çözdüm.`;
    case 'exam': return `${subject}simüle bir deneme çözdüm.`;
    case 'analysis': return `${subject}yanlışlarımı gözden geçirdim.`;
    case 'wake': return 'Uyanıp hazırlandım.';
    case 'breakfast': return 'Kahvaltı yaptım.';
    case 'commute': return 'Yürüyüş ve ulaşım için ayırdığım bölüm geride kaldı.';
    case 'routine': return 'Günlük rutinimi tamamladım.';
    case 'meal': return `${event.label} için ara verdim.`;
    case 'rest': return 'Biraz dinlendim.';
    case 'distraction': return 'Dikkatim dağıldı; toparlanmak için ara verdim.';
    case 'free_time': return 'Kendime serbest zaman ayırdım.';
    case 'reflection': return 'Günümü gözden geçirdim.';
    case 'sleep': return 'Uyudum.';
  }
}

export function conversationEventFacts(projection: NovaProjection, question: string): AgentContext['facts'] {
  const completed = projection.timeline.filter(event => event.status === 'completed');
  const asksAboutDay = /bugün|neler|ne yapt|çalış|ders|soru|deneme/iu.test(question);
  const chosen = asksAboutDay
    ? [...completed.filter(event => workKinds.has(event.kind)).slice(-3), ...completed.filter(event => !workKinds.has(event.kind)).slice(-3)]
    : completed.slice(-1);
  return chosen.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .filter((event, index, events) => events.findIndex(other => completedEventSentence(other) === completedEventSentence(event)) === index)
    .map(event => ({ id: event.id, kind: 'event', text: completedEventSentence(event).replace(/^./u, letter => letter.toLocaleUpperCase('tr-TR')) }));
}
