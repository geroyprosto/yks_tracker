import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('migration defaults on while preserving other accounts with earlier private journal choices',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to anon,authenticated;
   grant execute on function auth.uid() to anon,authenticated;`);
  const migrationDir=new URL('../migrations/',import.meta.url);
  const migrationName='20261001150028_journal_analysis_preference.sql';
  for(const name of (await readdir(migrationDir)).filter(name=>name.endsWith('.sql')&&name!==migrationName).sort())
   await db.exec(await readFile(new URL(name,migrationDir),'utf8'));
  const ids={owner:'11111111-1111-4111-8111-111111111111',excluded:'22222222-2222-4222-8222-222222222222',
   partial:'33333333-3333-4333-8333-333333333333',shared:'44444444-4444-4444-8444-444444444444',fresh:'55555555-5555-4555-8555-555555555555'};
  for(const id of Object.values(ids))await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('insert into public.owner_allowlist(user_id) values($1)',[ids.owner]);
  for(const id of Object.values(ids))await db.query('insert into public.profiles(user_id) values($1)',[id]);
  await db.query(`insert into public.journal_entries(user_id,journal_date,original_text,structured_fields,exclude_from_analysis,ai_shared_fields)
   values($1,'2026-09-24','owner text','{}',false,'{}')`,[ids.owner]);
  await db.query(`insert into public.journal_entries(user_id,journal_date,original_text,structured_fields,exclude_from_analysis,ai_shared_fields)
   values($1,'2026-09-24','excluded text','{}',true,'{original_text}')`,[ids.excluded]);
  await db.query(`insert into public.journal_entries(user_id,journal_date,original_text,structured_fields,exclude_from_analysis,ai_shared_fields)
   values($1,'2026-09-24','shared text','{"mood":"private"}',false,'{original_text}')`,[ids.partial]);
  await db.query(`insert into public.journal_entries(user_id,journal_date,original_text,structured_fields,exclude_from_analysis,ai_shared_fields)
   values($1,'2026-09-24','shared text','{"mood":"public"}',false,'{original_text,mood}')`,[ids.shared]);
  await db.exec(await readFile(new URL(migrationName,migrationDir),'utf8'));
  const rows=(await db.query<{user_id:string;journal_analysis_enabled:boolean}>(
   'select user_id,journal_analysis_enabled from public.profiles')).rows;
  const enabled=new Map(rows.map(row=>[row.user_id,row.journal_analysis_enabled]));
  assert.equal(enabled.get(ids.owner),true);
  assert.equal(enabled.get(ids.excluded),false);
  assert.equal(enabled.get(ids.partial),false);
  assert.equal(enabled.get(ids.shared),true);
  assert.equal(enabled.get(ids.fresh),true);
 }finally{await db.close();}
});
