-- The tenth refusal starts a finite, durable lock. The student's command RPC
-- already records its start in closed_at; guard the table transition so a
-- refreshed tab or another device cannot dismiss it early.
create function private.classroom_guard_order_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
 if old.status = 'declined' and new.status = 'dismissed'
  and (old.closed_at is null or clock_timestamp() < old.closed_at + interval '5 minutes') then
  raise exception 'ALERT_LOCKED';
 end if;
 return new;
end $$;

create trigger classroom_guard_order_lock before update of status on public.classroom_alerts
for each row execute function private.classroom_guard_order_lock();

revoke all on function private.classroom_guard_order_lock() from public, anon, authenticated, service_role;

-- Keep the existing server-time and real-interval checks, changing only the
-- wording of the automatic reminder. Cron and state catch-up call this function.
create or replace function private.classroom_tick(target uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare a public.classroom_alerts; started timestamptz; count_created integer:=0; begin
 for a in select x.* from public.classroom_alerts x where x.kind='initial' and x.status='accepted'
  and x.started_at is null and (target is null or x.student_id=target)
  order by x.id for update skip locked loop
  if not private.classroom_student_scope(a.teacher_id,a.student_id) then
   update public.classroom_alerts set status='cancelled',closed_at=clock_timestamp() where id=a.id;
   update public.classroom_alerts set status='cancelled',closed_at=clock_timestamp() where parent_id=a.id and status='pending';
   continue;
  end if;
  select min(i.started_at) into started from public.study_intervals i
  where i.user_id=a.student_id and i.classroom_recorded_at>=a.accepted_at
   and i.started_at>=date_trunc('second',a.accepted_at) and i.started_at<=clock_timestamp();
  if started is not null then
   update public.classroom_alerts set started_at=started where id=a.id;
   perform private.classroom_feedback_for(a,'started','Öğrenci çalışmaya başladı');
   update public.classroom_alerts set status='cancelled',closed_at=clock_timestamp() where parent_id=a.id and status='pending';
  elsif a.followup_due_at<=clock_timestamp() then
   insert into public.classroom_alerts(teacher_id,student_id,kind,parent_id,body)
   values(a.teacher_id,a.student_id,'followup',a.id,'E hani başlıyordun?') on conflict(parent_id) do nothing;
   if found then count_created:=count_created+1; end if;
  end if;
 end loop;
 return count_created;
end $$;

update public.classroom_alerts set body = 'E hani başlıyordun?'
where kind = 'followup' and status = 'pending' and body = 'E hani çalışacaktın, bahanen ne???';
