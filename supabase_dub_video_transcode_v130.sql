-- Keep the existing private media bucket in sync with the 45 MiB app limit.
update storage.buckets
set file_size_limit = 47185920
where id = 'dub-media';

-- Schreibbot v130: securely publish the compatible MP4 produced by GitHub Actions.
-- Run once in Supabase SQL Editor. Re-running is safe (CREATE OR REPLACE).

create or replace function public.complete_dub_video_transcode(
  p_code text,
  p_original_path text,
  p_playback_path text,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(coalesce(p_code, ''));
begin
  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Ungültiger Lobby-Code';
  end if;
  if coalesce(p_original_path, '') = '' or coalesce(p_playback_path, '') = '' then
    raise exception 'Original- und Wiedergabepfad sind erforderlich';
  end if;
  if split_part(p_original_path, '/', 1) <> v_code
     or split_part(p_playback_path, '/', 1) <> v_code
     or split_part(p_original_path, '/', 2) <> 'clips'
     or split_part(p_playback_path, '/', 2) <> 'clips'
     or split_part(p_original_path, '/', 3) <> split_part(p_playback_path, '/', 3)
     or right(lower(p_playback_path), 4) <> '.mp4' then
    raise exception 'Ungültiger Speicherpfad für die Wiedergabe-Datei';
  end if;

  if coalesce(p_success, false) then
    update public.dub_together_rooms
    set clip = clip || jsonb_build_object(
      'path', p_playback_path,
      'original_path', p_original_path,
      'mime', 'video/mp4',
      'playback_compatible', true,
      'playback_status', 'ready',
      'playback_profile', 'H.264 Baseline + AAC-LC · GitHub Actions',
      'playback_error', null,
      'playback_completed_at', now()
    ),
    updated_at = now()
    where code = v_code
      and status = 'waiting'
      and clip ->> 'path' = p_original_path
      and clip ->> 'original_path' = p_original_path
      and clip ->> 'playback_path' = p_playback_path
      and clip ->> 'playback_status' = 'preparing';
  else
    update public.dub_together_rooms
    set clip = clip || jsonb_build_object(
      'playback_status', 'failed',
      'playback_compatible', false,
      'playback_error', left(coalesce(nullif(p_error, ''), 'Die Server-Konvertierung ist fehlgeschlagen.'), 280)
    ),
    updated_at = now()
    where code = v_code
      and status = 'waiting'
      and clip ->> 'path' = p_original_path
      and clip ->> 'original_path' = p_original_path
      and clip ->> 'playback_path' = p_playback_path
      and clip ->> 'playback_status' = 'preparing';
  end if;

  if not found then
    raise exception 'Die Lobby oder der Clip wurde während der Konvertierung geändert';
  end if;
end;
$$;

revoke all on function public.complete_dub_video_transcode(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_dub_video_transcode(text, text, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
