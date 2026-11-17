/* Dub Together: browser client for the optional Supabase online game.
   Voice/video files are kept in a private Supabase Storage bucket. */
(function () {
  'use strict';

  const CLIPS = [
    { id: 'de-street-5636780', region: 'de', title: 'Straßen-Gespräch · Demo-Clip', kind: 'Deutschsprachige Dub-Vorlage · Viral-Style', length: 'Kurzclip', summary: 'Stock-Aufnahme für selbst geschriebene Dialoge; keine Behauptung, dass dies ein echter YouTube-Viralclip aus Deutschland ist.', source: 'Pexels', url: 'https://www.pexels.com/video/people-talking-on-the-street-5636780/', license: 'Pexels-Lizenz · kreativ nutzbar', safe: true },
    { id: 'de-city-5636774', region: 'de', title: 'Spontanes Stadtgespräch · Demo', kind: 'Deutschsprachige Dub-Vorlage · Viral-Style', length: 'Kurzclip', summary: 'Neutrale Straßenszene zum Einsprechen eigener deutscher Rollen und Dialoge.', source: 'Pexels', url: 'https://www.pexels.com/video/people-talking-on-the-street-5636774/', license: 'Pexels-Lizenz · kreativ nutzbar', safe: true },
    { id: 'intl-friends-7986425', region: 'international', title: 'Friends Laughing', kind: 'International · Comedy-Vorlage', length: 'Kurzclip', summary: 'Kurze Lach-Szene für absurde Neuvertonungen und wechselnde Rollen.', source: 'Pexels', url: 'https://www.pexels.com/video/friends-laughing-with-the-woman-7986425/', license: 'Pexels-Lizenz · kreativ nutzbar', safe: true },
    { id: 'intl-milk-26867682', region: 'international', title: 'Milk Day · Reaction', kind: 'International · Reaction-Vorlage', length: 'Kurzclip', summary: 'Reaktionsszene zum Erfinden eines eigenen Dialogs.', source: 'Pexels', url: 'https://www.pexels.com/video/milk-day-26867682/', license: 'Pexels-Lizenz · kreativ nutzbar', safe: true },
    { id: 'viral-de-icrimax', region: 'de', title: 'iCrimax macht Danergy nach 😂😂', kind: 'Deutschland · YouTube-Short', length: 'Creator-Clip', summary: 'Aktuelles Beispiel aus der deutschen Shorts-Trendliste. Nur als externe Quelle/Idee verlinkt; für eine Neuvertonung oder einen YouTube-Upload brauchst du die Erlaubnis des Rechteinhabers.', source: 'YouTube · iCrimax', url: 'https://www.youtube.com/shorts/ynIZan25vzk', license: 'COPYRIGHT · Erlaubnis nötig', safe: false, asOf: 'Trendliste 15.11.2026' },
    { id: 'viral-de-trends', region: 'de', title: 'Deutschland · aktuelle virale Shorts', kind: 'Deutsche YouTube-Trendliste', length: 'Externe Quelle', summary: 'Öffnet eine laufend aktualisierte Liste deutscher Shorts. Die darin enthaltenen Creator-Videos bleiben urheberrechtlich geschützt.', source: 'YouthVid · Trendübersicht', url: 'https://youthvid.com/de/youtube-deutschland/shorts/', license: 'COPYRIGHT · pro Video Rechte prüfen', safe: false, asOf: 'Abfrage 16.11.2026' },
    { id: 'viral-intl-zach', region: 'international', title: 'Cake or fake? 🍰 · Zach King', kind: 'International · YouTube-Short', length: 'Creator-Clip', summary: 'Internationaler Trend-Short als Inspirationsbeispiel. Die Verlinkung ist keine Erlaubnis zum Dubben, Herunterladen oder erneuten Hochladen.', source: 'YouTube · Zach King', url: 'https://www.youtube.com/shorts/LRT5ng-SW3g', license: 'COPYRIGHT · Erlaubnis nötig', safe: false, asOf: 'Trendliste 15.11.2026' },
    { id: 'viral-intl-khaos', region: 'international', title: 'HELP! 🤣🐶 · KHAØS', kind: 'International · YouTube-Short', length: 'Creator-Clip', summary: 'Beispiel eines international stark verbreiteten Tier-Shorts. Für die Nutzung im Dub oder einen Upload benötigst du eine Freigabe.', source: 'YouTube · KHAØS', url: 'https://www.youtube.com/shorts/r3FcObQM1NU', license: 'COPYRIGHT · Erlaubnis nötig', safe: false, asOf: 'Trendliste 15.11.2026' },
    { id: 'viral-intl-trends', region: 'international', title: 'International · aktuelle virale Shorts', kind: 'Weltweite YouTube-Trendliste', length: 'Externe Quelle', summary: 'Öffnet die weltweite Shorts-Trendliste. Die Video-Links führen zum jeweiligen Rechteinhaber; viral bedeutet nicht frei nutzbar.', source: 'Viral Hooks · Trendübersicht', url: 'https://viralhooks.org/trending-short-videos/', license: 'COPYRIGHT · pro Video Rechte prüfen', safe: false, asOf: 'Abfrage 16.11.2026' },
    { id: 'protected-de-shorts', region: 'de', title: 'Weitere deutsche Creator-Shorts & Memes', kind: 'Deutschland · echte Viral-Clips', length: 'Externe Videos', summary: 'Creator-Shorts, Memes und Reaktionsvideos sind normalerweise urheberrechtlich geschützt. Nur nach Freigabe des Rechteinhabers importieren und veröffentlichen.', source: 'Creator / Rechteinhaber', url: '', license: 'COPYRIGHT · Erlaubnis nötig', safe: false },
    { id: 'protected-de-tv', region: 'de', title: 'Deutsche TV-, Sport- & Stream-Momente', kind: 'Deutschland · Originalausschnitte', length: 'Externe Videos', summary: 'TV-, Sport- und Stream-Ausschnitte können zusätzliche Urheber-, Musik-, Persönlichkeits- und Markenrechte enthalten.', source: 'Sender / Creator / Rechteinhaber', url: '', license: 'COPYRIGHT · Erlaubnis nötig', safe: false },
    { id: 'protected-intl-memes', region: 'international', title: 'Internationale Meme- & TikTok-Clips', kind: 'International · echte Viral-Clips', length: 'Externe Videos', summary: 'Virale Verbreitung macht ein Video nicht gemeinfrei. Für Dub, Schnitt und YouTube-Upload müssen die Nutzungsrechte geklärt sein.', source: 'Creator / Rechteinhaber', url: '', license: 'COPYRIGHT · Erlaubnis nötig', safe: false },
    { id: 'protected-intl-film', region: 'international', title: 'Film-, Serien- & Game-Szenen', kind: 'International · Originalausschnitte', length: 'Externe Videos', summary: 'Film-, Serien- und Game-Aufnahmen sind in der Regel geschützt. Nicht ohne passende Lizenz oder ausdrückliche Erlaubnis verwenden.', source: 'Studio / Publisher / Rechteinhaber', url: '', license: 'COPYRIGHT · Erlaubnis nötig', safe: false }
  ];

  const DEFAULT_ROLES = [
    { id: 'person-1', name: 'Person 1' },
    { id: 'person-2', name: 'Person 2' }
  ];
  const DEFAULT_SCRIPT = [
    { id: 'line-1', role: 'person-1', text: 'Was passiert hier gerade?', start_sec: 0 },
    { id: 'line-2', role: 'person-2', text: 'Ich glaube, das wird noch spannend.', start_sec: 2.5 },
    { id: 'line-3', role: 'person-1', text: 'Warte kurz – ich habe eine Idee!', start_sec: 5 }
  ];
  const MODE_LABELS = { parallel: 'Parallel', character: 'Charakter', scenario: 'Szenario' };
  const MODE_HINTS = {
    parallel: 'Alle sprechen denselben Clip vollständig neu. Am Ende werden die Versionen nacheinander gezeigt und abgestimmt.',
    character: 'Jeder bekommt eine feste Person aus dem Clip. Die zugewiesene Person spricht nur ihre eigenen Zeilen; daraus wird eine gemeinsame Fassung.',
    scenario: 'Ihr erfindet die Dialoge selbst. Legt Personen, Rollen und Zeilen im Pack Creator fest und spielt eure Szene gemeinsam.'
  };
  const EFFECTS = ['original', 'chipmunk', 'monster', 'echo', 'robot', 'phone'];

  let deps = null;
  let state = {
    room: null, poll: null, busy: false, mode: 'parallel', meId: null, editorDirty: false, recordingSavePromise: null,
    selectedSource: null, selectedLibrary: 'all', selectedFile: null,
    lineIndex: 0, selectedCandidate: null, recorder: null, micStream: null,
    audioContext: null, analyser: null, micMeterTimer: null, recordStartedAt: 0,
    recordChunks: [], recordLineId: null, recordEffect: 'original',
    videoObjectUrl: null, signedClipPath: '', signedClipUrl: '',
    activeSources: [], playbackTimer: null, canvasFrame: 0,
    localRoles: DEFAULT_ROLES.map(x => ({ ...x })), localScript: DEFAULT_SCRIPT.map(x => ({ ...x }))
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const rowOf = data => Array.isArray(data) ? (data[0] || null) : data;
  const uid = () => state.meId || state.room?.__me || null;
  const room = () => state.room;
  const isHost = () => Boolean(state.room && state.room.host_id === uid());
  const status = (msg, kind = '') => {
    const el = $('dubStatus'); if (!el) return;
    el.textContent = msg; el.classList.toggle('error', kind === 'error'); el.classList.toggle('successText', kind === 'success');
  };
  const setBusy = busy => {
    state.busy = Boolean(busy);
    ['dubCreateRoom', 'dubJoinRoom', 'dubRefreshRooms', 'dubStartRound', 'dubSaveScript', 'dubUploadClipButton'].forEach(id => { const el = $(id); if (el) el.disabled = state.busy; });
    $('dubSetup')?.classList.toggle('onlineLoading', state.busy);
  };
  const myPlayer = () => state.room?.players?.find(p => p.id === uid()) || null;
  const players = () => Array.isArray(state.room?.players) ? state.room.players : [];
  const roles = () => Array.isArray(state.room?.clip?.roles) && state.room.clip.roles.length ? state.room.clip.roles : DEFAULT_ROLES;
  const script = () => Array.isArray(state.room?.script) && state.room.script.length ? state.room.script : DEFAULT_SCRIPT;
  const recordings = () => state.room?.recordings && typeof state.room.recordings === 'object' ? state.room.recordings : {};
  const mode = () => state.room?.mode || state.mode;
  const meName = () => myPlayer()?.name || 'Du';
  const memberName = id => players().find(p => p.id === id)?.name || 'Nicht zugewiesen';

  function safeName(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) || 'Spieler';
  }
  function currentLine() { return script()[Math.max(0, Math.min(state.lineIndex, script().length - 1))]; }
  function recordingKey(line, candidateId = uid()) {
    if (mode() === 'parallel') return `parallel:${candidateId}:${line.id}`;
    return `character:${line.id}`;
  }
  function hasRecording(line, candidateId = uid()) { return Boolean(recordings()[recordingKey(line, candidateId)]?.path); }
  function lineOwner(line) {
    const assigned = state.room?.assignments?.[line.role];
    return assigned || null;
  }
  function canRecord(line) {
    if (!state.room || state.room.status !== 'recording') return false;
    if (mode() === 'parallel') return true;
    const owner = lineOwner(line);
    return Boolean(owner && owner === uid());
  }
  function roleName(roleId) { return roles().find(r => r.id === roleId)?.name || roleId || 'Rolle'; }
  function codeFromUrl() { return new URLSearchParams(location.search).get('dub'); }

  async function apiRpcRaw(name, body) {
    if (!deps?.api) throw new Error('Online-Verbindung ist nicht verfügbar.');
    return deps.api(`rpc/${name}`, { method: 'POST', body: body || {}, prefer: 'return=representation' });
  }
  async function apiRpc(name, body) { return rowOf(await apiRpcRaw(name, body)); }
  async function ensureMe() {
    const session = await deps.getSession();
    if (!session?.user?.id) throw new Error('Keine Spieler-ID erhalten. Bitte lade die Seite neu und versuche es erneut.');
    state.meId = session.user.id;
    return session;
  }
  async function refreshRoom(showError = false) {
    const code = state.room?.code;
    if (!code) return;
    try {
      const data = await apiRpc('get_dub_room', { p_code: code });
      if (!data) throw new Error('Die Lobby ist nicht mehr verfügbar.');
      // Keep the host's unsaved editor draft while room polling updates players/status.
      if (state.editorDirty && isHost() && state.room) {
        data.clip = { ...(data.clip || {}), roles: roles().map(role => ({ ...role })) };
        data.script = script().map(line => ({ ...line }));
      }
      data.__me = state.meId;
      state.room = data;
      renderRoom();
      if (showError) status('Lobby synchronisiert.', 'success');
    } catch (error) {
      if (showError) status(deps?.friendlyError?.(error) || error.message || 'Lobby konnte nicht geladen werden.', 'error');
    }
  }
  function startPolling() {
    stopPolling();
    state.poll = setInterval(() => refreshRoom(false), 1800);
  }
  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  async function createRoom() {
    if (state.busy) return;
    setBusy(true); status('Erstelle deine Dub-Lobby …');
    try {
      await ensureMe();
      const name = safeName($('dubPlayerName').value);
      const code = deps.randomCode();
      const created = await apiRpc('create_dub_room', {
        p_code: code, p_name: name, p_mode: state.mode,
        p_is_public: Boolean($('dubPublicRoom').checked),
        p_clip: { title: 'Eigener Clip', roles: DEFAULT_ROLES }, p_script: DEFAULT_SCRIPT
      });
      if (!created?.code) throw new Error('Der Server hat keinen gültigen Raum zurückgegeben.');
      created.__me = state.meId; state.room = created; state.lineIndex = 0;
      state.localRoles = DEFAULT_ROLES.map(x => ({ ...x })); state.localScript = DEFAULT_SCRIPT.map(x => ({ ...x }));
      startPolling(); renderRoom(); status(`Lobby ${created.code} wurde erstellt. Teile den Code mit deinen Freunden.`, 'success');
    } catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
    finally { setBusy(false); }
  }
  async function joinRoom(codeOverride) {
    if (state.busy) return;
    const code = String(codeOverride || $('dubJoinCode').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (code.length !== 6) { status('Bitte einen sechsstelligen Raumcode eingeben.', 'error'); return; }
    setBusy(true); status('Verbinde mit der Lobby …');
    try {
      await ensureMe();
      const joined = await apiRpc('join_dub_room', { p_code: code, p_name: safeName($('dubJoinName').value) });
      if (!joined?.code) throw new Error('Der Server hat keinen gültigen Raum zurückgegeben.');
      joined.__me = state.meId; state.room = joined; state.mode = joined.mode || 'parallel'; state.lineIndex = 0;
      startPolling(); renderRoom(); status(`Du bist der Lobby ${code} beigetreten.`, 'success');
    } catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
    finally { setBusy(false); }
  }
  async function refreshPublicRooms() {
    const box = $('dubPublicRooms'); if (!box) return;
    box.innerHTML = '<div class="dubEmpty">Suche offene Lobbys …</div>';
    try {
      await ensureMe();
      const result = await apiRpcRaw('list_public_dub_rooms', {});
      const rows = Array.isArray(result) ? result : (Array.isArray(result?.rows) ? result.rows : []);
      box.replaceChildren();
      if (!rows.length) { box.innerHTML = '<div class="dubEmpty">Gerade ist keine öffentliche Lobby offen.</div>'; return; }
      rows.forEach(item => {
        const card = document.createElement('div'); card.className = 'dubRoleRow';
        const info = document.createElement('div'); info.innerHTML = `<strong>Raum ${esc(item.code)}</strong><small>${esc(item.mode_label || MODE_LABELS[item.mode] || 'Dub')} · ${Number(item.player_count) || 1}/15 Spieler</small>`;
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'primary'; btn.textContent = 'Beitreten'; btn.addEventListener('click', () => joinRoom(item.code));
        card.append(info, btn); box.append(card);
      });
    } catch (error) {
      box.innerHTML = `<div class="dubEmpty">${esc(deps?.friendlyError?.(error) || error.message || 'Lobbys konnten nicht geladen werden.')}</div>`;
    }
  }

  function renderPlayers() {
    const list = $('dubPlayers'); list.replaceChildren();
    players().forEach(player => {
      const card = document.createElement('div'); card.className = `dubPlayer${player.id === uid() ? ' isMe' : ''}`;
      const name = document.createElement('strong'); name.textContent = player.name + (player.id === uid() ? ' · du' : '');
      const sub = document.createElement('small'); sub.textContent = player.id === state.room.host_id ? 'Lobby-Host' : 'Mitspieler';
      card.append(name, sub); list.append(card);
    });
    $('dubPlayerCount').textContent = String(players().length);
    $('dubConnectionState').textContent = `${players().length} verbunden`;
  }

  function renderModeChoices() {
    document.querySelectorAll('[data-dub-mode]').forEach(button => {
      const active = button.dataset.dubMode === mode();
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = !isHost() || state.room.status !== 'waiting';
    });
    $('dubModeHint').textContent = MODE_HINTS[mode()] || MODE_HINTS.parallel;
  }

  function renderRoles() {
    const box = $('dubRoleEditor'); box.replaceChildren();
    const canEdit = isHost() && state.room.status === 'waiting';
    roles().forEach((role, index) => {
      const row = document.createElement('div'); row.className = 'dubRoleRow';
      const name = document.createElement('input'); name.value = role.name; name.maxLength = 30; name.setAttribute('aria-label', `Name von ${role.name}`); name.disabled = !canEdit;
      name.addEventListener('input', () => { role.name = name.value.slice(0, 30); state.editorDirty = true; });
      name.addEventListener('change', async () => { role.name = name.value.trim().slice(0, 30) || `Person ${index + 1}`; state.editorDirty = true; await saveScript(); });
      const select = document.createElement('select'); select.setAttribute('aria-label', `Sprecher für ${role.name}`);
      const assignedId = state.room.assignments?.[role.id] || '';
      const canSelfChoose = !isHost() && (!assignedId || assignedId === uid());
      const canChooseRole = state.room.status === 'waiting' && (isHost() || canSelfChoose);
      select.disabled = mode() === 'parallel' || !canChooseRole;
      if (isHost()) {
        const original = document.createElement('option'); original.value = ''; original.textContent = 'Originalstimme behalten'; select.append(original);
        players().forEach(player => { const option = document.createElement('option'); option.value = player.id; option.textContent = player.name; select.append(option); });
      } else if (canSelfChoose) {
        const original = document.createElement('option'); original.value = ''; original.textContent = 'Nicht selbst übernehmen'; select.append(original);
        const own = document.createElement('option'); own.value = uid(); own.textContent = `Ich spiele: ${role.name}`; select.append(own);
      } else {
        const owner = document.createElement('option'); owner.value = assignedId; owner.textContent = `Wird gesprochen von ${memberName(assignedId)}`; select.append(owner);
      }
      select.value = assignedId;
      select.addEventListener('change', async () => {
        try { await apiRpc('assign_dub_role', { p_code: state.room.code, p_role: role.id, p_player_id: select.value || null }); await refreshRoom(false); }
        catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
      });
      const label = document.createElement('label'); label.textContent = `${role.name} ${mode() === 'parallel' ? '· freie Rollenwahl pro Version' : isHost() ? '· Host verteilt die Rolle' : '· eigene Rollenwahl'}`;
      row.replaceChildren(label, name, select); box.append(row);
    });
  }

  function renderScriptEditor() {
    const box = $('dubScriptEditor'); box.replaceChildren();
    const canEdit = isHost() && state.room.status === 'waiting';
    script().forEach((line, index) => {
      const row = document.createElement('div'); row.className = 'dubScriptRow';
      const role = document.createElement('select'); role.disabled = !canEdit;
      roles().forEach(r => { const op = document.createElement('option'); op.value = r.id; op.textContent = r.name; role.append(op); });
      role.value = line.role;
      role.addEventListener('change', () => { line.role = role.value; state.editorDirty = true; });
      const text = document.createElement('input'); text.value = line.text || ''; text.maxLength = 240; text.placeholder = 'Dialogtext …'; text.disabled = !canEdit;
      text.addEventListener('input', () => { line.text = text.value; state.editorDirty = true; });
      const time = document.createElement('input'); time.type = 'number'; time.min = '0'; time.max = '600'; time.step = '0.5'; time.value = Number(line.start_sec || 0); time.title = 'Startzeit in Sekunden'; time.disabled = !canEdit;
      time.addEventListener('input', () => { line.start_sec = Math.max(0, Math.min(600, Number(time.value) || 0)); state.editorDirty = true; });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ghost'; remove.textContent = 'Entfernen'; remove.disabled = !canEdit || script().length <= 1;
      remove.addEventListener('click', () => { state.room.script.splice(index, 1); state.editorDirty = true; renderScriptEditor(); });
      row.append(role, text, time, remove); box.append(row);
    });
    $('dubAddRole').disabled = !canEdit; $('dubAddLine').disabled = !canEdit; $('dubSaveScript').disabled = !canEdit;
    $('dubAddRole').hidden = !canEdit; $('dubAddLine').hidden = !canEdit; $('dubSaveScript').hidden = !canEdit;
    $('dubExportPack').disabled = false; $('dubImportPack').disabled = !canEdit;
  }

  async function saveScript() {
    if (!isHost() || state.room.status !== 'waiting') return false;
    const cleanScript = script().map((line, i) => ({ id: String(line.id || `line-${i + 1}`).slice(0, 40), role: String(line.role || roles()[0]?.id || 'person-1').slice(0, 40), text: String(line.text || '').trim().slice(0, 240), start_sec: Math.max(0, Math.min(600, Number(line.start_sec) || 0)) })).filter(line => line.text);
    if (!cleanScript.length) { status('Bitte mindestens eine Dialogzeile mit Text eintragen.', 'error'); return false; }
    const cleanRoles = roles().map(r => ({ id: String(r.id).slice(0, 40), name: String(r.name || 'Person').trim().slice(0, 30) || 'Person' }));
    const clip = { ...(state.room.clip || {}), roles: cleanRoles };
    try {
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: clip, p_script: cleanScript });
      state.editorDirty = false;
      state.localRoles = cleanRoles.map(role => ({ ...role }));
      state.localScript = cleanScript.map(line => ({ ...line }));
      await refreshRoom(false); status('Rollen und Skript gespeichert.', 'success');
      return true;
    } catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); return false; }
  }

  function renderClipLibrary() {
    const grid = $('dubClipGrid'); if (!grid) return;
    grid.replaceChildren();
    CLIPS.filter(item => {
      if (state.selectedLibrary === 'all') return true;
      if (state.selectedLibrary === 'de') return item.region === 'de';
      if (state.selectedLibrary === 'international') return item.region === 'international';
      if (state.selectedLibrary === 'licensed') return item.safe;
      if (state.selectedLibrary === 'protected') return !item.safe;
      return true;
    }).forEach(item => {
      const card = document.createElement('article'); card.className = `dubClipCard${state.selectedSource?.id === item.id ? ' selected' : ''}`;
      const top = document.createElement('div'); top.className = 'dubClipTop';
      const title = document.createElement('strong'); title.textContent = item.title;
      const badge = document.createElement('span'); badge.className = `dubClipBadge${item.safe ? '' : ' protected'}`; badge.textContent = item.license;
      top.append(title, badge);
      const desc = document.createElement('p'); desc.textContent = `${item.kind} · ${item.length}.${item.asOf ? ` Stand: ${item.asOf}.` : ''} ${item.summary}`;
      const actions = document.createElement('div'); actions.className = 'dubClipActions';
      if (item.url) {
        const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `Quelle bei ${item.source} ↗`;
        actions.append(link);
      } else {
        const warning = document.createElement('span'); warning.className = 'dubHint'; warning.textContent = 'Nur mit Genehmigung des Rechteinhabers.'; actions.append(warning);
      }
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = item.safe ? 'secondary' : 'ghost'; choose.textContent = state.selectedSource?.id === item.id ? 'Ausgewählt' : (item.safe ? 'Als Vorlage wählen' : 'Geschützte Quelle vormerken');
      choose.addEventListener('click', () => {
        state.selectedSource = item;
        $('dubSelectedSourceText').textContent = item.safe ? `${item.title} ausgewählt. Lade den Clip auf der Quellseite herunter und importiere die Videodatei anschließend hier.` : `${item.title} vorgemerkt. Die Videodatei darf erst mit passender Erlaubnis/Lizenz importiert und geteilt werden.`;
        if (!item.safe) $('dubRightsCheck').checked = false;
        renderClipLibrary();
      });
      actions.append(choose); card.append(top, desc, actions); grid.append(card);
    });
  }

  function renderProgress() {
    const box = $('dubProgressList'); if (!box || !state.room) return;
    box.replaceChildren();
    const currentMode = mode();
    if (currentMode === 'parallel') {
      const myDone = script().filter(line => hasRecording(line, uid())).length;
      $('dubRecordProgress').textContent = `${myDone}/${script().length} Zeilen`;
      script().forEach((line, i) => {
        const chip = document.createElement('span'); chip.className = `dubProgressChip${hasRecording(line, uid()) ? ' mine done' : ''}`; chip.textContent = `${i + 1}. ${roleName(line.role)} ${hasRecording(line, uid()) ? '✓' : '·'}`; box.append(chip);
      });
    } else {
      const done = script().filter(line => Boolean(recordings()[recordingKey(line)]?.path)).length;
      $('dubRecordProgress').textContent = `${done}/${script().length} Zeilen`;
      script().forEach((line, i) => {
        const isDone = Boolean(recordings()[recordingKey(line)]?.path);
        const chip = document.createElement('span'); chip.className = `dubProgressChip${isDone ? ' done' : ''}`; chip.textContent = `${i + 1}. ${roleName(line.role)} ${isDone ? '✓' : '·'}`; box.append(chip);
      });
    }
  }

  function renderRecordingStudio() {
    const active = state.room.status === 'recording';
    $('dubRecordingPanel').hidden = !active;
    if (!active) return;
    const line = currentLine();
    if (!line) return;
    $('dubRecordHeading').textContent = mode() === 'parallel' ? `Deine Version · ${meName()}` : 'Gemeinsame Fassung';
    $('dubLineMeta').textContent = `Dialogzeile ${state.lineIndex + 1}`;
    $('dubLineRole').textContent = roleName(line.role);
    $('dubLineText').textContent = line.text;
    $('dubLineCounter').textContent = `${state.lineIndex + 1}/${script().length}`;
    $('dubPrevLine').disabled = state.lineIndex <= 0;
    $('dubNextLine').disabled = state.lineIndex >= script().length - 1;
    const key = recordingKey(line, uid());
    const saved = recordings()[key];
    $('dubRecordButton').disabled = !canRecord(line) || state.recorder?.state === 'recording';
    $('dubStopButton').disabled = state.recorder?.state !== 'recording';
    $('dubRecordButton').textContent = saved?.path ? '↻ Zeile neu aufnehmen' : '🎙️ Aufnahme starten';
    $('dubVoiceEffect').value = saved?.effect || 'original';
    if (!canRecord(line)) $('dubRecordStatus').textContent = `Diese Zeile gehört ${memberName(lineOwner(line))}. Du kannst die Aufnahme ansehen, aber nicht übernehmen.`;
    else if (saved?.path) $('dubRecordStatus').textContent = 'Aufnahme gespeichert. Du kannst sie erneut aufnehmen, solange die Runde läuft.';
    else $('dubRecordStatus').textContent = 'Mikrofon wird erst nach Tippen auf „Aufnahme starten“ aktiviert.';
    $('dubFinishVersion').hidden = mode() !== 'parallel';
    $('dubFinishRound').hidden = mode() === 'parallel' || !isHost();
    $('dubFinishVersion').disabled = !script().every(item => hasRecording(item, uid()));
    $('dubFinishRound').disabled = !(mode() !== 'parallel' && isHost());
    renderProgress();
  }

  function renderResults() {
    const visible = ['reveal', 'finished'].includes(state.room.status);
    $('dubResultsPanel').hidden = !visible;
    if (!visible) return;
    const box = $('dubResultsGrid'); box.replaceChildren();
    if (mode() === 'parallel') {
      const candidates = players().filter(p => state.room.submissions?.[p.id]);
      $('dubResultsInfo').textContent = `${candidates.length} fertige Versionen`;
      candidates.forEach(player => {
        const card = document.createElement('article'); card.className = 'dubResultCard';
        const name = document.createElement('strong'); name.textContent = player.name;
        const count = script().filter(line => recordings()[`parallel:${player.id}:${line.id}`]?.path).length;
        const voteCount = Object.values(state.room.votes || {}).filter(v => v === player.id).length;
        const meta = document.createElement('small'); meta.textContent = `${count}/${script().length} Zeilen aufgenommen · ${voteCount} Stimmen`;
        const actions = document.createElement('div'); actions.className = 'dubClipActions';
        const play = document.createElement('button'); play.type = 'button'; play.className = 'secondary'; play.textContent = '▶ Version ansehen'; play.addEventListener('click', () => { state.selectedCandidate = player.id; playVersion(player.id); });
        const vote = document.createElement('button'); vote.type = 'button'; vote.className = 'primary'; vote.textContent = state.room.votes?.[uid()] === player.id ? 'Deine Stimme ✓' : 'Für diese Version stimmen'; vote.disabled = state.room.votes?.[uid()] === player.id || player.id === uid(); vote.addEventListener('click', () => voteFor(player.id));
        actions.append(play, vote); card.append(name, meta, actions); box.append(card);
      });
      const winner = getWinner();
      const winnerVotes = winner ? Object.values(state.room.votes || {}).filter(candidate => candidate === winner).length : 0;
      $('dubWinner').textContent = winner ? `🏆 Aktueller Favorit: ${memberName(winner)} (${winnerVotes} Stimmen)` : 'Stimmt für eure Lieblingsversion ab.';
    } else {
      $('dubResultsInfo').textContent = 'Eine gemeinsame Fassung';
      const card = document.createElement('article'); card.className = 'dubResultCard';
      const title = document.createElement('strong'); title.textContent = 'Euer gemeinsamer Dub';
      const meta = document.createElement('small'); meta.textContent = `${script().length} Dialogzeilen · ${MODE_LABELS[mode()] || 'Charakter'}modus`;
      const play = document.createElement('button'); play.type = 'button'; play.className = 'primary'; play.textContent = '▶ Gemeinsame Fassung ansehen'; play.addEventListener('click', () => playVersion('character'));
      card.append(title, meta, play); box.append(card); $('dubWinner').textContent = 'Ein gemeinsames Ergebnis – es gibt keine Abstimmung.';
    }
  }

  async function signStoragePath(path) {
    if (!path) return null;
    const session = await deps.getSession();
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${deps.url}/storage/v1/object/sign/dub-media/${encoded}`, {
      method: 'POST', cache: 'no-store', headers: { apikey: deps.apiKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Datei konnte nicht freigegeben werden (${response.status}).`);
    const signed = data.signedURL || data.signedUrl || data.signed_url;
    if (!signed) throw new Error('Der Speicherdienst hat keinen gültigen Medienlink geliefert.');
    return /^https?:/i.test(signed) ? signed : `${deps.url}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
  }

  async function uploadStoragePath(path, fileOrBlob, contentType) {
    const session = await deps.getSession();
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const mediaType = String(contentType || fileOrBlob.type || 'application/octet-stream').split(';')[0].trim();
    const response = await fetch(`${deps.url}/storage/v1/object/dub-media/${encoded}`, {
      method: 'POST', cache: 'no-store', headers: { apikey: deps.apiKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': mediaType, 'x-upsert': 'true' },
      body: fileOrBlob
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Upload fehlgeschlagen (${response.status}).`);
    return data;
  }

  async function uploadClip() {
    const file = state.selectedFile;
    if (!file || !state.room) return;
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) { status('Bitte eine MP4-, WebM- oder MOV-Videodatei auswählen.', 'error'); return; }
    if (file.size > 25 * 1024 * 1024) { status('Der Clip ist größer als 25 MB. Bitte kürze die Datei zuerst.', 'error'); return; }
    if (!$('dubRightsCheck').checked) { status('Bitte bestätige zuerst, dass du die nötigen Rechte bzw. eine passende Lizenz besitzt.', 'error'); return; }
    if (!isHost() || state.room.status !== 'waiting') { status('Nur der Lobby-Host kann vor dem Start einen Clip hinzufügen.', 'error'); return; }
    const chosen = state.selectedSource;
    if (chosen && !chosen.safe && !$('dubRightsCheck').checked) { status('Für diese geschützte Quelle fehlt die Rechtebestätigung.', 'error'); return; }
    $('dubUploadClipButton').disabled = true;
    $('dubUploadProgress').textContent = 'Clip wird privat in eure Lobby hochgeladen …';
    try {
      const extension = file.type === 'video/webm' ? 'webm' : file.type === 'video/quicktime' ? 'mov' : 'mp4';
      const path = `${state.room.code}/clips/${uid()}/clip.${extension}`;
      await uploadStoragePath(path, file, file.type);
      const oldClip = state.room.clip || {};
      const clip = {
        ...oldClip, title: (chosen?.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 80), path, mime: file.type,
        source: chosen?.source || 'Eigener Upload', source_url: chosen?.url || '',
        license: chosen?.license || 'Eigene Datei · Rechte vom Uploader bestätigt',
        rights_confirmed: true, duration_hint: 'Videodatei', roles: roles().map(r => ({ id: r.id, name: r.name }))
      };
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: clip, p_script: script() });
      $('dubUploadProgress').textContent = 'Clip hochgeladen ✓';
      state.selectedFile = null; $('dubClipFile').value = ''; $('dubUploadClipButton').hidden = true;
      await refreshRoom(false); status('Clip wurde privat für die Lobby gespeichert.', 'success');
    } catch (error) { $('dubUploadProgress').textContent = ''; status(deps?.friendlyError?.(error) || error.message, 'error'); }
    finally { $('dubUploadClipButton').disabled = false; }
  }

  async function addRole() {
    const current = roles().map(r => ({ ...r }));
    if (current.length >= 12) { status('Es können höchstens 12 Personen/Rollen angelegt werden.', 'error'); return; }
    const n = current.length + 1; current.push({ id: `person-${Date.now().toString(36)}`, name: `Person ${n}` });
    state.room.clip = { ...(state.room.clip || {}), roles: current };
    renderRoles(); renderScriptEditor();
    await saveScript();
  }
  function addLine() {
    const list = state.room.script || [];
    const i = list.length + 1;
    list.push({ id: `line-${Date.now().toString(36)}`, role: roles()[0]?.id || 'person-1', text: '', start_sec: Math.max(0, (i - 1) * 2.5) });
    state.room.script = list; state.editorDirty = true; renderScriptEditor();
  }

  function renderRoom() {
    if (!state.room) return;
    $('dubSetup').hidden = true; $('dubLobby').hidden = false;
    $('dubRoomCode').textContent = state.room.code;
    $('dubRoomState').textContent = ({ waiting: 'Warte auf Mitspieler · Lobby offen', recording: 'Aufnahmen laufen · ihr könnt Zeilen wiederholen', reveal: 'Der Vorhang geht auf · stimmt ab', finished: 'Runde beendet' })[state.room.status] || state.room.status;
    $('dubStartRound').hidden = !isHost() || state.room.status !== 'waiting';
    $('dubStartHint').textContent = isHost() ? 'Du bist Host und kannst starten, sobald mindestens zwei Spieler verbunden sind.' : 'Der Host startet die Runde, sobald alle bereit sind.';
    $('dubLeaveRoom').hidden = false;
    $('dubSaveScript').hidden = !(isHost() && state.room.status === 'waiting');
    renderPlayers(); renderModeChoices();
    if (!state.editorDirty) { renderRoles(); renderScriptEditor(); }
    renderRecordingStudio(); renderResults();
    const clip = state.room.clip || {};
    if (clip.title) $('dubSelectedSourceText').textContent = `Aktueller Clip: ${clip.title} · ${clip.license || 'Lobby-Clip'}`;
    if (clip.path && state.signedClipPath !== clip.path) {
      state.signedClipPath = clip.path;
      signStoragePath(clip.path).then(url => {
        state.signedClipUrl = url;
        const video = $('dubVideo'); video.crossOrigin = 'anonymous'; video.src = url; video.load();
        $('dubNoVideo').hidden = true;
      }).catch(error => { $('dubNoVideo').hidden = false; $('dubNoVideo').textContent = error.message; });
    } else if (!clip.path) {
      $('dubNoVideo').hidden = false;
      $('dubNoVideo').textContent = 'Noch kein Clip hochgeladen. Ihr könnt das Skript trotzdem testen.';
    }
  }

  async function setMode(newMode) {
    if (!['parallel', 'character', 'scenario'].includes(newMode) || !state.room || !isHost() || state.room.status !== 'waiting') return;
    try { await apiRpc('set_dub_mode', { p_code: state.room.code, p_mode: newMode }); state.mode = newMode; await refreshRoom(false); status(`${MODE_LABELS[newMode]}-Modus ausgewählt.`, 'success'); }
    catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  async function startRound() {
    if (!state.room || !isHost()) return;
    const saved = await saveScript();
    if (!saved) return;
    if (players().length < 2) { status('Ihr braucht mindestens zwei Spieler in der Lobby.', 'error'); return; }
    try { await apiRpc('start_dub_round', { p_code: state.room.code }); await refreshRoom(false); state.lineIndex = 0; status('Die Runde läuft. Wählt eure Zeilen und sprecht sie ein!', 'success'); }
    catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }

  async function startRecording() {
    const line = currentLine();
    if (!line || !canRecord(line) || state.recorder?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { status('Dein Browser unterstützt keine Mikrofonaufnahme. Bitte öffne die Seite in einem aktuellen Browser über HTTPS.', 'error'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      state.micStream = stream; state.recordChunks = []; state.recordLineId = line.id; state.recordEffect = $('dubVoiceEffect').value;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported?.(type));
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      state.recorder = recorder; state.recordStartedAt = performance.now();
      recorder.ondataavailable = event => { if (event.data?.size) state.recordChunks.push(event.data); };
      recorder.onstop = () => {
        const saveTask = saveRecordingBlob(recorder.mimeType || 'audio/webm');
        const wrappedTask = saveTask.finally(() => { if (state.recordingSavePromise === wrappedTask) state.recordingSavePromise = null; });
        state.recordingSavePromise = wrappedTask;
      };
      recorder.start(250);
      $('dubRecordButton').disabled = true; $('dubStopButton').disabled = false; $('dubRecordStatus').textContent = 'Aufnahme läuft … sprich deine Zeile. Du kannst sie danach erneut aufnehmen.';
      startMicMeter(stream);
      status('Mikrofon aktiv. Die Aufnahme wird erst beim Stoppen hochgeladen.', 'success');
    } catch (error) {
      status(error.name === 'NotAllowedError' ? 'Mikrofonzugriff wurde nicht erlaubt. Prüfe die Browser-Berechtigung.' : `Mikrofon konnte nicht gestartet werden: ${error.message}`, 'error');
    }
  }
  function stopRecording() {
    if (state.recorder?.state === 'recording') state.recorder.stop();
    stopMicMeter();
    $('dubStopButton').disabled = true;
    $('dubRecordStatus').textContent = 'Aufnahme wird gespeichert …';
  }
  function startMicMeter(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      state.audioContext = state.audioContext || new AudioCtx();
      const source = state.audioContext.createMediaStreamSource(stream);
      const analyser = state.audioContext.createAnalyser(); analyser.fftSize = 256; source.connect(analyser); state.analyser = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      state.micMeterTimer = setInterval(() => {
        if (!state.analyser) return;
        state.analyser.getByteTimeDomainData(data);
        let total = 0; for (const x of data) { const v = (x - 128) / 128; total += v * v; }
        const level = Math.min(100, Math.round(Math.sqrt(total / data.length) * 260));
        $('dubMicLevel').style.width = `${level}%`;
        const canvas = $('dubWaveform');
        if (canvas) {
          const ctx = canvas.getContext('2d'); const w = canvas.width; const h = canvas.height;
          ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#6a58c5'; ctx.lineWidth = 2; ctx.beginPath();
          const mid = h / 2; const step = w / Math.max(1, data.length - 1);
          for (let i = 0; i < data.length; i++) { const x = i * step; const y = (data[i] / 255) * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
          ctx.stroke(); ctx.strokeStyle = 'rgba(106,88,197,.18)'; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
        }
      }, 70);
    } catch (error) { console.warn('Mikrofonpegel konnte nicht visualisiert werden', error); }
  }
  function stopMicMeter() {
    if (state.micMeterTimer) clearInterval(state.micMeterTimer);
    state.micMeterTimer = null; state.analyser = null; $('dubMicLevel').style.width = '0%';
    const canvas = $('dubWaveform'); if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  async function saveRecordingBlob(mime) {
    const stream = state.micStream; state.micStream = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    const line = script().find(item => item.id === state.recordLineId);
    const blob = new Blob(state.recordChunks, { type: mime || 'audio/webm' });
    if (!line || !blob.size) { $('dubRecordStatus').textContent = 'Keine Audiodaten aufgenommen.'; return; }
    const duration = Math.round(performance.now() - state.recordStartedAt);
    const scope = mode() === 'parallel' ? 'parallel' : 'character';
    const fileExtension = mime.includes('mp4') ? 'm4a' : 'webm';
    const fileName = `${scope}-${line.id}.${fileExtension}`.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${state.room.code}/voices/${uid()}/${fileName}`;
    $('dubRecordStatus').textContent = 'Spur wird privat hochgeladen …';
    try {
      await uploadStoragePath(path, blob, mime || 'audio/webm');
      await apiRpc('save_dub_recording', { p_code: state.room.code, p_line_id: line.id, p_scope: scope, p_path: path, p_duration_ms: duration, p_effect: state.recordEffect });
      $('dubRecordStatus').textContent = `Gespeichert ✓ · ${(duration / 1000).toFixed(1).replace('.', ',')} Sek.`;
      await refreshRoom(false);
      const next = state.lineIndex + 1;
      if (next < script().length && canRecord(script()[next])) state.lineIndex = next;
      renderRecordingStudio();
    } catch (error) {
      $('dubRecordStatus').textContent = 'Speichern fehlgeschlagen.';
      status(deps?.friendlyError?.(error) || error.message, 'error');
    } finally { state.recordChunks = []; state.recorder = null; }
  }

  async function finishVersion() {
    if (!state.room || mode() !== 'parallel') return;
    try { await apiRpc('finish_dub_version', { p_code: state.room.code }); await refreshRoom(false); status('Deine Version wurde abgegeben.', 'success'); }
    catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  async function finishRound() {
    if (!state.room || !isHost()) return;
    try { await apiRpc('finish_dub_round', { p_code: state.room.code }); await refreshRoom(false); status('Die Ergebnisse sind bereit.', 'success'); }
    catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  async function voteFor(playerId) {
    if (!state.room || mode() !== 'parallel') return;
    try { await apiRpc('vote_dub_version', { p_code: state.room.code, p_candidate_id: playerId }); await refreshRoom(false); status('Deine Stimme wurde gezählt.', 'success'); }
    catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  function getWinner() {
    const votes = Object.values(state.room?.votes || {});
    if (!votes.length) return null;
    const counts = new Map(); votes.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  async function playClipAtLine() {
    const line = currentLine(); const video = $('dubVideo');
    if (!state.room?.clip?.path || !state.signedClipUrl) { $('dubRecordStatus').textContent = 'Lade zuerst einen Videoclip hoch.'; return; }
    try {
      video.muted = !$('dubOriginalAudio').checked;
      video.currentTime = Math.max(0, Number(line?.start_sec) || 0);
      await video.play();
    } catch (error) { status(`Clip konnte nicht abgespielt werden: ${error.message}`, 'error'); }
  }

  function effectNodes(context, source, effect, destination) {
    if (effect === 'chipmunk') source.playbackRate.value = 1.25;
    if (effect === 'monster') source.playbackRate.value = 0.82;
    if (effect === 'phone') {
      const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 320;
      const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 3200;
      source.connect(high); high.connect(low); low.connect(destination); return;
    }
    if (effect === 'robot') {
      const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1050; filter.Q.value = 0.8;
      const shaper = context.createWaveShaper();
      const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i * 2 / 255 - 1; curve[i] = Math.tanh(4 * x); }
      shaper.curve = curve; source.connect(filter); filter.connect(shaper); shaper.connect(destination); return;
    }
    if (effect === 'echo') {
      const dry = context.createGain(); dry.gain.value = 0.9; source.connect(dry); dry.connect(destination);
      const delay = context.createDelay(1); delay.delayTime.value = 0.23;
      const feedback = context.createGain(); feedback.gain.value = 0.22;
      const wet = context.createGain(); wet.gain.value = 0.28;
      source.connect(delay); delay.connect(wet); wet.connect(destination); delay.connect(feedback); feedback.connect(delay); return;
    }
    source.connect(destination);
  }

  async function loadAudioBuffer(path) {
    const url = await signStoragePath(path);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Audio konnte nicht geladen werden (${response.status}).`);
    const buffer = await response.arrayBuffer();
    const context = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
    state.audioContext = context;
    return context.decodeAudioData(buffer);
  }
  async function playVersion(candidateId) {
    if (!state.room) return;
    try {
      if (state.playbackTimer) clearTimeout(state.playbackTimer);
      state.activeSources.forEach(source => { try { source.stop(); } catch {} }); state.activeSources = [];
      const context = state.audioContext || new (window.AudioContext || window.webkitAudioContext)(); state.audioContext = context;
      await context.resume();
      const isParallel = mode() === 'parallel';
      const lines = script();
      const clips = lines.map(line => {
        const key = isParallel ? `parallel:${candidateId}:${line.id}` : `character:${line.id}`;
        return { line, recording: recordings()[key] };
      }).filter(item => item.recording?.path);
      if (!clips.length) { status('Für diese Version sind noch keine Aufnahmen gespeichert.', 'error'); return; }
      const buffers = await Promise.all(clips.map(async item => ({ ...item, buffer: await loadAudioBuffer(item.recording.path) })));
      const video = $('dubVideo');
      if (state.room.clip?.path && state.signedClipUrl) { video.muted = !$('dubResultsOriginalAudio')?.checked; video.currentTime = 0; await video.play().catch(() => {}); }
      const startAt = context.currentTime + 0.18;
      buffers.forEach(item => {
        const source = context.createBufferSource(); source.buffer = item.buffer;
        const output = context.createGain(); output.gain.value = 1;
        effectNodes(context, source, EFFECTS.includes(item.recording.effect) ? item.recording.effect : 'original', output);
        output.connect(context.destination);
        source.start(startAt + Math.max(0, Number(item.line.start_sec) || 0));
        state.activeSources.push(source);
      });
      const maxEnd = buffers.reduce((max, item) => { const rate = item.recording.effect === 'chipmunk' ? 1.25 : item.recording.effect === 'monster' ? 0.82 : 1; return Math.max(max, (Number(item.line.start_sec) || 0) + item.buffer.duration / rate + 0.6); }, 1);
      state.playbackTimer = setTimeout(() => { if (video) video.pause(); }, maxEnd * 1000 + 500);
      $('dubExportStatus').textContent = `Wiedergabe gestartet: ${buffers.length} Dialogzeilen.`;
      status('Dub wird abgespielt.', 'success');
    } catch (error) { status(`Wiedergabe fehlgeschlagen: ${error.message}`, 'error'); }
  }

  async function exportVideo() {
    if (!state.room?.clip?.path || !state.signedClipUrl) { status('Für den Videoexport müsst ihr zuerst eine Videodatei hochladen.', 'error'); return; }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { status('Dein Browser unterstützt den Videoexport nicht. Die Aufnahme kann trotzdem im Browser abgespielt werden.', 'error'); return; }
    const candidate = mode() === 'parallel' ? (state.selectedCandidate || uid()) : 'character';
    const keyed = script().map(line => ({ line, rec: recordings()[mode() === 'parallel' ? `parallel:${candidate}:${line.id}` : `character:${line.id}`] })).filter(x => x.rec?.path);
    if (!keyed.length) { status('Keine passenden Tonspuren zum Export vorhanden.', 'error'); return; }
    const video = $('dubVideo');
    const width = Math.min(1280, video.videoWidth || 1280); const height = Math.min(720, video.videoHeight || 720);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const canvasStream = canvas.captureStream(30);
    const context = state.audioContext || new (window.AudioContext || window.webkitAudioContext)(); state.audioContext = context; await context.resume();
    const destination = context.createMediaStreamDestination();
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) { status('Dieser Browser kann leider keine WebM-/MP4-Datei erstellen.', 'error'); return; }
    const includeOriginalAudio = Boolean($('dubResultsOriginalAudio')?.checked);
    let originalCapture = null; let recorder = null; let raf = 0; let alive = false;
    const decoded = await Promise.all(keyed.map(async item => ({ ...item, buffer: await loadAudioBuffer(item.rec.path) })));
    const paint = () => {
      if (!alive) return;
      try { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, width, height); if (video.readyState >= 2) ctx.drawImage(video, 0, 0, width, height); }
      catch (error) { console.warn('Videobild konnte nicht gezeichnet werden', error); }
      raf = requestAnimationFrame(paint);
    };
    $('dubExportStatus').textContent = 'Video wird gerendert … bitte dieses Fenster geöffnet lassen.';
    try {
      video.muted = !includeOriginalAudio; video.currentTime = 0; await video.play();
      // Capture audio only after playback begins, so browsers have had time to expose the media tracks.
      originalCapture = includeOriginalAudio && typeof video.captureStream === 'function' ? video.captureStream() : null;
      const originalAudioTracks = originalCapture ? originalCapture.getAudioTracks() : [];
      const exportStream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks(), ...originalAudioTracks]);
      recorder = new MediaRecorder(exportStream, { mimeType: mime }); const chunks = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.start(250); alive = true; paint();
      const startAt = context.currentTime + 0.25;
      decoded.forEach(item => {
        const source = context.createBufferSource(); source.buffer = item.buffer;
        const output = context.createGain(); effectNodes(context, source, EFFECTS.includes(item.rec.effect) ? item.rec.effect : 'original', output);
        output.connect(destination);
        source.start(startAt + Math.max(0, Number(item.line.start_sec) || 0));
      });
      const duration = Number.isFinite(video.duration) ? video.duration : decoded.reduce((max, x) => { const rate = x.rec.effect === 'chipmunk' ? 1.25 : x.rec.effect === 'monster' ? 0.82 : 1; return Math.max(max, (Number(x.line.start_sec) || 0) + x.buffer.duration / rate); }, 0);
      await new Promise(resolve => setTimeout(resolve, Math.max(1500, Math.min(180000, (duration + 1.2) * 1000))));
      alive = false; cancelAnimationFrame(raf);
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
        recorder.onerror = event => reject(event.error || new Error('Videoexport fehlgeschlagen.'));
      });
      recorder.stop();
      const blob = await stopped;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `dub-${state.room.code.toLowerCase()}-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('dubExportStatus').textContent = `Video gespeichert · ${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB.`;
    } catch (error) {
      alive = false; cancelAnimationFrame(raf); if (recorder?.state === 'recording') recorder.stop();
      $('dubExportStatus').textContent = `Export nicht möglich: ${error.message}`; status(error.message, 'error');
    } finally {
      video.pause(); canvasStream.getTracks().forEach(track => track.stop()); destination.stream.getTracks().forEach(track => track.stop()); originalCapture?.getTracks().forEach(track => track.stop());
    }
  }

  function exportPack() {
    const payload = { app: 'Dub Together Web', version: 1, title: state.room?.clip?.title || 'Dub-Pack', clipSource: state.room?.clip?.source_url || '', roles: roles().map(r => ({ ...r })), script: script().map(line => ({ ...line })), note: 'Dieses JSON enthält Dialoge und Rollen, keine Video- oder Audio-Dateien. Prüfe vor dem Teilen alle Clip-Rechte.' };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'dub-pack.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function importPack(file) {
    if (!file || !state.room || !isHost() || state.room.status !== 'waiting') return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.roles) || !Array.isArray(data.script) || data.script.length < 1 || data.script.length > 60) throw new Error('Pack-Datei hat kein gültiges Rollen-/Skriptformat.');
      const cleanRoles = data.roles.slice(0, 12).map((r, i) => ({ id: String(r.id || `person-${i + 1}`).slice(0, 40), name: String(r.name || `Person ${i + 1}`).slice(0, 30) }));
      const cleanScript = data.script.map((line, i) => ({ id: String(line.id || `line-${i + 1}`).slice(0, 40), role: cleanRoles.some(r => r.id === line.role) ? line.role : cleanRoles[0].id, text: String(line.text || '').slice(0, 240), start_sec: Math.max(0, Math.min(600, Number(line.start_sec) || 0)) })).filter(line => line.text.trim());
      if (!cleanScript.length) throw new Error('Das Pack enthält keine Dialogzeilen.');
      const clip = { ...(state.room.clip || {}), title: String(data.title || 'Importiertes Dub-Pack').slice(0, 80), roles: cleanRoles };
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: clip, p_script: cleanScript });
      await refreshRoom(false); status('Pack importiert. Wenn es einen Videoclip braucht, ladet die passende Datei mit geklärten Rechten hoch.', 'success');
    } catch (error) { status(`Pack konnte nicht importiert werden: ${error.message}`, 'error'); }
    finally { $('dubImportPack').value = ''; }
  }

  async function copyCode() {
    if (!state.room?.code) return;
    try { await navigator.clipboard.writeText(state.room.code); $('dubCopyCode').textContent = 'Kopiert ✓'; setTimeout(() => $('dubCopyCode').textContent = 'Code kopieren', 1400); }
    catch { status(`Raumcode: ${state.room.code}`, 'success'); }
  }
  async function shareRoom() {
    if (!state.room?.code) return;
    const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('dub', state.room.code);
    const share = { title: 'Dub Together Lobby', text: `Tritt meinem Dub-Raum ${state.room.code} bei.`, url: url.toString() };
    try { if (navigator.share) await navigator.share(share); else { await navigator.clipboard.writeText(`${share.text} ${share.url}`); status('Einladungslink kopiert.', 'success'); } }
    catch (error) { if (error.name !== 'AbortError') status(`Teile den Code ${state.room.code} mit deinen Freunden.`, 'success'); }
  }
  async function removeStoragePaths(paths) {
    const unique = [...new Set((paths || []).filter(path => typeof path === 'string' && path.startsWith(`${state.room?.code}/`)))];
    if (!unique.length) return;
    const session = await deps.getSession();
    const response = await fetch(`${deps.url}/storage/v1/object/dub-media`, {
      method: 'DELETE', cache: 'no-store',
      headers: { apikey: deps.apiKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: unique })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Mediendateien konnten nicht entfernt werden (${response.status}).`);
  }

  async function leaveRoom() {
    stopPolling();
    const activeRecorder = state.recorder;
    if (activeRecorder?.state === 'recording') {
      const stopped = new Promise(resolve => activeRecorder.addEventListener('stop', resolve, { once: true }));
      stopRecording();
      await stopped;
    }
    if (state.recordingSavePromise) await state.recordingSavePromise;
    if (state.playbackTimer) clearTimeout(state.playbackTimer); state.playbackTimer = null;
    state.activeSources.forEach(source => { try { source.stop(); } catch {} }); state.activeSources = [];
    let mediaCleanupFailed = false; let membershipCleanupFailed = false;
    if (state.room?.code) {
      const allRecordings = Object.values(recordings()).filter(item => item?.path);
      const mediaPaths = isHost()
        ? [state.room.clip?.path, ...allRecordings.map(item => item.path)]
        : allRecordings.filter(item => item.owner_id === uid()).map(item => item.path);
      try { await removeStoragePaths(mediaPaths); }
      catch (error) { mediaCleanupFailed = true; console.warn('Mediendateien konnten nicht vollständig entfernt werden:', error); }
      try { await apiRpc('leave_dub_room', { p_code: state.room.code }); }
      catch (error) { membershipCleanupFailed = true; console.warn('Lobby konnte nicht vollständig verlassen werden', error); }
    }
    state.room = null; state.editorDirty = false; state.mode = 'parallel'; state.signedClipPath = ''; state.signedClipUrl = ''; state.selectedCandidate = null;
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    $('dubSetup').hidden = false; $('dubLobby').hidden = true; $('dubRecordingPanel').hidden = true; $('dubResultsPanel').hidden = true;
    const video = $('dubVideo'); if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    const leaveMessage = mediaCleanupFailed ? 'Du hast die Lobby lokal verlassen. Einige private Mediendateien konnten nicht entfernt werden; bitte den Betreiber um eine Löschprüfung.' : membershipCleanupFailed ? 'Die Lobby konnte serverseitig nicht vollständig verlassen werden. Prüfe deine Verbindung und lade die Seite neu.' : 'Du hast die Dub-Lobby verlassen und die zugehörigen Mediendateien wurden zur Löschung übermittelt.';
    status(leaveMessage, mediaCleanupFailed || membershipCleanupFailed ? 'error' : 'success');
  }

  function rememberProtectedLink() {
    const title = String($('dubProtectedTitle').value || '').trim().slice(0, 80);
    const url = String($('dubProtectedUrl').value || '').trim();
    if (!title || !/^https:\/\//i.test(url)) { status('Bitte einen Clip-Titel und einen gültigen HTTPS-Link eintragen.', 'error'); return; }
    state.selectedSource = { id: `protected-user-${Date.now()}`, title, region: 'international', kind: 'Viraler Creator-Clip · Link vorgemerkt', length: 'Externer Link', summary: 'Nur mit schriftlicher Erlaubnis oder geeigneter Lizenz verwenden.', source: 'Vom Nutzer eingetragene Quelle', url, license: 'Copyright · Rechte prüfen', safe: false };
    $('dubSelectedSourceText').textContent = `Geschützte Quelle vorgemerkt: ${title}. Vor dem Upload brauchst du die passende Erlaubnis.`;
    $('dubRightsCheck').checked = false; status('Link wurde als geschützte Quelle vorgemerkt. Noch keine Nutzungsrechte bestätigt.', 'success');
  }

  function initEvents() {
    $('dubCreateRoom').addEventListener('click', createRoom);
    $('dubJoinRoom').addEventListener('click', () => joinRoom());
    $('dubJoinCode').addEventListener('input', () => { $('dubJoinCode').value = $('dubJoinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    $('dubJoinCode').addEventListener('keydown', event => { if (event.key === 'Enter') joinRoom(); });
    $('dubRefreshRooms').addEventListener('click', refreshPublicRooms);
    document.querySelectorAll('[data-dub-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.dubMode)));
    document.querySelectorAll('[data-dub-library]').forEach(button => button.addEventListener('click', () => {
      state.selectedLibrary = button.dataset.dubLibrary;
      document.querySelectorAll('[data-dub-library]').forEach(item => item.classList.toggle('active', item === button)); renderClipLibrary();
    }));
    $('dubClipFile').addEventListener('change', event => { state.selectedFile = event.target.files?.[0] || null; if (state.selectedFile) { $('dubUploadProgress').textContent = `${state.selectedFile.name} ausgewählt · ${Math.ceil(state.selectedFile.size / 1024 / 1024)} MB. Bestätige die Rechte und klicke dann auf „Clip hochladen“.`; $('dubUploadClipButton').hidden = false; } });
    $('dubRightsCheck').addEventListener('change', event => { if (event.target.checked) $('dubUploadProgress').textContent = 'Rechtebestätigung gesetzt. Klicke auf „Clip hochladen“, um fortzufahren.'; });
    $('dubUploadClipButton').addEventListener('click', uploadClip);
    $('dubRememberProtectedClip').addEventListener('click', rememberProtectedLink);
    $('dubAddRole').addEventListener('click', addRole);
    $('dubAddLine').addEventListener('click', addLine);
    $('dubSaveScript').addEventListener('click', saveScript);
    $('dubStartRound').addEventListener('click', startRound);
    $('dubRecordButton').addEventListener('click', startRecording);
    $('dubStopButton').addEventListener('click', stopRecording);
    $('dubPrevLine').addEventListener('click', () => { state.lineIndex = Math.max(0, state.lineIndex - 1); renderRecordingStudio(); });
    $('dubNextLine').addEventListener('click', () => { state.lineIndex = Math.min(script().length - 1, state.lineIndex + 1); renderRecordingStudio(); });
    $('dubPlayLine').addEventListener('click', playClipAtLine);
    $('dubFinishVersion').addEventListener('click', finishVersion);
    $('dubFinishRound').addEventListener('click', finishRound);
    $('dubReplaySelected').addEventListener('click', () => playVersion(state.selectedCandidate || (mode() === 'parallel' ? uid() : 'character')));
    $('dubExportVideo').addEventListener('click', exportVideo);
    $('dubStreamerMode').addEventListener('change', event => $('dubLobby').classList.toggle('streamer-mode', event.target.checked));
    $('dubCopyCode').addEventListener('click', copyCode);
    $('dubShareRoom').addEventListener('click', shareRoom);
    $('dubLeaveRoom').addEventListener('click', leaveRoom);
    $('dubExportPack').addEventListener('click', exportPack);
    $('dubImportPack').addEventListener('change', event => importPack(event.target.files?.[0]));
    if (deps?.onOpen) {
      $('launchGameDub').addEventListener('click', () => deps.onOpen());
      $('gameTabDub').addEventListener('click', () => deps.onOpen());
      $('dubDrawerButton')?.addEventListener('click', () => deps.onOpen());
    }
  }

  function init(dependencies) {
    deps = dependencies;
    if (!$('dubModePanel')) return;
    initEvents(); renderClipLibrary();
    const incoming = codeFromUrl();
    if (incoming) { $('dubJoinCode').value = incoming.toUpperCase().slice(0, 6); }
  }
  function isInRoom() { return Boolean(state.room); }
  function openPanel() {
    if (!deps) return;
    deps.showPanel?.();
    if (deps.selectGame) deps.selectGame('dub');
    if (state.room) refreshRoom(false); else refreshPublicRooms();
  }
  window.DubTogether = { init, openPanel, isInRoom, refreshPublicRooms, leaveRoom };
})();
