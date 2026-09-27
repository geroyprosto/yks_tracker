-- A running study timer remains active after its browser tab closes. Presence
-- only describes a live device lease; visibility is not required for that lease.
create or replace function private.classroom_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts:=private.classroom_identity(); result jsonb; student record; begin
 result:=jsonb_build_object('account',case when actor.id is null then null else to_jsonb(actor) end,'server_now',clock_timestamp(),
 'accounts','[]'::jsonb,'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.classroom_applications a
  where a.user_id=auth.uid() or (actor.role='admin' and actor.status='approved')
   or (actor.role='teacher' and actor.status='approved' and a.requested_role='student' and a.teacher_id=actor.id)),'[]'),
 'invites','[]'::jsonb,'messages','[]'::jsonb,'alerts','[]'::jsonb,'feedback','[]'::jsonb,'students','[]'::jsonb);
 if actor.id is null or actor.status<>'approved' then return result; end if;
 if actor.role='student' then perform private.classroom_tick(actor.id);
 elsif actor.role='teacher' then
  for student in select id from public.classroom_accounts where teacher_id=actor.id and role='student' and status='approved' loop
   perform private.settle_countdown(student.id,clock_timestamp()); perform private.classroom_tick(student.id);
  end loop;
 end if;
 return result||jsonb_build_object(
 'accounts',case when actor.role='admin' then coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.classroom_accounts a),'[]') else '[]'::jsonb end,
 'invites',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.classroom_invites i where actor.role='teacher' and i.teacher_id=actor.id),'[]'),
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from public.classroom_messages m where
  (actor.role='student' and m.student_id=actor.id and private.classroom_student_scope(m.teacher_id,actor.id)) or (actor.role='teacher' and m.teacher_id=actor.id and private.classroom_student_scope(actor.id,m.student_id))),'[]'),
 'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.classroom_alerts a where
  (actor.role='student' and a.student_id=actor.id and (a.status not in ('pending','declined') or private.classroom_student_scope(a.teacher_id,actor.id))) or (actor.role='teacher' and a.teacher_id=actor.id and private.classroom_student_scope(actor.id,a.student_id))),'[]'),
 'feedback',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.classroom_feedback f where
  (actor.role='student' and f.student_id=actor.id) or (actor.role='teacher' and f.teacher_id=actor.id and private.classroom_student_scope(actor.id,f.student_id))),'[]'),
 'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'teacher_id',s.teacher_id,'state',private.classroom_statistics(s.id),
 'presence',jsonb_build_object('online',coalesce(p.online,false),'last_seen',p.last_seen,'session_id',active.id,
 'status',case when active.status='running' then 'working' when not coalesce(p.online,false) then 'offline' when active.status='paused' then 'break' else 'online' end)) order by s.name)
 from public.classroom_accounts s
 left join lateral(select bool_or(expires_at>clock_timestamp()) as online,max(last_seen) as last_seen from public.classroom_presence where user_id=s.id) p on true
 left join lateral(select id,status from public.study_sessions where user_id=s.id and status in ('running','paused') limit 1) active on true
 where actor.role='teacher' and s.teacher_id=actor.id and s.status='approved' and s.role='student'),'[]'));
end $$;
