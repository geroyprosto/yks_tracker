import {z} from 'zod';

export const REPORT_SCHEMA_VERSION = 3;
export const REPORT_KEYS = ['topics','regularity','journal','wins','improvements','timing'] as const;
export const REPORT_HEADINGS = ['Konu İlerlemesi','Çalışma Düzeni','Günlükten Notlar','Bu Haftanın Güçlü Yanları','İyileştirilecekler','Döneme Göre Yol Haritası'] as const;
export const GUIDANCE_SOURCES = [
  {title:'MEB · YKS hazırlık programları',url:'https://seben.meb.gov.tr/www/yks039ye-hazirlik-programlari-yks039ye-nasil-hazirlanmaliyim/icerik/503',principle:'Programı okul saatlerine ve günlük rutine göre uyarlamak gerekir.'},
  {title:'MEB · 2026-2027 MEBİ deneme takvimi',url:'https://www.meb.gov.tr/mebi-2026-2027-yks-ve-lgs-deneme-takvimi-belli-oldu/haber/41943/tr',principle:'Yıl boyunca aralıklı denemeler ve sonuçlardan konu eksiklerini belirleyip planı bireysel ihtiyaçlara göre düzenleme önerilir.'},
  {title:'Özyeğin Üniversitesi · YKS hazırlık stratejileri (2025)',url:'https://aday.ozyegin.edu.tr/yksye-nasil-hazirlanilir-2025-icin-etkili-stratejiler/',principle:'Ekim-Kasım temel ve düzen; Aralık-Ocak konu kapanışı ve TYT/AYT deneme dengesi; sonraki aylarda deneme analizi artabilir. Bunlar örnek takvimdir.'},
  {title:'ODİS · Planlı çalışma ve deneme sistemi',url:'https://odisegitim.com/egitim-rehberi-yazilarimiz/kadikoyde-yks-hazirlik-planli-calisma-ve-deneme-odakli-sistem/',principle:'Haftalık plan okul temposunu ve deneme günlerini hesaba katmalı; TYT/AYT dengesi ile deneme analizi öğrenciye göre ayarlanmalı.'},
] as const;
export const countWords = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
const shortText = (words: number) => z.string().trim().min(1).max(words * 30).refine(text => countWords(text) <= words, 'Metin kelime sınırını aşıyor.');
const reportCardSchema = z.object({headline:shortText(8),text:shortText(45),evidence_ids:z.array(z.string().max(100)).max(4),course_id:z.string().max(100).nullable()}).strict();
export const reportSchema = z.object({
  schema_version:z.literal(REPORT_SCHEMA_VERSION),
  topics:reportCardSchema,regularity:reportCardSchema,journal:reportCardSchema,
  wins:reportCardSchema,improvements:reportCardSchema,timing:reportCardSchema,
}).strict();
export type StructuredReport = z.infer<typeof reportSchema>;
export function reportTexts(report: StructuredReport) {
  return REPORT_KEYS.flatMap(key=>[report[key].headline,report[key].text]);
}
export function validateStructuredReport(value: unknown, evidenceIds: readonly string[], courseIds: readonly string[]): StructuredReport {
  const parsed = reportSchema.parse(value);
  const evidence = new Set(evidenceIds), courses = new Set(courseIds);
  for (const key of REPORT_KEYS) {
    const card=parsed[key];
    if (card.evidence_ids.some(id => !evidence.has(id)) || (card.course_id !== null && !courses.has(card.course_id))) throw new Error('İzin verilmeyen rapor kaynağı veya ders.');
  }
  if (countWords(reportTexts(parsed).join(' ')) > 300) throw new Error('Rapor 300 kelimeyi aşıyor.');
  return parsed;
}
const jsonItem = {type: 'object', additionalProperties: false, required: ['headline','text','evidence_ids','course_id'], properties: {
  headline:{type:'string'},text: {type:'string'}, evidence_ids: {type:'array',maxItems:4,items:{type:'string'}}, course_id:{type:['string','null']},
}};
export const reportJsonSchema = {type:'object',additionalProperties:false,
  required:['schema_version',...REPORT_KEYS],
  properties:{schema_version:{type:'integer',enum:[REPORT_SCHEMA_VERSION]},...Object.fromEntries(REPORT_KEYS.map(key=>[key,jsonItem]))}};

export function istanbulBillingMonth(at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit'}).formatToParts(at);
  const year=Number(parts.find(x=>x.type==='year')!.value), month=Number(parts.find(x=>x.type==='month')!.value);
  return {month:`${year}-${String(month).padStart(2,'0')}-01`,resets_at:new Date(Date.UTC(year,month,1,-3)).toISOString()};
}
