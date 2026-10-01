import {z} from 'zod';
const direction=z.object({title:z.string().min(1).max(120),text:z.string().min(1).max(800),
  topic_id:z.string().nullable(),task_ids:z.array(z.string()).max(6)}).strict();
export const coachingAnalysisSchema=z.object({schema_version:z.literal(4),
  directions:z.array(direction).max(3),journal_note:z.string().max(1200),exam_note:z.string().max(1200)}).strict();
export type CoachingAnalysis=z.infer<typeof coachingAnalysisSchema>;
export const coachingAnalysisJsonSchema={type:'object',additionalProperties:false,
  required:['schema_version','directions','journal_note','exam_note'],properties:{schema_version:{type:'integer',enum:[4]},
    directions:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['title','text','topic_id','task_ids'],properties:{
      title:{type:'string'},text:{type:'string'},topic_id:{type:['string','null']},task_ids:{type:'array',maxItems:6,items:{type:'string'}}}}},
    journal_note:{type:'string'},exam_note:{type:'string'}}};
export function validateCoachingAnalysis(value:unknown,topicIds:string[],taskIds:string[]){
  const result=coachingAnalysisSchema.parse(value),topics=new Set(topicIds),tasks=new Set(taskIds);
  if(/\d+\s*(?:saniye|sn\b)/iu.test([result.journal_note,result.exam_note,...result.directions.map(item=>item.text)].join(' ')))
    throw new Error('Çalışma süresi saat ve dakika olmalı.');
  for(const item of result.directions){
    if(item.topic_id&&!topics.has(item.topic_id)||item.task_ids.some(id=>!tasks.has(id)))throw new Error('Geçersiz konu veya görev kaynağı.');
    if(/\b\d+\s*soru(?:yu|nun)?\s*(?:çöz|tamamla|bitir)/iu.test(item.text)||/şimdi.{0,30}soru/iu.test(item.text))throw new Error('Konu hedefi yerine anlık soru emri.');
  }
  return result;
}
