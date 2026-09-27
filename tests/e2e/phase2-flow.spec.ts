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

test('exam form calculates net and a score from subject answers without a blank field',async({page})=>{
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
 await expect(dialog.getByRole('spinbutton',{name:/boş/i})).toHaveCount(0);
 await expect(dialog.locator('input[name="reported_total_net"]')).toHaveCount(0);
 await dialog.getByLabel('Türkçe doğru').fill('10');
 await dialog.getByLabel('Türkçe yanlış').fill('5');
 await dialog.getByLabel('Matematik doğru').fill('20');
 await dialog.getByLabel('Matematik yanlış').fill('4');
 await expect(dialog.getByText('Tahmini deneme puanı')).toBeVisible();
 await expect(dialog.getByText('27,75',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(dialog).not.toBeVisible();
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({type:'exam.create',payload:{name:'3. deneme',exam_date:'2026-09-24',format_code:'TYT'}});
 const payload=requests[0].payload as Record<string,unknown>;
 expect(payload.results).toEqual([
  {section_key:'turkce',correct:10,wrong:5},
  {section_key:'matematik',correct:20,wrong:4},
 ]);
 expect(payload).not.toHaveProperty('reported_total_net');
 expect(payload).not.toHaveProperty('score');
 for(const removed of ['publisher','duration_minutes','rank'])expect(requests[0].payload).not.toHaveProperty(removed);
});

test('exam form blocks correct and wrong totals above a subject question count',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Deneme ekle'}).click();
 const dialog=page.getByRole('dialog',{name:'Yeni deneme ekle'});
 await dialog.getByLabel('Türkçe doğru').fill('40');
 await dialog.getByLabel('Türkçe yanlış').fill('1');
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(dialog).toBeVisible();
 expect(requests).toHaveLength(0);
});

test('AYT Sayısal uses the section question counts for unanswered questions and score',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];
 value.exam_formats.push({code:'AYT_SAYISAL',version:1,label:'AYT Sayısal',total_questions:80,wrong_divisor:4,sections:[
  {key:'matematik',label:'Matematik',question_count:40},
  {key:'fizik',label:'Fizik',question_count:14},
  {key:'kimya',label:'Kimya',question_count:13},
  {key:'biyoloji',label:'Biyoloji',question_count:13},
 ]});
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Deneme ekle'}).click();
 const dialog=page.getByRole('dialog',{name:'Yeni deneme ekle'});
 await dialog.locator('.exam-editor-top select').selectOption('AYT_SAYISAL');
 await dialog.getByLabel('Fizik doğru').fill('7');
 await dialog.getByLabel('Fizik yanlış').fill('3');
 await expect(dialog.getByRole('spinbutton',{name:/boş/i})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(dialog).not.toBeVisible();
 expect(requests).toHaveLength(1);
 const payload=requests[0].payload as Record<string,unknown>;
 expect(payload.format_code).toBe('AYT_SAYISAL');
 expect(payload.results).toHaveLength(4);
 expect(payload.results).toContainEqual({section_key:'fizik',correct:7,wrong:3});
 expect(payload).not.toHaveProperty('score');
});

test('editing a complete exam recalculates subject answers and preserves net-only legacy records',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];const format=value.exam_formats[0];
 const complete:ExamRecord={
  id:'complete',name:'Tam sonuç',publisher:'',exam_date:'2026-09-22',
  format_code:'TYT',format_version:1,format_snapshot:format,duration_minutes:null,
  notes:'',score:312.5,rank:null,source_document_id:null,import_metadata:null,
  results:[{section_key:'turkce',correct:28,wrong:8,blank:4,net:26},{section_key:'matematik',correct:16,wrong:8,blank:16,net:14}],
  reported_total_net:null,total_net:40,total_net_source:'sections',revision:1,created_at:now,updated_at:now,
 };
 value.exams=[complete,{...complete,id:'legacy',name:'Eski net sonucu',exam_date:'2026-09-23',
  results:[{section_key:'turkce',correct:null,wrong:null,blank:null,net:20},{section_key:'matematik',correct:null,wrong:null,blank:null,net:20}]}];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Tam sonuç düzenle'}).click();
 const completeDialog=page.getByRole('dialog',{name:'Denemeyi düzenle'});
 await expect(completeDialog.getByLabel('Türkçe doğru')).toHaveValue('28');
 await expect(completeDialog.getByLabel('Türkçe yanlış')).toHaveValue('8');
 await completeDialog.getByLabel('Türkçe doğru').fill('30');
 await completeDialog.getByLabel('Türkçe yanlış').fill('5');
 await completeDialog.getByLabel('Deneme adı').fill('Tam sonuç düzeltildi');
 await completeDialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(completeDialog).not.toBeVisible();
 expect(requests[0]).toMatchObject({type:'exam.update',payload:{id:'complete',name:'Tam sonuç düzeltildi'}});
 expect((requests[0].payload as Record<string,unknown>).results).toEqual([
  {section_key:'turkce',correct:30,wrong:5},
  {section_key:'matematik',correct:16,wrong:8,blank:16},
 ]);
 expect((requests[0].payload as Record<string,unknown>)).not.toHaveProperty('score');
 expect((requests[0].payload as Record<string,unknown>).reported_total_net).toBeNull();

 await page.getByRole('button',{name:'Eski net sonucu düzenle'}).click();
 const legacyDialog=page.getByRole('dialog',{name:'Denemeyi düzenle'});
 await legacyDialog.getByLabel('Deneme adı').fill('Eski net sonucu düzeltildi');
 await legacyDialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(legacyDialog).not.toBeVisible();
 expect(requests[1]).toMatchObject({type:'exam.update',payload:{id:'legacy',name:'Eski net sonucu düzeltildi'}});
 expect(requests[1].payload).not.toHaveProperty('results');
 expect(requests[1].payload).not.toHaveProperty('reported_total_net');
});

test('editing one old net-only subject keeps the other subject and recorded score',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];const format=value.exam_formats[0];
 value.exams=[{
  id:'mixed',name:'Eski ders netleri',publisher:'',exam_date:'2026-09-22',
  format_code:'TYT',format_version:1,format_snapshot:format,duration_minutes:null,
  notes:'',score:315,rank:null,source_document_id:null,import_metadata:null,
  results:[{section_key:'turkce',correct:null,wrong:null,blank:null,net:20},{section_key:'matematik',correct:null,wrong:null,blank:null,net:15}],
  reported_total_net:null,total_net:35,total_net_source:'sections',revision:1,created_at:now,updated_at:now,
 }];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Eski ders netleri düzenle'}).click();
 const dialog=page.getByRole('dialog',{name:'Denemeyi düzenle'});
 await dialog.getByLabel('Türkçe doğru').fill('10');
 await dialog.getByLabel('Türkçe yanlış').fill('5');
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 expect(requests[0].payload).toMatchObject({
  results:[{section_key:'turkce',correct:10,wrong:5},{section_key:'matematik',net:15}],
  reported_total_net:null,
 });
 expect(requests[0].payload).not.toHaveProperty('score');
});

test('replacing an old overall net requires complete subject answers',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];const format=value.exam_formats[0];
 value.exams=[{
  id:'reported',name:'Eski toplam net',publisher:'',exam_date:'2026-09-22',
  format_code:'TYT',format_version:1,format_snapshot:format,duration_minutes:null,
  notes:'',score:300,rank:null,source_document_id:null,import_metadata:null,results:[],
  reported_total_net:35,total_net:35,total_net_source:'reported',revision:1,created_at:now,updated_at:now,
 }];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Eski toplam net düzenle'}).click();
 const dialog=page.getByRole('dialog',{name:'Denemeyi düzenle'});
 await dialog.getByLabel('Türkçe doğru').fill('10');
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(dialog.getByRole('alert')).toContainText('her dersin doğru ve yanlışını gir');
 expect(requests).toHaveLength(0);
 await dialog.getByLabel('Matematik doğru').fill('0');
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 expect(requests).toHaveLength(1);
 expect(requests[0].payload).toMatchObject({reported_total_net:null,
  results:[{section_key:'turkce',correct:10,wrong:0},{section_key:'matematik',correct:0,wrong:0}]});
 expect(requests[0].payload).not.toHaveProperty('score');
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
