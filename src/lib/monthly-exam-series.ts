import type {ExamFormatCode, ExamRecord} from './domain/types';

export type MonthlyExamPoint = {date: string; net: number; count: number};

type ExamNet = Pick<ExamRecord, 'exam_date' | 'format_code' | 'total_net'>;

/** One plotted point per day. Several results on the same date use their mean net. */
export function monthlyExamSeries(
  exams: readonly ExamNet[],
  month: string,
  format: ExamFormatCode,
): MonthlyExamPoint[] {
  const byDay = new Map<string, {sum: number; count: number}>();
  for (const exam of exams) {
    if (exam.format_code !== format || !exam.exam_date.startsWith(`${month}-`)) continue;
    if (exam.total_net === null || !Number.isFinite(exam.total_net)) continue;
    const bucket = byDay.get(exam.exam_date) ?? {sum: 0, count: 0};
    bucket.sum += exam.total_net;
    bucket.count += 1;
    byDay.set(exam.exam_date, bucket);
  }
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, {sum, count}]) => ({date, net: sum / count, count}));
}
