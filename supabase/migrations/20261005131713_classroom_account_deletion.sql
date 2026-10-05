-- Account closure is a server-only lifecycle. Storage is deleted through its API
-- first; this trigger and every database cascade share Auth's delete transaction.
create table private.classroom_account_deletion_keys (
 user_id uuid primary key references auth.users(id) on delete cascade,
 registration_email_digests text[] not null default '{}'
);
alter table private.classroom_account_deletion_keys enable row level security;
revoke all on private.classroom_account_deletion_keys from public,anon,authenticated,service_role;

alter table public.classroom_accounts drop constraint classroom_accounts_teacher_id_fkey,
 add constraint classroom_accounts_teacher_id_fkey foreign key(teacher_id) references public.classroom_accounts(id) on delete set null;
alter table public.classroom_applications drop constraint classroom_applications_teacher_id_fkey,
 drop constraint classroom_applications_reviewed_by_fkey,
 add constraint classroom_applications_teacher_id_fkey foreign key(teacher_id) references public.classroom_accounts(id) on delete set null,
 add constraint classroom_applications_reviewed_by_fkey foreign key(reviewed_by) references auth.users(id) on delete set null;
alter table public.classroom_invites drop constraint classroom_invites_teacher_id_fkey,
 add constraint classroom_invites_teacher_id_fkey foreign key(teacher_id) references public.classroom_accounts(id) on delete cascade;
alter table public.classroom_messages drop constraint classroom_messages_teacher_id_fkey,
 drop constraint classroom_messages_student_id_fkey,drop constraint classroom_messages_sender_id_fkey,drop constraint classroom_messages_parent_id_fkey,
 add constraint classroom_messages_teacher_id_fkey foreign key(teacher_id) references public.classroom_accounts(id) on delete cascade,
 add constraint classroom_messages_student_id_fkey foreign key(student_id) references public.classroom_accounts(id) on delete cascade,
 add constraint classroom_messages_sender_id_fkey foreign key(sender_id) references public.classroom_accounts(id) on delete cascade,
 add constraint classroom_messages_parent_id_fkey foreign key(parent_id) references public.classroom_messages(id) on delete cascade;
alter table public.classroom_alerts drop constraint classroom_alerts_teacher_id_fkey,
 drop constraint classroom_alerts_student_id_fkey,drop constraint classroom_alerts_parent_id_fkey,
 add constraint classroom_alerts_teacher_id_fkey foreign key(teacher_id) references public.classroom_accounts(id) on delete cascade,
 add constraint classroom_alerts_student_id_fkey foreign key(student_id) references public.classroom_accounts(id) on delete cascade,
 add constraint classroom_alerts_parent_id_fkey foreign key(parent_id) references public.classroom_alerts(id) on delete cascade;
alter table public.classroom_feedback drop constraint classroom_feedback_alert_id_fkey,
 drop constraint classroom_feedback_teacher_id_fkey,drop constraint classroom_feedback_student_id_fkey,
 add constraint classroom_feedback_alert_id_fkey foreign key(alert_id) references public.classroom_alerts(id) on delete cascade,
 add constraint classroom_feedback_teacher_id_fkey foreign key(teacher_id) references public.classroom_accounts(id) on delete cascade,
 add constraint classroom_feedback_student_id_fkey foreign key(student_id) references public.classroom_accounts(id) on delete cascade;
alter table public.classroom_presence drop constraint classroom_presence_user_id_fkey,
 add constraint classroom_presence_user_id_fkey foreign key(user_id) references public.classroom_accounts(id) on delete cascade;
alter table public.classroom_receipts drop constraint classroom_receipts_user_id_fkey,
 add constraint classroom_receipts_user_id_fkey foreign key(user_id) references auth.users(id) on delete cascade;
alter table private.classroom_email_outbox drop constraint classroom_email_outbox_application_id_fkey,
 add constraint classroom_email_outbox_application_id_fkey foreign key(application_id) references public.classroom_applications(id) on delete cascade;

-- Match structured copies exactly. Names and arbitrary text substrings are not
-- deletion predicates: they could erase another person's unrelated records.
create function private.classroom_delete_json_matches(value jsonb,identifiers text[])
returns boolean language sql immutable set search_path='' as $$
 select case jsonb_typeof(value)
 when 'string' then coalesce(lower(value#>>'{}')=any(identifiers),false)
 when 'array' then exists(select 1 from jsonb_array_elements(value) item where private.classroom_delete_json_matches(item,identifiers))
 when 'object' then exists(select 1 from jsonb_each(value) item where private.classroom_delete_json_matches(item.value,identifiers))
 else false end
$$;
revoke all on function private.classroom_delete_json_matches(jsonb,text[]) from public,anon,authenticated,service_role;

create function private.classroom_account_delete_prepare(
 p_actor_id uuid,p_target_id uuid,p_confirmation_email text,p_registration_email_digests text[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.classroom_accounts; emails text[]; storage_paths jsonb:='[]'; identity_emails text[]:='{}';
begin
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
  or not exists(select 1 from public.classroom_accounts where id=p_actor_id and role='admin' and status='approved') then raise exception 'ACCESS_DENIED';end if;
 if p_target_id is null or p_target_id=p_actor_id or exists(select 1 from public.owner_allowlist where user_id=p_target_id)
  or exists(select 1 from public.classroom_accounts where id=p_target_id and role='admin') then raise exception 'ACCESS_DENIED';end if;
 if p_registration_email_digests is null or cardinality(p_registration_email_digests)>100
  or exists(select 1 from unnest(p_registration_email_digests) digest where digest is null or digest!~'^[0-9a-f]{64}$') then raise exception 'INVALID_INPUT';end if;
 -- Match Auth DELETE's row-before-advisory order. NO KEY UPDATE allows an
 -- already-running study command to finish its FK inserts while we await it.
 perform 1 from auth.users where id=p_target_id for no key update;
 if not found then return jsonb_build_object('exists',false,'emails','[]'::jsonb,'storage','[]'::jsonb);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_target_id::text,0));
 select * into target from public.classroom_accounts where id=p_target_id for update;
 if target.id is null then raise exception 'NOT_FOUND';end if;
 if p_confirmation_email is null or p_confirmation_email<>target.email then raise exception 'DELETE_CONFIRMATION_REQUIRED';end if;
 select array_agg(distinct lower(btrim(email))) into emails from (
  select target.email email union all select a.email from public.classroom_applications a where a.user_id=p_target_id
  union all select to_jsonb(u)->>'email' from auth.users u where u.id=p_target_id
  union all select to_jsonb(u)->>'email_change' from auth.users u where u.id=p_target_id
 ) known where nullif(btrim(email),'') is not null;
 if to_regclass('auth.identities') is not null then
  execute 'select coalesce(array_agg(distinct lower(btrim(email))),''{}''::text[]) from (
   select coalesce(to_jsonb(i)->>''email'',to_jsonb(i)->''identity_data''->>''email'') email from auth.identities i where user_id=$1
  ) known where nullif(btrim(email),'''') is not null' into identity_emails using p_target_id;
  select array_agg(distinct email) into emails from unnest(emails||identity_emails) email;
 end if;
 insert into private.classroom_account_deletion_keys(user_id,registration_email_digests)
 values(p_target_id,p_registration_email_digests) on conflict(user_id) do update
 set registration_email_digests=array(select distinct digest from unnest(classroom_account_deletion_keys.registration_email_digests||excluded.registration_email_digests) digest);
 update public.classroom_accounts set status='suspended',updated_at=clock_timestamp() where id=p_target_id and status<>'suspended';
 if to_regclass('storage.objects') is not null then
  execute 'select coalesce(jsonb_agg(jsonb_build_object(''bucket_id'',o.bucket_id,''name'',o.name) order by o.bucket_id,o.name),''[]''::jsonb)
   from storage.objects o where to_jsonb(o)->>''owner''=$1 or to_jsonb(o)->>''owner_id''=$1
    or (o.bucket_id=''exam-documents'' and left(o.name,length($1)+1)=$1||''/'')' into storage_paths using p_target_id::text;
 end if;
 return jsonb_build_object('exists',true,'emails',to_jsonb(emails),'storage',storage_paths);
end $$;
revoke all on function private.classroom_account_delete_prepare(uuid,uuid,text,text[]) from public,anon,authenticated,service_role;
create function public.classroom_account_delete_prepare(
 p_actor_id uuid,p_target_id uuid,p_confirmation_email text,p_registration_email_digests text[] default '{}'
) returns jsonb language sql security invoker set search_path='' as $$
 select private.classroom_account_delete_prepare(p_actor_id,p_target_id,p_confirmation_email,p_registration_email_digests)
$$;
revoke all on function public.classroom_account_delete_prepare(uuid,uuid,text,text[]) from public,anon,authenticated,service_role;
grant execute on function private.classroom_account_delete_prepare(uuid,uuid,text,text[]),public.classroom_account_delete_prepare(uuid,uuid,text,text[]) to service_role;

create function private.classroom_account_deleting_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.classroom_account_deletion_keys where user_id=old.id) and new.status<>'suspended' then raise exception 'ACCOUNT_DELETION_IN_PROGRESS';end if;
 return new;
end $$;
revoke all on function private.classroom_account_deleting_guard() from public,anon,authenticated,service_role;
create trigger classroom_account_deleting before update on public.classroom_accounts
for each row execute function private.classroom_account_deleting_guard();

create function private.classroom_account_delete_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
declare identifiers text[]:=array[old.id::text]; invite_tokens text[]:='{}'; emails text[]; found_ids text[];
 entity record; remaining boolean; oauth_states uuid[]:='{}'; affected uuid[];
begin
 if exists(select 1 from private.classroom_account_deletion_keys where user_id=old.id) and (
  exists(select 1 from public.owner_allowlist where user_id=old.id)
  or exists(select 1 from public.classroom_accounts where id=old.id and role='admin')) then raise exception 'ACCESS_DENIED';end if;
 -- Auth DELETE already owns the parent row lock. Taking the study advisory
 -- lock here could deadlock an in-flight command waiting on an Auth FK insert.
 -- Never delete Storage metadata in SQL. Refuse closure until the Storage API
 -- removed bytes, owned objects, and any pending multipart uploads.
 if to_regclass('storage.objects') is not null then
  execute 'select exists(select 1 from storage.objects o where to_jsonb(o)->>''owner''=$1 or to_jsonb(o)->>''owner_id''=$1
   or (o.bucket_id=''exam-documents'' and left(o.name,length($1)+1)=$1||''/''))' into remaining using old.id::text;
  if remaining then raise exception 'STORAGE_CLEANUP_REQUIRED';end if;
 end if;
 if to_regclass('storage.s3_multipart_uploads') is not null then
  execute 'select exists(select 1 from storage.s3_multipart_uploads o where to_jsonb(o)->>''owner_id''=$1
   or (to_jsonb(o)->>''bucket_id''=''exam-documents'' and left(to_jsonb(o)->>''key'',length($1)+1)=$1||''/''))' into remaining using old.id::text;
  if remaining then raise exception 'STORAGE_CLEANUP_REQUIRED';end if;
 end if;
 if to_regclass('storage.s3_multipart_uploads_parts') is not null then
  execute 'select exists(select 1 from storage.s3_multipart_uploads_parts o where to_jsonb(o)->>''owner_id''=$1
   or (to_jsonb(o)->>''bucket_id''=''exam-documents'' and left(to_jsonb(o)->>''key'',length($1)+1)=$1||''/''))' into remaining using old.id::text;
  if remaining then raise exception 'STORAGE_CLEANUP_REQUIRED';end if;
 end if;
 select array_agg(distinct lower(btrim(email))) into emails from (
  select to_jsonb(old)->>'email' email union all select to_jsonb(old)->>'email_change'
  union all select a.email from public.classroom_accounts a where a.id=old.id
  union all select a.email from public.classroom_applications a where a.user_id=old.id
 ) known where nullif(btrim(email),'') is not null;
 if to_regclass('auth.identities') is not null then
  execute 'select coalesce(array_agg(distinct lower(btrim(email))),''{}''::text[]) from (
   select coalesce(to_jsonb(i)->>''email'',to_jsonb(i)->''identity_data''->>''email'') email from auth.identities i where user_id=$1
  ) known where nullif(btrim(email),'''') is not null' into found_ids using old.id;
  select array_agg(distinct email) into emails from unnest(coalesce(emails,'{}')||found_ids) email;
 end if;
 identifiers:=identifiers||coalesce(emails,'{}');
 -- Capture every owned entity ID before cascades remove its association.
 for entity in select n.nspname schema_name,c.relname table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='r'
   and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='user_id' and a.atttypid='uuid'::regtype and not a.attisdropped)
   and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='id' and a.atttypid='uuid'::regtype and not a.attisdropped)
 loop
  execute format('select coalesce(array_agg(id::text),''{}''::text[]) from %I.%I where user_id=$1',entity.schema_name,entity.table_name) into found_ids using old.id;
  identifiers:=identifiers||found_ids;
 end loop;
 select coalesce(array_agg(token),'{}'),coalesce(array_agg(id::text),'{}') into invite_tokens,found_ids from public.classroom_invites where teacher_id=old.id;
 identifiers:=identifiers||invite_tokens||found_ids;
 select coalesce(array_agg(id::text),'{}') into found_ids from private.friend_groups where owner_id=old.id;
 identifiers:=identifiers||found_ids;
 select coalesce(array_agg(id::text),'{}') into found_ids from private.friend_invites where inviter_id=old.id or accepted_by=old.id;
 identifiers:=identifiers||found_ids;
 with recursive related as (
  select id from public.classroom_messages where old.id in (teacher_id,student_id,sender_id)
  union select m.id from public.classroom_messages m join related r on m.parent_id=r.id
 ) select coalesce(array_agg(id::text),'{}') into found_ids from related;
 identifiers:=identifiers||found_ids;
 with recursive related as (
  select id from public.classroom_alerts where old.id in (teacher_id,student_id)
  union select a.id from public.classroom_alerts a join related r on a.parent_id=r.id
 ) select coalesce(array_agg(id::text),'{}') into found_ids from related;
 identifiers:=identifiers||found_ids;
 select coalesce(array_agg(id::text),'{}') into found_ids from public.classroom_feedback
 where old.id in (teacher_id,student_id) or alert_id::text=any(identifiers);
 identifiers:=identifiers||found_ids;
 delete from public.classroom_receipts where user_id=old.id
  or private.classroom_delete_json_matches(payload,identifiers) or private.classroom_delete_json_matches(result,identifiers);
 delete from public.command_receipts where user_id=old.id
  or private.classroom_delete_json_matches(payload,identifiers) or private.classroom_delete_json_matches(result,identifiers);
 delete from public.audit_log where user_id=old.id or entity_id::text=any(identifiers)
  or private.classroom_delete_json_matches(old_value,identifiers) or private.classroom_delete_json_matches(new_value,identifiers);
 delete from private.classroom_registration_attempts where key in (
  select 'email:'||digest from private.classroom_account_deletion_keys k cross join lateral unnest(k.registration_email_digests) digest where k.user_id=old.id
 );
 if cardinality(invite_tokens)>0 and exists(select 1 from pg_attribute where attrelid='auth.users'::regclass and attname='raw_user_meta_data' and not attisdropped) then
  execute 'update auth.users set raw_user_meta_data=raw_user_meta_data-''invite_token'' where id<>$1 and raw_user_meta_data->>''invite_token''=any($2)' using old.id,invite_tokens;
 end if;
 -- Supabase-managed schema varies by Auth version. Leave its constraints alone;
 -- explicitly erase identifiers without an Auth-user CASCADE (verified on live).
 if to_regclass('auth.audit_log_entries') is not null then
  execute 'delete from auth.audit_log_entries where private.classroom_delete_json_matches(payload::jsonb,$1)' using identifiers;
 end if;
 if to_regclass('auth.refresh_tokens') is not null then
  execute 'delete from auth.refresh_tokens where user_id::text=$1' using old.id::text;
 end if;
 if to_regclass('auth.scim_users') is not null then
  execute 'delete from auth.scim_users where user_id=$1 or lower(btrim(user_name))=any($2)' using old.id,coalesce(emails,'{}');
 end if;
 if to_regclass('auth.saml_relay_states') is not null then
  execute 'delete from auth.saml_relay_states where lower(btrim(for_email))=any($1)' using coalesce(emails,'{}');
 end if;
 if to_regclass('auth.flow_state') is not null then
  execute 'select coalesce(array_agg(oauth_client_state_id),''{}''::uuid[]) from auth.flow_state where user_id=$1 or linking_target_id=$1' into oauth_states using old.id;
  execute 'delete from auth.flow_state where user_id=$1 or linking_target_id=$1' using old.id;
  if to_regclass('auth.oauth_client_states') is not null then
   execute 'delete from auth.oauth_client_states s where s.id=any($1) and not exists(select 1 from auth.flow_state f where f.oauth_client_state_id=s.id)' using oauth_states;
  end if;
 end if;
 if to_regclass('public.demo_sessions') is not null then execute 'delete from public.demo_sessions where user_id=$1' using old.id;end if;
 select coalesce(array_agg(distinct id),'{}') into affected from public.classroom_accounts
 where id<>old.id and ((role='admin' and status='approved') or teacher_id=old.id
  or id=(select teacher_id from public.classroom_accounts where id=old.id));
 -- Clear surviving relationships while the Auth parent still exists. Their
 -- invalidation triggers must not enqueue an event for an already-gone parent.
 update public.classroom_accounts set teacher_id=null,updated_at=clock_timestamp() where teacher_id=old.id;
 update public.classroom_applications set
  teacher_id=case when teacher_id=old.id then null else teacher_id end,
  reviewed_by=case when reviewed_by=old.id then null else reviewed_by end
 where teacher_id=old.id or reviewed_by=old.id;
 insert into public.classroom_events(user_id) select unnest(affected);
 return old;
end $$;
revoke all on function private.classroom_account_delete_cleanup() from public,anon,authenticated,service_role;
create trigger classroom_account_delete_cleanup before delete on auth.users
for each row execute function private.classroom_account_delete_cleanup();
