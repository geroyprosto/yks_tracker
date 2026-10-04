import type {AppState, DayMark, ExamFormat, ExamRecord, ExamSectionResult, JournalEntry, PracticeEntry, Task, TaskStep, Topic} from './domain/types';

type DraftResult = {section_key: string; correct?: number; wrong?: number; blank?: number; net?: number};
function examResults(format: ExamFormat, input: DraftResult[]): ExamSectionResult[] {
  return format.sections.flatMap<ExamSectionResult>(section => {
    const value = input.find(item => item.section_key === section.key);
    if (!value) return [];
    if (typeof value.net === 'number') return [{section_key: section.key, correct: null, wrong: null, blank: null, net: value.net}];
    const correct = value.correct ?? 0, wrong = value.wrong ?? 0;
    return [{section_key: section.key, correct, wrong,
      blank: value.blank ?? section.question_count - correct - wrong,
      net: correct - wrong / format.wrong_divisor}];
  });
}
function examTotal(format: ExamFormat, results: ExamSectionResult[], reported: number | null) {
  const computed = results.length === format.sections.length ? results.reduce((sum, row) => sum + row.net, 0) : null;
  return {total_net: computed ?? reported,
    total_net_source: computed !== null ? 'sections' as const : reported !== null ? 'reported' as const : null};
}

/** Preview a single owner command while its receipt and authoritative state are in flight. */
export function optimisticCommand(
  state: AppState, type: string, payload: Record<string, unknown>, provisionalId: string, now: string,
): AppState | null {
  if (type === 'task.create') {
    if (typeof payload.title !== 'string' || typeof payload.plan_date !== 'string') return null;
    const steps = (payload.steps as TaskStep[] | undefined) ?? [];
    const sameDay = state.tasks.filter(task => task.plan_date === payload.plan_date);
    const task: Task = {
      id: provisionalId, title: payload.title, plan_date: payload.plan_date,
      course_id: (payload.course_id as string | null | undefined) ?? null,
      exam: (payload.exam as Task['exam']) ?? null, subject: (payload.subject as string | null) ?? null,
      topic_id: (payload.topic_id as string | null) ?? null,
      resource: (payload.resource as string) ?? '', completion_criteria: (payload.completion_criteria as string) ?? '',
      planned_minutes: (payload.planned_minutes as number) ?? 30, difficulty: (payload.difficulty as Task['difficulty']) ?? 'medium',
      progress: steps.length ? steps.filter(step => step.completed).length / steps.length : (payload.progress as number) ?? 0,
      weight_override: (payload.weight_override as number | null) ?? null,
      priority: (payload.priority as Task['priority']) ?? 'normal',
      position: Math.max(-1, ...sameDay.map(item => item.position)) + 1,
      notes: (payload.notes as string) ?? '', study_type: (payload.study_type as Task['study_type']) ?? 'Soru çözümü',
      steps, revision: 1, created_at: now, updated_at: now,
    };
    return {...state, tasks: [...state.tasks, task]};
  }
  if (type === 'task.update') {
    const id = payload.id;
    if (typeof id !== 'string' || !state.tasks.some(task => task.id === id)) return null;
    const {id: _id, expected_revision: _revision, ...changes} = payload;
    void _id; void _revision;
    return {...state, tasks: state.tasks.map(task => {
      if (task.id !== id) return task;
      const steps = changes.steps as TaskStep[] | undefined;
      return {...task, ...changes, revision: task.revision + 1, updated_at: now,
        ...(steps?.length ? {progress: steps.filter(step => step.completed).length / steps.length} : {})} as Task;
    })};
  }
  if (type === 'task.delete') {
    if (typeof payload.id !== 'string') return null;
    return {...state, tasks: state.tasks.filter(task => task.id !== payload.id)};
  }
  if (type === 'task.move') {
    if (typeof payload.id !== 'string' || (payload.direction !== 'up' && payload.direction !== 'down')) return null;
    const moving = state.tasks.find(task => task.id === payload.id);
    if (!moving) return null;
    const day = state.tasks.filter(task => task.plan_date === moving.plan_date)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const from = day.findIndex(task => task.id === moving.id);
    const to = from + (payload.direction === 'up' ? -1 : 1);
    if (to < 0 || to >= day.length) return state;
    const swappedId = day[to].id;
    [day[from], day[to]] = [day[to], day[from]];
    const positions = new Map(day.map((task, index) => [task.id, index]));
    return {...state, tasks: state.tasks.map(task => {
      const position = positions.get(task.id);
      if (position === undefined || (position === task.position && task.id !== moving.id && task.id !== swappedId)) return task;
      return {...task, position, revision: task.revision + 1, updated_at: now};
    })};
  }
  if (type === 'topic.create') {
    if (typeof payload.name !== 'string' || typeof payload.subject !== 'string' ||
        (payload.exam !== 'TYT' && payload.exam !== 'AYT')) return null;
    const topic: Topic = {
      id: provisionalId, name: payload.name, subject: payload.subject, exam: payload.exam,
      parent_id: (payload.parent_id as string | null) ?? null, mastery: (payload.mastery as number) ?? 0,
      notes: (payload.notes as string) ?? '', review_requested: (payload.review_requested as boolean) ?? false,
      source: (payload.source as string) ?? '', next_step: (payload.next_step as string) ?? '',
      revision: 1, updated_at: now,
    };
    return {...state, topics: [...state.topics, topic]};
  }
  if (type === 'topic.update') {
    const id = payload.id;
    if (typeof id !== 'string' || !state.topics.some(topic => topic.id === id)) return null;
    const {id: _id, expected_revision: _revision, ...changes} = payload;
    void _id; void _revision;
    return {...state, topics: state.topics.map(topic => topic.id === id
      ? {...topic, ...changes, revision: topic.revision + 1, updated_at: now} as Topic : topic)};
  }
  if (type === 'practice.create') {
    if (typeof payload.practice_date !== 'string' || typeof payload.question_count !== 'number' ||
        typeof payload.test_count !== 'number') return null;
    const course = state.education?.courses.find(item => item.id === payload.course_id);
    const entry: PracticeEntry = {
      id: provisionalId, practice_date: payload.practice_date,
      course_id: (payload.course_id as string | null) ?? null,
      exam: course?.exam ?? (payload.exam as PracticeEntry['exam']) ?? null,
      subject: course?.name ?? (payload.subject as string | null) ?? null,
      question_count: payload.question_count, test_count: payload.test_count,
      revision: 1, created_at: now, updated_at: now,
    };
    return {...state, practice_entries: [...state.practice_entries, entry]};
  }
  if (type === 'practice.update') {
    const id = payload.id;
    if (typeof id !== 'string' || !state.practice_entries.some(entry => entry.id === id)) return null;
    const {id: _id, expected_revision: _revision, ...changes} = payload;
    void _id; void _revision;
    const course = state.education?.courses.find(item => item.id === changes.course_id);
    return {...state, practice_entries: state.practice_entries.map(entry => entry.id === id
      ? {...entry, ...changes,
        ...(course ? {exam: course.exam, subject: course.name} : changes.course_id === null ? {exam: null, subject: null} : {}),
        revision: entry.revision + 1, updated_at: now} as PracticeEntry : entry)};
  }
  if (type === 'practice.delete') {
    if (typeof payload.id !== 'string') return null;
    return {...state, practice_entries: state.practice_entries.filter(entry => entry.id !== payload.id)};
  }
  if (type === 'day.mark') {
    if (typeof payload.mark_date !== 'string' || (payload.kind !== 'rest' && payload.kind !== 'zero')) return null;
    const prior = state.day_marks.find(mark => mark.mark_date === payload.mark_date);
    if (prior?.kind === payload.kind) return state;
    const mark: DayMark = {id: prior?.id ?? provisionalId, mark_date: payload.mark_date, kind: payload.kind,
      revision: (prior?.revision ?? 0) + 1, created_at: prior?.created_at ?? now, updated_at: now};
    return {...state, day_marks: [...state.day_marks.filter(item => item.mark_date !== mark.mark_date), mark]};
  }
  if (type === 'day.unmark') {
    if (typeof payload.id !== 'string') return null;
    return {...state, day_marks: state.day_marks.filter(mark => mark.id !== payload.id)};
  }
  if (type === 'exam.create') {
    if (typeof payload.name !== 'string' || typeof payload.exam_date !== 'string' ||
        !Array.isArray(payload.results) || !['TYT', 'AYT_SAYISAL', 'BRANCH'].includes(String(payload.format_code))) return null;
    const format = state.exam_formats.filter(item => item.code === payload.format_code &&
      (payload.format_version === undefined || item.version === payload.format_version))
      .sort((a, b) => b.version - a.version)[0];
    if (!format) return null;
    const snapshot: ExamFormat = payload.format_code === 'BRANCH' &&
      typeof payload.branch_subject === 'string' && typeof payload.branch_question_count === 'number'
      ? {...format, label: `${payload.branch_subject.trim()} · branş denemesi`,
        total_questions: payload.branch_question_count,
        sections: [{key: 'branch', label: payload.branch_subject.trim(), question_count: payload.branch_question_count}]}
      : format;
    const results = examResults(snapshot, payload.results as DraftResult[]);
    const reported = (payload.reported_total_net as number | null) ?? null;
    const record: ExamRecord = {
      id: provisionalId, name: payload.name, publisher: (payload.publisher as string) ?? '',
      exam_date: payload.exam_date, format_code: snapshot.code, format_version: snapshot.version,
      format_snapshot: snapshot, duration_minutes: (payload.duration_minutes as number | null) ?? null,
      notes: (payload.notes as string) ?? '', score: (payload.score as number | null) ?? null,
      rank: (payload.rank as number | null) ?? null, source_document_id: null, import_metadata: null,
      results, reported_total_net: reported, ...examTotal(snapshot, results, reported),
      revision: 1, created_at: now, updated_at: now,
    };
    return {...state, exams: [...state.exams, record]};
  }
  if (type === 'exam.update') {
    const id = payload.id;
    if (typeof id !== 'string' || !state.exams.some(exam => exam.id === id)) return null;
    const {id: _id, expected_revision: _revision, results: draftResults, ...changes} = payload;
    void _id; void _revision;
    return {...state, exams: state.exams.map(exam => {
      if (exam.id !== id) return exam;
      const results = Array.isArray(draftResults) ? examResults(exam.format_snapshot, draftResults as DraftResult[]) : exam.results;
      const reported = 'reported_total_net' in changes ? changes.reported_total_net as number | null : exam.reported_total_net;
      return {...exam, ...changes, results, ...examTotal(exam.format_snapshot, results, reported),
        revision: exam.revision + 1, updated_at: now} as ExamRecord;
    })};
  }
  if (type === 'exam.delete') {
    if (typeof payload.id !== 'string') return null;
    return {...state, exams: state.exams.filter(exam => exam.id !== payload.id)};
  }
  if (type === 'journal.create') {
    if (typeof payload.journal_date !== 'string' || typeof payload.original_text !== 'string' ||
        state.journal_entries.some(entry => entry.journal_date === payload.journal_date)) return null;
    const entry: JournalEntry = {
      id: provisionalId, journal_date: payload.journal_date, original_text: payload.original_text,
      structured_fields: (payload.structured_fields as JournalEntry['structured_fields']) ?? {},
      exclude_from_analysis: (payload.exclude_from_analysis as boolean) ?? false,
      ai_shared_fields: (payload.ai_shared_fields as string[]) ?? [],
      revision: 1, created_at: now, updated_at: now,
    };
    return {...state, journal_entries: [...state.journal_entries, entry]};
  }
  if (type === 'journal.update') {
    const id = payload.id;
    if (typeof id !== 'string' || !state.journal_entries.some(entry => entry.id === id)) return null;
    const {id: _id, expected_revision: _revision, ...changes} = payload;
    void _id; void _revision;
    return {...state, journal_entries: state.journal_entries.map(entry => entry.id === id
      ? {...entry, ...changes, revision: entry.revision + 1, updated_at: now} as JournalEntry : entry)};
  }
  if (type === 'journal.delete') {
    if (typeof payload.id !== 'string') return null;
    return {...state, journal_entries: state.journal_entries.filter(entry => entry.id !== payload.id)};
  }
  if (type === 'settings.update') {
    if (!state.settings) return null;
    const {expected_revision: _revision, ...changes} = payload;
    void _revision;
    return {...state, settings: {...state.settings, ...changes, revision: state.settings.revision + 1}} as AppState;
  }
  if (type === 'settings.journal_analysis.set') {
    if (!state.settings || typeof payload.enabled !== 'boolean') return null;
    return {...state, settings: {...state.settings, journal_analysis_enabled: payload.enabled,
      revision: state.settings.revision + 1}};
  }
  if (type === 'manual_study.create') {
    if (typeof payload.study_date !== 'string' || typeof payload.minutes !== 'number') return null;
    const course = state.education?.courses.find(item => item.id === payload.course_id);
    return {...state, manual_study_entries: [...(state.manual_study_entries ?? []), {
      id: provisionalId, study_date: payload.study_date,
      course_id: (payload.course_id as string | null) ?? null,
      subject: course?.name ?? (payload.subject as string) ?? '',
      duration_seconds: payload.minutes * 60, created_at: now,
    }]};
  }
  return null;
}
