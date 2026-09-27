import {expect,test,type Page} from '@playwright/test';
import {emptyState,type AppState,type ExamRecord} from '../../src/lib/domain/types';

const now='2026-09-24T09:00:00.000Z';
function state():AppState{
 const value={...emptyState(true),authenticated:true,server_now:now};
 value.exam_formats=[{code:'TYT',version:1,label:'TYT',total_questions:80,wrong_divisor:4,sections:[
  {key:'turkce',label:'Türkçe',question_count:40},{key:'matematik',label:'Matematik',question_count:40},
 ]}];
 return value;
}
async function open(page:Page,value:AppState){
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/api/state',route=>route.fulfill({json:value}));
 await page.route('**/api/calendar/today',route=>route.fulfill({json:{connected:false,date:'2026-09-24',timezone:'Europe/Istanbul',events:[],refreshedAt:null}}));
 await page.goto('/');
}
async function navigate(page:Page,label:string){
 await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:label,exact:true}).click();
}

test('exam form saves a numbered name and today with only the total net',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];
 const format=value.exam_formats[0];
 value.exams=[1,2].map(index=>({
  id:'existing-'+index,name:index+'. deneme',publisher:'',exam_date:'2026-09-2'+index,
  format_code:'TYT' as const,format_version:1,format_snapshot:format,duration_minutes:null,
  notes:'',score:null,rank:null,source_document_id:null,import_metadata:null,results:[],
  reported_total_net:40+index,total_net:40+index,total_net_source:'reported' as const,
  revision:1,created_at:now,updated_at:now,
 }));
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await expect(page.getByRole('button',{name:'PDF yükle'})).toHaveCount(0);
 await page.getByRole('button',{name:'Deneme ekle'}).click();
 const dialog=page.getByRole('dialog',{name:'Yeni deneme ekle'});
 await expect(dialog.getByLabel('Deneme adı')).toHaveAttribute('placeholder','Boşsa 3. deneme');
 await expect(dialog.locator('.exam-editor-date summary')).toContainText('24 Eyl 2026');
 await expect(dialog.locator('input[name="exam_date"]')).toHaveValue('2026-09-24');
 await expect(dialog.locator('input[name="exam_date"]')).not.toBeVisible();
 await expect(dialog.getByText('Yayın',{exact:true})).toHaveCount(0);
 await expect(dialog.getByText('Ders sonuçları',{exact:true})).toHaveCount(0);
 await dialog.getByLabel('Toplam net').fill('42.5');
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(dialog).not.toBeVisible();
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({type:'exam.create',payload:{name:'3. deneme',exam_date:'2026-09-24',format_code:'TYT',reported_total_net:42.5,results:[]}});
 for(const removed of ['publisher','duration_minutes','score','rank'])expect(requests[0].payload).not.toHaveProperty(removed);
});

test('editing old exams keeps their saved subject results',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];const format=value.exam_formats[0];
 const complete:ExamRecord={
  id:'complete',name:'Tam sonuç',publisher:'',exam_date:'2026-09-22',
  format_code:'TYT',format_version:1,format_snapshot:format,duration_minutes:null,
  notes:'',score:null,rank:null,source_document_id:null,import_metadata:null,
  results:[{section_key:'turkce',correct:null,wrong:null,blank:null,net:20},{section_key:'matematik',correct:null,wrong:null,blank:null,net:20}],
  reported_total_net:null,total_net:40,total_net_source:'sections',revision:1,created_at:now,updated_at:now,
 };
 value.exams=[complete,{...complete,id:'partial',name:'Kısmi sonuç',exam_date:'2026-09-23',
  results:complete.results.slice(0,1),total_net:null,total_net_source:null}];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Tam sonuç düzenle'}).click();
 const completeDialog=page.getByRole('dialog',{name:'Denemeyi düzenle'});
 await expect(completeDialog.locator('input[name="reported_total_net"]')).toHaveJSProperty('readOnly',true);
 await completeDialog.getByLabel('Deneme adı').fill('Tam sonuç düzeltildi');
 await completeDialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(completeDialog).not.toBeVisible();
 expect(requests[0]).toMatchObject({type:'exam.update',payload:{id:'complete',name:'Tam sonuç düzeltildi'}});
 expect(requests[0].payload).not.toHaveProperty('results');
 expect(requests[0].payload).not.toHaveProperty('reported_total_net');

 await page.getByRole('button',{name:'Kısmi sonuç düzenle'}).click();
 const partialDialog=page.getByRole('dialog',{name:'Denemeyi düzenle'});
 await expect(partialDialog.locator('input[name="reported_total_net"]')).not.toHaveAttribute('required');
 await partialDialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(partialDialog).not.toBeVisible();
 expect(requests[1]).toMatchObject({type:'exam.update',payload:{id:'partial'}});
 expect(requests[1].payload).not.toHaveProperty('results');
 expect(requests[1].payload).not.toHaveProperty('reported_total_net');
});

test('journal keeps original writing and excludes private fields from future AI sharing',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Günlüğüm');
 await page.getByLabel('Bugün aklında neler kaldı?').fill('  Kendi cümlem.\nİkinci satır.  ');
 await page.getByRole('button',{name:'İsteğe bağlı alanlar'}).click();
 await page.getByLabel('Ruh hâli').fill('İyi');
 await page.getByRole('checkbox',{name:/Analize dahil etme/}).check();
 await page.getByRole('button',{name:'Günlüğü kaydet'}).click();
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({type:'journal.create',payload:{journal_date:'2026-09-24',original_text:'  Kendi cümlem.\nİkinci satır.  ',structured_fields:{mood:'İyi'},exclude_from_analysis:true,ai_shared_fields:[]}});
});

test('study report marks a day explicitly and opens its matching journal date',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Çalışma İstatistikleri');
 await page.locator('.stats-chart-time .stats-bar').nth(2).click();
 await page.getByRole('button',{name:'Dinlenme günü'}).click();
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({type:'day.mark',payload:{mark_date:'2026-09-23',kind:'rest'}});
 await page.getByRole('button',{name:'Günlük yok'}).click();
 await expect(page.getByLabel('Günlük tarihi')).toHaveValue('2026-09-23');
});

test('journal AI suggestion stays a review draft until explicit save',async({page})=>{
 const value=state();const commands:Record<string,unknown>[]=[];const suggestions:Record<string,unknown>[]=[];
 await page.route('**/api/command',route=>{commands.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await page.route('**/api/journal/suggest',route=>{
  suggestions.push(route.request().postDataJSON());
  return route.fulfill({json:{ok:true,fields:{wake_at:'07:30',mood:'İyi'},usage:{input_tokens:80,output_tokens:40,estimated_cost_usd:0.003}}});
 });
 await open(page,value);await navigate(page,'Günlüğüm');
 const original='07:30 uyandım. Ruh hâlim İyi.';
 await page.getByLabel('Bugün aklında neler kaldı?').fill(original);
 await page.getByRole('button',{name:'AI ile öner'}).click();
 const review=page.getByRole('region',{name:'AI günlük alan önerileri'});
 await expect(review).toBeVisible();
 await expect(page.getByLabel('Bugün aklında neler kaldı?')).toHaveValue(original);
 expect(suggestions).toHaveLength(1);
 expect(suggestions[0]).toMatchObject({journal_date:'2026-09-24',original_text:original});
 expect(commands).toHaveLength(0);
 await review.getByRole('button',{name:'Boş alanlara uygula'}).click();
 await expect(page.getByRole('textbox',{name:'Uyanma saati'})).toHaveValue('07:30');
 await expect(page.getByRole('textbox',{name:'Ruh hâli'})).toHaveValue('İyi');
 expect(commands).toHaveLength(0);
 await page.getByRole('button',{name:'Günlüğü kaydet'}).click();
 expect(commands).toHaveLength(1);
 expect(commands[0]).toMatchObject({type:'journal.create',payload:{
  original_text:original,structured_fields:{wake_at:'07:30',mood:'İyi'},
  exclude_from_analysis:false,ai_shared_fields:[],
 }});
});
