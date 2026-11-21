/* Dub Together v138 (CORS-safe canvas export, 3-2-1 recording countdown, clean dub mix and host playback sync) on top of v132: playback-first signed Storage player; original uploads stay untouched; GitHub Actions creates a shared H.264/AAC playback MP4.
   The phone never downloads or runs the FFmpeg engine. */
(function () {
  'use strict';

  const CLIPS = [
    {
      id: 'commons-students-talk-wikipedia', region: 'international', title: 'Demo-Gespräch: Studierende über Wikipedia',
      kind: 'Demo-Clip mit Originalton', length: '1 Minute 14 Sekunden · Querformat · ca. 7,3 MB',
      summary: 'Englischer Gesprächsclip mit Originalton. Gut, um automatische Transkription und Stimmtrennung auszuprobieren.',
      source: 'Gr3524a / Wikimedia Commons',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Students_talk_about_Wikipedia.webm',
      videoUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Students_talk_about_Wikipedia.webm',
      mime: 'video/webm', extension: 'webm',
      license: 'CC BY-SA 4.0 · Namensnennung erforderlich', safe: true,
      attribution: 'Video: “Students talk about Wikipedia” by Gr3524a, Wikimedia Commons, CC BY-SA 4.0. Original: https://commons.wikimedia.org/wiki/File:Students_talk_about_Wikipedia.webm. Änderungen: Originalton wird durch neu aufgenommene Dub-Stimmen ersetzt.'
    }
  ];
  const DEFAULT_ROLES = [
    { id: 'speaker-a', name: 'Name nicht erkannt · Stimme A' },
    { id: 'speaker-b', name: 'Name nicht erkannt · Stimme B' }
  ];
  const DEFAULT_SCRIPT = [
    { id: 'line-1', role: 'speaker-a', text: 'Was passiert hier gerade?', start_sec: 0, end_sec: 2.2 },
    { id: 'line-2', role: 'speaker-b', text: 'Ich glaube, das wird noch spannend.', start_sec: 2.5, end_sec: 4.7 },
    { id: 'line-3', role: 'speaker-a', text: 'Warte kurz – ich habe eine Idee!', start_sec: 5, end_sec: 7.4 }
  ];
  const MODE_LABELS = { parallel: 'Parallel', character: 'Charakter', scenario: 'Szenario' };
  const MODE_HINTS = {
    parallel: 'Alle sprechen denselben Clip vollständig neu. Am Ende werden die Versionen nacheinander gezeigt und abgestimmt.',
    character: 'Jeder bekommt eine feste Person aus dem Clip. Die zugewiesene Person spricht nur ihre eigenen Zeilen; daraus wird eine gemeinsame Fassung.',
    scenario: 'Ihr erfindet die Dialoge selbst. Legt Personen, Rollen und Zeilen im Pack Creator fest und spielt eure Szene gemeinsam.'
  };
  const EFFECTS = ['original', 'chipmunk', 'monster', 'echo', 'robot', 'phone'];
  const MIN_LINE_DURATION_SEC = 0.08;

  let deps = null;
  let state = {
    room: null, poll: null, busy: false, mode: 'character', meId: null, editorDirty: false, recordingSavePromise: null,
    selectedSource: null, selectedLibrary: 'all', selectedFile: null, sourceClipFile: null,
    lineIndex: 0, selectedCandidate: null, recorder: null, micStream: null, recordingFrame: 0, recordingLineEndSec: 0, playbackFrame: 0,
    audioContext: null, analyser: null, micMeterTimer: null, recordStartedAt: 0, recordingTimer: null,
    recordChunks: [], recordLineId: null, recordEffect: 'original', countdownActive: false, countdownCancelled: false, playbackSyncTimer: null, lastPlaybackSyncId: '', playbackSyncApplying: false, hostSyncLastSentAt: 0,
    transcodeTicker: null, transcodeTickKey: '', transcodeLocalStartedAt: 0,
    videoObjectUrl: null, localClipPreviewUrl: '', templatePreviewUrl: '', previewRemoteFailed: false,
    previewSourceKey: '', signedClipPath: '', signedClipUrl: '', signedClipExpiresAt: 0, signingClipPath: '',
    analysisBusy: false, exportBusy: false, activeSources: [], playbackTimer: null, canvasFrame: 0, videoReadyPromise: null,
    exportObjectUrl: '', exportFilename: '', communityPacks: [],
    twitch: { token: '', clientId: '', channel: '', socket: null, oauthState: null, connected: false, userId: '', broadcasterId: '' },
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

  // File extension of the chosen clip (needed for the storage path). Falls back to mp4.
  function clipFileExtension(file) {
    const match = String(file?.name || '').match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : 'mp4';
  }

  // ---- MP4 header inspection -------------------------------------------------
  // MP4 is only a container. This reads the box structure (not the video itself) to
  // tell WHY a browser may refuse a file: unsupported codec (e.g. HEVC) or a broken file.
  const VIDEO_CODEC_LABELS = {
    avc1: 'H.264/AVC', avc3: 'H.264/AVC', hvc1: 'H.265/HEVC', hev1: 'H.265/HEVC', dvh1: 'H.265/HEVC (Dolby Vision)',
    dvhe: 'H.265/HEVC (Dolby Vision)', av01: 'AV1', vp09: 'VP9', mp4v: 'MPEG-4 Part 2', s263: 'H.263', apch: 'Apple ProRes',
    apcn: 'Apple ProRes', apco: 'Apple ProRes', ap4h: 'Apple ProRes', mjpa: 'Motion-JPEG', jpeg: 'Motion-JPEG'
  };
  const AUDIO_CODEC_LABELS = { mp4a: 'AAC', 'ac-3': 'AC-3', 'ec-3': 'E-AC-3', Opus: 'Opus', alac: 'ALAC', samr: 'AMR', '.mp3': 'MP3', sowt: 'PCM', twos: 'PCM', fLaC: 'FLAC' };

  async function inspectVideoFile(file) {
    const info = { container: 'unknown', video: '', audio: '', width: 0, height: 0, profile: 0, seconds: 0, broken: '' };
    try {
      const read = async (start, length) => new Uint8Array(await file.slice(start, Math.min(file.size, start + length)).arrayBuffer());
      const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const four = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      const head = await read(0, 16);
      if (head.length < 12) { info.broken = 'empty'; return info; }
      const first = four(head, 4);
      if (!['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(first)) {
        if (u32(head, 0) === 0x1a45dfa3) info.container = 'webm';
        else if (four(head, 0) === 'RIFF' && four(head, 8).startsWith('AVI')) info.container = 'avi';
        else if (head[0] === 0x47 || four(head, 0) === 'OggS' || four(head, 0) === '\0\0\u0001\u00ba') info.container = 'other';
        return info;
      }
      info.container = 'mp4';
      let pos = 0, moov = null;
      while (pos + 8 <= file.size) {
        const h = await read(pos, 16);
        let size = u32(h, 0), headerSize = 8; const type = four(h, 4);
        if (size === 1) { size = u32(h, 8) * 4294967296 + u32(h, 12); headerSize = 16; }
        else if (size === 0) size = file.size - pos;
        if (size < headerSize) { info.broken = 'bad-box'; break; }
        if (pos + size > file.size) { info.broken = 'truncated'; break; }
        if (type === 'moov') { if (size <= 64 * 1024 * 1024) moov = await read(pos + headerSize, size - headerSize); break; }
        pos += size;
      }
      if (!moov) { if (!info.broken && pos >= file.size) info.broken = 'no-moov'; return info; }
      const kids = (buf, from, to) => {
        const out = []; let p = from;
        while (p + 8 <= to) {
          let sz = u32(buf, p), hs = 8; const t = four(buf, p + 4);
          if (sz === 1) { sz = u32(buf, p + 8) * 4294967296 + u32(buf, p + 12); hs = 16; } else if (sz === 0) sz = to - p;
          if (sz < hs || p + sz > to) break;
          out.push({ t, s: p + hs, e: p + sz }); p += sz;
        }
        return out;
      };
      const child = (box, type) => box && kids(moov, box.s, box.e).find(k => k.t === type);
      const top = kids(moov, 0, moov.length);
      const mvhd = top.find(k => k.t === 'mvhd');
      if (mvhd) {
        const v1 = moov[mvhd.s] === 1, scale = u32(moov, mvhd.s + (v1 ? 20 : 12));
        const dur = v1 ? u32(moov, mvhd.s + 24) * 4294967296 + u32(moov, mvhd.s + 28) : u32(moov, mvhd.s + 16);
        if (scale) info.seconds = Math.round(dur / scale * 10) / 10;
      }
      for (const trak of top.filter(k => k.t === 'trak')) {
        const mdia = child(trak, 'mdia'), hdlr = child(mdia, 'hdlr');
        const stsd = child(child(child(mdia, 'minf'), 'stbl'), 'stsd');
        if (!hdlr || !stsd) continue;
        const handler = four(moov, hdlr.s + 8), entry = stsd.s + 8, code = four(moov, entry + 4);
        if (handler === 'vide' && !info.video) {
          info.video = code; info.width = (moov[entry + 32] << 8) | moov[entry + 33]; info.height = (moov[entry + 34] << 8) | moov[entry + 35];
          const entryEnd = Math.min(stsd.e, entry + u32(moov, entry));
          const cfg = kids(moov, entry + 86, entryEnd).find(k => k.t === 'avcC' || k.t === 'hvcC');
          if (cfg) info.profile = cfg.t === 'avcC' ? moov[cfg.s + 1] : moov[cfg.s + 1] & 0x1f;
        } else if (handler === 'soun' && !info.audio) info.audio = code;
      }
    } catch (error) { console.warn('Videodatei konnte nicht untersucht werden:', error); }
    return info;
  }

  // Plain H.264 (up to High profile, 8-bit) plays practically everywhere.
  function isFriendlyVideo(info) { return ['avc1', 'avc3'].includes(info?.video) && (!info.profile || info.profile <= 100); }

  function videoCodecLabel(info) { return VIDEO_CODEC_LABELS[info?.video] || (info?.video ? `„${info.video}“` : ''); }

  // Plain-language verdict for a chosen file. `blocking` means no browser or app can ever play it.
  function describeVideoInspection(info, name) {
    const quoted = `„${name}“`;
    const reasons = {
      truncated: 'das Dateiende fehlt, z. B. durch einen abgebrochenen Download oder eine unterbrochene Aufnahme',
      'no-moov': 'die Inhaltsangabe der Datei („moov“) fehlt, die Aufnahme wurde vermutlich nicht sauber beendet',
      empty: 'die Datei ist leer', 'bad-box': 'die Dateistruktur ist beschädigt'
    };
    if (info.broken) return { blocking: true, text: `${quoted} ist unvollständig oder beschädigt (${reasons[info.broken] || info.broken}). Das kann kein Browser und keine App abspielen. Bitte exportiere oder lade das Video noch einmal herunter und wähle es dann erneut aus.` };
    if (info.container === 'unknown' && /\.(mp4|m4v|mov)$/i.test(name)) return { blocking: true, text: `${quoted} hat die Endung .mp4, enthält aber kein erkennbares Videoformat. Bitte wähle die richtige Videodatei aus.` };
    if (info.container !== 'mp4' || !info.video) return { blocking: false, text: `${quoted} wird unverändert hochgeladen. Der Server prüft und wandelt sie bei Bedarf in ein kompatibles Format um.` };
    const label = videoCodecLabel(info), audio = AUDIO_CODEC_LABELS[info.audio] || info.audio;
    const facts = [label, audio, info.width && info.height ? `${info.width}×${info.height}` : '', info.seconds ? `${info.seconds} s` : ''].filter(Boolean).join(' · ');
    if (isFriendlyVideo(info)) return { blocking: false, text: `✓ ${quoted}: ${facts}. Dieses Format spielen praktisch alle Browser und Handys ab.` };
    return { blocking: false, text: `${quoted} ist eine intakte MP4-Datei (${facts}). Aber: MP4 ist nur der Container – entscheidend ist der Codec darin, und ${label} können viele Browser nicht abspielen (Fehler „MediaError 4“). Das ist kein Defekt. Du kannst die Datei trotzdem hochladen: Ton und Sprecher werden erkannt, und der Server erstellt eine kompatible H.264-Kopie.` };
  }

  // Last resort when the picker reports neither a useful extension nor a MIME type
  // (e.g. a gallery file called just "4549"): recognise MP4/MOV/WebM by the file header.
  async function sniffVideoMime(file) {
    try {
      const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const text = (from, to) => String.fromCharCode(...bytes.slice(from, to));
      if (text(4, 8) === 'ftyp') return text(8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
      if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
    } catch {}
    return '';
  }

  // Resolve the selected file from both its extension and MIME label. Android
  // gallery pickers often report application/octet-stream or no MIME type.
  function videoMimeFromFile(file) {
    if (!file) return '';
    const filename = String(file.name || '').trim();
    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const mimeByExtension = {
      mp4: 'video/mp4', m4v: 'video/mp4',
      webm: 'video/webm', mov: 'video/quicktime',
      mkv: 'video/x-matroska', avi: 'video/x-msvideo',
      '3gp': 'video/3gpp', '3gpp': 'video/3gpp', '3g2': 'video/3gpp2',
      mpg: 'video/mpeg', mpeg: 'video/mpeg', m2v: 'video/mpeg',
      mts: 'video/mp2t', m2ts: 'video/mp2t', ts: 'video/mp2t',
      ogv: 'video/ogg', dv: 'video/x-dv'
    };
    if (mimeByExtension[extension]) return mimeByExtension[extension];
    const declaredMime = String(file.type || '').split(';')[0].trim().toLowerCase();
    if (declaredMime.startsWith('video/')) return declaredMime;
    return '';
  }

  function currentClipFilename() {
    return String(state.selectedFile?.name || state.room?.clip?.original_filename || '').trim();
  }

  function originalClipPath(clip = state.room?.clip) {
    return String(clip?.original_path || clip?.path || '');
  }

  function hasCompatiblePlaybackCopy(clip = state.room?.clip) {
    return Boolean(clip?.playback_compatible && clip?.path && clip?.original_path && clip.path !== clip.original_path);
  }
  function isPlaybackPending(clip = state.room?.clip) {
    return Boolean(clip?.playback_status === 'preparing' && !hasCompatiblePlaybackCopy(clip));
  }
  function isPlaybackBlocked(clip = state.room?.clip) {
    return isPlaybackPending(clip) || Boolean(clip?.playback_status === 'failed' && !hasCompatiblePlaybackCopy(clip));
  }

  function updateTranscodeWait() {
    const box = $('dubTranscodeWait');
    if (!box) return;
    const clip = state.room?.clip;
    if (!isPlaybackPending(clip)) {
      box.hidden = true;
      if (state.transcodeTicker) clearInterval(state.transcodeTicker);
      state.transcodeTicker = null;
      state.transcodeTickKey = '';
      state.transcodeLocalStartedAt = 0;
      return;
    }
    box.hidden = false;
    const key = String(clip?.playback_path || clip?.original_path || clip?.path || 'pending');
    if (state.transcodeTickKey !== key) {
      state.transcodeTickKey = key;
      const persisted = Date.parse(clip?.playback_started_at || clip?.transcode_started_at || '');
      state.transcodeLocalStartedAt = Number.isFinite(persisted) && persisted > 0 ? persisted : Date.now();
    }
    const elapsed = Math.max(0, Math.floor((Date.now() - state.transcodeLocalStartedAt) / 1000));
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    const timer = $('dubTranscodeElapsed');
    if (timer) timer.textContent = `${mm}:${ss}`;
    const message = $('dubTranscodeMessage');
    if (message) message.textContent = 'GitHub erstellt gerade die browserfreundliche MP4. Rollen und Lines werden freigegeben, sobald die Datei gespeichert und geprüft wurde.';
    if (!state.transcodeTicker) state.transcodeTicker = setInterval(updateTranscodeWait, 1000);
  }

  function updateVideoImportStatus(message) {
    if ($('dubUploadProgress')) $('dubUploadProgress').textContent = message;
    if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = message;
  }

  function safeName(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) || 'Spieler';
  }
  function recordingLines() {
    if (mode() === 'parallel') return script();
    return script().filter(line => canRecord(line));
  }
  function currentLine() {
    const lines = recordingLines();
    if (!lines.length) return null;
    state.lineIndex = Math.max(0, Math.min(state.lineIndex, lines.length - 1));
    return lines[state.lineIndex];
  }
  function lineBounds(line) {
    const video = $('dubVideo');
    const videoDuration = Number(video?.duration);
    const hasVideoDuration = Number.isFinite(videoDuration) && videoDuration > 0;
    const rawStart = Math.max(0, Number(line?.start_sec) || 0);
    const start = hasVideoDuration ? Math.min(rawStart, Math.max(0, videoDuration - 0.04)) : rawStart;
    const rawEnd = Number(line?.end_sec);
    let end = Number.isFinite(rawEnd) && rawEnd > rawStart
      ? rawEnd
      : start + Math.max(1.1, Math.min(8, String(line?.text || '').length / 13));
    if (hasVideoDuration) end = Math.min(end, videoDuration);
    end = Math.max(start + MIN_LINE_DURATION_SEC, end);
    return { start, end, duration: Math.max(MIN_LINE_DURATION_SEC, end - start) };
  }
  function lineDurationSec(line) { return lineBounds(line).duration; }
  // Keep a very small natural tail after a dubbed line so the last syllable is
  // not cut off by an exact subtitle boundary. Never let the tail overlap the
  // next spoken line or run beyond the source video.
  function dubbedLineBounds(line) {
    const base = lineBounds(line);
    const nextStart = script()
      .filter(item => item.id !== line?.id)
      .map(item => Number(item.start_sec))
      .filter(value => Number.isFinite(value) && value > base.end + 0.005)
      .sort((a, b) => a - b)[0];
    const videoDuration = Number($('dubVideo')?.duration);
    const clipEnd = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : base.end + 0.16;
    const safeEnd = Math.min(clipEnd, Number.isFinite(nextStart) ? nextStart - 0.025 : clipEnd);
    const tail = Math.max(0, Math.min(0.16, safeEnd - base.end));
    return { ...base, end: base.end + tail, duration: base.duration + tail, tail };
  }
  function hasVideoSource() {
    const video = $('dubVideo');
    return Boolean(
      video && (
        video.currentSrc || video.getAttribute('src') || video.dataset?.dubSrc ||
        state.room?.clip?.path || state.localClipPreviewUrl || state.templatePreviewUrl
      )
    );
  }
  function hasPlayableVideo() {
    const video = $('dubVideo');
    return Boolean(video && hasVideoSource() && video.readyState >= 2 && !video.error);
  }

  // The controls should not stay disabled just because the private Storage URL
  // is still being signed or the browser has not buffered its first frame yet.
  // Resolve the current clip URL on demand, then wait for actual media data.
  async function ensureVideoReadyForLine() {
    const video = $('dubVideo');
    if (!video) throw new Error('Der Videoplayer wurde auf dieser Seite nicht gefunden.');

    const clipPath = state.room?.clip?.path;
    if (clipPath) {
      const needsFreshUrl = !state.signedClipUrl || state.signedClipPath !== clipPath || state.signedClipExpiresAt < Date.now() + 60000;
      if (needsFreshUrl) {
        if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Privater Clip-Link wird vorbereitet …';
        const url = await signStoragePath(clipPath);
        if (state.room?.clip?.path !== clipPath) throw new Error('Der Clip wurde während des Ladens gewechselt. Bitte erneut versuchen.');
        state.signedClipPath = clipPath;
        state.signedClipUrl = url;
        state.signedClipExpiresAt = Date.now() + 3500 * 1000;
        state.previewRemoteFailed = false;
      }
    }

    renderInlinePreview();
    if (!hasVideoSource()) {
      throw new Error('Für diese Line ist kein Video geladen. Lade zuerst den Clip in die Lobby hoch.');
    }
    if (state.videoReadyPromise) return state.videoReadyPromise;

    state.videoReadyPromise = (async () => {
      let mediaError = null;
      try {
        await waitForVideoData(video);
      } catch (firstError) {
        mediaError = firstError;
        // A failed signed Storage URL can be refreshed once. The replacement is
        // reloaded with CORS mode before its src is set, for Canvas export.
      }

      // A signed URL can expire or be rejected while the lobby is open. Try
      // exactly one newly signed URL for a private Storage clip before failing.
      if (mediaError && Number(video.error?.code) !== 3 && clipPath && state.room?.clip?.path === clipPath && video.dataset?.dubSourceKind === 'storage' && video.dataset?.dubFreshRetryPath !== clipPath) {
        video.dataset.dubFreshRetryPath = clipPath;
        const freshUrl = await signStoragePath(clipPath);
        if (state.room?.clip?.path !== clipPath) throw new Error('Der Clip wurde während des erneuten Ladens gewechselt. Bitte erneut versuchen.');
        state.signedClipPath = clipPath;
        state.signedClipUrl = freshUrl;
        state.signedClipExpiresAt = Date.now() + 3500 * 1000;
        state.previewRemoteFailed = false;
        video.pause();
        delete video.dataset.dubSrc;
        delete video.dataset.dubCorsFallbackFor;
        renderInlinePreview();
        try {
          await waitForVideoData(video);
          mediaError = null;
        } catch (freshError) {
          mediaError = freshError;
        }
      }
      // A repair can finish while a stale signed-link retry is still settling.
      // If the room now points at a different playable object, discard the old
      // MediaError from the replaced file.
      if (mediaError && clipPath && state.room?.clip?.path !== clipPath && hasPlayableVideo()) mediaError = null;

      if (mediaError) throw mediaError;
      if (!hasPlayableVideo()) throw new Error('Der Clip hat noch keine abspielbaren Videodaten geliefert. Prüfe den Supabase-Storage-Link und das Videoformat.');
      return video;
    })();
    try { return await state.videoReadyPromise; }
    finally { state.videoReadyPromise = null; }
  }
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
      processPlaybackSync(data.clip?.playback_sync || null);
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
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = item.is_owner ? 'danger' : 'primary'; btn.textContent = item.is_owner ? 'Lobby schließen' : 'Beitreten';
        btn.addEventListener('click', () => item.is_owner ? closePublicRoom(item.code) : joinRoom(item.code));
        card.append(info, btn); box.append(card);
      });
    } catch (error) {
      box.innerHTML = `<div class="dubEmpty">${esc(deps?.friendlyError?.(error) || error.message || 'Lobbys konnten nicht geladen werden.')}</div>`;
    }
  }

  async function closePublicRoom(code) {
    if (!code || !confirm('Diese öffentliche DubTogether-Lobby wirklich schließen?')) return;
    try {
      if (state.room?.code === code && isHost()) await leaveRoom();
      else await apiRpc('close_public_dub_room', { p_code: code });
      status('Die öffentliche DubTogether-Lobby wurde geschlossen.', 'success');
      await refreshPublicRooms();
    } catch (error) {
      status(deps?.friendlyError?.(error) || error.message || 'Lobby konnte nicht geschlossen werden.', 'error');
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
      button.disabled = !isHost() || state.room.status !== 'waiting' || isPlaybackBlocked();
    });
    $('dubModeHint').textContent = MODE_HINTS[mode()] || MODE_HINTS.parallel;
  }

  function renderRoles() {
    const box = $('dubRoleEditor'); box.replaceChildren();
    const canEdit = isHost() && state.room.status === 'waiting' && !isPlaybackPending();
    roles().forEach((role, index) => {
      const row = document.createElement('div'); row.className = 'dubRoleRow';
      const name = document.createElement('input'); name.value = role.name; name.maxLength = 30; name.setAttribute('aria-label', `Name von ${role.name}`); name.disabled = !canEdit;
      name.addEventListener('input', () => { role.name = name.value.slice(0, 30); state.editorDirty = true; });
      name.addEventListener('change', async () => { role.name = name.value.trim().slice(0, 30) || `Name nicht erkannt · Stimme ${String.fromCharCode(65 + index)}`; state.editorDirty = true; await saveScript(); });
      const select = document.createElement('select'); select.setAttribute('aria-label', `Spieler für die Figur ${role.name}`);
      const assignedId = state.room.assignments?.[role.id] || '';
      const canSelfChoose = !isHost() && (!assignedId || assignedId === uid());
      const canChooseRole = state.room.status === 'waiting' && (isHost() || canSelfChoose);
      select.disabled = mode() === 'parallel' || !canChooseRole;
      if (isHost()) {
        const original = document.createElement('option'); original.value = ''; original.textContent = 'Noch niemand zugeteilt'; select.append(original);
        players().forEach(player => { const option = document.createElement('option'); option.value = player.id; option.textContent = player.name; select.append(option); });
      } else if (canSelfChoose) {
        const original = document.createElement('option'); original.value = ''; original.textContent = 'Nicht selbst übernehmen'; select.append(original);
        const own = document.createElement('option'); own.value = uid(); own.textContent = `Ich spreche: ${role.name}`; select.append(own);
      } else {
        const owner = document.createElement('option'); owner.value = assignedId; owner.textContent = `Wird gesprochen von ${memberName(assignedId)}`; select.append(owner);
      }
      select.value = assignedId;
      select.addEventListener('change', async () => {
        try { await apiRpc('assign_dub_role', { p_code: state.room.code, p_role: role.id, p_player_id: select.value || null }); await refreshRoom(false); }
        catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
      });
      const label = document.createElement('label'); label.textContent = `${role.name} ${mode() === 'parallel' ? '· jeder spricht selbst' : isHost() ? '· Mitspieler auswählen' : '· zugeteilter Spieler'}`;
      row.replaceChildren(label, name, select); box.append(row);
    });
  }

  function lineRecordingFor(line) {
    const key = recordingKey(line, uid());
    return recordings()[key] || null;
  }

  function renderScriptEditor() {
    const box = $('dubScriptEditor'); box.replaceChildren();
    const canEdit = isHost() && state.room.status === 'waiting' && !isPlaybackPending();
    script().forEach((line, index) => {
      const row = document.createElement('div'); row.className = 'dubScriptRow';
      const role = document.createElement('select'); role.disabled = !canEdit; role.title = `Welche Figur spricht Line ${index + 1}?`;
      roles().forEach(r => { const op = document.createElement('option'); op.value = r.id; op.textContent = r.name; role.append(op); });
      role.value = line.role;
      role.addEventListener('change', () => { line.role = role.value; state.editorDirty = true; });
      const text = document.createElement('input'); text.value = line.text || ''; text.maxLength = 240; text.placeholder = `Line ${index + 1}: Was sagt die Figur?`; text.title = `Gesprochener Text für Line ${index + 1}`; text.disabled = !canEdit;
      text.addEventListener('input', () => { line.text = text.value; state.editorDirty = true; });
      const time = document.createElement('input'); time.type = 'number'; time.min = '0'; time.max = '600'; time.step = '0.01'; time.value = Number(line.start_sec || 0).toFixed(2); time.title = 'Startzeit in Sekunden'; time.disabled = !canEdit;
      time.addEventListener('input', () => {
        line.start_sec = Math.max(0, Math.min(600, Number(time.value) || 0));
        const currentEnd = Number(line.end_sec);
        if (!Number.isFinite(currentEnd) || currentEnd < line.start_sec + MIN_LINE_DURATION_SEC) line.end_sec = line.start_sec + MIN_LINE_DURATION_SEC;
        endTime.min = (line.start_sec + MIN_LINE_DURATION_SEC).toFixed(2);
        if (Number(endTime.value) < Number(endTime.min)) endTime.value = endTime.min;
        state.editorDirty = true;
        updateLineTimeLabel();
      });
      const fallbackDuration = Math.max(1.1, Math.min(8, String(line.text || '').length / 13));
      if (!Number.isFinite(Number(line.end_sec)) || Number(line.end_sec) <= Number(line.start_sec || 0)) line.end_sec = Number(line.start_sec || 0) + fallbackDuration;
      const endTime = document.createElement('input'); endTime.type = 'number'; endTime.min = (Number(line.start_sec || 0) + MIN_LINE_DURATION_SEC).toFixed(2); endTime.max = '600'; endTime.step = '0.01'; endTime.value = Number(line.end_sec).toFixed(2); endTime.title = 'Endzeit in Sekunden'; endTime.disabled = !canEdit;
      endTime.addEventListener('input', () => {
        const minEnd = Number(line.start_sec || 0) + MIN_LINE_DURATION_SEC;
        line.end_sec = Math.max(minEnd, Math.min(600, Number(endTime.value) || minEnd));
        endTime.value = Number(line.end_sec).toFixed(2);
        state.editorDirty = true;
        updateLineTimeLabel();
      });
      const updateLineTimeLabel = () => { timeLabel.textContent = `Clipstelle ${Number(line.start_sec || 0).toFixed(2)}–${Number(line.end_sec || 0).toFixed(2)} s`; };
      const timeLabel = document.createElement('span'); timeLabel.className = 'dubScriptTimeLabel'; updateLineTimeLabel();
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ghost'; remove.textContent = 'Entfernen'; remove.disabled = !canEdit || script().length <= 1;
      remove.addEventListener('click', () => { state.room.script.splice(index, 1); state.editorDirty = true; renderScriptEditor(); });

      const actions = document.createElement('div'); actions.className = 'dubScriptLineActions';
      const sourceButton = document.createElement('button'); sourceButton.type = 'button'; sourceButton.className = 'secondary'; sourceButton.textContent = '▶ Clipstelle ansehen'; sourceButton.disabled = !hasVideoSource() || state.recorder?.state === 'recording';
      sourceButton.addEventListener('click', () => playClipAtLine(line));
      const saved = lineRecordingFor(line);
      const takeButton = document.createElement('button'); takeButton.type = 'button'; takeButton.className = 'secondary'; takeButton.textContent = '▶ Neue Line mit Clip ansehen'; takeButton.disabled = !saved?.path || state.recorder?.state === 'recording' || Boolean(state.recordingSavePromise);
      takeButton.addEventListener('click', () => playDubLinePreview(line));
      actions.append(sourceButton, takeButton, timeLabel);
      row.append(role, text, time, endTime, remove, actions); box.append(row);
    });
    $('dubAddRole').disabled = !canEdit; $('dubAddLine').disabled = !canEdit; $('dubSaveScript').disabled = !canEdit;
    $('dubAddRole').hidden = !canEdit; $('dubAddLine').hidden = !canEdit; $('dubSaveScript').hidden = !canEdit;
    $('dubExportPack').disabled = false; $('dubImportPack').disabled = !canEdit;
  }

  async function saveScript() {
    if (!isHost() || state.room.status !== 'waiting') return false;
    const cleanScript = script().map((line, i) => {
      const start = Math.max(0, Math.min(600, Number(line.start_sec) || 0));
      const rawEnd = Number(line.end_sec);
      const end = Number.isFinite(rawEnd) && rawEnd > start ? Math.max(start + MIN_LINE_DURATION_SEC, Math.min(600, rawEnd)) : null;
      return { id: String(line.id || `line-${i + 1}`).slice(0, 40), role: String(line.role || roles()[0]?.id || 'speaker-a').slice(0, 40), text: String(line.text || '').trim().slice(0, 240), start_sec: start, ...(end ? { end_sec: end } : {}) };
    }).filter(line => line.text);
    if (!cleanScript.length) { status('Bitte mindestens eine Dialogzeile mit Text eintragen.', 'error'); return false; }
    const cleanRoles = roles().map(r => ({ id: String(r.id).slice(0, 40), name: String(r.name || 'Figur ohne Namen').trim().slice(0, 30) || 'Sprecher' }));
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
    const rows = CLIPS.filter(item => {
      if (state.selectedLibrary === 'all') return true;
      if (state.selectedLibrary === 'de') return item.region === 'de';
      if (state.selectedLibrary === 'international') return item.region === 'international';
      if (state.selectedLibrary === 'licensed') return true;
      return false;
    });
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'dubEmpty';
      empty.textContent = 'In diesem Filter gibt es gerade keine passende Vorlage. Wähle „Alle Clips“ oder lade eine eigene Videodatei hoch.';
      grid.append(empty);
      return;
    }
    rows.forEach(item => {
      const card = document.createElement('article');
      card.className = `dubClipCard${state.selectedSource?.id === item.id ? ' selected' : ''}`;
      const top = document.createElement('div'); top.className = 'dubClipTop';
      const title = document.createElement('strong'); title.textContent = item.title;
      const badge = document.createElement('span'); badge.className = 'dubClipBadge'; badge.textContent = item.license;
      top.append(title, badge);
      const desc = document.createElement('p'); desc.textContent = `${item.length} · ${item.summary}`;
      const credit = document.createElement('small'); credit.className = 'dubHint'; credit.textContent = `Video: ${item.source}`;
      const actions = document.createElement('div'); actions.className = 'dubClipActions';
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'secondary';
      choose.textContent = state.selectedSource?.id === item.id ? '✓ Im Player ausgewählt' : '▶ Im Player ansehen';
      choose.addEventListener('click', () => {
        state.selectedSource = item;
        state.selectedFile = null;
        $('dubClipFile').value = '';
        if (state.localClipPreviewUrl) URL.revokeObjectURL(state.localClipPreviewUrl);
        state.localClipPreviewUrl = '';
        state.templatePreviewUrl = item.videoUrl;
        state.previewRemoteFailed = true;
        $('dubUploadClipButton').hidden = true;
        $('dubImportTemplateButton').hidden = false;
        $('dubImportTemplateButton').disabled = false;
        $('dubSelectedSourceText').textContent = `${item.title} ist jetzt oben im Player geladen. Du kannst den Clip dort abspielen. Mit „Vorlage übernehmen & analysieren“ wird er in eure Lobby kopiert und die KI erstellt Sprecher und Lines.`;
        $('dubPreviewHeading').textContent = item.title;
        $('dubPreviewStatus').textContent = 'Demo-Clip mit Originalton · Vorschau';
        renderClipLibrary();
        renderInlinePreview();
      });
      const sourceLink = document.createElement('a'); sourceLink.href = item.pageUrl; sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer'; sourceLink.textContent = 'Quelle & Lizenz';
      actions.append(choose, sourceLink); card.append(top, desc, credit, actions); grid.append(card);
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
      const ownLines = recordingLines();
      const done = ownLines.filter(line => Boolean(recordings()[recordingKey(line)]?.path)).length;
      $('dubRecordProgress').textContent = `${done}/${ownLines.length} deiner Lines`;
      ownLines.forEach((line, i) => {
        const isDone = Boolean(recordings()[recordingKey(line)]?.path);
        const chip = document.createElement('span'); chip.className = `dubProgressChip${isDone ? ' done' : ''}`; chip.textContent = `${i + 1}. ${roleName(line.role)} ${isDone ? '✓' : '·'}`; box.append(chip);
      });
      if (!ownLines.length) {
        const info = document.createElement('span'); info.className = 'dubHint'; info.textContent = `Dir ist noch keine Rolle zugeteilt. Bitte den Host, unter „Rollen & Lines“ eine Stimme dir zuzuweisen. Zugewiesene Rolle: ${Object.entries(state.room?.assignments || {}).some(([, playerId]) => playerId === uid()) ? 'vorhanden, aber ohne passende Line' : 'keine'}.`; box.append(info);
      }
    }
  }

  function renderLineReviewList() {
    const box = $('dubLineReviewList');
    if (!box || !state.room) return;
    box.replaceChildren();
    script().forEach((line, index) => {
      const card = document.createElement('article'); card.className = 'dubLineReviewCard';
      const head = document.createElement('div'); head.className = 'dubLineReviewHead';
      const title = document.createElement('strong'); title.textContent = `Line ${index + 1} · ${roleName(line.role)}`;
      const bounds = lineBounds(line);
      const timing = document.createElement('span'); timing.textContent = `${bounds.start.toFixed(2)}–${bounds.end.toFixed(2)} s`;
      head.append(title, timing);
      const phrase = document.createElement('p'); phrase.textContent = line.text || 'Kein Dialogtext hinterlegt.';
      const actions = document.createElement('div'); actions.className = 'dubLineReviewActions';
      const original = document.createElement('button'); original.type = 'button'; original.className = 'secondary'; original.textContent = '▶ Originalstelle'; original.disabled = !hasVideoSource() || state.recorder?.state === 'recording' || state.countdownActive;
      original.addEventListener('click', () => playClipAtLine(line));
      const saved = lineRecordingFor(line);
      const dubbed = document.createElement('button'); dubbed.type = 'button'; dubbed.className = 'primary'; dubbed.textContent = saved?.path ? '▶ Neue Line + Clip' : 'Noch keine Aufnahme'; dubbed.disabled = !saved?.path || state.recorder?.state === 'recording' || state.countdownActive || Boolean(state.recordingSavePromise);
      dubbed.addEventListener('click', () => playDubLinePreview(line));
      actions.append(original, dubbed);
      card.append(head, phrase, actions);
      if (currentLine()?.id === line.id) card.classList.add('is-current');
      box.append(card);
    });
  }

  function renderRecordingStudio() {
    const active = state.room.status === 'recording';
    $('dubRecordingPanel').hidden = !active;
    if (!active) return;
    const ownLines = recordingLines();
    if (!ownLines.length) {
      $('dubRecordHeading').textContent = 'Noch keine eigene Rolle';
      $('dubLineMeta').textContent = 'Warte auf Rollenzuteilung';
      $('dubLineRole').textContent = 'Warte auf deine zugewiesene Rolle';
      $('dubLineText').textContent = 'Der Host kann die erkannten Stimmen automatisch auf die Spieler verteilen.';
      $('dubLineCounter').textContent = '0/0';
      $('dubPrevLine').disabled = true; $('dubNextLine').disabled = true;
      $('dubRecordButton').disabled = true; $('dubStopButton').disabled = true;
      if ($('dubRecordPlayOriginalLine')) $('dubRecordPlayOriginalLine').disabled = true;
      if ($('dubRecordPlayOwnLine')) $('dubRecordPlayOwnLine').disabled = true;
      renderProgress();
      renderLineReviewList();
      return;
    }
    const line = currentLine();
    $('dubRecordHeading').textContent = mode() === 'parallel' ? `Deine Version · ${meName()}` : `Deine Rolle · ${meName()}`;
    $('dubLineMeta').textContent = `Deine Line ${state.lineIndex + 1} · Start ${lineBounds(line).start.toFixed(2).replace('.', ',')} s · Länge ${lineDurationSec(line).toFixed(2).replace('.', ',')} s`; 
    $('dubLineRole').textContent = roleName(line.role);
    $('dubLineText').textContent = line.text;
    $('dubLineCounter').textContent = `${state.lineIndex + 1}/${ownLines.length}`;
    $('dubPrevLine').disabled = state.lineIndex <= 0 || state.countdownActive || state.recorder?.state === 'recording';
    $('dubNextLine').disabled = state.lineIndex >= ownLines.length - 1 || state.countdownActive || state.recorder?.state === 'recording';
    const key = recordingKey(line, uid());
    const saved = recordings()[key];
    $('dubRecordButton').disabled = !canRecord(line) || state.recorder?.state === 'recording' || state.countdownActive;
    $('dubStopButton').disabled = state.recorder?.state !== 'recording' && !state.countdownActive;
    $('dubStopButton').textContent = state.countdownActive ? 'Abbrechen' : 'Aufnahme stoppen';
    $('dubRecordButton').textContent = saved?.path ? '↻ Zeile neu aufnehmen' : '🎙️ Aufnahme starten';
    $('dubVoiceEffect').value = saved?.effect || 'original';
    const previewDubButton = $('dubPreviewDubLine');
    if (previewDubButton) previewDubButton.disabled = !saved?.path || state.recorder?.state === 'recording' || Boolean(state.recordingSavePromise);
    if ($('dubRecordPlayOriginalLine')) $('dubRecordPlayOriginalLine').disabled = !hasVideoSource() || state.recorder?.state === 'recording';
    if ($('dubRecordPlayOwnLine')) $('dubRecordPlayOwnLine').disabled = !saved?.path || state.recorder?.state === 'recording' || Boolean(state.recordingSavePromise);
    if (!state.countdownActive) {
      if (!canRecord(line)) $('dubRecordStatus').textContent = `Diese Zeile gehört ${memberName(lineOwner(line))}. Du kannst die Aufnahme ansehen, aber nicht übernehmen.`;
      else if (saved?.path) $('dubRecordStatus').textContent = 'Aufnahme gespeichert. Du kannst sie erneut aufnehmen, solange die Runde läuft.';
      else if (!hasPlayableVideo()) $('dubRecordStatus').textContent = 'Nach dem Mikrofon-Check kommt 3–2–1; bei LOS beginnt die kurze Aufnahme.';
      else $('dubRecordStatus').textContent = 'Nach dem Mikrofon-Check kommt 3–2–1; bei LOS starten Video und Mikrofon zusammen.';
    }
    $('dubFinishVersion').hidden = mode() !== 'parallel';
    $('dubFinishRound').hidden = mode() === 'parallel' || !isHost();
    const everyLineRecorded = mode() === 'parallel'
      ? script().every(item => hasRecording(item, uid()))
      : script().every(item => Boolean(recordings()[`character:${item.id}`]?.path));
    const recorderBusy = state.recorder?.state === 'recording' || Boolean(state.recordingSavePromise);
    $('dubFinishVersion').disabled = !everyLineRecorded || recorderBusy;
    $('dubFinishRound').disabled = !(mode() !== 'parallel' && isHost() && everyLineRecorded && !recorderBusy);
    renderProgress();
    renderLineReviewList();
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
        const twitchCount = Object.values(state.room.twitch_votes || {}).filter(v => v === player.id).length;
        const meta = document.createElement('small'); meta.textContent = `${count}/${script().length} Zeilen · ${voteCount} Lobby-Stimmen · ${twitchCount} Twitch-Stimmen`;
        const actions = document.createElement('div'); actions.className = 'dubClipActions';
        const play = document.createElement('button'); play.type = 'button'; play.className = 'secondary'; play.textContent = '▶ Version ansehen'; play.addEventListener('click', () => { state.selectedCandidate = player.id; playVersion(player.id); });
        const vote = document.createElement('button'); vote.type = 'button'; vote.className = 'primary'; vote.textContent = state.room.votes?.[uid()] === player.id ? 'Deine Stimme ✓' : 'Für diese Version stimmen'; vote.disabled = state.room.votes?.[uid()] === player.id || player.id === uid(); vote.addEventListener('click', () => voteFor(player.id));
        actions.append(play, vote); card.append(name, meta, actions); box.append(card);
      });
      const winner = getWinner();
      const allVotes = [...Object.values(state.room.votes || {}), ...Object.values(state.room.twitch_votes || {})];
      const winnerVotes = winner ? allVotes.filter(candidate => candidate === winner).length : 0;
      $('dubWinner').textContent = winner ? `🏆 Aktueller Favorit: ${memberName(winner)} (${winnerVotes} Stimmen)` : 'Stimmt für eure Lieblingsversion ab.';
    } else {
      $('dubResultsInfo').textContent = 'Eine gemeinsame Fassung';
      const card = document.createElement('article'); card.className = 'dubResultCard';
      const title = document.createElement('strong'); title.textContent = 'Euer gemeinsamer Dub';
      const meta = document.createElement('small'); meta.textContent = `${script().length} Dialogzeilen · ${MODE_LABELS[mode()] || 'Charakter'}modus`;
      const play = document.createElement('button'); play.type = 'button'; play.className = 'primary'; play.textContent = '▶ Gemeinsame Fassung ansehen'; play.addEventListener('click', () => playVersion('character'));
      card.append(title, meta, play); box.append(card); $('dubWinner').textContent = 'Ein gemeinsames Ergebnis – es gibt keine Abstimmung.';
    }
    renderTwitchPanel();
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

  function renderInlinePreview() {
    const video = $('dubVideo');
    const panel = $('dubPreviewPanel');
    const empty = $('dubNoVideo');
    if (!video || !panel) return;

    video.preload = 'auto';
    video.playsInline = true;
    const localUrl = state.localClipPreviewUrl || '';
    const templateUrl = state.templatePreviewUrl || '';
    const remoteUrl = state.signedClipUrl || '';
    let url = '';
    let kind = '';

    if (state.selectedFile && localUrl) { url = localUrl; kind = 'local'; }
    else if (remoteUrl && !state.previewRemoteFailed) { url = remoteUrl; kind = 'storage'; }
    else if (templateUrl) { url = templateUrl; kind = 'template'; }
    else if (localUrl) { url = localUrl; kind = 'local'; }
    else if (remoteUrl) { url = remoteUrl; kind = 'storage'; }

    panel.hidden = !url;
    if (!url) {
      video.pause();
      video.removeAttribute('src');
      delete video.dataset.dubSrc;
      delete video.dataset.dubSourceKind;
      delete video.dataset.dubCorsFallbackFor;
      video.load();
      if (empty) { empty.hidden = false; empty.textContent = 'Wähle eine MP4- oder WebM-Datei oder eine Videovorlage. Der Clip erscheint hier direkt im Player.'; }
      return;
    }

    if (video.dataset.dubSrc !== url || video.crossOrigin !== 'anonymous') {
      video.pause();
      // Set CORS mode BEFORE assigning src. Otherwise the browser fetches the
      // cross-origin Storage video in no-cors mode and taints the canvas, making
      // the combined video export impossible even though playback works.
      video.crossOrigin = 'anonymous';
      video.src = url;
      video.dataset.dubSrc = url;
      video.dataset.dubSourceKind = kind;
      video.dataset.dubClipPath = kind === 'storage' ? (state.signedClipPath || '') : '';
      video.load();
    }
    if (empty) empty.hidden = true;
  }

  function handlePreviewVideoError() {
    const video = $('dubVideo');
    const kind = video?.dataset?.dubSourceKind || '';
    const currentUrl = video?.dataset?.dubSrc || '';
    const code = Number(video?.error?.code) || 0;
    const clip = state.room?.clip || {};

    // A late error from a source that was already replaced (e.g. the original after the
    // playback copy became ready) is outdated: just load the current source.
    if (kind === 'storage' && video.dataset.dubClipPath && clip.path && video.dataset.dubClipPath !== clip.path) {
      delete video.dataset.dubSrc; renderInlinePreview(); return;
    }

    // The local browser preview can fail without blocking the upload. The
    // server-side workflow will create a compatible copy after the original is stored.
    if (kind === 'local' && [3, 4].includes(code) && state.selectedFile) {
      const message = 'Die lokale Vorschau wird von diesem Browser nicht unterstützt. Du kannst die MP4 trotzdem hochladen; GitHub erstellt danach eine browserfreundliche Wiedergabe-MP4.';
      if ($('dubNoVideo')) { $('dubNoVideo').hidden = false; $('dubNoVideo').textContent = message; }
      if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Lokale Vorschau nicht unterstützt · Upload möglich';
      return;
    }

    // The preview is already loaded without CORS. Report any remaining media
    // error as a genuine source, network, or codec problem.

    if ([3, 4].includes(code) && clip.path && clip.playback_status === 'preparing') {
      const message = 'Die Originaldatei ist gespeichert. GitHub erstellt gerade die kompatible Wiedergabe-MP4. Die Vorschau erscheint automatisch, sobald die Umwandlung fertig ist.';
      if ($('dubNoVideo')) { $('dubNoVideo').hidden = false; $('dubNoVideo').textContent = message; }
      if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Server-Konvertierung läuft …';
      return;
    }

    if ([3, 4].includes(code) && clip.path && isHost() && state.room?.status === 'waiting'
      && (!clip.playback_status || ['idle', 'failed'].includes(clip.playback_status))) {
      const message = 'Diese gespeicherte Videodatei kann der Browser nicht abspielen. Als Host kannst du eine kompatible MP4 auf dem kostenlosen Server erstellen lassen.';
      if ($('dubNoVideo')) { $('dubNoVideo').hidden = false; $('dubNoVideo').textContent = message; }
      if ($('dubOptimizeVideoButton')) { $('dubOptimizeVideoButton').hidden = false; $('dubOptimizeVideoButton').disabled = false; $('dubOptimizeVideoButton').textContent = 'Server-Umwandlung starten'; }
      if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Server-Umwandlung erforderlich';
      return;
    }

    if (kind === 'storage' && (state.localClipPreviewUrl || state.templatePreviewUrl)) {
      state.previewRemoteFailed = true;
      renderInlinePreview();
      if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Gespeicherter Link lädt nicht · lokale Vorschau bleibt sichtbar';
      status('Der gespeicherte Videolink konnte nicht geladen werden. Die lokale Vorschau bleibt sichtbar.', 'error');
      return;
    }

    const reason = describeVideoMediaError(video);
    // Codec problem = the file is fine, this device just cannot decode it. Explain calmly and
    // always offer the next step instead of a red dead-end error.
    if ([3, 4].includes(code) && kind !== 'template') {
      const host = isHost() && state.room?.status === 'waiting' && clip.path && !hasCompatiblePlaybackCopy(clip);
      const friendlyKnown = clip.video_codec && isFriendlyVideo({ video: clip.video_codec, profile: clip.video_profile || 0 });
      if ($('dubNoVideo')) {
        $('dubNoVideo').hidden = false;
        $('dubNoVideo').textContent = friendlyKnown ? reason
          : `${reason} ${host ? 'Starte unten die Server-Umwandlung, oder nimm die Lines ohne Videobild auf.' : 'Der Host kann eine kompatible Kopie erstellen lassen; aufnehmen geht auch ohne Videobild.'}`;
      }
      const retry = $('dubOptimizeVideoButton');
      if (retry && host) { retry.hidden = false; retry.disabled = false; retry.textContent = 'Server-Umwandlung starten'; }
      if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Video-Codec wird auf diesem Gerät nicht unterstützt';
      return;
    }
    if ($('dubNoVideo')) { $('dubNoVideo').hidden = false; $('dubNoVideo').textContent = kind === 'template' ? 'Die Demo-Datei konnte nicht geladen werden. Wähle bitte eine eigene MP4- oder WebM-Datei.' : reason; }
    if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Video konnte nicht geladen werden';
    status(reason, 'error');
  }

  function describeVideoMediaError(video) {
    const code = Number(video?.error?.code) || 0;
    const filename = currentClipFilename();
    const isMp4File = /\.(mp4|m4v)$/i.test(filename) || String(state.room?.clip?.mime || '').toLowerCase().includes('mp4');
    if (code === 1) return 'Das Laden des Videos wurde abgebrochen. Bitte tippe erneut auf die Wiedergabe.';
    if (code === 2) return 'Die Videodatei wurde ausgewählt, aber die Videodaten konnten nicht vollständig geladen werden. Prüfe die Internetverbindung und den privaten Supabase-Clip.';
    const roomClip = state.room?.clip || {};
    const known = (state.selectedFile && state.videoInfo) || (roomClip.video_codec ? { video: roomClip.video_codec, profile: roomClip.video_profile || 0, label: roomClip.video_codec_label } : null);
    if ([3, 4].includes(code) && isMp4File && known?.video) {
      const name = filename ? ` „${filename}“` : '';
      if (isFriendlyVideo(known)) return `Die Datei${name} enthält normales H.264/AAC und sollte überall laufen. Der Fehler (MediaError ${code}) kommt dann meist von der Verbindung oder einem abgelaufenen Speicher-Link, nicht vom Codec. Lade die Lobby bzw. die Seite neu und versuche es noch einmal.`;
      return `Die Datei${name} ist eine gültige MP4-Datei, aber ihre Videospur ist ${known.label || videoCodecLabel(known)}. Dieses Gerät bzw. dieser Browser kann den Codec nicht abspielen (MediaError ${code}). Das liegt am Codec, nicht an der Datei.`;
    }
    if (code === 3 && isMp4File) {
      return `Die Datei${filename ? ` „${filename}“` : ''} wurde als .mp4 erkannt und als video/mp4 behandelt. Der Browser kann den Videoinhalt aber nicht dekodieren (MediaError 3). Ursache kann ein in der MP4-Datei verwendeter Codec wie HEVC/H.265 sein; MP4 ist der Container und sagt allein noch nichts über den Codec aus.`;
    }
    if (code === 4 && isMp4File) {
      return `Die Datei${filename ? ` „${filename}“` : ''} wurde als .mp4 erkannt und als video/mp4 behandelt. Der Browser lehnt die Quelle trotzdem ab (MediaError 4). Das kann an einem nicht unterstützten Codec oder daran liegen, dass die Datei trotz Endung keine intakte MP4-Datei enthält.`;
    }
    if (code === 3 || code === 4) return 'Der Browser kann den Video-Inhalt nicht dekodieren. Bei MP4-Dateien hängt die Wiedergabe vom Codec in der Datei ab; H.264/AAC wird am breitesten unterstützt.';
    return 'Der Browser hat einen Medienfehler gemeldet. Prüfe den Clip-Link, die Internetverbindung und das tatsächliche Videoformat.';
  }

  async function waitForVideoMetadata(video) {
    if (!video) throw new Error('Der Videoplayer ist nicht verfügbar.');
    if (video.error) throw new Error(describeVideoMediaError(video));
    if (video.readyState >= 1) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
      };
      const finish = error => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve();
      };
      const onReady = () => video.error ? finish(new Error(describeVideoMediaError(video))) : finish();
      const onError = () => finish(new Error(describeVideoMediaError(video)));
      const timer = setTimeout(() => finish(new Error('Der Videoplayer hat innerhalb von 15 Sekunden keine Videometadaten geliefert. Prüfe den Clip-Link und das Videoformat.')), 15000);
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
      // Recheck after listener registration: media events can fire between the
      // initial readyState check and attaching the listeners.
      if (video.error) finish(new Error(describeVideoMediaError(video)));
      else if (video.readyState >= 1) finish();
    });
  }

  async function waitForVideoData(video) {
    await waitForVideoMetadata(video);
    if (video.error) throw new Error(describeVideoMediaError(video));
    if (video.readyState >= 2) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
      };
      const finish = error => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve();
      };
      const onReady = () => {
        if (video.error) finish(new Error(describeVideoMediaError(video)));
        else if (video.readyState >= 2) finish();
      };
      const onError = () => finish(new Error(describeVideoMediaError(video)));
      const timer = setTimeout(() => finish(new Error('Der Clip hat innerhalb von 20 Sekunden keine abspielbaren Videodaten geliefert. Prüfe den privaten Supabase-Speicher und versuche es erneut.')), 20000);
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onError);
      // Also check synchronously after listener registration. This prevents a
      // missed error event from turning into a misleading 15/20-second timeout.
      onReady();
    });
  }

  async function seekVideoTo(video, seconds) {
    await waitForVideoMetadata(video);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const maximum = duration > 0 ? Math.max(0, duration - 0.05) : Math.max(0, Number(seconds) || 0);
    const target = Math.min(maximum, Math.max(0, Number(seconds) || 0));
    if (!video.seeking && Math.abs((Number(video.currentTime) || 0) - target) < 0.035) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve();
      };
      const onSeeked = () => finish();
      const onError = () => finish(new Error('Die Videoposition konnte nicht gesetzt werden.'));
      const timer = setTimeout(() => finish(new Error('Das Springen zur Dialogstelle hat zu lange gedauert.')), 10000);
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      try {
        video.currentTime = target;
        // Some browsers can complete a seek synchronously when metadata is ready.
        if (!video.seeking && Math.abs((Number(video.currentTime) || 0) - target) < 0.035) finish();
      } catch (error) {
        finish(new Error(error?.message || 'Die Videoposition konnte nicht gesetzt werden.'));
      }
    });
  }

  async function invokeDubAnalysis(payload) {
    const session = await deps.getSession();
    if (!session?.access_token) throw new Error('Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.');
    const base = String(deps.url || '').replace(/\/+$/, '');
    let response;
    try {
      response = await fetch(`${base}/functions/v1/dub-analyze-clip`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          apikey: deps.apiKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (networkError) {
      throw new Error(`Die KI-Verbindung zu Supabase wurde vom Browser nicht erreicht. Prüfe: Edge Function „dub-analyze-clip“ im selben Projekt bereitgestellt, korrekte Projekt-URL in Schreibbot, gültige Anmeldung und CORS-Preflight. Öffne danach Supabase → Edge Functions → dub-analyze-clip → Invocations/Logs. Technischer Fehler: ${networkError?.message || 'Failed to fetch'}`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || `Clip-Analyse fehlgeschlagen (${response.status}).`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function applyAnalysisToScript(result) {
    const segments = Array.isArray(result?.segments) ? [...result.segments].sort((a, b) => (Number(a.start_ms) || 0) - (Number(b.start_ms) || 0)) : [];
    const speakerItems = Array.isArray(result?.speakers) ? result.speakers : [];
    if (!segments.length) throw new Error('Die Analyse enthält keine nutzbaren Dialogzeilen.');
    if (segments.length > 60) throw new Error('Es wurden mehr als 60 Dialogzeilen erkannt. Bitte kürze den Clip und analysiere ihn erneut.');
    const speakerIds = [...new Set(segments.map(item => String(item.speaker_id || 'A')))];
    if (!speakerIds.length || speakerIds.length > 12) throw new Error('Die Anzahl der erkannten Stimmen liegt außerhalb des unterstützten Bereichs (1–12).');
    const speakerInfo = new Map(speakerItems.map(item => [String(item.speaker_id), item]));
    const roleIdBySpeaker = new Map();
    const cleanRoles = speakerIds.map((speakerId, index) => {
      const info = speakerInfo.get(speakerId) || {};
      const fromSegment = segments.find(item => String(item.speaker_id || 'A') === speakerId)?.speaker_name;
      const identifiedName = info.identified && info.name ? String(info.name).trim() : (info.name && !/^Sprecher\s+/i.test(String(info.name)) ? String(info.name).trim() : '');
      const displayName = String(identifiedName || (fromSegment && !/^Sprecher\s+/i.test(String(fromSegment)) ? fromSegment : `Name nicht erkannt · Stimme ${String.fromCharCode(65 + index)}`)).slice(0, 30);
      const normalizedId = speakerId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || String(index + 1);
      const id = `speaker-${normalizedId}`.slice(0, 40);
      roleIdBySpeaker.set(speakerId, id);
      return { id, name: displayName, source_speaker_id: speakerId, ai_identified: Boolean(info.identified) };
    });
    const cleanScript = segments.map((item, index) => {
      const speakerId = String(item.speaker_id || 'A');
      const textValue = String(item.text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 240);
      const startMs = Math.max(0, Number(item.start_ms) || 0);
      const endMs = Math.max(startMs + 80, Number(item.end_ms) || startMs + 800);
      return {
        id: `ai-line-${index + 1}`,
        role: roleIdBySpeaker.get(speakerId),
        text: textValue,
        start_sec: Math.round(startMs / 10) / 100,
        end_sec: Math.round(endMs / 10) / 100,
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0))
      };
    }).filter(line => line.text && line.role);
    if (!cleanScript.length) throw new Error('Die KI hat keine verwendbaren Dialogtexte gefunden.');
    // Refresh before merging the AI result. GitHub's video workflow can finish
    // while diarization is running; fetching the latest clip here preserves its
    // new playback path/status instead of writing an older in-memory snapshot.
    await refreshRoom(false);
    const previousAnalysis = (state.room.clip || {}).analysis || {};
    const completedAnalysis = {
      ...previousAnalysis,
      provider: result?.provider || previousAnalysis.provider || 'AssemblyAI',
      status: 'completed',
      result,
      completed_at: previousAnalysis.completed_at || new Date().toISOString(),
      error: null
    };
    const clip = { ...(state.room.clip || {}), roles: cleanRoles, analysis: completedAnalysis };
    await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: clip, p_script: cleanScript });
    state.room.clip = clip;
    state.room.script = cleanScript;
    state.editorDirty = false;
    state.lineIndex = 0;
    await refreshRoom(false);
    // As soon as two or more players are present, assign detected character voices automatically.
    // When the host is alone, the same assignment runs immediately before the round starts.
    if (mode() !== 'parallel' && isHost() && players().length >= 2) await autoAssignRoles(false);
    renderRoles();
    renderScriptEditor();
    renderWorkflow();
    const namedCount = cleanRoles.filter(role => role.ai_identified).length;
    const detail = namedCount
      ? `${namedCount} Stimme(n) mit einem im Dialog genannten Namen zugeordnet.`
      : 'Die KI konnte keine Namen sicher aus dem gesprochenen Dialog zuordnen. Die Figuren sind deshalb als „Name nicht erkannt · Stimme A/B“ markiert – es werden keine Namen erfunden.';
    const assignmentText = mode() !== 'parallel' ? (players().length >= 2 ? 'Die Rollen wurden auf die verbundenen Spieler verteilt.' : 'Sobald mindestens zwei Spieler verbunden sind, könnt ihr die Rollen automatisch verteilen.') : '';
    const message = `Analyse fertig: ${cleanRoles.length} Stimme(n), ${cleanScript.length} Lines. ${detail} ${assignmentText} Bitte prüft die Zuordnung, bevor ihr startet.`;
    if ($('dubAnalysisStatus')) $('dubAnalysisStatus').textContent = message;
    status(message, 'success');
  }

  async function startClipAnalysis(force = false) {
    if (!state.room || !isHost() || state.room.status !== 'waiting' || !state.room.clip?.path) {
      status('Nur der Lobby-Host kann einen hochgeladenen Clip vor Rundenstart analysieren.', 'error');
      return false;
    }
    if (force && !$('dubAiConsent')?.checked) {
      status('Bitte bestätige zuerst, dass du die Tonspur erneut analysieren lassen darfst.', 'error');
      return false;
    }
    if (state.analysisBusy) return false;
    const cachedResult = state.room.clip?.analysis?.result;
    if (!force && state.room.clip?.analysis?.status === 'completed' && cachedResult) {
      try { await applyAnalysisToScript(cachedResult); return true; }
      catch (error) { status(error.message, 'error'); return false; }
    }
    state.analysisBusy = true;
    const button = $('dubAnalyzeClip');
    if (button) { button.disabled = true; button.textContent = 'Analysiere …'; }
    if ($('dubAnalysisStatus')) $('dubAnalysisStatus').textContent = 'Clip wird sicher an den Sprachanalyse-Dienst übergeben. Anschließend werden Stimmen, gesprochene Namen und Zeitmarken ausgewertet …';
    if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'KI analysiert den Clip …';
    try {
      const existingAnalysis = state.room.clip?.analysis;
      if (!(existingAnalysis?.status === 'processing' && existingAnalysis?.transcript_id && !force)) {
        await invokeDubAnalysis({ action: 'start', room_code: state.room.code, force: Boolean(force) });
      }
      const maxPolls = 120;
      for (let attempt = 0; attempt < maxPolls; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await invokeDubAnalysis({ action: 'poll', room_code: state.room.code });
        if (response.status === 'completed' && response.result) {
          await applyAnalysisToScript(response.result);
          await refreshRoom(false);
          return true;
        }
        if (response.status === 'failed' || response.status === 'too_many_lines' || response.status === 'too_many_speakers') {
          throw new Error(response.error || 'Die Clip-Analyse konnte nicht abgeschlossen werden.');
        }
        if ($('dubAnalysisStatus')) $('dubAnalysisStatus').textContent = response.message || 'Stimmen und Dialoge werden erkannt …';
      }
      throw new Error('Die Analyse dauert länger als erwartet. Der Auftrag läuft möglicherweise noch; klicke später erneut auf „Clip analysieren“.');
    } catch (error) {
      if ($('dubAnalysisStatus')) $('dubAnalysisStatus').textContent = `Analyse nicht abgeschlossen: ${error.message}`;
      status(`Clip ist gespeichert, aber die KI-Analyse konnte nicht abgeschlossen werden: ${error.message}`, 'error');
      return false;
    } finally {
      state.analysisBusy = false;
      if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = state.room?.clip?.analysis?.status === 'completed' ? 'Clip analysiert' : 'Clip-Vorschau';
      renderWorkflow();
    }
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

  async function importSelectedTemplate() {
    const chosen = state.selectedSource;
    if (!chosen?.id || !state.room || !isHost() || state.room.status !== 'waiting') {
      status('Wähle zuerst eine Vorlage in einer offenen Lobby aus.', 'error'); return;
    }
    if (!$('dubRightsCheck').checked) { status('Bitte bestätige, dass du die angezeigte Creative-Commons-Lizenz einhältst.', 'error'); return; }
    if (!$('dubAiConsent')?.checked) { status('Bitte bestätige zuerst die Übertragung der Tonspur zur KI-Analyse.', 'error'); return; }
    const button = $('dubImportTemplateButton');
    button.disabled = true; button.textContent = 'Vorlage wird in eure Lobby kopiert …';
    $('dubUploadProgress').textContent = 'Der Demo-Clip mit Originalton wird privat in eure Lobby kopiert …';
    try {
      const result = await invokeDubAnalysis({
        action: 'import_template', room_code: state.room.code, template_id: chosen.id,
        rights_confirmed: true, ai_analysis_consent: true
      });
      if (result.status !== 'imported' || !result.path) throw new Error(result.error || 'Die Vorlage konnte nicht in die Lobby kopiert werden.');
      state.previewRemoteFailed = false;
      $('dubUploadProgress').textContent = 'Vorlage gespeichert ✓ · KI-Analyse startet …';
      await refreshRoom(false);
      await startClipAnalysis(false);
    } catch (error) {
      $('dubUploadProgress').textContent = '';
      status(`Vorlage konnte nicht übernommen werden: ${error.message}`, 'error');
    } finally {
      button.disabled = false; button.textContent = 'Vorlage übernehmen & analysieren';
    }
  }

  function makePlaybackObjectPath(originalPath) {
    const value = String(originalPath || '');
    const slash = value.lastIndexOf('/');
    const folder = slash >= 0 ? value.slice(0, slash + 1) : '';
    const filename = slash >= 0 ? value.slice(slash + 1) : value;
    const stem = filename.replace(/\.[^.]+$/, '') || 'clip';
    return `${folder}${stem}-playback-${Date.now().toString(36)}.mp4`;
  }

  async function dispatchServerVideoTranscode(roomCode, originalPath, playbackPath) {
    const session = await deps.getSession();
    if (!session?.access_token) throw new Error('Deine Anmeldung ist abgelaufen. Bitte lade Schreibbot neu.');
    const base = String(deps.url || '').replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
      throw new Error('Die Supabase-Projekt-URL für DubTogether fehlt oder ist ungültig. Prüfe FEEDBACK_SUPABASE_URL in index.html.');
    }
    if (!String(deps.apiKey || '').trim()) {
      throw new Error('Der öffentliche Supabase-Publishable-Key fehlt. Prüfe FEEDBACK_SUPABASE_ANON_KEY in index.html.');
    }
    const endpoint = `${base}/functions/v1/dub-transcode-request`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST', mode: 'cors', cache: 'no-store',
        headers: {
          apikey: deps.apiKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ room_code: roomCode, original_path: originalPath, playback_path: playbackPath })
      });
    } catch (error) {
      const detail = error?.message || String(error || 'Unbekannter Netzwerkfehler');
      throw new Error(`Die Supabase-Edge-Function konnte vom Browser nicht erreicht werden (${detail}). Prüfe, ob „dub-transcode-request“ im Projekt bereitgestellt ist, CORS/OPTIONS erreichbar ist und „Verify JWT“ für diese Funktion ausgeschaltet wurde. Aufruf: ${endpoint}`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Der Supabase-Server hat den Auftrag abgelehnt (HTTP ${response.status}).`);
    return data;
  }

  async function saveServerTranscodeFailure(error) {
    const current = state.room?.clip;
    if (!current || !isHost() || state.room.status !== 'waiting') return;
    const failedClip = {
      ...current,
      playback_status: 'failed',
      playback_compatible: false,
      playback_error: String(error?.message || error || 'Server-Transcodierung konnte nicht gestartet werden.').slice(0, 280)
    };
    try {
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: failedClip, p_script: script() });
      state.room.clip = failedClip;
      await refreshRoom(false);
    } catch (saveError) {
      console.warn('Transcodierungsfehler konnte nicht in der Lobby gespeichert werden:', saveError);
    }
  }

  async function retryServerVideoTranscode() {
    const button = $('dubOptimizeVideoButton');
    if (!state.room || !isHost() || state.room.status !== 'waiting') {
      status('Nur der Lobby-Host kann die Wiedergabe vor Rundenstart erneut vorbereiten.', 'error');
      return;
    }
    const originalPath = originalClipPath(state.room.clip);
    if (!originalPath) {
      status('Für diesen Clip ist kein Original in Supabase gespeichert.', 'error');
      return;
    }
    const playbackPath = makePlaybackObjectPath(originalPath);
    const pendingClip = {
      ...(state.room.clip || {}),
      path: originalPath,
      original_path: originalPath,
      playback_path: playbackPath,
      original_mime: state.room.clip?.original_mime || state.room.clip?.mime || 'video/mp4',
      playback_compatible: false,
      playback_status: 'preparing',
      playback_started_at: new Date().toISOString(),
      playback_profile: '',
      playback_error: null
    };
    if (button) { button.disabled = true; button.textContent = 'Server bereitet MP4 vor …'; }
    try {
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: pendingClip, p_script: script() });
      state.room.clip = pendingClip;
      await refreshRoom(false);
      await dispatchServerVideoTranscode(state.room.code, originalPath, playbackPath);
      updateVideoImportStatus('Original gespeichert · kostenlose Server-Konvertierung läuft. Der Timer zählt bis die kompatible MP4 gespeichert ist.');
      status('Die MP4 wird jetzt auf GitHub in eine browserfreundliche Version umgewandelt. Auf euren Handys wird keine Video-Engine geladen.', 'success');
    } catch (error) {
      await saveServerTranscodeFailure(error);
      status(`Die Original-MP4 bleibt gespeichert. Der kostenlose Server-Auftrag konnte nicht gestartet werden: ${error.message || error}`, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Server-Umwandlung erneut starten'; }
    }
  }

  async function optimizeSelectedVideoForPlayback() {
    await retryServerVideoTranscode();
  }

  async function uploadClip() {
    const file = state.selectedFile;
    if (!file || !state.room) return;
    if (file.size > 45 * 1024 * 1024) {
      status('Die Datei ist größer als das aktuelle Lobby-Limit von 45 MB. Bitte wähle einen kürzeren oder kleineren Clip.', 'error');
      return;
    }
    const contentType = videoMimeFromFile(file) || await sniffVideoMime(file);
    if (!contentType) { status('Bitte wähle eine Videodatei aus deiner Galerie aus.', 'error'); return; }
    if (!file.size) { status('Die ausgewählte Videodatei ist leer oder konnte nicht gelesen werden.', 'error'); return; }
    if (state.videoInfo && state.selectedFile === file) {
      const verdict = describeVideoInspection(state.videoInfo, file.name);
      if (verdict.blocking) { status(verdict.text, 'error'); return; }
    }
    if (!$('dubRightsCheck').checked) { status('Bitte bestätige zuerst, dass du die nötigen Rechte bzw. eine passende Lizenz besitzt.', 'error'); return; }
    if (!$('dubAiConsent')?.checked) { status('Bitte bestätige zuerst die Übertragung der Tonspur zur KI-Analyse.', 'error'); return; }
    if (!isHost() || state.room.status !== 'waiting') { status('Nur der Lobby-Host kann vor dem Start einen Clip hinzufügen.', 'error'); return; }

    const chosen = state.selectedSource;
    $('dubUploadClipButton').disabled = true;
    $('dubUploadProgress').textContent = 'Original-MP4 wird direkt und unverändert in eure private Lobby hochgeladen …';
    const createdPaths = [];
    let originalPath = '';
    let playbackPath = '';
    try {
      const clipId = Date.now().toString(36);
      const extension = contentType === 'video/webm' ? 'webm' : contentType === 'video/quicktime' ? 'mov'
        : contentType === 'video/x-matroska' ? 'mkv' : contentType === 'video/x-msvideo' ? 'avi'
        : contentType === 'video/3gpp' ? '3gp' : contentType === 'video/3gpp2' ? '3g2'
        : contentType === 'video/mpeg' ? (clipFileExtension(file) || 'mpg')
        : contentType === 'video/mp2t' ? (clipFileExtension(file) || 'ts')
        : contentType === 'video/ogg' ? 'ogv' : (clipFileExtension(file) || 'mp4');
      const ownerFolder = `${state.room.code}/clips/${uid()}`;
      originalPath = `${ownerFolder}/clip-${clipId}.${extension}`;
      playbackPath = `${ownerFolder}/clip-${clipId}-playback.mp4`;
      await uploadStoragePath(originalPath, file, contentType);
      createdPaths.push(originalPath);

      const oldClip = state.room.clip || {};
      const clip = {
        ...oldClip,
        title: (chosen?.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 80),
        path: originalPath,
        original_path: originalPath,
        playback_path: playbackPath,
        mime: contentType,
        original_mime: contentType,
        playback_compatible: false,
        playback_status: 'preparing',
        playback_started_at: new Date().toISOString(),
        playback_profile: '',
        playback_error: null,
        original_filename: file.name,
        video_codec: state.videoInfo?.video || '', video_profile: state.videoInfo?.profile || 0, video_codec_label: state.videoInfo?.label || '', audio_codec: state.videoInfo?.audio || '',
        source: chosen?.source || 'Eigener Upload', source_url: chosen?.url || '',
        license: chosen?.license || 'Eigene Datei · Rechte vom Uploader bestätigt',
        rights_confirmed: true, ai_analysis_consent: true, ai_consent_at: new Date().toISOString(), ai_consent_user: uid(),
        duration_hint: 'Videodatei', roles: roles().map(r => ({ id: r.id, name: r.name })),
        audio_stems: null, analysis: null, workflow_step: 'clip'
      };
      const oldMediaPaths = [...new Set([
        state.room.clip?.path, state.room.clip?.original_path, state.room.clip?.playback_path,
        state.room.clip?.audio_stems?.vocals_path, state.room.clip?.audio_stems?.accompaniment_path
      ].filter(Boolean))];
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: clip, p_script: script() });
      // Original is now committed in the room; later workflow failures must not delete it.
      createdPaths.length = 0;
      if (oldMediaPaths.length) {
        try { await removeStoragePaths(oldMediaPaths); }
        catch (cleanupError) { console.warn('Alte Clip-/Audiostem-Dateien konnten nicht entfernt werden:', cleanupError); }
      }

      state.sourceClipFile = file;
      state.selectedFile = null;
      $('dubClipFile').value = '';
      $('dubUploadClipButton').hidden = true;
      if (state.localClipPreviewUrl) URL.revokeObjectURL(state.localClipPreviewUrl);
      state.localClipPreviewUrl = '';
      await refreshRoom(false);
      renderInlinePreview();
      $('dubUploadProgress').textContent = 'Original-MP4 gespeichert ✓ · Server-Konvertierung wird gestartet …';
      status('Deine Originaldatei ist sicher gespeichert. GitHub erstellt jetzt im Hintergrund eine MP4, die auf den Geräten der Mitspieler abspielbar ist.', 'success');

      try {
        await dispatchServerVideoTranscode(state.room.code, originalPath, playbackPath);
        $('dubUploadProgress').textContent = 'Original-MP4 gespeichert ✓ · kompatible Wiedergabe wird serverseitig erstellt …';
      } catch (transcodeError) {
        await saveServerTranscodeFailure(transcodeError);
        $('dubUploadProgress').textContent = `Original-MP4 gespeichert ✓ · Server-Konvertierung konnte nicht starten: ${transcodeError.message || transcodeError}`;
        status(`Die MP4 wurde hochgeladen. Die Server-Verbindung muss noch geprüft werden: ${transcodeError.message || transcodeError}`, 'error');
      }
      await startClipAnalysis(false);
    } catch (error) {
      if (createdPaths.length) { try { await removeStoragePaths(createdPaths); } catch {} }
      $('dubUploadProgress').textContent = '';
      status(deps?.friendlyError?.(error) || error.message, 'error');
    } finally {
      $('dubUploadClipButton').disabled = false;
    }
  }

  async function addRole() {
    const current = roles().map(r => ({ ...r }));
    if (current.length >= 12) { status('Es können höchstens 12 Personen/Rollen angelegt werden.', 'error'); return; }
    const n = current.length + 1; current.push({ id: `speaker-${Date.now().toString(36)}`, name: `Name nicht erkannt · Stimme ${String.fromCharCode(64 + Math.min(n, 26))}` });
    state.room.clip = { ...(state.room.clip || {}), roles: current };
    renderRoles(); renderScriptEditor();
    await saveScript();
  }
  function addLine() {
    const list = state.room.script || [];
    const i = list.length + 1;
    const start = Math.max(0, (i - 1) * 2.5);
    list.push({ id: `line-${Date.now().toString(36)}`, role: roles()[0]?.id || 'speaker-a', text: '', start_sec: start, end_sec: start + 1.2 });
    state.room.script = list; state.editorDirty = true; renderScriptEditor();
  }

  function workflowStep() {
    const statusValue = state.room?.status;
    if (statusValue === 'waiting' && isPlaybackBlocked()) return 'clip';
    if (statusValue === 'recording') return 'record';
    if (statusValue === 'reveal' || statusValue === 'finished') return 'results';
    return state.room?.clip?.workflow_step === 'setup' ? 'setup' : 'clip';
  }

  function renderWorkflow() {
    if (!state.room) return;
    const current = workflowStep();
    document.querySelectorAll('[data-dub-stage]').forEach(stage => {
      stage.hidden = stage.dataset.dubStage !== current;
    });
    const order = ['clip', 'setup', 'record', 'results'];
    const currentIndex = order.indexOf(current);
    document.querySelectorAll('[data-dub-wizard]').forEach(item => {
      const index = order.indexOf(item.dataset.dubWizard);
      item.classList.toggle('is-current', index === currentIndex);
      item.classList.toggle('is-complete', index >= 0 && index < currentIndex);
      item.setAttribute('aria-current', index === currentIndex ? 'step' : 'false');
    });
    const isWaitingHost = isHost() && state.room.status === 'waiting';
    const hasClip = Boolean(state.room.clip?.path);
    const playbackPending = isPlaybackPending();
    const playbackBlocked = isPlaybackBlocked();
    updateTranscodeWait();
    const goSetup = $('dubGoSetup');
    if (goSetup) {
      goSetup.disabled = !isWaitingHost || !hasClip || playbackBlocked;
      goSetup.textContent = playbackPending ? 'Video wird umgewandelt …' : playbackBlocked ? 'Video-Umwandlung fehlgeschlagen' : hasClip ? 'Weiter: Rollen & Lines →' : 'Erst Clip hochladen';
    }
    if ($('dubBackClip')) $('dubBackClip').hidden = !isWaitingHost;
    if ($('dubNextRound')) $('dubNextRound').hidden = !isHost() || !['reveal', 'finished'].includes(state.room.status);
    if ($('dubClipStepHint')) {
      $('dubClipStepHint').textContent = !hasClip
        ? 'Wählt eine Vorlage, ladet dann die passende Videodatei hoch und bestätigt die Nutzungsrechte.'
        : playbackPending
          ? 'Die Server-Umwandlung läuft. Rollen und Lines werden erst freigegeben, wenn die neue MP4 fertig gespeichert ist.'
          : playbackBlocked
            ? 'Die Video-Umwandlung ist fehlgeschlagen. Der Host muss sie erneut starten; Rollen und Lines bleiben bis zur fertigen MP4 gesperrt.'
            : `Clip bereit: ${state.room.clip.title || 'Eure Szene'}. Weiter geht es mit Rollen und Dialogzeilen.`;
    }
    const preview = $('dubPreviewPanel');
    if (preview) preview.hidden = !hasClip && !state.localClipPreviewUrl && !state.templatePreviewUrl;
    if ($('dubPreviewHeading')) $('dubPreviewHeading').textContent = current === 'results' ? 'Eure fertige Fassung' : (state.selectedSource?.title || state.room.clip?.title || state.selectedFile?.name || 'Eure Szene');
    if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = state.analysisBusy ? 'KI analysiert den Clip …' : state.room.clip?.analysis?.status === 'completed' ? 'Clip analysiert · Lines erstellt' : current === 'results' ? 'Fertiger Dub' : 'Clip-Vorschau';
    const analysisStatus = $('dubAnalysisStatus');
    if (analysisStatus && !state.analysisBusy && state.room.clip?.analysis?.status === 'completed') analysisStatus.textContent = 'Analyse bereits abgeschlossen. Erkannte Namen, Stimmen, Dialoge und Zeitmarken stehen in „Rollen & Lines“ zur Überprüfung bereit.';
    else if (analysisStatus && !state.analysisBusy && state.room.clip?.analysis?.status === 'processing') analysisStatus.textContent = 'Eine Analyse dieses Clips läuft bereits. Der Host kann sie über „Clip analysieren“ fortsetzen.';
    else if (analysisStatus && !state.analysisBusy && state.room.clip?.analysis?.status === 'failed') analysisStatus.textContent = `Letzte Analyse fehlgeschlagen: ${state.room.clip.analysis.error || 'Unbekannter Fehler'}`;
    const linePreviewButton = $('dubPreviewDubLine');
    if (linePreviewButton && current !== 'record') linePreviewButton.disabled = true;
    const analyzeButton = $('dubAnalyzeClip');
    if (analyzeButton) {
      analyzeButton.hidden = !hasClip || !isWaitingHost;
      analyzeButton.disabled = state.analysisBusy;
      analyzeButton.textContent = state.analysisBusy ? 'Analysiere …' : state.room.clip?.analysis?.status === 'completed' ? '↻ Erneut analysieren' : state.room.clip?.analysis?.status === 'processing' ? 'Analyse fortsetzen' : '✨ Clip analysieren';
    }
    renderInlinePreview();
    const wholeDubButton = $('dubPreviewAllDubs');
    if (wholeDubButton) {
      const recordingAvailable = state.room.status === 'recording' && script().some(line => {
        const key = mode() === 'parallel' ? `parallel:${uid()}:${line.id}` : `character:${line.id}`;
        return Boolean(recordings()[key]?.path);
      });
      wholeDubButton.hidden = !recordingAvailable;
      wholeDubButton.disabled = !recordingAvailable || state.recorder?.state === 'recording' || Boolean(state.recordingSavePromise);
    }
  }

  async function setWorkflowStep(nextStep) {
    if (!state.room || !isHost() || state.room.status !== 'waiting') return;
    if (!['clip', 'setup'].includes(nextStep)) return;
    if (nextStep === 'setup' && !state.room.clip?.path) {
      status('Bitte zuerst die Videodatei hochladen. Danach könnt ihr mit Rollen und Lines weitermachen.', 'error');
      return;
    }
    if (nextStep === 'setup' && isPlaybackBlocked()) {
      status(isPlaybackPending() ? 'Die MP4 wird noch auf GitHub umgewandelt. Rollen und Lines werden nach erfolgreicher Speicherung freigegeben.' : 'Die Video-Umwandlung ist fehlgeschlagen. Der Host muss die Umwandlung erneut starten.', '');
      return;
    }
    if (state.editorDirty && !(await saveScript())) return;
    try {
      const clip = { ...(state.room.clip || {}), workflow_step: nextStep };
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: clip, p_script: script() });
      state.room.clip = clip;
      await refreshRoom(false);
      renderWorkflow();
    } catch (error) {
      status(deps?.friendlyError?.(error) || error.message || 'Schritt konnte nicht gespeichert werden.', 'error');
    }
  }

  async function startNextRound() {
    if (!state.room || !isHost() || !['reveal', 'finished'].includes(state.room.status)) return;
    try {
      const oldVoicePaths = Object.values(recordings()).map(item => item?.path).filter(Boolean);
      await apiRpc('start_next_dub_round', { p_code: state.room.code });
      if (oldVoicePaths.length) {
        try { await removeStoragePaths(oldVoicePaths); }
        catch (cleanupError) { console.warn('Alte Sprachaufnahmen konnten nicht vollständig entfernt werden:', cleanupError); }
      }
      state.lineIndex = 0;
      state.selectedCandidate = null;
      state.editorDirty = false;
      await refreshRoom(false);
      status('Neue Runde gestartet. Wählt jetzt den nächsten Clip oder verwendet den bisherigen erneut.', 'success');
    } catch (error) {
      status(deps?.friendlyError?.(error) || error.message || 'Die nächste Runde konnte nicht gestartet werden.', 'error');
    }
  }

  function renderRoom() {
    if (!state.room) return;
    $('dubSetup').hidden = true; $('dubLobby').hidden = false;
    $('dubRoomCode').textContent = state.room.code;
    $('dubRoomState').textContent = ({ waiting: 'Warte auf Mitspieler · Lobby offen', recording: 'Aufnahmen laufen · ihr könnt Zeilen wiederholen', reveal: 'Der Vorhang geht auf · stimmt ab', finished: 'Runde beendet' })[state.room.status] || state.room.status;
    $('dubStartRound').hidden = !isHost() || state.room.status !== 'waiting';
    const syncStartButton = $('dubStartVideoForAll');
    if (syncStartButton) {
      syncStartButton.hidden = !isHost() || !Boolean(state.room.clip?.path);
      syncStartButton.disabled = !hasVideoSource() || Boolean(state.busy);
    }
    const initialClip = state.room.clip || {};
    const playbackPending = initialClip.playback_status === 'preparing' && !hasCompatiblePlaybackCopy(initialClip);
    const playbackFailed = initialClip.playback_status === 'failed' && !hasCompatiblePlaybackCopy(initialClip);
    $('dubStartRound').disabled = Boolean(state.busy || playbackPending);
    $('dubStartHint').textContent = playbackPending
      ? 'Die Original-MP4 ist gespeichert. GitHub erstellt die browserfreundliche Wiedergabe-Datei. Die Runde startet, sobald sie bereit ist.'
      : playbackFailed
        ? 'Die Server-Konvertierung ist fehlgeschlagen. Du kannst die Runde trotzdem ohne Videobild starten (Ton und Zeiten funktionieren) oder „Server-Umwandlung erneut starten“ wählen.'
        : (isHost() ? 'Starte, wenn mindestens zwei Spieler da sind, alle verwendeten Rollen vergeben und alle Lines gespeichert sind.' : 'Der Host startet, sobald Clip, Rollen und Lines vorbereitet sind.');
    $('dubLeaveRoom').hidden = false;
    const closePublicButton = $('dubClosePublicRoom');
    if (closePublicButton) closePublicButton.hidden = !(Boolean(state.room.is_public) && isHost());
    $('dubSaveScript').hidden = !(isHost() && state.room.status === 'waiting');
    renderPlayers(); renderModeChoices(); renderWorkflow();
    if (!state.editorDirty) { renderRoles(); renderScriptEditor(); }
    renderRecordingStudio(); renderResults(); renderTwitchPanel();
    const clip = state.room.clip || {};
    if (clip.title) $('dubSelectedSourceText').textContent = `Aktueller Clip: ${clip.title} · ${clip.license || 'Lobby-Clip'}`;
    const retryButton = $('dubOptimizeVideoButton');
    if (retryButton) {
      const canRetry = isHost() && state.room.status === 'waiting' && Boolean(clip.path)
        && ['idle', 'failed'].includes(clip.playback_status || 'idle');
      retryButton.hidden = !canRetry;
      if (canRetry) retryButton.textContent = 'Server-Umwandlung erneut starten';
    }
    const needsSignedUrl = clip.path && (
      state.signedClipPath !== clip.path ||
      (state.signedClipUrl && state.signedClipExpiresAt < Date.now() + 60000) ||
      (!state.signedClipUrl && state.signingClipPath !== clip.path)
    );
    if (needsSignedUrl && state.signingClipPath !== clip.path) {
      state.signedClipPath = clip.path;
      state.signedClipUrl = '';
      state.previewRemoteFailed = false;
      state.signingClipPath = clip.path;
      renderInlinePreview();
      signStoragePath(clip.path).then(url => {
        if (state.room?.clip?.path !== clip.path) return;
        state.signedClipUrl = url;
        state.previewRemoteFailed = false;
        state.signedClipExpiresAt = Date.now() + 3500 * 1000;
        renderInlinePreview();
      }).catch(error => {
        if (state.room?.clip?.path !== clip.path) return;
        state.signedClipPath = '';
        state.previewRemoteFailed = true;
        renderInlinePreview();
        const empty = $('dubNoVideo');
        if (empty && !state.localClipPreviewUrl && !state.templatePreviewUrl) { empty.hidden = false; empty.textContent = `Clip konnte nicht geladen werden: ${error.message}`; }
        if ($('dubPreviewStatus')) $('dubPreviewStatus').textContent = 'Gespeicherter Clip-Link fehlgeschlagen';
      }).finally(() => {
        if (state.signingClipPath === clip.path) state.signingClipPath = '';
      });
    } else if (!clip.path) {
      state.signedClipPath = ''; state.signedClipUrl = ''; state.signedClipExpiresAt = 0; state.signingClipPath = '';
      renderInlinePreview();
    } else {
      renderInlinePreview();
    }
  }

  async function setMode(newMode) {
    if (!['parallel', 'character', 'scenario'].includes(newMode) || !state.room || !isHost() || state.room.status !== 'waiting') return;
    try { await apiRpc('set_dub_mode', { p_code: state.room.code, p_mode: newMode }); state.mode = newMode; await refreshRoom(false); status(`${MODE_LABELS[newMode]}-Modus ausgewählt.`, 'success'); }
    catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  async function autoAssignRoles(showMessage = true) {
    if (!state.room || !isHost() || state.room.status !== 'waiting') return false;
    const lobbyPlayers = players();
    if (!lobbyPlayers.length) { if (showMessage) status('Warte zuerst, bis Mitspieler in der Lobby sind.', 'error'); return false; }
    const usedRoles = [...new Set(script().map(line => line.role).filter(Boolean))];
    const assignments = { ...(state.room.assignments || {}) };
    const roleCounts = new Map(lobbyPlayers.map(player => [player.id, 0]));
    for (const roleId of usedRoles) {
      const ownerId = assignments[roleId];
      if (ownerId && roleCounts.has(ownerId)) roleCounts.set(ownerId, roleCounts.get(ownerId) + 1);
    }
    let assignedCount = 0;
    for (const roleId of usedRoles) {
      if (assignments[roleId] && roleCounts.has(assignments[roleId])) continue;
      const player = [...lobbyPlayers].sort((a, b) => (roleCounts.get(a.id) || 0) - (roleCounts.get(b.id) || 0))[0];
      if (!player?.id) continue;
      await apiRpc('assign_dub_role', { p_code: state.room.code, p_role: roleId, p_player_id: player.id });
      assignments[roleId] = player.id;
      roleCounts.set(player.id, (roleCounts.get(player.id) || 0) + 1);
      assignedCount++;
    }
    await refreshRoom(false);
    if (showMessage) status(assignedCount ? `${assignedCount} freie Rolle(n) wurden möglichst gleichmäßig auf ${lobbyPlayers.length} Spieler verteilt. Du kannst die Zuordnung oben noch ändern.` : 'Alle verwendeten Rollen sind bereits zugeteilt.', 'success');
    renderRoles();
    return true;
  }

  async function startRound() {
    if (!state.room || !isHost()) return;
    if (!state.room.clip?.path) { status('Bitte wählt zuerst einen Clip aus und ladet die Videodatei hoch.', 'error'); return; }
    if (state.room.clip.playback_status === 'preparing' && !hasCompatiblePlaybackCopy(state.room.clip)) {
      status('Die Originaldatei ist gespeichert. GitHub erstellt gerade die browserfreundliche MP4. Bitte warte, bis die Wiedergabe bereit ist.', '');
      return;
    }
    const withoutPicture = state.room.clip.playback_status === 'failed' && !hasCompatiblePlaybackCopy(state.room.clip);
    if (withoutPicture) status('Start ohne Videobild: Die Server-Konvertierung ist fehlgeschlagen. Aufnahme und Zeiten funktionieren trotzdem.', '');
    if (!withoutPicture && !hasPlayableVideo()) {
      try { await ensureVideoReadyForLine(); }
      catch (videoError) { status(`Die MP4 ist auf diesem Gerät noch nicht abspielbereit: ${videoError.message}`, 'error'); return; }
    }
    const clipAnalysis = state.room.clip?.analysis || {};
    const analysisHasUsableResult = clipAnalysis.status === 'completed'
      && Array.isArray(clipAnalysis.result?.segments)
      && clipAnalysis.result.segments.length > 0
      && script().length > 0;
    if (mode() !== 'scenario' && !analysisHasUsableResult) {
      const detail = clipAnalysis.status === 'completed'
        ? 'Die Analyse wurde angezeigt, aber ihr Ergebnis ist nicht vollständig in der Lobby gespeichert. Bitte klicke einmal auf „Clip analysieren“, damit DubTogether das Ergebnis synchronisiert.'
        : 'Bitte zuerst „Clip analysieren“ vollständig abschließen. Erst danach werden Stimmen und Lines für die Aufnahme freigegeben.';
      status(`${detail} Im Szenario-Modus könnt ihr eigene Dialoge verwenden.`, 'error');
      return;
    }
    const saved = await saveScript();
    if (!saved) return;
    if (players().length < 2) { status('Ihr braucht mindestens zwei Spieler in der Lobby.', 'error'); return; }
    try {
      if (mode() !== 'parallel') {
        await autoAssignRoles(false);
        const requiredRoles = [...new Set(script().map(line => line.role))];
        const missing = requiredRoles.filter(roleId => !state.room.assignments?.[roleId]);
        if (missing.length) { status('Die Figuren konnten nicht vollständig verteilt werden. Prüfe die Spielerliste und versuche es erneut.', 'error'); return; }
      }
      await apiRpc('start_dub_round', { p_code: state.room.code });
      await refreshRoom(false); state.lineIndex = 0;
      status(`Die Runde läuft. ${script().length} Dialogzeilen sind vorbereitet. Nehmt jede eigene Line auf, hört sie an und geht dann zur nächsten.`, 'success');
    } catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }

  async function runRecordingCountdown() {
    const overlay = $('dubRecordCountdown');
    const number = $('dubRecordCountdownValue');
    const label = $('dubRecordCountdownLabel');
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    state.countdownActive = true;
    state.countdownCancelled = false;
    if (overlay) overlay.hidden = false;
    for (const value of [3, 2, 1]) {
      if (state.countdownCancelled) break;
      if (number) number.textContent = String(value);
      if (label) label.textContent = 'Mach dich bereit …';
      if ($('dubRecordStatus')) $('dubRecordStatus').textContent = `Aufnahme startet in ${value} …`;
      await sleep(1000);
    }
    if (state.countdownCancelled) {
      if (overlay) overlay.hidden = true;
      state.countdownActive = false;
      return false;
    }
    if (number) number.textContent = 'LOS';
    if (label) label.textContent = 'Jetzt sprechen';
    // A tiny paint opportunity only; no artificial two-second pre-roll.
    await sleep(60);
    if (overlay) overlay.hidden = true;
    state.countdownActive = false;
    return !state.countdownCancelled;
  }

  async function startRecording() {
    const line = currentLine();
    if (!line) { status('Dir ist aktuell keine aufnehmbare Line zugeteilt. Bitte prüfe die Rollenverteilung mit dem Host.', 'error'); return; }
    if (!canRecord(line)) { status(`Diese Line ist ${memberName(lineOwner(line))} zugeteilt. Bitte prüfe die Rollenverteilung mit dem Host.`, 'error'); return; }
    if (state.recorder?.state === 'recording') { status('Eine Aufnahme läuft bereits. Drücke zuerst „Aufnahme stoppen“.', 'error'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { status('Dein Browser unterstützt keine Mikrofonaufnahme. Öffne Schreibbot über HTTPS in einem aktuellen Browser und erlaube den Mikrofonzugriff.', 'error'); return; }

    const videoElement = $('dubVideo');
    const bounds = dubbedLineBounds(line);
    let videoPlaybackAvailable = hasPlayableVideo();
    try {
      // Request the mic and seek the clip in parallel. Once the mic is ready,
      // the visible 3-2-1 countdown runs; recording starts immediately at LOS.
      $('dubRecordStatus').textContent = 'Mikrofon wird vorbereitet – danach kommt 3, 2, 1 …';
      if (videoPlaybackAvailable) videoElement.pause();
      const micPromise = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const seekPromise = videoPlaybackAvailable
        ? seekVideoTo(videoElement, bounds.start).then(() => true).catch(() => false)
        : Promise.resolve(false);
      const [stream, seekReady] = await Promise.all([micPromise, seekPromise]);
      videoPlaybackAvailable = Boolean(videoPlaybackAvailable && seekReady);
      state.micStream = stream;
      state.recordChunks = [];
      state.recordLineId = line.id;
      state.recordLineEndSec = bounds.end;
      state.recordEffect = $('dubVoiceEffect').value;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported?.(type));
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      state.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data?.size) state.recordChunks.push(event.data); };
      recorder.onerror = event => {
        const detail = event?.error?.message || 'Unbekannter MedienRecorder-Fehler.';
        status(`Die Mikrofonaufnahme wurde vom Browser unterbrochen: ${detail}`, 'error');
        if (recorder.state === 'recording') { try { recorder.stop(); } catch {} }
      };
      recorder.onstop = () => {
        const saveTask = saveRecordingBlob(recorder.mimeType || 'audio/webm');
        const wrappedTask = saveTask.finally(() => {
          if (state.recordingSavePromise === wrappedTask) state.recordingSavePromise = null;
          if (state.room?.status === 'recording') renderRecordingStudio();
        });
        state.recordingSavePromise = wrappedTask;
      };

      if (videoPlaybackAvailable) {
        videoElement.pause();
        videoElement.muted = true;
        videoElement.currentTime = bounds.start;
      }

      // Keep the microphone stream ready while the countdown is visible, but
      // do not capture the count itself. The MediaRecorder and video start in
      // the same user-initiated task immediately after LOS.
      state.countdownActive = true;
      $('dubStopButton').disabled = false;
      $('dubStopButton').textContent = 'Abbrechen';
      const countdownReady = await runRecordingCountdown();
      if (!countdownReady) {
        if (state.micStream) state.micStream.getTracks().forEach(track => track.stop());
        state.micStream = null;
        state.recorder = null;
        state.recordChunks = [];
        $('dubStopButton').disabled = true;
        $('dubStopButton').textContent = 'Aufnahme stoppen';
        $('dubRecordButton').disabled = false;
        $('dubRecordStatus').textContent = 'Countdown abgebrochen. Es wurde nichts aufgenommen.';
        return;
      }
      if (videoPlaybackAvailable) {
        videoElement.pause();
        videoElement.muted = true;
        videoElement.currentTime = bounds.start;
      }
      state.recordStartedAt = performance.now();
      recorder.start();
      if (videoPlaybackAvailable) {
        const playResult = videoElement.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => {
            videoPlaybackAvailable = false;
            try { videoElement.pause(); } catch {}
            if (state.recordingFrame) cancelAnimationFrame(state.recordingFrame);
            state.recordingFrame = 0;
            if (state.recordingTimer) clearTimeout(state.recordingTimer);
            const elapsedMs = Math.max(0, performance.now() - state.recordStartedAt);
            const remainingMs = Math.max(80, Math.ceil(bounds.duration * 1000 - elapsedMs));
            state.recordingTimer = setTimeout(() => {
              if (state.recorder?.state === 'recording') stopRecording();
            }, remainingMs);
            $('dubRecordStatus').textContent = 'Der Clip konnte nicht starten. Deine Line wird ohne Videobild bis zum vorgesehenen Ende aufgenommen.';
          });
        }
      }

      $('dubRecordButton').disabled = true;
      $('dubStopButton').disabled = false;
      $('dubStopButton').textContent = 'Aufnahme stoppen';
      $('dubFinishVersion').disabled = true;
      $('dubFinishRound').disabled = true;
      $('dubRecordStatus').textContent = videoPlaybackAvailable
        ? `Aufnahme läuft direkt · Clipstelle ${bounds.start.toFixed(2)}–${bounds.end.toFixed(2)} s.`
        : `Aufnahme läuft direkt ohne Videobild · ${bounds.duration.toFixed(2).replace('.', ',')} s.`;
      startMicMeter(stream);

      if (videoPlaybackAvailable) {
        const stopAtLineEnd = () => {
          if (state.recorder?.state !== 'recording') return;
          if (videoElement.ended || videoElement.currentTime >= bounds.end - 0.005) {
            $('dubRecordStatus').textContent = 'Line-Ende erreicht · Aufnahme wird gespeichert …';
            stopRecording();
            return;
          }
          state.recordingFrame = requestAnimationFrame(stopAtLineEnd);
        };
        state.recordingFrame = requestAnimationFrame(stopAtLineEnd);
      }

      if (state.recordingTimer) clearTimeout(state.recordingTimer);
      // With a running video, the frame/time watcher stops on the real clip
      // boundary. This timer is only a safety net for a stalled/failed player;
      // it must not cut the voice early while the video is still buffering.
      const fallbackRecordMs = videoPlaybackAvailable
        ? Math.max(10000, Math.ceil(bounds.duration * 1000) + 8000)
        : Math.max(80, Math.ceil(bounds.duration * 1000));
      state.recordingTimer = setTimeout(() => {
        if (state.recorder?.state === 'recording') stopRecording();
      }, fallbackRecordMs);

      status(videoPlaybackAvailable
        ? 'Aufnahme läuft synchron mit der Original-Line. Es gibt keine zusätzliche Vorbereitungs- oder Nachlaufpause.'
        : 'Aufnahme läuft ohne Videowiedergabe. Es gibt keine zusätzliche Vorbereitungs- oder Nachlaufpause.', 'success');
    } catch (error) {
      state.countdownActive = false;
      if ($('dubRecordCountdown')) $('dubRecordCountdown').hidden = true;
      if (state.recordingTimer) { clearTimeout(state.recordingTimer); state.recordingTimer = null; }
      if (state.recordingFrame) { cancelAnimationFrame(state.recordingFrame); state.recordingFrame = 0; }
      if (state.recorder?.state === 'recording') { try { state.recorder.stop(); } catch {} }
      if (state.micStream) state.micStream.getTracks().forEach(track => track.stop());
      state.micStream = null;
      if (videoElement && state.room?.status === 'recording') videoElement.pause();
      state.recorder = null;
      const message = error.name === 'NotAllowedError'
        ? 'Mikrofonzugriff wurde nicht erlaubt. Prüfe die Browser-Berechtigung.'
        : error.name === 'NotReadableError'
          ? 'Das Mikrofon ist gerade durch eine andere App belegt. Schließe diese App und versuche es erneut.'
          : `Aufnahme konnte nicht gestartet werden: ${error.message}`;
      status(message, 'error');
      renderRecordingStudio();
    }
  }

  function stopRecording() {
    if (state.countdownActive && state.recorder?.state !== 'recording') {
      state.countdownCancelled = true;
      state.countdownActive = false;
      if ($('dubRecordCountdown')) $('dubRecordCountdown').hidden = true;
      if (state.micStream) state.micStream.getTracks().forEach(track => track.stop());
      state.micStream = null;
      state.recorder = null;
      state.recordChunks = [];
      $('dubStopButton').disabled = true;
      $('dubStopButton').textContent = 'Aufnahme stoppen';
      $('dubRecordButton').disabled = false;
      $('dubRecordStatus').textContent = 'Countdown abgebrochen. Es wurde nichts aufgenommen.';
      return;
    }
    if (state.recordingTimer) { clearTimeout(state.recordingTimer); state.recordingTimer = null; }
    if (state.recordingFrame) { cancelAnimationFrame(state.recordingFrame); state.recordingFrame = 0; }
    if (state.playbackTimer) { clearTimeout(state.playbackTimer); state.playbackTimer = null; }
    const video = $('dubVideo');
    if (video) { video.pause(); video.muted = !$('dubOriginalAudio')?.checked; }
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
    state.micMeterTimer = null; state.analyser = null; if ($('dubMicLevel')) $('dubMicLevel').style.width = '0%';
    const canvas = $('dubWaveform'); if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  async function saveRecordingBlob(mime) {
    const stream = state.micStream; state.micStream = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    const line = script().find(item => item.id === state.recordLineId);
    const blob = new Blob(state.recordChunks, { type: mime || 'audio/webm' });
    if (!line || !blob.size) { $('dubRecordStatus').textContent = 'Keine Audiodaten aufgenommen.'; return; }
    const rawDuration = Math.round(performance.now() - state.recordStartedAt);
    const lineLimit = Math.min(dubbedLineBounds(line).duration, Math.max(MIN_LINE_DURATION_SEC, Number(state.recordLineEndSec) - (Number(line.start_sec) || 0))) * 1000;
    const duration = Math.max(Math.round(MIN_LINE_DURATION_SEC * 1000), Math.min(rawDuration, Math.round(lineLimit)));
    const scope = mode() === 'parallel' ? 'parallel' : 'character';
    const fileExtension = mime.includes('mp4') ? 'm4a' : 'webm';
    const fileName = `${scope}-${line.id}.${fileExtension}`.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${state.room.code}/voices/${uid()}/${fileName}`;
    $('dubRecordStatus').textContent = 'Spur wird privat hochgeladen …';
    try {
      await uploadStoragePath(path, blob, mime || 'audio/webm');
      await apiRpc('save_dub_recording', { p_code: state.room.code, p_line_id: line.id, p_scope: scope, p_path: path, p_duration_ms: duration, p_effect: state.recordEffect });
      $('dubRecordStatus').textContent = `Gespeichert ✓ · ${(duration / 1000).toFixed(1).replace('.', ',')} Sek.`;
      const savedIndex = state.lineIndex;
      await refreshRoom(false);
      const myLines = recordingLines();
      state.lineIndex = Math.max(0, Math.min(savedIndex, myLines.length - 1));
      renderRecordingStudio();
      if (myLines.every(candidate => Boolean(recordings()[recordingKey(candidate, uid())]?.path))) {
        status('Alle deine Lines sind gespeichert. Höre sie jetzt an oder nimm einzelne erneut auf.', 'success');
      } else {
        status('Line gespeichert! Du kannst jetzt „Meine Aufnahme anhören“, sie wiederholen oder mit „Nächste“ weitergehen.', 'success');
      }
    } catch (error) {
      $('dubRecordStatus').textContent = 'Speichern fehlgeschlagen.';
      status(deps?.friendlyError?.(error) || error.message, 'error');
    } finally { state.recordChunks = []; state.recorder = null; renderRecordingStudio(); }
  }

  async function finishVersion() {
    if (!state.room || mode() !== 'parallel') return;
    try {
      if (state.recordingSavePromise) await state.recordingSavePromise;
      await refreshRoom(false);
      const missing = script().filter(line => !recordings()[`parallel:${uid()}:${line.id}`]?.path).length;
      if (missing) { status(`Deine Version ist noch nicht vollständig: ${missing} Line(s) fehlen. Nimm alle Lines auf, bevor du abgibst.`, 'error'); return; }
      await apiRpc('finish_dub_version', { p_code: state.room.code });
      await refreshRoom(false);
      status('Deine vollständige Version wurde abgegeben.', 'success');
    } catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  async function finishRound() {
    if (!state.room || !isHost()) return;
    try {
      if (state.recordingSavePromise) await state.recordingSavePromise;
      await refreshRoom(false);
      const missing = script().filter(line => !recordings()[`character:${line.id}`]?.path).length;
      if (missing) { status(`Die gemeinsame Fassung ist noch nicht vollständig: ${missing} Line(s) fehlen. Alle zugewiesenen Spieler müssen ihre Lines speichern.`, 'error'); return; }
      await apiRpc('finish_dub_round', { p_code: state.room.code });
      await refreshRoom(false);
      status('Alle Lines sind gespeichert. Die gemeinsame Fassung ist bereit.', 'success');
    } catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  async function voteFor(playerId) {
    if (!state.room || mode() !== 'parallel') return;
    try { await apiRpc('vote_dub_version', { p_code: state.room.code, p_candidate_id: playerId }); await refreshRoom(false); status('Deine Stimme wurde gezählt.', 'success'); }
    catch (error) { status(deps?.friendlyError?.(error) || error.message, 'error'); }
  }
  function getWinner() {
    const votes = [...Object.values(state.room?.votes || {}), ...Object.values(state.room?.twitch_votes || {})];
    if (!votes.length) return null;
    const counts = new Map(); votes.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  function stopCurrentPreview() {
    if (state.playbackTimer) clearTimeout(state.playbackTimer);
    if (state.playbackFrame) cancelAnimationFrame(state.playbackFrame);
    state.playbackTimer = null;
    state.playbackFrame = 0;
    state.activeSources.forEach(source => { try { source.stop(); } catch {} });
    state.activeSources = [];
    const video = $('dubVideo');
    if (video) {
      video.pause();
      video.muted = !$('dubOriginalAudio')?.checked;
    }
  }

  function monitorLineEnd(video, endSec, fallbackMs) {
    const stop = () => {
      if (state.playbackTimer) clearTimeout(state.playbackTimer);
      if (state.playbackFrame) cancelAnimationFrame(state.playbackFrame);
      state.playbackTimer = null;
      state.playbackFrame = 0;
      state.activeSources.forEach(source => { try { source.stop(); } catch {} });
      state.activeSources = [];
      video.pause();
      video.muted = !$('dubOriginalAudio')?.checked;
    };
    const check = () => {
      if (video.ended || video.currentTime >= endSec - 0.02) { stop(); return; }
      state.playbackFrame = requestAnimationFrame(check);
    };
    state.playbackTimer = setTimeout(stop, Math.max(100, fallbackMs + 180));
    state.playbackFrame = requestAnimationFrame(check);
  }

  async function playClipAtLine(lineOverride = null) {
    const line = lineOverride || currentLine();
    if (!line) { status('Es ist keine Line ausgewählt. Bitte wähle zuerst eine Dialogzeile aus.', 'error'); return; }
    const bounds = lineBounds(line);
    const video = $('dubVideo');

    // Prepare the video without trying to autoplay it. Once ready, ask for a
    // second tap so play() is called directly inside the user's button gesture.
    if (!hasPlayableVideo()) {
      try {
        status('Original-Clip wird vorbereitet …', '');
        const preparedVideo = await ensureVideoReadyForLine();
        await seekVideoTo(preparedVideo, bounds.start);
        status('Clip ist bereit. Tippe erneut auf „Original-Line anhören“, um den Abschnitt abzuspielen.', 'success');
      } catch (error) {
        status(`Original-Line konnte nicht vorbereitet werden: ${error.message}`, 'error');
      }
      return;
    }

    try {
      stopCurrentPreview();
      video.pause();
      video.muted = false;
      // Setting currentTime and calling play() synchronously keeps the browser's
      // user-activation token available on phones/tablets.
      video.currentTime = bounds.start;
      const playback = video.play();
      await playback;
      monitorLineEnd(video, bounds.end, bounds.duration * 1000);
      status(`Originalton genau dieser Line wird für ${bounds.duration.toFixed(2).replace('.', ',')} Sekunden abgespielt.`, 'success');
    } catch (error) {
      video.pause();
      video.muted = !$('dubOriginalAudio')?.checked;
      status(`Original-Line konnte nicht abgespielt werden: ${error.message}`, 'error');
    }
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
  async function playDubLinePreview(lineOverride = null) {
    const line = lineOverride || currentLine();
    if (!line) { status('Es ist keine Line ausgewählt.', 'error'); return; }
    const saved = lineRecordingFor(line);
    if (!saved?.path) { status('Für diese Line gibt es noch keine gespeicherte Aufnahme. Nimm sie zuerst auf.', 'error'); return; }
    try {
      const context = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
      state.audioContext = context;
      const resumePromise = context.resume();
      const videoPromise = ensureVideoReadyForLine();
      const [video] = await Promise.all([videoPromise, resumePromise]);
      stopCurrentPreview();
      const buffer = await loadAudioBuffer(saved.path);
      const bounds = dubbedLineBounds(line);
      video.pause();
      video.muted = true;
      await seekVideoTo(video, bounds.start);
      await video.play();
      const source = context.createBufferSource();
      source.buffer = buffer;
      const output = context.createGain();
      effectNodes(context, source, EFFECTS.includes(saved.effect) ? saved.effect : 'original', output);
      output.connect(context.destination);
      const startAt = context.currentTime + 0.02;
      const rate = saved.effect === 'chipmunk' ? 1.25 : saved.effect === 'monster' ? 0.82 : 1;
      const maxLineDuration = bounds.duration;
      const audibleDuration = Math.min(maxLineDuration, buffer.duration / rate);
      source.start(startAt, 0, Math.min(buffer.duration, audibleDuration * rate));
      state.activeSources.push(source);
      source.onended = () => {
        state.activeSources = state.activeSources.filter(item => item !== source);
      };
      // Keep the video preview inside the exact original dialogue window.
      // If a player stops early, the remaining part of that window is silent,
      // but the preview never runs into the next character's line.
      monitorLineEnd(video, bounds.end, maxLineDuration * 1000);
      status(`Deine neu aufgenommene Line „${line.text.slice(0, 55)}“ läuft synchron über dem stummgeschalteten Originalclip.`, 'success');
    } catch (error) {
      status(`Line-Vorschau fehlgeschlagen: ${error.message}`, 'error');
    }
  }

  async function playVersion(candidateId) {
    if (!state.room) return;
    try {
      stopCurrentPreview();
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
      if (state.room.clip?.path) {
        if (!hasPlayableVideo()) await waitForVideoData(video);
        video.pause(); video.muted = true;
        await seekVideoTo(video, 0);
        await video.play();
      }
      const startAt = context.currentTime + 0.04;
      buffers.forEach(item => {
        const source = context.createBufferSource(); source.buffer = item.buffer;
        const output = context.createGain(); output.gain.value = 1;
        effectNodes(context, source, EFFECTS.includes(item.recording.effect) ? item.recording.effect : 'original', output);
        output.connect(context.destination);
        const rate = item.recording.effect === 'chipmunk' ? 1.25 : item.recording.effect === 'monster' ? 0.82 : 1;
        const lineCap = dubbedLineBounds(item.line).duration;
        source.start(startAt + Math.max(0, Number(item.line.start_sec) || 0), 0, Math.min(item.buffer.duration, lineCap * rate));
        state.activeSources.push(source);
      });
      const maxEnd = buffers.reduce((max, item) => { const rate = item.recording.effect === 'chipmunk' ? 1.25 : item.recording.effect === 'monster' ? 0.82 : 1; return Math.max(max, (Number(item.line.start_sec) || 0) + Math.min(dubbedLineBounds(item.line).duration, item.buffer.duration / rate) + 0.2); }, 1);
      const videoDuration = Number.isFinite(video?.duration) ? video.duration : 0;
      state.playbackTimer = setTimeout(() => { if (video) { video.pause(); video.muted = !$('dubOriginalAudio')?.checked; } }, Math.max(maxEnd, videoDuration) * 1000 + 500);
      $('dubExportStatus').textContent = `Wiedergabe gestartet: ${buffers.length} Dialogzeilen.`;
      status('Dub wird abgespielt.', 'success');
    } catch (error) { status(`Wiedergabe fehlgeschlagen: ${error.message}`, 'error'); }
  }

  async function playOriginalFullVideo() {
    const video = $('dubVideo');
    if (!video) return;
    if (!hasPlayableVideo()) {
      try {
        await ensureVideoReadyForLine();
        status('Originalvideo ist bereit. Tippe noch einmal auf „Originalvideo mit Originalton“, um es zu starten.', 'success');
      } catch (error) { status(`Originalvideo konnte nicht vorbereitet werden: ${error.message}`, 'error'); }
      return;
    }
    try {
      stopCurrentPreview();
      video.muted = false;
      await seekVideoTo(video, 0);
      await video.play();
      status('Originalvideo läuft mit dem unveränderten Originalton.', 'success');
    } catch (error) {
      status(`Originalvideo konnte nicht gestartet werden: ${error.message}`, 'error');
    }
  }

  async function publishHostPlaybackCommand(position, scheduleHostToo = false, announce = false) {
    if (!state.room || !isHost() || state.playbackSyncApplying) return;
    const now = Date.now();
    if (!announce && now - state.hostSyncLastSentAt < 900) return;
    state.hostSyncLastSentAt = now;
    const startAt = now + (scheduleHostToo ? 4000 : 2400);
    const id = (window.crypto?.randomUUID?.() || `play-${now}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 80);
    // For native host playback, the host is already playing. Mark the command
    // consumed locally so the poll does not restart the host's own video.
    if (!scheduleHostToo) state.lastPlaybackSyncId = id;
    await apiRpc('set_dub_playback_sync', {
      p_code: state.room.code,
      p_command: { id, action: 'play', position: Math.max(0, Number(position) || 0), start_at: new Date(startAt).toISOString() }
    });
    if (scheduleHostToo) await refreshRoom(false);
    if (announce) status('Wiedergabestart an alle gesendet. Alle Geräte starten zum gemeinsamen Zeitpunkt.', 'success');
    else status('Host-Wiedergabe wird mit der Lobby synchronisiert.', 'success');
  }

  async function startVideoForEveryone() {
    if (!state.room || !isHost()) { status('Nur der Host kann die gemeinsame Videowiedergabe starten.', 'error'); return; }
    try {
      const video = await ensureVideoReadyForLine();
      await publishHostPlaybackCommand(video.currentTime, true, true);
    } catch (error) {
      status(`Gemeinsamer Start fehlgeschlagen: ${error.message || error}`, 'error');
    }
  }

  function processPlaybackSync(command) {
    if (!command || command.action !== 'play' || !command.id || command.id === state.lastPlaybackSyncId) return;
    const startAt = Date.parse(command.start_at || '');
    if (!Number.isFinite(startAt) || Date.now() - startAt > 30000) return;
    state.lastPlaybackSyncId = String(command.id);
    if (state.playbackSyncTimer) clearTimeout(state.playbackSyncTimer);
    const waitMs = Math.max(0, startAt - Date.now());
    state.playbackSyncTimer = setTimeout(async () => {
      state.playbackSyncTimer = null;
      const video = $('dubVideo');
      if (!video || !state.room) return;
      try {
        stopCurrentPreview();
        await ensureVideoReadyForLine();
        const elapsed = Math.max(0, (Date.now() - startAt) / 1000);
        const target = Math.max(0, Number(command.position) || 0) + elapsed;
        await seekVideoTo(video, target);
        video.muted = !Boolean($('dubOriginalAudio')?.checked);
        state.playbackSyncApplying = true;
        try {
          await video.play();
        } catch (autoplayError) {
          // Remote browsers often block autoplay with sound. Start muted so
          // everyone still sees the same frame; the member can enable sound.
          video.muted = true;
          await video.play();
          status('Der Host hat das Video gestartet. Es läuft zunächst stumm – aktiviere den Ton über „Originalton“, wenn du möchtest.', '');
        } finally {
          state.playbackSyncApplying = false;
        }
      } catch (error) {
        status(`Der gemeinsame Videostart konnte auf diesem Gerät nicht ausgeführt werden: ${error.message}`, 'error');
      }
    }, waitMs);
  }

  function chooseExportMime(video, resultVideo) {
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    const supported = candidates.filter(type => {
      try { return Boolean(window.MediaRecorder?.isTypeSupported?.(type)); } catch { return false; }
    });
    const playable = supported.find(type => {
      try { return Boolean((resultVideo?.canPlayType(type) || video?.canPlayType(type) || '').trim()); } catch { return false; }
    });
    return playable || supported[0] || '';
  }

  async function waitForExportPreview(video, timeoutMs = 7000) {
    if (!video) return false;
    if (video.readyState >= 2 && !video.error) return true;
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('error', onError);
        resolve(value);
      };
      const onReady = () => finish(video.readyState >= 2 && !video.error);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      video.addEventListener('canplay', onReady);
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('error', onError, { once: true });
      onReady();
    });
  }

  async function waitForVideoExportEnd(video, expectedSeconds) {
    if (!video) throw new Error('Videoplayer für den Export fehlt.');
    if (video.ended) return;
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        error ? reject(error) : resolve();
      };
      const onEnded = () => finish();
      const onError = () => finish(new Error('Die Videowiedergabe wurde während des Exports unterbrochen.'));
      const timer = setTimeout(() => finish(new Error('Der Browser hat das Video nicht bis zum Ende abgespielt. Bitte Export erneut starten und den Tab geöffnet lassen.')), Math.max(10000, (expectedSeconds + 8) * 1000));
      video.addEventListener('ended', onEnded, { once: true });
      video.addEventListener('error', onError, { once: true });
      if (video.ended) finish();
    });
  }

  async function exportVideo() {
    if (state.exportBusy) return;
    if (!state.room?.clip?.path) {
      status('Für den Videoexport muss der Clip zuerst in der Lobby gespeichert sein.', 'error');
      return;
    }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      status('Dein Browser unterstützt den Videoexport nicht. Die Dub-Fassung lässt sich trotzdem im Player abspielen.', 'error');
      return;
    }
    const candidate = mode() === 'parallel' ? (state.selectedCandidate || uid()) : 'character';
    const keyed = script().map(line => ({
      line,
      rec: recordings()[mode() === 'parallel' ? `parallel:${candidate}:${line.id}` : `character:${line.id}`]
    })).filter(item => item.rec?.path);
    if (!keyed.length) { status('Keine passenden Tonspuren zum Export vorhanden.', 'error'); return; }
    const missingLines = script().length - keyed.length;
    if (missingLines > 0) {
      status(`Das Video wird noch nicht exportiert: ${missingLines} Line(s) fehlen. Nehmt zuerst alle Dialogzeilen auf und speichert sie.`, 'error');
      return;
    }

    const video = $('dubVideo');
    let canvasStream = null;
    let destinationStream = null;
    let recorder = null;
    let raf = 0;
    let alive = false;
    const exportButton = $('dubExportVideo');
    const downloadButton = $('dubDownloadResult');
    state.exportBusy = true;
    if (exportButton) exportButton.disabled = true;
    if (downloadButton) { downloadButton.hidden = true; downloadButton.disabled = true; }
    if ($('dubResultPreviewWrap')) $('dubResultPreviewWrap').hidden = true;
    if ($('dubResultVideo')) { $('dubResultVideo').pause(); $('dubResultVideo').removeAttribute('src'); $('dubResultVideo').load(); }
    if ($('dubExportStatus')) $('dubExportStatus').textContent = 'Video wird vorbereitet … bitte diese Seite geöffnet lassen.';

    try {
      await waitForVideoData(video);
      const decoded = await Promise.all(keyed.map(async item => ({
        ...item,
        buffer: await loadAudioBuffer(item.rec.path)
      })));
      const sourceWidth = video.videoWidth || 1280;
      const sourceHeight = video.videoHeight || 720;
      const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight), 720 / Math.min(sourceWidth, sourceHeight));
      const width = Math.max(2, Math.floor((sourceWidth * scale) / 2) * 2);
      const height = Math.max(2, Math.floor((sourceHeight * scale) / 2) * 2);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Der Browser konnte die Videofläche nicht erstellen.');
      canvasStream = canvas.captureStream(30);

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Dein Browser unterstützt die Audiomischung für den Videoexport nicht.');
      const context = state.audioContext || new AudioContextClass();
      state.audioContext = context;
      await context.resume();
      const destination = context.createMediaStreamDestination();
      destinationStream = destination.stream;
      const resultVideoForMime = $('dubResultVideo');
      const mime = chooseExportMime(video, resultVideoForMime);
      if (!mime) throw new Error('Dieser Browser kann weder MP4 noch WebM mit Ton exportieren. Öffne Schreibbot in Chrome oder einem aktuellen Desktop-Browser.');

      video.pause();
      video.muted = true;
      await seekVideoTo(video, 0);
      try {
        ctx.drawImage(video, 0, 0, width, height);
        ctx.getImageData(0, 0, 1, 1);
      } catch (canvasError) {
        throw new Error('Der Browser hat den Supabase-Videostream für Canvas nicht mit CORS freigegeben. Prüfe, ob der Clip mit crossorigin=anonymous neu geladen wurde und ob die Storage-Antwort Access-Control-Allow-Origin enthält. Die Vorschau kann trotzdem funktionieren.');
      }
      const exportStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destinationStream.getAudioTracks()
      ]);
      try { recorder = new MediaRecorder(exportStream, { mimeType: mime }); }
      catch (error) { throw new Error(`Der Browser kann das Exportformat ${mime} nicht erzeugen: ${error.message || error}`); }
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      const recorderStopped = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
        recorder.onerror = event => reject(event.error || new Error('Videoexport fehlgeschlagen.'));
      });
      recorder.start(250);
      alive = true;
      const paint = () => {
        if (!alive) return;
        try {
          ctx.fillStyle = '#111';
          ctx.fillRect(0, 0, width, height);
          if (video.readyState >= 2) ctx.drawImage(video, 0, 0, width, height);
        } catch (error) {
          console.warn('Videobild konnte nicht gezeichnet werden', error);
        }
        raf = requestAnimationFrame(paint);
      };
      paint();

      // Start the video first. The dub timeline is scheduled only after the
      // browser confirms playback, avoiding a small but noticeable startup drift.
      await video.play();
      const startAt = context.currentTime + 0.10;
      // The original soundtrack is never added to the export. Only the recorded
      // player lines are mixed in at their detected timestamps. A tiny safe tail
      // preserves the last syllable without colliding with the next line.
      decoded.forEach(item => {
        const source = context.createBufferSource();
        source.buffer = item.buffer;
        const output = context.createGain();
        effectNodes(context, source, EFFECTS.includes(item.rec.effect) ? item.rec.effect : 'original', output);
        output.connect(destination);
        const rate = item.rec.effect === 'chipmunk' ? 1.25 : item.rec.effect === 'monster' ? 0.82 : 1;
        const cap = dubbedLineBounds(item.line).duration;
        source.start(startAt + Math.max(0, Number(item.line.start_sec) || 0), 0, Math.min(item.buffer.duration, cap * rate));
      });
      const audioEnd = decoded.reduce((maximum, item) => {
        const rate = item.rec.effect === 'chipmunk' ? 1.25 : item.rec.effect === 'monster' ? 0.82 : 1;
        return Math.max(maximum, (Number(item.line.start_sec) || 0) + Math.min(dubbedLineBounds(item.line).duration, item.buffer.duration / rate));
      }, 0);
      const videoDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if ($('dubExportStatus')) $('dubExportStatus').textContent = 'Video wird zusammengesetzt … Originalton stumm · eure neuen Lines laufen an den Zeitpunkten. Der Export wartet auf das tatsächliche Videoende.';
      await waitForVideoExportEnd(video, Math.max(videoDuration, audioEnd));
      // Preserve a short audio tail (for example an echo or a final syllable)
      // after the last scheduled Line before stopping the MediaRecorder.
      const effectTailMs = decoded.some(item => item.rec.effect === 'echo') ? 1500 : 350;
      const audioTailMs = Math.max(effectTailMs, Math.ceil((audioEnd - videoDuration) * 1000) + effectTailMs);
      await new Promise(resolve => setTimeout(resolve, audioTailMs));
      alive = false;
      cancelAnimationFrame(raf);
      if (recorder.state === 'recording') recorder.stop();
      const blob = await recorderStopped;
      if (!blob.size) throw new Error('Der Browser hat eine leere Videodatei erstellt.');
      if (state.exportObjectUrl) URL.revokeObjectURL(state.exportObjectUrl);
      state.exportObjectUrl = URL.createObjectURL(blob);
      const resultPreview = $('dubResultPreviewWrap');
      const resultVideo = $('dubResultVideo');
      let previewAvailable = false;
      if (resultVideo && resultPreview) {
        resultVideo.pause();
        resultVideo.src = state.exportObjectUrl;
        resultVideo.load();
        resultPreview.hidden = false;
        previewAvailable = await waitForExportPreview(resultVideo);
      }
      const actualMime = blob.type || mime;
      const extension = actualMime.includes('mp4') ? 'mp4' : 'webm';
      state.exportFilename = `dub-${state.room.code.toLowerCase()}-${Date.now()}.${extension}`;
      state.exportAttribution = String(state.room.clip?.attribution || '');
      if (downloadButton) {
        downloadButton.hidden = false;
        downloadButton.disabled = false;
        downloadButton.textContent = `⬇ Fertiges Video herunterladen (${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB)`;
      }
      const creditsButton = $('dubDownloadCredits');
      if (creditsButton) creditsButton.hidden = !state.exportAttribution;
      if ($('dubExportStatus')) $('dubExportStatus').textContent = `Fertiges Video erstellt (${extension.toUpperCase()}) · ${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB. ${previewAvailable ? 'Du kannst es oben direkt ansehen.' : 'Die Datei ist fertig; die Vorschau wird von diesem Browser möglicherweise nicht unterstützt. Du kannst sie trotzdem herunterladen.'} Tippe auf „Fertiges Video herunterladen“.`;
      status(previewAvailable ? 'Eure gemeinsame Dub-Fassung wurde erstellt und kann direkt im Browser angesehen werden.' : 'Eure Dub-Datei wurde erstellt. Die lokale Vorschau wird von diesem Browser nicht unterstützt; lade die Datei herunter und öffne sie in einem Videoplayer.', 'success');
    } catch (error) {
      alive = false;
      cancelAnimationFrame(raf);
      if (recorder?.state === 'recording') {
        try { recorder.stop(); } catch { /* ignore cleanup error */ }
      }
      const message = error?.message || 'Unbekannter Videoexport-Fehler.';
      if ($('dubExportStatus')) $('dubExportStatus').textContent = `Export nicht möglich: ${message}`;
      status(`Videoexport fehlgeschlagen: ${message}`, 'error');
    } finally {
      state.exportBusy = false;
      if (exportButton) exportButton.disabled = false;
      if (video) { video.pause(); video.muted = !$('dubOriginalAudio')?.checked; }
      canvasStream?.getTracks().forEach(track => track.stop());
      destinationStream?.getTracks().forEach(track => track.stop());
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
      const cleanRoles = data.roles.slice(0, 12).map((r, i) => ({ id: String(r.id || `speaker-${i + 1}`).slice(0, 40), name: String(r.name || `Sprecher ${String.fromCharCode(65 + i)}`).slice(0, 30) }));
      const cleanScript = data.script.map((line, i) => ({ id: String(line.id || `line-${i + 1}`).slice(0, 40), role: cleanRoles.some(r => r.id === line.role) ? line.role : cleanRoles[0].id, text: String(line.text || '').slice(0, 240), start_sec: Math.max(0, Math.min(600, Number(line.start_sec) || 0)) })).filter(line => line.text.trim());
      if (!cleanScript.length) throw new Error('Das Pack enthält keine Dialogzeilen.');
      const clip = { ...(state.room.clip || {}), title: String(data.title || 'Importiertes Dub-Pack').slice(0, 80), roles: cleanRoles };
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: clip, p_script: cleanScript });
      await refreshRoom(false); status('Pack importiert. Wenn es einen Videoclip braucht, ladet die passende Datei mit geklärten Rechten hoch.', 'success');
    } catch (error) { status(`Pack konnte nicht importiert werden: ${error.message}`, 'error'); }
    finally { $('dubImportPack').value = ''; }
  }

  function renderCommunityPacks() {
    const box = $('dubPublicPackList'); if (!box) return;
    const query = String($('dubPublicPackSearch')?.value || '').trim().toLowerCase();
    const rows = (state.communityPacks || []).filter(item => !query || `${item.title || ''} ${item.description || ''} ${item.author_name || ''}`.toLowerCase().includes(query));
    box.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'dubEmpty'; empty.textContent = query ? 'Keine passenden Packs gefunden.' : 'Noch keine Community-Packs geladen.'; box.append(empty); return;
    }
    rows.forEach(item => {
      const card = document.createElement('article'); card.className = 'dubCommunityCard';
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = item.title || 'Unbenanntes Pack';
      const meta = document.createElement('small');
      const date = item.created_at ? new Date(item.created_at).toLocaleDateString('de-DE') : '';
      const roleCount = Array.isArray(item.pack?.roles) ? item.pack.roles.length : 0;
      const lineCount = Array.isArray(item.pack?.script) ? item.pack.script.length : 0;
      meta.textContent = `Von ${safeName(item.author_name)} · ${roleCount} Rollen · ${lineCount} Zeilen${date ? ` · ${date}` : ''}`;
      const desc = document.createElement('p'); desc.textContent = item.description || 'Keine Beschreibung.';
      info.append(title, meta, desc);
      const actions = document.createElement('div'); actions.className = 'dubCommunityCardActions';
      const load = document.createElement('button'); load.type = 'button'; load.className = 'secondary'; load.textContent = 'In Lobby laden'; load.disabled = !(state.room && isHost() && state.room.status === 'waiting'); load.addEventListener('click', () => useCommunityPack(item));
      const report = document.createElement('button'); report.type = 'button'; report.className = 'ghost'; report.textContent = 'Melden'; report.addEventListener('click', () => reportCommunityPack(item));
      const download = document.createElement('button'); download.type = 'button'; download.className = 'ghost'; download.textContent = 'JSON speichern'; download.addEventListener('click', () => downloadPackObject(item.pack || {}, item.title || 'dub-pack'));
      actions.append(load, download, report); card.append(info, actions); box.append(card);
    });
  }

  async function refreshCommunityPacks() {
    const box = $('dubPublicPackList');
    if (box) box.innerHTML = '<div class="dubEmpty">Community-Packs werden geladen …</div>';
    try {
      const rows = await deps.api('dub_public_packs?select=id,title,description,author_name,pack,created_at&is_public=eq.true&order=created_at.desc&limit=100');
      state.communityPacks = Array.isArray(rows) ? rows : [];
      renderCommunityPacks();
      $('dubPublicPackStatus').textContent = `${state.communityPacks.length} Text-Packs geladen. Sie enthalten nur Rollennamen, Dialogtexte und Zeitmarken – keine Videos und keine Tonspuren.`;
    } catch (error) {
      state.communityPacks = [];
      if (box) box.innerHTML = '<div class="dubEmpty">Die Bibliothek ist noch nicht eingerichtet. Führe supabase_dub_together_v95_addons.sql aus.</div>';
      $('dubPublicPackStatus').textContent = deps?.friendlyError?.(error) || error.message;
    }
  }

  function downloadPackObject(pack, filename) {
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `${String(filename || 'dub-pack').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function publishCommunityPack() {
    if (!state.room || !isHost() || state.room.status !== 'waiting') { $('dubPublicPackStatus').textContent = 'Nur der Host kann ein Pack aus einer offenen Lobby veröffentlichen.'; return; }
    if (!$('dubPublicPackRights').checked) { $('dubPublicPackStatus').textContent = 'Bitte bestätige, dass du die Texte und Rollennamen teilen darfst.'; return; }
    const title = String($('dubPublicPackTitle').value || state.room.clip?.title || 'Eigenes Dub-Pack').trim().slice(0, 80);
    const description = String($('dubPublicPackDescription').value || '').trim().slice(0, 280);
    const cleanRoles = roles().slice(0, 12).map(role => ({ id: String(role.id).slice(0, 40), name: String(role.name || 'Figur ohne Namen').slice(0, 30) }));
    const validRoleIds = new Set(cleanRoles.map(role => role.id));
    const cleanScript = script().slice(0, 60).map((line, index) => ({ id: String(line.id || `line-${index + 1}`).slice(0, 40), role: validRoleIds.has(line.role) ? line.role : cleanRoles[0]?.id, text: String(line.text || '').trim().slice(0, 240), start_sec: Math.max(0, Math.min(600, Number(line.start_sec) || 0)) })).filter(line => line.text);
    if (!title || !cleanRoles.length || !cleanScript.length) { $('dubPublicPackStatus').textContent = 'Pack-Titel, mindestens eine Rolle und eine Dialogzeile sind erforderlich.'; return; }
    const payload = { format: 'dub-together-text-pack-v1', title, roles: cleanRoles, script: cleanScript };
    if (new Blob([JSON.stringify(payload)]).size > 32000) { $('dubPublicPackStatus').textContent = 'Dieses Pack ist zu groß. Kürze Beschreibung oder Dialoge.'; return; }
    try {
      $('dubPublicPackPublish').disabled = true;
      const session = await deps.getSession();
      const response = await deps.api('dub_public_packs', { method: 'POST', prefer: 'return=representation', body: {
        author_id: session.user.id, author_name: safeName(myPlayer()?.name || 'Creator'), title, description,
        pack: payload, is_public: true
      } });
      $('dubPublicPackStatus').textContent = 'Pack veröffentlicht. Es enthält nur Rollennamen und Dialogtexte.';
      await refreshCommunityPacks();
      return response;
    } catch (error) {
      $('dubPublicPackStatus').textContent = `Veröffentlichen fehlgeschlagen: ${deps?.friendlyError?.(error) || error.message}. Prüfe, ob supabase_dub_together_v95_addons.sql ausgeführt wurde.`;
    } finally { $('dubPublicPackPublish').disabled = false; }
  }

  async function useCommunityPack(item) {
    if (!state.room || !isHost() || state.room.status !== 'waiting') return;
    const pack = item?.pack || {};
    if (!Array.isArray(pack.roles) || !Array.isArray(pack.script)) { $('dubPublicPackStatus').textContent = 'Dieses Pack hat ein ungültiges Format.'; return; }
    const cleanRoles = pack.roles.slice(0, 12).map((role, index) => ({ id: String(role.id || `speaker-${String.fromCharCode(97 + index)}`).slice(0, 40), name: String(role.name || `Name nicht erkannt · Stimme ${String.fromCharCode(65 + index)}`).slice(0, 30) }));
    if (!cleanRoles.length) { $('dubPublicPackStatus').textContent = 'Das Pack enthält keine Rollen.'; return; }
    const ids = new Set(cleanRoles.map(role => role.id));
    const cleanScript = pack.script.slice(0, 60).map((line, index) => ({ id: String(line.id || `line-${index + 1}`).slice(0, 40), role: ids.has(line.role) ? line.role : cleanRoles[0].id, text: String(line.text || '').trim().slice(0, 240), start_sec: Math.max(0, Math.min(600, Number(line.start_sec) || 0)) })).filter(line => line.text);
    if (!cleanScript.length) { $('dubPublicPackStatus').textContent = 'Das Pack enthält keine nutzbaren Dialogzeilen.'; return; }
    try {
      await apiRpc('set_dub_clip', { p_code: state.room.code, p_clip: { ...(state.room.clip || {}), title: String(item.title || pack.title || 'Community-Pack').slice(0, 80), source: 'Dub Together Community Pack', roles: cleanRoles }, p_script: cleanScript });
      state.editorDirty = false; await refreshRoom(false);
      $('dubPublicPackStatus').textContent = `„${item.title}“ wurde in eure Lobby geladen. Wähle nun den passenden Videoclip separat aus.`;
    } catch (error) { $('dubPublicPackStatus').textContent = `Pack konnte nicht geladen werden: ${error.message}`; }
  }

  async function reportCommunityPack(item) {
    try {
      const session = await deps.getSession();
      await deps.api('dub_public_pack_reports', { method: 'POST', body: { pack_id: item.id, reporter_id: session.user.id, reason: 'Prüfung durch Moderation angefragt' } });
      $('dubPublicPackStatus').textContent = 'Danke. Deine Meldung wurde an die Datenbank übermittelt.';
    } catch (error) { $('dubPublicPackStatus').textContent = `Meldung nicht möglich: ${error.message}`; }
  }

  function twitchStatus(message, connected = false, error = false) {
    const el = $('dubTwitchStatus'); if (el) { el.textContent = message; el.classList.toggle('error', error); }
    const stateLabel = $('dubTwitchConnectionState'); if (stateLabel) stateLabel.textContent = connected ? '● Verbunden' : 'Nicht verbunden';
    if ($('dubTwitchConnect')) $('dubTwitchConnect').disabled = connected;
    if ($('dubTwitchDisconnect')) $('dubTwitchDisconnect').disabled = !connected;
  }

  function renderTwitchPanel() {
    const panel = $('dubTwitchPanel');
    if (!panel) return;
    const visible = Boolean(state.room && isHost() && mode() === 'parallel' && ['reveal', 'finished'].includes(state.room.status));
    panel.hidden = !visible;
    if (visible) {
      twitchStatus(state.twitch.connected ? `Verbunden mit dem Twitch-Chat von ${state.twitch.channel}. Zuschauer stimmen mit !vote 1, !vote 2 usw. ab.` : 'Verbindung getrennt. Melde dich mit dem Twitch-Konto des Kanals an, dessen Chat abstimmen soll.', state.twitch.connected);
    }
  }

  function randomState() {
    const bytes = new Uint8Array(24);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function handleTwitchOAuthPopup() {
    const url = new URL(location.href);
    if (url.searchParams.get('dub_twitch_callback') !== '1') return false;
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const message = {
      type: 'dub-twitch-oauth-result', state: params.get('state') || '',
      token: params.get('access_token') || '',
      error: params.get('error_description') || params.get('error') || ''
    };
    // OAuth implicit-flow tokens arrive in the URL fragment. Remove the fragment
    // before doing anything else so it is not left in browser history/address bar.
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch {}
    try { window.opener?.postMessage(message, location.origin); } catch {}
    document.body.innerHTML = '<main style="font:16px system-ui;padding:32px;text-align:center">Twitch-Verbindung wird an Dub Together zurückgegeben. Dieses Fenster kann geschlossen werden.</main>';
    setTimeout(() => window.close(), 250);
    return true;
  }

  function handleTwitchOAuthMessage(event) {
    if (event.origin !== location.origin || event.data?.type !== 'dub-twitch-oauth-result') return;
    if (!state.twitch.oauthState || event.data.state !== state.twitch.oauthState) { twitchStatus('Twitch-Anmeldung abgebrochen oder ungültig. Starte die Verbindung erneut.', false, true); return; }
    state.twitch.oauthState = null;
    if (!event.data.token) { twitchStatus(`Twitch-Anmeldung fehlgeschlagen: ${event.data.error || 'Keine Freigabe erhalten.'}`, false, true); return; }
    state.twitch.token = event.data.token;
    connectTwitchEventSub().catch(error => { disconnectTwitch(false); twitchStatus(`Twitch konnte nicht verbunden werden: ${error.message}`, false, true); });
  }

  function beginTwitchConnect() {
    if (!state.room || !isHost() || mode() !== 'parallel' || !['reveal', 'finished'].includes(state.room.status)) { twitchStatus('Twitch-Abstimmung ist nur für den Host im Parallel-Modus verfügbar.', false, true); return; }
    const clientId = String($('dubTwitchClientId').value || '').trim();
    const channel = String($('dubTwitchChannel').value || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-zA-Z0-9]{10,80}$/.test(clientId)) { twitchStatus('Bitte trage eine gültige Twitch Client-ID ein.', false, true); return; }
    if (!/^[a-z0-9_]{1,25}$/.test(channel)) { twitchStatus('Bitte trage einen gültigen Twitch-Kanalnamen ein.', false, true); return; }
    state.twitch.clientId = clientId; state.twitch.channel = channel; state.twitch.oauthState = randomState();
    localStorage.setItem('dub_twitch_client_id', clientId); localStorage.setItem('dub_twitch_channel', channel);
    const redirect = new URL(location.href); redirect.search = ''; redirect.hash = ''; redirect.searchParams.set('dub_twitch_callback', '1');
    const auth = new URL('https://id.twitch.tv/oauth2/authorize');
    auth.searchParams.set('response_type', 'token'); auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', redirect.toString()); auth.searchParams.set('scope', 'user:read:chat'); auth.searchParams.set('state', state.twitch.oauthState);
    const popup = window.open(auth.toString(), 'dub-together-twitch-auth', 'popup=yes,width=560,height=720');
    if (!popup) { state.twitch.oauthState = null; twitchStatus('Das Twitch-Anmeldefenster wurde blockiert. Erlaube für diese Website Pop-ups und versuche es erneut.', false, true); return; }
    twitchStatus('Twitch-Anmeldung geöffnet. Bestätige die Leseberechtigung im Pop-up …');
  }

  async function twitchApi(path, { method = 'GET', body = null } = {}) {
    const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
      method,
      headers: { 'Client-Id': state.twitch.clientId, Authorization: `Bearer ${state.twitch.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Twitch API antwortete mit HTTP ${response.status}`);
    return data;
  }

  async function connectTwitchEventSub() {
    twitchStatus('Prüfe Twitch-Konto und öffne den Chat-Kanal …');
    const [selfData, channelData] = await Promise.all([twitchApi('users'), twitchApi(`users?login=${encodeURIComponent(state.twitch.channel)}`)]);
    const self = selfData.data?.[0], channel = channelData.data?.[0];
    if (!self || !channel) throw new Error('Twitch-Konto oder Kanal wurde nicht gefunden.');
    if (self.id !== channel.id) throw new Error('Melde dich im Twitch-Pop-up mit dem Konto des Kanals an. Die Verbindung liest nur den Chat dieses Kontos.');
    state.twitch.userId = self.id; state.twitch.broadcasterId = channel.id;
    const socket = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
    attachTwitchSocket(socket, false, null);
  }

  function attachTwitchSocket(socket, isReconnect, previousSocket) {
    state.twitch.socket = socket;
    socket.onmessage = async event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const type = message.metadata?.message_type;
      if (type === 'session_welcome') {
        try {
          const sessionId = message.payload?.session?.id;
          if (!sessionId) throw new Error('Twitch hat keine EventSub-Sitzung zurückgegeben.');
          // Subscriptions transfer to the reconnecting session; only the first
          // connection needs to create the chat-message subscription.
          if (!isReconnect) {
            await twitchApi('eventsub/subscriptions', { method: 'POST', body: {
              type: 'channel.chat.message', version: '1',
              condition: { broadcaster_user_id: state.twitch.broadcasterId, user_id: state.twitch.userId },
              transport: { method: 'websocket', session_id: sessionId }
            } });
          }
          state.twitch.connected = true;
          if (previousSocket) { try { previousSocket.close(1000, 'EventSub session transferred'); } catch {} }
          twitchStatus(`Verbunden mit ${state.twitch.channel}. Zuschauer können mit !vote 1, !vote 2 usw. abstimmen.`, true);
        } catch (error) { disconnectTwitch(false); twitchStatus(`Twitch-Chat-Abonnement fehlgeschlagen: ${error.message}`, false, true); }
      } else if (type === 'notification' && message.payload?.subscription?.type === 'channel.chat.message') {
        const chatEvent = message.payload?.event || {};
        handleTwitchVote(chatEvent).catch(error => console.warn('Twitch-Stimme konnte nicht gespeichert werden', error));
      } else if (type === 'session_reconnect') {
        const reconnectUrl = message.payload?.session?.reconnect_url;
        if (!reconnectUrl) { twitchStatus('Twitch hat keine Wiederverbindungsadresse gesendet.', false, true); return; }
        twitchStatus('Twitch stellt die Chat-Verbindung wieder her …');
        try {
          const nextSocket = new WebSocket(reconnectUrl);
          attachTwitchSocket(nextSocket, true, socket);
        } catch (error) { twitchStatus(`Wiederverbindung fehlgeschlagen: ${error.message}`, false, true); }
      } else if (type === 'revocation') {
        disconnectTwitch(false); twitchStatus('Twitch hat die Chat-Berechtigung beendet. Verbinde den Kanal erneut.', false, true);
      }
    };
    socket.onerror = () => { if (state.twitch.socket === socket) twitchStatus('Twitch-WebSocket-Verbindung fehlgeschlagen. Prüfe Netzwerk und Browser.', false, true); };
    socket.onclose = () => {
      if (state.twitch.socket === socket && state.twitch.connected) {
        state.twitch.connected = false;
        twitchStatus('Twitch-Chat getrennt. Verbinde erneut, um weiter abzustimmen.', false, true);
      }
    };
  }

  async function handleTwitchVote(chatEvent) {
    if (!state.room || !isHost() || mode() !== 'parallel' || !['reveal', 'finished'].includes(state.room.status)) return;
    const message = String(chatEvent.message?.text || '').trim();
    const match = message.match(/^!vote\s+([1-9]\d?)$/i) || message.match(/^([1-9]\d?)$/);
    if (!match) return;
    const candidates = players().filter(player => state.room.submissions?.[player.id]);
    const index = Number(match[1]) - 1;
    const candidate = candidates[index];
    if (!candidate) return;
    const viewer = String(chatEvent.chatter_user_login || chatEvent.chatter_user_name || '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(viewer)) return;
    await apiRpc('vote_dub_from_twitch', { p_code: state.room.code, p_viewer_login: viewer, p_candidate_id: candidate.id });
    await refreshRoom(false);
    twitchStatus(`Twitch-Stimme von @${viewer} für Version ${index + 1} (${candidate.name}) gezählt.`, true);
  }

  function disconnectTwitch(showMessage = true) {
    const socket = state.twitch.socket;
    state.twitch.socket = null; state.twitch.connected = false; state.twitch.token = ''; state.twitch.userId = ''; state.twitch.broadcasterId = '';
    try { socket?.close(1000, 'Dub Together disconnected'); } catch {}
    if (showMessage) twitchStatus('Twitch-Verbindung getrennt. Das Zugriffstoken wurde aus dem Arbeitsspeicher entfernt.');
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
    if (state.recordingTimer) { clearTimeout(state.recordingTimer); state.recordingTimer = null; }
    if (state.recordingFrame) { cancelAnimationFrame(state.recordingFrame); state.recordingFrame = 0; }
    if (state.playbackFrame) { cancelAnimationFrame(state.playbackFrame); state.playbackFrame = 0; }
    if (state.playbackTimer) { clearTimeout(state.playbackTimer); state.playbackTimer = null; }
    stopPolling();
    disconnectTwitch(false);
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
        ? [state.room.clip?.path, state.room.clip?.original_path, state.room.clip?.playback_path, state.room.clip?.audio_stems?.vocals_path, state.room.clip?.audio_stems?.accompaniment_path, ...allRecordings.map(item => item.path)]
        : allRecordings.filter(item => item.owner_id === uid()).map(item => item.path);
      try { await removeStoragePaths(mediaPaths); }
      catch (error) { mediaCleanupFailed = true; console.warn('Mediendateien konnten nicht vollständig entfernt werden:', error); }
      try { await apiRpc('leave_dub_room', { p_code: state.room.code }); }
      catch (error) { membershipCleanupFailed = true; console.warn('Lobby konnte nicht vollständig verlassen werden', error); }
    }
    state.room = null; state.editorDirty = false; state.mode = 'character'; state.sourceClipFile = null; state.selectedFile = null; state.signedClipPath = ''; state.signedClipUrl = ''; state.signingClipPath = ''; state.selectedCandidate = null;
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    if (state.localClipPreviewUrl) URL.revokeObjectURL(state.localClipPreviewUrl);
    if (state.exportObjectUrl) URL.revokeObjectURL(state.exportObjectUrl);
    state.localClipPreviewUrl = ''; state.templatePreviewUrl = ''; state.previewRemoteFailed = false;
    state.exportObjectUrl = ''; state.exportFilename = '';
    state.signedClipUrl = ''; state.signedClipPath = ''; state.signedClipExpiresAt = 0; state.signingClipPath = '';
    $('dubSetup').hidden = false; $('dubLobby').hidden = true; $('dubRecordingPanel').hidden = true; $('dubResultsPanel').hidden = true;
    const video = $('dubVideo'); if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    const leaveMessage = mediaCleanupFailed ? 'Du hast die Lobby lokal verlassen. Einige private Mediendateien konnten nicht entfernt werden; bitte den Betreiber um eine Löschprüfung.' : membershipCleanupFailed ? 'Die Lobby konnte serverseitig nicht vollständig verlassen werden. Prüfe deine Verbindung und lade die Seite neu.' : 'Du hast die Dub-Lobby verlassen und die zugehörigen Mediendateien wurden zur Löschung übermittelt.';
    status(leaveMessage, mediaCleanupFailed || membershipCleanupFailed ? 'error' : 'success');
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
    $('dubClipFile').addEventListener('change', async event => {
      state.selectedFile = event.target.files?.[0] || null;
      state.sourceClipFile = state.selectedFile;
      state.selectedSource = null;
      state.templatePreviewUrl = '';
      state.previewRemoteFailed = false;
      $('dubImportTemplateButton').hidden = true;
      if (state.localClipPreviewUrl) URL.revokeObjectURL(state.localClipPreviewUrl);
      const previewMime = videoMimeFromFile(state.selectedFile) || (state.selectedFile ? await sniffVideoMime(state.selectedFile) : '');
      // Always wrap the selected file with the normalized MIME type. Do not
      // trust generic Android picker values such as application/octet-stream.
      const previewBlob = state.selectedFile
        ? new Blob([state.selectedFile], { type: previewMime || 'application/octet-stream' })
        : null;
      state.localClipPreviewUrl = previewBlob ? URL.createObjectURL(previewBlob) : '';
      if (state.selectedFile) {
        const selectedType = previewMime || 'unbekannter Videotyp';
        $('dubUploadProgress').textContent = `${state.selectedFile.name} erkannt · ${selectedType} · ${Math.ceil(state.selectedFile.size / 1024 / 1024)} MB. Die Originaldatei wird unverändert hochgeladen. GitHub erstellt danach eine kompatible Wiedergabe-MP4 für alle Mitspieler.`;
        $('dubUploadClipButton').hidden = false;
        $('dubPreviewHeading').textContent = state.selectedFile.name;
        $('dubPreviewStatus').textContent = 'Lokale Vorschau · noch nicht hochgeladen';
        renderInlinePreview();
        const chosenFile = state.selectedFile;
        state.videoInfo = null;
        inspectVideoFile(chosenFile).then(info => {
          if (state.selectedFile !== chosenFile) return;
          state.videoInfo = { ...info, label: videoCodecLabel(info) };
          const verdict = describeVideoInspection(state.videoInfo, chosenFile.name);
          $('dubUploadProgress').textContent = verdict.text;
          if (verdict.blocking) { $('dubUploadClipButton').hidden = true; status(verdict.text, 'error'); }
        });
      } else {
        renderInlinePreview();
        $('dubUploadClipButton').hidden = true;
      }
    });
    $('dubRightsCheck').addEventListener('change', event => { if (event.target.checked) $('dubUploadProgress').textContent = 'Rechtebestätigung gesetzt. Klicke auf „Clip hochladen“, um fortzufahren.'; });
    $('dubUploadClipButton').addEventListener('click', uploadClip);
    $('dubOptimizeVideoButton')?.addEventListener('click', optimizeSelectedVideoForPlayback);
    $('dubImportTemplateButton')?.addEventListener('click', importSelectedTemplate);
    $('dubVideo')?.addEventListener('error', handlePreviewVideoError);
    $('dubVideo')?.addEventListener('play', () => {
      const video = $('dubVideo');
      if (!state.room || !isHost() || state.playbackSyncApplying || video?.muted) return;
      // Native Play from the host also shares the start automatically. Dubbed
      // previews/export are muted and therefore do not generate a new command.
      publishHostPlaybackCommand(video.currentTime, false, false).catch(error => {
        status(`Wiedergabe läuft lokal, konnte aber nicht an die Lobby gesendet werden: ${error.message || error}`, 'error');
      });
    });
    $('dubVideo')?.addEventListener('canplay', () => {
      const video = $('dubVideo');
      if (video?.dataset?.dubSourceKind === 'storage') {
        if (state.localClipPreviewUrl && !state.selectedFile) {
          URL.revokeObjectURL(state.localClipPreviewUrl);
          state.localClipPreviewUrl = '';
        }
        state.templatePreviewUrl = '';
        state.previewRemoteFailed = false;
      }
      if ($('dubNoVideo')) $('dubNoVideo').hidden = true;
      video.muted = !$('dubOriginalAudio')?.checked;
      if ($('dubPreviewStatus') && !state.analysisBusy) $('dubPreviewStatus').textContent = 'Clip bereit · abspielbar';
      if (state.room?.status === 'recording') renderRecordingStudio();
    });
    $('dubAddRole').addEventListener('click', addRole);
    $('dubAddLine').addEventListener('click', addLine);
    $('dubSaveScript').addEventListener('click', saveScript);
    $('dubStartRound').addEventListener('click', startRound);
    $('dubGoSetup').addEventListener('click', () => setWorkflowStep('setup'));
    $('dubBackClip').addEventListener('click', () => setWorkflowStep('clip'));
    $('dubNextRound').addEventListener('click', startNextRound);
    $('dubRecordButton').addEventListener('click', startRecording);
    $('dubStopButton').addEventListener('click', stopRecording);
    $('dubPrevLine').addEventListener('click', () => { stopCurrentPreview(); state.lineIndex = Math.max(0, state.lineIndex - 1); renderRecordingStudio(); });
    $('dubNextLine').addEventListener('click', () => { stopCurrentPreview(); state.lineIndex = Math.min(recordingLines().length - 1, state.lineIndex + 1); renderRecordingStudio(); });
    $('dubPlayLine').addEventListener('click', playClipAtLine);
    $('dubStartVideoForAll')?.addEventListener('click', startVideoForEveryone);
    $('dubPlayOriginalFull')?.addEventListener('click', playOriginalFullVideo);
    $('dubPreviewDubLine').addEventListener('click', playDubLinePreview);
    $('dubRecordPlayOriginalLine')?.addEventListener('click', playClipAtLine);
    $('dubRecordPlayOwnLine')?.addEventListener('click', playDubLinePreview);
    $('dubPreviewAllDubs')?.addEventListener('click', () => playVersion(mode() === 'parallel' ? uid() : 'character'));
    $('dubAnalyzeClip').addEventListener('click', () => startClipAnalysis(state.room?.clip?.analysis?.status === 'completed'));
    $('dubOriginalAudio').addEventListener('change', event => { const video = $('dubVideo'); if (video) video.muted = !event.target.checked; });
    $('dubFinishVersion').addEventListener('click', finishVersion);
    $('dubFinishRound').addEventListener('click', finishRound);
    $('dubReplaySelected').addEventListener('click', () => playVersion(state.selectedCandidate || (mode() === 'parallel' ? uid() : 'character')));
    $('dubExportVideo').addEventListener('click', exportVideo);
    $('dubDownloadResult')?.addEventListener('click', () => {
      if (!state.exportObjectUrl || !state.exportFilename) return;
      const anchor = document.createElement('a'); anchor.href = state.exportObjectUrl; anchor.download = state.exportFilename;
      document.body.append(anchor); anchor.click(); anchor.remove();
    });
    $('dubDownloadCredits')?.addEventListener('click', () => {
      if (!state.exportAttribution) return;
      const blob = new Blob([state.exportAttribution + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'dub-clip-quellenangabe.txt';
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
    $('dubAutoAssignRoles')?.addEventListener('click', () => autoAssignRoles(true));
    $('dubStreamerMode').addEventListener('change', event => $('dubLobby').classList.toggle('streamer-mode', event.target.checked));
    $('dubClosePublicRoom')?.addEventListener('click', () => state.room?.code && closePublicRoom(state.room.code));
    $('dubCopyCode').addEventListener('click', copyCode);
    $('dubShareRoom').addEventListener('click', shareRoom);
    $('dubLeaveRoom').addEventListener('click', leaveRoom);
    $('dubExportPack').addEventListener('click', exportPack);
    $('dubImportPack').addEventListener('change', event => importPack(event.target.files?.[0]));
    $('dubPublicPackPublish').addEventListener('click', publishCommunityPack);
    $('dubPublicPackRefresh').addEventListener('click', refreshCommunityPacks);
    $('dubPublicPackSearch').addEventListener('input', renderCommunityPacks);
    $('dubTwitchConnect').addEventListener('click', beginTwitchConnect);
    $('dubTwitchDisconnect').addEventListener('click', () => disconnectTwitch(true));
    $('dubTwitchClientId').value = localStorage.getItem('dub_twitch_client_id') || '';
    $('dubTwitchChannel').value = localStorage.getItem('dub_twitch_channel') || '';
    state.twitch.clientId = $('dubTwitchClientId').value.trim();
    state.twitch.channel = $('dubTwitchChannel').value.trim().toLowerCase();
    $('dubTwitchClientId').addEventListener('input', event => { state.twitch.clientId = event.target.value.trim(); });
    $('dubTwitchChannel').addEventListener('input', event => { state.twitch.channel = event.target.value.trim().toLowerCase(); });
    $('dubTwitchClientId').addEventListener('change', event => localStorage.setItem('dub_twitch_client_id', event.target.value.trim()));
    $('dubTwitchChannel').addEventListener('change', event => localStorage.setItem('dub_twitch_channel', event.target.value.trim().toLowerCase()));
    window.addEventListener('message', handleTwitchOAuthMessage);
    if (deps?.onOpen) {
      $('launchGameDub').addEventListener('click', () => deps.onOpen());
      $('gameTabDub').addEventListener('click', () => deps.onOpen());
      $('dubDrawerButton')?.addEventListener('click', () => deps.onOpen());
    }
  }

  function init(dependencies) {
    deps = dependencies;
    if (handleTwitchOAuthPopup()) return;
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
    // Load the public text-pack catalogue whenever Dub Together is opened.
    refreshCommunityPacks();
  }
  window.DubTogether = { init, openPanel, isInRoom, refreshPublicRooms, refreshCommunityPacks, leaveRoom };
})();
