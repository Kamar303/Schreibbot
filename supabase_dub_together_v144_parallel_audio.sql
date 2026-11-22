-- Dub Together v144: allow the independent video and ambience jobs to finish in either order.
-- Run once in the Supabase SQL Editor after deploying the v144 GitHub workflow.
-- The MP4 job changes clip.path from the original object to the playback object.
-- The ambience job must still be allowed to mark its own stem as ready afterwards.

begin;

create or replace function public.complete_dub_audio_stem(
  p_code text,
  p_original_path text,
  p_playback_path text,
  p_accompaniment_path text,
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
  v_stems jsonb;
begin
  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Ungültiger Lobby-Code';
  end if;
  if coalesce(p_original_path, '') = ''
     or coalesce(p_playback_path, '') = ''
     or coalesce(p_accompaniment_path, '') = '' then
    raise exception 'Original-, Wiedergabe- und Hintergrundpfad sind erforderlich';
  end if;
  if split_part(p_original_path, '/', 1) <> v_code
     or split_part(p_playback_path, '/', 1) <> v_code
     or split_part(p_accompaniment_path, '/', 1) <> v_code
     or split_part(p_original_path, '/', 2) <> 'clips'
     or split_part(p_playback_path, '/', 2) <> 'clips'
     or split_part(p_accompaniment_path, '/', 2) <> 'clips'
     or split_part(p_original_path, '/', 3) <> split_part(p_playback_path, '/', 3)
     or split_part(p_original_path, '/', 3) <> split_part(p_accompaniment_path, '/', 3)
     or right(lower(p_playback_path), 4) <> '.mp4'
     or right(lower(p_accompaniment_path), 13) <> '-ambience.mp3' then
    raise exception 'Ungültiger Speicherpfad für die Hintergrundspur';
  end if;

  if coalesce(p_success, false) then
    v_stems := jsonb_build_object(
      'vocals_path', null,
      'accompaniment_path', p_accompaniment_path,
      'status', 'ready',
      'separation_model', 'htdemucs',
      'error', null,
      'completed_at', now()
    );
  else
    v_stems := jsonb_build_object(
      'vocals_path', null,
      'accompaniment_path', p_accompaniment_path,
      'status', 'failed',
      'separation_model', 'htdemucs',
      'error', left(coalesce(nullif(p_error, ''), 'Die Hintergrundspur konnte nicht getrennt werden.'), 280),
      'completed_at', now()
    );
  end if;

  update public.dub_together_rooms
  set clip = jsonb_set(coalesce(clip, '{}'::jsonb), '{audio_stems}', v_stems, true),
      updated_at = now()
  where code = v_code
    and clip ->> 'original_path' = p_original_path
    and clip ->> 'playback_path' = p_playback_path
    and clip ->> 'path' in (p_original_path, p_playback_path)
    and clip #>> '{audio_stems,accompaniment_path}' = p_accompaniment_path;

  if not found then
    raise exception 'Die Lobby oder der Clip wurde während der Audiotrennung geändert';
  end if;
end;
$$;

revoke all on function public.complete_dub_audio_stem(text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_dub_audio_stem(text, text, text, text, boolean, text) to service_role;

notify pgrst, 'reload schema';

commit;
