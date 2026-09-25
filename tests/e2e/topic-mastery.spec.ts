import {expect,test} from '@playwright/test';
import {emptyState,type AppState} from '../../src/lib/domain/types';

const topic={
 id:'00000000-0000-4000-8000-000000000001',exam:'TYT' as const,subject:'Matematik',name:'Problemler',
 parent_id:null,mastery:0,notes:'',review_requested:false,source:'',next_step:'',
 revision:1,updated_at:'2026-09-24T09:00:00.000Z',
};

test('topic mastery control shows all stages and saves the selected stage',async({page})=>{
 const state:AppState={...emptyState(true),authenticated:true,server_now:'2026-09-24T09:00:00.000Z',topics:[topic]};
 const requests:Record<string,unknown>[]=[];
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/calendar/today',route=>route.fulfill({json:{connected:false,date:'2026-09-24',timezone:'Europe/Istanbul',events:[],refreshedAt:null}}));
 await page.route('**/api/command',route=>{
  requests.push(route.request().postDataJSON());
  return route.fulfill({json:{ok:true,state:{...state,topics:[{...topic,mastery:3,revision:2}]}}});
 });
 await page.goto('/');
 await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:'Konularım'}).click();
 const trigger=page.getByRole('button',{name:'Problemler öğrenme düzeyi: Başlanmadı'});
 await trigger.click();
 const options=page.getByRole('group',{name:'Problemler öğrenme düzeyi seçimi'});
 await expect(options.getByRole('button')).toHaveCount(5);
 await options.getByRole('button',{name:'Bağımsız soru çözülebiliyor'}).click();
 await expect(page.getByRole('button',{name:'Problemler öğrenme düzeyi: Bağımsız soru çözülebiliyor'})).toBeVisible();
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({type:'topic.update',payload:{id:topic.id,expected_revision:1,mastery:3}});
 await page.setViewportSize({width:360,height:780});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('search reveals a topic in a previously closed subject group',async({page})=>{
 const state:AppState={...emptyState(true),authenticated:true,server_now:'2026-09-24T09:00:00.000Z',topics:[topic]};
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 await page.route('**/api/calendar/today',route=>route.fulfill({json:{connected:false,date:'2026-09-24',timezone:'Europe/Istanbul',events:[],refreshedAt:null}}));
 await page.goto('/');
 await page.getByRole('navigation',{name:'Ana gezinme'}).getByRole('button',{name:'Konularım'}).click();
 const group=page.getByRole('button',{name:/TYT Matematik/});
 const mastery=page.getByRole('button',{name:'Problemler öğrenme düzeyi: Başlanmadı'});
 await group.click();
 await expect(mastery).toBeHidden();
 await page.getByRole('textbox',{name:'Konu ara'}).fill('Problemler');
 await expect(mastery).toBeVisible();
});
