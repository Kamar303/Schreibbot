// Dub Together: secure video-audio transcription + speaker diarization.
// AssemblyAI credentials stay on the server. The browser never receives them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function roomRow(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function uniqueStrings(values: unknown[], limit = 12) {
  return [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))].slice(0, limit);
}

function splitLongUtterance(utterance: any) {
  const text = String(utterance?.text ?? "").trim();
  if (!text) return [];
  const words = Array.isArray(utterance?.words) ? utterance.words : [];
  if (text.length <= 235 || !words.length) {
    return [{
      speakerId: String(utterance?.speaker ?? "A"),
      text: text.slice(0, 240),
      startMs: Math.max(0, Number(utterance?.start) || 0),
      endMs: Math.max(0, Number(utterance?.end) || 0),
      confidence: Number(utterance?.confidence) || 0,
    }];
  }

  const chunks: any[] = [];
  let group: any[] = [];
  let length = 0;
  const flush = () => {
    if (!group.length) return;
    const first = group[0];
    const last = group[group.length - 1];
    chunks.push({
      speakerId: String(first?.speaker ?? utterance?.speaker ?? "A"),
      text: group.map(item => String(item?.text ?? "")).join(" ").trim().slice(0, 240),
      startMs: Math.max(0, Number(first?.start) || Number(utterance?.start) || 0),
      endMs: Math.max(0, Number(last?.end) || Number(utterance?.end) || 0),
      confidence: Number(utterance?.confidence) || 0,
    });
    group = [];
    length = 0;
  };
  for (const word of words) {
    const value = String(word?.text ?? "").trim();
    if (!value) continue;
    if (group.length && length + value.length + 1 > 220) flush();
    group.push(word);
    length += value.length + (group.length > 1 ? 1 : 0);
  }
  flush();
  return chunks;
}

function buildSegments(utterances: any[], speakerNames: Record<string, string>) {
  const raw: any[] = [];
  for (const utterance of (Array.isArray(utterances) ? utterances : [])) raw.push(...splitLongUtterance(utterance));
  raw.sort((a, b) => a.startMs - b.startMs);

  // Combine short fragments from the same voice, but preserve pauses and speaker changes.
  const merged: any[] = [];
  for (const item of raw) {
    const previous = merged[merged.length - 1];
    const gap = previous ? item.startMs - previous.endMs : Infinity;
    if (previous && previous.speakerId === item.speakerId && gap >= -100 && gap <= 650 && (previous.text.length + item.text.length + 1) <= 235) {
      previous.text = `${previous.text} ${item.text}`.trim();
      previous.endMs = Math.max(previous.endMs, item.endMs);
      previous.confidence = Math.min(previous.confidence || 1, item.confidence || 1);
    } else {
      merged.push({ ...item });
    }
  }

  return merged.map(item => ({
    speaker_id: item.speakerId,
    speaker_name: speakerNames[item.speakerId] || `Sprecher ${item.speakerId}`,
    text: item.text.slice(0, 240),
    start_ms: item.startMs,
    end_ms: Math.max(item.startMs + 80, item.endMs),
    confidence: item.confidence,
  }));
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error || body?.message || body?.detail || `KI-Dienst antwortet mit HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return body;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Nur POST ist erlaubt." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const assemblyKey = Deno.env.get("ASSEMBLYAI_API_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Supabase-Serverkonfiguration ist unvollständig.");
    if (!assemblyKey) return json({ error: "Die KI-Analyse ist noch nicht eingerichtet. Hinterlege ASSEMBLYAI_API_KEY als Supabase-Edge-Function-Secret." }, 503);

    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Anmeldung erforderlich." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user?.id) return json({ error: "Deine Anmeldung ist abgelaufen. Bitte neu laden und erneut anmelden." }, 401);

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const code = String(body?.room_code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: "Ungültiger Raumcode." }, 400);
    if (!['start', 'poll'].includes(action)) return json({ error: "Unbekannte Analyseaktion." }, 400);

    const { data: roomData, error: roomError } = await userClient.rpc("get_dub_room", { p_code: code });
    if (roomError) throw new Error(roomError.message);
    const room = roomRow(roomData);
    if (!room || room.host_id !== userData.user.id) return json({ error: "Nur der Lobby-Host darf den Clip analysieren." }, 403);
    if (room.status !== "waiting") return json({ error: "Die Clip-Analyse ist nur vor dem Start der Aufnahme möglich." }, 409);

    const clip = room.clip || {};
    const clipPath = String(clip.path || "");
    if (!clipPath || clip.rights_confirmed !== true) return json({ error: "Lade zuerst einen Clip mit bestätigten Nutzungsrechten hoch." }, 400);
    if (clip.ai_analysis_consent !== true || !clip.ai_consent_at || String(clip.ai_consent_user || "") !== userData.user.id) return json({ error: "Vor der KI-Analyse muss der angemeldete Lobby-Host die Übertragung der Tonspur ausdrücklich in der Website bestätigen." }, 400);
    if (!clipPath.startsWith(`${code}/clips/${userData.user.id}/`)) return json({ error: "Der Clip gehört nicht zum privaten Upload-Ordner dieses Lobby-Hosts." }, 403);

    const analysis = clip.analysis || {};
    if (action === "start") {
      if (analysis.status === "completed" && analysis.result && !body?.force) {
        return json({ status: "completed", result: analysis.result, cached: true });
      }
      if (analysis.status === "processing" && analysis.transcript_id && !body?.force) {
        return json({ status: "processing", message: "Analyse läuft bereits." });
      }

      const { data: signedData, error: signedError } = await adminClient.storage.from("dub-media").createSignedUrl(clipPath, 3600);
      if (signedError || !signedData?.signedUrl) throw new Error(signedError?.message || "Der private Clip konnte nicht für die Analyse freigegeben werden.");
      const audioUrl = new URL(signedData.signedUrl, supabaseUrl).toString();
      const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: { Authorization: assemblyKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_url: audioUrl,
          speech_models: ["universal-3-pro", "universal-2"],
          language_detection: true,
          speaker_labels: true,
          entity_detection: true,
        }),
      });
      const transcript = await readJson(transcriptResponse);
      if (!transcript.id) throw new Error("Der KI-Dienst hat keine Analyse-ID zurückgegeben.");
      const nextClip = {
        ...clip,
        analysis: {
          provider: "AssemblyAI",
          status: "processing",
          transcript_id: String(transcript.id),
          clip_path: clipPath,
          started_at: new Date().toISOString(),
        },
      };
      const { error: saveError } = await userClient.rpc("set_dub_clip", {
        p_code: code,
        p_clip: nextClip,
        p_script: room.script,
      });
      if (saveError) throw new Error(`Analyse gestartet, konnte aber nicht in der Lobby gespeichert werden: ${saveError.message}`);
      return json({ status: "processing", message: "Clip wurde an die Sprachanalyse übergeben." });
    }

    if (!analysis.transcript_id || analysis.clip_path !== clipPath) {
      return json({ error: "Für diesen Clip wurde noch keine Analyse gestartet. Klicke auf „Clip analysieren“." }, 409);
    }
    if (analysis.status === "completed" && analysis.result) {
      return json({ status: "completed", result: analysis.result, cached: true });
    }

    const transcriptResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(analysis.transcript_id)}`, {
      headers: { Authorization: assemblyKey },
    });
    const transcript = await readJson(transcriptResponse);
    if (transcript.status === "queued" || transcript.status === "processing") {
      return json({ status: transcript.status, message: "Stimmen und Dialoge werden erkannt." });
    }
    if (transcript.status === "error") {
      const failedClip = { ...clip, analysis: { ...analysis, status: "failed", error: String(transcript.error || "Transkription fehlgeschlagen.").slice(0, 500) } };
      await userClient.rpc("set_dub_clip", { p_code: code, p_clip: failedClip, p_script: room.script });
      return json({ status: "failed", error: failedClip.analysis.error }, 422);
    }
    if (transcript.status !== "completed") return json({ status: "processing", message: "Analyse läuft." });

    const rawUtterances = Array.isArray(transcript.utterances) ? transcript.utterances : [];
    if (!rawUtterances.length) {
      const failedClip = { ...clip, analysis: { ...analysis, status: "failed", error: "Im Clip wurde keine verständliche Sprache erkannt." } };
      await userClient.rpc("set_dub_clip", { p_code: code, p_clip: failedClip, p_script: room.script });
      return json({ status: "failed", error: failedClip.analysis.error }, 422);
    }
    const rawSpeakerIds = [...new Set(rawUtterances.map((item: any) => String(item?.speaker || "A").trim()).filter(Boolean))];
    if (rawSpeakerIds.length > 12) {
      const failedClip = { ...clip, analysis: { ...analysis, status: "too_many_speakers", speaker_count: rawSpeakerIds.length, error: "Es wurden mehr als zwölf Stimmen erkannt. Bitte nutzt einen kürzeren Clip oder teilt ihn auf." } };
      await userClient.rpc("set_dub_clip", { p_code: code, p_clip: failedClip, p_script: room.script });
      return json({ status: "too_many_speakers", error: failedClip.analysis.error }, 422);
    }

    // Names are suggested only from names actually detected in the spoken transcript.
    // The service does not identify people by their faces or invent missing names.
    const personNames = uniqueStrings(
      (Array.isArray(transcript.entities) ? transcript.entities : [])
        .filter((item: any) => item?.entity_type === "person_name")
        .map((item: any) => item?.text),
      12,
    );
    const speakerNameMap: Record<string, string> = {};
    let identificationState = "not_available";
    if (personNames.length && rawSpeakerIds.length) {
      try {
        const identifyResponse = await fetch("https://llm-gateway.assemblyai.com/v1/understanding", {
          method: "POST",
          headers: { Authorization: assemblyKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript_id: analysis.transcript_id,
            speech_understanding: {
              request: {
                speaker_identification: {
                  speaker_type: "name",
                  speakers: personNames.map(name => ({ name })),
                  effort: "medium",
                },
              },
            },
          }),
        });
        if (identifyResponse.ok) {
          const identified = await identifyResponse.json();
          const mapping = identified?.speech_understanding?.response?.speaker_identification?.mapping;
          if (mapping && typeof mapping === "object") {
            for (const [speakerId, name] of Object.entries(mapping)) {
              const clean = String(name || "").trim();
              if (clean && personNames.some(candidate => candidate.toLocaleLowerCase() === clean.toLocaleLowerCase())) speakerNameMap[speakerId] = clean;
            }
            identificationState = Object.keys(speakerNameMap).length ? "identified" : "not_confident";
          }
        } else {
          identificationState = "not_confident";
        }
      } catch {
        identificationState = "not_confident";
      }
    }

    const segments = buildSegments(rawUtterances, speakerNameMap);
    const uniqueFinalSpeakers = [...new Map(segments.map(item => [item.speaker_id, item.speaker_name])).entries()]
      .map(([speaker_id, name]) => ({ speaker_id, name, identified: Boolean(speakerNameMap[speaker_id]) }));
    if (uniqueFinalSpeakers.length > 12) {
      const failedClip = { ...clip, analysis: { ...analysis, status: "too_many_speakers", speaker_count: uniqueFinalSpeakers.length, error: "Es wurden mehr als zwölf Stimmen erkannt. Bitte teilt den Clip auf." } };
      await userClient.rpc("set_dub_clip", { p_code: code, p_clip: failedClip, p_script: room.script });
      return json({ status: "too_many_speakers", error: failedClip.analysis.error }, 422);
    }
    if (segments.length > 60) {
      const tooManyClip = { ...clip, analysis: { ...analysis, status: "too_many_lines", utterance_count: segments.length } };
      await userClient.rpc("set_dub_clip", { p_code: code, p_clip: tooManyClip, p_script: room.script });
      return json({ status: "too_many_lines", count: segments.length, error: `Es wurden ${segments.length} Dialogabschnitte erkannt. Dub Together unterstützt maximal 60 Lines pro Clip. Bitte kürze oder teile den Clip.` }, 422);
    }

    const result = {
      provider: "AssemblyAI",
      language_code: transcript.language_code || null,
      duration_ms: Number(transcript.audio_duration) * 1000 || null,
      identification: identificationState,
      detected_names: personNames,
      speakers: uniqueFinalSpeakers,
      segments,
    };
    const completedClip = {
      ...clip,
      analysis: {
        ...analysis,
        status: "completed",
        completed_at: new Date().toISOString(),
        result,
      },
    };
    const { error: completedSaveError } = await userClient.rpc("set_dub_clip", {
      p_code: code,
      p_clip: completedClip,
      p_script: room.script,
    });
    if (completedSaveError) throw new Error(`Die Analyse ist fertig, konnte aber nicht in der Lobby gesichert werden: ${completedSaveError.message}`);
    return json({ status: "completed", result, cached: false });
  } catch (error) {
    console.error("dub-analyze-clip error", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Analysefehler." }, 500);
  }
});
