import { z } from 'zod';

export const defaultModules = { tasks: true, timer: true, results: true, statistics: true, journal: true };
export const educationProfileSchema = z.object({
  education_level: z.enum(['high_school', 'university', 'graduate']),
  yks_goal: z.boolean(), grade: z.number().int().min(9).max(12).nullable(),
  department: z.string().trim().max(160), university_year: z.string().trim().max(40),
  yks_track: z.enum(['sayisal', 'esit_agirlik', 'sozel', 'dil', 'undecided']),
  modules: z.object({tasks:z.boolean(),timer:z.boolean(),results:z.boolean(),statistics:z.boolean(),journal:z.boolean()}).strict(),
}).strict().superRefine((profile, ctx) => {
  if (profile.education_level === 'high_school' && profile.grade === null) ctx.addIssue({code:'custom',path:['grade'],message:'Lise sınıfını seçin.'});
  if (profile.education_level !== 'high_school' && profile.grade !== null) ctx.addIssue({code:'custom',path:['grade'],message:'Sınıf bilgisi yalnızca lise profiline aittir.'});
  if (profile.education_level === 'graduate' && !profile.yks_goal) ctx.addIssue({code:'custom',path:['yks_goal'],message:'Mezun profili için YKS hedefini açın.'});
});
const termInputSchema = z.object({id:z.uuid().optional(),academic_year:z.string().trim().min(1).max(40),name:z.string().trim().min(1).max(80),starts_on:z.iso.date().nullable().optional(),ends_on:z.iso.date().nullable().optional()}).strict().refine(t=>!t.starts_on||!t.ends_on||t.ends_on>=t.starts_on,'Dönem bitişi başlangıçtan önce olamaz.');
const courseInputSchema = z.object({name:z.string().trim().min(1).max(120),context:z.enum(['school','yks']),exam:z.enum(['TYT','AYT']).nullable().optional()}).strict().refine(c=>c.context==='yks'?!!c.exam:!c.exam,'YKS dersinde TYT/AYT seçin; okul dersinde sınav alanı kullanmayın.').refine(c=>c.context!=='yks'||c.name.length<=116,'YKS ders adı en fazla 116 karakter olabilir.');
export function normalizeCourseName(name:string) { return name.normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('tr-TR'); }
export const setupSchema = z.object({profile:educationProfileSchema,term:termInputSchema.nullable(),courses:z.array(courseInputSchema).max(100)}).strict().superRefine((setup,ctx)=>{
  const seen=new Set<string>();
  setup.courses.forEach((course,index)=>{const key=`${course.context}:${course.exam??''}:${normalizeCourseName(course.name)}`;if(seen.has(key))ctx.addIssue({code:'custom',path:['courses',index,'name'],message:'Bu ders aynı bağlamda zaten listede.'});seen.add(key);});
  if(setup.courses.some(c=>c.context==='school')&&!setup.term)ctx.addIssue({code:'custom',path:['term'],message:'Okul dersleri için bir dönem ekleyin.'});
});
export type SetupInput=z.infer<typeof setupSchema>;
// A draft is bounded and typed, but may be between valid setup steps.
const draftSchema=z.object({profile:z.object(educationProfileSchema.shape).strict(),term:z.object(termInputSchema.shape).extend({academic_year:z.string().trim().max(40),name:z.string().trim().max(80)}).strict().nullable(),courses:z.array(courseInputSchema).max(100)}).strict();
export type EducationProfile=z.infer<typeof educationProfileSchema>&{active_term_id:string|null;onboarding_completed_at:string;revision:number};
export type EducationDraft={step:number;data:SetupInput;revision:number;updated_at:string};
export type EducationTerm={id:string;academic_year:string;name:string;starts_on:string|null;ends_on:string|null;archived:boolean;revision:number;created_at:string};
export type EducationCourse={id:string;term_id:string|null;name:string;normalized_name:string;context:'school'|'yks';exam:'TYT'|'AYT'|null;catalog_subject?:string|null;archived:boolean;revision:number;created_at:string;updated_at:string};
export type CourseExamResult={id:string;course_id:string;term_id:string|null;course_name:string;exam_date:string;assessment_type:string;assessment_name:string;score:number;scale:number;revision:number;created_at:string;updated_at:string};
export type EducationState={profile:EducationProfile|null;draft:EducationDraft|null;terms:EducationTerm[];courses:EducationCourse[];results:CourseExamResult[];needs_onboarding:boolean;can_commit:boolean};
export function emptyEducation():EducationState{return {profile:null,draft:null,terms:[],courses:[],results:[],needs_onboarding:false,can_commit:false};}
export function defaultSetup(education?:EducationState):SetupInput {
  if(education?.draft)return structuredClone(education.draft.data);
  const profile=education?.profile,term=education?.terms.find(t=>t.id===profile?.active_term_id);
  return {profile:profile?{education_level:profile.education_level,yks_goal:profile.yks_goal,grade:profile.grade,department:profile.department,university_year:profile.university_year,yks_track:profile.yks_track,modules:{...profile.modules}}:{education_level:'high_school',yks_goal:true,grade:12,department:'',university_year:'',yks_track:'undecided',modules:{...defaultModules}},term:term?{id:term.id,academic_year:term.academic_year,name:term.name,starts_on:term.starts_on,ends_on:term.ends_on}:null,courses:[]};
}
const resultFields=z.object({course_id:z.uuid(),exam_date:z.iso.date(),assessment_type:z.string().trim().min(1).max(80),assessment_name:z.string().trim().max(160).optional(),score:z.number().finite().min(0).max(1000000),scale:z.number().finite().positive().max(1000000)}).strict();
const envelope={request_id:z.uuid()};
export const educationCommandSchema=z.discriminatedUnion('type',[
  z.object({...envelope,type:z.literal('draft.save'),payload:z.object({expected_revision:z.number().int().min(0),step:z.number().int().min(0).max(3),data:draftSchema}).strict()}),
  z.object({...envelope,type:z.literal('draft.discard'),payload:z.object({expected_revision:z.number().int().positive()}).strict()}),
  z.object({...envelope,type:z.literal('profile.save'),payload:setupSchema.safeExtend({expected_revision:z.number().int().min(0)})}),
  z.object({...envelope,type:z.literal('course.create'),payload:courseInputSchema.safeExtend({id:z.uuid().optional(),term_id:z.uuid().nullable()})}),
  z.object({...envelope,type:z.literal('course.update'),payload:z.object({id:z.uuid(),expected_revision:z.number().int().positive(),name:z.string().trim().min(1).max(120).optional(),archived:z.boolean().optional()}).strict()}),
  z.object({...envelope,type:z.literal('term.activate'),payload:z.object({id:z.uuid()}).strict()}),
  z.object({...envelope,type:z.literal('results.batch'),payload:z.object({rows:z.array(resultFields.refine(r=>r.score<=r.scale,'Puan ölçekten büyük olamaz.')).min(1).max(100)}).strict()}),
  z.object({...envelope,type:z.literal('result.update'),payload:resultFields.omit({course_id:true}).partial().extend({id:z.uuid(),expected_revision:z.number().int().positive()}).strict()}),
]);
export type EducationCommand=z.infer<typeof educationCommandSchema>;
