import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const id = z.uuid();
const date = z.iso.date();
const revision = z.number().int().positive();
const studyType = z.enum(["Konu anlatımı", "Soru çözümü", "Tekrar", "Hızlı gözden geçirme", "Yanlış analizi", "Hâkimiyet kontrolü"]);
const exam = z.enum(["TYT", "AYT"]);
const factors = z.object({easy:z.number().min(0.1).max(10),medium:z.number().min(0.1).max(10),hard:z.number().min(0.1).max(10)}).strict();
const step = z.object({id, title:text(240).min(1),completed:z.boolean()}).strict();
const taskFields = z.object({
 title:text(240).min(1),plan_date:date,exam:exam.nullable().optional(),subject:text(120).nullable().optional(),topic_id:id.nullable().optional(),
 resource:text(500).optional(),completion_criteria:text(500).optional(),planned_minutes:z.number().int().min(0).max(1440).optional(),
 difficulty:z.enum(["easy","medium","hard"]).optional(),progress:z.number().min(0).max(1).optional(),
 weight_override:z.number().min(0).max(100000).nullable().optional(),priority:z.enum(["low","normal","high"]).optional(),
 position:z.number().int().min(0).max(100000).optional(),notes:text(10000).optional(),study_type:studyType.optional(),steps:z.array(step).max(100).optional(),
}).strict();
const topicFields = z.object({exam,subject:text(120).min(1),name:text(240).min(1),parent_id:id.nullable().optional(),mastery:z.number().int().min(0).max(4).optional(),notes:text(10000).optional(),review_requested:z.boolean().optional(),source:text(1000).optional(),next_step:text(1000).optional()}).strict();
const practiceFields = z.object({
 practice_date:date,exam,subject:text(120).min(1),
 question_count:z.number().int().min(0).max(100000),
 test_count:z.number().int().min(0).max(10000),
}).strict();
const practiceCreate = practiceFields.refine(v=>v.question_count>0||v.test_count>0,"En az bir soru veya test girin.");const examFormatCode = z.enum(["TYT","AYT_SAYISAL","BRANCH"]);
const examResult = z.union([
 z.object({section_key:text(80).min(1),correct:z.number().int().min(0).max(1000),wrong:z.number().int().min(0).max(1000),blank:z.number().int().min(0).max(1000)}).strict(),
 z.object({section_key:text(80).min(1),net:z.number().finite().min(-1000).max(1000)}).strict(),
]);
const examResults = z.array(examResult).max(50).refine(
 rows=>new Set(rows.map(row=>row.section_key)).size===rows.length,
 "Aynı ders sonucu iki kez girilemez."
);
const examMetadata = z.object({
 name:text(240).min(1),publisher:text(240).optional(),exam_date:date,
 duration_minutes:z.number().int().min(1).max(1440).nullable().optional(),
 notes:text(10000).optional(),score:z.number().finite().min(0).max(1000).nullable().optional(),
 reported_total_net:z.number().finite().min(-1000).max(1000).nullable().optional(),
 rank:z.number().int().positive().max(100000000).nullable().optional(),
 results:examResults,
}).strict();
const examCreate = examMetadata.extend({
 format_code:examFormatCode,format_version:z.number().int().positive().max(1000).optional(),
 branch_subject:text(120).min(1).optional(),
 branch_question_count:z.number().int().positive().max(1000).optional(),
}).strict();
const examUpdate = examMetadata.partial().extend({id,expected_revision:revision}).strict();const journalFieldName = z.enum([
 "original_text","sleep_at","wake_at","sleep_quality","mood","energy",
 "stress","environment","interruptions","activities","people_tags",
 "food_drink","thoughts"
]);
const journalStructuredFields = z.object({
 sleep_at:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
 wake_at:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
 sleep_quality:z.number().int().min(1).max(5).optional(),
 mood:text(120).optional(),energy:z.number().int().min(1).max(5).optional(),
 stress:z.number().int().min(1).max(5).optional(),
 environment:text(500).optional(),interruptions:z.number().int().min(0).max(100).optional(),
 activities:z.array(text(120).min(1)).max(30).optional(),
 people_tags:z.array(text(120).min(1)).max(30).optional(),
 food_drink:text(2000).optional(),thoughts:text(5000).optional(),
}).strict();
const journalFields = z.object({
 journal_date:date,original_text:z.string().max(20000),
 structured_fields:journalStructuredFields.optional(),
 exclude_from_analysis:z.boolean().optional(),
 ai_shared_fields:z.array(journalFieldName).max(13).refine(
  fields=>new Set(fields).size===fields.length,"Paylaşılan alanlar tekrar edemez."
 ).optional(),
}).strict();const settingsFields = z.object({
 display_name:text(100).min(1),exam_year:z.number().int().min(2020).max(2100),exam_date:date.nullable(),target_rank:z.number().int().positive().max(10000000).nullable(),
 timezone:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat("tr-TR",{timeZone:v});return true;}catch{return false;}},"Geçerli saat dilimi gerekli."),
 daily_target_minutes:z.number().int().min(0).max(1440),task_share:z.number().min(0).max(1),difficulty_factors:factors,
 weekday_targets:z.array(z.number().int().min(0).max(1440)).length(7),theme:z.enum(["graphite","rose","ocean","aurora","forest","burgundy","plum","pastel","steel","white","black"]),
 appearance:z.enum(["dark","light","system"]),reduced_motion:z.boolean(),simple_view:z.boolean(),
}).partial().extend({expected_revision:revision}).strict();
const transition=z.object({id,expected_revision:revision}).strict();
const envelope={request_id:id};
export const commandSchema=z.discriminatedUnion("type",[
 z.object({...envelope,type:z.literal("task.create"),payload:taskFields}),
 z.object({...envelope,type:z.literal("task.update"),payload:taskFields.partial().extend({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("task.move"),payload:z.object({id,expected_revision:revision,direction:z.enum(["up","down"])}).strict()}),
 z.object({...envelope,type:z.literal("topic.create"),payload:topicFields}),
 z.object({...envelope,type:z.literal("topic.update"),payload:topicFields.partial().extend({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("practice.create"),payload:practiceCreate}),
 z.object({...envelope,type:z.literal("practice.update"),payload:practiceFields.partial().extend({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("practice.delete"),payload:z.object({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("exam.create"),payload:examCreate}),
 z.object({...envelope,type:z.literal("exam.update"),payload:examUpdate}),
 z.object({...envelope,type:z.literal("exam.delete"),payload:z.object({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("journal.create"),payload:journalFields}),
 z.object({...envelope,type:z.literal("journal.update"),payload:journalFields.partial().extend({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("journal.delete"),payload:z.object({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("day.mark"),payload:z.object({mark_date:date,kind:z.enum(["rest","zero"])}).strict()}),
 z.object({...envelope,type:z.literal("day.unmark"),payload:z.object({id,expected_revision:revision}).strict()}),
 z.object({...envelope,type:z.literal("settings.update"),payload:settingsFields}),
 z.object({...envelope,type:z.literal("plan.update"),payload:z.object({plan_date:date,expected_revision:revision,target_minutes:z.number().int().min(0).max(1440).optional(),task_share:z.number().min(0).max(1).optional(),difficulty_factors:factors.optional()}).strict()}),
 z.object({...envelope,type:z.literal("manual_study.create"),payload:z.object({confirmed_by_user:z.literal(true),study_date:date,subject:text(120).min(1),minutes:z.number().int().min(1).max(1440)}).strict()}),
 z.object({...envelope,type:z.literal("timer.start"),payload:z.object({title:text(240).min(1).optional(),task_id:id.nullable().optional(),topic_id:id.nullable().optional(),subject:text(120).nullable().optional(),study_type:studyType.optional(),mode:z.enum(["stopwatch","countdown"]).optional(),target_seconds:z.number().int().min(60).max(86400).nullable().optional()}).strict().refine(v=>v.mode!=="countdown"||!!v.target_seconds,"Geri sayım hedef süresi gerekli.")}),
 z.object({...envelope,type:z.literal("timer.pause"),payload:transition}),
 z.object({...envelope,type:z.literal("timer.resume"),payload:transition}),
 z.object({...envelope,type:z.literal("timer.finish"),payload:transition.extend({confirmed_seconds:z.number().int().min(0).max(604800).optional()})}),
 z.object({...envelope,type:z.literal("timer.correct"),payload:transition.extend({confirmed_seconds:z.number().int().min(0).max(604800),reason:text(1000).min(3)})}),
]);
export type Command=z.infer<typeof commandSchema>;
export const loginSchema=z.object({email:z.email().max(320),password:z.string().min(1).max(1024)}).strict();




