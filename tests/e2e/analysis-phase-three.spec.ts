import {expect,test} from '@playwright/test';
import {emptyState,type AppState} from '../../src/lib/domain/types';

test('analiz raporu isteği ve kaynak güne geçişi',async({page})=>{
  const now='2026-09-25T09:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  const state:AppState={...emptyState(true),authenticated:true,server_now:now};
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.route('**/api/calendar/today',route=>route.fulfill({json:{connected:false,date:'2026-09-25',timezone:'Europe/Istanbul',events:[],refreshedAt:null}}));
  const requests:Array<Record<string,unknown>>=[];
  let reports:Array<Record<string,unknown>>=[];
  await page.route('**/api/analysis',async route=>{
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON() as Record<string,unknown>;
      requests.push(body);
      reports=[{id:'report-1',start_date:body.start_date,end_date:body.end_date,status:'completed',
        body:'24 Eylül 2026 günü 40 dakika çalıştın.',created_at:now,stale:false,
        summary:{source_days:['2026-09-24'],data_days:1,missing_days:13},
        usage:{input_tokens:300,output_tokens:100,estimated_cost_usd:.008}}];
    }
    return route.fulfill({json:{ok:true,configured:true,model:'gpt-6-astra',scheduler_ready:false,
      schedule:null,reports,limits:{monthly_requests:4,monthly_usd:2},used:{requests:requests.length,estimated_cost_usd:0}}});
  });
  await page.goto('/');
  await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:'Analiz'}).click();
  await expect(page.getByRole('heading',{name:'Dönemini birlikte incele.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Rapor oluştur'})).toBeEnabled();
  await page.getByRole('button',{name:'Rapor oluştur'}).click();
  await expect.poll(()=>requests.length).toBe(1);
  expect(requests[0]).toMatchObject({action:'report',start_date:'2026-09-12',end_date:'2026-09-25'});
  await page.locator('details').first().locator('summary').click();
  await page.getByRole('button',{name:'24 Eylül 2026'}).click();
  await expect(page.getByRole('heading',{name:'Çalışma İstatistikleri'})).toBeVisible();
  await expect(page.locator('.study-day-detail')).toContainText('24 Eylül');
});

for(const width of [360,1280])test(`beş kart tek çağrı ve ücretsiz saklı rapor · ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const now='2026-09-25T09:00:00.000Z';await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/state',route=>route.fulfill({json:{...emptyState(true),authenticated:true,server_now:now}}));
  await page.route('**/api/calendar/today',route=>route.fulfill({json:{connected:false,date:'2026-09-25',timezone:'Europe/Istanbul',events:[],refreshedAt:null}}));
  const item=(text:string)=>({text,evidence_ids:['day:2026-09-24'],course_id:null});
  let calls=0;
  await page.route('**/api/analysis',route=>{
    if(route.request().method()==='POST')calls++;
    return route.fulfill({json:{ok:true,configured:true,model:'synthetic',scheduler_ready:false,schedule:null,limits:{monthly_requests:4,monthly_usd:2},used:{requests:calls,estimated_cost_usd:0},resets_at:'2026-09-30T21:00:00Z',
      reports:calls?[{id:'structured',start_date:'2026-09-12',end_date:'2026-09-25',status:'completed',body:'Fallback',created_at:now,stale:false,
        summary:{record_count:4,source_days:['2026-09-24'],structured_report:{schema_version:2,overview:'Kayıtlı çalışmaların bulunuyor.',study_observations:[item('Çalışma günlerin kayıtlı.')],result_observations:[item('Yeterli sonuç kaydı yok.')],next_actions:[item('Kısa bir tekrar görevi seç.')],limitations:['Örnek sayısı az.']}}}]:[]}});
  });
  await page.goto('/');
  if(width===360)await page.getByRole('button',{name:'Menüyü aç',exact:true}).click();
  await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:'Analiz'}).click();
  await expect(page.getByLabel('Rapor dönemi')).toHaveValue('14');
  await page.getByRole('button',{name:'Rapor oluştur'}).click();await expect.poll(()=>calls).toBe(1);
  const summary=page.locator('details').first().locator('summary');await summary.click();
  for(const name of ['Genel Durum','Çalışma Düzeni','Sınav Sonuçları ve Dersler','Önümüzdeki 7 Gün İçin Adımlar','Verinin Sınırları'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByText('Hesaplanan kayıt sayısı: 4')).toBeVisible();
  await summary.click();await summary.click();expect(calls).toBe(1);
  await expect(page.getByText('1 / 4',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Otomatik rapor',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
