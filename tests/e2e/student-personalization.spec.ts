import {expect,test,type Page,type Route} from '@playwright/test';
import {emptyState,type AppState} from '../../src/lib/domain/types';
import {defaultModules,emptyEducation,type EducationCommand} from '../../src/lib/education';

const stamp='2026-09-27T10:00:00.000Z';
const termId='10000000-0000-4000-8000-000000000001';
const courseId='10000000-0000-4000-8000-000000000002';
function fixture(onboarding=false):AppState {
 const education=emptyEducation();education.can_commit=true;education.needs_onboarding=onboarding;
 if(!onboarding){
  education.profile={education_level:'university',yks_goal:false,grade:null,department:'Uluslararası Ticaret',university_year:'1',yks_track:'undecided',modules:{...defaultModules},active_term_id:termId,onboarding_completed_at:stamp,revision:1};
  education.terms=[{id:termId,academic_year:'2026–2027',name:'Güz',starts_on:null,ends_on:null,archived:false,revision:1,created_at:stamp}];
  education.courses=[{id:courseId,term_id:termId,name:'Matematik',normalized_name:'matematik',context:'school',exam:null,archived:false,revision:1,created_at:stamp,updated_at:stamp}];
 }
 return {...emptyState(true),authenticated:true,server_now:stamp,education};
}
async function prepare(page:Page){
 await page.clock.setFixedTime(new Date(stamp));
 // External integrations remain inert; all study/profile rows below are synthetic.
 await page.route('**/api/calendar/today',route=>route.fulfill({json:{connected:false,date:'2026-09-27',timezone:'Europe/Istanbul',events:[],refreshedAt:null}}));
}
async function settings(page:Page){
 await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:'Ayarlar',exact:true}).click();
 await page.getByRole('button',{name:'Öğrenci alanım',exact:true}).click();
 await page.getByRole('button',{name:'Profilimi düzenle',exact:true}).click();
}

test('a delayed state GET cannot replace a newer atomic education result',async({page})=>{
 const state=fixture(),stale=structuredClone(state),requests:EducationCommand[]=[];
 let nextReadArmed=false,heldReads=0;
 let captured:(route:Route)=>void=()=>{};
 const delayed=new Promise<Route>(resolve=>{captured=resolve;});
 await prepare(page);
 await page.route('**/api/state',async route=>{
  if(nextReadArmed){nextReadArmed=false;heldReads++;captured(route);return;}
  await route.fulfill({json:state});
 });
 await page.route('**/api/education',async route=>{
  const request=route.request().postDataJSON() as EducationCommand;requests.push(request);
  expect(request.type).toBe('results.batch');
  if(request.type!=='results.batch')throw new Error('Unexpected mutation');
  state.education!.results=request.payload.rows.map((row,index)=>({...row,assessment_name:row.assessment_name??'',id:'result-'+index,term_id:termId,course_name:'Matematik',revision:1,created_at:stamp,updated_at:stamp}));
  await route.fulfill({json:{ok:true,state:state.education}});
 });
 await page.goto('/');
 await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:'Sınav Sonuçları',exact:true}).click();
 await page.getByRole('button',{name:'Hızlı sonuç girişini aç'}).click();
 await expect(page.getByLabel('Matematik puanı',{exact:true})).toBeVisible();
 // Arm only after the UI is ready: development Strict Mode may issue two initial reads.
 nextReadArmed=true;
 // Begin an ordinary focus refresh BEFORE the write, and hold its old response.
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const staleRoute=await delayed;
 await page.getByLabel('Matematik puanı',{exact:true}).fill('72');
 await page.getByRole('button',{name:'Tümünü kaydet',exact:true}).click();
 const course=page.getByRole('button',{name:/Matematik.*1 sonuç.*72 \/ 100/});
 await expect(course).toBeVisible();
 await course.click();
 const results=page.getByRole('region',{name:'Matematik sınav sonuçları'});
 await expect(results).toContainText('72 / 100');expect(requests).toHaveLength(1);
 const received=page.waitForResponse(response=>response.request()===staleRoute.request());
 await staleRoute.fulfill({json:stale});
 await (await received).finished();
 // Let React process the old response, rather than asserting before it arrives.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
 await expect(results).toContainText('72 / 100');
 await expect(page.getByRole('button',{name:'Matematik Vize 2026-09-27 sonucunu düzenle'})).toHaveCount(1);
 expect(state.education!.results[0].score).toBe(72);expect(heldReads).toBe(1);
});

test('canceling edited profile, term, courses and modules sends no persistent command',async({page})=>{
 const state=fixture(),original=structuredClone(state.education),requests:EducationCommand[]=[];
 await prepare(page);await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/education',route=>{requests.push(route.request().postDataJSON() as EducationCommand);return route.fulfill({status:500,json:{error:{message:'Cancel must not write'}}});});
 await page.goto('/');await settings(page);
 await page.getByLabel('Bölüm (isteğe bağlı)').fill('İptal edilecek bölüm');
 await page.getByRole('checkbox',{name:/YKS’ye hazırlanıyorum/}).check();
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByLabel('Dönem adı',{exact:true}).fill('İptal edilecek dönem');
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByRole('textbox',{name:'Derslerini alt alta yaz'}).fill('İstatistik');
 await page.getByRole('button',{name:'Bu dersleri ekle',exact:true}).click();
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByRole('checkbox',{name:/Günlük/}).uncheck();
 await page.getByRole('button',{name:'İptal',exact:true}).click();
 await expect(page.getByRole('button',{name:'Profilimi düzenle',exact:true})).toBeVisible();
 expect(requests).toEqual([]);expect(state.education).toEqual(original);
 await page.getByRole('button',{name:'Profilimi düzenle',exact:true}).click();
 await expect(page.getByLabel('Bölüm (isteğe bağlı)')).toHaveValue('Uluslararası Ticaret');
 await expect(page.getByRole('checkbox',{name:/YKS’ye hazırlanıyorum/})).not.toBeChecked();
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await expect(page.getByLabel('Dönem adı',{exact:true})).toHaveValue('Güz');
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await expect(page.getByLabel('Çalışma Alanımın Özeti')).toContainText('1 ders');
 await expect(page.getByRole('button',{name:'İstatistik seçimini kaldır',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:/Günlük/})).toBeChecked();
 expect(requests).toEqual([]);
});

test('new onboarding saves a partial draft, preserves back navigation and resumes after reload',async({page})=>{
 const state=fixture(true),requests:EducationCommand[]=[];
 await prepare(page);await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/education',async route=>{
  const request=route.request().postDataJSON() as EducationCommand;requests.push(request);
  expect(request.type).toBe('draft.save');
  if(request.type!=='draft.save')throw new Error('Onboarding must remain a draft until explicit completion');
  expect(request.payload.expected_revision).toBe(state.education!.draft?.revision??0);
  state.education!.draft={step:request.payload.step,data:request.payload.data,revision:(state.education!.draft?.revision??0)+1,updated_at:stamp};
  await route.fulfill({json:{ok:true,state:state.education}});
 });
 await page.goto('/');
 await page.getByRole('radio',{name:/Üniversitede okuyorum/}).check();
 await page.getByRole('checkbox',{name:/YKS’ye hazırlanıyorum/}).uncheck();
 await page.getByLabel('Bölüm (isteğe bağlı)').fill('Uluslararası Ticaret');
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Bu dönemine bir ad ver.'})).toBeFocused();
 await page.getByLabel('Dönem adı',{exact:true}).fill('Güz');
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByRole('textbox',{name:'Derslerini alt alta yaz'}).fill('Matematik\nİktisat');
 await page.getByRole('button',{name:'Bu dersleri ekle',exact:true}).click();
 await page.getByRole('button',{name:'Geri',exact:true}).click();
 await expect(page.getByLabel('Dönem adı',{exact:true})).toHaveValue('Güz');
 await page.getByRole('button',{name:'İleri',exact:true}).click();
 await page.getByRole('button',{name:'Taslağı kaydet',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Taslağın kaydedildi');
 await page.reload();
 await expect(page.getByRole('heading',{name:'Hangi derslerle başlayalım?'})).toBeVisible();
 await expect(page.getByLabel('Çalışma Alanımın Özeti')).toContainText('2 ders');
 await expect(page.getByRole('button',{name:'Matematik seçimini kaldır',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'İktisat seçimini kaldır',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Geri',exact:true}).click();
 await expect(page.getByLabel('Dönem adı',{exact:true})).toHaveValue('Güz');
 await page.getByRole('button',{name:'Geri',exact:true}).click();
 await expect(page.getByRole('radio',{name:/Üniversitede okuyorum/})).toBeChecked();
 await expect(page.getByLabel('Bölüm (isteğe bağlı)')).toHaveValue('Uluslararası Ticaret');
 expect(requests.every(request=>request.type==='draft.save')).toBe(true);
 expect(state.education!.profile).toBeNull();expect(state.education!.needs_onboarding).toBe(true);
});

test('a conflict immediately refreshes server state while preserving the unsaved task draft',async({page})=>{
 const state=fixture();
 let readsAfterConflict=0,commands=0;
 await prepare(page);
 await page.route('**/api/state',route=>{if(commands>0)readsAfterConflict++;return route.fulfill({json:state});});
 await page.route('**/api/command',route=>{
  commands++;
  state.tasks=[{id:'task-from-second-device',title:'Diğer cihazın görevi',plan_date:'2026-09-27',course_id:courseId,exam:null,subject:'Matematik',topic_id:null,resource:'',completion_criteria:'',planned_minutes:30,difficulty:'medium',progress:0,weight_override:null,priority:'normal',position:0,notes:'',study_type:'Tekrar',steps:[],revision:2,created_at:stamp,updated_at:stamp}];
  return route.fulfill({status:409,json:{ok:false,error:{code:'CONFLICT',message:'Plan diğer cihazda değişti.'}}});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Günü planla',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Yeni görev'});
 await dialog.getByLabel('Görev başlığı').fill('Korunacak görev taslağı');
 await dialog.getByRole('button',{name:'Görevi kaydet',exact:true}).click();
 await expect(dialog.getByRole('alert')).toHaveText('Plan diğer cihazda değişti.');
 await expect(dialog.getByLabel('Görev başlığı')).toHaveValue('Korunacak görev taslağı');
 await expect.poll(()=>readsAfterConflict).toBeGreaterThan(0);
 expect(commands).toBe(1);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('heading',{name:'Diğer cihazın görevi',exact:true})).toBeVisible();
});
