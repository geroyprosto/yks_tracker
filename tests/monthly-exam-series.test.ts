import assert from 'node:assert/strict';
import test from 'node:test';
import {monthlyExamSeries} from '../src/lib/monthly-exam-series';
import type {ExamRecord} from '../src/lib/domain/types';

type ExamNet = Pick<ExamRecord, 'exam_date' | 'format_code' | 'total_net'>;

test('monthly exam series plots real net results by date and format', () => {
  const exams: ExamNet[] = [
    {exam_date: '2026-09-19', format_code: 'TYT', total_net: 62},
    {exam_date: '2026-09-04', format_code: 'TYT', total_net: 40},
    {exam_date: '2026-09-04', format_code: 'TYT', total_net: 50},
    {exam_date: '2026-09-07', format_code: 'TYT', total_net: null},
    {exam_date: '2026-09-12', format_code: 'AYT_SAYISAL', total_net: 35},
    {exam_date: '2026-08-20', format_code: 'TYT', total_net: 71},
  ];
  assert.deepEqual(monthlyExamSeries(exams, '2026-09', 'TYT'), [
    {date: '2026-09-04', net: 45, count: 2},
    {date: '2026-09-19', net: 62, count: 1},
  ]);
  assert.deepEqual(monthlyExamSeries(exams, '2026-09', 'BRANCH'), []);
});
