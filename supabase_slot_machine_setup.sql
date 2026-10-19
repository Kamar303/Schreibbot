-- Handschrift Arcade Slotmaschine: nur virtuelle Spielpunkte, keine Einsätze, kein Echtgeld, keine Auszahlungen.
-- Im selben Supabase-Projekt wie die Website im SQL Editor ausführen.
-- Anonymous Sign-Ins muss in Authentication aktiviert sein.

create table if not exists public.online_slot_scores (
  player_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Spieler' check (char_length(display_name) between 1 and 20),
  total_points bigint not null default 0 check (total_points between 0 and 1000000000),
  spins bigint not null default 0 check (spins between 0 and 1000000000),
  updated_at timestamptz not null default now()
);

alter table public.online_slot_scores enable row level security;
revoke all on table public.online_slot_scores from public, anon, authenticated;

create or replace function public.spin_slot_machine(p_name text)
returns table(reel_one text, reel_two text, reel_three text, points_awarded integer, total_points bigint, spins bigint, display_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_symbols text[] := array['🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
  v_one text;
  v_two text;
  v_three text;
  v_award integer := 0;
  v_name text;
  v_name_norm text;
  v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Melde dich bitte erneut an, damit die Spielpunkte gespeichert werden.'; end if;
  v_name := left(regexp_replace(coalesce(trim(p_name), ''), '[<>[:cntrl:]]', '', 'g'), 20);
  if v_name = '' then v_name := 'Spieler'; end if;
  v_name_norm := translate(lower(regexp_replace(v_name, '[^[:alnum:]]', '', 'g')), 'äöüß', 'aous');
  if v_name_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then
    raise exception 'Dieser Name ist nicht erlaubt. Bitte wähle einen respektvollen Anzeigenamen.';
  end if;

  -- Serverseitige Zufallsziehung, damit das Ergebnis nicht nur aus der Browser-Animation stammt.
  v_one := v_symbols[1 + floor(random() * array_length(v_symbols, 1))::integer];
  v_two := v_symbols[1 + floor(random() * array_length(v_symbols, 1))::integer];
  v_three := v_symbols[1 + floor(random() * array_length(v_symbols, 1))::integer];

  if v_one = v_two and v_two = v_three and v_one = '⭐' then
    v_award := 1000;
  elsif v_one = v_two and v_two = v_three and v_one = '🍓' then
    v_award := 750;
  elsif v_one = v_two and v_two = v_three and v_one = '7️⃣' then
    v_award := 500;
  elsif v_one = v_two and v_two = v_three then
    v_award := 100;
  elsif v_one = v_two or v_one = v_three or v_two = v_three then
    v_award := 15;
  else
    v_award := 0;
  end if;

  insert into public.online_slot_scores as current_score(player_id, display_name, total_points, spins, updated_at)
  values (v_uid, v_name, v_award + 10, 1, now())
  on conflict (player_id) do update
    set display_name = excluded.display_name,
        total_points = least(current_score.total_points + v_award, 1000000000),
        spins = least(current_score.spins + 1, 1000000000),
        updated_at = now()
  returning * into v_row;

  return query select v_one, v_two, v_three, v_award, v_row.total_points, v_row.spins, v_row.display_name;
end;
$$;

revoke all on function public.spin_slot_machine(text) from public, anon;
grant execute on function public.spin_slot_machine(text) to authenticated;

create or replace function public.set_slot_display_name(p_name text)
returns table(display_name text,total_points bigint,spins bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_name_norm text;
  v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Melde dich bitte erneut an, damit der Name gespeichert werden kann.'; end if;
  v_name := left(regexp_replace(coalesce(trim(p_name), ''), '[<>[:cntrl:]]', ' ', 'g'), 20);
  v_name := trim(regexp_replace(v_name, '\s+', ' ', 'g'));
  if v_name = '' then v_name := 'Spieler'; end if;
  v_name_norm := translate(lower(regexp_replace(v_name, '[^[:alnum:]]', '', 'g')), 'äöüß', 'aous');
  if v_name_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then
    raise exception 'Dieser Name ist nicht erlaubt. Bitte wähle einen respektvollen Anzeigenamen.';
  end if;
  insert into public.online_slot_scores as current_score(player_id,display_name,total_points,spins,updated_at)
    values(v_uid,v_name,10,0,now())
    on conflict(player_id) do update set display_name=excluded.display_name,updated_at=now()
    returning * into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins;
end;
$$;

revoke all on function public.set_slot_display_name(text) from public, anon;
grant execute on function public.set_slot_display_name(text) to authenticated;

drop function if exists public.get_slot_leaderboard();
create function public.get_slot_leaderboard()
returns table(rank_no bigint, display_name text, total_points bigint, spins bigint, is_me boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Melde dich bitte erneut an, um die Rangliste zu laden.'; end if;
  return query
    select ranked.rank_no, ranked.display_name, ranked.total_points, ranked.spins, ranked.player_id = v_uid as is_me
    from (
      select row_number() over (order by s.total_points desc, s.updated_at asc, s.display_name asc) as rank_no,
             s.player_id, s.display_name, s.total_points, s.spins
      from public.online_slot_scores s
    ) ranked
    where ranked.rank_no <= 10 or ranked.player_id = v_uid
    order by ranked.rank_no;
end;
$$;

revoke all on function public.get_slot_leaderboard() from public, anon;
grant execute on function public.get_slot_leaderboard() to authenticated;
