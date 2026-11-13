/* Schreibbot v91 – Arbeitsblatt-Modus: Seite, Bilder und übrigen Text behalten, nur die Schrift in die eigene Handschrift tauschen. */
(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const WORD = /[A-Za-zÄÖÜäöüß]{2,}/g;
  // Häufige deutsche (Schul-)Wörter, grob nach Häufigkeit. Dazu kommen deine gespeicherten Wörter und alle sicheren Wörter des Dokuments.
  const LEX = ('der die das und ist nicht ein eine einen einem einer ich du er sie es wir ihr mit von zu auf für in im an am aus bei nach vor über unter durch ohne um bis auch noch nur schon sehr wie was wer wo wann warum wenn dass oder aber denn weil als so ja nein hallo danke bitte guten morgen tag abend nacht tschüss name datum klasse aufgabe aufgaben lösung lösungen antwort antworten frage fragen beispiel text satz sätze wort wörter schreibe rechne ergänze verbinde kreuze markiere unterstreiche male zeichne lies beantworte beschreibe erkläre berechne ordne richtig falsch zahl zahlen zeit woche montag dienstag mittwoch donnerstag freitag samstag sonntag januar februar märz april mai juni juli august september oktober november dezember heute gestern jahr monat haus hund katze mutter vater kind kinder freund freunde schule lehrer lehrerin schüler buch heft stift tisch stuhl wasser brot milch apfel baum blume sonne mond stern himmel erde welt land stadt dorf straße auto bus zug fahrrad spielen lernen arbeiten gehen kommen machen sehen sagen geben nehmen haben sein werden können müssen sollen wollen dürfen gut besser schön groß klein neu alt jung lang kurz viel viele wenig mehr alle alles jeder kein keine mein dein unser eins zwei drei vier fünf sechs sieben acht neun zehn zwölf hundert tausend erste zweite dritte mal immer nie oft manchmal hier dort da dann jetzt nun wieder zusammen zwischen gegen seit während wegen mathe deutsch englisch sachunterricht kunst musik sport religion geschichte biologie physik chemie').split(/\s+/);
  const norm = w => w.toLowerCase().replace(/ß/g, 'ss');

  // ---------- Smarte Wortkorrektur ----------
  function dist(a, b, max) { // Damerau-Levenshtein mit frühem Abbruch
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let p2 = null, p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const c = [i]; let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        c[j] = v; rowMin = Math.min(rowMin, v);
      }
      if (rowMin > max) return max + 1;
      p2 = p; p = c;
    }
    return p[b.length];
  }
  function buildVocab(lines, known) {
    const vocab = new Map();
    const add = (w, rank) => { const k = norm(w); if (k.length >= 3 && !vocab.has(k)) vocab.set(k, { w: k, disp: w, rank }); };
    (known || []).forEach(w => add(String(w), -1));          // eigene gespeicherte Wörter haben Vorrang
    LEX.forEach((w, i) => add(w, i));
    const count = new Map();
    lines.forEach(l => (l.text.match(WORD) || []).forEach(w => count.set(norm(w), (count.get(norm(w)) || 0) + 1)));
    lines.forEach(l => (l.text.match(WORD) || []).forEach(w => { if (l.printed || count.get(norm(w)) > 1) add(w, 300); }));
    return vocab;
  }
  function fixWord(tok, vocab, weak, atStart) {
    const k = norm(tok);
    if (k.length < 3 || vocab.has(k)) return tok;
    const cap = /^[A-ZÄÖÜ]/.test(tok);
    if (k.length < 5 && !weak) return tok;                    // kurze Wörter nur bei unsicherer Zeile anfassen
    if (cap && !atStart && !weak) return tok;                 // Eigennamen mitten im Satz schützen
    const max = k.length >= 8 ? 2 : 1;
    let best = null, bestScore = Infinity;
    for (const e of vocab.values()) {
      const bonus = e.rank < 0 ? -2 : e.rank / 400;
      let s = Infinity;
      if (weak && e.w.length > k.length && e.w.startsWith(k) && e.w.length <= k.length * 2 + 2) s = 1 + (e.w.length - k.length) * .6 + bonus; // abgeschnitten: „hal“ → „Hallo“
      const d = dist(k, e.w, max);
      if (d <= max) s = Math.min(s, d * 3 + bonus);
      if (s < bestScore) { bestScore = s; best = e; }
    }
    if (!best) return tok;
    const out = (cap || /^[A-ZÄÖÜ]/.test(best.disp)) ? best.w[0].toUpperCase() + best.w.slice(1) : best.w;
    return tok === tok.toUpperCase() && tok.length > 2 ? out.toUpperCase() : (best.disp.toLowerCase().replace(/ß/g, 'ss') === best.w && /[ßäöü]/i.test(best.disp) ? (cap ? best.disp[0].toUpperCase() + best.disp.slice(1) : best.disp) : out);
  }
  function correctLine(text, confidence, vocab) {
    const weak = Number(confidence) < .8;
    return text.replace(WORD, (w, off) => fixWord(w, vocab, weak, off <= 1));
  }

  // ---------- Tinte entfernen (Bilder und Linien bleiben, nur dunkle/farbige Striche verschwinden) ----------
  function eraseInk(ctx, box, pad) {
    const x0 = Math.max(0, Math.floor(box.left - pad)), y0 = Math.max(0, Math.floor(box.top - pad));
    const x1 = Math.min(ctx.canvas.width, Math.ceil(box.right + pad)), y1 = Math.min(ctx.canvas.height, Math.ceil(box.bottom + pad));
    const w = x1 - x0, h = y1 - y0; if (w < 3 || h < 3) return null;
    const img = ctx.getImageData(x0, y0, w, h), d = img.data, rs = [], gs = [], bs = [];
    const edge = (x, y) => { const i = (y * w + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); };
    for (let x = 0; x < w; x += 2) { edge(x, 0); edge(x, h - 1); }
    for (let y = 0; y < h; y += 2) { edge(0, y); edge(w - 1, y); }
    const med = a => a.sort((p, q) => p - q)[a.length >> 1], bg = [med(rs), med(gs), med(bs)];
    const mask = new Uint8Array(w * h); let n = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      if (Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]) > 150) { mask[i] = 1; n++; sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; }
    }
    const m2 = mask.slice();                                   // 1 px verbreitern: Anti-Aliasing-Rand mit entfernen
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!mask[i] && (mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w])) m2[i] = 1; }
    for (let i = 0; i < w * h; i++) if (m2[i]) { const p = i * 4; d[p] = bg[0]; d[p + 1] = bg[1]; d[p + 2] = bg[2]; d[p + 3] = 255; }
    ctx.putImageData(img, x0, y0);
    return n > 20 ? `rgb(${Math.round(sr / n * .8)},${Math.round(sg / n * .8)},${Math.round(sb / n * .8)})` : '#1a1a1a';
  }

  // ---------- Umwandlung ----------
  const isPrinted = l => l.recognitionSource !== 'htr-line-crop' || /Tesseract/i.test(l.engine || '');
  async function convert(canvases, lineResults, o) {
    const pages = canvases.map((_, i) => (lineResults[i] || []).filter(l => String(l.text || '').trim() && [l.left, l.top, l.right, l.bottom].every(Number.isFinite)).map(l => ({ ...l, text: String(l.text).trim(), printed: isPrinted(l) })));
    const all = pages.flat();
    if (o.smart) {
      const vocab = buildVocab(all, o.known);
      all.forEach(l => { l.original = l.text; l.text = correctLine(l.text, l.confidence, vocab); });
      if (typeof o.ai === 'function') { // optional: eigener KI-Endpunkt, bekommt alle Zeilen und gibt korrigierte Zeilen zurück
        try { const fixed = await o.ai(all.map(l => l.text)); if (Array.isArray(fixed) && fixed.length === all.length) all.forEach((l, i) => { if (typeof fixed[i] === 'string' && fixed[i].trim()) l.text = fixed[i].trim(); }); } catch (e) { console.warn('KI-Korrektur nicht erreichbar:', e); }
      }
    }
    let done = 0, fixed = 0;
    const out = canvases.map((src, i) => {
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(src, 0, 0);
      for (const l of pages[i]) {
        if (!(o.mode === 'all' || (o.mode === 'hand' && !l.printed) || (o.mode === 'print' && l.printed))) continue;
        const H = Math.max(8, l.bottom - l.top), W = l.right - l.left;
        const ink = eraseInk(ctx, l, Math.max(2, H * .06)) || '#1a1a1a';
        o.draw(ctx, l.text, l.left, l.bottom - H * .24, H * .8 * o.scale, ink, W * 1.05);
        done++; if (l.original && l.original !== l.text) fixed++;
      }
      return c;
    });
    return { canvases: out, done, fixed, total: all.length };
  }

  // ---------- Minimaler PDF-Writer (JPEG-Seiten) ----------
  function pdfFromCanvases(cs) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
    const obj = (n, body) => { offs[n] = len; push(n + ' 0 obj\n' + body + '\nendobj\n'); };
    push('%PDF-1.4\n'); obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Count ' + cs.length + ' /Kids [' + cs.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>');
    cs.forEach((c, i) => {
      const p = 3 + i * 3, w = (c.width * .75).toFixed(2), h = (c.height * .75).toFixed(2);
      const jpg = Uint8Array.from(atob(c.toDataURL('image/jpeg', .92).split(',')[1]), ch => ch.charCodeAt(0));
      obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`);
      offs[p + 1] = len; push(`${p + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n');
      const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
      obj(p + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    const total = 3 + cs.length * 3, xref = len;
    push('xref\n0 ' + total + '\n0000000000 65535 f \n');
    for (let i = 1; i < total; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(parts, { type: 'application/pdf' });
  }

  // ---------- Oberfläche ----------
  function init(opts) {
    const run = $('hwWsRun'); if (!run) return;
    const status = $('hwWsStatus'), out = $('hwWsOut');
    const say = (t, type) => { status.className = 'handwritingImportStatus' + (type ? ' ' + type : ''); status.textContent = t; };
    const link = (blob, name, label) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.textContent = label; a.className = 'fileBtn'; a.style.cssText = 'display:inline-block;margin:6px 6px 0 0;text-decoration:none'; return a; };
    document.addEventListener('schreibbot:import-ready', () => { run.disabled = !global.__schreibbotLastImport; out.replaceChildren(); });
    run.addEventListener('click', async () => {
      const last = global.__schreibbotLastImport; if (!last) return;
      run.disabled = true; out.replaceChildren(); say('Arbeitsblatt wird in deiner Handschrift neu gesetzt …', 'working');
      try {
        const res = await convert(last.canvases, last.result.lineResults || [], { mode: $('hwWsMode').value, smart: $('hwWsSmart').checked, scale: (Number($('hwWsScale').value) || 100) / 100, draw: opts.drawHandwritingLine, known: opts.knownWords ? opts.knownWords() : [], ai: opts.aiCorrect });
        res.canvases.forEach((c, i) => { c.style.cssText = 'max-width:100%;height:auto;border:1px solid #cfd8e3;border-radius:8px;margin-top:8px'; out.appendChild(c); });
        const bar = document.createElement('div');
        bar.appendChild(link(pdfFromCanvases(res.canvases), 'arbeitsblatt-meine-handschrift.pdf', '⬇ Als PDF speichern'));
        res.canvases.forEach((c, i) => c.toBlob(b => bar.appendChild(link(b, 'arbeitsblatt-seite-' + (i + 1) + '.png', '⬇ PNG Seite ' + (i + 1))), 'image/png'));
        out.appendChild(bar);
        say(res.done ? res.done + ' von ' + res.total + ' Zeilen in deine Handschrift umgewandelt, ' + res.fixed + ' Zeile(n) smart korrigiert. Bilder und der übrige Text blieben unverändert.' : 'Für diesen Modus wurden keine passenden Zeilen mit Position gefunden. Probiere „Handschrift + gedruckten Text“.', res.done ? 'success' : 'error');
      } catch (e) { console.error(e); say(e?.message || 'Umwandlung fehlgeschlagen.', 'error'); }
      finally { run.disabled = !global.__schreibbotLastImport; }
    });
  }
  global.SchreibbotWorksheet = { init, convert, correctLine, buildVocab };
})(window);
