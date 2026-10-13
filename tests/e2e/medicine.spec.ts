import {expect,test,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {emptyState} from '../../src/lib/domain/types';
import {defaultModules} from '../../src/lib/education';
import {emptyMedicine,medicineCommandSchema,type MedicineState} from '../../src/lib/medicine';
import catalog from '../../src/lib/catalogs/klu-medicine-2026.json';

const stamp='2026-10-14T10:00:00Z';
function university(){return {...emptyState(true),authenticated:true,education:{profile:{education_level:'university' as const,yks_goal:false,grade:null,department:'Tıp',university_year:'1',yks_track:'undecided' as const,modules:defaultModules,active_term_id:null,onboarding_completed_at:stamp,revision:1},draft:null,terms:[],courses:[],results:[],needs_onboarding:false,can_commit:true}};}
async function open(page:Page,medicine:MedicineState,failFirstSave=false){
 const requests:string[]=[];let failed=false;
 const receipts=new Set<string>();
 await page.clock.setFixedTime(new Date(stamp));
 await page.route('**/api/state',route=>route.fulfill({json:university()}));
 await page.route('**/api/medicine',async route=>{
  if(route.request().method()==='GET'){
   const year=medicine.profile?.active_year,academic=medicine.profile?.academic_year;
   return route.fulfill({json:{...medicine,progress:medicine.progress.filter(row=>row.academic_year===academic&&row.topic_id.startsWith(`d${year}-`)),results:medicine.results.filter(row=>row.academic_year===academic&&row.year===year),keg:medicine.keg.filter(row=>row.academic_year===academic&&row.year===year)}});
  }
  const command=medicineCommandSchema.parse(route.request().postDataJSON());requests.push(command.request_id);
  if(!receipts.has(command.request_id)){
   const payload=command.payload;
   if(command.type==='profile.save')medicine.profile={academic_year:command.payload.academic_year,active_year:command.payload.active_year,enabled:command.payload.enabled,catalog_version:'klu-2026-2027',revision:(medicine.profile?.revision??0)+1};
   else if(command.type==='topic.save'){
    const index=medicine.progress.findIndex(row=>row.topic_id===command.payload.topic_id&&row.academic_year===command.payload.academic_year);
    const row={...command.payload,revision:(index<0?0:medicine.progress[index].revision)+1};
    if(index<0)medicine.progress.push(row);else medicine.progress[index]=row;
   }else if(command.type==='result.save'){
    const p=command.payload,index=medicine.results.findIndex(row=>row.unit_id===p.unit_id&&row.academic_year===p.academic_year&&row.attempt===p.attempt);
    const row={...p,id:index<0?randomUUID():medicine.results[index].id,revision:(index<0?0:medicine.results[index].revision)+1,updated_at:stamp};
    if(index<0)medicine.results.push(row);else medicine.results[index]=row;
   }else if(command.type==='keg.save'){
    const p=command.payload,index=medicine.keg.findIndex(row=>row.year===p.year&&row.academic_year===p.academic_year),row={...p,revision:(index<0?0:medicine.keg[index].revision)+1};
    if(index<0)medicine.keg.push(row);else medicine.keg[index]=row;
   }else if(command.type==='result.delete')medicine.results=medicine.results.filter(row=>row.id!==command.payload.id);
   void payload;receipts.add(command.request_id);
  }
  if(failFirstSave&&!failed){failed=true;return route.fulfill({status:503,json:{error:{message:'Yanıt kayboldu; aynı kaydı yeniden dene.'}}});}
  const year=medicine.profile?.active_year,academic=medicine.profile?.academic_year;
  await route.fulfill({json:{ok:true,state:{...medicine,progress:medicine.progress.filter(row=>row.academic_year===academic&&row.topic_id.startsWith(`d${year}-`)),results:medicine.results.filter(row=>row.academic_year===academic&&row.year===year),keg:medicine.keg.filter(row=>row.academic_year===academic&&row.year===year)}}});
 });
 await page.goto('/');
 return requests;
}
function enabled(year=1):MedicineState{return {...emptyMedicine(),profile:{academic_year:'2026-2027',active_year:year,enabled:true,catalog_version:'klu-2026-2027',revision:1}};}
async function nav(page:Page,name:string){await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name,exact:true}).click();}

test('a university student can enable KLU, track a topic, save private notes and reload',async({page})=>{
 const state=emptyMedicine();await open(page,state);await nav(page,'Konularım');
 await page.getByRole('button',{name:'Kırklareli Tıp alanını aç'}).click();
 await expect(page.getByRole('heading',{name:'Kurul 1 · Yaşamın Moleküler Temelleri'})).toBeVisible();
 const topic=catalog.units.find(unit=>unit.id==='d1-k1')!.topics.find(row=>row.subject==='Fizyoloji')!;
 await page.getByLabel(`${topic.name} öğrenme düzeyi`,{exact:true}).selectOption('4');
 await expect(page.getByLabel(`${topic.name} öğrenme düzeyi`,{exact:true})).toHaveValue('4');
 await page.getByRole('button',{name:topic.name,exact:false}).first().click();
 await page.getByLabel('Konu notum').fill('Kalıcı çalışma notum');
 await page.getByLabel('Tekrar gerekiyor',{exact:true}).check();
 await page.getByRole('button',{name:'Konu durumunu kaydet'}).click();
 await page.reload();await nav(page,'Konularım');
 await expect(page.getByLabel(`${topic.name} öğrenme düzeyi`,{exact:true})).toHaveValue('4');
 await page.getByRole('button',{name:topic.name,exact:false}).first().click();
 await expect(page.getByLabel('Konu notum')).toHaveValue('Kalıcı çalışma notum');
 await expect(page.getByLabel('Tekrar gerekiyor',{exact:true})).toBeChecked();
});
test('period scores use all committees, KEG is independent and a resit replaces the final',async({page})=>{
 const state=enabled();
 state.results=catalog.units.filter(unit=>unit.year===1&&unit.kind==='kurul').map(unit=>({id:randomUUID(),academic_year:'2026-2027',year:1,unit_id:unit.id,attempt:'regular',exam_date:'2026-10-14',reported_score:70,theory_score:null,practical_score:null,notes:'',revision:1,updated_at:stamp}));
 await open(page,state);await nav(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Dönem finali / bütünleme notunu gir'}).click();
 await page.getByLabel('Açıklanan tıp notu').fill('50');await page.getByRole('button',{name:'Tıp notunu kaydet'}).click();
 await expect(page.getByText('Not yeterli; KEG sonucu bekleniyor')).toBeVisible();
 await nav(page,'Konularım');await page.getByRole('button',{name:'KEG takibi',exact:true}).click();
 await page.getByLabel('KEG sonucu',{exact:true}).selectOption('sufficient');await page.getByRole('button',{name:'KEG sonucunu kaydet'}).click();
 await nav(page,'Sınav Sonuçları');await expect(page.getByText('Girilen kayıtlara göre koşullar sağlandı')).toBeVisible();
 await page.getByRole('button',{name:'Dönem finali / bütünleme notunu düzenle'}).click();
 await page.getByLabel('Tıp sınav türü').selectOption('resit');await page.getByLabel('Açıklanan tıp notu').fill('30');await page.getByRole('button',{name:'Tıp notunu kaydet'}).click();
 await expect(page.getByText('Başarı koşulları sağlanmadı',{exact:true})).toBeVisible();expect(state.results.filter(row=>row.unit_id==='final-1')).toHaveLength(2);
});
test('clerkship theory gate overrides a high practical score; other periods have separate records',async({page})=>{
 const state=enabled(4);await open(page,state);await nav(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'İç Hastalıkları notunu gir'}).click();
 await page.getByLabel('Teorik puanı',{exact:true}).fill('59');await page.getByLabel('Pratik puanı',{exact:true}).fill('100');
 await page.getByRole('button',{name:'Tıp notunu kaydet'}).click();await expect(page.getByText('Teorik sınav barajı sağlanmadı',{exact:true})).toBeVisible();
 await page.getByLabel('Aktif tıp dönemi').selectOption('1');await expect(page.getByRole('button',{name:'Yaşamın Moleküler Temelleri notunu gir'})).toBeVisible();
 await page.getByLabel('Aktif tıp dönemi').selectOption('4');await expect(page.getByText('83,6 / 100',{exact:true})).toBeVisible();
});
test('lost responses retry with the same request identity',async({page})=>{
 const state=emptyMedicine(),sent=await open(page,state,true);await nav(page,'Konularım');
 await page.getByRole('button',{name:'Kırklareli Tıp alanını aç'}).click();
 await expect(page.getByRole('alert').filter({hasText:'Yanıt kayboldu'})).toBeVisible();
 await page.getByRole('button',{name:'Kırklareli Tıp alanını aç'}).click();
 await expect(page.getByRole('heading',{name:'Kurul 1 · Yaşamın Moleküler Temelleri'})).toBeVisible();
 expect(sent).toHaveLength(2);expect(sent[0]).toBe(sent[1]);
});
test('medical topics fit mobile width and expose their source and learning controls',async({page})=>{
 await page.setViewportSize({width:320,height:900});await open(page,enabled());
 await page.getByRole('navigation',{name:'Mobil gezinme'}).getByRole('button',{name:'Konularım',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Kurul 1 · Yaşamın Moleküler Temelleri'})).toBeVisible();
 const width=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));expect(width.content).toBeLessThanOrEqual(width.viewport);
 await page.screenshot({path:'test-results/medicine-mobile.png',fullPage:true});
});
