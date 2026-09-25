import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('Google credential table is unavailable to browser roles and usable only by server role', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users(id) values('11111111-1111-4111-8111-111111111111');`);
    const sql = await readFile(new URL('../migrations/20260924141529_google_calendar_connection.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.query(`insert into public.google_calendar_connections(user_id, refresh_token_ciphertext)
      values($1, $2)`, ['11111111-1111-4111-8111-111111111111', 'v1.' + 'x'.repeat(50)]);
    await db.exec('set role authenticated');
    await assert.rejects(() => db.query('select * from public.google_calendar_connections'), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => db.query('select * from public.google_calendar_connections'), /permission denied/);
    await db.exec('reset role; set role service_role');
    const { rows } = await db.query<{ selected_calendar_ids: string[] }>('select selected_calendar_ids from public.google_calendar_connections');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].selected_calendar_ids, ['primary']);
  } finally { await db.close(); }
});
