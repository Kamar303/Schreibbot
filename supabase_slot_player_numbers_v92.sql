-- Schreibbot v92: Eindeutige, automatisch vergebene Spielernamen für die Casino-Bank.
-- Alle bestehenden Spieler werden einmalig zu Spieler 1, Spieler 2, ... umbenannt.
-- Neue Spieler erhalten automatisch die nächste Nummer. Anzeigenamen sind nicht editierbar.
-- Virtuelle Coins und Kontostände bleiben unverändert.

begin;

-- Vorhandenen Trigger bei erneutem Ausführen entfernen, damit die Migration idempotent bleibt.
drop trigger if exists online_slot_scores_assign_player_number_v92 on public.online_slot_scores;

-- Nummeriert alle vorhandenen Spieler stabil nach Erstellungs-/Aktualisierungszeit und ID.
lock table public.online_slot_scores in access exclusive mode;
with numbered as (
  select s.player_id,
         row_number() over (order by s.updated_at asc, s.player_id asc) as rn
  from public.online_slot_scores as s
)
update public.online_slot_scores as s
   set display_name = 'Spieler ' || numbered.rn::text
  from numbered
 where numbered.player_id = s.player_id;

-- Eindeutigkeit unabhängig von Groß-/Kleinschreibung und Leerzeichen.
drop index if exists public.online_slot_scores_display_name_unique_v92;
create unique index online_slot_scores_display_name_unique_v92
  on public.online_slot_scores (lower(btrim(display_name)));

create or replace function public.assign_slot_player_number_v92()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next bigint;
begin
  if tg_op = 'INSERT' then
    -- Advisory Lock verhindert doppelte Nummern bei gleichzeitigen Registrierungen.
    -- MAX()+1 statt einer Sequenz verhindert Nummernlücken durch INSERT ... ON CONFLICT.
    perform pg_advisory_xact_lock(hashtext('online_slot_scores_player_number_v92'));
    select coalesce(max((substring(s.display_name from '^Spieler ([0-9]+)$'))::bigint), 0) + 1
      into v_next
      from public.online_slot_scores as s;
    new.display_name := 'Spieler ' || v_next::text;
  else
    -- Spieler können ihren Namen nicht selbst ändern; die Nummer bleibt stabil.
    new.display_name := old.display_name;
  end if;
  return new;
end;
$$;

drop trigger if exists online_slot_scores_assign_player_number_v92 on public.online_slot_scores;
create trigger online_slot_scores_assign_player_number_v92
before insert or update of display_name on public.online_slot_scores
for each row execute function public.assign_slot_player_number_v92();

-- Kompatibel mit bisherigen Frontend-Aufrufen: ignoriert den eingegebenen Namen
-- und gibt ausschließlich die automatisch zugewiesene Spieler-ID zurück.
create or replace function public.set_slot_display_name(p_name text)
returns table(display_name text,total_points bigint,spins bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then
    raise exception 'Melde dich bitte erneut an, damit dein Spielername geladen werden kann.';
  end if;

  insert into public.online_slot_scores(player_id, display_name, total_points, spins, updated_at)
  values (v_uid, 'wird automatisch vergeben', 10, 0, now())
  on conflict (player_id) do nothing;

  select s.* into v_row
    from public.online_slot_scores as s
   where s.player_id = v_uid;

  return query select v_row.display_name, v_row.total_points, v_row.spins;
end;
$$;

revoke all on function public.assign_slot_player_number_v92() from public, anon, authenticated;
revoke all on function public.set_slot_display_name(text) from public, anon;
grant execute on function public.set_slot_display_name(text) to authenticated;

notify pgrst, 'reload schema';
commit;
