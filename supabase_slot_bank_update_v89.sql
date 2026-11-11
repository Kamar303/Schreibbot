-- Schreibbot v89: separate virtual coin bank with a server-enforced daily deposit cap.
-- Rerunnable bank migration for the same Supabase project as the Arcade. Coins remain virtual and non-redeemable.

create table if not exists public.online_slot_bank_accounts (
  player_id uuid primary key references auth.users(id) on delete cascade,
  bank_balance bigint not null default 0 check (bank_balance between 0 and 1000000000),
  bank_day date not null default (now() at time zone 'Europe/Berlin')::date,
  deposited_today bigint not null default 0 check (deposited_today between 0 and 100000),
  updated_at timestamptz not null default now()
);

alter table public.online_slot_bank_accounts enable row level security;
revoke all on table public.online_slot_bank_accounts from public, anon, authenticated;

create or replace function public.get_slot_bank()
returns table(wallet_balance bigint, bank_balance bigint, deposited_today bigint, daily_limit bigint, remaining_today bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_bank public.online_slot_bank_accounts%rowtype;
  v_wallet bigint := 0;
begin
  if v_uid is null then raise exception 'Bitte melde dich erneut an, um die Coin-Bank zu laden.'; end if;
  insert into public.online_slot_bank_accounts(player_id, bank_day)
    values (v_uid, v_today) on conflict (player_id) do nothing;
  select * into v_bank from public.online_slot_bank_accounts where player_id = v_uid for update;
  if v_bank.bank_day <> v_today then
    update public.online_slot_bank_accounts
       set bank_day = v_today, deposited_today = 0, updated_at = now()
     where player_id = v_uid returning * into v_bank;
  end if;
  select coalesce((select total_points from public.online_slot_scores where player_id = v_uid), 0) into v_wallet;
  return query select v_wallet, v_bank.bank_balance, v_bank.deposited_today, 100000::bigint,
                      greatest(0::bigint, 100000::bigint - v_bank.deposited_today);
end;
$$;

revoke all on function public.get_slot_bank() from public, anon;
grant execute on function public.get_slot_bank() to authenticated;

create or replace function public.transfer_slot_bank(p_action text, p_amount bigint)
returns table(action text, amount bigint, wallet_balance bigint, bank_balance bigint, deposited_today bigint, daily_limit bigint, remaining_today bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_wallet public.online_slot_scores%rowtype;
  v_bank public.online_slot_bank_accounts%rowtype;
begin
  if v_uid is null then raise exception 'Bitte melde dich erneut an, um Coins zu übertragen.'; end if;
  if p_action is null or p_action not in ('deposit', 'withdraw') then raise exception 'Unbekannte Bankaktion.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Bitte gib einen gültigen Coin-Betrag ein.'; end if;

  -- Always lock the wallet before the bank row, preventing conflicting transfer order.
  insert into public.online_slot_scores(player_id, display_name, total_points, spins, updated_at)
    values (v_uid, 'Spieler', 10, 0, now()) on conflict (player_id) do nothing;
  select * into v_wallet from public.online_slot_scores where player_id = v_uid for update;
  insert into public.online_slot_bank_accounts(player_id, bank_day)
    values (v_uid, v_today) on conflict (player_id) do nothing;
  select * into v_bank from public.online_slot_bank_accounts where player_id = v_uid for update;

  if v_bank.bank_day <> v_today then
    update public.online_slot_bank_accounts
       set bank_day = v_today, deposited_today = 0, updated_at = now()
     where player_id = v_uid returning * into v_bank;
  end if;

  if p_action = 'deposit' then
    if p_amount > (100000::bigint - v_bank.deposited_today) then
      raise exception 'Tageslimit erreicht: Pro Tag sind höchstens 100.000 Coins Einzahlung erlaubt.';
    end if;
    if p_amount > v_wallet.total_points then raise exception 'Du hast nicht genug Coins im Wallet.'; end if;
    if p_amount > (1000000000::bigint - v_bank.bank_balance) then raise exception 'Die Coin-Bank hat ihr Speicherlimit erreicht.'; end if;
    update public.online_slot_scores set total_points = total_points - p_amount, updated_at = now()
      where player_id = v_uid returning * into v_wallet;
    update public.online_slot_bank_accounts
       set bank_balance = bank_balance + p_amount,
           deposited_today = deposited_today + p_amount,
           updated_at = now()
     where player_id = v_uid returning * into v_bank;
  else
    if p_amount > v_bank.bank_balance then raise exception 'In der Bank liegen nicht genug Coins.'; end if;
    if p_amount > (1000000000::bigint - v_wallet.total_points) then raise exception 'Das Wallet hat sein Speicherlimit erreicht.'; end if;
    update public.online_slot_bank_accounts set bank_balance = bank_balance - p_amount, updated_at = now()
      where player_id = v_uid returning * into v_bank;
    update public.online_slot_scores set total_points = total_points + p_amount, updated_at = now()
      where player_id = v_uid returning * into v_wallet;
  end if;

  return query select p_action, p_amount, v_wallet.total_points, v_bank.bank_balance,
                      v_bank.deposited_today, 100000::bigint,
                      greatest(0::bigint, 100000::bigint - v_bank.deposited_today);
end;
$$;

revoke all on function public.transfer_slot_bank(text, bigint) from public, anon;
grant execute on function public.transfer_slot_bank(text, bigint) to authenticated;


comment on table public.online_slot_bank_accounts is 'Schreibbot virtual coin bank; daily deposits capped at 100000 coins in Europe/Berlin.';
comment on function public.get_slot_bank() is 'Returns the authenticated player wallet and virtual bank balances.';
comment on function public.transfer_slot_bank(text, bigint) is 'Atomically transfers virtual coins between wallet and bank; deposits are limited to 100000 per Berlin calendar day.';
