"""Render the researched starter topic catalogue as an idempotent SQL migration."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATALOG = json.loads((ROOT / "ogm-topic-headings.json").read_text(encoding="utf-8"))
EXCLUDED = {"Tarih", "Felsefe", "Din Kültürü"}


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


seen: set[tuple[str, str, str]] = set()
rows: list[tuple[str, str, str, str]] = []
for group in CATALOG:
    exam, subject = group["exam"], group["subject"]
    assert exam in {"TYT", "AYT"}
    assert not (exam == "TYT" and subject in EXCLUDED)
    for name in group["topics"]:
        key = (exam, subject, name)
        assert key not in seen, key
        seen.add(key)
        url = group.get("topicSources", {}).get(name, group["sourceUrl"])
        assert url.startswith("https://ogmmateryal.eba.gov.tr/")
        rows.append((*key, "MEB OGM: " + url + " · 2027 kapsamı kesinleşmiş sayılmaz."))

values = ",\n    ".join("(" + ", ".join(map(quote, row)) + ")" for row in rows)
sql = """-- MEB OGM study headings; this editable catalogue is not an announced 2027 exam scope.
-- The generated source is supabase/catalog/ogm-topic-headings.json.
create or replace function private.starter_topics()
returns table(exam text, subject text, name text, source text)
language sql stable set search_path = '' as $$
  select c.exam, c.subject, c.name, c.source
  from (values
    """ + values + """
  ) as c(exam, subject, name, source);
$$;
revoke all on function private.starter_topics() from public, anon, authenticated;

create or replace function private.initialize_owner(owner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare is_new boolean; profile public.profiles; local_day date;
begin
  insert into public.profiles(user_id) values(owner_id) on conflict do nothing;
  is_new := found;
  if is_new then
    insert into public.topics(user_id, exam, subject, name, source)
    select owner_id, c.exam, c.subject, c.name, c.source from private.starter_topics() c
    on conflict (user_id, exam, subject, name) do nothing;
  end if;
  select * into profile from public.profiles where user_id = owner_id;
  local_day := (clock_timestamp() at time zone profile.timezone)::date;
  if not exists(select 1 from public.daily_plan_versions where user_id = owner_id and plan_date = local_day) then
    perform private.snapshot_day(owner_id, local_day);
  end if;
end $$;

-- Remove only untouched starter entries with no dependent record. Personal notes,
-- mastery, tasks, sessions, history and child topics retain their original IDs.
delete from public.topics t
where t.source = 'Düzenlenebilir başlangıç listesi; 2027 kapsamı olarak doğrulanmadı.'
  and t.mastery = 0 and t.notes = '' and t.next_step = ''
  and t.review_requested = false and t.parent_id is null
  and not exists(select 1 from public.tasks x where x.topic_id = t.id)
  and not exists(select 1 from public.study_sessions x where x.topic_id = t.id)
  and not exists(select 1 from public.topic_history x where x.topic_id = t.id)
  and not exists(select 1 from public.topics x where x.parent_id = t.id)
  and (
    (t.exam = 'TYT' and t.subject in ('Tarih', 'Felsefe', 'Din Kültürü'))
    or (
      exists(select 1 from private.starter_topics() c where c.exam = t.exam and c.subject = t.subject)
      and not exists(select 1 from private.starter_topics() c
        where c.exam = t.exam and c.subject = t.subject and c.name = t.name)
    )
  );

insert into public.topics(user_id, exam, subject, name, source)
select p.user_id, c.exam, c.subject, c.name, c.source
from public.profiles p cross join private.starter_topics() c
on conflict (user_id, exam, subject, name) do nothing;
"""

(ROOT / "topic-catalog.pending.sql").write_text(sql, encoding="utf-8")
print(f"Rendered {len(rows)} main headings in {len(CATALOG)} subject groups.")
