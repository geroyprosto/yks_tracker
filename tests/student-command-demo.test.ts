import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {readFile,readdir} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {demoClient} from '../src/lib/server/classroom-demo';
import {executeStudentCommand,getState} from '../src/lib/server/service';

test('minimal demo student saves reach the combined SQL gateway and emit their existing change event',async()=>{
 const db=new PGlite(),student=randomUUID();
 const environment=process.env as Record<string,string|undefined>;
 const host=globalThis as typeof globalThis&{classroomDemo?:{db:Promise<PGlite>;queue:Promise<unknown>;events:EventEmitter}};
 const previousRuntime=host.classroomDemo,previousEnvironment=process.env.NODE_ENV,previousFlag=process.env.CLASSROOM_DEMO_ENABLED;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())
   await db.exec(await readFile(new URL(name,directory),'utf8'));
  await db.query('insert into auth.users values($1,$2,now())',[student,'synthetic@example.test']);
  await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Demo öğrenci','synthetic@example.test','student','approved')",[student]);
  environment.NODE_ENV='test';process.env.CLASSROOM_DEMO_ENABLED='true';
  const events=new EventEmitter();let changes=0;events.on('change',()=>changes++);
  host.classroomDemo={db:Promise.resolve(db),queue:Promise.resolve(),events};
  const input={request_id:randomUUID(),type:'task.create',payload:{title:'Demo kayıt',plan_date:'2026-10-05'}};
  const receipt=await executeStudentCommand(demoClient(student),input);
  assert.equal(receipt.ok,true);assert.equal(receipt.replayed,false);assert.equal(changes,1);
  const task=(await db.query<{title:string}>('select title from public.tasks where id=$1',[receipt.id])).rows[0];
  assert.equal(task.title,'Demo kayıt');
  const replay=await executeStudentCommand(demoClient(student),input);
  assert.equal(replay.id,receipt.id);assert.equal(replay.replayed,true);assert.equal(changes,2);
  const state=await getState(demoClient(student));
  assert.ok(state.tasks.some(row=>row.id===receipt.id));
  assert.equal(changes,2,'Refreshing the demo view must not emit another mutation');
 }finally{
  host.classroomDemo=previousRuntime;
  if(previousEnvironment===undefined)delete environment.NODE_ENV;else environment.NODE_ENV=previousEnvironment;
  if(previousFlag===undefined)delete process.env.CLASSROOM_DEMO_ENABLED;else process.env.CLASSROOM_DEMO_ENABLED=previousFlag;
  await db.close();
 }
});
