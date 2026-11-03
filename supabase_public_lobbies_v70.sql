-- Schreibbot v70: öffentliche Lobbys für Tic-Tac-Toe und Stadt, Land, Fluss.
-- Voraussetzung: supabase_online_tictactoe_setup.sql wurde bereits im selben Supabase-Projekt ausgeführt.
-- Danach dieses Skript einmal im Supabase SQL Editor ausführen.
-- Dieses v70-Skript ist idempotent und kann auch die frühere v69-Lobby-Migration ersetzen.

alter table public.online_tictactoe_rooms
  add column if not exists is_public boolean not null default false;

alter table public.online_slf_rooms
  add column if not exists is_public boolean not null default false;

create index if not exists online_ttt_public_waiting_idx
  on public.online_tictactoe_rooms (updated_at desc)
  where is_public = true and status = 'waiting' and player_o is null;

create index if not exists online_slf_public_waiting_idx
  on public.online_slf_rooms (updated_at desc)
  where is_public = true and status = 'waiting';

-- Tic-Tac-Toe: öffentliche Lobby erstellen.
create or replace function public.create_public_tictactoe_room(p_code text)
returns setof public.online_tictactoe_rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_tictactoe_rooms%rowtype;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_uid is null then
    raise exception 'Bitte verbinde dich erneut, um eine öffentliche Lobby zu erstellen.';
  end if;
  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Ungültiger Raumcode.';
  end if;

  delete from public.online_tictactoe_rooms r
   where r.updated_at < now() - interval '48 hours';

  insert into public.online_tictactoe_rooms
    (code, status, board, player_x, player_o, turn, winner, is_public)
  values
    (v_code, 'waiting', '["","","","","","","","",""]'::jsonb,
     v_uid, null, 'X', null, true)
  returning * into v_room;

  return next v_room;
end;
$$;

-- Nur öffentliche, noch offene Tic-Tac-Toe-Räume werden gelistet.
-- Es werden keine Benutzer-IDs oder privaten Raumcodes offengelegt.
create or replace function public.list_public_tictactoe_rooms()
returns table(code text, player_count integer, created_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  select r.code,
         (case when r.player_o is null then 1 else 2 end)::integer,
         r.created_at
    from public.online_tictactoe_rooms r
   where auth.uid() is not null
     and r.is_public = true
     and r.status = 'waiting'
     and r.player_o is null
     and r.updated_at > now() - interval '2 hours'
   order by r.created_at desc
   limit 40;
$$;

-- Stadt, Land, Fluss: erst die normale, validierte Raum-Erstellung nutzen,
-- danach den Raum innerhalb derselben Transaktion als öffentlich markieren.
create or replace function public.create_public_slf_room(
  p_code text,
  p_name text,
  p_categories jsonb,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_room jsonb;
begin
  v_room := public.create_slf_room(v_code, p_name, p_categories, p_duration_seconds);
  update public.online_slf_rooms r
     set is_public = true, updated_at = now()
   where r.code = v_code;
  return public.get_slf_room(v_code);
end;
$$;

-- Lijst bevat alleen openbare waiting-ruimtes met plek voor spelers.
create or replace function public.list_public_slf_rooms()
returns table(
  code text,
  host_name text,
  player_count integer,
  categories jsonb,
  duration_seconds integer,
  created_at timestamptz
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
         r.created_at
    from public.online_slf_rooms r
    join public.online_slf_players p on p.room_code = r.code
    left join public.online_slf_players h
      on h.room_code = r.code and h.player_id = r.host_id
   where auth.uid() is not null
     and r.is_public = true
     and r.status = 'waiting'
     and r.updated_at > now() - interval '2 hours'
   group by r.code, h.display_name, r.categories, r.duration_seconds, r.created_at
  having count(p.player_id) < 8
   order by r.created_at desc
   limit 40;
$$;

revoke all on function public.create_public_tictactoe_room(text) from public, anon;
revoke all on function public.list_public_tictactoe_rooms() from public, anon;
revoke all on function public.create_public_slf_room(text, text, jsonb, integer) from public, anon;
revoke all on function public.list_public_slf_rooms() from public, anon;

grant execute on function public.create_public_tictactoe_room(text) to authenticated;
grant execute on function public.list_public_tictactoe_rooms() to authenticated;
grant execute on function public.create_public_slf_room(text, text, jsonb, integer) to authenticated;
grant execute on function public.list_public_slf_rooms() to authenticated;

notify pgrst, 'reload schema';
