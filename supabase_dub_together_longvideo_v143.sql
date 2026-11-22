-- Dub Together v143: enable 49 MB resumable uploads and 30-minute scripts.
-- Run once in the Supabase SQL Editor after the existing Dub Together setup/migrations.
-- Supabase Free has a 50 MB per-object ceiling; this bucket limit intentionally stays below it.

update storage.buckets
set file_size_limit = 49000000
where id = 'dub-media';

create or replace function public.create_dub_room(
  p_code text,
  p_name text,
  p_mode text,
  p_is_public boolean,
  p_clip jsonb,
  p_script jsonb
)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_mode text := coalesce(p_mode, 'parallel');
  v_name text := left(regexp_replace(coalesce(p_name, 'Spieler'), '[[:cntrl:]]', '', 'g'), 20);
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  if v_code !~ '^[A-Z0-9]{6}$' then raise exception 'Ungültiger sechsstelliger Raumcode'; end if;
  if v_mode not in ('parallel','character','scenario') then raise exception 'Ungültiger Spielmodus'; end if;
  if jsonb_typeof(coalesce(p_script, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Das Skript muss als Liste mit 1 bis 120 Zeilen übergeben werden';
  end if;
  if jsonb_array_length(coalesce(p_script, '[]'::jsonb)) < 1
     or jsonb_array_length(coalesce(p_script, '[]'::jsonb)) > 120 then
    raise exception 'Das Skript muss 1 bis 120 Zeilen enthalten';
  end if;

  insert into public.dub_together_rooms (
    code, host_id, mode, is_public, clip, script, players
  ) values (
    v_code, auth.uid(), v_mode, coalesce(p_is_public, false),
    coalesce(p_clip, '{}'::jsonb), p_script,
    jsonb_build_array(jsonb_build_object('id', auth.uid()::text, 'name', coalesce(nullif(trim(v_name), ''), 'Spieler')))
  );
  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;


create or replace function public.set_dub_clip(p_code text, p_clip jsonb, p_script jsonb)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_clip jsonb := coalesce(p_clip, '{}'::jsonb);
  v_script jsonb := coalesce(p_script, '[]'::jsonb);
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.host_id <> auth.uid() or v_room.status <> 'waiting' then raise exception 'Nur der Lobby-Host kann Clip und Skript vor der Runde ändern'; end if;
  if jsonb_typeof(v_script) is distinct from 'array' then
    raise exception 'Das Skript muss als Liste übergeben werden';
  end if;
  if jsonb_array_length(v_script) < 1 or jsonb_array_length(v_script) > 120 then
    raise exception 'Das Skript muss 1 bis 120 Dialogzeilen enthalten';
  end if;
  if jsonb_typeof(v_clip->'roles') is distinct from 'array' then
    raise exception 'Die Personen/Rollen müssen als Liste übergeben werden';
  end if;
  if jsonb_array_length(v_clip->'roles') < 1 or jsonb_array_length(v_clip->'roles') > 12 then
    raise exception 'Es müssen 1 bis 12 Personen/Rollen vorhanden sein';
  end if;
  if coalesce(v_clip->>'path','') <> '' and (
    split_part(v_clip->>'path','/',1) <> v_code
    or split_part(v_clip->>'path','/',2) <> 'clips'
    or split_part(v_clip->>'path','/',3) <> auth.uid()::text
    or coalesce(v_clip->>'rights_confirmed','false') <> 'true'
  ) then raise exception 'Clip-Pfad oder Rechtebestätigung ungültig'; end if;

  if exists (
    select 1 from jsonb_array_elements(v_script) as line(item)
    where length(coalesce(line.item->>'text','')) > 240
       or not exists (
         select 1 from jsonb_array_elements(v_clip->'roles') as role(item)
         where role.item->>'id' = line.item->>'role'
       )
  ) then raise exception 'Eine Dialogzeile ist zu lang oder einer ungültigen Rolle zugewiesen'; end if;

  update public.dub_together_rooms set clip=v_clip, script=v_script, updated_at=now() where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;


-- Preserve least-privilege execution for both RPCs.
revoke all on function public.create_dub_room(text,text,text,boolean,jsonb,jsonb) from public, anon;
revoke all on function public.set_dub_clip(text,jsonb,jsonb) from public, anon;
grant execute on function public.create_dub_room(text,text,text,boolean,jsonb,jsonb) to authenticated;
grant execute on function public.set_dub_clip(text,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';

select id, name, file_size_limit,
       round(file_size_limit / 1000000.0, 1) as max_size_mb
from storage.buckets
where id = 'dub-media';
