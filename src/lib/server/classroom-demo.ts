import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './http';
import { databaseError } from './service';

/** Development simulator only. It never creates a Supabase session or touches live data. */
export function demoEnabled() { return process.env.NODE_ENV !== 'production' && process.env.CLASSROOM_DEMO_ENABLED === 'true'; }
const demoCookie = 'yks-classroom-demo';
type DemoRuntime = { db: Promise<PGlite>; queue: Promise<unknown>; events: EventEmitter };
const globalDemo = globalThis as typeof globalThis & { classroomDemo?: DemoRuntime };

async function initialize() {
  // The build must omit the local database, even from function file traces.
  const pglite = process.env.NODE_ENV !== 'production' ? await import('@electric-sql/pglite') : null;
  if (!pglite) throw new ApiError(404, 'DEMO_DISABLED', 'Demo yalnızca açıkça etkinleştirilmiş geliştirme ortamında kullanılabilir.');
  const {PGlite}=pglite;
  const testRun=process.env.CLASSROOM_DEMO_TEST_RUN;
  if(process.env.YKSIM_E2E==='1'&&testRun&&!/^[a-zA-Z0-9-]{1,80}$/.test(testRun))throw new Error('INVALID_DEMO_TEST_RUN');
  const dir = process.env.YKSIM_E2E==='1'
    ? path.join(tmpdir(), 'yksim-classroom-e2e', testRun ?? 'default')
    : path.join(process.cwd(), 'tmp', 'classroom-demo');
  await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  if (!(await db.query("select to_regclass('auth.users') as present")).rows.some(r => (r as {present:unknown}).present)) {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
      create table public.demo_migrations(name text primary key);
      create table public.demo_sessions(token_hash text primary key,user_id uuid not null references auth.users(id),expires_at timestamptz not null);
      alter table public.demo_migrations enable row level security;alter table public.demo_sessions enable row level security;
      revoke all on public.demo_migrations,public.demo_sessions from public,anon,authenticated;`);
  }
  const migrations = path.join(process.cwd(), 'supabase/migrations');
  for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
    const exists = await db.query('select name from public.demo_migrations where name=$1', [name]);
    if (!exists.rows.length) await db.transaction(async tx => { await tx.exec(await readFile(path.join(migrations, name), 'utf8')); await tx.query('insert into public.demo_migrations values($1)', [name]); });
  }
  const { seedClassroomDemo,refreshDemoPresence } = await import('../classroom/demo-seed');
  await seedClassroomDemo(db);
  await refreshDemoPresence(db);
  return db;
}

export function demoRuntime() {
  if (!demoEnabled()) throw new ApiError(404, 'DEMO_DISABLED', 'Demo yalnızca açıkça etkinleştirilmiş geliştirme ortamında kullanılabilir.');
  if (!globalDemo.classroomDemo) {
    globalDemo.classroomDemo = { db: initialize(), queue: Promise.resolve(), events: new EventEmitter().setMaxListeners(100) };
    // Server-side catch-up also runs while a student tab is closed. Persistent
    // due_at + interval records remain authoritative after a process restart.
    const timer=setInterval(()=>{
      void demoQuery(async db=>{
        const result=await db.query<{created:number}>('select public.classroom_tick() as created');
        const {seedClassroomDemo,refreshDemoPresence}=await import('../classroom/demo-seed');
        await seedClassroomDemo(db);
        const refreshed=await refreshDemoPresence(db);
        if(result.rows[0]?.created||refreshed)globalDemo.classroomDemo?.events.emit('change');
      }).catch(()=>{});
    },30000);
    timer.unref();
  }
  return globalDemo.classroomDemo;
}

/** Serialize identity + SQL transaction so simultaneous devices cannot inherit another actor. */
export async function demoQuery<T>(run: (db: PGlite) => Promise<T>): Promise<T> {
  const runtime = demoRuntime();
  const result = runtime.queue.then(async () => run(await runtime.db));
  runtime.queue = result.catch(() => undefined);
  return result;
}
export async function demoUserId() {
  if (!demoEnabled()) return null;
  const token = (await cookies()).get(demoCookie)?.value;
  if (!token) return null;
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Oturum sona erdi. Yeniden giriş yapın.');
  const hash = createHash('sha256').update(token).digest('hex');
  const userId = await demoQuery(async db => (await db.query<{user_id:string}>('select user_id from public.demo_sessions where token_hash=$1 and expires_at>now()', [hash])).rows[0]?.user_id);
  if (!userId) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Oturum sona erdi. Yeniden giriş yapın.');
  return userId;
}
export async function createDemoSession(userId:string) {
  const token = randomBytes(32).toString('hex');
  await demoQuery(async db => {
    const exists = await db.query('select id from public.classroom_accounts where id=$1', [userId]);
    if (!exists.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Demo hesabı bulunamadı.');
    await db.query('insert into public.demo_sessions values($1,$2,now()+interval \'12 hours\')', [createHash('sha256').update(token).digest('hex'), userId]);
  });
  (await cookies()).set(demoCookie, token, { httpOnly:true, sameSite:'lax', secure:false, path:'/', maxAge:43200 });
}
export async function clearDemoSession() {
  const jar = await cookies(); const token = jar.get(demoCookie)?.value;
  if (demoEnabled() && token) await demoQuery(db => db.query('delete from public.demo_sessions where token_hash=$1', [createHash('sha256').update(token).digest('hex')]));
  jar.delete(demoCookie);
}

/** Exercise the same deletion preparation and Auth trigger in the isolated simulator. */
export async function deleteDemoClassroomAccount(actorId: string, input: { id: string; confirmation_email: string }) {
  try {
    await demoQuery(db => db.transaction(async tx => {
      const result = await tx.query<{value:{exists:boolean}}>(
        'select public.classroom_account_delete_prepare($1,$2,$3) as value',
        [actorId,input.id,input.confirmation_email]);
      if (result.rows[0]?.value.exists) await tx.query('delete from auth.users where id=$1', [input.id]);
    }));
  } catch (error) {
    databaseError({message:error instanceof Error ? error.message : 'DATABASE_UNAVAILABLE'});
  }
  demoRuntime().events.emit('change');
  return {deleted:true};
}

export function demoClient(userId:string|null): SupabaseClient {
  const rpc = async(name:string, args:Record<string,unknown> = {}) => {
    const allowed = new Set(['education_state','education_command','yks_state','yks_command','yks_student_command','classroom_state','classroom_identity','classroom_command','classroom_apply','classroom_invite','classroom_tick','friend_competition_state','friend_invite_create','friend_invite_preview','friend_invite_accept','friend_remove']);
    if (!allowed.has(name) || Object.keys(args).some(k => !/^[a-z_]+$/.test(k))) return { data:null, error:{message:'INVALID_INPUT'} };
    try {
      const data = await demoQuery(db => db.transaction(async tx => {
        await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? '']);
        const keys = Object.keys(args);
        const sql = `select public.${name}(${keys.map((key,i) => `${key} => $${i+1}`).join(',')}) as value`;
        const result = await tx.query<{value:unknown}>(sql, keys.map(k => typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
        return result.rows[0]?.value;
      }));
      if (name === 'classroom_command' || name === 'yks_command' || name === 'yks_student_command' || name === 'classroom_apply') demoRuntime().events.emit('change');
      return { data, error:null };
    } catch(error) { return {data:null,error:{message:error instanceof Error ? error.message : 'DATABASE_UNAVAILABLE'}}; }
  };
  return {rpc,auth:{getUser:async() => ({data:{user:userId ? {id:userId,email_confirmed_at:new Date().toISOString()} : null},error:null})}} as unknown as SupabaseClient;
}
