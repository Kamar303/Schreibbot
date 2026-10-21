-- Handschrift Arcade v49
-- Run AFTER supabase_slot_machine_setup.sql, supabase_slot_machine_update_v30.sql and supabase_slot_machine_update_v39.sql.
-- Existing gameplay and coins are virtual only. No payments or cash-out are added.
-- Rules: streak multipliers are x1, x4, x16, x64...; ten logo clicks unlock a permanent x5 marker.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Ensure all columns used by the v49 game exist, whether the project began at v39 or has partial later changes.
alter table public.online_slot_scores
  add column if not exists free_spins integer not null default 2,
  add column if not exists paid_spins integer not null default 0,
  add column if not exists next_free_spin_at timestamptz,
  add column if not exists multiplier_steps integer not null default 0,
  add column if not exists coin_fraction numeric(12,6) not null default 0,
  add column if not exists inventory text[] not null default '{}'::text[],
  add column if not exists jackpot_spins integer not null default 0,
  add column if not exists win_streak integer not null default 0,
  add column if not exists streak_points integer not null default 0,
  add column if not exists pending_double_amount integer not null default 0,
  add column if not exists is_op boolean not null default false,
  add column if not exists logo_v49_click_count integer not null default 0,
  add column if not exists logo_multiplier_x5_claimed boolean not null default false;

update public.online_slot_scores set
  free_spins=least(greatest(coalesce(free_spins,0),0),2),
  paid_spins=least(greatest(coalesce(paid_spins,0),0),1000000),
  multiplier_steps=0,
  coin_fraction=0,
  inventory=coalesce(inventory,'{}'::text[]),
  jackpot_spins=least(greatest(coalesce(jackpot_spins,0),0),10000),
  win_streak=least(greatest(coalesce(win_streak,0),0),1000),
  streak_points=least(greatest(coalesce(streak_points,0),0),1000000),
  pending_double_amount=least(greatest(coalesce(pending_double_amount,0),0),1000000000),
  logo_v49_click_count=least(greatest(coalesce(logo_v49_click_count,0),0),10)
where true;

-- Retire the old x4 shop marker. If an earlier test build already granted x5, keep it as claimed.
update public.online_slot_scores score set
  inventory=case when score.logo_multiplier_x5_claimed or 'multiplier_x5'=any(coalesce(score.inventory,'{}'::text[]))
    then array_append(array_remove(array_remove(coalesce(score.inventory,'{}'::text[]),'multiplier_x4'),'multiplier_x5'),'multiplier_x5')
    else array_remove(coalesce(score.inventory,'{}'::text[]),'multiplier_x4') end,
  logo_v49_click_count=case when score.logo_multiplier_x5_claimed or 'multiplier_x5'=any(coalesce(score.inventory,'{}'::text[])) then 10 else score.logo_v49_click_count end,
  logo_multiplier_x5_claimed=(score.logo_multiplier_x5_claimed or 'multiplier_x5'=any(coalesce(score.inventory,'{}'::text[]))),
  multiplier_steps=0,coin_fraction=0;

alter table public.online_slot_scores drop constraint if exists online_slot_scores_free_spins_check;
alter table public.online_slot_scores add constraint online_slot_scores_free_spins_check check (free_spins between 0 and 2);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_paid_spins_check;
alter table public.online_slot_scores add constraint online_slot_scores_paid_spins_check check (paid_spins between 0 and 1000000);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_multiplier_steps_check;
alter table public.online_slot_scores add constraint online_slot_scores_multiplier_steps_check check (multiplier_steps = 0);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_coin_fraction_check;
alter table public.online_slot_scores add constraint online_slot_scores_coin_fraction_check check (coin_fraction >= 0 and coin_fraction < 1);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_jackpot_spins_check;
alter table public.online_slot_scores add constraint online_slot_scores_jackpot_spins_check check (jackpot_spins between 0 and 10000);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_win_streak_check;
alter table public.online_slot_scores add constraint online_slot_scores_win_streak_check check (win_streak between 0 and 1000);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_streak_points_check;
alter table public.online_slot_scores add constraint online_slot_scores_streak_points_check check (streak_points between 0 and 1000000);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_pending_double_amount_check;
alter table public.online_slot_scores add constraint online_slot_scores_pending_double_amount_check check (pending_double_amount between 0 and 1000000000);
alter table public.online_slot_scores drop constraint if exists online_slot_scores_logo_v49_click_count_check;
alter table public.online_slot_scores add constraint online_slot_scores_logo_v49_click_count_check check (logo_v49_click_count between 0 and 10);

create table if not exists public.slot_redeem_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  reward_type text not null check (reward_type in ('op','coins','jackpot','spins')),
  reward_value integer not null check (reward_value > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.online_slot_code_redemptions (
  player_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null references public.slot_redeem_codes(code_hash),
  redeemed_at timestamptz not null default now(),
  primary key (player_id,code_hash)
);
alter table public.slot_redeem_codes enable row level security;
alter table public.online_slot_code_redemptions enable row level security;
revoke all on table public.slot_redeem_codes from public,anon,authenticated;
revoke all on table public.online_slot_code_redemptions from public,anon,authenticated;

-- Re-activate the shipped codes; hashes are SHA-256 of their lowercase spelling including hyphens.
insert into public.slot_redeem_codes(code_hash,reward_type,reward_value,is_active) values
 ('a3b0ddca71cfbe25fe6df58baa2b7650739af951130ae98ba36396b199146709','op',1,true),
 ('8c019224ba3a2433937760235abc9f85ed13835a940ae99dad28484199c7119e','coins',10000,true),
 ('22cfcc5fd4d85caeb56c2ce3abaa945d80b2f7cce51a7947f969da7419a46722','jackpot',2,true),
 ('7e476326318379a10767d6058c6f7f0d360d97a479628feb2257111896fcc784','spins',100,true)
on conflict(code_hash) do update set reward_type=excluded.reward_type,reward_value=excluded.reward_value,is_active=true;

-- Drop previous RPCs whose table return shapes are being extended.
drop function if exists public.spin_slot_machine(text);
drop function if exists public.get_slot_profile();
drop function if exists public.buy_slot_spins(integer);
drop function if exists public.buy_slot_multiplier_step();
drop function if exists public.buy_slot_shop_item(text);
drop function if exists public.register_slot_logo_click();
drop function if exists public.redeem_slot_code(text);
drop function if exists public.resolve_slot_double_or_nothing(text);
drop function if exists public.decline_slot_double_or_nothing();
drop function if exists public.grant_slot_op_reward(text);

create function public.get_slot_profile()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],jackpot_spins integer,
  win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;v_refills integer:=0;v_next timestamptz;v_free integer;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,coin_fraction,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.free_spins<2 and v_row.next_free_spin_at is not null and now()>=v_row.next_free_spin_at then
    v_refills:=1+floor(extract(epoch from (now()-v_row.next_free_spin_at))/30)::integer;
    v_free:=least(2,v_row.free_spins+v_refills);
    if v_free>=2 then v_next:=null; else v_next:=v_row.next_free_spin_at+(v_refills*interval '30 seconds'); end if;
    update public.online_slot_scores score set free_spins=v_free,next_free_spin_at=v_next,updated_at=now()
      where score.player_id=v_uid returning score.* into v_row;
  end if;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,
    v_row.next_free_spin_at,0,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,
    v_row.pending_double_amount,v_row.is_op,v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed;
end;
$$;

create function public.buy_slot_spins(p_quantity integer)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],jackpot_spins integer,
  win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_price bigint;v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.'; end if;
  if p_quantity=1 then v_price:=50;elsif p_quantity=3 then v_price:=125;else raise exception 'Wähle einen Spin oder das Dreierpaket.';end if;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found then
    insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,multiplier_steps,coin_fraction,inventory,updated_at)
      values(v_uid,'Spieler',10,0,2,0,0,0,'{}'::text[],now()) returning * into v_row;
  end if;
  if v_row.total_points<v_price then raise exception 'Dafür reichen deine Coins nicht.';end if;
  if v_row.paid_spins+p_quantity>1000000 then raise exception 'Dein Spin-Vorrat ist voll.';end if;
  update public.online_slot_scores score set total_points=score.total_points-v_price,paid_spins=score.paid_spins+p_quantity,multiplier_steps=0,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed;
end;
$$;

create function public.buy_slot_shop_item(p_item_id text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],jackpot_spins integer,
  win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_price bigint;v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.';end if;
  case p_item_id
    when 'golden_pen' then v_price:=150;
    when 'neon_studio' then v_price:=500;
    when 'bugatti' then v_price:=2500;
    when 'yacht' then v_price:=4000;
    when 'helicopter' then v_price:=7500;
    when 'hypercar' then v_price:=10000;
    when 'dragon' then v_price:=12500;
    when 'private_jet' then v_price:=15000;
    when 'gaming_villa' then v_price:=25000;
    when 'moon_base' then v_price:=50000;
    when 'private_island' then v_price:=100000;
    else raise exception 'Dieses Sammlerstück gibt es nicht im Shop.';
  end case;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found then
    insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,multiplier_steps,coin_fraction,inventory,updated_at)
      values(v_uid,'Spieler',10,0,2,0,0,0,'{}'::text[],now()) returning * into v_row;
  end if;
  if p_item_id=any(coalesce(v_row.inventory,'{}'::text[])) then raise exception 'Diesen Gegenstand besitzt du bereits.';end if;
  if v_row.total_points<v_price then raise exception 'Dafür reichen deine Coins nicht.';end if;
  update public.online_slot_scores score set total_points=score.total_points-v_price,inventory=array_append(coalesce(score.inventory,'{}'::text[]),p_item_id),multiplier_steps=0,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed;
end;
$$;

create function public.spin_slot_machine(p_name text)
returns table(
  reel_one text,reel_two text,reel_three text,points_awarded integer,base_points_awarded integer,
  total_points bigint,spins bigint,display_name text,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],free_spin_earned boolean,coins_lost integer,jackpot_spins integer,
  win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();v_symbols text[]:=array['🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
  v_one text;v_two text;v_three text;v_base integer:=0;v_award integer:=0;v_loss integer:=0;v_factor numeric:=1;
  v_name text;v_name_norm text;v_row public.online_slot_scores%rowtype;v_refills integer:=0;v_free integer:=0;v_paid integer:=0;v_jackpot integer:=0;v_next timestamptz;
  v_pair boolean:=false;v_free_earned boolean:=false;v_used_paid boolean:=false;v_streak integer:=0;v_streak_gain integer:=0;v_pending integer:=0;v_room bigint;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.';end if;
  v_name:=left(regexp_replace(coalesce(trim(p_name),''),'[<>[:cntrl:]]','','g'),20);if v_name='' then v_name:='Spieler';end if;
  v_name_norm:=translate(lower(regexp_replace(v_name,'[^[:alnum:]]','','g')),'äöüß','aous');
  if v_name_norm~'(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then raise exception 'Dieser Name ist nicht erlaubt.';end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,coin_fraction,inventory,updated_at)
    values(v_uid,v_name,10,0,2,0,null,0,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if coalesce(v_row.pending_double_amount,0)>=500 then raise exception 'Bitte zuerst Doppelt oder Nichts auflösen oder ablehnen.';end if;
  if v_row.free_spins<2 and v_row.next_free_spin_at is not null and now()>=v_row.next_free_spin_at then
    v_refills:=1+floor(extract(epoch from(now()-v_row.next_free_spin_at))/30)::integer;v_free:=least(2,v_row.free_spins+v_refills);
    if v_free>=2 then v_next:=null;else v_next:=v_row.next_free_spin_at+(v_refills*interval '30 seconds');end if;
    update public.online_slot_scores score set free_spins=v_free,next_free_spin_at=v_next,updated_at=now() where score.player_id=v_uid returning score.* into v_row;
  end if;
  v_free:=v_row.free_spins;v_paid:=v_row.paid_spins;v_next:=v_row.next_free_spin_at;v_jackpot:=v_row.jackpot_spins;
  if v_paid>0 then v_paid:=v_paid-1;v_used_paid:=true;elsif v_free>0 then v_free:=v_free-1;else raise exception 'Keine Spins verfügbar.';end if;
  if not v_used_paid and v_free<2 and v_next is null then v_next:=now()+interval '30 seconds';end if;
  if v_jackpot>0 then v_one:='⭐';v_two:='⭐';v_three:='⭐';v_jackpot:=v_jackpot-1;
  else
    v_one:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
    v_two:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
    v_three:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
  end if;
  v_pair:=(v_one=v_two or v_one=v_three or v_two=v_three);
  if v_one=v_two and v_two=v_three and v_one='⭐' then v_base:=1500;
  elsif v_one=v_two and v_two=v_three and v_one='🍓' then v_base:=1000;
  elsif v_one=v_two and v_two=v_three and v_one='7️⃣' then v_base:=750;
  elsif v_one=v_two and v_two=v_three then v_base:=150;
  elsif v_pair then v_base:=25;else v_base:=0;end if;
  if v_base>0 then
    v_streak:=least(coalesce(v_row.win_streak,0)+1,1000);v_streak_gain:=least(v_streak,3);
    v_factor:=power(4::numeric,greatest(v_streak-1,0));
    if 'multiplier_x5'=any(coalesce(v_row.inventory,'{}'::text[])) then v_factor:=v_factor*5;end if;
    v_room:=greatest(1000000000::bigint-v_row.total_points,0);
    v_award:=least(v_base::numeric*v_factor,v_room::numeric)::integer;
    if v_award>=500 then v_pending:=v_award;end if;
  else
    v_streak:=0;v_streak_gain:=0;v_award:=0;v_pending:=0;
    if v_row.total_points>0 then v_loss:=least(v_row.total_points::integer,greatest(1,round(5*power(greatest(v_row.total_points,1)::numeric/100,0.6989700043360189))::integer));end if;
  end if;
  if v_pair and v_free<2 then v_free:=v_free+1;v_free_earned:=true;if v_free>=2 then v_next:=null;elsif v_next is null then v_next:=now()+interval '30 seconds';end if;end if;
  if v_free>=2 then v_next:=null;elsif v_free=0 and v_next is null then v_next:=now()+interval '30 seconds';end if;
  update public.online_slot_scores score set display_name=v_name,total_points=least(greatest(score.total_points+v_award-v_loss,0),1000000000),
    spins=least(score.spins+1,1000000000),free_spins=v_free,paid_spins=v_paid,next_free_spin_at=v_next,multiplier_steps=0,coin_fraction=0,
    jackpot_spins=v_jackpot,win_streak=v_streak,streak_points=least(score.streak_points+v_streak_gain,1000000),
    pending_double_amount=v_pending,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_one,v_two,v_three,v_award,v_base,v_row.total_points,v_row.spins,v_row.display_name,v_row.free_spins,v_row.paid_spins,
    v_row.next_free_spin_at,0,v_row.inventory,v_free_earned,v_loss,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,
    v_row.pending_double_amount,v_row.is_op,v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed;
end;
$$;

create function public.register_slot_logo_click()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,streak_points integer,pending_double_amount integer,
  is_op boolean,logo_v49_click_count integer,logo_multiplier_x5_claimed boolean,multiplier_x5_unlocked boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;v_clicks integer;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Aktiviere Anonymous Sign-Ins.';end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,coin_fraction,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not coalesce(v_row.logo_multiplier_x5_claimed,false) then
    v_clicks:=least(greatest(coalesce(v_row.logo_v49_click_count,0),0)+1,10);
    update public.online_slot_scores score set logo_v49_click_count=v_clicks,logo_multiplier_x5_claimed=(v_clicks>=10),
      inventory=case when v_clicks>=10 then array_append(array_remove(coalesce(score.inventory,'{}'::text[]),'multiplier_x4'),'multiplier_x5') else array_remove(coalesce(score.inventory,'{}'::text[]),'multiplier_x4') end,
      multiplier_steps=0,coin_fraction=0,updated_at=now()
      where score.player_id=v_uid returning score.* into v_row;
  end if;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed,('multiplier_x5'=any(coalesce(v_row.inventory,'{}'::text[])));
end;
$$;

create function public.redeem_slot_code(p_code text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean,reward_type text,reward_value integer
)
language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();v_norm text:=lower(regexp_replace(coalesce(p_code,''),'[^a-zA-Z0-9]','','g'));
  v_hash text;v_code public.slot_redeem_codes%rowtype;v_row public.online_slot_scores%rowtype;v_inserted integer;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Aktiviere Anonymous Sign-Ins.';end if;
  v_hash:=case v_norm
    when 'arcadeopx7k9m4q2' then 'a3b0ddca71cfbe25fe6df58baa2b7650739af951130ae98ba36396b199146709'
    when 'arcade10kp8n3r6v2' then '8c019224ba3a2433937760235abc9f85ed13835a940ae99dad28484199c7119e'
    when 'arcadejackpotx2h5c9' then '22cfcc5fd4d85caeb56c2ce3abaa945d80b2f7cce51a7947f969da7419a46722'
    when 'arcadefreespin100t4w8' then '7e476326318379a10767d6058c6f7f0d360d97a479628feb2257111896fcc784'
    else null end;
  if v_hash is null then raise exception 'Der Code ist ungültig oder nicht mehr aktiv.';end if;
  select * into v_code from public.slot_redeem_codes c where c.code_hash=v_hash and c.is_active;
  if not found then raise exception 'Der Code ist ungültig oder nicht mehr aktiv.';end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,coin_fraction,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  insert into public.online_slot_code_redemptions(player_id,code_hash) values(v_uid,v_hash) on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then raise exception 'Dieser Code wurde für dieses Spielerprofil bereits eingelöst.';end if;
  update public.online_slot_scores score set
    is_op=case when v_code.reward_type='op' then true else score.is_op end,
    total_points=least(score.total_points+case when v_code.reward_type='coins' then v_code.reward_value else 0 end,1000000000),
    jackpot_spins=least(score.jackpot_spins+case when v_code.reward_type='jackpot' then v_code.reward_value else 0 end,10000),
    paid_spins=least(score.paid_spins+case when v_code.reward_type='spins' then v_code.reward_value else 0 end,1000000),updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed,v_code.reward_type,v_code.reward_value;
end;
$$;

create function public.resolve_slot_double_or_nothing(p_choice text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean,won boolean,coin_face text,wager integer
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;v_face text;v_wager integer;v_won boolean;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.';end if;
  if lower(trim(coalesce(p_choice,''))) not in ('kopf','zahl') then raise exception 'Wähle Kopf oder Zahl.';end if;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found then raise exception 'Kein Arcade-Profil gefunden.';end if;
  v_wager:=v_row.pending_double_amount;if v_wager<500 then raise exception 'Kein offener Gewinn ab 500 Coins vorhanden.';end if;
  v_face:=case when random()<0.5 then 'kopf' else 'zahl' end;v_won:=lower(trim(p_choice))=v_face;
  update public.online_slot_scores score set total_points=least(greatest(score.total_points+case when v_won then v_wager else -v_wager end,0),1000000000),pending_double_amount=0,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed,v_won,v_face,v_wager;
end;
$$;

create function public.decline_slot_double_or_nothing()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean,declined_amount integer
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;v_amount integer;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.';end if;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found then raise exception 'Kein Arcade-Profil gefunden.';end if;
  v_amount:=coalesce(v_row.pending_double_amount,0);if v_amount<500 then raise exception 'Kein offener Münzwurf zum Ablehnen.';end if;
  update public.online_slot_scores score set pending_double_amount=0,updated_at=now() where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed,v_amount;
end;
$$;

create function public.grant_slot_op_reward(p_reward_type text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.';end if;
  if p_reward_type not in ('coins','jackpot','spins') then raise exception 'Diese OP-Belohnung ist nicht erlaubt.';end if;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found or not v_row.is_op then raise exception 'OP-Rechte fehlen.';end if;
  update public.online_slot_scores score set
    total_points=least(score.total_points+case when p_reward_type='coins' then 10000 else 0 end,1000000000),
    jackpot_spins=least(score.jackpot_spins+case when p_reward_type='jackpot' then 2 else 0 end,10000),
    paid_spins=least(score.paid_spins+case when p_reward_type='spins' then 100 else 0 end,1000000),updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed;
end;
$$;

revoke all on function public.get_slot_profile() from public,anon;
revoke all on function public.buy_slot_spins(integer) from public,anon;
revoke all on function public.buy_slot_shop_item(text) from public,anon;
revoke all on function public.spin_slot_machine(text) from public,anon;
revoke all on function public.register_slot_logo_click() from public,anon;
revoke all on function public.redeem_slot_code(text) from public,anon;
revoke all on function public.resolve_slot_double_or_nothing(text) from public,anon;
revoke all on function public.decline_slot_double_or_nothing() from public,anon;
revoke all on function public.grant_slot_op_reward(text) from public,anon;
grant execute on function public.get_slot_profile() to authenticated;
grant execute on function public.buy_slot_spins(integer) to authenticated;
grant execute on function public.buy_slot_shop_item(text) to authenticated;
grant execute on function public.spin_slot_machine(text) to authenticated;
grant execute on function public.register_slot_logo_click() to authenticated;
grant execute on function public.redeem_slot_code(text) to authenticated;
grant execute on function public.resolve_slot_double_or_nothing(text) to authenticated;
grant execute on function public.decline_slot_double_or_nothing() to authenticated;
grant execute on function public.grant_slot_op_reward(text) to authenticated;

notify pgrst,'reload schema';
commit;
