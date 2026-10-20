-- v30: Stadt-Land-Fluss automatische Speicherung + Handschriftfelder
-- Bestehende v25/v26/v29-Installation: einmal im Supabase SQL Editor ausführen.

create table if not exists public.online_slf_drafts (
  room_code text not null,
  player_id uuid not null,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  ink_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(ink_answers) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (room_code, player_id),
  foreign key (room_code, player_id) references public.online_slf_players(room_code, player_id) on delete cascade
);

alter table public.online_slf_drafts enable row level security;
revoke all on table public.online_slf_drafts from public, anon, authenticated;

create or replace function public.get_slf_room(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_players jsonb;
  v_submissions jsonb := '{}'::jsonb;
  v_my_draft jsonb := jsonb_build_object('answers','{}'::jsonb,'ink_answers','{}'::jsonb);
  v_result jsonb;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um den Spielraum zu öffnen.'; end if;
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum wurde nicht gefunden.'; end if;
  if not exists(select 1 from public.online_slf_players p where p.room_code = v_room.code and p.player_id = v_uid) then
    raise exception 'Du bist diesem Raum nicht beigetreten.';
  end if;
  -- Answers stay private while the timer is running. The server exposes all drafts only at reveal.
  if v_room.status = 'playing' and v_room.deadline_at is not null and v_room.deadline_at <= now() then
    update public.online_slf_rooms r set status = 'reveal', reveal_step = 0, updated_at = now()
      where r.code = v_room.code returning r.* into v_room;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.player_id,'name',p.display_name,'joined_at',p.joined_at) order by p.joined_at), '[]'::jsonb)
    into v_players from public.online_slf_players p where p.room_code = v_room.code;
  if v_room.status = 'reveal' then
    select coalesce(jsonb_object_agg(d.player_id::text,jsonb_build_object('answers',d.answers,'ink_answers',d.ink_answers,'submitted_at',d.updated_at)), '{}'::jsonb)
      into v_submissions from public.online_slf_drafts d where d.room_code = v_room.code;
  elsif v_room.status = 'playing' then
    select jsonb_build_object('answers',d.answers,'ink_answers',d.ink_answers)
      into v_my_draft from public.online_slf_drafts d where d.room_code = v_room.code and d.player_id = v_uid;
    if v_my_draft is null then v_my_draft := jsonb_build_object('answers','{}'::jsonb,'ink_answers','{}'::jsonb); end if;
  end if;
  v_result := jsonb_build_object(
    'code',v_room.code,'host_id',v_room.host_id,'status',v_room.status,'categories',v_room.categories,
    'duration_seconds',v_room.duration_seconds,'letter',v_room.letter,'deadline_at',v_room.deadline_at,
    'round_number',v_room.round_number,'reveal_step',v_room.reveal_step,'created_at',v_room.created_at,'updated_at',v_room.updated_at,
    'players',v_players,'my_submitted',false,'my_draft',v_my_draft,'submissions',v_submissions
  );
  return v_result;
end;
$$;

create or replace function public.save_slf_draft(p_code text, p_answers jsonb, p_ink_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_category text;
  v_answer text;
  v_clean_answers jsonb := '{}'::jsonb;
  v_clean_ink jsonb := '{}'::jsonb;
  v_ink jsonb;
begin
  if v_uid is null then raise exception 'Bitte verbinde dich erneut, um Antworten zu speichern.'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Antwortformat ist ungültig.'; end if;
  if p_ink_answers is null or jsonb_typeof(p_ink_answers) <> 'object' then raise exception 'Handschriftformat ist ungültig.'; end if;
  if octet_length(p_answers::text) + octet_length(p_ink_answers::text) > 150000 then raise exception 'Die Antworten sind zu groß. Bitte schreibe kürzere Antworten.'; end if;
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum wurde nicht gefunden.'; end if;
  if not exists(select 1 from public.online_slf_players p where p.room_code=v_room.code and p.player_id=v_uid) then raise exception 'Du gehörst nicht zu dieser Lobby.'; end if;
  if v_room.status <> 'playing' then raise exception 'Die Runde ist nicht mehr aktiv.'; end if;
  if v_room.deadline_at is null or v_room.deadline_at <= now() then
    update public.online_slf_rooms r set status='reveal',reveal_step=0,updated_at=now() where r.code=v_room.code;
    return jsonb_build_object('saved',false,'expired',true);
  end if;
  for v_category in select jsonb_array_elements_text(v_room.categories) loop
    v_answer := left(trim(regexp_replace(coalesce(p_answers ->> v_category,''), '[[:cntrl:]]', '', 'g')),100);
    v_clean_answers := v_clean_answers || jsonb_build_object(v_category,v_answer);
    v_ink := p_ink_answers -> v_category;
    if jsonb_typeof(v_ink) = 'array' then v_clean_ink := v_clean_ink || jsonb_build_object(v_category,v_ink);
    else v_clean_ink := v_clean_ink || jsonb_build_object(v_category,'[]'::jsonb); end if;
  end loop;
  insert into public.online_slf_drafts(room_code,player_id,answers,ink_answers,updated_at)
    values(v_room.code,v_uid,v_clean_answers,v_clean_ink,now())
    on conflict(room_code,player_id) do update set answers=excluded.answers,ink_answers=excluded.ink_answers,updated_at=now();
  update public.online_slf_rooms r set updated_at=now() where r.code=v_room.code;
  return jsonb_build_object('saved',true,'updated_at',now());
end;
$$;

create or replace function public.start_slf_round(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_count integer;
  v_letter text;
begin
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum existiert nicht mehr.'; end if;
  if v_uid is null or v_room.host_id <> v_uid then raise exception 'Nur der Gastgeber kann die Runde starten.'; end if;
  if v_room.status <> 'waiting' then raise exception 'Diese Runde wurde bereits gestartet.'; end if;
  select count(*) into v_count from public.online_slf_players p where p.room_code = v_room.code;
  if v_count < 2 then raise exception 'Warte auf mindestens einen Mitspieler, bevor du startest.'; end if;
  v_letter := substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ',floor(random()*26)::integer+1,1);
  update public.online_slf_rooms r set status='playing',letter=v_letter,round_number=1,reveal_step=0,
    deadline_at=now()+(v_room.duration_seconds || ' seconds')::interval,updated_at=now()
    where r.code=v_room.code;
  delete from public.online_slf_submissions s where s.room_code=v_room.code;
  delete from public.online_slf_drafts d where d.room_code=v_room.code;
  return public.get_slf_room(v_room.code);
end;
$$;

create or replace function public.next_slf_round(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.online_slf_rooms%rowtype;
  v_letter text;
begin
  select * into v_room from public.online_slf_rooms r where r.code = upper(trim(p_code)) for update;
  if not found then raise exception 'Dieser Stadt-Land-Fluss-Raum existiert nicht mehr.'; end if;
  if v_uid is null or v_room.host_id <> v_uid then raise exception 'Nur der Gastgeber kann die nächste Runde starten.'; end if;
  if v_room.status <> 'reveal' then raise exception 'Die aktuelle Runde ist noch nicht aufgedeckt.'; end if;
  v_letter := substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ',floor(random()*26)::integer+1,1);
  update public.online_slf_rooms r set status='playing',letter=v_letter,round_number=v_room.round_number+1,reveal_step=0,
    deadline_at=now()+(v_room.duration_seconds || ' seconds')::interval,updated_at=now()
    where r.code=v_room.code;
  delete from public.online_slf_submissions s where s.room_code=v_room.code;
  delete from public.online_slf_drafts d where d.room_code=v_room.code;
  return public.get_slf_room(v_room.code);
end;
$$;

revoke all on function public.get_slf_room(text) from public, anon;
revoke all on function public.save_slf_draft(text,jsonb,jsonb) from public, anon;
revoke all on function public.start_slf_round(text) from public, anon;
revoke all on function public.next_slf_round(text) from public, anon;
grant execute on function public.get_slf_room(text) to authenticated;
grant execute on function public.save_slf_draft(text,jsonb,jsonb) to authenticated;
grant execute on function public.start_slf_round(text) to authenticated;
grant execute on function public.next_slf_round(text) to authenticated;
notify pgrst, 'reload schema';
