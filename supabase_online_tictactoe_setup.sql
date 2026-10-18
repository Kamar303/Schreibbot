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

-- Stadt, Land, Fluss: multiplayer rooms, private submissions and shared reveal
-- Run this section together with the existing setup script in the same Supabase project.
-- The underlying tables are not directly readable by clients. Players can only use the
-- SECURITY DEFINER RPCs below; answers are returned to clients only after reveal.

create table if not exists public.online_slf_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null,
  status text not null default 'waiting' check (status in ('waiting','playing','reveal')),
  categories jsonb not null check (jsonb_typeof(categories) = 'array'),
  duration_seconds integer not null check (duration_seconds between 15 and 300),
  letter text,
  deadline_at timestamptz,
  round_number integer not null default 0 check (round_number >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists online_slf_rooms_updated_at_idx on public.online_slf_rooms(updated_at desc);

create table if not exists public.online_slf_players (
  room_code text not null references public.online_slf_rooms(code) on delete cascade,
  player_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 20),
  joined_at timestamptz not null default now(),
  primary key (room_code, player_id)
);

create table if not exists public.online_slf_submissions (
  room_code text not null,
  player_id uuid not null,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  submitted_at timestamptz not null default now(),
  primary key (room_code, player_id),
  foreign key (room_code, player_id) references public.online_slf_players(room_code, player_id) on delete cascade
);

alter table public.online_slf_rooms enable row level security;
alter table public.online_slf_players enable row level security;
alter table public.online_slf_submissions enable row level security;
revoke all on table public.online_slf_rooms from public, anon, authenticated;
revoke all on table public.online_slf_players from public, anon, authenticated;
revoke all on table public.online_slf_submissions from public, anon, authenticated;

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
    update public.online_slf_rooms r set status = 'reveal', updated_at = now() where r.code = v_room.code returning r.* into v_room;
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
    'round_number',v_room.round_number,'created_at',v_room.created_at,'updated_at',v_room.updated_at,
    'players',v_players,
    'my_submitted',exists(select 1 from public.online_slf_submissions s where s.room_code = v_room.code and s.player_id = v_uid),
    'submissions',v_submissions
  );
  return v_result;
end;
$$;

create or replace function public.create_slf_room(p_code text, p_name text, p_categories jsonb, p_duration_seconds integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code,'')));
  v_name text := left(regexp_replace(trim(coalesce(p_name,'')), '[[:cntrl:]]', '', 'g'), 20);
  v_categories jsonb;
  v_count integer;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um eine Lobby zu erstellen.'; end if;
  if v_code !~ '^[A-Z0-9]{6}$' then raise exception 'Ungültiger Raumcode.'; end if;
  if v_name = '' then v_name := 'Spieler'; end if;
  if p_categories is null or jsonb_typeof(p_categories) <> 'array' then raise exception 'Bitte mindestens zwei Kategorien eingeben.'; end if;
  v_count := jsonb_array_length(p_categories);
  if v_count < 2 or v_count > 12 then raise exception 'Bitte 2 bis 12 Kategorien verwenden.'; end if;
  if p_duration_seconds is null or p_duration_seconds < 15 or p_duration_seconds > 300 then raise exception 'Die Rundenzeit muss zwischen 15 und 300 Sekunden liegen.'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_categories) e(value) where trim(e.value) = '' or char_length(trim(e.value)) > 32) then
    raise exception 'Kategorien müssen zwischen 1 und 32 Zeichen lang sein.';
  end if;
  if exists(select 1 from (select lower(trim(e.value)) as cat from jsonb_array_elements_text(p_categories) e(value)) q group by q.cat having count(*) > 1) then
    raise exception 'Bitte jede Kategorie nur einmal eingeben.';
  end if;
  select jsonb_agg(to_jsonb(trim(e.value)) order by e.ord) into v_categories
    from jsonb_array_elements_text(p_categories) with ordinality e(value,ord);
  delete from public.online_slf_rooms r where r.updated_at < now() - interval '48 hours';
  insert into public.online_slf_rooms(code,host_id,status,categories,duration_seconds)
    values(v_code,v_uid,'waiting',v_categories,p_duration_seconds);
  insert into public.online_slf_players(room_code,player_id,display_name) values(v_code,v_uid,v_name);
  return public.get_slf_room(v_code);
end;
$$;

create or replace function public.join_slf_room(p_code text, p_name text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code,'')));
  v_name text := left(regexp_replace(trim(coalesce(p_name,'')), '[[:cntrl:]]', '', 'g'), 20);
  v_room public.online_slf_rooms%rowtype;
  v_count integer;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um einer Lobby beizutreten.'; end if;
  if v_name = '' then v_name := 'Spieler'; end if;
  select * into v_room from public.online_slf_rooms r where r.code = v_code for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Code wurde nicht gefunden.'; end if;
  if exists(select 1 from public.online_slf_players p where p.room_code = v_code and p.player_id = v_uid) then
    update public.online_slf_players p set display_name = v_name where p.room_code = v_code and p.player_id = v_uid;
    return public.get_slf_room(v_code);
  end if;
  if v_room.status <> 'waiting' then raise exception 'Diese Runde läuft bereits. Bitte lass dir einen neuen Code geben.'; end if;
  select count(*) into v_count from public.online_slf_players p where p.room_code = v_code;
  if v_count >= 8 then raise exception 'Diese Lobby ist voll (maximal 8 Spieler).'; end if;
  insert into public.online_slf_players(room_code,player_id,display_name) values(v_code,v_uid,v_name);
  update public.online_slf_rooms r set updated_at = now() where r.code = v_code;
  return public.get_slf_room(v_code);
end;
$$;

create or replace function public.start_slf_round(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_count integer;
  v_letter text;
begin
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum existiert nicht mehr.'; end if;
  if v_uid is null or v_room.host_id <> v_uid then raise exception 'Nur der Gastgeber kann die Runde starten.'; end if;
  if v_room.status <> 'waiting' then raise exception 'Diese Runde wurde bereits gestartet.'; end if;
  select count(*) into v_count from public.online_slf_players p where p.room_code = v_room.code;
  if v_count < 2 then raise exception 'Warte auf mindestens einen Mitspieler, bevor du startest.'; end if;
  v_letter := substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ',floor(random()*26)::integer+1,1);
  update public.online_slf_rooms r set status='playing',letter=v_letter,round_number=1,
    deadline_at=now()+(v_room.duration_seconds || ' seconds')::interval,updated_at=now()
    where r.code=v_room.code;
  delete from public.online_slf_submissions s where s.room_code=v_room.code;
  return public.get_slf_room(v_room.code);
end;
$$;

create or replace function public.submit_slf_answers(p_code text, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_category text;
  v_answer text;
  v_clean jsonb := '{}'::jsonb;
  v_player_count integer;
  v_submission_count integer;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Die Antworten haben ein ungültiges Format.'; end if;
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum existiert nicht mehr.'; end if;
  if v_uid is null or not exists(select 1 from public.online_slf_players p where p.room_code=v_room.code and p.player_id=v_uid) then raise exception 'Du gehörst nicht zu dieser Lobby.'; end if;
  if v_room.status <> 'playing' then raise exception 'Diese Runde nimmt keine Antworten mehr an.'; end if;
  if v_room.deadline_at is null or v_room.deadline_at <= now() then
    update public.online_slf_rooms r set status='reveal',updated_at=now() where r.code=v_room.code;
    return public.get_slf_room(v_room.code);
  end if;
  if exists(select 1 from public.online_slf_submissions s where s.room_code=v_room.code and s.player_id=v_uid) then raise exception 'Du hast deine Antworten bereits abgegeben.'; end if;
  for v_category in select jsonb_array_elements_text(v_room.categories) loop
    v_answer := left(trim(regexp_replace(coalesce(p_answers ->> v_category,''), '[[:cntrl:]]', '', 'g')),100);
    v_clean := v_clean || jsonb_build_object(v_category,v_answer);
  end loop;
  insert into public.online_slf_submissions(room_code,player_id,answers) values(v_room.code,v_uid,v_clean);
  select count(*) into v_player_count from public.online_slf_players p where p.room_code=v_room.code;
  select count(*) into v_submission_count from public.online_slf_submissions s where s.room_code=v_room.code;
  if v_player_count > 0 and v_submission_count >= v_player_count then
    update public.online_slf_rooms r set status='reveal',updated_at=now() where r.code=v_room.code;
  else
    update public.online_slf_rooms r set updated_at=now() where r.code=v_room.code;
  end if;
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
  update public.online_slf_rooms r set status='playing',letter=v_letter,round_number=v_room.round_number+1,
    deadline_at=now()+(v_room.duration_seconds || ' seconds')::interval,updated_at=now()
    where r.code=v_room.code;
  delete from public.online_slf_submissions s where s.room_code=v_room.code;
  return public.get_slf_room(v_room.code);
end;
$$;

revoke all on function public.get_slf_room(text) from public, anon;
revoke all on function public.create_slf_room(text,text,jsonb,integer) from public, anon;
revoke all on function public.join_slf_room(text,text) from public, anon;
revoke all on function public.start_slf_round(text) from public, anon;
revoke all on function public.submit_slf_answers(text,jsonb) from public, anon;
revoke all on function public.next_slf_round(text) from public, anon;
grant execute on function public.get_slf_room(text) to authenticated;
grant execute on function public.create_slf_room(text,text,jsonb,integer) to authenticated;
grant execute on function public.join_slf_room(text,text) to authenticated;
grant execute on function public.start_slf_round(text) to authenticated;
grant execute on function public.submit_slf_answers(text,jsonb) to authenticated;
grant execute on function public.next_slf_round(text) to authenticated;

notify pgrst, 'reload schema';
