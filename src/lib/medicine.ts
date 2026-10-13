import {z} from 'zod';

export const MEDICINE_CATALOG_VERSION='klu-2026-2027';
export type MedicineTopic={id:string;name:string;subject:string;kind:'theory'|'practice';pages:number[]};
export type MedicineUnit={id:string;year:number;name:string;kind:'kurul'|'staj'|'keg';weight:number;sourceUrl:string;topics:MedicineTopic[]};
export type MedicineCatalog={version:string;units:MedicineUnit[]};
export type MedicineProfile={academic_year:string;active_year:number;enabled:boolean;catalog_version:string;revision:number};
export type MedicineProgress={topic_id:string;academic_year:string;mastery:number;review_requested:boolean;notes:string;revision:number};
export type MedicineResult={id:string;academic_year:string;year:number;unit_id:string;attempt:'regular'|'resit';exam_date:string;reported_score:number|null;theory_score:number|null;practical_score:number|null;notes:string;revision:number;updated_at:string};
export type MedicineKeg={academic_year:string;year:number;status:'not_recorded'|'sufficient'|'insufficient';assessment_date:string|null;notes:string;revision:number};
export type MedicineState={profile:MedicineProfile|null;progress:MedicineProgress[];results:MedicineResult[];keg:MedicineKeg[]};
export const emptyMedicine=():MedicineState=>({profile:null,progress:[],results:[],keg:[]});
export const medicineMasteryLabels=['Başlanmadı','Çalışıyorum','İlk çalışma tamamlandı','Tekrar ediyorum','Hâkimim'];
export const medicineKegLabels={not_recorded:'Sonuç girilmedi',sufficient:'Yeterli',insufficient:'Yetersiz'};
const academicYear=z.string().regex(/^20\d{2}-20\d{2}$/).refine(value=>Number(value.slice(5))===Number(value.slice(0,4))+1,'Ardışık iki yıl girin.');
const year=z.number().int().min(1).max(4);
const expected=z.number().int().min(0);
const score=z.number().finite().min(0).max(100).nullable();
const context={academic_year:academicYear,year};
const resultFields=z.object({...context,unit_id:z.string().regex(/^(d[1-4]-[ks][1-8]|final-[1-3])$/),attempt:z.enum(['regular','resit']),exam_date:z.iso.date(),reported_score:score,theory_score:score,practical_score:score,notes:z.string().trim().max(2000),expected_revision:expected}).strict().superRefine((row,ctx)=>{
 const official=row.reported_score!==null,components=row.theory_score!==null||row.practical_score!==null;
 if(official===components)ctx.addIssue({code:'custom',message:'Açıklanan notu veya teorik/pratik puanlarını girin.'});
 if(!row.unit_id.startsWith('d4-s')&&components)ctx.addIssue({code:'custom',message:'Kurul ve final için açıklanan notu girin.'});
 if(row.unit_id.startsWith('final-')?row.unit_id!==`final-${row.year}`:!row.unit_id.startsWith(`d${row.year}-`))ctx.addIssue({code:'custom',message:'Sınav seçili döneme ait değil.'});
});
export const medicineCommandSchema=z.discriminatedUnion('type',[
 z.object({request_id:z.uuid(),type:z.literal('profile.save'),payload:z.object({academic_year:academicYear,active_year:year,enabled:z.boolean(),expected_revision:expected}).strict()}).strict(),
 z.object({request_id:z.uuid(),type:z.literal('topic.save'),payload:z.object({academic_year:academicYear,topic_id:z.string().regex(/^d[1-4]-(?:[ks][1-8]|keg)-[a-f0-9]{16}$/),mastery:z.number().int().min(0).max(4),review_requested:z.boolean(),notes:z.string().trim().max(10000),expected_revision:expected}).strict()}).strict(),
 z.object({request_id:z.uuid(),type:z.literal('result.save'),payload:resultFields}).strict(),
 z.object({request_id:z.uuid(),type:z.literal('result.delete'),payload:z.object({id:z.uuid(),expected_revision:expected}).strict()}).strict(),
 z.object({request_id:z.uuid(),type:z.literal('keg.save'),payload:z.object({...context,year:z.number().int().min(1).max(3),status:z.enum(['not_recorded','sufficient','insufficient']),assessment_date:z.iso.date().nullable(),notes:z.string().trim().max(2000),expected_revision:expected}).strict()}).strict(),
]);
export type MedicineCommand=z.infer<typeof medicineCommandSchema>;
export function calculateMedicineResult(result:MedicineResult|undefined,kind:MedicineUnit['kind']|'final'):{score:number|null;status:'missing'|'incomplete'|'passed'|'failed'|'theory_failed'}{
 if(!result)return {score:null,status:'missing'};
 if(result.reported_score!==null)return {score:result.reported_score,status:result.reported_score>=60?'passed':'failed'};
 const {theory_score:t,practical_score:p}=result;
 const value=t!==null&&p!==null?(t*40+p*60)/100:null;
 if(kind==='staj'&&t!==null&&t<60)return {score:value,status:'theory_failed'};
 if(value===null)return {score:null,status:'incomplete'};
 return {score:value,status:value>=60?'passed':'failed'};
}
export function effectiveMedicineResult(results:MedicineResult[],unitId:string){
 return results.find(row=>row.unit_id===unitId&&row.attempt==='resit')??results.find(row=>row.unit_id===unitId&&row.attempt==='regular');
}
export function calculateMedicineYear(year:number,units:MedicineUnit[],results:MedicineResult[],keg:MedicineKeg['status']|null){
 const required=units.filter(unit=>unit.year===year&&unit.kind!=='keg');
 const marks=required.map(unit=>({unit,...calculateMedicineResult(effectiveMedicineResult(results,unit.id),unit.kind)}));
 const recorded=marks.filter(mark=>mark.score!==null);
 const totalWeight=recorded.reduce((sum,mark)=>sum+mark.unit.weight,0);
 const currentAverage=totalWeight?recorded.reduce((sum,mark)=>sum+mark.score!*mark.unit.weight,0)/totalWeight:null;
 const complete=required.length>0&&recorded.length===required.length;
 const final=effectiveMedicineResult(results,`final-${year}`);
 const finalScore=final?.reported_score??null;
 const periodScore=complete&&currentAverage!==null?(year===4?currentAverage:finalScore===null?null:(currentAverage+finalScore)/2):null;
 const finalNeeded=year<4&&complete&&currentAverage!==null?Math.max(0,120-currentAverage):null;
 let status:'incomplete'|'passed'|'failed'|'keg_pending'|'keg_failed'='incomplete';
 if(year===4&&marks.some(mark=>mark.status==='theory_failed'||mark.status==='failed'))status='failed';
 else if(periodScore!==null){
  if(periodScore<60)status='failed';
  else if(year===4)status='passed';
  else if(keg==='insufficient')status='keg_failed';
  else if(keg!=='sufficient')status='keg_pending';
  else status='passed';
 }
 return {currentAverage,periodScore,finalNeeded,status,recorded:recorded.length,total:required.length,finalAttempt:final?.attempt??null,marks};
}
