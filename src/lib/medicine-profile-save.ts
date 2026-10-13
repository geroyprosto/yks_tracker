import type {MedicineCommand,MedicineProfile,MedicineState} from './medicine';

export const KLU_MEDICINE_DEPARTMENT='Kırklareli Üniversitesi Tıp';
type ProfileCommand=Extract<MedicineCommand,{type:'profile.save'}>;
type ProfileSelection=Pick<MedicineProfile,'academic_year'|'active_year'|'enabled'>;

/** Keep an uncertain write intact so a lost response can safely be retried. */
export function createMedicineProfileSaver(){
 let pending:ProfileCommand|null=null;
 return async(selection:ProfileSelection)=>{
  if(!pending||pending.payload.academic_year!==selection.academic_year||pending.payload.active_year!==selection.active_year||pending.payload.enabled!==selection.enabled){
   const response=await fetch('/api/medicine',{cache:'no-store'});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error?.message??'Tıp çalışma alanı yüklenemedi.');
   const profile=(body as MedicineState).profile;
   pending={request_id:crypto.randomUUID(),type:'profile.save',payload:{...selection,expected_revision:profile?.revision??0}};
  }
  const response=await fetch('/api/medicine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
  const body=await response.json();
  if(!response.ok){
   if(response.status<500)pending=null;
   throw new Error(body.error?.message??'Tıp çalışma alanı kaydedilemedi.');
  }
  pending=null;
 };
}
