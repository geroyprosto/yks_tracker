import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {MedicineState} from '../../src/lib/medicine';

const A=randomUUID(),B=randomUUID(),PENDING=randomUUID(),TEACHER=randomUUID();
let db:PGlite;
async function actor(id:string,clientId=''){
 await db.exec('reset role;set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',...(clientId?{client_id:clientId}:{})})]);
 await db.query("select set_config('request.jwt.claim.client_id',$1,false)",[clientId]);
}
async function command(type:string,payload:unknown,id=randomUUID()){
 return (await db.query<{value:{replayed:boolean}}>('select public.medicine_command($1,$2,$3::jsonb) as value',[id,type,JSON.stringify(payload)])).rows[0].value;
}
async function state(){return (await db.query<{value:MedicineState}>('select public.medicine_state() as value')).rows[0].value;}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 for(const id of [A,B,PENDING,TEACHER]){
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${id}@example.test`]);
  await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Tıp test öğrencisi',$2,$3,$4)",[id,`${id}@example.test`,id===TEACHER?'teacher':'student',id===PENDING?'pending':'approved']);
  await db.query("insert into public.education_profiles(user_id,education_level,yks_goal) values($1,'university',false)",[id]);
 }
 await actor(A);
});
after(async()=>{await db?.close();});
test('medicine is opt-in, receipts replay once and stale revisions cannot overwrite records',async()=>{
 assert.equal((await state()).profile,null);
 const payload={academic_year:'2026-2027',active_year:1,enabled:true,expected_revision:0},id=randomUUID();
 await command('profile.save',payload,id);
 assert.equal((await command('profile.save',payload,id)).replayed,true);
 assert.equal((await state()).profile?.revision,1);
 await assert.rejects(()=>command('profile.save',{...payload,active_year:2},id),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>command('profile.save',{...payload,active_year:2}),/CONFLICT/);
 await assert.rejects(()=>command('profile.save',{...payload,expected_revision:null}),/INVALID_INPUT/);
});
test('stored zero, topic notes, KEG and both attempts survive reload and year changes',async()=>{
 await actor(A);
 const first=(await db.query<{id:string}>("select id from private.medicine_topics where year=1 order by id limit 1").catch(()=>({rows:[]}))).rows[0];
 // Catalog tables are intentionally inaccessible to the browser role.
 assert.equal(first,undefined);
 await db.exec('reset role');
 const topic=(await db.query<{id:string}>("select id from private.medicine_topics where year=1 order by id limit 1")).rows[0].id;
 await actor(A);
 await command('topic.save',{academic_year:'2026-2027',topic_id:topic,mastery:3,review_requested:true,notes:'Yalnız bana ait konu notu',expected_revision:0});
 const score={academic_year:'2026-2027',year:1,unit_id:'d1-k1',attempt:'regular',exam_date:'2026-10-14',reported_score:0,theory_score:null,practical_score:null,notes:'',expected_revision:0};
 await command('result.save',score);await command('result.save',{...score,attempt:'resit',reported_score:80});
 await command('keg.save',{academic_year:'2026-2027',year:1,status:'sufficient',assessment_date:'2026-10-14',notes:'Açıklanan yeterlilik',expected_revision:0});
 let s=await state();assert.equal(s.results.length,2);assert.equal(s.results.find(r=>r.attempt==='regular')?.reported_score,0);assert.equal(s.keg[0].status,'sufficient');assert.equal(s.progress[0].notes,'Yalnız bana ait konu notu');
 await command('profile.save',{academic_year:'2026-2027',active_year:2,enabled:true,expected_revision:s.profile!.revision});
 assert.equal((await state()).results.length,0);
 await command('profile.save',{academic_year:'2026-2027',active_year:1,enabled:true,expected_revision:(await state()).profile!.revision});
 s=await state();assert.equal(s.results.length,2);assert.equal(s.progress.length,1);
 await assert.rejects(()=>command('result.save',{...score,reported_score:99,expected_revision:0}),/CONFLICT/);
 await assert.rejects(()=>command('result.save',{...score,unit_id:'d2-k1',year:2}),/INVALID_INPUT/);
 await assert.rejects(()=>command('result.save',{...score,reported_score:101,expected_revision:1}));
});
test('direct SQL cannot mutate records; RLS and commands isolate two students',async()=>{
 await actor(B);assert.equal((await state()).results.length,0);
 assert.equal((await db.query('select * from public.medicine_results')).rows.length,0);
 await assert.rejects(()=>db.query("update public.medicine_results set reported_score=100"),/permission denied/);
 await assert.rejects(()=>db.query("insert into public.medicine_keg(user_id,academic_year,year,status) values($1,'2026-2027',1,'sufficient')",[A]),/permission denied/);
 await command('profile.save',{academic_year:'2026-2027',active_year:1,enabled:true,expected_revision:0});
 await actor(A);const foreign=(await state()).results[0];
 await actor(B);await assert.rejects(()=>command('result.delete',{id:foreign.id,expected_revision:foreign.revision}),/CONFLICT/);
 await actor(A);assert.equal((await state()).results.length,2);
});
test('pending, teacher, MCP and anonymous callers cannot access medicine',async()=>{
 for(const id of [PENDING,TEACHER]){await actor(id);await assert.rejects(()=>state(),/STUDENT_REQUIRED/);await assert.rejects(()=>command('profile.save',{academic_year:'2026-2027',active_year:1,enabled:true,expected_revision:0}),/STUDENT_REQUIRED/);}
 await actor(A,'mcp-client');await assert.rejects(()=>state(),/STUDENT_REQUIRED/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>state(),/permission denied/);
});
