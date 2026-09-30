import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const OLD_PENDING = 'a'.repeat(64);
const GROUP_MIGRATION = '20260930204830_friend_competition_groups.sql';
let db: PGlite;

type Group = {id: string; name: string; owner_id: string; member_count: number; timezone: string};
type State = {today: string; friends: Array<{user_id: string}>; groups: Group[]; group: Group | null};

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql') && name < GROUP_MIGRATION).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  for (const [id, name, timezone] of [
    [ALICE, 'Alice', 'UTC'],
    [BOB, 'Bob', 'Pacific/Honolulu'],
    [CAROL, 'Carol', 'Europe/Istanbul'],
  ]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',
      [id, `${id}@example.test`]);
    await db.query(`insert into public.classroom_accounts(id,name,email,role,status)
      values($1,$2,$3,'student','approved')`, [id, name, `${id}@example.test`]);
    await db.query('insert into public.profiles(user_id,display_name,timezone) values($1,$2,$3)',
      [id, name, timezone]);
  }
  // These pairs overlap at Bob, but the earlier pair model did not imply
  // Alice's consent to a group with Carol.
  await db.query(`insert into private.friendships(user_a,user_b,created_at)
    values($1,$2,clock_timestamp()-interval '2 days'),
      ($2,$3,clock_timestamp()-interval '1 day')`, [ALICE, BOB, CAROL]);
  await db.query(`insert into private.friend_invites(inviter_id,token_hash,expires_at,used_at,accepted_by)
    values($1,sha256(decode($2,'hex')),clock_timestamp()+interval '7 days',clock_timestamp()-interval '2 days',$3),
      ($4,sha256(decode($5,'hex')),clock_timestamp()+interval '7 days',clock_timestamp()-interval '1 day',$1),
      ($3,sha256(decode($6,'hex')),clock_timestamp()+interval '7 days',null,null)`,
    [BOB, 'b'.repeat(64), ALICE, CAROL, 'c'.repeat(64), OLD_PENDING]);
  assert.ok((await db.query<{value: object | null}>(
    'select private.friend_invite_preview($1) as value', [OLD_PENDING])).rows[0].value);
  await db.exec(await readFile(new URL(GROUP_MIGRATION, migrations), 'utf8'));
});
after(async () => { await db?.close(); });

async function browser(id: string) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function state(groupId: string | null = null) {
  return (await db.query<{value: State}>(
    'select public.friend_competition_state($1::uuid) as value', [groupId])).rows[0].value;
}

test('old pairs become separate groups with the original inviter as owner', async () => {
  await browser(ALICE);
  const alice = await state();
  assert.equal(alice.groups.length, 1);
  assert.deepEqual(alice.friends.map(friend => friend.user_id), [BOB]);
  assert.equal(alice.group?.owner_id, BOB);
  assert.equal(alice.group?.timezone, 'Pacific/Honolulu');
  assert.equal(alice.group?.name, 'Bob ve arkadaşları');
  const oldCallerState = (await db.query<{value: State}>(
    'select public.friend_competition_state() as value')).rows[0].value;
  assert.equal(oldCallerState.group?.id, alice.group?.id);
  const oldCallerInvite = (await db.query<{value: {group_id: string}}>(
    'select public.friend_invite_create() as value')).rows[0].value;
  assert.equal(oldCallerInvite.group_id, alice.group?.id);
  await browser(CAROL);
  const carol = await state();
  assert.equal(carol.groups.length, 1);
  assert.deepEqual(carol.friends.map(friend => friend.user_id), [BOB]);
  assert.equal(carol.group?.owner_id, CAROL);
  await browser(BOB);
  const bob = await state();
  assert.equal(bob.groups.length, 2);
  assert.equal(bob.group?.id, alice.group?.id);
  assert.deepEqual(bob.friends.map(friend => friend.user_id), [ALICE]);
  const second = bob.groups.find(group => group.id !== bob.group?.id);
  assert.ok(second);
  assert.deepEqual((await state(second.id)).friends.map(friend => friend.user_id), [CAROL]);
  assert.equal(bob.today, alice.today);
});

test('old unconsumed pair links are invalid and legacy pair rows remain', async () => {
  await db.exec('reset role; set role anon; reset request.jwt.claim.sub');
  assert.equal((await db.query<{value: object | null}>(
    'select public.friend_invite_preview($1) as value', [OLD_PENDING])).rows[0].value, null);
  await browser(ALICE);
  await assert.rejects(() => db.query('select public.friend_invite_accept($1)', [OLD_PENDING]), /INVITE_INVALID/);
  await db.exec('reset role');
  assert.equal((await db.query<{count: string}>(
    "select count(*)::text as count from private.friend_invites where token_hash in (sha256(decode($1,'hex')),sha256(decode($2,'hex')),sha256(decode($3,'hex')))",
    [OLD_PENDING, 'b'.repeat(64), 'c'.repeat(64)])).rows[0].count, '0');
  assert.equal((await db.query<{count: string}>(
    'select count(*)::text as count from private.friendships')).rows[0].count, '2');
});

test('deleting an old group owner removes only that owned group cleanly', async () => {
  await db.exec('reset role');
  await db.query('delete from auth.users where id=$1', [BOB]);
  const groups = await db.query<{owner_id: string; member_count: string}>(`
    select g.owner_id,count(m.user_id)::text as member_count
    from private.friend_groups g join private.friend_group_members m on m.group_id=g.id
    group by g.id`);
  assert.deepEqual(groups.rows, [{owner_id: CAROL, member_count: '1'}]);
  await browser(CAROL);
  assert.equal((await state()).group?.owner_id, CAROL);
  assert.deepEqual((await state()).friends, []);
});
