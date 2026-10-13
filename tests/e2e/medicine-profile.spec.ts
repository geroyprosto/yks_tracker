import {expect,test,type Page} from '@playwright/test';
import {emptyState,type AppState} from '../../src/lib/domain/types';
import {defaultModules,educationCommandSchema,emptyEducation,type EducationCommand} from '../../src/lib/education';
import {emptyMedicine,medicineCommandSchema,type MedicineCommand} from '../../src/lib/medicine';
import catalog from '../../src/lib/catalogs/klu-medicine-2026.json';

const stamp='2026-10-14T10:00:00.000Z';
const termId='20000000-0000-4000-8000-000000000001';
const program='Kırklareli Üniversitesi Tıp';

function fixture(onboarding=false):AppState {
 const education=emptyEducation();education.can_commit=true;education.needs_onboarding=onboarding;
 if(!onboarding){
  education.profile={education_level:'high_school',yks_goal:true,grade:12,department:'',university_year:'',yks_track:'sayisal',modules:{...defaultModules},active_term_id:termId,onboarding_completed_at:stamp,revision:1};
  education.terms=[{id:termId,academic_year:'2026–2027',name:'Yıllık',starts_on:null,ends_on:null,archived:false,revision:1,created_at:stamp}];
 }
 return {...emptyState(true),authenticated:true,server_now:stamp,education};
}

async function prepare(page:Page,state:AppState,loseFirstMedicineResponse=false){
 const medicine=emptyMedicine(),educationRequests:EducationCommand[]=[],medicineRequests:MedicineCommand[]=[];
 const receipts=new Set<string>();let lost=false;
 await page.clock.setFixedTime(new Date(stamp));
 // Every profile and study record is synthetic; connected integrations stay inert.
 await page.route('**/api/calendar/today',route=>route.fulfill({json:{connected:false,date:'2026-10-14',timezone:'Europe/Istanbul',events:[],refreshedAt:null}}));
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/education',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:state.education});
  const command=educationCommandSchema.parse(route.request().postDataJSON());educationRequests.push(command);
  const education=state.education!;
  if(command.type==='draft.save'){
   education.draft={step:command.payload.step,data:command.payload.data,revision:(education.draft?.revision??0)+1,updated_at:stamp};
  }else if(command.type==='profile.save'){
   const {profile,term}=command.payload;
   education.profile={...profile,active_term_id:term?term.id??termId:null,onboarding_completed_at:stamp,revision:(education.profile?.revision??0)+1};
   education.terms=term?[{...term,id:term.id??termId,starts_on:term.starts_on??null,ends_on:term.ends_on??null,archived:false,revision:1,created_at:stamp}]:[];
   education.draft=null;education.needs_onboarding=false;
  }else throw new Error('Unexpected education mutation: '+command.type);
  await route.fulfill({json:{ok:true,result:{id:command.request_id,request_id:command.request_id,replayed:false},state:education}});
 });
 await page.route('**/api/medicine',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:medicine});
  const command=medicineCommandSchema.parse(route.request().postDataJSON());medicineRequests.push(command);
  expect(command.type).toBe('profile.save');
  if(command.type!=='profile.save')throw new Error('Unexpected medicine mutation');
  // The education profile must already be saved before opening its medicine area.
  expect(state.education!.profile?.department).toBe(program);
  if(!receipts.has(command.request_id)){
   medicine.profile={academic_year:command.payload.academic_year,active_year:command.payload.active_year,enabled:command.payload.enabled,catalog_version:'klu-2026-2027',revision:(medicine.profile?.revision??0)+1};
   receipts.add(command.request_id);
  }
  if(loseFirstMedicineResponse&&!lost){lost=true;return route.fulfill({status:503,json:{error:{message:'Yanıt kayboldu; aynı kaydı yeniden dene.'}}});}
  await route.fulfill({json:{ok:true,state:medicine}});
 });
 await page.goto('/');
 return {medicine,educationRequests,medicineRequests};
}

async function nav(page:Page,name:string){await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name,exact:true}).click();}
async function editProfile(page:Page){
 await nav(page,'Ayarlar');
 await page.getByRole('button',{name:'Öğrenci alanım',exact:true}).click();
 await page.getByRole('button',{name:'Profilimi düzenle',exact:true}).click();
}
async function selectMedicine(page:Page,year:number){
 await page.getByRole('radio',{name:/Üniversitede okuyorum/}).check();
 await page.getByRole('combobox',{name:'Üniversite programı',exact:true}).selectOption({label:program});
 await page.getByRole('combobox',{name:'Tıp dönemin',exact:true}).selectOption(String(year));
 await page.getByRole('checkbox',{name:/YKS’ye hazırlanıyorum/}).uncheck();
}
async function reviewProfile(page:Page){
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Bu dönemine bir ad ver.'})).toBeVisible();
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Hangi derslerle başlayalım?'})).toBeVisible();
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Son bir bakış.'})).toBeVisible();
}
async function expectMedicineTopics(page:Page,year:number){
 await nav(page,'Konularım');
 const unit=catalog.units.find(row=>row.year===year&&row.kind!=='keg')!;
 const heading=unit.kind==='kurul'?`Kurul ${unit.id.split('k').at(-1)} · ${unit.name}`:`Staj · ${unit.name}`;
 await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
 await expect(page.getByLabel('Aktif tıp dönemi',{exact:true})).toHaveValue(String(year));
 await expect(page.getByRole('button',{name:'Kırklareli Tıp alanını aç',exact:true})).toHaveCount(0);
}

test('the profile editor enables Kırklareli medicine for an existing high-school student and preserves the selected semester',async({page})=>{
 const state=fixture(),{medicine,educationRequests}=await prepare(page,state);
 await editProfile(page);await selectMedicine(page,3);
 await expect(page.getByRole('combobox',{name:'Üniversite programı',exact:true}).getByRole('option')).toHaveText(['Diğer bölüm',program]);
 await expect(page.getByRole('combobox',{name:'Tıp dönemin',exact:true}).getByRole('option')).toHaveText(['Dönem 1','Dönem 2','Dönem 3','Dönem 4']);
 await page.screenshot({path:'test-results/medicine-profile-selection.png',fullPage:true});
 await reviewProfile(page);
 await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
 await expectMedicineTopics(page,3);
 expect(state.education!.profile).toMatchObject({education_level:'university',yks_goal:false,grade:null,department:program,university_year:'Dönem 3'});
 expect(medicine.profile).toMatchObject({enabled:true,active_year:3,academic_year:'2026-2027'});
 expect(educationRequests.filter(command=>command.type==='profile.save')).toHaveLength(1);
 await page.reload();await expectMedicineTopics(page,3);await editProfile(page);
 await expect(page.getByRole('combobox',{name:'Üniversite programı',exact:true})).toHaveValue('klu-medicine');
 await expect(page.getByRole('combobox',{name:'Tıp dönemin',exact:true})).toHaveValue('3');
 await expect(page.getByRole('checkbox',{name:/YKS’ye hazırlanıyorum/})).not.toBeChecked();
});

test('new onboarding opens the selected Kırklareli medicine semester with the YKS goal disabled',async({page})=>{
 const state=fixture(true),{medicine}=await prepare(page,state);
 await selectMedicine(page,4);await reviewProfile(page);
 await page.getByRole('button',{name:'Çalışma alanımı oluştur',exact:true}).click();
 await expectMedicineTopics(page,4);
 expect(state.education!.needs_onboarding).toBe(false);
 expect(state.education!.profile).toMatchObject({department:program,university_year:'Dönem 4',yks_goal:false});
 expect(medicine.profile).toMatchObject({enabled:true,active_year:4});
 await page.reload();await expectMedicineTopics(page,4);
});

test('a lost medicine activation response keeps the profile editor open and retries without duplicating the education save',async({page})=>{
 const state=fixture(),{medicine,educationRequests,medicineRequests}=await prepare(page,state,true);
 await editProfile(page);await selectMedicine(page,2);await reviewProfile(page);
 await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Yanıt kayboldu'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Son bir bakış.'})).toBeVisible();
 await expect(page.getByLabel('Çalışma Alanımın Özeti')).toContainText('Dönem 2');
 await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
 await expectMedicineTopics(page,2);
 expect(educationRequests.filter(command=>command.type==='profile.save')).toHaveLength(1);
 expect(medicineRequests).toHaveLength(2);
 expect(medicineRequests[0]).toEqual(medicineRequests[1]);
 expect(medicine.profile).toMatchObject({enabled:true,active_year:2,revision:1});
});

test('an invalid medicine academic year is rejected before saving either profile',async({page})=>{
 const state=fixture(),original=structuredClone(state.education),{medicine,educationRequests,medicineRequests}=await prepare(page,state);
 await editProfile(page);await selectMedicine(page,1);
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByLabel('Eğitim yılı',{exact:true}).fill('2026-2028');
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'ardışık iki yıl'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Son bir bakış.'})).toBeVisible();
 expect(educationRequests).toEqual([]);expect(medicineRequests).toEqual([]);
 expect(state.education).toEqual(original);expect(medicine.profile).toBeNull();
});

for(const universityYear of ['', 'Dönem 5']){
 test(`an older manually entered medicine department defaults its ${universityYear?'unsupported':'blank'} semester to period one`,async({page})=>{
  const state=fixture();
  state.education!.profile={...state.education!.profile!,education_level:'university',grade:null,yks_goal:false,department:program,university_year:universityYear};
  const {medicine}=await prepare(page,state);
  await editProfile(page);
  await expect(page.getByRole('combobox',{name:'Üniversite programı',exact:true})).toHaveValue('klu-medicine');
  await expect(page.getByRole('combobox',{name:'Tıp dönemin',exact:true})).toHaveValue('1');
  await reviewProfile(page);await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
  await expectMedicineTopics(page,1);
  expect(state.education!.profile?.university_year).toBe('Dönem 1');
  expect(medicine.profile).toMatchObject({enabled:true,active_year:1});
 });
}
