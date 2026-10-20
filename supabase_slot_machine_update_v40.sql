-- v40 Arcade update: virtual-only rewards. Run after supabase_slot_machine_setup.sql.
-- No real-money value, payment, cash-out or administrator privileges are granted by reward codes.
alter table public.online_slot_scores
  add column if not exists free_spins integer not null default 10,
  add column if not exists multiplier_steps integer not null default 0,
  add column if not exists win_streak integer not null default 0,
  add column if not exists forced_jackpot_spins integer not null default 0,
  add column if not exists last_award integer not null default 0,
  add column if not exists inventory text[] not null default '{}'::text[];

update public.online_slot_scores set free_spins=10 where free_spins is null or free_spins<0;
update public.online_slot_scores set multiplier_steps=0 where multiplier_steps is null or multiplier_steps<0;
update public.online_slot_scores set win_streak=0 where win_streak is null or win_streak<0;
update public.online_slot_scores set forced_jackpot_spins=0 where forced_jackpot_spins is null or forced_jackpot_spins<0;
update public.online_slot_scores set inventory='{}'::text[] where inventory is null;

create table if not exists public.online_slot_code_redemptions(
  player_id uuid not null references auth.users(id) on delete cascade,
  code_key text not null,
  redeemed_at timestamptz not null default now(),
  primary key(player_id,code_key)
);
alter table public.online_slot_code_redemptions enable row level security;
revoke all on public.online_slot_code_redemptions from public, anon, authenticated;

-- Drop first because v40 adds return columns to the RPC.
drop function if exists public.spin_slot_machine(text);
create function public.spin_slot_machine(p_name text)
returns table(reel_one text,reel_two text,reel_three text,points_awarded integer,total_points bigint,spins bigint,display_name text,free_spins integer,win_streak integer,can_double boolean,inventory text[])
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_uid uuid:=auth.uid(); v_symbols text[]:=array['🍒','🍓','🍋','🍊','🍉','🍇','⭐','7️⃣'];
 v_one text;v_two text;v_three text;v_base integer:=0;v_award integer:=0;v_name text;v_norm text;
 v_row public.online_slot_scores%rowtype;v_streak integer;v_jackpot boolean:=false;
begin
 if v_uid is null then raise exception 'Bitte melde dich erneut an.'; end if;
 v_name:=left(regexp_replace(coalesce(trim(p_name),''),'[<>[:cntrl:]]','','g'),20);if v_name='' then v_name:='Spieler';end if;
 v_norm:=translate(lower(regexp_replace(v_name,'[^[:alnum:]]','','g')),'äöüß','aous');
 if v_norm ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then raise exception 'Dieser Name ist nicht erlaubt.';end if;
 insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins) values(v_uid,v_name,10,0,10) on conflict(player_id) do nothing;
 select * into v_row from public.online_slot_scores where player_id=v_uid for update;
 if v_row.free_spins<=0 then raise exception 'Keine Freispiele mehr. Löse einen Belohnungscode ein, um weitere virtuelle Spins zu erhalten.';end if;
 if v_row.forced_jackpot_spins>0 then
   v_one:='7️⃣';v_two:='7️⃣';v_three:='7️⃣';v_base:=500;v_jackpot:=true;
 else
   v_one:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];v_two:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];v_three:=v_symbols[1+floor(random()*array_length(v_symbols,1))::integer];
   if v_one=v_two and v_two=v_three and v_one='⭐' then v_base:=1000;
   elsif v_one=v_two and v_two=v_three and v_one='🍓' then v_base:=750;
   elsif v_one=v_two and v_two=v_three and v_one='7️⃣' then v_base:=500;
   elsif v_one=v_two and v_two=v_three then v_base:=100;
   elsif v_one=v_two or v_one=v_three or v_two=v_three then v_base:=15;end if;
 end if;
 if v_base>0 then v_streak:=least(v_row.win_streak+1,100);v_award:=v_base*v_streak;v_award:=v_award+floor(v_award*v_row.multiplier_steps::numeric/200)::integer;
 else v_streak:=0;v_award:=-15;end if;
 update public.online_slot_scores set display_name=v_name,total_points=greatest(0,least(total_points+v_award,1000000000)),spins=least(spins+1,1000000000),free_spins=greatest(0,free_spins-1),win_streak=v_streak,last_award=greatest(0,v_award),forced_jackpot_spins=greatest(0,forced_jackpot_spins-case when v_jackpot then 1 else 0 end),updated_at=now() where player_id=v_uid returning * into v_row;
 return query select v_one,v_two,v_three,v_award,v_row.total_points,v_row.spins,v_row.display_name,v_row.free_spins,v_row.win_streak,(v_award>=500),v_row.inventory;
end;$$;
revoke all on function public.spin_slot_machine(text) from public,anon;
grant execute on function public.spin_slot_machine(text) to authenticated;

create or replace function public.redeem_slot_reward_code(p_code text)
returns table(message text,total_points bigint,free_spins integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_code text:=upper(trim(coalesce(p_code,'')));v_row public.online_slot_scores%rowtype;v_key text;v_points bigint:=0;v_spins integer:=0;v_msg text;
begin
 if v_uid is null then raise exception 'Bitte melde dich erneut an.';end if;
 if v_code not in ('KAMAR-10000','JACKPOT2','FREE100') then raise exception 'Dieser Code ist ungültig.';end if;
 v_key:=case v_code when 'KAMAR-10000' then 'coins_10000' when 'JACKPOT2' then 'jackpot_next_2' else 'free_spins_100' end;
 insert into public.online_slot_scores(player_id,display_name,total_points,spins,free_spins) values(v_uid,'Spieler',10,0,10) on conflict(player_id) do nothing;
 insert into public.online_slot_code_redemptions(player_id,code_key) values(v_uid,v_key) on conflict do nothing;
 if not found then raise exception 'Dieser Code wurde auf diesem Konto bereits eingelöst.';end if;
 if v_code='KAMAR-10000' then update public.online_slot_scores set total_points=least(total_points+10000,1000000000),updated_at=now() where player_id=v_uid;
 elsif v_code='JACKPOT2' then update public.online_slot_scores set forced_jackpot_spins=least(forced_jackpot_spins+2,100),updated_at=now() where player_id=v_uid;
 else update public.online_slot_scores set free_spins=least(free_spins+100,10000),updated_at=now();end if;
 select * into v_row from public.online_slot_scores where player_id=v_uid;
 v_msg:=case v_code when 'KAMAR-10000' then '+10.000 virtuelle Coins gutgeschrieben.' when 'JACKPOT2' then 'Die nächsten zwei Spins sind garantierte virtuelle Jackpot-Drehungen.' else '+100 virtuelle Freispiele gutgeschrieben.' end;
 return query select v_msg,v_row.total_points,v_row.free_spins;
end;$$;
revoke all on function public.redeem_slot_reward_code(text) from public,anon;
grant execute on function public.redeem_slot_reward_code(text) to authenticated;

create or replace function public.buy_slot_multiplier_v40()
returns table(total_points bigint,multiplier_steps integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;
begin
 if v_uid is null then raise exception 'Bitte melde dich erneut an.';end if;
 select * into v_row from public.online_slot_scores where player_id=v_uid for update;
 if not found then raise exception 'Spielprofil nicht gefunden.';end if;
 if v_row.total_points<10 then raise exception 'Du brauchst 10 Coins.';end if;
 update public.online_slot_scores set total_points=total_points-10,multiplier_steps=least(multiplier_steps+1,200),updated_at=now() where player_id=v_uid returning * into v_row;
 return query select v_row.total_points,v_row.multiplier_steps;
end;$$;
revoke all on function public.buy_slot_multiplier_v40() from public,anon;
grant execute on function public.buy_slot_multiplier_v40() to authenticated;

create or replace function public.buy_slot_collectible_v40(p_item_id text)
returns table(total_points bigint,inventory text[])
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_price integer;v_row public.online_slot_scores%rowtype;
begin
 if v_uid is null then raise exception 'Bitte melde dich erneut an.';end if;
 v_price:=case p_item_id when 'bugatti' then 2500 when 'yacht' then 4000 when 'penthouse' then 10000 when 'rocket' then 25000 else null end;
 if v_price is null then raise exception 'Unbekannter Gegenstand.';end if;
 select * into v_row from public.online_slot_scores where player_id=v_uid for update;
 if not found then raise exception 'Spielprofil nicht gefunden.';end if;
 if p_item_id=any(v_row.inventory) then raise exception 'Diesen Gegenstand besitzt du bereits.';end if;
 if v_row.total_points<v_price then raise exception 'Nicht genug Coins.';end if;
 update public.online_slot_scores set total_points=total_points-v_price,inventory=array_append(inventory,p_item_id),updated_at=now() where player_id=v_uid returning * into v_row;
 return query select v_row.total_points,v_row.inventory;
end;$$;
revoke all on function public.buy_slot_collectible_v40(text) from public,anon;
grant execute on function public.buy_slot_collectible_v40(text) to authenticated;

create or replace function public.slot_double_or_nothing_v40(p_choice text)
returns table(coin_side text,won boolean,total_points bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_row public.online_slot_scores%rowtype;v_side text;v_won boolean;
begin
 if v_uid is null then raise exception 'Bitte melde dich erneut an.';end if;
 if p_choice not in ('Kopf','Zahl') then raise exception 'Wähle Kopf oder Zahl.';end if;
 select * into v_row from public.online_slot_scores where player_id=v_uid for update;
 if not found or v_row.last_award<500 then raise exception 'Doppelt oder nichts ist nur nach einem Gewinn ab 500 Coins verfügbar.';end if;
 v_side:=case when random()<0.5 then 'Kopf' else 'Zahl' end;v_won:=v_side=p_choice;
 update public.online_slot_scores set total_points=greatest(0,least(total_points+case when v_won then v_row.last_award else -v_row.last_award end,1000000000)),last_award=0,updated_at=now() where player_id=v_uid returning * into v_row;
 return query select v_side,v_won,v_row.total_points;
end;$$;
revoke all on function public.slot_double_or_nothing_v40(text) from public,anon;
grant execute on function public.slot_double_or_nothing_v40(text) to authenticated;

-- Allow up to 30 minutes in Stadt-Land-Fluss rooms.
alter table public.online_slf_rooms drop constraint if exists online_slf_rooms_duration_seconds_check;
alter table public.online_slf_rooms add constraint online_slf_rooms_duration_seconds_check check (duration_seconds between 15 and 1800);
do $$ declare v_def text; begin
  select pg_get_functiondef('public.create_slf_room(text,text,jsonb,integer)'::regprocedure) into v_def;
  v_def:=replace(v_def,'p_duration_seconds > 300','p_duration_seconds > 1800');
  v_def:=replace(v_def,'15 bis 300 Sekunden','15 bis 1800 Sekunden');
  execute v_def;
end $$;
