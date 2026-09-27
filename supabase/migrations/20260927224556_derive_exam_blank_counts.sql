-- Count-mode results may omit blank; derive it from the format snapshot so
-- stored counts always account for the questions in that section.
create or replace function private.exam_normalize_results(input_results jsonb,format_snapshot jsonb)
 returns jsonb language plpgsql set search_path='' as $$
declare
 item jsonb;
 section_spec jsonb;
 section_key text;
 capacity integer;
 divisor numeric;
 right_count numeric;
 wrong_count numeric;
 empty_count numeric;
 net_value numeric;
 output_results jsonb := '[]'::jsonb;
 seen_keys text[] := array[]::text[];
begin
 if jsonb_typeof(input_results) is distinct from 'array'
    or jsonb_array_length(input_results) not between 0 and 50 then
  raise exception 'INVALID_INPUT';
 end if;
 divisor := (format_snapshot->>'wrong_divisor')::numeric;
 for item in select value from jsonb_array_elements(input_results) as data(value) loop
  if jsonb_typeof(item) is distinct from 'object'
     or jsonb_typeof(item->'section_key') is distinct from 'string'
     or length(item->>'section_key') not between 1 and 80 then
   raise exception 'INVALID_INPUT';
  end if;
  section_key := item->>'section_key';
  if section_key=any(seen_keys) then raise exception 'INVALID_INPUT'; end if;
  seen_keys := array_append(seen_keys,section_key);
  select value into section_spec from jsonb_array_elements(format_snapshot->'sections') as s(value)
   where value->>'key'=section_key;
  if section_spec is null then raise exception 'INVALID_INPUT'; end if;
  capacity := (section_spec->>'question_count')::integer;
  if item ?& array['correct','wrong'] and not item ? 'net' then
   perform private.check_keys(item,array['section_key','correct','wrong','blank']);
   if jsonb_typeof(item->'correct') is distinct from 'number'
      or jsonb_typeof(item->'wrong') is distinct from 'number'
      or (item ? 'blank' and jsonb_typeof(item->'blank') is distinct from 'number') then
    raise exception 'INVALID_INPUT';
   end if;
   right_count := (item->>'correct')::numeric;
   wrong_count := (item->>'wrong')::numeric;
   empty_count := case when item ? 'blank'
    then (item->>'blank')::numeric
    else capacity-right_count-wrong_count end;
   if right_count<0 or wrong_count<0 or empty_count<0
      or right_count<>trunc(right_count) or wrong_count<>trunc(wrong_count)
      or empty_count<>trunc(empty_count)
      or right_count+wrong_count+empty_count>capacity then
    raise exception 'INVALID_INPUT';
   end if;
   net_value := right_count-wrong_count/divisor;
   output_results := output_results || jsonb_build_array(jsonb_build_object(
    'section_key',section_key,'correct',right_count::integer,
    'wrong',wrong_count::integer,'blank',empty_count::integer,'net',net_value));
  elsif item ? 'net' and not (item ?| array['correct','wrong','blank']) then
   perform private.check_keys(item,array['section_key','net']);
   if jsonb_typeof(item->'net') is distinct from 'number' then raise exception 'INVALID_INPUT'; end if;
   net_value := (item->>'net')::numeric;
   if net_value < -capacity/divisor or net_value>capacity then raise exception 'INVALID_INPUT'; end if;
   output_results := output_results || jsonb_build_array(jsonb_build_object(
    'section_key',section_key,'correct',null,'wrong',null,'blank',null,'net',net_value));
  else
   raise exception 'INVALID_INPUT';
  end if;
 end loop;
 return output_results;
end $$;
