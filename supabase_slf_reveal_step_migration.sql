-- Stadt, Land, Fluss: shared step-by-step reveal migration (v25 -> v26)
-- Run once in Supabase SQL Editor after the previous online-game setup.

alter table public.online_slf_rooms add column if not exists reveal_step integer not null default 0;

create or replace function public.get_slf_room(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_player_count integer;
  v_submission_count integer;
  v_players jsonb;
  v_submissions jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um den Spielraum zu öffnen.'; end if;
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum wurde nicht gefunden.'; end if;
  if not exists(select 1 from public.online_slf_players p where p.room_code = v_room.code and p.player_id = v_uid) then
    raise exception 'Du bist diesem Raum nicht beigetreten.';
  end if;
  select count(*) into v_player_count from public.online_slf_players p where p.room_code = v_room.code;
  select count(*) into v_submission_count from public.online_slf_submissions s where s.room_code = v_room.code;
  if v_room.status = 'playing' and ((v_room.deadline_at is not null and v_room.deadline_at <= now()) or (v_player_count > 0 and v_submission_count >= v_player_count)) then
    update public.online_slf_rooms r set status = 'reveal', reveal_step = 0, updated_at = now() where r.code = v_room.code returning r.* into v_room;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.player_id,'name',p.display_name,'joined_at',p.joined_at) order by p.joined_at), '[]'::jsonb)
    into v_players from public.online_slf_players p where p.room_code = v_room.code;
  if v_room.status = 'reveal' then
    select coalesce(jsonb_object_agg(s.player_id::text,jsonb_build_object('answers',s.answers,'submitted_at',s.submitted_at)), '{}'::jsonb)
      into v_submissions from public.online_slf_submissions s where s.room_code = v_room.code;
  end if;
  v_result := jsonb_build_object(
    'code',v_room.code,'host_id',v_room.host_id,'status',v_room.status,'categories',v_room.categories,
    'duration_seconds',v_room.duration_seconds,'letter',v_room.letter,'deadline_at',v_room.deadline_at,
    'round_number',v_room.round_number,'reveal_step',v_room.reveal_step,'created_at',v_room.created_at,'updated_at',v_room.updated_at,
    'players',v_players,
    'my_submitted',exists(select 1 from public.online_slf_submissions s where s.room_code = v_room.code and s.player_id = v_uid),
    'submissions',v_submissions
  );
  return v_result;
end;
$$;

create or replace function public.advance_slf_reveal(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_player_count integer;
  v_max_step integer;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um das Reveal fortzusetzen.'; end if;
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum wurde nicht gefunden.'; end if;
  if not exists(select 1 from public.online_slf_players p where p.room_code=v_room.code and p.player_id=v_uid) then
    raise exception 'Du gehörst nicht zu dieser Lobby.';
  end if;
  if v_room.status <> 'reveal' then raise exception 'Das Reveal ist noch nicht gestartet.'; end if;
  select count(*) into v_player_count from public.online_slf_players p where p.room_code=v_room.code;
  v_max_step := jsonb_array_length(v_room.categories) * v_player_count;
  update public.online_slf_rooms r set reveal_step=least(r.reveal_step+1,v_max_step),updated_at=now() where r.code=v_room.code;
  return public.get_slf_room(v_room.code);
end;
$$;

create or replace function public.next_slf_round(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_letter text;
begin
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum existiert nicht mehr.'; end if;
  if v_uid is null or v_room.host_id <> v_uid then raise exception 'Nur der Gastgeber kann die nächste Runde starten.'; end if;
  if v_room.status <> 'reveal' then raise exception 'Die aktuelle Runde ist noch nicht aufgedeckt.'; end if;
  v_letter := substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ',floor(random()*26)::integer+1,1);
  update public.online_slf_rooms r set status='playing',letter=v_letter,round_number=v_room.round_number+1,reveal_step=0,
    deadline_at=now()+(v_room.duration_seconds || ' seconds')::interval,updated_at=now()
    where r.code=v_room.code;
  delete from public.online_slf_submissions s where s.room_code=v_room.code;
  return public.get_slf_room(v_room.code);
end;
$$;

revoke all on function public.get_slf_room(text) from public, anon;
revoke all on function public.advance_slf_reveal(text) from public, anon;
revoke all on function public.next_slf_round(text) from public, anon;
grant execute on function public.get_slf_room(text) to authenticated;
grant execute on function public.advance_slf_reveal(text) to authenticated;
grant execute on function public.next_slf_round(text) to authenticated;
notify pgrst, 'reload schema';
