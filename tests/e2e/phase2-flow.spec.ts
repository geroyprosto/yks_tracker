import {expect,test,type Page} from '@playwright/test';
import {emptyState,type AppState} from '../../src/lib/domain/types';
import type {ImportDocument} from '../../src/lib/exam-import/types';

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

test('reported overall net is submitted without fabricated subject rows',async({page})=>{
 const value=state();const requests:Record<string,unknown>[]=[];
 await page.route('**/api/command',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,state:value}})});
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'Deneme ekle'}).click();
 const dialog=page.getByRole('dialog',{name:'Yeni deneme ekle'});
 await dialog.getByLabel('Deneme adı').fill('TYT genel net');
 await dialog.getByLabel('Yalnız genel net').fill('42.5');
 await dialog.getByRole('button',{name:'Denemeyi kaydet'}).click();
 await expect(dialog).not.toBeVisible();
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({type:'exam.create',payload:{name:'TYT genel net',format_code:'TYT',reported_total_net:42.5,score:null,rank:null,results:[]}});
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

test('PDF duplicate warning requires an explicit second confirmation',async({page})=>{
 const value=state();
 const draft:ImportDocument={id:'e45005d8-465d-4962-9b56-f0b8b83128b8',original_filename:'sonuc.pdf',sha256:'a'.repeat(64),page_count:1,extraction_status:'ready',visual_extraction_status:'not_needed',committed_candidate_indexes:[],created_at:now,candidates:[{index:0,label:'TYT sonucu',student_label:null,format_code:'TYT',exam_date:'2026-09-24',name:'TYT net sonucu',publisher:null,results:[],reported_total_net:42.5,reported_total_source:{source_page:1,raw:'Toplam net: 42,5',uncertain:false},source_pages:[1],warnings:[]}]};
 let commits=0;const submitted:Record<string,unknown>[]=[];
 await page.route('**/api/exam-import/drafts',route=>route.fulfill({json:{documents:[draft]}}));
 await page.route('**/api/exam-import/commit',route=>{
  submitted.push(route.request().postDataJSON());commits++;
  return route.fulfill(commits===1?{status:409,json:{error:{code:'POSSIBLE_DUPLICATE',message:'Benzer bir deneme kaydı var.'}}}:{json:{id:'created',replayed:false,state:value}});
 });
 await page.route(`**/api/exam-import/${draft.id}`,route=>route.fulfill({json:draft}));
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'PDF yükle'}).click();
 const dialog=page.getByRole('dialog',{name:"PDF'den deneme incele"});
 await dialog.getByRole('button',{name:/sonuc\.pdf/}).click();
 await dialog.getByRole('button',{name:'İncelediğim sonucu kaydet'}).click();
 await expect(dialog.getByRole('checkbox',{name:/Benzer bir deneme/})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'İncelediğim sonucu kaydet'})).toBeDisabled();
 expect(submitted[0]).toMatchObject({accept_possible_duplicate:false,exam:{reported_total_net:42.5,results:[]}});
 await dialog.getByRole('checkbox',{name:/Benzer bir deneme/}).check();
 await dialog.getByRole('button',{name:'İncelediğim sonucu kaydet'}).click();
 await expect.poll(()=>submitted.length).toBe(2);
 expect(submitted[1]).toMatchObject({accept_possible_duplicate:true});
});


test('class PDF requires selecting the student before saving and preserves detected score',async({page})=>{
 const value=state();
 const candidate=(index:number,name:string,score:number,rank:number)=>({
  index,label:`${name} · TYT · 30 net`,student_label:name,format_code:'TYT' as const,
  exam_date:null,name:'TYT prova',publisher:'Örnek',score,rank,
  results:[{section_key:'turkce',correct:20,wrong:8,source_page:1,raw:'Türkçe D20 Y8 Net18',uncertain:false},
   {section_key:'matematik',correct:12,wrong:0,source_page:1,raw:'Matematik D12 Y0 Net12',uncertain:false}],
  reported_total_net:30,reported_total_source:{source_page:1,raw:'Toplam net 30',uncertain:false},
  source_pages:[1],warnings:['Sınav tarihi tabloda açıkça yazmıyor; kaydetmeden önce tarihi seç.'],
 });
 const draft:ImportDocument={id:'e45005d8-465d-4962-9b56-f0b8b83128b8',original_filename:'sinif-sonuc.pdf',sha256:'b'.repeat(64),page_count:1,extraction_status:'ready',visual_extraction_status:'not_needed',committed_candidate_indexes:[],created_at:now,candidates:[candidate(0,'Öğrenci A',250,1000),candidate(1,'Öğrenci B',275,500)]};
 const submitted:Record<string,unknown>[]=[];
 await page.route('**/api/exam-import/drafts',route=>route.fulfill({json:{documents:[draft]}}));
 await page.route('**/api/exam-import/commit',route=>{submitted.push(route.request().postDataJSON());return route.fulfill({json:{id:'created',replayed:false,state:value}})});
 await page.route(`**/api/exam-import/${draft.id}`,route=>route.fulfill({json:draft}));
 await open(page,value);await navigate(page,'Sınav Sonuçları');
 await page.getByRole('button',{name:'PDF yükle'}).click();
 const dialog=page.getByRole('dialog',{name:"PDF'den deneme incele"});
 await dialog.getByRole('button',{name:/sinif-sonuc\.pdf/}).click();
 await expect(dialog.getByText('2 öğrenci sonucu bulundu. Yalnız kendi satırını seç.')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'İncelediğim sonucu kaydet'})).toHaveCount(0);
 await dialog.getByRole('searchbox',{name:'Öğrenci sonucunu ara'}).fill('öğrenci b');
 await expect(dialog.getByRole('button',{name:/Öğrenci A/})).toHaveCount(0);
 await dialog.getByRole('button',{name:/Öğrenci B/}).click();
 await expect(dialog.getByLabel('Puan')).toHaveValue('275');
 await expect(dialog.getByLabel('Sıralama')).toHaveValue('500');
 await expect(dialog.getByLabel('Tarih')).toHaveValue('');
 await dialog.getByLabel('Tarih').fill('2026-09-22');
 await dialog.getByRole('button',{name:'İncelediğim sonucu kaydet'}).click();
 await expect.poll(()=>submitted.length).toBe(1);
 expect(submitted[0]).toMatchObject({candidate_index:1,exam:{score:275,rank:500,exam_date:'2026-09-22',reported_total_net:30}});
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