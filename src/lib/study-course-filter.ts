import type {AppState} from './domain/types';
import type {EducationCourse, EducationState} from './education';

export const unassignedCourse = '__unassigned__';
export type StudyCourseFilter = {termId: string; courseId: string};

export function educationCourseLabel(course: EducationCourse, education: EducationState): string {
  const term = education.terms.find(item => item.id === course.term_id);
  if (course.context === 'yks') return `${course.exam} · ${course.name}`;
  return [course.name, term ? `${term.academic_year} / ${term.name}` : 'Okul / Üniversite'].join(' · ');
}

/** Read-only projection: never infer a persistent course identity from an old text label. */
export function filterStudyState(state: AppState, filter: StudyCourseFilter): AppState {
  if (!state.education?.profile || (!filter.termId && !filter.courseId)) return state;
  const courseIds = new Set(state.education.courses.filter(course => !filter.termId || course.term_id === filter.termId).map(course => course.id));
  const includes = (record: {course_id?: string | null}) => {
    if (filter.courseId === unassignedCourse) return !filter.termId && !record.course_id;
    if (filter.courseId) return record.course_id === filter.courseId && courseIds.has(filter.courseId);
    return Boolean(record.course_id && courseIds.has(record.course_id));
  };
  const sessions = state.sessions.filter(includes), sessionIds = new Set(sessions.map(session => session.id));
  return {...state, tasks: state.tasks.filter(includes), sessions,
    intervals: state.intervals.filter(interval => sessionIds.has(interval.session_id)),
    manual_study_entries: (state.manual_study_entries ?? []).filter(includes),
    // Whole-day targets, confirmations and private journals cannot be attributed to one course.
    day_plans: [], day_marks: [], journal_entries: [], exams: [],
  };
}
