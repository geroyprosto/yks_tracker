import {z} from 'zod';

export const REPORT_SCHEMA_VERSION = 2;
export const REPORT_HEADINGS = ['Genel Durum', 'Çalışma Düzeni', 'Sınav Sonuçları ve Dersler', 'Önümüzdeki 7 Gün İçin Adımlar', 'Verinin Sınırları'] as const;
export const countWords = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
const shortText = (words: number) => z.string().trim().min(1).max(words * 30).refine(text => countWords(text) <= words, 'Metin kelime sınırını aşıyor.');
const item = (words: number) => z.object({text: shortText(words), evidence_ids: z.array(z.string().max(100)).max(4), course_id: z.string().max(100).nullable()}).strict();
export const reportSchema = z.object({
  schema_version: z.literal(REPORT_SCHEMA_VERSION), overview: shortText(35),
  study_observations: z.array(item(25)).max(2), result_observations: z.array(item(25)).min(1).max(2),
  next_actions: z.array(item(20)).max(3), limitations: z.array(shortText(25)).max(2),
}).strict();
export type StructuredReport = z.infer<typeof reportSchema>;
export function reportTexts(report: StructuredReport) {
  return [report.overview, ...report.study_observations.map(x => x.text), ...report.result_observations.map(x => x.text), ...report.next_actions.map(x => x.text), ...report.limitations];
}
export function validateStructuredReport(value: unknown, evidenceIds: readonly string[], courseIds: readonly string[]): StructuredReport {
  const parsed = reportSchema.parse(value);
  const evidence = new Set(evidenceIds), courses = new Set(courseIds);
  for (const item of [...parsed.study_observations, ...parsed.result_observations, ...parsed.next_actions]) {
    if (item.evidence_ids.some(id => !evidence.has(id)) || (item.course_id !== null && !courses.has(item.course_id))) throw new Error('İzin verilmeyen rapor kaynağı veya ders.');
  }
  const texts = reportTexts(parsed);
  if (countWords(texts.join(' ')) > 250) throw new Error('Rapor 250 kelimeyi aşıyor.');
  const normalized = texts.map(text => text.toLocaleLowerCase('tr-TR').replace(/[\p{P}\p{S}]/gu, '').trim());
  if (new Set(normalized).size !== normalized.length) throw new Error('Raporda yinelenen metin var.');
  return parsed;
}
const jsonItem = {type: 'object', additionalProperties: false, required: ['text','evidence_ids','course_id'], properties: {
  text: {type:'string'}, evidence_ids: {type:'array',maxItems:4,items:{type:'string'}}, course_id:{type:['string','null']},
}};
export const reportJsonSchema = {type:'object',additionalProperties:false,
  required:['schema_version','overview','study_observations','result_observations','next_actions','limitations'],
  properties:{schema_version:{type:'integer',enum:[REPORT_SCHEMA_VERSION]},overview:{type:'string'},
    study_observations:{type:'array',maxItems:2,items:jsonItem},result_observations:{type:'array',minItems:1,maxItems:2,items:jsonItem},
    next_actions:{type:'array',maxItems:3,items:jsonItem},limitations:{type:'array',maxItems:2,items:{type:'string'}}}};

export function istanbulBillingMonth(at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit'}).formatToParts(at);
  const year=Number(parts.find(x=>x.type==='year')!.value), month=Number(parts.find(x=>x.type==='month')!.value);
  return {month:`${year}-${String(month).padStart(2,'0')}-01`,resets_at:new Date(Date.UTC(year,month,1,-3)).toISOString()};
}
