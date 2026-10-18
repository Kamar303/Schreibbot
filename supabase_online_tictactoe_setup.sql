-- Handschrift Online Tic-Tac-Toe setup
-- Run once in the Supabase SQL Editor for the SAME project configured in index.html.
-- Requires anonymous sign-ins to be enabled in Supabase Authentication.

create table if not exists public.online_tictactoe_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'playing', 'finished')),
  board jsonb not null default '["","","","","","","","",""]'::jsonb,
  player_x uuid not null,
  player_o uuid,
  turn text not null default 'X' check (turn in ('X','O')),
  winner text check (winner in ('X','O','draw') or winner is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ttt_board_is_nine_cells check (jsonb_typeof(board) = 'array' and jsonb_array_length(board) = 9)
);

create index if not exists online_tictactoe_rooms_updated_at_idx
  on public.online_tictactoe_rooms (updated_at desc);

alter table public.online_tictactoe_rooms enable row level security;
revoke all on table public.online_tictactoe_rooms from anon, authenticated, public;
grant select on table public.online_tictactoe_rooms to authenticated;

drop policy if exists "ttt players can read own rooms" on public.online_tictactoe_rooms;
create policy "ttt players can read own rooms"
  on public.online_tictactoe_rooms for select to authenticated
  using (auth.uid() = player_x or auth.uid() = player_o);

-- Remove a permissive insert policy if an earlier draft of this setup was tested.
drop policy if exists "ttt authenticated player creates own room" on public.online_tictactoe_rooms;

create or replace function public.create_tictactoe_room(p_code text)
returns setof public.online_tictactoe_rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_tictactoe_rooms%rowtype;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um einen Raum zu erstellen.'; end if;
  if upper(trim(p_code)) !~ '^[A-Z0-9]{6}$' then raise exception 'Ungültiger Raumcode.'; end if;
  -- Remove rooms left idle for more than 48 hours whenever a new room is made.
  delete from public.online_tictactoe_rooms t where t.updated_at < now() - interval '48 hours';
  insert into public.online_tictactoe_rooms (code, status, board, player_x, player_o, turn, winner)
    values (upper(trim(p_code)), 'waiting', '["","","","","","","","",""]'::jsonb, v_uid, null, 'X', null)
    returning * into v_room;
  return next v_room;
end;
$$;

create or replace function public.join_tictactoe_room(p_code text)
returns setof public.online_tictactoe_rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_tictactoe_rooms%rowtype;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um einem Raum beizutreten.'; end if;
  select * into v_room from public.online_tictactoe_rooms t
    where t.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Raumcode wurde nicht gefunden.'; end if;
  if v_room.player_x = v_uid or v_room.player_o = v_uid then
    return next v_room; return;
  end if;
  if v_room.status <> 'waiting' or v_room.player_o is not null then
    raise exception 'Der Raum ist bereits voll oder die Partie läuft schon.';
  end if;
  update public.online_tictactoe_rooms t
    set player_o = v_uid, status = 'ready', updated_at = now()
    where t.code = v_room.code returning t.* into v_room;
  return next v_room;
end;
$$;

create or replace function public.start_tictactoe_room(p_code text)
returns setof public.online_tictactoe_rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_tictactoe_rooms%rowtype;
begin
  select * into v_room from public.online_tictactoe_rooms t
    where t.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Raum existiert nicht mehr.'; end if;
  if v_uid is null or v_room.player_x <> v_uid then raise exception 'Nur Spieler X kann die Partie starten.'; end if;
  if v_room.player_o is null or v_room.status <> 'ready' then raise exception 'Warte, bis beide Spieler in der Lobby sind.'; end if;
  update public.online_tictactoe_rooms t set status = 'playing', updated_at = now()
    where t.code = v_room.code returning t.* into v_room;
  return next v_room;
end;
$$;

create or replace function public.make_tictactoe_move(p_code text, p_cell integer)
returns setof public.online_tictactoe_rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_tictactoe_rooms%rowtype;
  v_board jsonb;
  v_winner text := null;
  v_status text := 'playing';
begin
  if p_cell is null or p_cell < 0 or p_cell > 8 then raise exception 'Ungültiges Spielfeld.'; end if;
  select * into v_room from public.online_tictactoe_rooms t
    where t.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Raum existiert nicht mehr.'; end if;
  if v_room.status <> 'playing' then raise exception 'Die Partie läuft gerade nicht.'; end if;
  if v_uid is null then raise exception 'Bitte verbinde dich erneut.'; end if;
  if (v_room.turn = 'X' and v_room.player_x <> v_uid) or (v_room.turn = 'O' and v_room.player_o <> v_uid) then
    raise exception 'Warte, bis du an der Reihe bist.';
  end if;
  if coalesce(v_room.board ->> p_cell, '') <> '' then raise exception 'Dieses Feld ist bereits belegt.'; end if;
  v_board := jsonb_set(v_room.board, array[p_cell::text], to_jsonb(v_room.turn), true);
  if ((v_board ->> 0) = v_room.turn and (v_board ->> 1) = v_room.turn and (v_board ->> 2) = v_room.turn)
     or ((v_board ->> 3) = v_room.turn and (v_board ->> 4) = v_room.turn and (v_board ->> 5) = v_room.turn)
     or ((v_board ->> 6) = v_room.turn and (v_board ->> 7) = v_room.turn and (v_board ->> 8) = v_room.turn)
     or ((v_board ->> 0) = v_room.turn and (v_board ->> 3) = v_room.turn and (v_board ->> 6) = v_room.turn)
     or ((v_board ->> 1) = v_room.turn and (v_board ->> 4) = v_room.turn and (v_board ->> 7) = v_room.turn)
     or ((v_board ->> 2) = v_room.turn and (v_board ->> 5) = v_room.turn and (v_board ->> 8) = v_room.turn)
     or ((v_board ->> 0) = v_room.turn and (v_board ->> 4) = v_room.turn and (v_board ->> 8) = v_room.turn)
     or ((v_board ->> 2) = v_room.turn and (v_board ->> 4) = v_room.turn and (v_board ->> 6) = v_room.turn) then
    v_winner := v_room.turn; v_status := 'finished';
  elsif not exists (select 1 from generate_series(0,8) as cells(i) where coalesce(v_board ->> cells.i, '') = '') then
    v_winner := 'draw'; v_status := 'finished';
  end if;
  update public.online_tictactoe_rooms t
    set board = v_board,
        turn = case when v_status = 'finished' then v_room.turn when v_room.turn = 'X' then 'O' else 'X' end,
        winner = v_winner, status = v_status, updated_at = now()
    where t.code = v_room.code returning t.* into v_room;
  return next v_room;
end;
$$;

create or replace function public.rematch_tictactoe_room(p_code text)
returns setof public.online_tictactoe_rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_tictactoe_rooms%rowtype;
begin
  select * into v_room from public.online_tictactoe_rooms t
    where t.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Raum existiert nicht mehr.'; end if;
  if v_uid is null or v_room.player_x <> v_uid then raise exception 'Nur Spieler X kann eine neue Runde starten.'; end if;
  if v_room.player_o is null or v_room.status <> 'finished' then raise exception 'Die aktuelle Partie ist noch nicht beendet.'; end if;
  update public.online_tictactoe_rooms t
    set board = '["","","","","","","","",""]'::jsonb,
        turn = 'X', winner = null, status = 'playing', updated_at = now()
    where t.code = v_room.code returning t.* into v_room;
  return next v_room;
end;
$$;

revoke all on function public.create_tictactoe_room(text) from public, anon;
revoke all on function public.join_tictactoe_room(text) from public, anon;
revoke all on function public.start_tictactoe_room(text) from public, anon;
revoke all on function public.make_tictactoe_move(text, integer) from public, anon;
revoke all on function public.rematch_tictactoe_room(text) from public, anon;
grant execute on function public.create_tictactoe_room(text) to authenticated;
grant execute on function public.join_tictactoe_room(text) to authenticated;
grant execute on function public.start_tictactoe_room(text) to authenticated;
grant execute on function public.make_tictactoe_move(text, integer) to authenticated;
grant execute on function public.rematch_tictactoe_room(text) to authenticated;

-- Rooms are intentionally not readable by visitors who have not joined them.
-- Rooms idle for more than 48 hours are purged automatically when a new room is created.
