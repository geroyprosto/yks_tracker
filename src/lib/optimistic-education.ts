import {educationCommandSchema, normalizeCourseName, type EducationCourse, type EducationState, type CourseExamResult} from './education';

function provisionalRowId(seed: string, index: number): string {
  if (index === 0) return seed;
  const tail = (BigInt(`0x${seed.slice(-12)}`) + BigInt(index)) & BigInt('0xffffffffffff');
  return `${seed.slice(0, -12)}${tail.toString(16).padStart(12, '0')}`;
}

/** Preview an education command until its receipt and authoritative state arrive. */
export function optimisticEducationCommand(
  state: EducationState, type: string, payload: Record<string, unknown>, provisionalId: string, now: string,
): EducationState | null {
  const parsed = educationCommandSchema.safeParse({request_id: provisionalId, type, payload});
  if (!parsed.success) return null;
  const command = parsed.data;

  if (command.type === 'result.update') {
    const {id, expected_revision, ...changes} = command.payload;
    const prior = state.results.find(result => result.id === id);
    if (!prior || prior.revision !== expected_revision) return null;
    return {...state, results: state.results.map(result => result.id === id
      ? {...result, ...changes, revision: result.revision + 1, updated_at: now} : result)};
  }

  if (command.type === 'results.batch') {
    const additions: CourseExamResult[] = [];
    for (const [index, row] of command.payload.rows.entries()) {
      const course = state.courses.find(item => item.id === row.course_id && item.context === 'school' && !item.archived);
      if (!course || !course.term_id || !state.terms.some(term => term.id === course.term_id && !term.archived)) return null;
      additions.push({
        id: provisionalRowId(provisionalId, index),
        course_id: course.id, term_id: course.term_id, course_name: course.name,
        exam_date: row.exam_date, assessment_type: row.assessment_type,
        assessment_name: row.assessment_name ?? '', score: row.score, scale: row.scale,
        revision: 1, created_at: now, updated_at: now,
      });
    }
    return {...state, results: [...state.results, ...additions]};
  }

  if (command.type === 'course.update') {
    const {id, expected_revision, name, archived} = command.payload;
    const prior = state.courses.find(course => course.id === id);
    if (!prior || prior.revision !== expected_revision) return null;
    return {...state, courses: state.courses.map(course => course.id === id ? {
      ...course, ...(name === undefined ? {} : {name, normalized_name: normalizeCourseName(name)}),
      ...(archived === undefined ? {} : {archived}), revision: course.revision + 1, updated_at: now,
    } : course)};
  }

  if (command.type === 'course.create') {
    const input = command.payload;
    const termId = input.term_id ?? null;
    if (input.context === 'school' && (!termId || !state.terms.some(term => term.id === termId && !term.archived))) return null;
    if (input.context === 'yks' && termId) return null;
    const course: EducationCourse = {
      id: input.id ?? provisionalId, term_id: termId, name: input.name,
      normalized_name: normalizeCourseName(input.name), context: input.context, exam: input.exam ?? null,
      catalog_subject: input.context === 'yks' ? input.name : null,
      archived: false, revision: 1, created_at: now, updated_at: now,
    };
    return {...state, courses: [...state.courses, course]};
  }

  if (command.type === 'term.activate') {
    const termId = command.payload.id;
    if (!state.profile || !state.terms.some(term => term.id === termId)) return null;
    return {...state,
      profile: {...state.profile, active_term_id: termId, revision: state.profile.revision + 1},
      terms: state.terms.map(term => ({...term, archived: term.id !== termId})),
    };
  }

  if (command.type === 'draft.save') {
    const {expected_revision, step, data} = command.payload;
    if ((state.draft?.revision ?? 0) !== expected_revision) return null;
    return {...state, draft: {step, data: structuredClone(data), revision: expected_revision + 1, updated_at: now}};
  }

  if (command.type === 'draft.discard') {
    if (!state.draft || state.draft.revision !== command.payload.expected_revision) return null;
    return {...state, draft: null};
  }

  return null;
}
