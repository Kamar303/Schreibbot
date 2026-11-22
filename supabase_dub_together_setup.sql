-- Dub Together: private, room-based multiplayer dubbing for Schreibbot.
-- Run once in the Supabase SQL Editor. Requires Supabase Auth + Storage.

create table if not exists public.dub_together_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null,
  status text not null default 'waiting' check (status in ('waiting','recording','reveal','finished')),
  mode text not null default 'parallel' check (mode in ('parallel','character','scenario')),
  is_public boolean not null default false,
  clip jsonb not null default '{}'::jsonb,
  script jsonb not null default '[]'::jsonb,
  players jsonb not null default '[]'::jsonb,
  assignments jsonb not null default '{}'::jsonb,
  recordings jsonb not null default '{}'::jsonb,
  submissions jsonb not null default '{}'::jsonb,
  votes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dub_together_rooms enable row level security;
revoke all on table public.dub_together_rooms from public, anon, authenticated;

-- Media is private. Files are stored under <room-code>/clips/<uploader-id>/... or
-- <room-code>/voices/<uploader-id>/.... Room members can read; users can upload only
-- into their own folder. Membership checks are done by a SECURITY DEFINER helper.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dub-media', 'dub-media', false, 26214400,
  array['video/mp4','video/webm','video/quicktime','audio/webm','audio/mp4','audio/ogg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.dub_room_member(p_code text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.dub_together_rooms r
    where r.code = upper(coalesce(p_code, ''))
      and (
        r.host_id = auth.uid()
        or exists (
          select 1
          from jsonb_array_elements(coalesce(r.players, '[]'::jsonb)) as p(player)
          where p.player ->> 'id' = auth.uid()::text
        )
      )
  );
$$;
revoke all on function public.dub_room_member(text) from public, anon;
grant execute on function public.dub_room_member(text) to authenticated;

create or replace function public.dub_room_host(p_code text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.dub_together_rooms r
    where r.code = upper(coalesce(p_code, '')) and r.host_id = auth.uid()
  );
$$;
revoke all on function public.dub_room_host(text) from public, anon;
grant execute on function public.dub_room_host(text) to authenticated;

-- Supabase Storage policies.
drop policy if exists "Dub members can read room media" on storage.objects;
create policy "Dub members can read room media"
on storage.objects for select to authenticated
using (
  bucket_id = 'dub-media'
  and public.dub_room_member((storage.foldername(name))[1])
);

drop policy if exists "Dub players upload to own folder" on storage.objects;
create policy "Dub players upload to own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'dub-media'
  and public.dub_room_member((storage.foldername(name))[1])
  and (storage.foldername(name))[2] in ('clips','voices')
  and (storage.foldername(name))[3] = auth.uid()::text
);

drop policy if exists "Dub players update own folder" on storage.objects;
create policy "Dub players update own folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'dub-media'
  and public.dub_room_member((storage.foldername(name))[1])
  and (storage.foldername(name))[2] in ('clips','voices')
  and (storage.foldername(name))[3] = auth.uid()::text
)
with check (
  bucket_id = 'dub-media'
  and public.dub_room_member((storage.foldername(name))[1])
  and (storage.foldername(name))[2] in ('clips','voices')
  and (storage.foldername(name))[3] = auth.uid()::text
);

drop policy if exists "Dub players delete own media or host deletes room media" on storage.objects;
create policy "Dub players delete own media or host deletes room media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'dub-media'
  and public.dub_room_member((storage.foldername(name))[1])
  and (storage.foldername(name))[2] in ('clips','voices')
  and (
    (storage.foldername(name))[3] = auth.uid()::text
    or public.dub_room_host((storage.foldername(name))[1])
  )
);

create or replace function public.create_dub_room(
  p_code text,
  p_name text,
  p_mode text,
  p_is_public boolean,
  p_clip jsonb,
  p_script jsonb
)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_mode text := coalesce(p_mode, 'parallel');
  v_name text := left(regexp_replace(coalesce(p_name, 'Spieler'), '[[:cntrl:]]', '', 'g'), 20);
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  if v_code !~ '^[A-Z0-9]{6}$' then raise exception 'Ungültiger sechsstelliger Raumcode'; end if;
  if v_mode not in ('parallel','character','scenario') then raise exception 'Ungültiger Spielmodus'; end if;
  if jsonb_typeof(coalesce(p_script, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Das Skript muss als Liste mit 1 bis 60 Zeilen übergeben werden';
  end if;
  if jsonb_array_length(coalesce(p_script, '[]'::jsonb)) < 1
     or jsonb_array_length(coalesce(p_script, '[]'::jsonb)) > 60 then
    raise exception 'Das Skript muss 1 bis 60 Zeilen enthalten';
  end if;

  insert into public.dub_together_rooms (
    code, host_id, mode, is_public, clip, script, players
  ) values (
    v_code, auth.uid(), v_mode, coalesce(p_is_public, false),
    coalesce(p_clip, '{}'::jsonb), p_script,
    jsonb_build_array(jsonb_build_object('id', auth.uid()::text, 'name', coalesce(nullif(trim(v_name), ''), 'Spieler')))
  );
  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;

create or replace function public.join_dub_room(p_code text, p_name text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_players jsonb;
  v_name text := left(regexp_replace(coalesce(p_name, 'Spieler'), '[[:cntrl:]]', '', 'g'), 20);
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  select * into v_room from public.dub_together_rooms where code = v_code for update;
  if not found then raise exception 'Lobby nicht gefunden'; end if;
  v_players := coalesce(v_room.players, '[]'::jsonb);

  if exists (
    select 1 from jsonb_array_elements(v_players) as p(player)
    where p.player ->> 'id' = auth.uid()::text
  ) then
    return query select * from public.dub_together_rooms where code = v_code;
    return;
  end if;
  if v_room.status <> 'waiting' then raise exception 'Diese Runde hat bereits begonnen'; end if;
  if jsonb_array_length(v_players) >= 15 then raise exception 'Diese Lobby ist bereits voll (15 Spieler)'; end if;

  update public.dub_together_rooms
  set players = v_players || jsonb_build_array(jsonb_build_object('id', auth.uid()::text, 'name', coalesce(nullif(trim(v_name), ''), 'Spieler'))),
      updated_at = now()
  where code = v_code;
  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;

create or replace function public.get_dub_room(p_code text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_code text := upper(coalesce(p_code, ''));
begin
  if auth.uid() is null or not public.dub_room_member(v_code) then raise exception 'Kein Zugriff auf diese Lobby'; end if;
  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;

create or replace function public.list_public_dub_rooms()
returns table(code text, mode text, mode_label text, player_count integer, created_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.code, r.mode,
    case r.mode when 'parallel' then 'Parallel' when 'character' then 'Charakter' else 'Szenario' end,
    jsonb_array_length(coalesce(r.players, '[]'::jsonb))::integer,
    r.created_at
  from public.dub_together_rooms r
  where r.is_public = true and r.status = 'waiting'
  order by r.created_at desc
  limit 30;
$$;

create or replace function public.set_dub_mode(p_code text, p_mode text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_code text := upper(coalesce(p_code, ''));
begin
  if not public.dub_room_member(v_code) then raise exception 'Kein Zugriff auf diese Lobby'; end if;
  if not exists (select 1 from public.dub_together_rooms where code=v_code and host_id=auth.uid() and status='waiting') then
    raise exception 'Nur der Host kann den Modus vor Rundenstart ändern';
  end if;
  if p_mode not in ('parallel','character','scenario') then raise exception 'Ungültiger Spielmodus'; end if;
  update public.dub_together_rooms set mode=p_mode, updated_at=now() where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.set_dub_clip(p_code text, p_clip jsonb, p_script jsonb)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_clip jsonb := coalesce(p_clip, '{}'::jsonb);
  v_script jsonb := coalesce(p_script, '[]'::jsonb);
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.host_id <> auth.uid() or v_room.status <> 'waiting' then raise exception 'Nur der Lobby-Host kann Clip und Skript vor der Runde ändern'; end if;
  if jsonb_typeof(v_script) is distinct from 'array' then
    raise exception 'Das Skript muss als Liste übergeben werden';
  end if;
  if jsonb_array_length(v_script) < 1 or jsonb_array_length(v_script) > 60 then
    raise exception 'Das Skript muss 1 bis 60 Dialogzeilen enthalten';
  end if;
  if jsonb_typeof(v_clip->'roles') is distinct from 'array' then
    raise exception 'Die Personen/Rollen müssen als Liste übergeben werden';
  end if;
  if jsonb_array_length(v_clip->'roles') < 1 or jsonb_array_length(v_clip->'roles') > 12 then
    raise exception 'Es müssen 1 bis 12 Personen/Rollen vorhanden sein';
  end if;
  if coalesce(v_clip->>'path','') <> '' and (
    split_part(v_clip->>'path','/',1) <> v_code
    or split_part(v_clip->>'path','/',2) <> 'clips'
    or split_part(v_clip->>'path','/',3) <> auth.uid()::text
    or coalesce(v_clip->>'rights_confirmed','false') <> 'true'
  ) then raise exception 'Clip-Pfad oder Rechtebestätigung ungültig'; end if;

  if exists (
    select 1 from jsonb_array_elements(v_script) as line(item)
    where length(coalesce(line.item->>'text','')) > 240
       or not exists (
         select 1 from jsonb_array_elements(v_clip->'roles') as role(item)
         where role.item->>'id' = line.item->>'role'
       )
  ) then raise exception 'Eine Dialogzeile ist zu lang oder einer ungültigen Rolle zugewiesen'; end if;

  update public.dub_together_rooms set clip=v_clip, script=v_script, updated_at=now() where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.assign_dub_role(p_code text, p_role text, p_player_id uuid)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_assigned_id text;
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.status <> 'waiting' or not public.dub_room_member(v_code) then raise exception 'Nur Lobby-Mitglieder können vor Rundenstart Rollen auswählen'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_room.clip->'roles','[]'::jsonb)) as role(item)
    where role.item->>'id' = p_role
  ) then raise exception 'Diese Person/Rolle gibt es im Clip nicht'; end if;
  v_assigned_id := coalesce(v_room.assignments->>p_role, '');
  if auth.uid() <> v_room.host_id then
    if p_player_id is not null and p_player_id <> auth.uid() then raise exception 'Du kannst nur dich selbst als Sprecher auswählen'; end if;
    if v_assigned_id <> '' and v_assigned_id <> auth.uid()::text then raise exception 'Diese Rolle wurde bereits von einem anderen Spieler übernommen'; end if;
  end if;
  if p_player_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(v_room.players,'[]'::jsonb)) as p(player)
    where p.player->>'id' = p_player_id::text
  ) then raise exception 'Dieser Spieler ist nicht in der Lobby'; end if;

  update public.dub_together_rooms
  set assignments = case when p_player_id is null then coalesce(assignments,'{}'::jsonb) - p_role
                         else coalesce(assignments,'{}'::jsonb) || jsonb_build_object(p_role,p_player_id::text) end,
      updated_at=now()
  where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.start_dub_round(p_code text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_code text := upper(coalesce(p_code, '')); v_room public.dub_together_rooms%rowtype;
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.host_id <> auth.uid() or v_room.status <> 'waiting' then raise exception 'Nur der Host kann die Runde starten'; end if;
  if jsonb_array_length(coalesce(v_room.players,'[]'::jsonb)) < 2 then raise exception 'Mindestens zwei Spieler werden benötigt'; end if;
  if jsonb_array_length(coalesce(v_room.script,'[]'::jsonb)) < 1 then raise exception 'Das Skript ist leer'; end if;
  update public.dub_together_rooms set status='recording', updated_at=now() where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.save_dub_recording(
  p_code text, p_line_id text, p_scope text, p_path text, p_duration_ms integer, p_effect text
)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_line jsonb;
  v_key text;
  v_scope text := coalesce(p_scope, '');
  v_effect text := coalesce(p_effect, 'original');
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.status <> 'recording' then raise exception 'Die Runde nimmt gerade keine Aufnahmen an'; end if;
  if not public.dub_room_member(v_code) then raise exception 'Du bist nicht in dieser Lobby'; end if;
  if v_scope not in ('parallel','character') then raise exception 'Ungültiger Aufnahmemodus'; end if;
  if v_effect not in ('original','chipmunk','monster','echo','robot','phone') then raise exception 'Ungültiger Stimmeffekt'; end if;
  if coalesce(p_duration_ms,0) < 250 or p_duration_ms > 180000 then raise exception 'Aufnahmen müssen zwischen 0,25 Sekunden und 3 Minuten liegen'; end if;
  if split_part(coalesce(p_path,''),'/',1) <> v_code
     or split_part(p_path,'/',2) <> 'voices'
     or split_part(p_path,'/',3) <> auth.uid()::text then raise exception 'Die Aufnahme muss in deinen eigenen Lobby-Ordner hochgeladen werden'; end if;

  select item into v_line from jsonb_array_elements(coalesce(v_room.script,'[]'::jsonb)) as line(item)
  where item->>'id' = p_line_id;
  if v_line is null then raise exception 'Dialogzeile nicht gefunden'; end if;

  if v_room.mode = 'parallel' then
    if v_scope <> 'parallel' then raise exception 'Diese Runde erwartet parallele Aufnahmen'; end if;
    v_key := 'parallel:' || auth.uid()::text || ':' || p_line_id;
  else
    if v_scope <> 'character' then raise exception 'Diese Runde erwartet Rollen-Aufnahmen'; end if;
    if v_room.assignments->>(v_line->>'role') <> auth.uid()::text then raise exception 'Diese Dialogzeile ist einem anderen Spieler oder der Originalstimme zugewiesen'; end if;
    v_key := 'character:' || p_line_id;
  end if;

  update public.dub_together_rooms
  set recordings = coalesce(recordings,'{}'::jsonb) || jsonb_build_object(v_key,jsonb_build_object(
        'path',p_path,'effect',v_effect,'duration_ms',p_duration_ms,'owner_id',auth.uid()::text
      )),
      updated_at=now()
  where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.finish_dub_version(p_code text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_uid text := auth.uid()::text;
  v_submissions jsonb;
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.status <> 'recording' or v_room.mode <> 'parallel' then raise exception 'Diese Runde kann nicht als parallele Version abgegeben werden'; end if;
  if not public.dub_room_member(v_code) then raise exception 'Du bist nicht in dieser Lobby'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_room.script) as line(item)
    where coalesce(v_room.recordings->('parallel:' || v_uid || ':' || (line.item->>'id'))->>'path','') = ''
  ) then raise exception 'Nimm zuerst jede Dialogzeile deiner Version auf'; end if;

  v_submissions := coalesce(v_room.submissions,'{}'::jsonb) || jsonb_build_object(v_uid,true);
  update public.dub_together_rooms
  set submissions=v_submissions,
      status=case when (select count(*) from jsonb_array_elements(v_room.players) as p(player) where coalesce(v_submissions->>(p.player->>'id'),'false')='true') = jsonb_array_length(v_room.players) then 'reveal' else 'recording' end,
      updated_at=now()
  where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.finish_dub_round(p_code text)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_code text := upper(coalesce(p_code, '')); v_room public.dub_together_rooms%rowtype;
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.host_id <> auth.uid() or v_room.status <> 'recording' or v_room.mode='parallel' then raise exception 'Nur der Host kann diese gemeinsame Fassung beenden'; end if;
  if not exists (select 1 from jsonb_each(coalesce(v_room.recordings,'{}'::jsonb))) then raise exception 'Es gibt noch keine Sprachaufnahmen'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_room.script) as line(item)
    where coalesce(v_room.assignments->>(line.item->>'role'),'') <> ''
      and coalesce(v_room.recordings->('character:' || (line.item->>'id'))->>'path','') = ''
  ) then raise exception 'Für jede zugewiesene Person muss mindestens ihre Dialogzeile aufgenommen sein'; end if;
  update public.dub_together_rooms set status='reveal', updated_at=now() where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.vote_dub_version(p_code text, p_candidate_id uuid)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_votes jsonb;
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or v_room.mode <> 'parallel' or v_room.status not in ('reveal','finished') then raise exception 'Abstimmung ist noch nicht geöffnet'; end if;
  if not public.dub_room_member(v_code) then raise exception 'Du bist nicht in dieser Lobby'; end if;
  if p_candidate_id is null or p_candidate_id = auth.uid() then raise exception 'Du kannst nicht für deine eigene Version stimmen'; end if;
  if coalesce(v_room.submissions->>p_candidate_id::text,'false') <> 'true' then raise exception 'Diese Version wurde noch nicht abgegeben'; end if;
  v_votes := coalesce(v_room.votes,'{}'::jsonb) || jsonb_build_object(auth.uid()::text,p_candidate_id::text);
  update public.dub_together_rooms
  set votes=v_votes,
      status=case when jsonb_object_length(v_votes) >= jsonb_array_length(v_room.players) then 'finished' else v_room.status end,
      updated_at=now()
  where code=v_code;
  return query select * from public.dub_together_rooms where code=v_code;
end;
$$;

create or replace function public.leave_dub_room(p_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_room public.dub_together_rooms%rowtype;
  v_players jsonb;
  v_assignments jsonb;
  v_recordings jsonb;
  v_submissions jsonb;
  v_votes jsonb;
begin
  select * into v_room from public.dub_together_rooms where code=v_code for update;
  if not found or not public.dub_room_member(v_code) then return; end if;

  -- Media is removed by the browser through the Supabase Storage API before
  -- this membership mutation. Never delete storage.objects rows directly here.
  if v_room.host_id = auth.uid() then
    delete from public.dub_together_rooms where code=v_code;
    return;
  end if;

  select coalesce(jsonb_agg(p.player),'[]'::jsonb) into v_players
  from jsonb_array_elements(coalesce(v_room.players,'[]'::jsonb)) as p(player)
  where p.player->>'id' <> auth.uid()::text;
  select coalesce(jsonb_object_agg(k.key,k.value),'{}'::jsonb) into v_assignments
  from jsonb_each(coalesce(v_room.assignments,'{}'::jsonb)) as k(key,value)
  where k.value #>> '{}' <> auth.uid()::text;
  select coalesce(jsonb_object_agg(k.key,k.value),'{}'::jsonb) into v_recordings
  from jsonb_each(coalesce(v_room.recordings,'{}'::jsonb)) as k(key,value)
  where k.value->>'owner_id' <> auth.uid()::text;
  v_submissions := coalesce(v_room.submissions,'{}'::jsonb) - auth.uid()::text;
  select coalesce(jsonb_object_agg(k.key,k.value),'{}'::jsonb) into v_votes
  from jsonb_each(coalesce(v_room.votes,'{}'::jsonb)) as k(key,value)
  where k.key <> auth.uid()::text and k.value #>> '{}' <> auth.uid()::text;

  update public.dub_together_rooms
  set players=v_players, assignments=v_assignments, recordings=v_recordings,
      submissions=v_submissions, votes=v_votes, updated_at=now()
  where code=v_code;
end;
$$;

-- RPCs are the only public interface to room data.
revoke all on function public.create_dub_room(text,text,text,boolean,jsonb,jsonb) from public, anon;
revoke all on function public.join_dub_room(text,text) from public, anon;
revoke all on function public.get_dub_room(text) from public, anon;
revoke all on function public.list_public_dub_rooms() from public, anon;
revoke all on function public.set_dub_mode(text,text) from public, anon;
revoke all on function public.set_dub_clip(text,jsonb,jsonb) from public, anon;
revoke all on function public.assign_dub_role(text,text,uuid) from public, anon;
revoke all on function public.start_dub_round(text) from public, anon;
revoke all on function public.save_dub_recording(text,text,text,text,integer,text) from public, anon;
revoke all on function public.finish_dub_version(text) from public, anon;
revoke all on function public.finish_dub_round(text) from public, anon;
revoke all on function public.vote_dub_version(text,uuid) from public, anon;
revoke all on function public.leave_dub_room(text) from public, anon;

grant execute on function public.create_dub_room(text,text,text,boolean,jsonb,jsonb) to authenticated;
grant execute on function public.join_dub_room(text,text) to authenticated;
grant execute on function public.get_dub_room(text) to authenticated;
grant execute on function public.list_public_dub_rooms() to authenticated;
grant execute on function public.set_dub_mode(text,text) to authenticated;
grant execute on function public.set_dub_clip(text,jsonb,jsonb) to authenticated;
grant execute on function public.assign_dub_role(text,text,uuid) to authenticated;
grant execute on function public.start_dub_round(text) to authenticated;
grant execute on function public.save_dub_recording(text,text,text,text,integer,text) to authenticated;
grant execute on function public.finish_dub_version(text) to authenticated;
grant execute on function public.finish_dub_round(text) to authenticated;
grant execute on function public.vote_dub_version(text,uuid) to authenticated;
grant execute on function public.leave_dub_room(text) to authenticated;
grant execute on function public.dub_room_host(text) to authenticated;

notify pgrst, 'reload schema';
