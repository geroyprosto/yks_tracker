import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateExamResults, calculatePerformanceScore, calculateSectionResult} from '../src/lib/exam-results';
import type {ExamFormat} from '../src/lib/domain/types';

const format: ExamFormat = {
  code: 'TYT', version: 1, label: 'TYT', total_questions: 120, wrong_divisor: 4,
  sections: [
    {key: 'turkce', label: 'Türkçe', question_count: 40},
    {key: 'matematik', label: 'Matematik', question_count: 40},
    {key: 'sosyal', label: 'Sosyal', question_count: 20},
    {key: 'fen', label: 'Fen', question_count: 20},
  ],
};

test('dersin boşunu ve netini doğru ve yanlıştan hesaplar', () => {
  assert.deepEqual(calculateSectionResult(format.sections[0], {correct: 10, wrong: 5}, 4), {
    section_key: 'turkce', correct: 10, wrong: 5, blank: 25, net: 8.75,
  });
});

test('boş bırakılan dersleri sıfır doğru ve yanlışla toplama katar', () => {
  const result = calculateExamResults(format, {turkce: {correct: 10, wrong: 5}});
  assert.equal(result.sections.find(section => section.section_key === 'matematik')?.blank, 40);
  assert.equal(result.totalNet, 8.75);
  assert.equal(result.score, 129.17);
});

test('dersin soru sayısını aşan doğru ve yanlışı reddeder', () => {
  assert.throws(() => calculateSectionResult(format.sections[0], {correct: 36, wrong: 5}, 4), /40 soruyu aşamaz/);
  assert.throws(() => calculateSectionResult(format.sections[0], {correct: 10.5, wrong: 0}, 4));
});

test('performans puanı kayıtlı toplam netten tekrar türetilebilir', () => {
  assert.equal(calculatePerformanceScore(27.75, 80), 238.75);
  assert.equal(calculatePerformanceScore(-20, 80), 0);
});
