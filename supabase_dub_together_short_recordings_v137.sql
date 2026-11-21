-- DubTogether v137: kurze Sprachaufnahmen erlauben (z. B. „Ja“ / „Nein")
-- Ändert ausschließlich die Mindestdauer in save_dub_recording von 250 ms auf 80 ms.
-- Rollen-, Lobby-, Authentifizierungs- und Storage-Pfad-Prüfungen bleiben unverändert.

begin;

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
  if coalesce(p_duration_ms,0) < 80 or p_duration_ms > 180000 then raise exception 'Aufnahmen müssen mindestens 0,08 Sekunden und höchstens 3 Minuten dauern'; end if;
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


revoke all on function public.save_dub_recording(text,text,text,text,integer,text) from public, anon;
grant execute on function public.save_dub_recording(text,text,text,text,integer,text) to authenticated;
notify pgrst, 'reload schema';

commit;
