import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {calculateMedicineYear, calculateMedicineResult, medicineCommandSchema, type MedicineResult, type MedicineUnit} from '../src/lib/medicine';

const unit=(id:string,weight:number,kind:'kurul'|'staj'='kurul'):MedicineUnit=>({id,year:kind==='staj'?4:1,name:id,kind,weight,sourceUrl:'https://tip.klu.edu.tr/',topics:[]});
const result=(unit_id:string,score:number|null,changes:Partial<MedicineResult>={}):MedicineResult=>({id:randomUUID(),academic_year:'2026-2027',year:1,unit_id,attempt:'regular',exam_date:'2026-10-14',reported_score:score,theory_score:null,practical_score:null,notes:'',revision:1,updated_at:'2026-10-14T10:00:00Z',...changes});
test('KLU calculates by course load, requires all committees and does not treat missing marks as zero',()=>{
 const units=[unit('d1-k1',1),unit('d1-k2',3)];
 const partial=calculateMedicineYear(1,units,[result('d1-k1',40)],null);
 assert.equal(partial.currentAverage,40);assert.equal(partial.periodScore,null);assert.equal(partial.finalNeeded,null);assert.equal(partial.status,'incomplete');
 const complete=calculateMedicineYear(1,units,[result('d1-k1',40),result('d1-k2',80),result('final-1',50)],'sufficient');
 assert.equal(complete.currentAverage,70);assert.equal(complete.periodScore,60);assert.equal(complete.finalNeeded,50);assert.equal(complete.status,'passed');
});
test('a recorded zero is included and KEG is required even when the numeric grade passes',()=>{
 const units=[unit('d1-k1',1),unit('d1-k2',1)];
 const summary=calculateMedicineYear(1,units,[result('d1-k1',0),result('d1-k2',100),result('final-1',80)],null);
 assert.equal(summary.periodScore,65);assert.equal(summary.status,'keg_pending');
 assert.equal(calculateMedicineYear(1,units,[result('d1-k1',0),result('d1-k2',100),result('final-1',80)],'insufficient').status,'keg_failed');
});
test('the resit replaces the final and remains effective even if it is lower',()=>{
 const units=[unit('d1-k1',1)];
 const summary=calculateMedicineYear(1,units,[result('d1-k1',70),result('final-1',70),result('final-1',30,{attempt:'resit'})],'sufficient');
 assert.equal(summary.periodScore,50);assert.equal(summary.status,'failed');assert.equal(summary.finalAttempt,'resit');
});
test('KLU has no imported final-50 threshold and does not round 59.99 into a pass',()=>{
 const units=[unit('d1-k1',1)];
 assert.equal(calculateMedicineYear(1,units,[result('d1-k1',90),result('final-1',30)],'sufficient').status,'passed');
 assert.equal(calculateMedicineYear(1,units,[result('d1-k1',59.98),result('final-1',60)],'sufficient').status,'failed');
 assert.equal(calculateMedicineYear(1,units,[result('d1-k1',10)],null).finalNeeded,110);
});
test('clerkships need theory 60 and final 60; a weighted pass cannot hide a failed clerkship',()=>{
 const units=[unit('d4-s1',1,'staj'),unit('d4-s2',1,'staj')];
 const bad=result('d4-s1',null,{year:4,theory_score:59,practical_score:100});
 assert.equal(calculateMedicineResult(bad,'staj').score,83.6);
 assert.equal(calculateMedicineResult(bad,'staj').status,'theory_failed');
 assert.equal(calculateMedicineYear(4,units,[bad,result('d4-s2',100,{year:4})],null).status,'failed');
 const staged=result('d4-s1',null,{year:4,theory_score:75});
 assert.equal(calculateMedicineResult(staged,'staj').score,null);
 assert.equal(calculateMedicineYear(4,units,[staged],null).periodScore,null);
});
test('clerkship resit replaces both components and official scores are not blended with entered components',()=>{
 const units=[unit('d4-s1',1,'staj')];
 const first=result('d4-s1',null,{year:4,theory_score:59,practical_score:100});
 const repeat=result('d4-s1',null,{year:4,attempt:'resit',theory_score:60,practical_score:60});
 assert.equal(calculateMedicineYear(4,units,[first,repeat],null).status,'passed');
 const input={request_id:randomUUID(),type:'result.save',payload:{...repeat,expected_revision:0,reported_score:90}};
 delete (input.payload as Partial<MedicineResult>).id;
 delete (input.payload as Partial<MedicineResult>).revision;
 delete (input.payload as Partial<MedicineResult>).updated_at;
 assert.equal(medicineCommandSchema.safeParse(input).success,false);
});
test('command validation rejects invalid years, impossible dates, invalid marks and unrecognized properties',()=>{
 const base={request_id:randomUUID(),type:'profile.save',payload:{academic_year:'2026-2027',active_year:1,enabled:true,expected_revision:0}};
 assert.equal(medicineCommandSchema.safeParse(base).success,true);
 assert.equal(medicineCommandSchema.safeParse({...base,payload:{...base.payload,active_year:5}}).success,false);
 assert.equal(medicineCommandSchema.safeParse({...base,payload:{...base.payload,academic_year:'2026-2028'}}).success,false);
 assert.equal(medicineCommandSchema.safeParse({...base,payload:{...base.payload,user_id:randomUUID()}}).success,false);
 const row={academic_year:'2026-2027',year:1,unit_id:'d1-k1',attempt:'regular',exam_date:'2026-02-31',reported_score:60,theory_score:null,practical_score:null,notes:'',expected_revision:0};
 assert.equal(medicineCommandSchema.safeParse({request_id:randomUUID(),type:'result.save',payload:row}).success,false);
 assert.equal(medicineCommandSchema.safeParse({request_id:randomUUID(),type:'result.save',payload:{...row,exam_date:'2026-10-14',reported_score:101}}).success,false);
});
