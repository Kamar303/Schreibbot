-- Schreibbot Slot Arcade v52
-- Increase each base win by 325 coins and restore the requested streak progression.
-- Standard streak: first win x3, second x4, third x8, fourth and higher x4.
-- The Streak Bonus advances the progression by one step; no separate coin multiplier is added.
-- Requires the existing Slot Arcade schema/function setup (v50 migration or later).
begin;

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
  if v_one=v_two and v_two=v_three and v_one='⭐' then v_base:=1825;
  elsif v_one=v_two and v_two=v_three and v_one='🍓' then v_base:=1325;
  elsif v_one=v_two and v_two=v_three and v_one='7️⃣' then v_base:=1075;
  elsif v_one=v_two and v_two=v_three then v_base:=475;
  elsif v_pair then v_base:=350;else v_base:=0;end if;
  if v_base>0 then
    v_streak:=least(coalesce(v_row.win_streak,0)+1,1000);v_streak_gain:=least(v_streak,3);
    -- Standard progression: first win x3, second x4, third x8; all higher streaks x4.
    if v_streak=1 then v_factor:=3;
    elsif v_streak=2 then v_factor:=4;
    elsif v_streak=3 then v_factor:=8;
    else v_factor:=4;end if;
    -- The Streak Bonus advances one step: x4 on first win, x8 on second, then x4.
    if 'streak_bonus'=any(coalesce(v_row.inventory,'{}'::text[])) then
      if v_streak=1 then v_factor:=4;
      elsif v_streak=2 then v_factor:=8;
      else v_factor:=4;end if;
    end if;
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

revoke all on function public.spin_slot_machine(text) from public,anon;
grant execute on function public.spin_slot_machine(text) to authenticated;
notify pgrst,'reload schema';
commit;
