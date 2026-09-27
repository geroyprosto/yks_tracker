-- Additive education personalization. Existing YKS rows and time totals stay intact.
create function private.education_course_key(value text) returns text language sql immutable set search_path='' as $$
 select lower(translate(regexp_replace(btrim(normalize(value,NFC)),'\s+',' ','g'),'Iİ','ıi'))
$$;
create table public.education_terms(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 academic_year text not null check(length(academic_year) between 1 and 40),name text not null check(length(name) between 1 and 80),
 starts_on date,ends_on date,archived boolean not null default false,revision integer not null default 1,
 created_at timestamptz not null default now(),unique(id,user_id),check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create table public.education_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 education_level text not null check(education_level in ('high_school','university','graduate')),yks_goal boolean not null,
 grade integer,department text not null default '' check(length(department)<=160),university_year text not null default '' check(length(university_year)<=40),
 yks_track text not null default 'undecided' check(yks_track in ('sayisal','esit_agirlik','sozel','dil','undecided')),
 modules jsonb not null default '{"tasks":true,"timer":true,"results":true,"statistics":true,"journal":true}',
 active_term_id uuid,onboarding_completed_at timestamptz not null default now(),revision integer not null default 1,
 foreign key(active_term_id,user_id) references public.education_terms(id,user_id),
 check((education_level='high_school' and grade between 9 and 12) or (education_level<>'high_school' and grade is null)),
 check(education_level<>'graduate' or yks_goal)
);
create table public.education_drafts(
 user_id uuid primary key references auth.users(id) on delete cascade,step integer not null check(step between 0 and 3),
 data jsonb not null check(jsonb_typeof(data)='object' and pg_column_size(data)<=60000),revision integer not null default 1,updated_at timestamptz not null default now()
);
create table public.education_courses(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,term_id uuid,
 name text not null check(length(name) between 1 and 120),normalized_name text generated always as(private.education_course_key(name)) stored,
 context text not null check(context in ('school','yks')),exam text check(exam in ('TYT','AYT')),catalog_subject text,archived boolean not null default false,
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,user_id),foreign key(term_id,user_id) references public.education_terms(id,user_id),
 check((context='school' and exam is null and term_id is not null) or (context='yks' and exam is not null and length(name)<=116))
);
create unique index education_course_context_name on public.education_courses(user_id,coalesce(term_id,'00000000-0000-0000-0000-000000000000'::uuid),context,coalesce(exam,''),normalized_name);
-- A display-name edit must never retarget the preserved YKS topic catalog.
create function private.education_catalog_identity() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='INSERT' then new.catalog_subject:=case when new.context='yks' then new.name else null end;
 else new.catalog_subject:=old.catalog_subject;end if;return new;
end $$;
create trigger education_catalog_identity before insert or update on public.education_courses for each row execute function private.education_catalog_identity();
revoke all on function private.education_catalog_identity() from public,anon,authenticated,service_role;
create unique index education_yks_catalog_identity on public.education_courses(user_id,coalesce(term_id,'00000000-0000-0000-0000-000000000000'::uuid),exam,private.education_course_key(catalog_subject)) where context='yks';
create table public.course_exam_results(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null,term_id uuid,course_name text not null,exam_date date not null,
 assessment_type text not null check(length(assessment_type) between 1 and 80),assessment_name text not null default '' check(length(assessment_name)<=160),
 score numeric not null check(score>=0 and score<=1000000),scale numeric not null check(scale>0 and scale<=1000000),check(score<=scale),
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(course_id,user_id) references public.education_courses(id,user_id),foreign key(term_id,user_id) references public.education_terms(id,user_id)
);
create index course_exam_results_series on public.course_exam_results(user_id,course_id,exam_date);
create table private.education_receipts(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,command_type text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id));
-- Existing accounts keep their established YKS workspace without forced onboarding.
insert into public.education_profiles(user_id,education_level,yks_goal) select user_id,'graduate',true from public.profiles;
insert into public.education_courses(user_id,name,context,exam) select distinct user_id,subject,'yks',exam from public.topics where length(subject)<=116 on conflict do nothing;

create function private.education_can_draft(actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select actor=auth.uid() and private.is_browser_session()
 and exists(select 1 from public.classroom_accounts a where a.id=actor and a.role='student' and a.status in ('approved','pending'))
 and exists(select 1 from auth.users u where u.id=actor and nullif(to_jsonb(u)->>'email_confirmed_at','') is not null)
$$;
revoke all on function private.education_can_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function private.education_can_draft(uuid) to authenticated;
do $$ declare t text;begin
 foreach t in array array['education_profiles','education_terms','education_courses','course_exam_results'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy education_self on public.%I for select to authenticated using(user_id=(select auth.uid()) and (select private.classroom_can_study(auth.uid())))',t);
 end loop;
end $$;
alter table public.education_drafts enable row level security;
revoke all on public.education_drafts from public,anon,authenticated;
grant select on public.education_drafts to authenticated;
create policy education_draft_self on public.education_drafts for select to authenticated using(user_id=(select auth.uid()) and (select private.education_can_draft(auth.uid())));
revoke all on private.education_receipts from public,anon,authenticated,service_role;

create function private.education_state_for(actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'profile',(select to_jsonb(p)-'user_id' from public.education_profiles p where p.user_id=actor),
 'draft',(select to_jsonb(d)-'user_id' from public.education_drafts d where d.user_id=actor),
 'terms',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by created_at desc,id) from public.education_terms t where t.user_id=actor),'[]'),
 'courses',coalesce((select jsonb_agg(to_jsonb(c)-'user_id' order by name,id) from public.education_courses c where c.user_id=actor),'[]'),
 'results',coalesce((select jsonb_agg(to_jsonb(r)-'user_id' order by exam_date desc,created_at desc,id) from public.course_exam_results r where r.user_id=actor),'[]'),
 'needs_onboarding',not exists(select 1 from public.education_profiles p where p.user_id=actor),
 'can_commit',private.classroom_can_study(actor))
$$;
revoke all on function private.education_state_for(uuid) from public,anon,authenticated,service_role;
create function private.education_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 if not private.education_can_draft(actor) then raise exception 'STUDENT_REQUIRED';end if;
 if not private.classroom_can_study(actor) then
  return jsonb_build_object('profile',null,'draft',(select to_jsonb(d)-'user_id' from public.education_drafts d where d.user_id=actor),'terms','[]'::jsonb,'courses','[]'::jsonb,'results','[]'::jsonb,'needs_onboarding',true,'can_commit',false);
 end if;
 return private.education_state_for(actor);
end $$;
create function public.education_state() returns jsonb language sql security invoker set search_path='' as $$select private.education_state()$$;
revoke all on function public.education_state(),private.education_state() from public,anon,authenticated,service_role;
grant execute on function public.education_state(),private.education_state() to authenticated;

-- Validation is repeated inside the RPC; bypassing the HTTP schema cannot add roles or hidden fields.
create function private.education_validate_setup(value jsonb,draft_mode boolean default false) returns void language plpgsql set search_path='' as $$
declare p jsonb:=value->'profile';t jsonb:=value->'term';c jsonb;k text;begin
 perform private.check_keys(value,array['profile','term','courses','expected_revision']);
 if value is null or not(value ?& array['profile','term','courses']) then raise exception 'INVALID_INPUT';end if;
 perform private.check_keys(p,array['education_level','yks_goal','grade','department','university_year','yks_track','modules']);
 if p is null or not(p ?& array['education_level','yks_goal','grade','department','university_year','yks_track','modules']) or p->>'education_level' not in ('high_school','university','graduate') or jsonb_typeof(p->'yks_goal') is distinct from 'boolean' or p->>'yks_track' not in ('sayisal','esit_agirlik','sozel','dil','undecided') then raise exception 'INVALID_INPUT';end if;
 if jsonb_typeof(p->'department') is distinct from 'string' or length(p->>'department')>160 or jsonb_typeof(p->'university_year') is distinct from 'string' or length(p->>'university_year')>40 then raise exception 'INVALID_INPUT';end if;
 if p->'grade' is distinct from 'null'::jsonb and (jsonb_typeof(p->'grade') is distinct from 'number' or (p->>'grade')::numeric not between 9 and 12 or (p->>'grade')::numeric<>trunc((p->>'grade')::numeric)) then raise exception 'INVALID_INPUT';end if;
 if not draft_mode and ((p->>'education_level'='high_school' and (jsonb_typeof(p->'grade') is distinct from 'number' or (p->>'grade')::numeric not between 9 and 12 or (p->>'grade')::numeric<>trunc((p->>'grade')::numeric))) or (p->>'education_level'<>'high_school' and p->'grade' is distinct from 'null'::jsonb) or (p->>'education_level'='graduate' and p->'yks_goal'<>'true'::jsonb)) then raise exception 'INVALID_INPUT';end if;
 perform private.check_keys(p->'modules',array['tasks','timer','results','statistics','journal']);
 foreach k in array array['tasks','timer','results','statistics','journal'] loop if jsonb_typeof(p->'modules'->k) is distinct from 'boolean' then raise exception 'INVALID_INPUT';end if;end loop;
 if t is distinct from 'null'::jsonb then
  perform private.check_keys(t,array['id','academic_year','name','starts_on','ends_on']);
  if coalesce(length(btrim(t->>'academic_year')),0) not between (case when draft_mode then 0 else 1 end) and 40 or coalesce(length(btrim(t->>'name')),0) not between (case when draft_mode then 0 else 1 end) and 80 then raise exception 'INVALID_INPUT';end if;
  if t->>'starts_on' is not null and (t->>'starts_on' !~ '^\d{4}-\d{2}-\d{2}$' or (t->>'starts_on')::date::text<>t->>'starts_on') then raise exception 'INVALID_INPUT';end if;
  if t->>'ends_on' is not null and (t->>'ends_on' !~ '^\d{4}-\d{2}-\d{2}$' or (t->>'ends_on')::date::text<>t->>'ends_on') then raise exception 'INVALID_INPUT';end if;
  if not draft_mode and (t->>'ends_on')::date<(t->>'starts_on')::date then raise exception 'INVALID_INPUT';end if;
 end if;
 if jsonb_typeof(value->'courses') is distinct from 'array' or jsonb_array_length(value->'courses')>100 then raise exception 'INVALID_INPUT';end if;
 for c in select * from jsonb_array_elements(value->'courses') loop
  perform private.check_keys(c,array['name','context','exam']);
  if coalesce(length(btrim(c->>'name')),0) not between 1 and 120 or coalesce(c->>'context','') not in ('school','yks') or (c->>'context'='school' and ((t='null'::jsonb and not draft_mode) or c->>'exam' is not null)) or (c->>'context'='yks' and coalesce(c->>'exam','') not in ('TYT','AYT')) then raise exception 'INVALID_INPUT';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(value->'courses') as entries(item) group by private.education_course_key(item->>'name'),item->>'context',item->>'exam' having count(*)>1) then raise exception 'DUPLICATE_COURSE';end if;
end $$;

create function private.education_command(request_id uuid,command_type text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); receipt private.education_receipts; p jsonb;t jsonb;c jsonb;r jsonb;result jsonb;record_id uuid;term_id uuid;
 profile public.education_profiles;draft public.education_drafts;course public.education_courses;score_row public.course_exam_results; prior jsonb;begin
 if not private.education_can_draft(actor) then raise exception 'STUDENT_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 if request_id is null or payload is null or jsonb_typeof(payload)<>'object' or pg_column_size(payload)>64000 then raise exception 'INVALID_INPUT';end if;
 if payload?'expected_revision' and (jsonb_typeof(payload->'expected_revision') is distinct from 'number' or (payload->>'expected_revision')::numeric<0 or (payload->>'expected_revision')::numeric<>trunc((payload->>'expected_revision')::numeric)) then raise exception 'INVALID_INPUT';end if;
 if command_type not in ('draft.save','draft.discard') and not private.classroom_can_study(actor) then raise exception 'APPROVAL_REQUIRED';end if;
 select * into receipt from private.education_receipts e where e.user_id=actor and e.request_id=education_command.request_id;
 if found then
  if receipt.command_type<>command_type or receipt.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return receipt.result||'{"replayed":true}'::jsonb;
 end if;
 if (select count(*) from private.education_receipts where user_id=actor and created_at>clock_timestamp()-interval '1 minute')>=120 then raise exception 'RATE_LIMITED';end if;
 if command_type in ('draft.save','draft.discard') then
  perform private.check_keys(payload,case when command_type='draft.save' then array['expected_revision','step','data'] else array['expected_revision'] end);
  select * into draft from public.education_drafts where user_id=actor;
  if coalesce(draft.revision,0) is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT';end if;
  if command_type='draft.save' then
   perform private.education_validate_setup(payload->'data',true);
   if jsonb_typeof(payload->'step') is distinct from 'number' or (payload->>'step')::numeric not between 0 and 3 or (payload->>'step')::numeric<>trunc((payload->>'step')::numeric) then raise exception 'INVALID_INPUT';end if;
   insert into public.education_drafts(user_id,step,data) values(actor,(payload->>'step')::int,payload->'data') on conflict(user_id) do update set step=excluded.step,data=excluded.data,revision=education_drafts.revision+1,updated_at=clock_timestamp();
  else delete from public.education_drafts where user_id=actor;end if;
  record_id:=actor;
 elsif command_type='profile.save' then
  perform private.education_validate_setup(payload);p:=payload->'profile';t:=payload->'term';
  select * into profile from public.education_profiles where user_id=actor;
  if coalesce(profile.revision,0) is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT';end if;
  if exists(select 1 from public.study_sessions where user_id=actor and status in ('running','paused')) then raise exception 'ACTIVE_SESSION';end if;
  if t<>'null'::jsonb then
   if t->>'id' is not null then
    select id into term_id from public.education_terms where id=(t->>'id')::uuid and user_id=actor;
    if term_id is null then raise exception 'INVALID_INPUT';end if;
    update public.education_terms set name=btrim(t->>'name'),academic_year=btrim(t->>'academic_year'),starts_on=(t->>'starts_on')::date,ends_on=(t->>'ends_on')::date,revision=revision+1 where id=term_id;
   else insert into public.education_terms(user_id,name,academic_year,starts_on,ends_on) values(actor,btrim(t->>'name'),btrim(t->>'academic_year'),(t->>'starts_on')::date,(t->>'ends_on')::date) returning id into term_id;end if;
  end if;
  update public.education_terms set archived=(id is distinct from term_id) where user_id=actor;
  insert into public.education_profiles(user_id,education_level,yks_goal,grade,department,university_year,yks_track,modules,active_term_id)
  values(actor,p->>'education_level',(p->>'yks_goal')::boolean,(p->>'grade')::int,btrim(p->>'department'),btrim(p->>'university_year'),p->>'yks_track',p->'modules',term_id)
  on conflict(user_id) do update set education_level=excluded.education_level,yks_goal=excluded.yks_goal,grade=excluded.grade,department=excluded.department,university_year=excluded.university_year,yks_track=excluded.yks_track,modules=excluded.modules,active_term_id=excluded.active_term_id,revision=education_profiles.revision+1;
  for c in select * from jsonb_array_elements(payload->'courses') loop
   insert into public.education_courses(user_id,term_id,name,context,exam) values(actor,case when c->>'context'='school' then term_id else null end,btrim(c->>'name'),c->>'context',c->>'exam') on conflict do nothing;
  end loop;
  -- Stable YKS subject IDs use their separate context and never merge into school subjects.
  if (p->>'yks_goal')::boolean then
   insert into public.education_courses(user_id,name,context,exam) select distinct actor,subject,'yks',exam from public.topics where user_id=actor and length(subject)<=116 on conflict do nothing;
  end if;
  delete from public.education_drafts where user_id=actor;record_id:=actor;
 elsif command_type='course.create' then
  perform private.check_keys(payload,array['id','term_id','name','context','exam']);
  if jsonb_typeof(payload->'name') is distinct from 'string' or jsonb_typeof(payload->'context') is distinct from 'string' then raise exception 'INVALID_INPUT';end if;
  term_id:=(payload->>'term_id')::uuid;
  if term_id is not null and not exists(select 1 from public.education_terms where id=term_id and user_id=actor and not archived) then raise exception 'INVALID_INPUT';end if;
  insert into public.education_courses(id,user_id,term_id,name,context,exam) values(coalesce((payload->>'id')::uuid,gen_random_uuid()),actor,term_id,btrim(payload->>'name'),payload->>'context',payload->>'exam') returning id into record_id;
 elsif command_type='course.update' then
  perform private.check_keys(payload,array['id','expected_revision','name','archived']);
  if (payload?'name' and jsonb_typeof(payload->'name') is distinct from 'string') or (payload?'archived' and jsonb_typeof(payload->'archived') is distinct from 'boolean') then raise exception 'INVALID_INPUT';end if;
  select * into course from public.education_courses where id=(payload->>'id')::uuid and user_id=actor;
  if not found then raise exception 'NOT_FOUND';end if;
  if course.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT';end if;
  update public.education_courses set name=case when payload?'name' then btrim(payload->>'name') else name end,archived=coalesce((payload->>'archived')::boolean,archived),revision=revision+1,updated_at=clock_timestamp() where id=course.id;
  record_id:=course.id;
 elsif command_type='term.activate' then
  perform private.check_keys(payload,array['id']);term_id:=(payload->>'id')::uuid;
  if not exists(select 1 from public.education_terms where id=term_id and user_id=actor) then raise exception 'NOT_FOUND';end if;
  if exists(select 1 from public.study_sessions where user_id=actor and status in ('running','paused')) then raise exception 'ACTIVE_SESSION';end if;
  update public.education_terms set archived=(id<>term_id) where user_id=actor;
  update public.education_profiles set active_term_id=term_id,revision=revision+1 where user_id=actor;record_id:=term_id;
 elsif command_type='results.batch' then
  perform private.check_keys(payload,array['rows']);
  if jsonb_typeof(payload->'rows') is distinct from 'array' or jsonb_array_length(payload->'rows') not between 1 and 100 then raise exception 'INVALID_INPUT';end if;
  for r in select * from jsonb_array_elements(payload->'rows') loop
   perform private.check_keys(r,array['course_id','exam_date','assessment_type','assessment_name','score','scale']);
   if jsonb_typeof(r->'score') is distinct from 'number' or jsonb_typeof(r->'scale') is distinct from 'number' or coalesce(r->>'exam_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_INPUT';end if;
   select * into course from public.education_courses where id=(r->>'course_id')::uuid and user_id=actor and context='school' and not archived;
   if not found or not exists(select 1 from public.education_terms where id=course.term_id and user_id=actor and not archived) then raise exception 'INVALID_INPUT';end if;
   insert into public.course_exam_results(user_id,course_id,term_id,course_name,exam_date,assessment_type,assessment_name,score,scale) values(actor,course.id,course.term_id,course.name,(r->>'exam_date')::date,btrim(r->>'assessment_type'),coalesce(btrim(r->>'assessment_name'),''),(r->>'score')::numeric,(r->>'scale')::numeric) returning id into record_id;
  end loop;
 elsif command_type='result.update' then
  perform private.check_keys(payload,array['id','expected_revision','exam_date','assessment_type','assessment_name','score','scale']);
  select * into score_row from public.course_exam_results where id=(payload->>'id')::uuid and user_id=actor;
  if not found then raise exception 'NOT_FOUND';end if;
  if score_row.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT';end if;
  prior:=to_jsonb(score_row);
  if (payload?'score' and jsonb_typeof(payload->'score') is distinct from 'number') or (payload?'scale' and jsonb_typeof(payload->'scale') is distinct from 'number') or (payload?'exam_date' and coalesce(payload->>'exam_date','') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'INVALID_INPUT';end if;
  update public.course_exam_results set exam_date=coalesce((payload->>'exam_date')::date,exam_date),assessment_type=coalesce(btrim(payload->>'assessment_type'),assessment_type),assessment_name=coalesce(btrim(payload->>'assessment_name'),assessment_name),score=coalesce((payload->>'score')::numeric,score),scale=coalesce((payload->>'scale')::numeric,scale),revision=revision+1,updated_at=clock_timestamp() where id=score_row.id;
  insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value) values(actor,'course_exam_result',score_row.id,'result.update',prior,payload);
  record_id:=score_row.id;
 else raise exception 'INVALID_INPUT';end if;
 result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
 insert into private.education_receipts(user_id,request_id,command_type,payload,result) values(actor,request_id,command_type,payload,result);
 return result;
exception when unique_violation then raise exception 'DUPLICATE_COURSE';
end $$;
create function public.education_command(request_id uuid,command_type text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.education_command(request_id,command_type,payload)$$;
revoke all on function private.education_validate_setup(jsonb,boolean),private.education_course_key(text),public.education_command(uuid,text,jsonb),private.education_command(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.education_command(uuid,text,jsonb),private.education_command(uuid,text,jsonb) to authenticated;

-- New relations are nullable; ambiguous historical labels stay unchanged and unlinked.
alter table public.tasks add column course_id uuid,add foreign key(course_id,user_id) references public.education_courses(id,user_id);
alter table public.study_sessions add column course_id uuid,add foreign key(course_id,user_id) references public.education_courses(id,user_id);
alter table public.manual_study_entries add column course_id uuid,add foreign key(course_id,user_id) references public.education_courses(id,user_id);
-- Conservative linkage only. A task's explicit exam supplies context; timer
-- and manual labels need an explicit TYT/AYT prefix. Bare names stay unlinked.
-- The unique catalog index guarantees exactly one candidate in this context.
update public.tasks t set course_id=c.id from public.education_courses c
 where c.user_id=t.user_id and c.term_id is null and c.context='yks' and c.exam=t.exam
 and c.normalized_name=private.education_course_key(t.subject)
 and (t.topic_id is null or exists(select 1 from public.topics topic where topic.id=t.topic_id and topic.user_id=t.user_id and topic.exam=c.exam and private.education_course_key(topic.subject)=c.normalized_name));
update public.study_sessions s set course_id=c.id from public.education_courses c
 where c.user_id=s.user_id and c.term_id is null and c.context='yks'
 and private.education_course_key(c.exam||' '||c.name)=private.education_course_key(s.subject)
 and (s.topic_id is null or exists(select 1 from public.topics topic where topic.id=s.topic_id and topic.user_id=s.user_id and topic.exam=c.exam and private.education_course_key(topic.subject)=c.normalized_name));
update public.manual_study_entries m set course_id=c.id from public.education_courses c
 where c.user_id=m.user_id and c.term_id is null and c.context='yks'
 and private.education_course_key(c.exam||' '||c.name)=private.education_course_key(m.subject);
create function private.education_course_link() returns trigger language plpgsql set search_path='' as $$
declare course public.education_courses;link_changed boolean;begin
 if new.course_id is null then return new;end if;
 link_changed:=tg_op='INSERT' or new.course_id is distinct from old.course_id;
 select * into course from public.education_courses where id=new.course_id and user_id=new.user_id;
 if not found then raise exception 'INVALID_INPUT';end if;
 if link_changed then
  if course.archived or (course.term_id is not null and not exists(select 1 from public.education_terms where id=course.term_id and user_id=new.user_id and not archived)) then raise exception 'INVALID_INPUT';end if;
  new.subject:=case when tg_table_name<>'tasks' and course.context='yks' then course.exam||' '||course.name else course.name end;
 end if;
 if tg_table_name='tasks' then
  if (link_changed or new.topic_id is distinct from old.topic_id) and new.topic_id is not null and not exists(select 1 from public.topics where id=new.topic_id and user_id=new.user_id and course.context='yks' and exam=course.exam and private.education_course_key(subject)=private.education_course_key(course.catalog_subject)) then raise exception 'INVALID_INPUT';end if;
  new.exam:=course.exam;
 elsif tg_table_name='study_sessions' then
  if (link_changed or new.task_id is distinct from old.task_id) and new.task_id is not null and exists(select 1 from public.tasks where id=new.task_id and user_id=new.user_id and course_id is not null and course_id<>new.course_id) then raise exception 'INVALID_INPUT';end if;
  if (link_changed or new.topic_id is distinct from old.topic_id) and new.topic_id is not null and not exists(select 1 from public.topics where id=new.topic_id and user_id=new.user_id and course.context='yks' and exam=course.exam and private.education_course_key(subject)=private.education_course_key(course.catalog_subject)) then raise exception 'INVALID_INPUT';end if;
 end if;
 return new;
end $$;
create trigger education_course_link before insert or update on public.tasks for each row execute function private.education_course_link();
create trigger education_course_link before insert or update on public.study_sessions for each row execute function private.education_course_link();
create trigger education_course_link before insert or update on public.manual_study_entries for each row execute function private.education_course_link();
-- Extend the current implementation in place so existing behavior and audit/receipt paths stay shared.
do $$ declare body text;begin
 body:=pg_get_functiondef('private.command(uuid,text,jsonb)'::regprocedure);
 body:=replace(body,$text$array['id','expected_revision','title'$text$,$text$array['course_id','id','expected_revision','title'$text$);
 body:=replace(body,'update public.tasks set title=next_task.title','update public.tasks set course_id=next_task.course_id,title=next_task.title');
 body:=replace(body,$text$array['title','task_id','topic_id'$text$,$text$array['course_id','title','task_id','topic_id'$text$);
 body:=replace(body,'insert into public.study_sessions(user_id,title,task_id,topic_id,subject','insert into public.study_sessions(course_id,user_id,title,task_id,topic_id,subject');
 body:=replace(body,$text$values(owner_id,coalesce(payload->>'title',task.title,'Çalışma')$text$,$text$values(coalesce((payload->>'course_id')::uuid,task.course_id),owner_id,coalesce(payload->>'title',task.title,'Çalışma')$text$);
 body:=replace(body,$text$elsif command_type='timer.correct' then$text$,$text$elsif command_type='timer.correct' then raise exception 'DURATION_IMMUTABLE';$text$);
 execute body;
 body:=pg_get_functiondef('private.manual_study_command(uuid,text,jsonb)'::regprocedure);
 body:=replace(body,$text$array['confirmed_by_user','study_date','subject','minutes']$text$,$text$array['course_id','confirmed_by_user','study_date','subject','minutes']$text$);
 body:=replace(body,'insert into public.manual_study_entries(user_id,study_date,subject,duration_seconds)','insert into public.manual_study_entries(course_id,user_id,study_date,subject,duration_seconds)');
 body:=replace(body,'values(owner_id,study_day,subject_name,minutes*60)',$text$values((payload->>'course_id')::uuid,owner_id,study_day,subject_name,minutes*60)$text$);
 body:=replace(body,$text$jsonb_typeof(payload->'subject')<>'string'$text$,$text$(payload ? 'subject' and jsonb_typeof(payload->'subject') is distinct from 'string')$text$);
 body:=replace(body,$text$subject_name:=btrim(payload->>'subject');$text$,$text$subject_name:=btrim(payload->>'subject');
  if payload->>'course_id' is not null then
   select case when c.context='yks' then c.exam||' '||c.name else c.name end into subject_name from public.education_courses c where c.id=(payload->>'course_id')::uuid and c.user_id=owner_id;
  end if;$text$);
 execute body;
end $$;

-- Protect finalized durations even from new RPCs, direct SQL writes, and interval deletion.
create function private.immutable_study_duration() returns trigger language plpgsql set search_path='' as $$
begin
 -- Auth account closure is a separate privileged lifecycle. Its parent row has
 -- already been removed when ON DELETE CASCADE reaches these child records.
 -- Ordinary study deletion still has a live parent and receives no exception.
 if tg_op='DELETE' then
  if not exists(select 1 from auth.users where id=old.user_id) then return old;end if;
 end if;
 if tg_table_name='study_sessions' then
 if old.status='finished' then
  if tg_op='DELETE' then raise exception 'DURATION_IMMUTABLE';end if;
  if (new.accumulated_seconds,new.started_at,new.finished_at,new.active_since,new.status,new.mode,new.target_seconds,new.user_id,new.id,new.course_id) is distinct from (old.accumulated_seconds,old.started_at,old.finished_at,old.active_since,old.status,old.mode,old.target_seconds,old.user_id,old.id,old.course_id) then raise exception 'DURATION_IMMUTABLE';end if;
 end if;
 elsif tg_table_name='study_intervals' then
  if exists(select 1 from public.study_sessions where id=old.session_id and status='finished') then raise exception 'DURATION_IMMUTABLE';end if;
  if tg_op='UPDATE' then
   if exists(select 1 from public.study_sessions where id=new.session_id and status='finished') then raise exception 'DURATION_IMMUTABLE';end if;
  end if;
 elsif tg_table_name='manual_study_entries' then
  if tg_op='DELETE' then raise exception 'DURATION_IMMUTABLE';end if;
  if (new.duration_seconds,new.study_date,new.user_id,new.id,new.created_at,new.course_id) is distinct from (old.duration_seconds,old.study_date,old.user_id,old.id,old.created_at,old.course_id) then raise exception 'DURATION_IMMUTABLE';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger immutable_study_duration before update or delete on public.study_sessions for each row execute function private.immutable_study_duration();
create trigger immutable_study_duration before update or delete on public.study_intervals for each row execute function private.immutable_study_duration();
create trigger immutable_study_duration before update or delete on public.manual_study_entries for each row execute function private.immutable_study_duration();
create function private.closed_session_interval_insert() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.study_sessions where id=new.session_id and status='finished') then raise exception 'DURATION_IMMUTABLE';end if;return new;
end $$;
create trigger closed_session_interval_insert before insert on public.study_intervals for each row execute function private.closed_session_interval_insert();
revoke all on function private.education_course_link(),private.immutable_study_duration(),private.closed_session_interval_insert() from public,anon,authenticated,service_role;

-- Preserve every existing state field, including format/net catalogs and journal controls.
alter function public.yks_state() rename to yks_state_before_education;
create function public.yks_state() returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin result:=public.yks_state_before_education();return result||jsonb_build_object('education',private.education_state_for(auth.uid()));end $$;
-- Only the narrow owner-checked wrapper can call the unrestricted projection.
alter function public.yks_state() security definer;
revoke all on function public.yks_state() from public,anon,authenticated,service_role;
grant execute on function public.yks_state() to authenticated;
create or replace function public.analysis_source_state(p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.analysis_require_target_study_user(p_user_id);
 return private.analysis_source_state_for(p_user_id)||jsonb_build_object('manual_study_entries',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.study_date desc,t.created_at desc,t.id) from public.manual_study_entries t where t.user_id=p_user_id),'[]'::jsonb),'education',private.education_state_for(p_user_id));
end $$;
