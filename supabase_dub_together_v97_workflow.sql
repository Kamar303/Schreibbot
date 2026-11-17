-- Dub Together v97: server-side validation and same-lobby next-round support.
-- Run AFTER supabase_dub_together_setup.sql, v95_addons.sql and v96_audio_stems.sql.

begin;

create or replace function public.start_dub_round(p_code text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
begin
  select * into v_room
  from public.dub_together_rooms
  where code = v_code
  for update;

  if not found or v_room.host_id <> auth.uid() or v_room.status <> 'waiting' then
    raise exception 'Nur der Host kann die Runde starten';
  end if;
  if jsonb_array_length(coalesce(v_room.players, '[]'::jsonb)) < 2 then
    raise exception 'Mindestens zwei Spieler werden benötigt';
  end if;
  if coalesce(v_room.clip->>'path', '') = '' or coalesce(v_room.clip->>'rights_confirmed', 'false') <> 'true' then
    raise exception 'Bitte zuerst einen Clip hochladen und die Nutzungsrechte bestätigen';
  end if;
  if jsonb_array_length(coalesce(v_room.script, '[]'::jsonb)) < 1 then
    raise exception 'Das Skript ist leer';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_room.script, '[]'::jsonb)) as line(item)
    where length(trim(coalesce(line.item->>'text', ''))) = 0
  ) then
    raise exception 'Bitte füllt alle Dialogzeilen aus oder entfernt leere Zeilen';
  end if;

  if v_room.mode <> 'parallel' and exists (
    select 1
    from (
      select distinct line.item->>'role' as role_id
      from jsonb_array_elements(coalesce(v_room.script, '[]'::jsonb)) as line(item)
    ) as used_roles
    where coalesce(v_room.assignments->>used_roles.role_id, '') = ''
  ) then
    raise exception 'Vor dem Start muss jeder verwendeten Rolle ein Spieler zugewiesen sein';
  end if;

  update public.dub_together_rooms
  set status = 'recording', updated_at = now()
  where code = v_code;

  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;

create or replace function public.finish_dub_round(p_code text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
begin
  select * into v_room
  from public.dub_together_rooms
  where code = v_code
  for update;

  if not found or v_room.host_id <> auth.uid() or v_room.status <> 'recording' or v_room.mode = 'parallel' then
    raise exception 'Nur der Host kann diese gemeinsame Fassung beenden';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_room.script, '[]'::jsonb)) as line(item)
    where coalesce(v_room.assignments->>(line.item->>'role'), '') = ''
  ) then
    raise exception 'Noch nicht alle verwendeten Rollen sind einem Spieler zugewiesen';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_room.script, '[]'::jsonb)) as line(item)
    where coalesce(v_room.recordings->('character:' || (line.item->>'id'))->>'path', '') = ''
  ) then
    raise exception 'Es fehlen noch Aufnahmen. Jede Dialogzeile muss eingesprochen sein';
  end if;

  update public.dub_together_rooms
  set status = 'reveal', updated_at = now()
  where code = v_code;

  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;

create or replace function public.start_next_dub_round(p_code text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
begin
  select * into v_room
  from public.dub_together_rooms
  where code = v_code
  for update;

  if not found or v_room.host_id <> auth.uid() or v_room.status not in ('reveal', 'finished') then
    raise exception 'Nur der Host kann nach einer fertigen Runde eine neue Runde starten';
  end if;

  update public.dub_together_rooms
  set status = 'waiting',
      assignments = '{}'::jsonb,
      recordings = '{}'::jsonb,
      submissions = '{}'::jsonb,
      votes = '{}'::jsonb,
      twitch_votes = '{}'::jsonb,
      clip = jsonb_set(coalesce(clip, '{}'::jsonb), '{workflow_step}', '"clip"'::jsonb, true),
      updated_at = now()
  where code = v_code;

  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;

revoke all on function public.start_dub_round(text) from public, anon;
revoke all on function public.finish_dub_round(text) from public, anon;
revoke all on function public.start_next_dub_round(text) from public, anon;
grant execute on function public.start_dub_round(text) to authenticated;
grant execute on function public.finish_dub_round(text) to authenticated;
grant execute on function public.start_next_dub_round(text) to authenticated;

commit;

notify pgrst, 'reload schema';
