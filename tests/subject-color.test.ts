import assert from 'node:assert/strict';
import test from 'node:test';
import {subjectColor} from '../src/lib/subject-color';

test('each requested lesson keeps the same color with exam prefixes', () => {
  assert.equal(subjectColor('TYT Matematik'), 'red');
  assert.equal(subjectColor('AYT Fizik'), 'purple');
  assert.equal(subjectColor('Kimya'), 'blue');
  assert.equal(subjectColor('Biyoloji'), 'green');
  assert.equal(subjectColor('TYT Sosyal Bilimler'), 'yellow');
});

test('Turkish casing, accents and numbered course names identify the lesson', () => {
  assert.equal(subjectColor('  AYT FİZİK 2  '), 'purple');
  assert.equal(subjectColor('BİYOLOJİ'), 'green');
  assert.equal(subjectColor('BIYOLOJI'), 'green');
  assert.equal(subjectColor('Tu\u0308rkc\u0327e'), 'yellow');
  assert.equal(subjectColor('Geometri / TYT'), 'red');
});

test('social studies and Turkish reading courses share yellow', () => {
  for (const subject of ['Paragraf', 'Türkçe', 'Türk Dili ve Edebiyatı', 'Edebiyat',
    'Tarih 1', 'Coğrafya 2', 'Felsefe', 'Din Kültürü ve Ahlak Bilgisi', 'Dil bilgisi']) {
    assert.equal(subjectColor(subject), 'yellow', subject);
  }
});

test('missing or unrelated lessons remain uncolored', () => {
  for (const subject of [null, undefined, '', '  ', 'İngilizce', 'Plansız', 'Fiziksel Aktivite']) {
    assert.equal(subjectColor(subject), undefined, String(subject));
  }
});
