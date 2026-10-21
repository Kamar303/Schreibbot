-- Handschrift Arcade v46: repair code redemption, server-side 5-logo-click 100k bonus, and slightly improved base prizes.
-- Run this migration in the existing Supabase project after the previous slot setup/migrations (at least v45).
-- Coin multipliers remain removed; five logo clicks grant a one-time 100,000 virtual coin secret bonus per player profile.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.online_slot_scores
  add column if not exists logo_click_count integer not null default 0,
  add column if not exists logo_bonus_claimed boolean not null default false;

update public.online_slot_scores set logo_click_count=least(greatest(coalesce(logo_click_count,0),0),5)
  where logo_click_count<0 or logo_click_count>5 or logo_click_count is null;

-- Rebuild the registry tables idempotently. The four bundled code hashes are known exactly.
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

insert into public.slot_redeem_codes(code_hash,reward_type,reward_value,is_active) values
 ('a3b0ddca71cfbe25fe6df58baa2b7650739af951130ae98ba36396b199146709','op',1,true),
 ('8c019224ba3a2433937760235abc9f85ed13835a940ae99dad28484199c7119e','coins',10000,true),
 ('22cfcc5fd4d85caeb56c2ce3abaa945d80b2f7cce51a7947f969da7419a46722','jackpot',2,true),
 ('7e476326318379a10767d6058c6f7f0d360d97a479628feb2257111896fcc784','spins',100,true)
on conflict (code_hash) do update set reward_type=excluded.reward_type,reward_value=excluded.reward_value,is_active=true;

create or replace function public.spin_slot_machine(p_name text)
returns table(
  reel_one text,reel_two text,reel_three text,points_awarded integer,base_points_awarded integer,
  total_points bigint,spins bigint,display_name text,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],free_spin_earned boolean,
  coins_lost integer,jackpot_spins integer,win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_symbols text[]:=array['🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
  v_one text;v_two text;v_three text;v_base_award integer:=0;v_award integer:=0;v_coins_lost integer:=0;
  v_bonus_total numeric(18,6):=0;v_fraction_after numeric(12,6):=0;v_name text;v_name_norm text;
  v_row public.online_slot_scores%rowtype;v_refills integer:=0;v_free_after integer:=0;v_paid_after integer:=0;v_jackpot_after integer:=0;
  v_next timestamptz;v_pair boolean:=false;v_earned boolean:=false;v_used_paid boolean:=false;v_streak integer:=0;v_pending_double integer:=0;v_streak_points_gain integer:=0;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  v_name:=left(regexp_replace(coalesce(trim(p_name),''),'[<>[:cntrl:]]','','g'),20);if v_name='' then v_name:='Spieler';end if;
  v_name_norm:=translate(lower(regexp_replace(v_name,'[^[:alnum:]]','','g')),'äöüß','aous');
  if v_name_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then raise exception 'Dieser Name ist nicht erlaubt. Bitte wähle einen respektvollen Anzeigenamen.';end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,v_name,10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if coalesce(v_row.pending_double_amount,0)>=500 then raise exception 'Bitte zuerst Doppelt oder Nichts auflösen, bevor du erneut drehst.'; end if;
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
  if v_one=v_two and v_two=v_three and v_one='⭐' then v_base_award:=1500;
  elsif v_one=v_two and v_two=v_three and v_one='🍓' then v_base_award:=1000;
  elsif v_one=v_two and v_two=v_three and v_one='7️⃣' then v_base_award:=750;
  elsif v_one=v_two and v_two=v_three then v_base_award:=150;
  elsif v_pair then v_base_award:=25;else v_base_award:=0;end if;
  if v_base_award>0 then
    -- No multiplier at all: each winning combination pays exactly its base value.
    v_streak:=least(v_row.win_streak+1,1000);
    v_streak_points_gain:=least(v_streak,3); -- Streak points are cosmetic only and never multiply coin prizes.
    v_award:=least(v_base_award,greatest(1000000000-v_row.total_points,0)::integer);
    v_fraction_after:=coalesce(v_row.coin_fraction,0);
    if v_award>=500 then v_pending_double:=v_award;end if;
  else
    v_streak:=0;v_award:=0;v_streak_points_gain:=0;v_fraction_after:=coalesce(v_row.coin_fraction,0);
    -- Keep the current moderate balance-scaled loss from v44.
    v_coins_lost:=least(v_row.total_points::integer,greatest(1,round(5 * power(greatest(v_row.total_points,1)::numeric / 100,0.6989700043360189))::integer));
    v_pending_double:=0;
  end if;
  if v_pair and v_free_after<2 then v_free_after:=v_free_after+1;v_earned:=true;if v_free_after>=2 then v_next:=null;elsif v_next is null then v_next:=now()+interval '30 seconds';end if;end if;
  if v_free_after>=2 then v_next:=null;elsif v_free_after=0 and v_next is null then v_next:=now()+interval '30 seconds';end if;
  update public.online_slot_scores score set display_name=v_name,
    total_points=least(greatest(score.total_points+v_award-v_coins_lost,0),1000000000),coin_fraction=v_fraction_after,
    spins=least(score.spins+1,1000000000),free_spins=v_free_after,paid_spins=v_paid_after,next_free_spin_at=v_next,
    jackpot_spins=v_jackpot_after,win_streak=v_streak,streak_points=least(score.streak_points+v_streak_points_gain,1000000),pending_double_amount=v_pending_double,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_one,v_two,v_three,v_award,v_base_award,v_row.total_points,v_row.spins,v_row.display_name,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_earned,v_coins_lost,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op;
end;
$$;

-- One bonus per profile. The counter is locked server-side, so five rapid taps cannot race or duplicate rewards.
drop function if exists public.register_slot_logo_click();
create function public.register_slot_logo_click()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],jackpot_spins integer,
  win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_click_count integer,logo_bonus_claimed boolean,bonus_awarded integer
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_row public.online_slot_scores%rowtype;
  v_clicks integer;
  v_bonus integer:=0;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at,logo_click_count,logo_bonus_claimed)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now(),0,false) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not coalesce(v_row.logo_bonus_claimed,false) then
    v_clicks:=least(greatest(coalesce(v_row.logo_click_count,0),0)+1,5);
    if v_clicks>=5 then v_bonus:=100000; end if;
    update public.online_slot_scores score set
      logo_click_count=v_clicks,
      logo_bonus_claimed=(v_bonus>0),
      total_points=least(score.total_points+v_bonus,1000000000),
      updated_at=now()
      where score.player_id=v_uid returning score.* into v_row;
  end if;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,
    v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,
    v_row.streak_points,v_row.pending_double_amount,v_row.is_op,v_row.logo_click_count,v_row.logo_bonus_claimed,v_bonus;
end;
$$;

-- Normalize punctuation, hyphens and whitespace so copied/pasted variants of the built-in codes still match.
drop function if exists public.redeem_slot_code(text);
create function public.redeem_slot_code(p_code text)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,pending_double_amount integer,is_op boolean,
  reward_type text,reward_value integer
)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_code_text text:=lower(regexp_replace(coalesce(p_code,''),'[^a-zA-Z0-9]','','g'));
  v_hash text;
  v_code public.slot_redeem_codes%rowtype;
  v_row public.online_slot_scores%rowtype;
  v_inserted integer;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Aktiviere Anonymous Sign-Ins in Supabase und lade die Website neu.'; end if;
  v_hash:=case v_code_text
    when 'arcadeopx7k9m4q2' then 'a3b0ddca71cfbe25fe6df58baa2b7650739af951130ae98ba36396b199146709'
    when 'arcade10kp8n3r6v2' then '8c019224ba3a2433937760235abc9f85ed13835a940ae99dad28484199c7119e'
    when 'arcadejackpotx2h5c9' then '22cfcc5fd4d85caeb56c2ce3abaa945d80b2f7cce51a7947f969da7419a46722'
    when 'arcadefreespin100t4w8' then '7e476326318379a10767d6058c6f7f0d360d97a479628feb2257111896fcc784'
    else null end;
  if v_hash is null then
    begin
      execute 'select encode(digest($1, ''sha256''), ''hex'')' into v_hash using lower(btrim(coalesce(p_code,'')));
    exception when undefined_function then
      raise exception 'Der Code ist ungültig oder nicht mehr aktiv.';
    end;
  end if;
  select * into v_code from public.slot_redeem_codes c where c.code_hash=v_hash and c.is_active;
  if not found then raise exception 'Der Code ist ungültig oder nicht mehr aktiv.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  insert into public.online_slot_code_redemptions(player_id,code_hash) values(v_uid,v_hash) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then raise exception 'Dieser Code wurde für dieses Spielerprofil bereits eingelöst.'; end if;
  update public.online_slot_scores score set
    is_op=case when v_code.reward_type='op' then true else score.is_op end,
    total_points=least(score.total_points+case when v_code.reward_type='coins' then v_code.reward_value else 0 end,1000000000),
    jackpot_spins=least(score.jackpot_spins+case when v_code.reward_type='jackpot' then v_code.reward_value else 0 end,10000),
    paid_spins=least(score.paid_spins+case when v_code.reward_type='spins' then v_code.reward_value else 0 end,1000000),updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,
    v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op,
    v_code.reward_type,v_code.reward_value;
end;
$$;

revoke all on function public.spin_slot_machine(text) from public, anon;
revoke all on function public.register_slot_logo_click() from public, anon;
revoke all on function public.redeem_slot_code(text) from public, anon;
grant execute on function public.spin_slot_machine(text) to authenticated;
grant execute on function public.register_slot_logo_click() to authenticated;
grant execute on function public.redeem_slot_code(text) to authenticated;

notify pgrst, 'reload schema';
commit;
