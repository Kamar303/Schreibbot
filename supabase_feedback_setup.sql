-- Handschrift. – sichere öffentliche Feedbackliste für Supabase
-- 1) In Supabase Dashboard > SQL Editor ausführen.
-- 2) In Authentication > Sign In / Providers anonymes Anmelden (Anonymous Sign-Ins) aktivieren.
-- Die Tabelle benutzt Row Level Security. Jeder darf Beiträge LESEN; anonyme angemeldete Sitzungen
-- dürfen nur eigene Beiträge erstellen, bearbeiten und löschen. Es gibt keine SECURITY DEFINER-Funktionen.

create table if not exists public.website_feedback (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (category in ('Verbesserungsvorschlag','Fehler','Idee','Lob','Sonstiges')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.website_feedback enable row level security;

-- Keine Tabellenrechte erben; nur die benötigten Spalten/API-Operationen freigeben.
revoke all on table public.website_feedback from public, anon, authenticated;
grant select (id, category, title, body, created_at, updated_at) on table public.website_feedback to anon, authenticated;
grant insert (category, title, body) on table public.website_feedback to authenticated;
grant update (category, title, body, updated_at) on table public.website_feedback to authenticated;
grant delete on table public.website_feedback to authenticated;

-- Diese SQL kann nach Bedarf erneut ausgeführt werden, ohne bestehende Richtlinien zu duplizieren.
drop policy if exists "feedback_public_read" on public.website_feedback;
drop policy if exists "feedback_anonymous_insert_own" on public.website_feedback;
drop policy if exists "feedback_anonymous_update_own" on public.website_feedback;
drop policy if exists "feedback_anonymous_delete_own" on public.website_feedback;

create policy "feedback_public_read"
on public.website_feedback for select
to anon, authenticated
using (true);

create policy "feedback_anonymous_insert_own"
on public.website_feedback for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and (select (auth.jwt()->>'is_anonymous')::boolean) is true
);

create policy "feedback_anonymous_update_own"
on public.website_feedback for update
to authenticated
using (
  author_id = (select auth.uid())
  and (select (auth.jwt()->>'is_anonymous')::boolean) is true
)
with check (
  author_id = (select auth.uid())
  and (select (auth.jwt()->>'is_anonymous')::boolean) is true
);

create policy "feedback_anonymous_delete_own"
on public.website_feedback for delete
to authenticated
using (
  author_id = (select auth.uid())
  and (select (auth.jwt()->>'is_anonymous')::boolean) is true
);
