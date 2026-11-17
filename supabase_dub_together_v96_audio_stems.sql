-- Dub Together v96: allow private MP3 stems produced by the optional local audio helper.
-- The existing dub-media bucket and its room-membership RLS policies remain private.

update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['audio/mpeg']::text[]) as allowed(mime_type)
)
where id = 'dub-media';

notify pgrst, 'reload schema';
