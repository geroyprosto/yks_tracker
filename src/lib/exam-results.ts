import type {ExamFormat, ExamSectionFormat} from './domain/types';

export type AnswerCounts = {correct: number; wrong: number};

export function calculatePerformanceScore(totalNet: number, totalQuestions: number) {
  if (!Number.isFinite(totalNet) || !Number.isInteger(totalQuestions) || totalQuestions <= 0) {
    throw new Error('Geçerli bir toplam net ve soru sayısı gerekli.');
  }
  // This is an in-app 0–500 performance index, not an ÖSYM exam or placement score.
  return Math.round(Math.max(0, Math.min(500, 100 + 400 * totalNet / totalQuestions)) * 100) / 100;
}

export function calculateSectionResult(
  section: ExamSectionFormat,
  counts: AnswerCounts,
  wrongDivisor: number,
) {
  const {correct, wrong} = counts;
  if (!Number.isInteger(correct) || !Number.isInteger(wrong) || correct < 0 || wrong < 0 || correct + wrong > section.question_count) {
    throw new Error(`${section.label}: doğru ve yanlış toplamı ${section.question_count} soruyu aşamaz.`);
  }
  return {
    section_key: section.key,
    correct,
    wrong,
    blank: section.question_count - correct - wrong,
    net: correct - wrong / wrongDivisor,
  };
}

export function calculateExamResults(format: ExamFormat, answers: Record<string, AnswerCounts>) {
  if (format.total_questions <= 0 || format.wrong_divisor <= 0) {
    throw new Error('Geçerli bir deneme türü ve soru sayısı seç.');
  }
  const sections = format.sections.map(section => calculateSectionResult(
    section,
    answers[section.key] ?? {correct: 0, wrong: 0},
    format.wrong_divisor,
  ));
  const totalNet = sections.reduce((sum, section) => sum + section.net, 0);
  const score = calculatePerformanceScore(totalNet, format.total_questions);
  return {sections, totalNet, score};
}
