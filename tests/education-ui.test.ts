import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defaultModules, emptyEducation, type EducationCourse, type EducationState} from '../src/lib/education';
import {parseCourseNames, setupFromEducation} from '../src/lib/education-ui';

test('editing setup retains separate global YKS courses while excluding retired and other-term school courses', () => {
  const state: EducationState = {...emptyEducation(), profile: {education_level: 'university', yks_goal: false, grade: null, department: '', university_year: '', yks_track: 'undecided', modules: defaultModules, active_term_id: 'fall', onboarding_completed_at: '2026-09-27', revision: 1},
    terms: [{id: 'fall', name: 'Güz', academic_year: '2026–2027', starts_on: null, ends_on: null, archived: false, revision: 1, created_at: ''}],
    courses: [
      {id: 'school', name: 'Matematik', context: 'school', term_id: 'fall', archived: false, exam: null},
      {id: 'yks', name: 'Matematik', context: 'yks', term_id: null, archived: false, exam: 'TYT'},
      {id: 'old', name: 'İktisat', context: 'school', term_id: 'spring', archived: false, exam: null},
      {id: 'retired', name: 'Bilişim', context: 'school', term_id: 'fall', archived: true, exam: null},
    ] as EducationCourse[],
  };
  assert.deepEqual(setupFromEducation(state, false).courses, [{name: 'Matematik', context: 'school', exam: null}, {name: 'Matematik', context: 'yks', exam: 'TYT'}]);
  assert.equal(setupFromEducation(state, false).profile.yks_goal, false);
});

test('course preview uses shared Turkish normalization without merging different spellings by guesswork', () => {
  assert.deepEqual(parseCourseNames(' BİLİŞİM  Teknolojileri ; bilişim teknolojileri\nİktisat\nIŞIK'), {names: ['BİLİŞİM Teknolojileri', 'İktisat', 'IŞIK'], duplicates: ['bilişim teknolojileri']});
  assert.equal(parseCourseNames('Bilişim;Bilisim').names.length, 2);
});
