// Secure dispatcher: validates the signed-in Dub Together host and starts a
// GitHub Actions runner. The function never downloads or handles video bytes.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function readDefaultKey(envName: string): string {
  const raw = Deno.env.get(envName);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.default === 'string') return parsed.default;
  } catch {
    // Legacy anon/service_role keys are plain strings rather than key maps.
  }
  return '';
}

function isSafeObjectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 500) return false;
  if (value.startsWith('/') || value.includes('..') || value.includes('\\')) return false;
  return /^[A-Z0-9]{6}\/clips\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(value);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Nur POST ist erlaubt.' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/+$/, '');
    const publishableKey = readDefaultKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const secretKey = readDefaultKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const githubToken = Deno.env.get('GITHUB_ACTIONS_TOKEN');
    const owner = Deno.env.get('GITHUB_OWNER');
    const repo = Deno.env.get('GITHUB_REPO');
    const ref = Deno.env.get('GITHUB_REF') || 'main';

    if (!supabaseUrl || !publishableKey || !secretKey || !githubToken || !owner || !repo) {
      return json(503, { error: 'Die Videoverarbeitung ist noch nicht vollständig eingerichtet. Prüfe die Supabase- und GitHub-Secrets.' });
    }

    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return json(401, { error: 'Anmeldung erforderlich.' });
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: authorization },
      cache: 'no-store'
    });
    if (!authResponse.ok) return json(401, { error: 'Deine Anmeldung ist ungültig oder abgelaufen. Bitte lade die Seite neu.' });
    const user = await authResponse.json();
    if (!user?.id) return json(401, { error: 'Die Spieler-ID konnte nicht geprüft werden.' });

    const body = await request.json().catch(() => ({}));
    const roomCode = String(body.room_code || '').toUpperCase();
    const originalPath = body.original_path;
    const playbackPath = body.playback_path;
    if (!/^[A-Z0-9]{6}$/.test(roomCode) || !isSafeObjectPath(originalPath) || !isSafeObjectPath(playbackPath)) {
      return json(400, { error: 'Lobby-Code oder Speicherpfad ist ungültig.' });
    }

    const originalParts = originalPath.split('/');
    const playbackParts = playbackPath.split('/');
    if (originalParts[0] !== roomCode || playbackParts[0] !== roomCode
      || originalParts[1] !== 'clips' || playbackParts[1] !== 'clips'
      || originalParts[2] !== user.id || playbackParts[2] !== user.id
      || !playbackParts[3].endsWith('.mp4') || playbackPath === originalPath) {
      return json(403, { error: 'Du darfst nur Videos aus deinem eigenen Lobby-Upload umwandeln.' });
    }

    // The secret key is used only server-side to inspect the private room row.
    // New sb_secret_* keys are sent on apikey only; legacy service_role JWTs
    // also need Authorization: Bearer.
    const roomHeaders: Record<string, string> = { apikey: secretKey };
    if (secretKey.startsWith('eyJ')) roomHeaders.Authorization = `Bearer ${secretKey}`;
    const roomResponse = await fetch(
      `${supabaseUrl}/rest/v1/dub_together_rooms?code=eq.${encodeURIComponent(roomCode)}&select=code,host_id,status,clip&limit=1`,
      { headers: roomHeaders, cache: 'no-store' }
    );
    if (!roomResponse.ok) return json(502, { error: `Die Lobby konnte auf dem Server nicht geprüft werden (HTTP ${roomResponse.status}).` });
    const rows = await roomResponse.json();
    const room = Array.isArray(rows) ? rows[0] : null;
    if (!room || room.host_id !== user.id || room.status !== 'waiting') {
      return json(403, { error: 'Nur der Host einer offenen Lobby darf die Videokonvertierung starten.' });
    }

    const clip = room.clip || {};
    if (clip.path !== originalPath || clip.original_path !== originalPath
      || clip.playback_path !== playbackPath || clip.playback_status !== 'preparing') {
      return json(409, { error: 'Der Clip wurde inzwischen geändert. Lade die Lobby neu und versuche es erneut.' });
    }

    const dispatchUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/dub-video-transcode.yml/dispatches`;
    const dispatchResponse = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref, inputs: { room_code: roomCode, original_path: originalPath, playback_path: playbackPath } })
    });

    if (dispatchResponse.status !== 204) {
      const detail = await dispatchResponse.text().catch(() => '');
      console.error('GitHub workflow dispatch failed:', dispatchResponse.status, detail.slice(0, 500));
      return json(502, { error: `GitHub konnte den Konvertierungsauftrag nicht starten (HTTP ${dispatchResponse.status}). Prüfe das Actions-Schreibrecht des Tokens und ob der Workflow auf „${ref}“ liegt.` });
    }

    return json(202, { status: 'queued', message: 'Die MP4 wurde zur Server-Konvertierung eingereiht.' });
  } catch (error) {
    console.error('dub-transcode-request error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Unbekannter Serverfehler.' });
  }
});
