// Dub Together media retention: permanently remove room media older than 7 days.
// IMPORTANT: deletion is performed through the Supabase Storage HTTP API, never
// by deleting rows from storage.objects (which would orphan physical objects).

const BUCKET = 'dub-media';
const RETENTION_DAYS = 7;
const PAGE_SIZE = 100;
const MAX_SCAN_PAGES_PER_FOLDER = 1000;
const MAX_DELETE_PER_RUN = 5000;
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function isAllowedMediaPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length >= 4
    && parts.length <= 6
    && ROOM_CODE_RE.test(parts[0])
    && (parts[1] === 'clips' || parts[1] === 'voices')
    && USER_ID_RE.test(parts[2])
    && parts.slice(3).every((part) => part.length > 0 && part !== '.' && part !== '..');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') return json(405, { error: 'Nur POST ist erlaubt.' });

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) {
    console.error('Cleanup-Konfiguration fehlt: SUPABASE_URL oder Server-Key.');
    return json(500, { error: 'Die serverseitige Supabase-Konfiguration fehlt.' });
  }

  // The scheduled GitHub workflow sends the existing server-only Supabase key
  // in the apikey header. No browser/client key can pass this check.
  const suppliedKey = request.headers.get('apikey') || '';
  if (!suppliedKey || suppliedKey !== serviceKey) {
    return json(401, { error: 'Nicht autorisiert.' });
  }

  let requestBody: Record<string, unknown> = {};
  try { requestBody = await request.json(); } catch { /* an empty body means real cleanup */ }
  const dryRun = requestBody.dry_run === true;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const headers: Record<string, string> = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
  };
  // Legacy service_role keys are JWTs and need an Authorization header.
  // New sb_secret_* keys are sent in apikey only.
  if (serviceKey.startsWith('eyJ')) headers.Authorization = `Bearer ${serviceKey}`;

  async function listFolder(prefix: string): Promise<Record<string, any>[]> {
    const all: Record<string, any>[] = [];
    for (let page = 0; page < MAX_SCAN_PAGES_PER_FOLDER; page++) {
      const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prefix,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          sortBy: { column: 'name', order: 'asc' },
        }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error(`Storage-Auflistung fehlgeschlagen (${response.status}) für ${prefix || '<Stammordner>'}: ${JSON.stringify(payload).slice(0, 400)}`);
      }
      all.push(...payload);
      if (payload.length < PAGE_SIZE) return all;
    }
    throw new Error(`Zu viele Einträge im Ordner ${prefix}; die Bereinigung wurde sicher abgebrochen.`);
  }

  try {
    const rootEntries = await listFolder('');
    const roomCodes = rootEntries
      .filter((entry) => entry && entry.id == null && ROOM_CODE_RE.test(String(entry.name || '')))
      .map((entry) => String(entry.name));

    const folders: string[] = [];
    for (const roomCode of roomCodes) {
      folders.push(`${roomCode}/clips`, `${roomCode}/voices`);
    }

    const filePaths: string[] = [];
    let scannedFiles = 0;
    while (folders.length) {
      const folder = folders.shift()!;
      const entries = await listFolder(folder);
      for (const entry of entries) {
        const name = String(entry?.name || '');
        if (!name || name.includes('/') || name === '.' || name === '..') continue;
        const fullPath = `${folder}/${name}`;
        if (entry.id == null) {
          // Only traverse the known room-code/clips-or-voices/user-id layout.
          const parts = fullPath.split('/');
          if (parts.length === 3 && ROOM_CODE_RE.test(parts[0])
              && (parts[1] === 'clips' || parts[1] === 'voices')
              && USER_ID_RE.test(parts[2])) {
            folders.push(fullPath);
          }
          continue;
        }

        if (!isAllowedMediaPath(fullPath)) continue;
        scannedFiles++;
        const stamp = Date.parse(String(entry.updated_at || entry.created_at || ''));
        if (!Number.isFinite(stamp) || stamp > cutoff) continue;
        filePaths.push(fullPath);
        if (filePaths.length >= MAX_DELETE_PER_RUN) break;
      }
      if (filePaths.length >= MAX_DELETE_PER_RUN) break;
    }

    if (dryRun || filePaths.length === 0) {
      return json(200, {
        ok: true,
        dry_run: dryRun,
        retention_days: RETENTION_DAYS,
        cutoff: new Date(cutoff).toISOString(),
        scanned_files: scannedFiles,
        eligible_files: filePaths.length,
        deleted_files: 0,
        message: dryRun ? 'Testlauf: Es wurden keine Dateien gelöscht.' : 'Keine abgelaufenen Lobby-Mediendateien gefunden.',
      });
    }

    let deletedFiles = 0;
    for (let i = 0; i < filePaths.length; i += 1000) {
      const batch = filePaths.slice(i, i + 1000);
      const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ prefixes: batch }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`Storage-Löschung fehlgeschlagen (${response.status}): ${JSON.stringify(payload).slice(0, 500)}`);
      }
      deletedFiles += batch.length;
    }

    return json(200, {
      ok: true,
      dry_run: false,
      retention_days: RETENTION_DAYS,
      cutoff: new Date(cutoff).toISOString(),
      scanned_files: scannedFiles,
      eligible_files: filePaths.length,
      deleted_files: deletedFiles,
      hit_run_limit: filePaths.length >= MAX_DELETE_PER_RUN,
      message: `${deletedFiles} abgelaufene Dub-Together-Mediendateien wurden über die Storage-API gelöscht.`,
    });
  } catch (error) {
    console.error('Dub Together cleanup failed:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Unbekannter Bereinigungsfehler.' });
  }
});
