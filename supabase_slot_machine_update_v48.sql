-- Handschrift Arcade v48: one-time, permanent x4 coin multiplier.
-- After v47 is installed, run this migration in the same Supabase project.
-- The multiplier is recorded as inventory marker 'multiplier_x4'; the server applies x4 to all winnings, in addition to the consecutive-win streak factor.
-- Purchase cost: 10,000 virtual coins, once per authenticated player profile.

begin;

create or replace function public.buy_slot_shop_item(p_item_id text)
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
    when 'private_island' then v_price:=100000;
    when 'multiplier_x4' then v_price:=10000;
    else raise exception 'Diesen virtuellen Shop-Artikel gibt es nicht.';
  end case;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if p_item_id=any(coalesce(v_row.inventory,'{}'::text[])) then raise exception 'Diesen Shop-Artikel besitzt du bereits; er kann nur einmal gekauft werden.'; end if;
  if v_row.total_points<v_price then raise exception 'Dafür reichen deine Arcade-Coins noch nicht.'; end if;
  update public.online_slot_scores score set total_points=score.total_points-v_price,inventory=array_append(score.inventory,p_item_id),updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.pending_double_amount,v_row.is_op;
end;
$$;
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
    -- Exponential win-streak payout: first win x1, second x2, third x4, fourth x8, etc.
    -- The streak factor applies to this spin's entire base award, whatever the winning combination.
    v_streak:=least(coalesce(v_row.win_streak,0)+1,1000);
    v_streak_points_gain:=least(v_streak,3); -- Streak points remain cosmetic and separate from coin rewards.
    v_award:=least(
      v_base_award::numeric * power(2::numeric, greatest(v_streak-1,0)) * case when 'multiplier_x4'=any(coalesce(v_row.inventory,'{}'::text[])) then 4::numeric else 1::numeric end,
      greatest(1000000000::numeric-v_row.total_points::numeric,0)
    )::integer;
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
    jackpot_spins=v_jackpot_after,multiplier_steps=0,win_streak=v_streak,streak_points=least(score.streak_points+v_streak_points_gain,1000000),pending_double_amount=v_pending_double,updated_at=now()
    where score.player_id=v_uid returning score.* into v_row;
  return query select v_one,v_two,v_three,v_award,v_base_award,v_row.total_points,v_row.spins,v_row.display_name,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,v_row.multiplier_steps,v_row.inventory,v_earned,v_coins_lost,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op;
end;
$$;

revoke all on function public.buy_slot_shop_item(text) from public, anon;
revoke all on function public.spin_slot_machine(text) from public, anon;
grant execute on function public.buy_slot_shop_item(text) to authenticated;
grant execute on function public.spin_slot_machine(text) to authenticated;

notify pgrst, 'reload schema';
commit;
