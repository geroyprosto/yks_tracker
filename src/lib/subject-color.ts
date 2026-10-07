export type SubjectColor = 'red' | 'purple' | 'blue' | 'green' | 'yellow';

export function subjectColor(subject: string | null | undefined): SubjectColor | undefined {
  if (!subject) return undefined;
  const normalized = subject.toLocaleLowerCase('tr-TR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
  if (/\b(matematik|geometri)\b/.test(normalized)) return 'red';
  if (/\bfizik\b/.test(normalized)) return 'purple';
  if (/\bkimya\b/.test(normalized)) return 'blue';
  if (/\bbiyoloji\b/.test(normalized)) return 'green';
  if (/\b(turkce|turk dili|edebiyat|edebiyati|paragraf|sosyal|tarih|cografya|felsefe|din|mantik|psikoloji|sosyoloji|dil bilgisi)\b/.test(normalized)) return 'yellow';
  return undefined;
}
