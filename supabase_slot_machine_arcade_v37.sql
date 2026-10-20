-- Handschrift Arcade v37: capped free spins, 30-second recharge, pair bonus, virtual collectible shop.
-- Run this AFTER supabase_slot_machine_setup.sql and any earlier slot update SQL.
-- Coins are fictional game points only. This migration adds no payment, redemption, cash-out or real-world exchange.

alter table public.online_slot_scores
  add column if not exists free_spins integer not null default 2,
  add column if not exists next_free_spin_at timestamptz,
  add column if not exists inventory text[] not null default '{}'::text[];

alter table public.online_slot_scores
  drop constraint if exists online_slot_scores_free_spins_check;
alter table public.online_slot_scores
  add constraint online_slot_scores_free_spins_check check (free_spins between 0 and 2);

-- Existing players get the new capped free-play pool once this migration is applied.
update public.online_slot_scores
set free_spins = 2, next_free_spin_at = null
where free_spins is null or free_spins > 2 or free_spins < 0;

-- Drop is required because PostgreSQL cannot change the return row shape via CREATE OR REPLACE.
drop function if exists public.spin_slot_machine(text);
create function public.spin_slot_machine(p_name text)
returns table(
  reel_one text, reel_two text, reel_three text,
  points_awarded integer, total_points bigint, spins bigint, display_name text,
  free_spins integer, next_free_spin_at timestamptz, free_spin_earned boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_symbols text[] := array['🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
  v_one text; v_two text; v_three text;
  v_award integer := 0;
  v_name text; v_name_norm text;
  v_row public.online_slot_scores%rowtype;
  v_refills integer := 0;
  v_free_after integer := 0;
  v_next timestamptz;
  v_pair boolean := false;
  v_earned boolean := false;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  v_name := left(regexp_replace(coalesce(trim(p_name), ''), '[<>[:cntrl:]]', '', 'g'), 20);
  if v_name = '' then v_name := 'Spieler'; end if;
  v_name_norm := translate(lower(regexp_replace(v_name, '[^[:alnum:]]', '', 'g')), 'äöüß', 'aous');
  if v_name_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then
    raise exception 'Dieser Name ist nicht erlaubt. Bitte wähle einen respektvollen Anzeigenamen.';
  end if;

  insert into public.online_slot_scores(player_id, display_name, total_points, spins, free_spins, next_free_spin_at, inventory, updated_at)
  values (v_uid, v_name, 10, 0, 2, null, '{}'::text[], now())
  on conflict (player_id) do update set display_name = excluded.display_name, updated_at = now();

  select * into v_row from public.online_slot_scores where player_id = v_uid for update;

  -- One free spin recharges every 30 seconds, capped at two stored spins.
  if v_row.free_spins < 2 and v_row.next_free_spin_at is not null and now() >= v_row.next_free_spin_at then
    v_refills := 1 + floor(extract(epoch from (now() - v_row.next_free_spin_at)) / 30)::integer;
    v_free_after := least(2, v_row.free_spins + v_refills);
    if v_free_after >= 2 then v_next := null;
    else v_next := v_row.next_free_spin_at + (v_refills * interval '30 seconds'); end if;
    update public.online_slot_scores set free_spins = v_free_after, next_free_spin_at = v_next
    where player_id = v_uid returning * into v_row;
  end if;

  if v_row.free_spins <= 0 then
    raise exception 'Keine Freispiele übrig. Ein Freispiel lädt alle 30 Sekunden nach; deine Coins werden nicht eingesetzt oder verloren.';
  end if;

  v_one := v_symbols[1 + floor(random() * array_length(v_symbols, 1))::integer];
  v_two := v_symbols[1 + floor(random() * array_length(v_symbols, 1))::integer];
  v_three := v_symbols[1 + floor(random() * array_length(v_symbols, 1))::integer];
  v_pair := (v_one = v_two or v_one = v_three or v_two = v_three);

  if v_one = v_two and v_two = v_three and v_one = '⭐' then v_award := 1000;
  elsif v_one = v_two and v_two = v_three and v_one = '🍓' then v_award := 750;
  elsif v_one = v_two and v_two = v_three and v_one = '7️⃣' then v_award := 500;
  elsif v_one = v_two and v_two = v_three then v_award := 100;
  elsif v_pair then v_award := 15;
  else v_award := 0; end if;

  -- Consume one free spin. A pair grants one extra spin only if the pool has room.
  v_free_after := v_row.free_spins - 1;
  v_next := v_row.next_free_spin_at;
  if v_row.free_spins = 2 or v_next is null then v_next := now() + interval '30 seconds'; end if;
  if v_pair and v_free_after < 2 then v_free_after := v_free_after + 1; v_earned := true; end if;
  if v_free_after >= 2 then v_next := null;
  elsif v_next is null then v_next := now() + interval '30 seconds'; end if;

  update public.online_slot_scores as score
    set display_name = v_name,
        total_points = least(score.total_points + v_award, 1000000000),
        spins = least(score.spins + 1, 1000000000),
        free_spins = v_free_after,
        next_free_spin_at = v_next,
        updated_at = now()
    where score.player_id = v_uid
    returning score.* into v_row;

  return query select v_one, v_two, v_three, v_award, v_row.total_points, v_row.spins,
    v_row.display_name, v_row.free_spins, v_row.next_free_spin_at, v_earned;
end;
$$;
revoke all on function public.spin_slot_machine(text) from public, anon;
grant execute on function public.spin_slot_machine(text) to authenticated;

create or replace function public.get_slot_profile()
returns table(display_name text, total_points bigint, spins bigint, free_spins integer, next_free_spin_at timestamptz, inventory text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.online_slot_scores%rowtype;
  v_refills integer := 0;
  v_new_free integer;
  v_next timestamptz;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  insert into public.online_slot_scores(player_id, display_name, total_points, spins, free_spins, next_free_spin_at, inventory, updated_at)
  values(v_uid, 'Spieler', 10, 0, 2, null, '{}'::text[], now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores where player_id=v_uid for update;
  if v_row.free_spins < 2 and v_row.next_free_spin_at is not null and now() >= v_row.next_free_spin_at then
    v_refills := 1 + floor(extract(epoch from (now() - v_row.next_free_spin_at)) / 30)::integer;
    v_new_free := least(2, v_row.free_spins + v_refills);
    if v_new_free >= 2 then v_next := null;
    else v_next := v_row.next_free_spin_at + (v_refills * interval '30 seconds'); end if;
    update public.online_slot_scores set free_spins=v_new_free, next_free_spin_at=v_next, updated_at=now()
    where player_id=v_uid returning * into v_row;
  end if;
  return query select v_row.display_name, v_row.total_points, v_row.spins, v_row.free_spins, v_row.next_free_spin_at, v_row.inventory;
end;
$$;
revoke all on function public.get_slot_profile() from public, anon;
grant execute on function public.get_slot_profile() to authenticated;

create or replace function public.buy_slot_shop_item(p_item_id text)
returns table(display_name text, total_points bigint, inventory text[], free_spins integer, next_free_spin_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.online_slot_scores%rowtype;
  v_price bigint;
  v_title text;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  case p_item_id
    when 'golden_pen' then v_price := 150; v_title := 'Goldener Stift';
    when 'neon_studio' then v_price := 500; v_title := 'Neon-Atelier';
    when 'bugatti' then v_price := 2500; v_title := 'Bugatti';
    when 'yacht' then v_price := 4000; v_title := 'Luxus-Yacht';
    else raise exception 'Dieses virtuelle Sammlerstück gibt es nicht im Shop.';
  end case;
  insert into public.online_slot_scores(player_id, display_name, total_points, spins, free_spins, next_free_spin_at, inventory, updated_at)
  values(v_uid, 'Spieler', 10, 0, 2, null, '{}'::text[], now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores where player_id=v_uid for update;
  if p_item_id = any(v_row.inventory) then raise exception 'Dieses Sammlerstück besitzt du bereits.'; end if;
  if v_row.total_points < v_price then raise exception 'Dafür reichen deine Arcade-Coins noch nicht.'; end if;
  update public.online_slot_scores as score
    set total_points = score.total_points - v_price,
        inventory = array_append(score.inventory, p_item_id),
        updated_at = now()
    where score.player_id = v_uid returning score.* into v_row;
  return query select v_row.display_name, v_row.total_points, v_row.inventory, v_row.free_spins, v_row.next_free_spin_at;
end;
$$;
revoke all on function public.buy_slot_shop_item(text) from public, anon;
grant execute on function public.buy_slot_shop_item(text) to authenticated;

notify pgrst, 'reload schema';
