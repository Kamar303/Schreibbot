-- Handschrift Arcade v39
-- Run AFTER supabase_slot_machine_setup.sql and supabase_slot_machine_update_v30.sql
-- All coins, spins and collectibles are virtual game data. This migration adds no payments or cash-out.

alter table public.online_slot_scores
  add column if not exists free_spins integer not null default 2,
  add column if not exists paid_spins integer not null default 0,
  add column if not exists next_free_spin_at timestamptz,
  add column if not exists multiplier_steps integer not null default 0,
  add column if not exists coin_fraction numeric(12,6) not null default 0,
  add column if not exists inventory text[] not null default '{}'::text[];

alter table public.online_slot_scores drop constraint if exists online_slot_scores_free_spins_check;
alter table public.online_slot_scores add constraint online_slot_scores_free_spins_check check (free_spins between 0 and 2);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_paid_spins_check;
alter table public.online_slot_scores add constraint online_slot_scores_paid_spins_check check (paid_spins between 0 and 10000);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_multiplier_steps_check;
alter table public.online_slot_scores add constraint online_slot_scores_multiplier_steps_check check (multiplier_steps between 0 and 1000);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_coin_fraction_check;
alter table public.online_slot_scores add constraint online_slot_scores_coin_fraction_check check (coin_fraction >= 0 and coin_fraction < 1);

-- Ensure existing profiles get a valid free-spin balance and inventory after adding the columns.
update public.online_slot_scores set free_spins=2 where free_spins is null or free_spins>2 or free_spins<0;
update public.online_slot_scores set paid_spins=0 where paid_spins is null or paid_spins<0;
update public.online_slot_scores set multiplier_steps=0 where multiplier_steps is null or multiplier_steps<0 or multiplier_steps>1000;
update public.online_slot_scores set coin_fraction=0 where coin_fraction is null or coin_fraction<0 or coin_fraction>=1;
update public.online_slot_scores set inventory='{}'::text[] where inventory is null;

-- Return shape changes in this release, so drop/recreate these RPCs.
drop function if exists public.spin_slot_machine(text);
drop function if exists public.get_slot_profile();
drop function if exists public.buy_slot_spins(integer);
drop function if exists public.buy_slot_multiplier_step();
drop function if exists public.buy_slot_shop_item(text);

create function public.get_slot_profile()
returns table(
  display_name text,
  total_points bigint,
  spins bigint,
  free_spins integer,
  paid_spins integer,
  next_free_spin_at timestamptz,
  multiplier_steps integer,
  inventory text[]
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.online_slot_scores%rowtype;
  v_refills integer := 0;
  v_new_free integer;
  v_next timestamptz;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.free_spins < 2 and v_row.next_free_spin_at is not null and now() >= v_row.next_free_spin_at then
    v_refills := 1 + floor(extract(epoch from (now()-v_row.next_free_spin_at))/30)::integer;
    v_new_free := least(2,v_row.free_spins+v_refills);
    if v_new_free >= 2 then v_next := null;
    else v_next := v_row.next_free_spin_at + (v_refills * interval '30 seconds'); end if;
    update public.online_slot_scores as score set free_spins=v_new_free,next_free_spin_at=v_next,updated_at=now()
      where score.player_id=v_uid returning score.* into v_row;
  end if;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory;
end;
$$;

create function public.buy_slot_spins(p_quantity integer)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[]
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_price bigint;
  v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  if p_quantity=1 then v_price:=50;
  elsif p_quantity=3 then v_price:=125;
  else raise exception 'Wähle einen Spin oder das Paket mit drei Spins.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.total_points < v_price then raise exception 'Du brauchst % Coins für diesen Spin-Kauf.',v_price; end if;
  if v_row.paid_spins + p_quantity > 10000 then raise exception 'Dein gekaufter Spin-Vorrat ist voll.'; end if;
  update public.online_slot_scores as score
    set total_points=score.total_points-v_price,
        paid_spins=score.paid_spins+p_quantity,
        updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory;
end;
$$;

create function public.buy_slot_multiplier_step()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[]
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.total_points < 5 then raise exception 'Ein Multiplikator-Upgrade kostet 5 Coins.'; end if;
  if v_row.multiplier_steps >= 1000 then raise exception 'Der Coin-Multiplikator hat bereits das Maximum von 200 %% erreicht.'; end if;
  update public.online_slot_scores as score
    set total_points=score.total_points-5,
        multiplier_steps=score.multiplier_steps+1,
        updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory;
end;
$$;

create function public.buy_slot_shop_item(p_item_id text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[]
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_price bigint;
  v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  case p_item_id
    when 'golden_pen' then v_price:=150;
    when 'neon_studio' then v_price:=500;
    when 'bugatti' then v_price:=2500;
    when 'yacht' then v_price:=4000;
    else raise exception 'Dieses virtuelle Sammlerstück gibt es nicht im Shop.';
  end case;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if p_item_id = any(v_row.inventory) then raise exception 'Dieses Sammlerstück besitzt du bereits.'; end if;
  if v_row.total_points < v_price then raise exception 'Dafür reichen deine Arcade-Coins noch nicht.'; end if;
  update public.online_slot_scores as score
    set total_points=score.total_points-v_price,
        inventory=array_append(score.inventory,p_item_id),
        updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory;
end;
$$;

create function public.spin_slot_machine(p_name text)
returns table(
  reel_one text,reel_two text,reel_three text,
  points_awarded integer,base_points_awarded integer,total_points bigint,spins bigint,display_name text,
  free_spins integer,paid_spins integer,next_free_spin_at timestamptz,multiplier_steps integer,
  inventory text[],free_spin_earned boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_symbols text[] := array['🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
  v_one text;v_two text;v_three text;
  v_base_award integer:=0;v_award integer:=0;
  v_bonus_total numeric(18,6):=0;v_fraction_after numeric(12,6):=0;
  v_name text;v_name_norm text;
  v_row public.online_slot_scores%rowtype;
  v_refills integer:=0;v_free_after integer:=0;v_paid_after integer:=0;
  v_next timestamptz;v_pair boolean:=false;v_earned boolean:=false;v_used_paid boolean:=false;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  v_name:=left(regexp_replace(coalesce(trim(p_name),''),'[<>[:cntrl:]]','','g'),20);
  if v_name='' then v_name:='Spieler'; end if;
  v_name_norm:=translate(lower(regexp_replace(v_name,'[^[:alnum:]]','','g')),'äöüß','aous');
  if v_name_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then
    raise exception 'Dieser Name ist nicht erlaubt. Bitte wähle einen respektvollen Anzeigenamen.';
  end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,v_name,10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.free_spins<2 and v_row.next_free_spin_at is not null and now()>=v_row.next_free_spin_at then
    v_refills:=1+floor(extract(epoch from (now()-v_row.next_free_spin_at))/30)::integer;
    v_free_after:=least(2,v_row.free_spins+v_refills);
    if v_free_after>=2 then v_next:=null;
    else v_next:=v_row.next_free_spin_at+(v_refills*interval '30 seconds'); end if;
    update public.online_slot_scores as score set free_spins=v_free_after,next_free_spin_at=v_next,updated_at=now()
      where score.player_id=v_uid returning score.* into v_row;
  end if;
  v_free_after:=v_row.free_spins;v_paid_after:=v_row.paid_spins;v_next:=v_row.next_free_spin_at;
  -- Use bought spins first. The free pool recharges independently and never exceeds two.
  if v_paid_after>0 then
    v_paid_after:=v_paid_after-1;v_used_paid:=true;
  elsif v_free_after>0 then
    v_free_after:=v_free_after-1;
  else
    raise exception 'Keine Spins verfügbar. Ein Freispiel lädt alle 30 Sekunden nach, oder kaufe virtuelle Spins mit Coins.';
  end if;
  if not v_used_paid and v_free_after<2 and v_next is null then v_next:=now()+interval '30 seconds'; end if;
  v_one:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
  v_two:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
  v_three:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
  v_pair:=(v_one=v_two or v_one=v_three or v_two=v_three);
  if v_one=v_two and v_two=v_three and v_one='⭐' then v_base_award:=1000;
  elsif v_one=v_two and v_two=v_three and v_one='🍓' then v_base_award:=750;
  elsif v_one=v_two and v_two=v_three and v_one='7️⃣' then v_base_award:=500;
  elsif v_one=v_two and v_two=v_three then v_base_award:=100;
  elsif v_pair then v_base_award:=15;
  else v_base_award:=0; end if;
  -- Each step adds exactly 0.1 percentage points (5 Coins per step); fractional bonuses accumulate
  -- into coin_fraction so small wins still benefit instead of getting rounded away every spin.
  v_bonus_total:=coalesce(v_row.coin_fraction,0)+(v_base_award::numeric*v_row.multiplier_steps::numeric/1000);
  v_award:=v_base_award+floor(v_bonus_total)::integer;
  v_fraction_after:=v_bonus_total-floor(v_bonus_total);
  -- Two matching symbols give a free spin when the capped pool has room.
  if v_pair and v_free_after<2 then
    v_free_after:=v_free_after+1;v_earned:=true;
    if v_free_after>=2 then v_next:=null;
    elsif v_next is null then v_next:=now()+interval '30 seconds'; end if;
  end if;
  if v_free_after>=2 then v_next:=null;
  elsif v_free_after=0 and v_next is null then v_next:=now()+interval '30 seconds'; end if;
  update public.online_slot_scores as score
    set display_name=v_name,
        total_points=least(score.total_points+v_award,1000000000),
        coin_fraction=v_fraction_after,
        spins=least(score.spins+1,1000000000),
        free_spins=v_free_after,paid_spins=v_paid_after,next_free_spin_at=v_next,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_one,v_two,v_three,v_award,v_base_award,v_row.total_points,v_row.spins,v_row.display_name,
    v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_earned;
end;
$$;

revoke all on function public.get_slot_profile() from public,anon;
revoke all on function public.buy_slot_spins(integer) from public,anon;
revoke all on function public.buy_slot_multiplier_step() from public,anon;
revoke all on function public.buy_slot_shop_item(text) from public,anon;
revoke all on function public.spin_slot_machine(text) from public,anon;
grant execute on function public.get_slot_profile() to authenticated;
grant execute on function public.buy_slot_spins(integer) to authenticated;
grant execute on function public.buy_slot_multiplier_step() to authenticated;
grant execute on function public.buy_slot_shop_item(text) to authenticated;
grant execute on function public.spin_slot_machine(text) to authenticated;
notify pgrst,'reload schema';
