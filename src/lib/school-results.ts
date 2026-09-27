import type {CourseExamResult, EducationCourse} from './education';

export const assessmentTypes = ['Yazılı', 'Vize', 'Final', 'Kısa sınav', 'Ödev / proje', 'Diğer'] as const;
export type ResultDraft = {course_id: string; score: string; scale: string; exam_date: string; assessment_type: string; assessment_name: string};
export type ResultInput = Omit<ResultDraft, 'score' | 'scale'> & {score: number; scale: number};
export type ResultIssue = {row: number; message: string};

/** A blank mark is unknown, while a written zero is a real result. */
export function parseSchoolNumber(value: string): number | null {
  const text = value.trim();
  if (!text || !/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function schoolDate(value: string): string | null {
  const text = value.trim();
  const local = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const iso = local ? `${local[3]}-${local[2]}-${local[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function validateResultDrafts(drafts: ResultDraft[], allowedCourseIds: ReadonlySet<string>): {rows: ResultInput[]; issues: ResultIssue[]} {
  const rows: ResultInput[] = [], issues: ResultIssue[] = [];
  drafts.forEach((draft, row) => {
    if (!draft.score.trim()) return;
    const score = parseSchoolNumber(draft.score), scale = parseSchoolNumber(draft.scale), date = schoolDate(draft.exam_date);
    let message = '';
    if (!allowedCourseIds.has(draft.course_id)) message = 'Bu satır için dönemindeki dersi seç.';
    else if (scale === null || scale <= 0 || scale > 1000000) message = 'Ölçek 0’dan büyük, en fazla 1.000.000 olmalı.';
    else if (score === null || score < 0 || score > scale) message = `Puan 0 ile ${draft.scale} arasında olmalı.`;
    else if (!date) message = 'Geçerli bir sınav tarihi gir.';
    else if (!draft.assessment_type.trim() || draft.assessment_type.length > 80) message = 'Değerlendirme türünü seç.';
    else if (draft.assessment_name.length > 160) message = 'Sınav adı en fazla 160 karakter olabilir.';
    if (message) issues.push({row, message});
    else rows.push({...draft, score: score!, scale: scale!, exam_date: date!, assessment_type: draft.assessment_type.trim(), assessment_name: draft.assessment_name.trim()});
  });
  return {rows, issues};
}

export function normalizeSchoolCourseName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR');
}

export function matchSchoolCourses(name: string, courses: EducationCourse[]): EducationCourse[] {
  const normalized = normalizeSchoolCourseName(name);
  return normalized ? courses.filter(course => course.context === 'school' && normalizeSchoolCourseName(course.name) === normalized) : [];
}

export type TableDelimiter = '\t' | ';' | ',';
export type ParsedSchoolTable = {rows: string[][]; delimiter: TableDelimiter};

/** RFC-style quoted cells, including escaped quotes and embedded line breaks. Never split decimal commas blindly. */
function parseDelimited(text: string, delimiter: TableDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, afterQuote = false;
  function finishCell() {row.push(cell.trim()); cell = ''; afterQuote = false;}
  function finishRow() {finishCell(); if (row.some(value => value !== '')) rows.push(row); row = [];}
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {cell += '"'; index++;}
      else if (char === '"') {quoted = false; afterQuote = true;}
      else cell += char;
      continue;
    }
    if (char === delimiter) {finishCell(); continue;}
    if (char === '\n' || char === '\r') {finishRow(); if (char === '\r' && text[index + 1] === '\n') index++; continue;}
    if (char === '"' && !cell.trim() && !afterQuote) {cell = ''; quoted = true; continue;}
    if (afterQuote && char.trim()) throw new Error('Kapanan tırnaktan sonra ayraç bekleniyor. CSV biçimini kontrol et.');
    if (char === '"') throw new Error('Hücre içindeki tırnakları çift tırnakla kaçır: "".');
    cell += char;
  }
  if (quoted) throw new Error('Bir hücrenin kapanış tırnağı eksik.');
  finishRow();
  return rows;
}

export function parseSchoolTable(raw: string, selectedDelimiter?: TableDelimiter): ParsedSchoolTable {
  if (raw.length > 200000) throw new Error('Tek aktarımda en fazla 200.000 karakter kullanılabilir.');
  const text = raw.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('Önce ders ve puan satırlarını yapıştır.');
  let delimiter = selectedDelimiter;
  if (!delimiter) {
    const candidates = (['\t', ';', ','] as const).flatMap(value => {
      try {
        const rows = parseDelimited(text, value);
        const width = rows[0]?.length ?? 0;
        return width > 1 && rows.every(row => row.length === width) ? [{value, width}] : [];
      } catch {return [];}
    });
    delimiter = candidates[0]?.value;
    if (!delimiter) throw new Error('Ayraç güvenle belirlenemedi. Sekme, noktalı virgül veya virgül seç; ondalık virgülleri tırnak içine al.');
  }
  const rows = parseDelimited(text, delimiter);
  if (rows.length > 101) throw new Error('Tek aktarımda en fazla 100 sonuç ve bir başlık satırı kullanılabilir.');
  if ((rows[0]?.length ?? 0) < 2) throw new Error('En az ders ve puan sütunları gerekli.');
  if (rows.some(row => row.length !== rows[0].length)) throw new Error('Satırların sütun sayıları farklı. Virgüllü puanlar için sekme / noktalı virgül kullan veya puanı tırnak içine al.');
  if (rows[0].length > 30) throw new Error('Tek aktarımda en fazla 30 sütun kullanılabilir.');
  if (!selectedDelimiter && delimiter === ',' && rows[0].length === 3 && rows.every(row => /^\d+$/.test(row[1]) && /^\d+$/.test(row[2]))) {
    throw new Error('Virgül hem ayraç hem ondalık olabilir. Ondalıklı puanları tırnak içine al; gerçekten üç sütun varsa virgül ayracını açıkça seç ve sütunları eşleştir.');
  }
  return {rows, delimiter};
}

export type SchoolColumnMap = {course: number; score: number; scale: number; date: number; type: number; name: number};
export function suggestSchoolColumns(rows: string[][]): {header: boolean; columns: SchoolColumnMap} {
  const first = rows[0].map(normalizeSchoolCourseName);
  const find = (names: string[]) => first.findIndex(cell => names.includes(cell));
  const course = find(['ders', 'ders adı', 'course']), score = find(['puan', 'not', 'score']);
  return {header: course >= 0 && score >= 0, columns: {
    course: course >= 0 ? course : 0, score: score >= 0 ? score : 1,
    scale: find(['ölçek', 'üzerinden', 'scale']), date: find(['tarih', 'sınav tarihi', 'date']),
    type: find(['tür', 'sınav türü', 'type']), name: find(['sınav adı', 'değerlendirme adı', 'name']),
  }};
}

export type SchoolResultFilters = {course: string; term: string; start: string; end: string; type: string};
export function filterSchoolResults(results: CourseExamResult[], filters: SchoolResultFilters): CourseExamResult[] {
  return results.filter(result => (!filters.course || result.course_id === filters.course)
    && (!filters.term || result.term_id === filters.term)
    && (!filters.start || result.exam_date >= filters.start) && (!filters.end || result.exam_date <= filters.end)
    && (!filters.type || result.assessment_type === filters.type))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function schoolResultSummary(results: CourseExamResult[], percent: boolean) {
  const latest = results.at(-1), previous = results.at(-2);
  const sameSeries = Boolean(latest && previous && latest.course_id === previous.course_id && latest.term_id === previous.term_id
    && latest.assessment_type === previous.assessment_type && latest.assessment_name === previous.assessment_name
    && (percent || latest.scale === previous.scale));
  const value = (result: CourseExamResult) => percent ? result.score / result.scale * 100 : result.score;
  return {latest, count: results.length, mixedScale: new Set(results.map(result => result.scale)).size > 1,
    difference: sameSeries ? value(latest!) - value(previous!) : null,
    differenceLabel: percent ? 'yüzde puan' : 'puan'};
}
