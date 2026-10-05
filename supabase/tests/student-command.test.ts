import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {AppState} from '../../src/lib/domain/types';

const [STUDENT,OTHER,OWNER,TEACHER,PENDING,SUSPENDED,REJECTED,NO_ACCOUNT]=Array.from({length:8},()=>randomUUID());
type Receipt={id:string;request_id:string;replayed:boolean};
let db:PGlite;let day:string;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;`);
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())
  await db.exec(await readFile(new URL(name,directory),'utf8'));
 for(const id of [STUDENT,OTHER,OWNER,TEACHER,PENDING,SUSPENDED,REJECTED,NO_ACCOUNT]){
  await db.query('insert into auth.users values($1,$2,now())',[id,`${id}@example.test`]);
  if(id===NO_ACCOUNT)continue;
  await db.query('insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,$4,$5)',
   [id,'Sentetik hesap',`${id}@example.test`,id===OWNER?'admin':id===TEACHER?'teacher':'student',
    id===PENDING?'pending':id===SUSPENDED?'suspended':id===REJECTED?'rejected':'approved']);
 }
 await db.query('insert into public.owner_allowlist(user_id) values($1)',[OWNER]);
 day=(await db.query<{value:string}>("select (clock_timestamp() at time zone 'Europe/Istanbul')::date::text value")).rows[0].value;
 await browser();
});
after(async()=>{await db?.close();});
async function browser(id:string|null=STUDENT,oauth=false){
 await db.exec('reset role;set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
 await db.query("select set_config('request.jwt.claim.client_id',$1,false)",[oauth?'oauth-client':'']);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated',...(oauth?{client_id:'oauth-client'}:{})})]);
}
async function admin(sql:string,args:unknown[]=[]){await db.exec('reset role');return db.query(sql,args);}
async function command(type:string,payload:unknown,requestId=randomUUID()){
 return (await db.query<{value:Receipt}>('select public.yks_student_command($1,$2,$3::jsonb) value',
  [requestId,type,JSON.stringify(payload)])).rows[0].value;
}
async function state(){return (await db.query<{value:AppState}>('select public.yks_state() value')).rows[0].value;}
async function receipts(id:string){return (await admin('select request_id from public.command_receipts where user_id=$1',[id])).rows.length;}

test('approved student delegates task, journal and manual-time saves to existing durable command receipts',async()=>{
 const task=await command('task.create',{title:'Yeni görev',plan_date:day});
 await command('task.update',{id:task.id,expected_revision:1,progress:1});
 const journal=await command('journal.create',{journal_date:day,original_text:'Özel günlük'});
 const manual=await command('manual_study.create',{confirmed_by_user:true,study_date:day,subject:'TYT Matematik',minutes:25});
 const full=await state();
 assert.equal(full.tasks.find(row=>row.id===task.id)?.progress,1);
 assert.equal(full.journal_entries.find(row=>row.id===journal.id)?.original_text,'Özel günlük');
 assert.equal(full.manual_study_entries?.find(row=>row.id===manual.id)?.duration_seconds,1500);
 assert.equal(await receipts(STUDENT),4);await browser();
});

test('missing identity, teacher, original owner/admin and every unapproved state deny before creating a receipt',async()=>{
 for(const id of [NO_ACCOUNT,TEACHER,OWNER,PENDING,SUSPENDED,REJECTED]){
  const before=await receipts(id);await browser(id);
  await assert.rejects(()=>command('task.create',{title:'Reddedilecek görev',plan_date:day}),/STUDENT_REQUIRED/);
  assert.equal(await receipts(id),before);
 }
 await browser(null);await assert.rejects(()=>command('task.create',{title:'Kimlik yok',plan_date:day}),/AUTH_REQUIRED/);
 // Existing owner command compatibility is not narrowed by the website wrapper.
 await browser(OWNER);
 assert.ok((await db.query<{value:Receipt}>('select public.yks_command($1,$2,$3::jsonb) value',
  [randomUUID(),'task.create',JSON.stringify({title:'Sahip komutu',plan_date:day})])).rows[0].value.id);
 await browser();
});

test('OAuth bearer and anon/service roles cannot invoke the browser student write gateway',async()=>{
 const before=await receipts(STUDENT);
 await browser(STUDENT,true);await assert.rejects(()=>command('task.create',{title:'OAuth reddi',plan_date:day}),/AUTH_REQUIRED/);
 await browser(OWNER,true);await assert.rejects(()=>command('task.create',{title:'Sahip OAuth reddi',plan_date:day}),/AUTH_REQUIRED/);
 for(const role of ['anon','service_role']){
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[STUDENT]);
  await assert.rejects(()=>command('task.create',{title:'Rol reddi',plan_date:day}),/permission denied/);
 }
 assert.equal(await receipts(STUDENT),before);await browser();
});

test('receipt replay, payload conflicts and stale revision checks retain their existing semantics',async()=>{
 const requestId=randomUUID(),payload={title:'Tek kayıt',plan_date:day};
 const first=await command('task.create',payload,requestId);
 const count=await receipts(STUDENT);await browser();
 const replay=await command('task.create',payload,requestId);
 assert.equal(replay.id,first.id);assert.equal(replay.replayed,true);
 await assert.rejects(()=>command('task.create',{...payload,title:'Başka kayıt'},requestId),/IDEMPOTENCY_CONFLICT/);
 await command('task.update',{id:first.id,expected_revision:1,progress:1});
 await assert.rejects(()=>command('task.update',{id:first.id,expected_revision:1,progress:0}),/CONFLICT/);
 assert.equal(await receipts(STUDENT),count+1);await browser();
 assert.equal((await state()).tasks.find(row=>row.id===first.id)?.progress,1);
});

test('suspension denies a previously accepted request replay and does not insert or change study rows',async()=>{
 const requestId=randomUUID(),payload={title:'Askıya alma denetimi',plan_date:day};
 const saved=await command('task.create',payload,requestId),count=await receipts(STUDENT);
 await admin("update public.classroom_accounts set status='suspended' where id=$1",[STUDENT]);
 try{
  await browser();await assert.rejects(()=>command('task.create',payload,requestId),/STUDENT_REQUIRED/);
  assert.equal(await receipts(STUDENT),count);
 }finally{await admin("update public.classroom_accounts set status='approved' where id=$1",[STUDENT]);await browser();}
 assert.ok((await state()).tasks.some(row=>row.id===saved.id));
});

test('foreign task revisions and hidden inputs remain rejected without durable receipts',async()=>{
 await browser(OTHER);const own=await command('task.create',{title:'Diğer öğrenci',plan_date:day});
 const before=await receipts(STUDENT);await browser();
 await assert.rejects(()=>command('task.update',{id:own.id,expected_revision:1,progress:1}),/NOT_FOUND/);
 await assert.rejects(()=>command('task.create',{title:'Gizli alan',plan_date:day,user_id:OTHER}),/INVALID_INPUT/);
 assert.equal(await receipts(STUDENT),before);await browser(OTHER);
 assert.equal((await state()).tasks.find(row=>row.id===own.id)?.progress,0);await browser();
});

test('the 120-per-minute limit is unchanged and an accepted identical replay remains free',async()=>{
 await browser(OTHER);const requestId=randomUUID(),payload={title:'Sınır öncesi kayıt',plan_date:day};
 const first=await command('task.create',payload,requestId);
 await admin(`insert into public.command_receipts(user_id,request_id,command_type,payload,result)
  select $1,gen_random_uuid(),'synthetic.rate','{}'::jsonb,'{}'::jsonb from generate_series(1,
   120-(select count(*)::int from public.command_receipts where user_id=$1 and created_at>now()-interval '1 minute'))`,[OTHER]);
 await browser(OTHER);
 assert.equal((await command('task.create',payload,requestId)).id,first.id);
 await assert.rejects(()=>command('task.create',{title:'Sınır sonrası kayıt',plan_date:day}),/RATE_LIMITED/);
 assert.equal(await receipts(OTHER),120);await browser();
});
