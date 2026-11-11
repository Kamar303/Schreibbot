-- v93: recipient thank-you notifications for completed virtual coin transfers.
alter table public.online_slot_bank_transfers
  add column if not exists thanked_at timestamptz,
  add column if not exists thank_emoji text;

create or replace function public.get_slot_transfer_notifications()
returns table(transfer_id bigint, sender_name text, amount bigint, created_at timestamptz)
language sql security definer set search_path=public,pg_temp as $$
  select t.id, coalesce(s.display_name,'Spieler'), t.recipient_amount, t.completed_at
  from public.online_slot_bank_transfers t
  left join public.online_slot_scores s on s.player_id=t.sender_id
  where t.recipient_id=auth.uid() and t.status='completed' and t.thanked_at is null
  order by t.completed_at desc nulls last limit 5;
$$;

create or replace function public.thank_slot_transfer(p_transfer_id bigint, p_emoji text default '❤️')
returns table(ok boolean, sender_name text, thank_emoji text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sender uuid; v_name text; v_emoji text;
begin
  if auth.uid() is null then raise exception 'Bitte melde dich erneut an.'; end if;
  v_emoji := case when p_emoji in ('❤️','💚','💙','🙏','😊') then p_emoji else '❤️' end;
  update public.online_slot_bank_transfers t set thanked_at=now(), thank_emoji=v_emoji
  where t.id=p_transfer_id and t.recipient_id=auth.uid() and t.status='completed' and t.thanked_at is null
  returning t.sender_id into v_sender;
  if v_sender is null then raise exception 'Diese Überweisung ist nicht mehr verfügbar.'; end if;
  select s.display_name into v_name from public.online_slot_scores s where s.player_id=v_sender limit 1;
  return query select true, coalesce(v_name,'Spieler'), v_emoji;
end; $$;

create or replace function public.get_slot_transfer_thanks()
returns table(transfer_id bigint, recipient_name text, thank_emoji text, thanked_at timestamptz)
language sql security definer set search_path=public,pg_temp as $$
  select t.id, coalesce(s.display_name,'Spieler'), t.thank_emoji, t.thanked_at
  from public.online_slot_bank_transfers t
  left join public.online_slot_scores s on s.player_id=t.recipient_id
  where t.sender_id=auth.uid() and t.thanked_at is not null
  order by t.thanked_at desc limit 10;
$$;

revoke all on function public.get_slot_transfer_notifications() from public,anon;
revoke all on function public.thank_slot_transfer(bigint,text) from public,anon;
revoke all on function public.get_slot_transfer_thanks() from public,anon;
grant execute on function public.get_slot_transfer_notifications() to authenticated;
grant execute on function public.thank_slot_transfer(bigint,text) to authenticated;
grant execute on function public.get_slot_transfer_thanks() to authenticated;
