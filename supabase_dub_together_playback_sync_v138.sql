-- Dub Together v138: host-triggered, shared video playback start.
-- Run once in the Supabase SQL Editor for the Kamar303 project.
-- Only an authenticated member who is the room host may publish a play command.

create or replace function public.set_dub_playback_sync(
  p_code text,
  p_command jsonb
)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_action text := coalesce(p_command->>'action', '');
  v_command_id text := left(coalesce(nullif(p_command->>'id', ''), gen_random_uuid()::text), 80);
  v_position double precision;
  v_start_at timestamptz;
  v_sync jsonb;
begin
  select * into v_room
  from public.dub_together_rooms
  where code = v_code
  for update;

  if not found then
    raise exception 'Lobby nicht gefunden';
  end if;
  if not public.dub_room_member(v_code) then
    raise exception 'Du bist nicht Mitglied dieser Lobby';
  end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'Nur der Host darf den gemeinsamen Videostart auslösen';
  end if;
  if v_action <> 'play' then
    raise exception 'Ungültiger Wiedergabebefehl';
  end if;

  begin
    v_position := greatest(0, least(3600, coalesce((p_command->>'position')::double precision, 0)));
    v_start_at := (p_command->>'start_at')::timestamptz;
  exception when others then
    raise exception 'Ungültige Startposition oder Startzeit';
  end;

  if v_start_at < now() - interval '1 second'
     or v_start_at > now() + interval '15 seconds' then
    raise exception 'Der gemeinsame Startzeitpunkt muss innerhalb der nächsten 15 Sekunden liegen';
  end if;

  v_sync := jsonb_build_object(
    'id', v_command_id,
    'action', 'play',
    'position', v_position,
    'start_at', v_start_at,
    'sender_id', auth.uid()::text,
    'created_at', now()
  );

  update public.dub_together_rooms
  set clip = jsonb_set(coalesce(clip, '{}'::jsonb), '{playback_sync}', v_sync, true),
      updated_at = now()
  where code = v_code;

  return query
  select * from public.dub_together_rooms where code = v_code;
end;
$$;

revoke all on function public.set_dub_playback_sync(text, jsonb) from public, anon;
grant execute on function public.set_dub_playback_sync(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
