-- Administrator notifications are durable and never contain passwords or action tokens.
create table private.classroom_email_outbox (
 application_id uuid primary key references public.classroom_applications(id),
 created_at timestamptz not null default now(), claimed_at timestamptz, sent_at timestamptz,
 attempts integer not null default 0, last_error text
);
alter table private.classroom_email_outbox enable row level security;
revoke all on private.classroom_email_outbox from public,anon,authenticated,service_role;
create function private.classroom_queue_email() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into private.classroom_email_outbox(application_id) values(new.id) on conflict do nothing;return new;end $$;
revoke all on function private.classroom_queue_email() from public,anon,authenticated,service_role;
create trigger classroom_application_email after insert on public.classroom_applications for each row execute function private.classroom_queue_email();
create function public.classroom_email_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 with pending as (
  select application_id from private.classroom_email_outbox
  where sent_at is null and attempts<10 and (claimed_at is null or claimed_at<now()-interval '5 minutes')
  order by created_at for update skip locked limit 10
 ), claimed as (
  update private.classroom_email_outbox o set claimed_at=now(),attempts=attempts+1
  from pending p where o.application_id=p.application_id returning o.application_id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'email',a.email,'requested_role',a.requested_role,'teacher_name',t.name)),'[]') into result
 from claimed c join public.classroom_applications a on a.id=c.application_id left join public.classroom_accounts t on t.id=a.teacher_id;
 return result;
end $$;
create function public.classroom_email_ack(application_id uuid,delivered boolean) returns void language plpgsql security definer set search_path='' as $$
begin update private.classroom_email_outbox o set sent_at=case when delivered then now() else sent_at end,last_error=case when delivered then null else 'MAIL_DELIVERY_FAILED' end where o.application_id=classroom_email_ack.application_id;end $$;
revoke all on function public.classroom_email_claim(),public.classroom_email_ack(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.classroom_email_claim(),public.classroom_email_ack(uuid,boolean) to service_role;
