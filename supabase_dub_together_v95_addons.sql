-- Dub Together v95 additions.
-- Run this AFTER supabase_dub_together_setup.sql in the Supabase SQL Editor.
-- Adds (1) Twitch community votes, (2) public text-only community packs,
-- and (3) pack reports. No media files are stored in the public pack library.

-- Twitch votes are separate from member votes so the normal lobby voting flow
-- and its completion rules remain unchanged.
alter table public.dub_together_rooms
  add column if not exists twitch_votes jsonb not null default '{}'::jsonb;

create or replace function public.vote_dub_from_twitch(
  p_code text,
  p_viewer_login text,
  p_candidate_id uuid
)
returns setof public.dub_together_rooms
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
  v_login text := lower(regexp_replace(coalesce(p_viewer_login, ''), '[^a-zA-Z0-9_]', '', 'g'));
  v_room public.dub_together_rooms%rowtype;
begin
  select * into v_room
  from public.dub_together_rooms
  where code = v_code
  for update;

  if not found then raise exception 'Dub-Lobby wurde nicht gefunden'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'Nur der Lobby-Host darf Twitch-Stimmen eintragen'; end if;
  if v_room.mode <> 'parallel' or v_room.status not in ('reveal','finished') then
    raise exception 'Twitch-Abstimmung ist nur während der Ergebnisphase im Parallel-Modus offen';
  end if;
  if v_login !~ '^[a-z0-9_]{1,25}$' then raise exception 'Ungültiger Twitch-Chatname'; end if;
  if p_candidate_id is null or coalesce(v_room.submissions ->> p_candidate_id::text, 'false') <> 'true' then
    raise exception 'Diese Dub-Version wurde nicht abgegeben';
  end if;

  update public.dub_together_rooms
  set twitch_votes = coalesce(twitch_votes, '{}'::jsonb)
        || jsonb_build_object('twitch:' || v_login, p_candidate_id::text),
      updated_at = now()
  where code = v_code;

  return query select * from public.dub_together_rooms where code = v_code;
end;
$$;

revoke all on function public.vote_dub_from_twitch(text,text,uuid) from public, anon;
grant execute on function public.vote_dub_from_twitch(text,text,uuid) to authenticated;

-- Public packs contain only original role names and dialogue text, never videos,
-- recordings, storage paths, or third-party media.
create table if not exists public.dub_public_packs (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 20),
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 280),
  pack jsonb not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  constraint dub_public_packs_pack_shape check (
    jsonb_typeof(pack) = 'object'
    and jsonb_typeof(pack -> 'roles') = 'array'
    and jsonb_typeof(pack -> 'script') = 'array'
    and pg_column_size(pack) <= 32000
  )
);

create index if not exists dub_public_packs_created_idx
  on public.dub_public_packs (created_at desc)
  where is_public = true;

alter table public.dub_public_packs enable row level security;
revoke all on table public.dub_public_packs from public, anon;
grant select, insert, update, delete on table public.dub_public_packs to authenticated;

drop policy if exists "Dub public packs readable by signed-in players" on public.dub_public_packs;
create policy "Dub public packs readable by signed-in players"
on public.dub_public_packs for select to authenticated
using (is_public = true or author_id = auth.uid());

drop policy if exists "Players publish own Dub packs" on public.dub_public_packs;
create policy "Players publish own Dub packs"
on public.dub_public_packs for insert to authenticated
with check (author_id = auth.uid() and is_public = true);

drop policy if exists "Authors update own Dub packs" on public.dub_public_packs;
create policy "Authors update own Dub packs"
on public.dub_public_packs for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

drop policy if exists "Authors delete own Dub packs" on public.dub_public_packs;
create policy "Authors delete own Dub packs"
on public.dub_public_packs for delete to authenticated
using (author_id = auth.uid());

create table if not exists public.dub_public_pack_reports (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.dub_public_packs(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null default 'Prüfung angefragt' check (char_length(reason) <= 180),
  created_at timestamptz not null default now(),
  unique (pack_id, reporter_id)
);

alter table public.dub_public_pack_reports enable row level security;
revoke all on table public.dub_public_pack_reports from public, anon;
grant insert on table public.dub_public_pack_reports to authenticated;

drop policy if exists "Players report public Dub packs" on public.dub_public_pack_reports;
create policy "Players report public Dub packs"
on public.dub_public_pack_reports for insert to authenticated
with check (
  reporter_id = auth.uid()
  and exists (
    select 1 from public.dub_public_packs p
    where p.id = pack_id and p.is_public = true
  )
);

-- The community packs table is intentionally not added to a public unauthenticated
-- endpoint. The website's anonymous Supabase Auth sessions use the authenticated role.
