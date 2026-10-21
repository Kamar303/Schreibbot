-- Handschrift Arcade v40
-- Run AFTER supabase_slot_machine_setup.sql, supabase_slot_machine_update_v30.sql and supabase_slot_machine_update_v39.sql.
-- Coins, prizes, codes and collectibles are virtual only; this migration adds no payments or cash-out.

create extension if not exists pgcrypto with schema extensions;

alter table public.online_slot_scores
  add column if not exists jackpot_spins integer not null default 0,
  add column if not exists win_streak integer not null default 0,
  add column if not exists pending_double_amount integer not null default 0,
  add column if not exists is_op boolean not null default false;

-- Version 40 has a maximum 10x multiplier: base 1.0x + 18 upgrades of 0.5x.
alter table public.online_slot_scores drop constraint if exists online_slot_scores_multiplier_steps_check;
alter table public.online_slot_scores drop constraint if exists online_slot_scores_paid_spins_check;
alter table public.online_slot_scores drop constraint if exists online_slot_scores_jackpot_spins_check;
alter table public.online_slot_scores drop constraint if exists online_slot_scores_win_streak_check;
alter table public.online_slot_scores drop constraint if exists online_slot_scores_pending_double_amount_check;

update public.online_slot_scores set multiplier_steps=least(greatest(coalesce(multiplier_steps,0),0),18);
update public.online_slot_scores set paid_spins=least(greatest(coalesce(paid_spins,0),0),1000000);
update public.online_slot_scores set jackpot_spins=least(greatest(coalesce(jackpot_spins,0),0),10000);
update public.online_slot_scores set win_streak=least(greatest(coalesce(win_streak,0),0),1000);
update public.online_slot_scores set pending_double_amount=least(greatest(coalesce(pending_double_amount,0),0),1000000000);

alter table public.online_slot_scores add constraint online_slot_scores_multiplier_steps_check check (multiplier_steps between 0 and 18);
alter table public.online_slot_scores add constraint online_slot_scores_paid_spins_check check (paid_spins between 0 and 1000000);
alter table public.online_slot_scores add constraint online_slot_scores_jackpot_spins_check check (jackpot_spins between 0 and 10000);
alter table public.online_slot_scores add constraint online_slot_scores_win_streak_check check (win_streak between 0 and 1000);
alter table public.online_slot_scores add constraint online_slot_scores_pending_double_amount_check check (pending_double_amount between 0 and 1000000000);

create table if not exists public.slot_redeem_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  reward_type text not null check (reward_type in ('op','coins','jackpot','spins')),
  reward_value integer not null check (reward_value > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.online_slot_code_redemptions (
  player_id uuid not null,
  code_hash text not null references public.slot_redeem_codes(code_hash),
  redeemed_at timestamptz not null default now(),
  primary key (player_id, code_hash)
);
alter table public.slot_redeem_codes enable row level security;
alter table public.online_slot_code_redemptions enable row level security;
revoke all on table public.slot_redeem_codes from public, anon, authenticated;
revoke all on table public.online_slot_code_redemptions from public, anon, authenticated;

-- Only code hashes are stored. A code can be redeemed once per anonymous player profile.
insert into public.slot_redeem_codes(code_hash,reward_type,reward_value,is_active) values
 ('a3b0ddca71cfbe25fe6df58baa2b7650739af951130ae98ba36396b199146709','op',1,true),
 ('8c019224ba3a2433937760235abc9f85ed13835a940ae99dad28484199c7119e','coins',10000,true),
 ('22cfcc5fd4d85caeb56c2ce3abaa945d80b2f7cce51a7947f969da7419a46722','jackpot',2,true),
 ('7e476326318379a10767d6058c6f7f0d360d97a479628feb2257111896fcc784','spins',100,true)
on conflict (code_hash) do update set reward_type=excluded.reward_type,reward_value=excluded.reward_value,is_active=true;

-- RPC return shapes changed in v40. Recreate dependent functions.
drop function if exists public.spin_slot_machine(text);
drop function if exists public.get_slot_profile();
drop function if exists public.buy_slot_spins(integer);
drop function if exists public.buy_slot_multiplier_step();
drop function if exists public.buy_slot_shop_item(text);
drop function if exists public.redeem_slot_code(text);
drop function if exists public.resolve_slot_double_or_nothing(text);
drop function if exists public.grant_slot_op_reward(text);

create function public.get_slot_profile()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],
  jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean
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
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op;
end;
$$;

create function public.buy_slot_spins(p_quantity integer)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],
  jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid:=auth.uid(); v_price bigint; v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  if p_quantity=1 then v_price:=50; elsif p_quantity=3 then v_price:=125; else raise exception 'Wähle einen Spin oder das Paket mit drei Spins.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.total_points<v_price then raise exception 'Du brauchst % Coins für diesen Spin-Kauf.',v_price; end if;
  if v_row.paid_spins+p_quantity>1000000 then raise exception 'Dein Bonus-Spin-Vorrat ist voll.'; end if;
  update public.online_slot_scores score set total_points=score.total_points-v_price,paid_spins=score.paid_spins+p_quantity,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op;
end;
$$;

create function public.buy_slot_multiplier_step()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],
  jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid:=auth.uid(); v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.total_points<10 then raise exception 'Ein Multiplikator-Upgrade kostet 10 Coins.'; end if;
  if v_row.multiplier_steps>=18 then raise exception 'Der Coin-Multiplikator hat bereits das Maximum von 10,0x erreicht.'; end if;
  update public.online_slot_scores score set total_points=score.total_points-10,multiplier_steps=score.multiplier_steps+1,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op;
end;
$$;

create function public.buy_slot_shop_item(p_item_id text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],
  jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid:=auth.uid(); v_price bigint; v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
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
    else raise exception 'Dieses virtuelle Sammlerstück gibt es nicht im Shop.';
  end case;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if p_item_id=any(v_row.inventory) then raise exception 'Dieses Sammlerstück besitzt du bereits.'; end if;
  if v_row.total_points<v_price then raise exception 'Dafür reichen deine Arcade-Coins noch nicht.'; end if;
  update public.online_slot_scores score set total_points=score.total_points-v_price,inventory=array_append(score.inventory,p_item_id),updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op;
end;
$$;

create function public.spin_slot_machine(p_name text)
returns table(
  reel_one text,reel_two text,reel_three text,points_awarded integer,base_points_awarded integer,
  total_points bigint,spins bigint,display_name text,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],free_spin_earned boolean,
  coins_lost integer,jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_symbols text[]:=array['🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
  v_one text;v_two text;v_three text;v_base_award integer:=0;v_award integer:=0;v_streak_base integer:=0;v_coins_lost integer:=0;
  v_bonus_total numeric(18,6):=0;v_fraction_after numeric(12,6):=0;v_name text;v_name_norm text;
  v_row public.online_slot_scores%rowtype;v_refills integer:=0;v_free_after integer:=0;v_paid_after integer:=0;v_jackpot_after integer:=0;
  v_next timestamptz;v_pair boolean:=false;v_earned boolean:=false;v_used_paid boolean:=false;v_streak integer:=0;v_pending_double integer:=0;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  v_name:=left(regexp_replace(coalesce(trim(p_name),''),'[<>[:cntrl:]]','','g'),20);if v_name='' then v_name:='Spieler';end if;
  v_name_norm:=translate(lower(regexp_replace(v_name,'[^[:alnum:]]','','g')),'äöüß','aous');
  if v_name_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then raise exception 'Dieser Name ist nicht erlaubt. Bitte wähle einen respektvollen Anzeigenamen.';end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,v_name,10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if v_row.free_spins<2 and v_row.next_free_spin_at is not null and now()>=v_row.next_free_spin_at then
    v_refills:=1+floor(extract(epoch from (now()-v_row.next_free_spin_at))/30)::integer;v_free_after:=least(2,v_row.free_spins+v_refills);
    if v_free_after>=2 then v_next:=null;else v_next:=v_row.next_free_spin_at+(v_refills*interval '30 seconds');end if;
    update public.online_slot_scores score set free_spins=v_free_after,next_free_spin_at=v_next,updated_at=now() where score.player_id=v_uid returning score.* into v_row;
  end if;
  v_free_after:=v_row.free_spins;v_paid_after:=v_row.paid_spins;v_next:=v_row.next_free_spin_at;v_jackpot_after:=v_row.jackpot_spins;
  if v_paid_after>0 then v_paid_after:=v_paid_after-1;v_used_paid:=true;elsif v_free_after>0 then v_free_after:=v_free_after-1;else raise exception 'Keine Spins verfügbar. Ein Freispiel lädt alle 30 Sekunden nach, oder nutze virtuelle Spins.';end if;
  if not v_used_paid and v_free_after<2 and v_next is null then v_next:=now()+interval '30 seconds';end if;
  if v_jackpot_after>0 then v_one:='⭐';v_two:='⭐';v_three:='⭐';v_jackpot_after:=v_jackpot_after-1;
  else
    v_one:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];v_two:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];v_three:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
  end if;
  v_pair:=(v_one=v_two or v_one=v_three or v_two=v_three);
  if v_one=v_two and v_two=v_three and v_one='⭐' then v_base_award:=1000;
  elsif v_one=v_two and v_two=v_three and v_one='🍓' then v_base_award:=750;
  elsif v_one=v_two and v_two=v_three and v_one='7️⃣' then v_base_award:=500;
  elsif v_one=v_two and v_two=v_three then v_base_award:=100;
  elsif v_pair then v_base_award:=15;else v_base_award:=0;end if;
  if v_base_award>0 then
    v_streak:=least(v_row.win_streak+1,1000);v_streak_base:=v_base_award*v_streak;
    v_bonus_total:=coalesce(v_row.coin_fraction,0)+(v_streak_base::numeric*v_row.multiplier_steps::numeric/2);
    v_award:=least(v_streak_base+floor(v_bonus_total)::integer,greatest(1000000000-v_row.total_points,0)::integer);
    v_fraction_after:=v_bonus_total-floor(v_bonus_total);
    if v_award>=500 then v_pending_double:=v_award;end if;
  else
    v_streak:=0;v_streak_base:=0;v_award:=0;v_fraction_after:=coalesce(v_row.coin_fraction,0);v_coins_lost:=least(v_row.total_points,15)::integer;v_pending_double:=0;
  end if;
  if v_pair and v_free_after<2 then v_free_after:=v_free_after+1;v_earned:=true;if v_free_after>=2 then v_next:=null;elsif v_next is null then v_next:=now()+interval '30 seconds';end if;end if;
  if v_free_after>=2 then v_next:=null;elsif v_free_after=0 and v_next is null then v_next:=now()+interval '30 seconds';end if;
  update public.online_slot_scores score set display_name=v_name,
    total_points=least(greatest(score.total_points+v_award-v_coins_lost,0),1000000000),coin_fraction=v_fraction_after,
    spins=least(score.spins+1,1000000000),free_spins=v_free_after,paid_spins=v_paid_after,next_free_spin_at=v_next,
    jackpot_spins=v_jackpot_after,win_streak=v_streak,pending_double_amount=v_pending_double,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_one,v_two,v_three,v_award,v_base_award,v_row.total_points,v_row.spins,v_row.display_name,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_earned,v_coins_lost,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op;
end;
$$;

create function public.resolve_slot_double_or_nothing(p_choice text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean,
  won boolean,coin_face text,wager integer
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;v_face text;v_wager integer;v_won boolean;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.';end if;
  if lower(trim(coalesce(p_choice,''))) not in ('kopf','zahl') then raise exception 'Wähle Kopf oder Zahl.';end if;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found then raise exception 'Kein Arcade-Profil gefunden.';end if;
  v_wager:=v_row.pending_double_amount;if v_wager<500 then raise exception 'Es gibt aktuell keinen Gewinn ab 500 Coins zum Verdoppeln.';end if;
  v_face:=case when random()<0.5 then 'kopf' else 'zahl' end;v_won:=lower(trim(p_choice))=v_face;
  update public.online_slot_scores score set total_points=least(greatest(score.total_points+case when v_won then v_wager else -v_wager end,0),1000000000),pending_double_amount=0,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op,v_won,v_face,v_wager;
end;
$$;

create function public.redeem_slot_code(p_code text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean,
  reward_type text,reward_value integer
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid:=auth.uid();v_hash text;v_code public.slot_redeem_codes%rowtype;v_row public.online_slot_scores%rowtype;v_inserted integer;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.';end if;
  v_hash:=encode(extensions.digest(lower(btrim(coalesce(p_code,''))),'sha256'),'hex');
  select * into v_code from public.slot_redeem_codes c where c.code_hash=v_hash and c.is_active;
  if not found then raise exception 'Der Code ist ungültig oder nicht mehr aktiv.';end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  insert into public.online_slot_code_redemptions(player_id,code_hash) values(v_uid,v_hash) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then raise exception 'Dieser Code wurde für dieses Spielerprofil bereits eingelöst.';end if;
  update public.online_slot_scores score set
    is_op=case when v_code.reward_type='op' then true else score.is_op end,
    total_points=least(score.total_points+case when v_code.reward_type='coins' then v_code.reward_value else 0 end,1000000000),
    jackpot_spins=least(score.jackpot_spins+case when v_code.reward_type='jackpot' then v_code.reward_value else 0 end,10000),
    paid_spins=least(score.paid_spins+case when v_code.reward_type='spins' then v_code.reward_value else 0 end,1000000),updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op,v_code.reward_type,v_code.reward_value;
end;
$$;

create function public.grant_slot_op_reward(p_reward_type text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.';end if;
  if p_reward_type not in ('coins','jackpot','spins') then raise exception 'Diese OP-Belohnung ist nicht verfügbar.';end if;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found or not v_row.is_op then raise exception 'OP-Rechte fehlen.';end if;
  update public.online_slot_scores score set
    total_points=least(score.total_points+case when p_reward_type='coins' then 10000 else 0 end,1000000000),
    jackpot_spins=least(score.jackpot_spins+case when p_reward_type='jackpot' then 2 else 0 end,10000),
    paid_spins=least(score.paid_spins+case when p_reward_type='spins' then 100 else 0 end,1000000),updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op;
end;
$$;

revoke all on function public.get_slot_profile() from public, anon;
revoke all on function public.buy_slot_spins(integer) from public, anon;
revoke all on function public.buy_slot_multiplier_step() from public, anon;
revoke all on function public.buy_slot_shop_item(text) from public, anon;
revoke all on function public.spin_slot_machine(text) from public, anon;
revoke all on function public.resolve_slot_double_or_nothing(text) from public, anon;
revoke all on function public.redeem_slot_code(text) from public, anon;
revoke all on function public.grant_slot_op_reward(text) from public, anon;
grant execute on function public.get_slot_profile() to authenticated;
grant execute on function public.buy_slot_spins(integer) to authenticated;
grant execute on function public.buy_slot_multiplier_step() to authenticated;
grant execute on function public.buy_slot_shop_item(text) to authenticated;
grant execute on function public.spin_slot_machine(text) to authenticated;
grant execute on function public.resolve_slot_double_or_nothing(text) to authenticated;
grant execute on function public.redeem_slot_code(text) to authenticated;
grant execute on function public.grant_slot_op_reward(text) to authenticated;

notify pgrst, 'reload schema';
