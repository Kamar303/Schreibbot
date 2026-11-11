-- Schreibbot v95: Spieler dürfen ihren Anzeigenamen selbst ändern,
-- während Eindeutigkeit (case-insensitive, normalisierte Leerzeichen) serverseitig garantiert bleibt.
-- Vorherige Bank-, Spielstände- und Spieler-IDs bleiben erhalten.

begin;

-- Namen werden unabhängig von Groß-/Kleinschreibung und Mehrfach-Leerzeichen eindeutig gehalten.
drop index if exists public.online_slot_scores_display_name_unique_v92;
drop index if exists public.online_slot_scores_display_name_unique_v95;
create unique index online_slot_scores_display_name_unique_v95
  on public.online_slot_scores (
    lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g'))
  );

-- Die v92-Triggerlogik vergab IDs automatisch und blockierte danach jede Namensänderung.
-- INSERT: weiter automatisch fortlaufende Spieler-Nummer zuweisen.
-- UPDATE: Änderung nur innerhalb der kontrollierten Rename-RPC erlauben.
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
    perform pg_advisory_xact_lock(hashtext('online_slot_scores_player_number_v92'));
    select coalesce(max((substring(s.display_name from '^Spieler ([0-9]+)$'))::bigint), 0) + 1
      into v_next
      from public.online_slot_scores as s;
    new.display_name := 'Spieler ' || v_next::text;
  else
    if current_setting('app.slot_allow_display_name_change', true) is distinct from '1' then
      new.display_name := old.display_name;
    else
      new.display_name := left(regexp_replace(btrim(coalesce(new.display_name, old.display_name)), '[[:space:]]+', ' ', 'g'), 20);
    end if;
  end if;
  return new;
end;
$$;

-- Vorhandenen Trigger wiederverwenden, damit automatische Spieler-Nummern erhalten bleiben.
drop trigger if exists online_slot_scores_assign_player_number_v92 on public.online_slot_scores;
create trigger online_slot_scores_assign_player_number_v92
before insert or update of display_name on public.online_slot_scores
for each row execute function public.assign_slot_player_number_v92();

create or replace function public.set_slot_display_name(p_name text)
returns table(display_name text,total_points bigint,spins bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_row public.online_slot_scores%rowtype;
begin
  if v_uid is null then
    raise exception 'Melde dich bitte erneut an, damit dein Spielername gespeichert werden kann.';
  end if;

  -- Gleicher Lock wie bei der Nummernvergabe und bei allen Namensänderungen.
  perform pg_advisory_xact_lock(hashtext('online_slot_scores_player_number_v92'));

  -- Fehlendes Profil zunächst mit einer automatisch vergebenen Spieler-ID anlegen.
  insert into public.online_slot_scores(player_id, display_name, total_points, spins, updated_at)
  values (v_uid, 'wird automatisch vergeben', 10, 0, now())
  on conflict (player_id) do nothing;

  select s.* into v_row
    from public.online_slot_scores as s
   where s.player_id = v_uid
   for update;

  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '[<>[:cntrl:]]', ' ', 'g'), 20);
  v_name := btrim(regexp_replace(v_name, '[[:space:]]+', ' ', 'g'));

  -- Beim automatischen Erstladen wird die bereits zugeteilte Spieler-Nummer beibehalten.
  if lower(v_name) in ('', 'spieler wird zugewiesen', 'wird automatisch vergeben') then
    return query select v_row.display_name, v_row.total_points, v_row.spins;
    return;
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 20 then
    raise exception 'Der Spielername muss zwischen 2 und 20 Zeichen lang sein.';
  end if;

  if translate(lower(regexp_replace(v_name, '[^[:alnum:]]', '', 'g')), 'äöüß', 'aous')
     ~ '(arschloch|hurensohn|huso|wichser|fick|fotze|schlampe|missgeburt|bastard|nazi|hitler|nigger|kanake|kummel)' then
    raise exception 'Dieser Name enthält beleidigende oder diskriminierende Begriffe. Bitte wähle einen anderen Namen.';
  end if;

  if exists (
    select 1
      from public.online_slot_scores as other_player
     where other_player.player_id <> v_uid
       and lower(regexp_replace(btrim(other_player.display_name), '[[:space:]]+', ' ', 'g'))
           = lower(regexp_replace(btrim(v_name), '[[:space:]]+', ' ', 'g'))
  ) then
    raise exception 'Dieser Spielername ist bereits vergeben. Bitte wähle einen anderen Namen.' using errcode = '23505';
  end if;

  perform set_config('app.slot_allow_display_name_change', '1', true);
  update public.online_slot_scores as score
     set display_name = v_name,
         updated_at = now()
   where score.player_id = v_uid;
  perform set_config('app.slot_allow_display_name_change', '0', true);

  select s.* into v_row
    from public.online_slot_scores as s
   where s.player_id = v_uid;

  return query select v_row.display_name, v_row.total_points, v_row.spins;
exception
  when unique_violation then
    perform set_config('app.slot_allow_display_name_change', '0', true);
    raise exception 'Dieser Spielername ist bereits vergeben. Bitte wähle einen anderen Namen.' using errcode = '23505';
end;
$$;

revoke all on function public.assign_slot_player_number_v92() from public, anon, authenticated;
revoke all on function public.set_slot_display_name(text) from public, anon;
grant execute on function public.set_slot_display_name(text) to authenticated;

notify pgrst, 'reload schema';
commit;
