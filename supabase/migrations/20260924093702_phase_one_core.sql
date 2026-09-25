-- Phase-one core. The preceding local draft is retained outside migrations as a reference.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create table public.owner_allowlist(singleton boolean primary key default true check(singleton),user_id uuid not null unique references auth.users(id) on delete cascade);
alter table public.owner_allowlist enable row level security;
create policy owner_allowlist_read on public.owner_allowlist for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.owner_allowlist from public,anon,authenticated;
grant select on public.owner_allowlist to authenticated;
create function private.valid_factors(value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(value)='object' and value ?& array['easy','medium','hard'] and jsonb_typeof(value->'easy')='number' and jsonb_typeof(value->'medium')='number' and jsonb_typeof(value->'hard')='number' and (value->>'easy')::numeric between .1 and 10 and (value->>'medium')::numeric between .1 and 10 and (value->>'hard')::numeric between .1 and 10,false)
$$;
create function private.valid_steps(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
 if value is null or jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>100 then return false; end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['id','title','completed']) or jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'title') is distinct from 'string' or jsonb_typeof(item->'completed') is distinct from 'boolean' or length(item->>'title') not between 1 and 240 then return false; end if;
  perform (item->>'id')::uuid;
 end loop;
 return (select count(*)=count(distinct e.element->>'id') from jsonb_array_elements(value) as e(element));
exception when others then return false;
end $$;
create table public.profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'Sümeyra' check(length(display_name) between 1 and 100),exam_year int not null default 2027 check(exam_year between 2020 and 2100),exam_date date,target_rank int check(target_rank between 1 and 10000000),timezone text not null default 'Europe/Istanbul',
 daily_target_minutes int not null default 360 check(daily_target_minutes between 0 and 1440),task_share numeric not null default .7 check(task_share between 0 and 1),
 difficulty_factors jsonb not null default '{"easy":1,"medium":1.25,"hard":1.5}' check(private.valid_factors(difficulty_factors)),
 weekday_targets int[] not null default array[360,360,360,360,360,360,360] check(array_ndims(weekday_targets)=1 and array_length(weekday_targets,1)=7 and array_position(weekday_targets,null) is null and 0<=all(weekday_targets) and 1440>=all(weekday_targets)),
 theme text not null default 'steel' check(theme in ('graphite','rose','ocean','aurora','forest','burgundy','plum','pastel','steel')),appearance text not null default 'dark' check(appearance in ('dark','light','system')),reduced_motion boolean not null default false,simple_view boolean not null default false,revision int not null default 1 check(revision>0),updated_at timestamptz not null default now()
);
create table public.topics(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,exam text not null check(exam in ('TYT','AYT')),subject text not null check(length(subject) between 1 and 120),name text not null check(length(name) between 1 and 240),parent_id uuid,
 mastery int not null default 0 check(mastery between 0 and 4),notes text not null default '' check(length(notes)<=10000),review_requested boolean not null default false,source text not null default '' check(length(source)<=1000),next_step text not null default '' check(length(next_step)<=1000),revision int not null default 1 check(revision>0),updated_at timestamptz not null default now(),
 unique(id,user_id),unique(user_id,exam,subject,name),foreign key(parent_id,user_id) references public.topics(id,user_id),check(id is distinct from parent_id)
);
create table public.topic_history(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,topic_id uuid not null,old_mastery int not null,new_mastery int not null check(new_mastery between 0 and 4),changed_at timestamptz not null default now(),foreign key(topic_id,user_id) references public.topics(id,user_id));
create table public.tasks(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,title text not null check(length(title) between 1 and 240),plan_date date not null,exam text check(exam in ('TYT','AYT')),subject text check(length(subject)<=120),topic_id uuid,
 resource text not null default '' check(length(resource)<=500),completion_criteria text not null default '' check(length(completion_criteria)<=500),planned_minutes int not null default 30 check(planned_minutes between 0 and 1440),difficulty text not null default 'medium' check(difficulty in ('easy','medium','hard')),progress numeric not null default 0 check(progress between 0 and 1),weight_override numeric check(weight_override between 0 and 100000),priority text not null default 'normal' check(priority in ('low','normal','high')),position int not null default 0 check(position between 0 and 100000),notes text not null default '' check(length(notes)<=10000),
 study_type text not null default 'Soru çözümü' check(study_type in ('Konu anlatımı','Soru çözümü','Tekrar','Hızlı gözden geçirme','Yanlış analizi','Hâkimiyet kontrolü')),steps jsonb not null default '[]' check(private.valid_steps(steps)),revision int not null default 1 check(revision>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,user_id),foreign key(topic_id,user_id) references public.topics(id,user_id)
);
create index tasks_plan_date on public.tasks(user_id,plan_date);
create table public.study_sessions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,title text not null default 'Çalışma' check(length(title) between 1 and 240),task_id uuid,topic_id uuid,subject text check(length(subject)<=120),study_type text not null default 'Soru çözümü' check(study_type in ('Konu anlatımı','Soru çözümü','Tekrar','Hızlı gözden geçirme','Yanlış analizi','Hâkimiyet kontrolü')),mode text not null default 'stopwatch' check(mode in ('stopwatch','countdown')),target_seconds int check(target_seconds between 60 and 86400),
 status text not null default 'running' check(status in ('running','paused','finished')),started_at timestamptz not null,active_since timestamptz,accumulated_seconds int not null default 0 check(accumulated_seconds>=0),finished_at timestamptz,revision int not null default 1 check(revision>0),unique(id,user_id),foreign key(task_id,user_id) references public.tasks(id,user_id),foreign key(topic_id,user_id) references public.topics(id,user_id),check(mode<>'countdown' or target_seconds is not null),
 check((status='running' and active_since is not null and finished_at is null) or (status='paused' and active_since is null and finished_at is null) or (status='finished' and active_since is null and finished_at is not null))
);
create unique index one_active_session on public.study_sessions(user_id) where status in ('running','paused');
create table public.study_intervals(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,session_id uuid not null,started_at timestamptz not null,ended_at timestamptz,check(ended_at is null or ended_at>=started_at),foreign key(session_id,user_id) references public.study_sessions(id,user_id));
create unique index one_open_interval on public.study_intervals(session_id) where ended_at is null;
create index study_intervals_user_date on public.study_intervals(user_id,started_at);
create table public.daily_plan_versions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,plan_date date not null,version int not null check(version>0),target_minutes int not null check(target_minutes between 0 and 1440),task_share numeric not null check(task_share between 0 and 1),difficulty_factors jsonb not null check(private.valid_factors(difficulty_factors)),snapshot jsonb not null default '[]' check(jsonb_typeof(snapshot)='array'),changed_at timestamptz not null default now(),unique(user_id,plan_date,version));
create table public.audit_log(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,entity text not null,entity_id uuid,action text not null,old_value jsonb,new_value jsonb,source text not null default 'app',occurred_at timestamptz not null default now());
create table public.command_receipts(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,command_type text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id));
create index command_rate_limit on public.command_receipts(user_id,created_at);
do $$ declare t text; begin
 foreach t in array array['profiles','topics','topic_history','tasks','study_sessions','study_intervals','daily_plan_versions','audit_log','command_receipts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_read on public.%I for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.owner_allowlist where user_id=(select auth.uid())))',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
-- Mutations occur only in owner-checked private functions through narrow public RPCs.
create function private.require_owner() returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
 if owner_id is null or not exists(select 1 from public.owner_allowlist where user_id=owner_id) then raise exception 'OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));return owner_id;
end $$;
create function private.snapshot_day(owner_id uuid,day_date date,overrides jsonb default '{}') returns void language plpgsql set search_path='' as $$
declare previous public.daily_plan_versions; profile public.profiles;
begin
 select * into profile from public.profiles where user_id=owner_id;
 select * into previous from public.daily_plan_versions where user_id=owner_id and plan_date=day_date order by version desc limit 1;
 insert into public.daily_plan_versions(user_id,plan_date,version,target_minutes,task_share,difficulty_factors,snapshot)
 select owner_id,day_date,coalesce(previous.version,0)+1,coalesce((overrides->>'target_minutes')::int,previous.target_minutes,profile.weekday_targets[extract(isodow from day_date)::int],profile.daily_target_minutes),coalesce((overrides->>'task_share')::numeric,previous.task_share,profile.task_share),coalesce(overrides->'difficulty_factors',previous.difficulty_factors,profile.difficulty_factors),coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by position,created_at,id) from public.tasks t where t.user_id=owner_id and t.plan_date=day_date),'[]');
end $$;
create function private.initialize_owner(owner_id uuid) returns void language plpgsql set search_path='' as $$
declare is_new boolean; profile public.profiles; local_day date;
begin
 insert into public.profiles(user_id) values(owner_id) on conflict do nothing;is_new:=found;
 if is_new then
 insert into public.topics(user_id,exam,subject,name,source) select owner_id,exam,subject,name,'Düzenlenebilir başlangıç listesi; 2027 kapsamı olarak doğrulanmadı.' from (values
 ('TYT','Türkçe','Paragraf'),('TYT','Türkçe','Dil bilgisi'),('TYT','Türkçe','Sözcükte ve cümlede anlam'),
 ('TYT','Matematik','Temel kavramlar'),('TYT','Matematik','Sayılar'),('TYT','Matematik','Denklemler ve eşitsizlikler'),('TYT','Matematik','Problemler'),('TYT','Matematik','Kümeler ve mantık'),('TYT','Matematik','Fonksiyonlar'),('TYT','Matematik','Veri ve olasılık'),('TYT','Matematik','Geometri'),
 ('TYT','Fizik','Fizik bilimine giriş'),('TYT','Fizik','Hareket ve kuvvet'),('TYT','Fizik','Enerji'),('TYT','Fizik','Isı ve sıcaklık'),('TYT','Fizik','Elektrik'),('TYT','Fizik','Dalgalar ve optik'),
 ('TYT','Kimya','Kimya bilimi'),('TYT','Kimya','Atom ve periyodik sistem'),('TYT','Kimya','Kimyasal türler arası etkileşimler'),('TYT','Kimya','Maddenin hâlleri'),('TYT','Kimya','Karışımlar'),('TYT','Kimya','Asitler, bazlar ve tuzlar'),
 ('TYT','Biyoloji','Canlıların ortak özellikleri'),('TYT','Biyoloji','Hücre'),('TYT','Biyoloji','Canlıların sınıflandırılması'),('TYT','Biyoloji','Hücre bölünmeleri'),('TYT','Biyoloji','Kalıtım'),('TYT','Biyoloji','Ekosistem'),
 ('TYT','Tarih','Tarih bilimi ve ilk uygarlıklar'),('TYT','Tarih','Türk ve İslam tarihi'),('TYT','Tarih','Osmanlı tarihi'),('TYT','Tarih','Millî Mücadele ve Atatürk ilkeleri'),
 ('TYT','Coğrafya','Doğa ve insan'),('TYT','Coğrafya','İklim bilgisi'),('TYT','Coğrafya','Nüfus ve yerleşme'),('TYT','Coğrafya','Bölgeler ve çevre'),('TYT','Felsefe','Felsefenin konusu'),('TYT','Felsefe','Bilgi ve varlık felsefesi'),('TYT','Felsefe','Ahlak, sanat ve siyaset felsefesi'),('TYT','Din Kültürü','Bilgi ve inanç'),('TYT','Din Kültürü','İslam ve ibadet'),
 ('AYT','Matematik','Fonksiyonlar'),('AYT','Matematik','Polinomlar'),('AYT','Matematik','İkinci dereceden denklemler'),('AYT','Matematik','Trigonometri'),('AYT','Matematik','Üstel ve logaritmik fonksiyonlar'),('AYT','Matematik','Diziler'),('AYT','Matematik','Limit ve süreklilik'),('AYT','Matematik','Türev'),('AYT','Matematik','İntegral'),('AYT','Matematik','Geometri'),
 ('AYT','Fizik','Vektörler ve kuvvet'),('AYT','Fizik','Hareket'),('AYT','Fizik','İtme ve momentum'),('AYT','Fizik','Elektrik ve manyetizma'),('AYT','Fizik','Çembersel hareket'),('AYT','Fizik','Modern fizik'),
 ('AYT','Kimya','Modern atom teorisi'),('AYT','Kimya','Gazlar'),('AYT','Kimya','Çözeltiler'),('AYT','Kimya','Kimyasal tepkimelerde enerji ve hız'),('AYT','Kimya','Kimyasal denge'),('AYT','Kimya','Kimya ve elektrik'),('AYT','Kimya','Organik kimya'),
 ('AYT','Biyoloji','İnsan fizyolojisi'),('AYT','Biyoloji','Komünite ve popülasyon ekolojisi'),('AYT','Biyoloji','Genden proteine'),('AYT','Biyoloji','Canlılarda enerji dönüşümleri'),('AYT','Biyoloji','Bitki biyolojisi'),('AYT','Biyoloji','Canlılar ve çevre')
 ) as catalog(exam,subject,name);
 end if;
 select * into profile from public.profiles where user_id=owner_id;local_day:=(clock_timestamp() at time zone profile.timezone)::date;
 if not exists(select 1 from public.daily_plan_versions where user_id=owner_id and plan_date=local_day) then perform private.snapshot_day(owner_id,local_day); end if;
end $$;
create function private.settle_countdown(owner_id uuid,at_time timestamptz) returns void language plpgsql set search_path='' as $$
declare session public.study_sessions; end_time timestamptz;
begin
 select * into session from public.study_sessions where user_id=owner_id and status='running' and mode='countdown' for update;
 if found then
 end_time:=session.active_since+make_interval(secs=>greatest(0,session.target_seconds-session.accumulated_seconds));
 if end_time<=at_time then
 update public.study_intervals set ended_at=end_time where session_id=session.id and ended_at is null;
 update public.study_sessions set status='finished',finished_at=end_time,active_since=null,accumulated_seconds=target_seconds,revision=revision+1 where id=session.id;
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value,source) values(owner_id,'session',session.id,'countdown.auto_finish',to_jsonb(session),jsonb_build_object('finished_at',end_time),'system');
 end if;end if;
end $$;
create function private.state() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=private.require_owner(); at_time timestamptz:=date_trunc('second',clock_timestamp()); result jsonb;
begin
 perform private.initialize_owner(owner_id);perform private.settle_countdown(owner_id,at_time);
 select jsonb_build_object('server_now',at_time,
 'settings',(select to_jsonb(p)-'user_id'-'updated_at' from public.profiles p where p.user_id=owner_id),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by plan_date,position,created_at,id) from public.tasks t where t.user_id=owner_id),'[]'),
 'topics',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by exam,subject,name) from public.topics t where t.user_id=owner_id),'[]'),
 'sessions',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by started_at desc) from public.study_sessions t where t.user_id=owner_id),'[]'),
 'intervals',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by started_at) from public.study_intervals t where t.user_id=owner_id),'[]'),
 'day_plans',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by plan_date,version desc) from public.daily_plan_versions t where t.user_id=owner_id),'[]'),
 'topic_history',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by changed_at desc) from public.topic_history t where t.user_id=owner_id),'[]')) into result;
 return result;
end $$;
create function private.check_keys(value jsonb,allowed text[]) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(value)<>'object' or exists(select 1 from jsonb_object_keys(value) k where not(k=any(allowed))) then raise exception 'INVALID_INPUT'; end if;
end $$;
create function private.trim_session(owner_id uuid,session_id uuid,new_seconds int) returns void language plpgsql set search_path='' as $$
declare total_seconds int; remove_seconds int; row_interval public.study_intervals; span int;
begin
 select coalesce(sum(extract(epoch from (ended_at-started_at))),0)::int into total_seconds from public.study_intervals i where i.session_id=trim_session.session_id and i.user_id=owner_id;
 if new_seconds<0 or new_seconds>total_seconds then raise exception 'INVALID_INPUT'; end if;
 remove_seconds:=total_seconds-new_seconds;
 for row_interval in select * from public.study_intervals i where i.session_id=trim_session.session_id and i.user_id=owner_id order by started_at desc loop
  exit when remove_seconds=0;
  span:=extract(epoch from(row_interval.ended_at-row_interval.started_at))::int;
  update public.study_intervals set ended_at=ended_at-make_interval(secs=>least(span,remove_seconds)) where id=row_interval.id;
  remove_seconds:=greatest(0,remove_seconds-span);
 end loop;
end $$;
create function private.command(request_id uuid,command_type text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid:=private.require_owner(); at_time timestamptz:=date_trunc('second',clock_timestamp());
 receipt public.command_receipts; profile public.profiles; task public.tasks; next_task public.tasks; topic public.topics; next_topic public.topics;
 session public.study_sessions; interval_row public.study_intervals; plan public.daily_plan_versions;
 result jsonb; before_value jsonb; after_value jsonb; entity_kind text; record_id uuid; local_day date; prior_day date; seconds int; new_seconds int;
 ordered_ids uuid[]; move_index int; swap_index int; swap_id uuid;
begin
 if request_id is null or length(command_type)>80 or payload is null or pg_column_size(payload)>64000 then raise exception 'INVALID_INPUT'; end if;
 select * into receipt from public.command_receipts r where r.user_id=owner_id and r.request_id=command.request_id;
 if found then
 if receipt.command_type<>command_type or receipt.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return receipt.result||'{"replayed":true}'::jsonb;
 end if;
 if (select count(*) from public.command_receipts r where r.user_id=owner_id and r.created_at>at_time-interval '1 minute')>=120 then raise exception 'RATE_LIMITED'; end if;
 perform private.initialize_owner(owner_id);perform private.settle_countdown(owner_id,at_time);
 select * into profile from public.profiles where user_id=owner_id;
 local_day:=(at_time at time zone profile.timezone)::date;
 if command_type in ('task.create','task.update') then
  perform private.check_keys(payload,array['id','expected_revision','title','plan_date','exam','subject','topic_id','resource','completion_criteria','planned_minutes','difficulty','progress','weight_override','priority','position','notes','study_type','steps']);
  entity_kind:='task';
  if command_type='task.create' then
   if payload ? 'id' or payload ? 'expected_revision' then raise exception 'INVALID_INPUT'; end if;
   insert into public.tasks(user_id,title,plan_date,position) values(owner_id,payload->>'title',(payload->>'plan_date')::date,coalesce((select max(t.position) from public.tasks t where t.user_id=owner_id and t.plan_date=(payload->>'plan_date')::date),-1)+1) returning * into task;
  else
   select * into task from public.tasks where user_id=owner_id and id=(payload->>'id')::uuid for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if task.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
   before_value:=to_jsonb(task);prior_day:=task.plan_date;
  end if;
  select * into next_task from jsonb_populate_record(task,payload-'id'-'expected_revision');
  if jsonb_typeof(next_task.steps)<>'array' or not private.valid_steps(next_task.steps) then raise exception 'INVALID_INPUT'; end if;
  if jsonb_array_length(next_task.steps)>0 then select avg(case when (s->>'completed')::boolean then 1 else 0 end) into next_task.progress from jsonb_array_elements(next_task.steps) s; end if;
  update public.tasks set title=next_task.title,plan_date=next_task.plan_date,exam=next_task.exam,subject=next_task.subject,topic_id=next_task.topic_id,resource=next_task.resource,completion_criteria=next_task.completion_criteria,planned_minutes=next_task.planned_minutes,difficulty=next_task.difficulty,progress=next_task.progress,weight_override=next_task.weight_override,priority=next_task.priority,position=next_task.position,notes=next_task.notes,study_type=next_task.study_type,steps=next_task.steps,revision=case when command_type='task.create' then 1 else revision+1 end,updated_at=at_time where id=task.id returning to_jsonb(tasks) into after_value;
  record_id:=task.id;perform private.snapshot_day(owner_id,next_task.plan_date);
  if prior_day is not null and prior_day<>next_task.plan_date then perform private.snapshot_day(owner_id,prior_day); end if;
 elsif command_type='task.move' then
  perform private.check_keys(payload,array['id','expected_revision','direction']);
  if payload->>'direction' is null or payload->>'direction' not in ('up','down') then raise exception 'INVALID_INPUT'; end if;
  select * into task from public.tasks where user_id=owner_id and id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if task.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
  entity_kind:='task';record_id:=task.id;
  select array_agg(t.id order by t.position,t.created_at,t.id),jsonb_agg(to_jsonb(t)-'user_id' order by t.position,t.created_at,t.id) into ordered_ids,before_value from public.tasks t where t.user_id=owner_id and t.plan_date=task.plan_date;
  move_index:=array_position(ordered_ids,task.id);swap_index:=move_index+case when payload->>'direction'='up' then -1 else 1 end;
  if swap_index between 1 and cardinality(ordered_ids) then
   swap_id:=ordered_ids[swap_index];ordered_ids[swap_index]:=task.id;ordered_ids[move_index]:=swap_id;
   update public.tasks t set position=ordering.number-1,revision=t.revision+1,updated_at=at_time
   from unnest(ordered_ids) with ordinality as ordering(id,number)
   where t.id=ordering.id and t.user_id=owner_id and (t.position is distinct from ordering.number-1 or t.id in (task.id,swap_id));
   perform private.snapshot_day(owner_id,task.plan_date);
  end if;
  select jsonb_agg(to_jsonb(t)-'user_id' order by t.position,t.created_at,t.id) into after_value from public.tasks t where t.user_id=owner_id and t.plan_date=task.plan_date;
 elsif command_type in ('topic.create','topic.update') then
  perform private.check_keys(payload,array['id','expected_revision','exam','subject','name','parent_id','mastery','notes','review_requested','source','next_step']);
  entity_kind:='topic';
  if command_type='topic.create' then
   if payload ? 'id' or payload ? 'expected_revision' then raise exception 'INVALID_INPUT'; end if;
   insert into public.topics(user_id,exam,subject,name) values(owner_id,payload->>'exam',payload->>'subject',payload->>'name') returning * into topic;
  else
   select * into topic from public.topics where user_id=owner_id and id=(payload->>'id')::uuid for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if topic.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
   before_value:=to_jsonb(topic);
  end if;
  select * into next_topic from jsonb_populate_record(topic,payload-'id'-'expected_revision');
  if next_topic.parent_id is not null then
   if not exists(select 1 from public.topics t where t.id=next_topic.parent_id and t.user_id=owner_id and t.exam=next_topic.exam and t.subject=next_topic.subject) then raise exception 'INVALID_INPUT'; end if;
   if exists(with recursive ancestors as(select id,parent_id from public.topics where id=next_topic.parent_id union select p.id,p.parent_id from public.topics p join ancestors a on p.id=a.parent_id) select 1 from ancestors where id=topic.id) then raise exception 'INVALID_INPUT'; end if;
  end if;
  update public.topics set exam=next_topic.exam,subject=next_topic.subject,name=next_topic.name,parent_id=next_topic.parent_id,mastery=next_topic.mastery,notes=next_topic.notes,review_requested=next_topic.review_requested,source=next_topic.source,next_step=next_topic.next_step,revision=case when command_type='topic.create' then 1 else revision+1 end,updated_at=at_time where id=topic.id returning to_jsonb(topics) into after_value;
  if topic.mastery<>next_topic.mastery then insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery) values(owner_id,topic.id,topic.mastery,next_topic.mastery); end if;
  record_id:=topic.id;
 elsif command_type='settings.update' then
  perform private.check_keys(payload,array['expected_revision','display_name','exam_year','exam_date','target_rank','timezone','daily_target_minutes','task_share','difficulty_factors','weekday_targets','theme','appearance','reduced_motion','simple_view']);
  entity_kind:='settings';record_id:=owner_id;
  if profile.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
  before_value:=to_jsonb(profile);
  select * into profile from jsonb_populate_record(profile,payload-'expected_revision');
  if not exists(select 1 from pg_timezone_names where name=profile.timezone) then raise exception 'INVALID_INPUT'; end if;
  if payload ? 'daily_target_minutes' and not(payload ? 'weekday_targets') then profile.weekday_targets:=array_fill(profile.daily_target_minutes,array[7]); end if;
  update public.profiles set display_name=profile.display_name,exam_year=profile.exam_year,exam_date=profile.exam_date,target_rank=profile.target_rank,timezone=profile.timezone,daily_target_minutes=profile.daily_target_minutes,task_share=profile.task_share,difficulty_factors=profile.difficulty_factors,weekday_targets=profile.weekday_targets,theme=profile.theme,appearance=profile.appearance,reduced_motion=profile.reduced_motion,simple_view=profile.simple_view,revision=revision+1,updated_at=at_time where user_id=owner_id returning to_jsonb(profiles) into after_value;
  local_day:=(at_time at time zone profile.timezone)::date;
  if payload ?| array['daily_target_minutes','weekday_targets','task_share','difficulty_factors'] then
   perform private.snapshot_day(owner_id,local_day,jsonb_build_object('target_minutes',profile.weekday_targets[extract(isodow from local_day)::int],'task_share',profile.task_share,'difficulty_factors',profile.difficulty_factors));
  end if;
 elsif command_type='plan.update' then
  perform private.check_keys(payload,array['plan_date','expected_revision','target_minutes','task_share','difficulty_factors']);
  entity_kind:='plan';local_day:=(payload->>'plan_date')::date;
  select * into plan from public.daily_plan_versions where user_id=owner_id and plan_date=local_day order by version desc limit 1;
  if not found then raise exception 'NOT_FOUND'; end if;
  if plan.version is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
  before_value:=to_jsonb(plan);perform private.snapshot_day(owner_id,local_day,payload-'plan_date'-'expected_revision');
  select id,to_jsonb(p) into record_id,after_value from public.daily_plan_versions p where user_id=owner_id and plan_date=local_day order by version desc limit 1;
 elsif command_type='timer.start' then
  perform private.check_keys(payload,array['title','task_id','topic_id','subject','study_type','mode','target_seconds']);
  entity_kind:='session';
  if exists(select 1 from public.study_sessions where user_id=owner_id and status in ('running','paused')) then raise exception 'ACTIVE_SESSION'; end if;
  if payload->>'task_id' is not null then
   select * into task from public.tasks where user_id=owner_id and id=(payload->>'task_id')::uuid;
   if not found then raise exception 'INVALID_INPUT'; end if;
  end if;
  insert into public.study_sessions(user_id,title,task_id,topic_id,subject,study_type,mode,target_seconds,started_at,active_since)
  values(owner_id,coalesce(payload->>'title',task.title,'Çalışma'),task.id,coalesce((payload->>'topic_id')::uuid,task.topic_id),coalesce(payload->>'subject',task.subject),coalesce(payload->>'study_type',task.study_type,'Soru çözümü'),coalesce(payload->>'mode','stopwatch'),(payload->>'target_seconds')::int,at_time,at_time) returning * into session;
  insert into public.study_intervals(user_id,session_id,started_at) values(owner_id,session.id,at_time);
  record_id:=session.id;after_value:=to_jsonb(session);
 elsif command_type in ('timer.pause','timer.resume','timer.finish','timer.correct') then
  perform private.check_keys(payload,array['id','expected_revision','confirmed_seconds','reason']);
  entity_kind:='session';
  select * into session from public.study_sessions where user_id=owner_id and id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if session.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
  before_value:=to_jsonb(session)||jsonb_build_object('intervals',(select jsonb_agg(to_jsonb(i)) from public.study_intervals i where session_id=session.id));record_id:=session.id;
  if command_type='timer.resume' then
   if session.status<>'paused' then raise exception 'INVALID_TRANSITION'; end if;
   insert into public.study_intervals(user_id,session_id,started_at) values(owner_id,session.id,at_time);
   update public.study_sessions set status='running',active_since=at_time,revision=revision+1 where id=session.id;
  elsif command_type='timer.correct' then
   if session.status<>'finished' or length(coalesce(payload->>'reason','')) not between 3 and 1000 or not(payload ? 'confirmed_seconds') then raise exception 'INVALID_INPUT'; end if;
   new_seconds:=(payload->>'confirmed_seconds')::int;perform private.trim_session(owner_id,session.id,new_seconds);
   update public.study_sessions set accumulated_seconds=new_seconds,revision=revision+1 where id=session.id;
  else
   if session.status='finished' or (command_type='timer.pause' and session.status<>'running') then raise exception 'INVALID_TRANSITION'; end if;
   if session.status='running' then update public.study_intervals set ended_at=at_time where session_id=session.id and ended_at is null; end if;
   select coalesce(sum(extract(epoch from (ended_at-started_at))),0)::int into seconds from public.study_intervals where session_id=session.id;
   if command_type='timer.finish' and session.mode='stopwatch' and seconds>21600 and not(payload ? 'confirmed_seconds') then raise exception 'CONFIRM_DURATION'; end if;
   new_seconds:=coalesce((payload->>'confirmed_seconds')::int,seconds);
   if new_seconds<>seconds then perform private.trim_session(owner_id,session.id,new_seconds); end if;
   update public.study_sessions set accumulated_seconds=new_seconds,active_since=null,status=case when command_type='timer.pause' then 'paused' else 'finished' end,finished_at=case when command_type='timer.finish' then at_time else null end,revision=revision+1 where id=session.id;
  end if;
  select to_jsonb(s) into after_value from public.study_sessions s where id=session.id;
 else raise exception 'INVALID_INPUT'; end if;
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value) values(owner_id,entity_kind,record_id,command_type,before_value,after_value);
 result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result) values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
create function public.yks_state() returns jsonb language sql security invoker set search_path='' as $$ select private.state() $$;
create function public.yks_command(request_id uuid,command_type text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.command(request_id,command_type,payload) $$;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.state(),private.command(uuid,text,jsonb) to authenticated;
revoke all on function public.yks_state(),public.yks_command(uuid,text,jsonb) from public,anon;
grant execute on function public.yks_state(),public.yks_command(uuid,text,jsonb) to authenticated;



