import type {EducationState, SetupInput} from './education';
import {normalizeCourseName} from './education';

export type EducationCommand = (type:string, payload:Record<string,unknown>, requestId?:string)=>Promise<boolean>;
export const moduleLabels = {tasks:'Görevler',timer:'Çalışma sayacı',results:'Sınav sonuçları',statistics:'İstatistikler',journal:'Günlük'} as const;
export const levelLabels = {high_school:'Lise',university:'Üniversite',graduate:'Mezun · YKS hazırlığı'} as const;

export function academicYear(now = new Date()) {
  const year = now.getMonth() < 8 ? now.getFullYear()-1 : now.getFullYear();
  return `${year}–${year+1}`;
}
export function setupFromEducation(education:EducationState, resume = true):SetupInput {
  if (resume && education.draft) return structuredClone(education.draft.data);
  const profile = education.profile;
  const term = education.terms.find(item=>item.id===profile?.active_term_id);
  return {
    profile: {
      education_level:profile?.education_level??'high_school',yks_goal:profile?.yks_goal??true,
      grade:profile?.grade??null,department:profile?.department??'',university_year:profile?.university_year??'',
      yks_track:profile?.yks_track??'undecided',
      modules:profile?.modules??{tasks:true,timer:true,results:true,statistics:true,journal:false},
    },
    term:term?{id:term.id,academic_year:term.academic_year,name:term.name,starts_on:term.starts_on,ends_on:term.ends_on}:{academic_year:academicYear(),name:'Yıllık'},
    courses:education.courses.filter(course=>!course.archived && (course.context==='yks'||course.term_id===term?.id)).map(course=>({name:course.name,context:course.context,exam:course.exam})),
  };
}
export function parseCourseNames(input:string) {
  const names=input.split(/[\n;,]+/).map(value=>value.trim().replace(/\s+/gu,' ')).filter(Boolean);
  const seen=new Set<string>(); const duplicates:string[]=[];
  const unique=names.filter(name=>{const key=normalizeCourseName(name);if(seen.has(key)){duplicates.push(name);return false;}seen.add(key);return true;});
  return {names:unique,duplicates};
}
