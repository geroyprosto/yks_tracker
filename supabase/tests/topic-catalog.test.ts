import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const nextOwner = '22222222-2222-4222-8222-222222222222';
const excluded = ['Felsefe', 'Din Kültürü', 'Tarih'];

test('researched catalogue replaces unused starters and preserves progress and references', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${owner}'),('${nextOwner}');`);
    const migrations = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql') && !name.includes('refresh_ogm_topic_catalog')).sort()) {
      await db.exec(await readFile(new URL(name, migrations), 'utf8'));
    }
    await db.exec(`insert into public.owner_allowlist(user_id) values('${owner}');
      set role authenticated;
      select set_config('request.jwt.claim.sub','${owner}',false);
      select public.yks_state();
      reset role;`);
    const prior = await db.query<{ id: string }>(`select id from public.topics
      where user_id = '${owner}' and exam = 'AYT' and subject = 'Biyoloji' and name = 'İnsan fizyolojisi'`);
    const preservedId = prior.rows[0]?.id;
    assert.ok(preservedId);
    await db.exec(`update public.topics set mastery = 4, notes = 'Kendi notum' where id = '${preservedId}';
      insert into public.tasks(user_id,title,plan_date,topic_id) values('${owner}','Biyoloji tekrar','2026-09-24','${preservedId}');
      insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery) values('${owner}','${preservedId}',0,4);`);
    const sql = await readFile(new URL('../migrations/20260924204147_refresh_ogm_topic_catalog.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    const rows = await db.query<{ exam: string; subject: string; name: string }>(`select exam,subject,name from public.topics where user_id='${owner}'`);
    assert.ok(rows.rows.length >= 181);
    const catalog = JSON.parse(await readFile(new URL('../catalog/ogm-topic-headings.json', import.meta.url), 'utf8')) as Array<{exam:string;subject:string;topics:string[]}>;
    const actual = new Set(rows.rows.map(row => [row.exam,row.subject,row.name].join('|')));
    for (const group of catalog) for (const name of group.topics) {
      assert.ok(actual.has([group.exam,group.subject,name].join('|')), `Missing ${group.exam} ${group.subject}: ${name}`);
    }
    assert.equal(rows.rows.filter(row => row.exam === 'TYT' && excluded.includes(row.subject)).length, 0);
    const retained = await db.query<{ id: string; mastery: number; notes: string }>(`select id,mastery,notes from public.topics where id='${preservedId}'`);
    assert.deepEqual(retained.rows[0], { id: preservedId, mastery: 4, notes: 'Kendi notum' });
    assert.equal((await db.query(`select id from public.tasks where topic_id='${preservedId}' and title='Biyoloji tekrar'`)).rows.length, 1);
    assert.equal((await db.query(`select id from public.topic_history where topic_id='${preservedId}'`)).rows.length, 1);
    await db.exec(`update public.owner_allowlist set user_id='${nextOwner}'; set role authenticated; select set_config('request.jwt.claim.sub','${nextOwner}',false); select public.yks_state(); reset role;`);
    const fresh = await db.query<{ exam: string; subject: string; name: string }>(`select exam,subject,name from public.topics where user_id='${nextOwner}'`);
    assert.equal(fresh.rows.length, 181);
    assert.equal(fresh.rows.filter(row => row.exam === 'TYT' && excluded.includes(row.subject)).length, 0);
  } finally {
    await db.close();
  }
});




