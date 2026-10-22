-- Handschrift Arcade v50: slower progression, x3 streak cap, affordable streak upgrade, platinum endgame.
-- Run this after supabase_slot_machine_update_v49.sql in the same Supabase project.
-- Virtual-only coins; no real-money purchases, wagers, or cash-outs.

begin;

-- Convert the old hidden 5x logo marker to the same capped Series Bonus, preserving the unlock.
update public.online_slot_scores score
set inventory=array_append(array_remove(array_remove(array_remove(coalesce(score.inventory,'{}'::text[]),'multiplier_x4'),'multiplier_x5'),'streak_bonus'),'streak_bonus'),
    multiplier_steps=0,coin_fraction=0
where coalesce(score.logo_multiplier_x5_claimed,false)
   or 'multiplier_x4'=any(coalesce(score.inventory,'{}'::text[]))
   or 'multiplier_x5'=any(coalesce(score.inventory,'{}'::text[]));

create or replace function public.get_slot_profile()
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
    v_refills:=1+floor(extract(epoch from (now()-v_row.next_free_spin_at))/45)::integer;
    v_free:=least(2,v_row.free_spins+v_refills);
    if v_free>=2 then v_next:=null; else v_next:=v_row.next_free_spin_at+(v_refills*interval '45 seconds'); end if;
    update public.online_slot_scores score set free_spins=v_free,next_free_spin_at=v_next,updated_at=now()
      where score.player_id=v_uid returning score.* into v_row;
  end if;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,
    v_row.next_free_spin_at,0,v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,
    v_row.pending_double_amount,v_row.is_op,v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed;
end;
$$;

create or replace function public.buy_slot_shop_item(p_item_id text)
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
    when 'streak_bonus' then v_price:=2500;
    when 'galaxy_core' then v_price:=500000;
    when 'milky_way' then v_price:=1000000;
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

create or replace function public.spin_slot_machine(p_name text)
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
    v_refills:=1+floor(extract(epoch from(now()-v_row.next_free_spin_at))/45)::integer;v_free:=least(2,v_row.free_spins+v_refills);
    if v_free>=2 then v_next:=null;else v_next:=v_row.next_free_spin_at+(v_refills*interval '45 seconds');end if;
    update public.online_slot_scores score set free_spins=v_free,next_free_spin_at=v_next,updated_at=now() where score.player_id=v_uid returning score.* into v_row;
  end if;
  v_free:=v_row.free_spins;v_paid:=v_row.paid_spins;v_next:=v_row.next_free_spin_at;v_jackpot:=v_row.jackpot_spins;
  if v_paid>0 then v_paid:=v_paid-1;v_used_paid:=true;elsif v_free>0 then v_free:=v_free-1;else raise exception 'Keine Spins verfügbar.';end if;
  if not v_used_paid and v_free<2 and v_next is null then v_next:=now()+interval '45 seconds';end if;
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
    v_factor:=least(v_streak,3)::numeric; -- Series: x1, x2, x3; never grows beyond x3.
    if 'streak_bonus'=any(coalesce(v_row.inventory,'{}'::text[])) then v_factor:=least(v_factor+1,3);end if; -- The affordable boost advances one tier, still capped at x3.
    v_room:=greatest(1000000000::bigint-v_row.total_points,0);
    v_award:=least(v_base::numeric*v_factor,v_room::numeric)::integer;
    if v_award>=500 then v_pending:=v_award;end if;
  else
    v_streak:=0;v_streak_gain:=0;v_award:=0;v_pending:=0;
    if v_row.total_points>0 then v_loss:=least(v_row.total_points::integer,greatest(1,round(5*power(greatest(v_row.total_points,1)::numeric/100,0.6989700043360189))::integer));end if;
  end if;
  if v_pair and v_free<2 then v_free:=v_free+1;v_free_earned:=true;if v_free>=2 then v_next:=null;elsif v_next is null then v_next:=now()+interval '45 seconds';end if;end if;
  if v_free>=2 then v_next:=null;elsif v_free=0 and v_next is null then v_next:=now()+interval '45 seconds';end if;
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

create or replace function public.register_slot_logo_click()
returns table(
  display_name text,total_points bigint,spins bigint,free_spins integer,paid_spins integer,next_free_spin_at timestamptz,
  multiplier_steps integer,inventory text[],jackpot_spins integer,win_streak integer,streak_points integer,pending_double_amount integer,
  is_op boolean,logo_v49_click_count integer,logo_multiplier_x5_claimed boolean,multiplier_x5_unlocked boolean
)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;v_clicks integer;v_unlocked boolean:=false;
begin
  if v_uid is null then raise exception 'Die anonyme Spielanmeldung fehlt. Aktiviere Anonymous Sign-Ins.';end if;
  insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins,paid_spins,next_free_spin_at,multiplier_steps,coin_fraction,inventory,updated_at)
    values(v_uid,'Spieler',10,0,2,0,null,0,0,'{}'::text[],now()) on conflict(player_id) do nothing;
  select * into v_row from public.online_slot_scores s where s.player_id=v_uid for update;
  if not coalesce(v_row.logo_multiplier_x5_claimed,false) then
    v_clicks:=least(greatest(coalesce(v_row.logo_v49_click_count,0),0)+1,10);
    update public.online_slot_scores score set logo_v49_click_count=v_clicks,logo_multiplier_x5_claimed=(v_clicks>=10),
      inventory=case when v_clicks>=10 then array_append(array_remove(array_remove(array_remove(coalesce(score.inventory,'{}'::text[]),'multiplier_x4'),'multiplier_x5'),'streak_bonus'),'streak_bonus') else array_remove(array_remove(coalesce(score.inventory,'{}'::text[]),'multiplier_x4'),'multiplier_x5') end,
      multiplier_steps=0,coin_fraction=0,updated_at=now()
      where score.player_id=v_uid returning score.* into v_row;
    v_unlocked:=(v_clicks>=10);
  end if;
  return query select v_row.display_name,v_row.total_points,v_row.spins,v_row.free_spins,v_row.paid_spins,v_row.next_free_spin_at,0,
    v_row.inventory,v_row.jackpot_spins,v_row.win_streak,v_row.streak_points,v_row.pending_double_amount,v_row.is_op,
    v_row.logo_v49_click_count,v_row.logo_multiplier_x5_claimed,v_unlocked;
end;
$$;

drop function if exists public.get_slot_leaderboard();
create function public.get_slot_leaderboard()
returns table(rank_no bigint, display_name text, total_points bigint, spins bigint, is_me boolean, inventory text[])
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Melde dich bitte erneut an, um die Rangliste zu laden.'; end if;
  return query
    select ranked.rank_no,ranked.display_name,ranked.total_points,ranked.spins,(ranked.player_id=v_uid) as is_me,ranked.inventory
    from (
      select row_number() over (order by score.total_points desc,score.updated_at asc,score.display_name asc) as rank_no,
             score.player_id,score.display_name,score.total_points,score.spins,coalesce(score.inventory,'{}'::text[]) as inventory
      from public.online_slot_scores score
    ) ranked
    where ranked.rank_no<=10 or ranked.player_id=v_uid
    order by ranked.rank_no;
end;
$$;

revoke all on function public.get_slot_profile() from public,anon;
revoke all on function public.buy_slot_shop_item(text) from public,anon;
revoke all on function public.spin_slot_machine(text) from public,anon;
revoke all on function public.register_slot_logo_click() from public,anon;
revoke all on function public.get_slot_leaderboard() from public,anon;
grant execute on function public.get_slot_profile() to authenticated;
grant execute on function public.buy_slot_shop_item(text) to authenticated;
grant execute on function public.spin_slot_machine(text) to authenticated;
grant execute on function public.register_slot_logo_click() to authenticated;
grant execute on function public.get_slot_leaderboard() to authenticated;

notify pgrst,'reload schema';
commit;
