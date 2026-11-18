-- Schreibbot v91: secure 30-minute PIN recovery and rate-limited virtual bank PIN verification.
-- Requires the existing bank schema from supabase_slot_bank_update_v90.sql.
-- All balances are virtual game points; this migration does not add real-money features.

create table if not exists public.online_slot_bank_pin_resets (
  player_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  available_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists online_slot_bank_pin_resets_available_idx
  on public.online_slot_bank_pin_resets(available_at);

alter table public.online_slot_bank_pin_resets enable row level security;
revoke all on table public.online_slot_bank_pin_resets from public, anon, authenticated;

-- A normal PIN change uses the same five-attempt / 15-minute protection as transfers.
drop function if exists public.set_slot_bank_pin(text, text);
create function public.set_slot_bank_pin(p_new_pin text, p_current_pin text default null)
returns table(pin_enabled boolean, updated_at timestamptz, error_message text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_bank public.online_slot_bank_accounts%rowtype;
  v_attempt public.online_slot_bank_pin_attempts%rowtype;
  v_now timestamptz := now();
  v_failed_count integer;
  v_locked_until timestamptz;
  v_error text;
begin
  if v_uid is null then
    raise exception 'Bitte melde dich erneut an.';
  end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{6}$' then
    raise exception 'Die Bank-PIN muss aus genau sechs Ziffern bestehen.';
  end if;

  insert into public.online_slot_bank_accounts(player_id)
  values (v_uid)
  on conflict (player_id) do nothing;

  select b.* into v_bank
  from public.online_slot_bank_accounts as b
  where b.player_id = v_uid
  for update;

  if v_bank.bank_pin_hash is not null then
    insert into public.online_slot_bank_pin_attempts(player_id)
    values (v_uid)
    on conflict (player_id) do nothing;

    select a.* into v_attempt
    from public.online_slot_bank_pin_attempts as a
    where a.player_id = v_uid
    for update;

    if v_attempt.locked_until is not null and v_attempt.locked_until > v_now then
      v_error := 'PIN-Eingabe vorübergehend gesperrt. Versuche es in ' ||
        greatest(1, ceil(extract(epoch from (v_attempt.locked_until - v_now)))::integer) || ' Sekunden erneut.';
      return query select false, null::timestamptz, v_error;
      return;
    end if;

    if v_attempt.window_started_at <= v_now - interval '15 minutes' then
      update public.online_slot_bank_pin_attempts as a
         set failed_count = 0, window_started_at = v_now, locked_until = null, updated_at = v_now
       where a.player_id = v_uid
       returning a.* into v_attempt;
    end if;

    if p_current_pin is null
       or p_current_pin !~ '^[0-9]{6}$'
       or crypt(p_current_pin, v_bank.bank_pin_hash) <> v_bank.bank_pin_hash then
      v_failed_count := least(5, v_attempt.failed_count + 1);
      v_locked_until := case when v_failed_count >= 5 then v_now + interval '15 minutes' else null end;
      update public.online_slot_bank_pin_attempts as a
         set failed_count = v_failed_count,
             locked_until = v_locked_until,
             updated_at = v_now
       where a.player_id = v_uid;
      if v_locked_until is not null then
        v_error := 'Fünf falsche PIN-Eingaben. Die PIN-Eingabe ist 15 Minuten gesperrt.';
      else
        v_error := 'Die bisherige Bank-PIN ist nicht richtig. Noch ' || (5 - v_failed_count) || ' Versuche.';
      end if;
      return query select false, null::timestamptz, v_error;
      return;
    end if;
  end if;

  update public.online_slot_bank_accounts as b
     set bank_pin_hash = crypt(p_new_pin, gen_salt('bf', 10)),
         pin_updated_at = v_now,
         updated_at = v_now
   where b.player_id = v_uid;

  delete from public.online_slot_bank_pin_attempts as a
  where a.player_id = v_uid;
  delete from public.online_slot_bank_pin_resets as r
  where r.player_id = v_uid;

  return query select true, v_now, null::text;
end;
$$;
revoke all on function public.set_slot_bank_pin(text, text) from public, anon;
grant execute on function public.set_slot_bank_pin(text, text) to authenticated;

-- Start a 30-minute waiting period. Repeated clicks do not extend an active wait.
create or replace function public.request_slot_bank_pin_reset()
returns table(available_at timestamptz, seconds_remaining integer)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_hash text;
  v_available timestamptz;
begin
  if v_uid is null then
    raise exception 'Bitte melde dich erneut an.';
  end if;

  select b.bank_pin_hash into v_hash
  from public.online_slot_bank_accounts as b
  where b.player_id = v_uid
  for update;

  if v_hash is null then
    raise exception 'Für dein Konto ist noch keine Bank-PIN eingerichtet. Lege zuerst eine PIN fest.';
  end if;

  insert into public.online_slot_bank_pin_resets as current_reset(player_id, requested_at, available_at)
  values (v_uid, v_now, v_now + interval '30 minutes')
  on conflict (player_id) do update
    set requested_at = case
          when current_reset.available_at <= v_now then v_now
          else current_reset.requested_at
        end,
        available_at = case
          when current_reset.available_at <= v_now then v_now + interval '30 minutes'
          else current_reset.available_at
        end
  returning current_reset.available_at into v_available;

  return query
  select v_available,
         greatest(0, ceil(extract(epoch from (v_available - v_now)))::integer);
end;
$$;
revoke all on function public.request_slot_bank_pin_reset() from public, anon;
grant execute on function public.request_slot_bank_pin_reset() to authenticated;

drop function if exists public.transfer_slot_bank_to_player(text, bigint, text, text);
create function public.transfer_slot_bank_to_player(
  p_recipient_name text,
  p_amount bigint,
  p_pin text,
  p_mode text
)
returns table(
  transfer_id bigint,
  transfer_mode text,
  gross_amount bigint,
  recipient_amount bigint,
  fee_amount bigint,
  sender_bank_balance bigint,
  recipient_name text,
  transfer_status text,
  scheduled_for timestamptz,
  error_message text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_sender uuid := auth.uid();
  v_recipient uuid;
  v_recipient_name text;
  v_fee_owner uuid;
  v_fee bigint := 0;
  v_receive bigint;
  v_sender_bank public.online_slot_bank_accounts%rowtype;
  v_recipient_bank public.online_slot_bank_accounts%rowtype;
  v_fee_bank public.online_slot_bank_accounts%rowtype;
  v_match_count integer;
  v_transfer_id bigint;
  v_mode text := lower(coalesce(p_mode, ''));
  v_status text;
  v_due timestamptz;
  v_now timestamptz := now();
  v_max constant bigint := 9000000000000000;
  v_attempt public.online_slot_bank_pin_attempts%rowtype;
  v_failed_count integer;
  v_locked_until timestamptz;
  v_error text;
begin
  if v_sender is null then raise exception 'Bitte melde dich erneut an.'; end if;
  if v_mode not in ('instant','delayed') then raise exception 'Bitte wähle eine gültige Überweisungsart.'; end if;
  if p_amount is null or p_amount < 1 or p_amount > v_max then raise exception 'Bitte gib einen gültigen Betrag ein.'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'Bitte gib deine sechsstellige Bank-PIN ein.'; end if;
  if p_recipient_name is null or length(trim(p_recipient_name)) < 2 then raise exception 'Bitte gib den Spielernamen des Empfängers ein.'; end if;

  select count(*) into v_match_count
  from public.online_slot_scores as s
  where lower(btrim(s.display_name)) = lower(btrim(p_recipient_name));
  if v_match_count = 0 then raise exception 'Dieser Spielername wurde nicht gefunden. Prüfe die Schreibweise.'; end if;
  if v_match_count > 1 then raise exception 'Dieser Spielername ist nicht eindeutig. Der Empfänger muss einen eindeutigen Spielernamen wählen.'; end if;
  select s.player_id, s.display_name into v_recipient, v_recipient_name
  from public.online_slot_scores as s
  where lower(btrim(s.display_name)) = lower(btrim(p_recipient_name));
  if v_recipient = v_sender then raise exception 'Du kannst keine Coins an dich selbst überweisen.'; end if;

  insert into public.online_slot_bank_accounts(player_id) values (v_sender) on conflict (player_id) do nothing;
  insert into public.online_slot_bank_accounts(player_id) values (v_recipient) on conflict (player_id) do nothing;

  -- Resolve the bank-fee account first, then lock every affected account in one stable order.
  if v_mode = 'instant' then
    select count(*) into v_match_count
    from public.online_slot_scores as s
    where lower(btrim(s.display_name)) = 'kamar303';
    if v_match_count <> 1 then
      raise exception 'Sofortüberweisung ist nicht verfügbar: Es muss genau einen Spieler mit dem Namen Kamar303 geben.';
    end if;
    select s.player_id into v_fee_owner
    from public.online_slot_scores as s
    where lower(btrim(s.display_name)) = 'kamar303';
    insert into public.online_slot_bank_accounts(player_id) values (v_fee_owner) on conflict (player_id) do nothing;
  end if;

  perform b.player_id
  from public.online_slot_bank_accounts as b
  where b.player_id = v_sender or b.player_id = v_recipient or (v_mode = 'instant' and b.player_id = v_fee_owner)
  order by b.player_id
  for update;

  select b.* into v_sender_bank from public.online_slot_bank_accounts as b where b.player_id = v_sender;
  select b.* into v_recipient_bank from public.online_slot_bank_accounts as b where b.player_id = v_recipient;
  if v_sender_bank.bank_pin_hash is null then raise exception 'Richte zuerst im Geldautomaten deine sechsstellige Bank-PIN ein.'; end if;

  insert into public.online_slot_bank_pin_attempts(player_id)
  values (v_sender)
  on conflict (player_id) do nothing;

  select a.* into v_attempt
  from public.online_slot_bank_pin_attempts as a
  where a.player_id = v_sender
  for update;

  if v_attempt.locked_until is not null and v_attempt.locked_until > v_now then
    v_error := 'PIN-Eingabe vorübergehend gesperrt. Versuche es in ' ||
      greatest(1, ceil(extract(epoch from (v_attempt.locked_until - v_now)))::integer) || ' Sekunden erneut.';
    return query select null::bigint, v_mode, p_amount, null::bigint, null::bigint,
                        v_sender_bank.bank_balance, v_recipient_name, 'rejected'::text,
                        null::timestamptz, v_error;
    return;
  end if;

  if v_attempt.window_started_at <= v_now - interval '15 minutes' then
    update public.online_slot_bank_pin_attempts as a
       set failed_count = 0, window_started_at = v_now, locked_until = null, updated_at = v_now
     where a.player_id = v_sender
     returning a.* into v_attempt;
  end if;

  if crypt(p_pin, v_sender_bank.bank_pin_hash) <> v_sender_bank.bank_pin_hash then
    v_failed_count := least(5, v_attempt.failed_count + 1);
    v_locked_until := case when v_failed_count >= 5 then v_now + interval '15 minutes' else null end;
    update public.online_slot_bank_pin_attempts as a
       set failed_count = v_failed_count,
           locked_until = v_locked_until,
           updated_at = v_now
     where a.player_id = v_sender;
    if v_locked_until is not null then
      v_error := 'Fünf falsche PIN-Eingaben. Die PIN-Eingabe ist 15 Minuten gesperrt.';
    else
      v_error := 'Die Bank-PIN ist nicht richtig. Noch ' || (5 - v_failed_count) || ' Versuche.';
    end if;
    return query select null::bigint, v_mode, p_amount, null::bigint, null::bigint,
                        v_sender_bank.bank_balance, v_recipient_name, 'rejected'::text,
                        null::timestamptz, v_error;
    return;
  end if;

  update public.online_slot_bank_pin_attempts as a
     set failed_count = 0, window_started_at = v_now, locked_until = null, updated_at = v_now
   where a.player_id = v_sender;

  if p_amount > v_sender_bank.bank_balance then raise exception 'In deiner Bank liegen nicht genug Coins.'; end if;

  if v_mode = 'instant' then
    v_fee := (p_amount * 5) / 100;
    v_receive := p_amount - v_fee;
    select b.* into v_fee_bank from public.online_slot_bank_accounts as b where b.player_id = v_fee_owner;
    if v_fee_owner <> v_sender and v_fee_owner <> v_recipient and v_fee_bank.bank_balance > v_max - v_fee then raise exception 'Das Kamar303-Bankkonto hat sein Coin-Limit erreicht.'; end if;
    if v_recipient = v_fee_owner then
      if v_recipient_bank.bank_balance > v_max - p_amount then raise exception 'Das Bankkonto des Empfängers hat sein Speicherlimit erreicht.'; end if;
    elsif v_recipient_bank.bank_balance > v_max - v_receive then
      raise exception 'Das Bankkonto des Empfängers hat sein Speicherlimit erreicht.';
    end if;

    update public.online_slot_bank_accounts as b
       set bank_balance = b.bank_balance - p_amount,
           updated_at = v_now
     where b.player_id = v_sender
     returning b.* into v_sender_bank;
    update public.online_slot_bank_accounts as b
       set bank_balance = b.bank_balance + v_receive,
           updated_at = v_now
     where b.player_id = v_recipient
     returning b.* into v_recipient_bank;
    if v_fee > 0 then
      update public.online_slot_bank_accounts as b
         set bank_balance = b.bank_balance + v_fee,
             updated_at = v_now
       where b.player_id = v_fee_owner;
    end if;
    v_status := 'completed';
    v_due := v_now;
  else
    v_fee := 0;
    v_receive := p_amount;
    v_due := v_now + interval '1 hour';
    update public.online_slot_bank_accounts as b
       set bank_balance = b.bank_balance - p_amount,
           updated_at = v_now
     where b.player_id = v_sender
     returning b.* into v_sender_bank;
    v_status := 'pending';
  end if;

  insert into public.online_slot_bank_transfers(
    sender_id, recipient_id, gross_amount, recipient_amount, fee_amount,
    transfer_mode, status, created_at, scheduled_for, completed_at
  ) values (
    v_sender, v_recipient, p_amount, v_receive, v_fee,
    v_mode, v_status, v_now, case when v_mode = 'delayed' then v_due else null end,
    case when v_mode = 'instant' then v_now else null end
  ) returning id into v_transfer_id;

  return query
  select v_transfer_id, v_mode, p_amount, v_receive, v_fee,
         v_sender_bank.bank_balance, v_recipient_name, v_status,
         case when v_mode = 'delayed' then v_due else null end,
         null::text;
end;
$$;
revoke all on function public.transfer_slot_bank_to_player(text, bigint, text, text) from public, anon;
grant execute on function public.transfer_slot_bank_to_player(text, bigint, text, text) to authenticated;


comment on function public.transfer_slot_bank_to_player(text,bigint,text,text) is 'PIN protected atomic virtual coin transfer with a five-attempt rate limit. Instant mode charges a 5 percent fee to the unique Kamar303 bank account; delayed mode credits after one hour without a fee.';

-- Return only the logged-in player's reset deadline; no row means no reset is pending.
create or replace function public.get_slot_bank_pin_reset_status()
returns table(available_at timestamptz, seconds_remaining integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Bitte melde dich erneut an.';
  end if;

  return query
  select r.available_at,
         greatest(0, ceil(extract(epoch from (r.available_at - now())))::integer)
  from public.online_slot_bank_pin_resets as r
  where r.player_id = v_uid;
end;
$$;
revoke all on function public.get_slot_bank_pin_reset_status() from public, anon;
grant execute on function public.get_slot_bank_pin_reset_status() to authenticated;

-- The deadline is checked on the server, so changing the browser clock cannot skip the wait.
create or replace function public.reset_slot_bank_pin(p_new_pin text)
returns table(pin_enabled boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_bank public.online_slot_bank_accounts%rowtype;
  v_available timestamptz;
begin
  if v_uid is null then
    raise exception 'Bitte melde dich erneut an.';
  end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{6}$' then
    raise exception 'Die neue Bank-PIN muss aus genau sechs Ziffern bestehen.';
  end if;

  select b.* into v_bank
  from public.online_slot_bank_accounts as b
  where b.player_id = v_uid
  for update;

  if v_bank.player_id is null or v_bank.bank_pin_hash is null then
    raise exception 'Für dein Konto ist keine bestehende Bank-PIN vorhanden. Nutze die normale PIN-Einrichtung.';
  end if;

  select r.available_at into v_available
  from public.online_slot_bank_pin_resets as r
  where r.player_id = v_uid
  for update;

  if v_available is null then
    raise exception 'Du hast keine PIN-Zurücksetzung gestartet. Starte zuerst die 30-minütige Wartezeit.';
  end if;
  if v_now < v_available then
    raise exception 'Die Wartezeit ist noch nicht vorbei. Bitte warte noch % Sekunden.',
      greatest(1, ceil(extract(epoch from (v_available - v_now)))::integer);
  end if;

  update public.online_slot_bank_accounts as b
     set bank_pin_hash = crypt(p_new_pin, gen_salt('bf', 10)),
         pin_updated_at = v_now,
         updated_at = v_now
   where b.player_id = v_uid;

  delete from public.online_slot_bank_pin_attempts as a
  where a.player_id = v_uid;
  delete from public.online_slot_bank_pin_resets as r
  where r.player_id = v_uid;

  return query select true, v_now;
end;
$$;
revoke all on function public.reset_slot_bank_pin(text) from public, anon;
grant execute on function public.reset_slot_bank_pin(text) to authenticated;

comment on table public.online_slot_bank_pin_resets is
  'Pending forgotten virtual bank PIN resets. The server enforces a 30-minute wait.';
comment on function public.request_slot_bank_pin_reset() is
  'Starts or reads a 30-minute forgotten PIN wait; repeated clicks cannot extend an active wait.';
comment on function public.reset_slot_bank_pin(text) is
  'Replaces the current virtual bank PIN only after the server-side 30-minute recovery wait.';
comment on function public.set_slot_bank_pin(text,text) is
  'Sets or changes the virtual bank PIN; five incorrect current-PIN attempts trigger a 15-minute lockout.';

notify pgrst, 'reload schema';
