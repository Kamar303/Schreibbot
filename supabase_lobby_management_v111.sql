-- Schreibbot v111: public lobby closing + 30-minute inactivity cleanup + SLF visibility status.
-- Run once in the Supabase SQL Editor of the SAME project as Schreibbot.
-- Prerequisites: supabase_online_tictactoe_setup.sql, supabase_public_lobbies_v70.sql,
-- and supabase_dub_together_setup.sql have already been installed.

-- Add an owner flag to the public lobby listings so the creator can close their own room.
drop function if exists public.list_public_tictactoe_rooms();
create function public.list_public_tictactoe_rooms()
returns table(code text, player_count integer, created_at timestamptz, is_owner boolean)
language sql
security definer
set search_path = public, pg_temp
as $$
  select r.code,
         (case when r.player_o is null then 1 else 2 end)::integer,
         r.created_at,
         (r.player_x = auth.uid()) as is_owner
    from public.online_tictactoe_rooms r
   where auth.uid() is not null
     and r.is_public = true
     and r.status = 'waiting'
     and r.player_o is null
     and r.updated_at > now() - interval '30 minutes'
   order by r.created_at desc
   limit 40;
$$;

 drop function if exists public.list_public_slf_rooms();
create function public.list_public_slf_rooms()
returns table(
  code text,
  host_name text,
  player_count integer,
  categories jsonb,
  duration_seconds integer,
  created_at timestamptz,
  is_owner boolean
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select r.code,
         coalesce(h.display_name, 'Spieler') as host_name,
         count(p.player_id)::integer as player_count,
         r.categories,
         r.duration_seconds,
         r.created_at,
         (r.host_id = auth.uid()) as is_owner
    from public.online_slf_rooms r
    join public.online_slf_players p on p.room_code = r.code
    left join public.online_slf_players h
      on h.room_code = r.code and h.player_id = r.host_id
   where auth.uid() is not null
     and r.is_public = true
     and r.status = 'waiting'
     and r.updated_at > now() - interval '30 minutes'
   group by r.code, h.display_name, r.categories, r.duration_seconds, r.created_at, r.host_id
  having count(p.player_id) < 8
   order by r.created_at desc
   limit 40;
$$;

drop function if exists public.list_public_dub_rooms();
create function public.list_public_dub_rooms()
returns table(code text, mode text, mode_label text, player_count integer, created_at timestamptz, is_owner boolean)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.code,
         r.mode,
         case r.mode when 'parallel' then 'Parallel' when 'character' then 'Charakter' else 'Szenario' end,
         jsonb_array_length(coalesce(r.players, '[]'::jsonb))::integer,
         r.created_at,
         (r.host_id = auth.uid()) as is_owner
    from public.dub_together_rooms r
   where auth.uid() is not null
     and r.is_public = true
     and r.status = 'waiting'
     and r.updated_at > now() - interval '30 minutes'
   order by r.created_at desc
   limit 40;
$$;

-- Only the authenticated creator can close their own public lobby.
create or replace function public.close_public_tictactoe_room(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_deleted integer;
begin
  if auth.uid() is null then raise exception 'Bitte erneut anmelden.'; end if;
  delete from public.online_tictactoe_rooms
   where code = upper(trim(coalesce(p_code, '')))
     and is_public = true and player_x = auth.uid();
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then raise exception 'Diese öffentliche Lobby gehört dir nicht mehr oder existiert nicht.'; end if;
  return true;
end;
$$;

create or replace function public.close_public_slf_room(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_deleted integer;
begin
  if auth.uid() is null then raise exception 'Bitte erneut anmelden.'; end if;
  delete from public.online_slf_rooms
   where code = upper(trim(coalesce(p_code, '')))
     and is_public = true and host_id = auth.uid();
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then raise exception 'Diese öffentliche Lobby gehört dir nicht mehr oder existiert nicht.'; end if;
  return true;
end;
$$;

create or replace function public.close_public_dub_room(p_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_deleted integer;
begin
  if auth.uid() is null then raise exception 'Bitte erneut anmelden.'; end if;
  delete from public.dub_together_rooms
   where code = upper(trim(coalesce(p_code, '')))
     and is_public = true and host_id = auth.uid();
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then raise exception 'Diese öffentliche DubTogether-Lobby gehört dir nicht mehr oder existiert nicht.'; end if;
  return true;
end;
$$;

revoke all on function public.list_public_tictactoe_rooms() from public, anon;
revoke all on function public.list_public_slf_rooms() from public, anon;
revoke all on function public.list_public_dub_rooms() from public, anon;
revoke all on function public.close_public_tictactoe_room(text) from public, anon;
revoke all on function public.close_public_slf_room(text) from public, anon;
revoke all on function public.close_public_dub_room(text) from public, anon;
grant execute on function public.list_public_tictactoe_rooms() to authenticated;
grant execute on function public.list_public_slf_rooms() to authenticated;
grant execute on function public.list_public_dub_rooms() to authenticated;
grant execute on function public.close_public_tictactoe_room(text) to authenticated;
grant execute on function public.close_public_slf_room(text) to authenticated;
grant execute on function public.close_public_dub_room(text) to authenticated;

-- Delete rooms across all three games after 30 minutes without a server-side update.
-- The room tables' foreign keys cascade their dependent game rows.
create or replace function public.cleanup_inactive_game_lobbies()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - interval '30 minutes';
  v_ttt integer := 0;
  v_slf integer := 0;
  v_dub integer := 0;
  v_batch integer;
begin
  -- Delete in small batches so a large backlog (for example, thousands of
  -- abandoned rooms) does not create one unnecessarily large delete statement.
  loop
    delete from public.online_tictactoe_rooms
     where ctid in (select ctid from public.online_tictactoe_rooms where updated_at < v_cutoff limit 1000);
    get diagnostics v_batch = row_count; v_ttt := v_ttt + v_batch;
    exit when v_batch = 0;
  end loop;
  loop
    delete from public.online_slf_rooms
     where ctid in (select ctid from public.online_slf_rooms where updated_at < v_cutoff limit 1000);
    get diagnostics v_batch = row_count; v_slf := v_slf + v_batch;
    exit when v_batch = 0;
  end loop;
  loop
    delete from public.dub_together_rooms
     where ctid in (select ctid from public.dub_together_rooms where updated_at < v_cutoff limit 1000);
    get diagnostics v_batch = row_count; v_dub := v_dub + v_batch;
    exit when v_batch = 0;
  end loop;
  return jsonb_build_object(
    'deleted_tictactoe', v_ttt,
    'deleted_slf', v_slf,
    'deleted_dub_together', v_dub,
    'cutoff', v_cutoff
  );
end;
$$;
revoke all on function public.cleanup_inactive_game_lobbies() from public, anon, authenticated;
grant execute on function public.cleanup_inactive_game_lobbies() to postgres;

-- Run an immediate first cleanup, then schedule every five minutes.
select public.cleanup_inactive_game_lobbies();

do $$
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'pg_cron could not be enabled automatically. Enable it in Supabase Database > Extensions, then rerun the scheduling block.';
  end;

  if to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = $1'
      using 'schreibbot-lobby-cleanup-5m';
    execute 'select cron.schedule($1, $2, $3)'
      using 'schreibbot-lobby-cleanup-5m', '*/5 * * * *',
            'select public.cleanup_inactive_game_lobbies();';
  else
    raise notice 'pg_cron is unavailable. Enable pg_cron in Supabase Database > Extensions, then rerun this SQL migration.';
  end if;
end;
$$;

-- Return is_public to the active SLF lobby so only its owner sees the close button.
create or replace function public.get_slf_room(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_players jsonb;
  v_submissions jsonb := '{}'::jsonb;
  v_my_draft jsonb := jsonb_build_object('answers','{}'::jsonb,'ink_answers','{}'::jsonb);
  v_result jsonb;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um den Spielraum zu öffnen.'; end if;
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum wurde nicht gefunden.'; end if;
  if not exists(select 1 from public.online_slf_players p where p.room_code = v_room.code and p.player_id = v_uid) then
    raise exception 'Du bist diesem Raum nicht beigetreten.';
  end if;
  -- Answers stay private while the timer is running. The server exposes all drafts only at reveal.
  if v_room.status = 'playing' and v_room.deadline_at is not null and v_room.deadline_at <= now() then
    update public.online_slf_rooms r set status = 'reveal', reveal_step = 0, updated_at = now()
      where r.code = v_room.code returning r.* into v_room;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.player_id,'name',p.display_name,'joined_at',p.joined_at) order by p.joined_at), '[]'::jsonb)
    into v_players from public.online_slf_players p where p.room_code = v_room.code;
  if v_room.status = 'reveal' then
    select coalesce(jsonb_object_agg(d.player_id::text,jsonb_build_object('answers',d.answers,'ink_answers',d.ink_answers,'submitted_at',d.updated_at)), '{}'::jsonb)
      into v_submissions from public.online_slf_drafts d where d.room_code = v_room.code;
  elsif v_room.status = 'playing' then
    select jsonb_build_object('answers',d.answers,'ink_answers',d.ink_answers)
      into v_my_draft from public.online_slf_drafts d where d.room_code = v_room.code and d.player_id = v_uid;
    if v_my_draft is null then v_my_draft := jsonb_build_object('answers','{}'::jsonb,'ink_answers','{}'::jsonb); end if;
  end if;
  v_result := jsonb_build_object(
    'code',v_room.code,'host_id',v_room.host_id,'status',v_room.status,'is_public',v_room.is_public,'categories',v_room.categories,
    'duration_seconds',v_room.duration_seconds,'letter',v_room.letter,'deadline_at',v_room.deadline_at,
    'round_number',v_room.round_number,'reveal_step',v_room.reveal_step,'created_at',v_room.created_at,'updated_at',v_room.updated_at,
    'players',v_players,'my_submitted',false,'my_draft',v_my_draft,'submissions',v_submissions
  );
  return v_result;
end;
$$;

revoke all on function public.get_slf_room(text) from public, anon;
grant execute on function public.get_slf_room(text) to authenticated;

notify pgrst, 'reload schema';
