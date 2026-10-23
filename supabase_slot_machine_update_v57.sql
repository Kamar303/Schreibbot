-- Schreibbot Slot Arcade v57
-- Spin packs: 1 spin => +1,000 bonus, 2 spins => +2,000 total, 3-spin pack => +10,500 total.
-- Purchased spin bonuses are queued in purchase order; pre-v57 paid spins retain their old +3,500 bonus.
-- Main Goodnotes export uses a standard PDF rendered from the exact website page canvases.
-- Run after supabase_slot_machine_update_v56.sql. Coins remain virtual; no cash-out.
begin;

alter table public.online_slot_scores
  add column if not exists paid_spin_bonus_queue integer[] not null default '{}'::integer[],
  add column if not exists paid_spin_legacy_3500 integer not null default 0,
  add column if not exists paid_spin_bonus_v57_initialized boolean not null default false;

-- Preserve legacy paid spins without creating a huge array if someone banked many spins.
-- The marker makes the one-time migration backfill safe if this SQL is accidentally run again.
update public.online_slot_scores
set paid_spin_legacy_3500 = case
      when paid_spin_legacy_3500 = 0 and cardinality(paid_spin_bonus_queue) = 0 then greatest(paid_spin_legacy_3500,paid_spins)
      else paid_spin_legacy_3500
    end,
    paid_spin_bonus_v57_initialized = true
where not paid_spin_bonus_v57_initialized;

alter table public.online_slot_scores
  alter column paid_spin_bonus_v57_initialized set default true;

drop function if exists public.spin_slot_machine(text);

create function public.spin_slot_machine(p_name text)
returns table(
  reel_one text,reel_two text,reel_three text,points_awarded integer,base_points_awarded integer,
  total_points bigint,spins bigint,display_name text,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],free_spin_earned boolean,coins_lost integer,jackpot_spins integer,
  win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean,paid_spin_bonus_awarded integer
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reel1 text[] := array['🌌','🍒','🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
  v_reel2 text[] := array['🌌','🍒','🍓','🍋','🍊','🍉','🍇','⭐','⭐','7️⃣'];
  v_reel3 text[] := array_fill('🌌'::text,ARRAY[1]) || array_fill('🍒'::text,ARRAY[25]) || array_fill('🍓'::text,ARRAY[7]) || array_fill('🍋'::text,ARRAY[20]) || array_fill('🍊'::text,ARRAY[18]) || array_fill('🍉'::text,ARRAY[14]) || array_fill('🍇'::text,ARRAY[10]) || array_fill('⭐'::text,ARRAY[4]) || array_fill('7️⃣'::text,ARRAY[1]);
  v_one text; v_two text; v_three text; v_base integer := 0; v_award integer := 0; v_loss integer := 0; v_factor numeric := 1;
  v_name text; v_name_norm text; v_row public.online_slot_scores%rowtype; v_refills integer := 0; v_free integer := 0; v_paid integer := 0; v_jackpot integer := 0; v_next timestamptz;
  v_pair boolean := false; v_free_earned boolean := false; v_used_paid boolean := false; v_streak integer := 0; v_streak_gain integer := 0; v_pending integer := 0; v_room bigint;
  v_million_jackpot boolean := false; v_guaranteed_star_spin boolean := false; v_bonus_queue integer[] := '{}'::integer[]; v_legacy_bonus_count integer := 0; v_paid_bonus integer := 0; v_paid_bonus_awarded integer := 0;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Bitte lade die Website neu.'; end if;
  v_name := left(regexp_replace(coalesce(trim(p_name),''),'[<>[:cntrl:]]','','g'),20); if v_name = '' then v_name := 'Spieler'; end if;
  v_name_norm := translate(lower(regexp_replace(v_name,'[^[:alnum:]]','','g')),'äöüß','aous');
  if v_name_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then raise exception 'Dieser Name ist nicht erlaubt.'; end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,coin_fraction,inventory,updated_at)
    values(v_uid,v_name,10,0,2,0,null,0,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id = v_uid for update;
  if coalesce(v_row.pending_double_amount,0) >= 500 then raise exception 'Bitte zuerst Doppelt oder Nichts auflösen oder ablehnen.'; end if;
  if v_row.free_spins < 2 and v_row.next_free_spin_at is not null and now() >= v_row.next_free_spin_at then
    v_refills := 1 + floor(extract(epoch from(now()-v_row.next_free_spin_at))/45)::integer;
    v_free := least(2,v_row.free_spins+v_refills);
    if v_free >= 2 then v_next := null; else v_next := v_row.next_free_spin_at+(v_refills*interval '45 seconds'); end if;
    update public.online_slot_scores score set free_spins=v_free,next_free_spin_at=v_next,updated_at=now() where score.player_id=v_uid returning score.* into v_row;
  end if;
  v_free := v_row.free_spins; v_paid := v_row.paid_spins; v_next := v_row.next_free_spin_at; v_jackpot := v_row.jackpot_spins;
  v_bonus_queue := coalesce(v_row.paid_spin_bonus_queue,'{}'::integer[]); v_legacy_bonus_count := coalesce(v_row.paid_spin_legacy_3500,0);
  if v_paid > 0 then
    v_paid := v_paid-1; v_used_paid := true;
    -- Old spins from before v57 keep their previous +3,500 reward; newly purchased bonuses follow FIFO order.
    if v_legacy_bonus_count > 0 then
      v_legacy_bonus_count := v_legacy_bonus_count-1; v_paid_bonus := 3500;
    elsif cardinality(v_bonus_queue) > 0 then
      v_paid_bonus := coalesce(v_bonus_queue[1],1000);
      if cardinality(v_bonus_queue) > 1 then v_bonus_queue := array(select unnest(v_bonus_queue[2:cardinality(v_bonus_queue)])); else v_bonus_queue := '{}'::integer[]; end if;
    else
      v_paid_bonus := 3500; -- compatibility fallback for spins granted by older/other server routines
    end if;
  elsif v_free > 0 then
    v_free := v_free-1;
  else
    raise exception 'Keine Spins verfügbar.';
  end if;
  if not v_used_paid and v_free < 2 and v_next is null then v_next := now()+interval '45 seconds'; end if;

  -- Fixed reel strips: 10, 10 and 100 stops, with one 🌌 stop each, so 🌌🌌🌌 is 1 in 10,000.
  v_guaranteed_star_spin := (v_jackpot > 0);
  if v_guaranteed_star_spin then v_jackpot := v_jackpot-1; end if;
  v_one := v_reel1[1+floor(random()*array_length(v_reel1,1))::integer];
  v_two := v_reel2[1+floor(random()*array_length(v_reel2,1))::integer];
  v_three := v_reel3[1+floor(random()*array_length(v_reel3,1))::integer];
  v_million_jackpot := (v_one='🌌' and v_two='🌌' and v_three='🌌');
  if v_guaranteed_star_spin and not v_million_jackpot then v_one := '⭐'; v_two := '⭐'; v_three := '⭐'; end if;

  -- Only a left-to-right combination starting at reel one wins.
  v_pair := (v_one=v_two);
  if v_million_jackpot then v_base := 1000000;
  elsif v_one=v_two and v_two=v_three and v_one='⭐' then v_base := 1825;
  elsif v_one=v_two and v_two=v_three and v_one='🍓' then v_base := 1325;
  elsif v_one=v_two and v_two=v_three and v_one='7️⃣' then v_base := 1075;
  elsif v_one=v_two and v_two=v_three then v_base := 475;
  elsif v_pair then v_base := 75; else v_base := 0; end if;

  if v_base > 0 then
    v_streak := least(coalesce(v_row.win_streak,0)+1,1000); v_streak_gain := least(v_streak,3);
    if v_million_jackpot then v_factor := 1;
    else
      if v_streak=1 then v_factor := 3; elsif v_streak=2 then v_factor := 4; elsif v_streak=3 then v_factor := 8; else v_factor := 4; end if;
      if 'streak_bonus'=any(coalesce(v_row.inventory,'{}'::text[])) then
        if v_streak=1 then v_factor := 4; elsif v_streak=2 then v_factor := 8; else v_factor := 4; end if;
      end if;
    end if;
    v_room := greatest(1000000000::bigint-v_row.total_points,0);
    if v_million_jackpot then v_award := least(1000000::numeric,v_room::numeric)::integer;
    else v_award := least(v_base::numeric*v_factor,v_room::numeric)::integer; end if;
    if v_award >= 500 then v_pending := v_award; end if;
  else
    v_streak := 0; v_streak_gain := 0; v_award := 0; v_pending := 0;
    if v_row.total_points > 0 then v_loss := least(v_row.total_points::integer,700); end if;
  end if;

  -- Purchased spins give their queued bonus and never deduct coins on a miss. The 1,000,000 jackpot is not stacked.
  if v_used_paid then
    v_loss := 0;
    if not v_million_jackpot then
      v_room := greatest(1000000000::bigint-v_row.total_points,0);
      v_paid_bonus_awarded := least(v_paid_bonus::numeric,greatest(v_room::numeric-v_award::numeric,0))::integer;
      v_award := least(v_award::numeric+v_paid_bonus_awarded::numeric,v_room::numeric)::integer;
    end if;
  end if;
  if v_pair and not v_million_jackpot and v_free < 2 then v_free := v_free+1; v_free_earned := true; if v_free >= 2 then v_next := null; elsif v_next is null then v_next := now()+interval '45 seconds'; end if; end if;
  if v_free >= 2 then v_next := null; elsif v_free=0 and v_next is null then v_next := now()+interval '45 seconds'; end if;

  update public.online_slot_scores score set
    display_name=v_name,total_points=least(greatest(score.total_points+v_award-v_loss,0),1000000000),
    spins=least(score.spins+1,1000000000),free_spins=v_free,paid_spins=v_paid,next_free_spin_at=v_next,multiplier_steps=0,coin_fraction=0,
    paid_spin_bonus_queue=v_bonus_queue,paid_spin_legacy_3500=v_legacy_bonus_count,
    jackpot_spins=v_jackpot,win_streak=v_streak,streak_points=least(score.streak_points+v_streak_gain,1000000),
    pending_double_amount=v_pending,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_one,v_two,v_three,v_award,v_base,v_row.total_points,v_row.spins,v_row.display_name,v_row.free_spins,v_row.paid_spins,
    v_row.next_free_spin_at,0,v_row.inventory,v_free_earned,v_loss,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,
    v_row.pending_double_amount,v_row.is_op,v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed,v_paid_bonus_awarded;
end;
$$;

create or replace function public.buy_slot_spins(p_quantity integer)
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,
  next_free_spin_at timestamptz,multiplier_steps integer,inventory text[],jackpot_spins integer,
  win_streak integer,streak_points integer,pending_double_amount integer,is_op boolean,
  logo_v49_click_count integer,logo_multiplier_x5_claimed boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_price bigint; v_bonuses integer[] := '{}'::integer[]; v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt.'; end if;
  if p_quantity=1 then v_price := 50; v_bonuses := array[1000];
  elsif p_quantity=2 then v_price := 100; v_bonuses := array[1000,1000];
  elsif p_quantity=3 then v_price := 125; v_bonuses := array[3500,3500,3500];
  else raise exception 'Wähle ein Spin-Paket mit 1, 2 oder 3 Spins.'; end if;

  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not found then
    insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,multiplier_steps,coin_fraction,inventory,updated_at)
      values(v_uid,'Spieler',10,0,2,0,0,0,'{}'::text[],now()) returning * into v_row;
  end if;
  if v_row.total_points < v_price then raise exception 'Dafür reichen deine Coins nicht.'; end if;
  if v_row.paid_spins+p_quantity > 1000000 then raise exception 'Dein Spin-Vorrat ist voll.'; end if;
  update public.online_slot_scores score set
    total_points=score.total_points-v_price,
    paid_spins=score.paid_spins+p_quantity,
    paid_spin_bonus_queue=coalesce(score.paid_spin_bonus_queue,'{}'::integer[]) || v_bonuses,
    multiplier_steps=0,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,
    v_row.next_free_spin_at,0,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,
    v_row.pending_double_amount,v_row.is_op,v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed;
end;
$$;

revoke all on function public.spin_slot_machine(text) from public,anon;
grant execute on function public.spin_slot_machine(text) to authenticated;
revoke all on function public.buy_slot_spins(integer) from public,anon;
grant execute on function public.buy_slot_spins(integer) to authenticated;
notify pgrst,'reload schema';
commit;
