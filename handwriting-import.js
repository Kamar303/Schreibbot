/* Schreibbot handwriting import v90
 * Local document import: images, PDF, Schreibbot/GoodNotes native strokes, Samsung Notes .sdocx.
 * OCR runs in the browser. No uploaded document or recognized text is sent to a Schreibbot server.
 */
(function (global) {
  'use strict';

  // Multiple public mirrors are used because a single blocked CDN must not break the import.
  // The site CSP in index.html explicitly allowlists these hosts.
  const SCRIPT_URLS = {
    zip: [
      'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
      'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
    ],
    pdf: [
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js'
    ],
    tesseract: [
      'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js',
      'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js'
    ]
  };
  const loadedScripts = new Map();
  const loadedScriptUrls = new Map();
  const SCRIPT_TIMEOUT_MS = 9000;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_UNCOMPRESSED_BYTES = 140 * 1024 * 1024;
  const MAX_PAGES = 20;
  const OCR_WIDTH = 1650;
  const OCR_HEIGHT = 2300;

  function loadScript(key, test) {
    if (test()) return Promise.resolve(loadedScriptUrls.get(key) || SCRIPT_URLS[key]?.[0] || '');
    if (loadedScripts.has(key)) return loadedScripts.get(key);
    const candidates = SCRIPT_URLS[key];
    if (!Array.isArray(candidates) || !candidates.length) {
      return Promise.reject(new Error('Für die Bibliothek „' + key + '“ ist keine Quelle konfiguriert.'));
    }

    const promise = (async () => {
      const failures = [];
      for (const url of candidates) {
        let script = null;
        try {
          await new Promise((resolve, reject) => {
            script = document.createElement('script');
            let finished = false;
            const finish = (fn, value) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              fn(value);
            };
            const timer = setTimeout(() => finish(reject, new Error('Zeitüberschreitung nach ' + (SCRIPT_TIMEOUT_MS / 1000) + ' Sekunden')), SCRIPT_TIMEOUT_MS);
            script.src = url;
            script.async = true;
            script.onload = () => {
              if (test()) finish(resolve);
              else finish(reject, new Error('Skript geladen, aber das erwartete globale Objekt fehlt'));
            };
            script.onerror = () => finish(reject, new Error('Browser hat das Skript blockiert oder konnte den Server nicht erreichen'));
            document.head.appendChild(script);
          });
          loadedScriptUrls.set(key, url);
          return url;
        } catch (error) {
          failures.push(url + ' → ' + (error?.message || 'Ladefehler'));
          if (script?.parentNode) script.parentNode.removeChild(script);
        }
      }
      const attempted = failures.map((item, i) => (i + 1) + '. ' + item).join(' | ');
      throw new Error(
        'Die Bibliothek „' + key + '“ konnte über keine der drei Quellen geladen werden. ' +
        'Wahrscheinliche Ursachen: eine noch alte PWA-Sicherheitsrichtlinie, ein Inhaltsblocker oder eine Netzwerk-/DNS-Sperre. ' +
        'Bitte veröffentliche index.html und service-worker.js gemeinsam und lade die PWA vollständig neu. ' +
        'Details: ' + attempted
      );
    })().catch(error => {
      loadedScripts.delete(key);
      throw error;
    });
    loadedScripts.set(key, promise);
    return promise;
  }

  function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('is-error', 'is-success', 'is-working');
    if (type) el.classList.add('is-' + type);
  }

  function bytesToAscii(bytes, start, length) {
    let out = '';
    for (let i = start; i < Math.min(bytes.length, start + length); i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function readU16(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
  }
  function readU32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  }
  function readF32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(offset, true);
  }
  function readF64(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(offset, true);
  }

  function readVarint(bytes, offset) {
    let value = 0n, shift = 0n, pos = offset;
    while (pos < bytes.length) {
      const b = bytes[pos++];
      value |= BigInt(b & 127) << shift;
      if (!(b & 128)) return { value, pos };
      shift += 7n;
      if (shift > 70n) break;
    }
    throw new Error('Die Notizdatei enthält einen ungültigen Datenblock.');
  }

  function parseProtoFields(bytes) {
    const fields = [];
    let pos = 0;
    while (pos < bytes.length) {
      const key = readVarint(bytes, pos); pos = key.pos;
      const number = Number(key.value >> 3n), wire = Number(key.value & 7n);
      if (!number) throw new Error('Ungültiges GoodNotes-Datenfeld.');
      if (wire === 0) {
        const v = readVarint(bytes, pos); fields.push({ number, wire, value: v.value }); pos = v.pos;
      } else if (wire === 1) {
        if (pos + 8 > bytes.length) throw new Error('Abgeschnittener GoodNotes-Datenblock.');
        fields.push({ number, wire, value: bytes.slice(pos, pos + 8) }); pos += 8;
      } else if (wire === 2) {
        const l = readVarint(bytes, pos); pos = l.pos;
        const len = Number(l.value);
        if (!Number.isSafeInteger(len) || len < 0 || pos + len > bytes.length) throw new Error('Ungültige GoodNotes-Datenlänge.');
        fields.push({ number, wire, value: bytes.slice(pos, pos + len) }); pos += len;
      } else if (wire === 5) {
        if (pos + 4 > bytes.length) throw new Error('Abgeschnittener GoodNotes-Datenblock.');
        fields.push({ number, wire, value: bytes.slice(pos, pos + 4) }); pos += 4;
      } else {
        throw new Error('Nicht unterstütztes GoodNotes-Datenformat.');
      }
    }
    return fields;
  }

  function parseGoodnotesGeometry(frame) {
    if (!frame || frame.length < 48 || bytesToAscii(frame, 0, 4) !== 'bv4-') return null;
    const rawLength = readU32(frame, 4);
    if (rawLength < 32 || rawLength > frame.length - 12) return null;
    const raw = frame.subarray(8, 8 + rawLength);
    if (bytesToAscii(raw, 0, 4) !== 'tpl\0') return null;
    let sigEnd = -1;
    for (let i = 8; i < Math.min(raw.length, 180); i++) { if (raw[i] === 0) { sigEnd = i; break; } }
    if (sigEnd < 0) return null;
    let p = sigEnd + 1;
    if (p + 10 > raw.length) return null;
    p += 2; // geometry version
    const penWidth = readF32(raw, p); p += 4;
    const flagCount = readU32(raw, p); p += 4;
    if (!Number.isFinite(penWidth) || flagCount < 2 || flagCount > 10000 || p + flagCount * 2 + 16 > raw.length) return null;
    p += flagCount * 2;
    p += 4; // path count marker
    const start = { x: readF32(raw, p), y: readF32(raw, p + 4) }; p += 8;
    const segmentCount = readU32(raw, p); p += 4;
    if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || segmentCount > 10000 || p + segmentCount * 16 > raw.length) return null;
    const segments = [];
    for (let i = 0; i < segmentCount; i++) {
      const cx = readF32(raw, p), cy = readF32(raw, p + 4), x = readF32(raw, p + 8), y = readF32(raw, p + 12);
      p += 16;
      if (![cx, cy, x, y].every(Number.isFinite)) return null;
      segments.push({ cx, cy, x, y });
    }
    return { start, segments, width: Math.max(.6, Math.min(24, penWidth || 1.5)), color: '#172033' };
  }

  function parseGoodnotesPage(bytes) {
    const paths = [];
    let pos = 0, recordIndex = 0;
    while (pos < bytes.length) {
      const length = readVarint(bytes, pos); pos = length.pos;
      const len = Number(length.value);
      if (!Number.isSafeInteger(len) || len < 1 || pos + len > bytes.length) break;
      const record = bytes.subarray(pos, pos + len); pos += len; recordIndex++;
      let fields;
      try { fields = parseProtoFields(record); } catch { continue; }
      for (const outer of fields) {
        if (outer.number !== 7 || outer.wire !== 2) continue;
        let strokeFields;
        try { strokeFields = parseProtoFields(outer.value); } catch { continue; }
        const geometryField = strokeFields.find(f => f.number === 2 && f.wire === 2);
        if (!geometryField) continue;
        const path = parseGoodnotesGeometry(geometryField.value);
        if (path) paths.push(path);
      }
    }
    return paths;
  }

  function decodeSamsungDelta(word) {
    const magnitude = (word & 0x7fff) / 32;
    return (word & 0x8000) ? -magnitude : magnitude;
  }

  function parseSamsungPage(bytes) {
    if (!bytes || bytes.length < 80) return null;
    const pageWidth = readU32(bytes, 0x16), pageHeight = readU32(bytes, 0x1a);
    if (pageWidth < 100 || pageHeight < 100 || pageWidth > 100000 || pageHeight > 100000) return null;
    const layerOffset = readU32(bytes, 0);
    const layerStart = layerOffset + 4;
    if (layerStart + 8 > bytes.length) return null;
    const headerSize = readU32(bytes, layerStart), countOffset = layerStart + headerSize;
    if (countOffset + 4 > bytes.length) return null;
    const objectCount = readU32(bytes, countOffset);
    if (objectCount > 50000) return null;
    let pos = countOffset + 4;
    const paths = [];
    for (let i = 0; i < objectCount; i++) {
      if (pos + 7 > bytes.length) break;
      const objectSize = readU32(bytes, pos + 3), total = 7 + objectSize;
      if (total < 120 || pos + total > bytes.length) break;
      const obj = bytes.subarray(pos, pos + total); pos += total;
      const base = 7, baseLen = readU32(obj, base), strokeOffset = base + baseLen;
      if (strokeOffset + 22 > obj.length) continue;
      const pointCount = readU16(obj, strokeOffset + 18), geometry = strokeOffset + 20;
      if (pointCount < 2 || pointCount > 10000 || geometry + 16 + (pointCount - 1) * 4 > obj.length) continue;
      let x = readF64(obj, geometry), y = readF64(obj, geometry + 8);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const pts = [{ x, y }];
      for (let j = 1; j < pointCount; j++) {
        const dx = decodeSamsungDelta(readU16(obj, geometry + 16 + (j - 1) * 4));
        const dy = decodeSamsungDelta(readU16(obj, geometry + 18 + (j - 1) * 4));
        x += dx; y += dy;
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        pts.push({ x, y });
      }
      if (pts.length < 2) continue;
      const left = readF64(obj, base + 68), top = readF64(obj, base + 76);
      const minX = Math.min(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y));
      // Some Samsung versions store points relative to a stroke origin; align them to the saved bounding box.
      if (Number.isFinite(left) && Number.isFinite(top) && (Math.abs(left - minX) > 2 || Math.abs(top - minY) > 2)) {
        const sx = left - minX, sy = top - minY;
        for (const point of pts) { point.x += sx; point.y += sy; }
      }
      let width = 2.0, color = '#172033';
      try {
        const flexible = readU32(obj, strokeOffset + 6), widthOffset = strokeOffset + flexible + 8;
        if (widthOffset + 4 <= obj.length) {
          const w = readF32(obj, widthOffset); if (Number.isFinite(w) && w > 0 && w < 80) width = w;
          const rgba = readU32(obj, strokeOffset + flexible + 4) & 0xffffff;
          color = '#' + rgba.toString(16).padStart(6, '0');
        }
      } catch { /* keep readable defaults */ }
      paths.push({ points: pts, width, color });
    }
    return { width: pageWidth, height: pageHeight, paths };
  }

  function renderNativePathsToCanvas(paths, pageWidth, pageHeight, transparent = false) {
    const scale = Math.min(OCR_WIDTH / Math.max(1, pageWidth), OCR_HEIGHT / Math.max(1, pageHeight));
    const width = Math.max(400, Math.round(pageWidth * scale));
    const height = Math.max(400, Math.round(pageHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const path of paths) {
      const points = path.points || (path.start ? [path.start, ...(path.segments || []).map(seg => ({ x: seg.x, y: seg.y }))] : []);
      if (points.length < 2) continue;
      ctx.strokeStyle = path.color || '#172033';
      ctx.lineWidth = Math.max(1.1, Math.min(28, (Number(path.width) || 1.8) * scale));
      ctx.beginPath();
      ctx.moveTo(points[0].x * scale, points[0].y * scale);
      if (path.segments?.length) {
        for (const seg of path.segments) ctx.quadraticCurveTo(seg.cx * scale, seg.cy * scale, seg.x * scale, seg.y * scale);
      } else {
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * scale, points[i].y * scale);
      }
      ctx.stroke();
    }
    return canvas;
  }

  function overlayNativeInk(background, ink) {
    if (!background) return ink;
    const page = document.createElement('canvas');
    page.width = background.width; page.height = background.height;
    const ctx = page.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(background, 0, 0);
    if (ink) ctx.drawImage(ink, 0, 0, page.width, page.height);
    return page;
  }

  async function fileToImageCanvas(file) {
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch {
      const url = URL.createObjectURL(file);
      try {
        bitmap = await new Promise((resolve, reject) => {
          const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Das Bild konnte nicht geöffnet werden.')); image.src = url;
        });
      } finally { URL.revokeObjectURL(url); }
    }
    const factor = Math.min(1, OCR_WIDTH / bitmap.width, OCR_HEIGHT / bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * factor)); canvas.height = Math.max(1, Math.round(bitmap.height * factor));
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return canvas;
  }

  function pdfItemsToTextLayout(items, pageWidth = 0, pageHeight = 0, scale = 1) {
    const entries = (items || []).filter(item => typeof item.str === 'string' && item.str.trim() && Array.isArray(item.transform) && item.transform.length >= 6).map(item => {
      const x = Number(item.transform[4]) || 0;
      const y = Number(item.transform[5]) || 0;
      const h = Math.max(1, Math.abs(Number(item.height) || Math.abs(Number(item.transform[3])) || 10));
      const width = Math.max(0, Number(item.width) || 0);
      return { text: item.str, x, y, width, height: h, end: x + width };
    }).sort((a, b) => b.y - a.y || a.x - b.x);
    if (!entries.length) return { text: '', layout: null };
    const medianHeight = entries.map(item => item.height).sort((a,b)=>a-b)[Math.floor(entries.length/2)] || 10;
    const lines = [];
    for (const item of entries) {
      let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= Math.max(2.5, medianHeight * 0.38));
      if (!line) { line = { y: item.y, items: [], left: item.x, right: item.end }; lines.push(line); }
      line.items.push(item); line.left = Math.min(line.left, item.x); line.right = Math.max(line.right, item.end);
      line.y = line.items.reduce((sum, current) => sum + current.y, 0) / line.items.length;
    }
    lines.sort((a,b)=>b.y-a.y);
    for (const line of lines) line.items.sort((a,b)=>a.x-b.x);
    const minX = Math.min(...lines.map(line => line.left));
    const medianLineHeight = medianNumber(lines.map(line => medianNumber(line.items.map(item => item.height))));
    const centers = lines.map(line => line.y);
    const verticalGaps = centers.slice(1).map((y,i)=>Math.max(0, centers[i]-y));
    const medianLineSpacing = medianNumber(verticalGaps) || medianLineHeight * 1.5;
    const sortedGaps = verticalGaps.filter(gap => gap > 0).sort((a,b)=>a-b);
    const normalLineSpacing = sortedGaps.length ? sortedGaps[Math.floor((sortedGaps.length - 1) * 0.35)] : medianLineSpacing;
    const paragraphGap = Math.max(normalLineSpacing * 1.4, medianLineHeight * 1.7);
    const spaceWidth = Math.max(2, medianLineHeight * 0.22);
    const textLines = [], lineBoxes = [];
    for (let i=0;i<lines.length;i++) {
      const line=lines[i]; let content=''; let previousRight=null;
      for (const item of line.items) {
        const gap = previousRight == null ? 0 : item.x - previousRight;
        if (gap > spaceWidth && content && !content.endsWith(' ')) content += ' ';
        content += item.text;
        previousRight = item.end;
      }
      const indent = Math.max(0,line.left-minX);
      const spaces = Math.min(18,Math.round(indent/Math.max(spaceWidth*1.8,medianLineHeight*0.6)));
      const lineText = content.trim();
      textLines.push({ text: ' '.repeat(spaces)+lineText, y: line.y, left: line.left, right: line.right });
      const top = Math.max(0, Math.min(...line.items.map(item => pageHeight - (item.y + item.height))));
      const bottom = Math.min(pageHeight, Math.max(...line.items.map(item => pageHeight - item.y)));
      if (lineText && line.right > line.left && bottom > top) {
        lineBoxes.push({ text: lineText, left: Math.max(0,line.left*scale), top: top*scale, right: Math.min(pageWidth,line.right)*scale, bottom: bottom*scale, confidence: 1, engine: 'PDF-Textschicht' });
      }
    }
    let text='';
    for(let i=0;i<textLines.length;i++) {
      if(i) {
        const gap = textLines[i-1].y-textLines[i].y;
        text += gap > paragraphGap ? '\n\n' : '\n';
      }
      text += textLines[i].text;
    }
    return {
      text: text.trimEnd(),
      layout: {
        lineCount: textLines.length,
        medianLineHeight: medianLineHeight*scale,
        medianLineSpacing: medianLineSpacing*scale,
        width: pageWidth*scale,
        height: pageHeight*scale,
        left: Math.min(...lines.map(line=>line.left))*scale,
        top: pageHeight ? Math.max(0, pageHeight - Math.max(...lines.map(line=>line.y)))*scale : 0,
        right: Math.max(...lines.map(line=>line.right))*scale,
        bottom: pageHeight ? Math.max(0, pageHeight - Math.min(...lines.map(line=>line.y)))*scale : 0,
        unit: 'px',
        lineBoxes
      }
    };
  }

  async function loadPdfCanvases(data, progress) {
    const mainUrl = await loadScript('pdf', () => !!global.pdfjsLib);
    const workerCandidates = [
      mainUrl.replace(/pdf\.min\.js(?:[?#].*)?$/, 'pdf.worker.min.js'),
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
    ].filter((url, index, all) => url && all.indexOf(url) === index);
    let pdf = null;
    const workerErrors = [];
    for (const workerUrl of workerCandidates) {
      try {
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        pdf = await global.pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
        break;
      } catch (error) {
        workerErrors.push(workerUrl + ': ' + (error?.message || 'Worker-Fehler'));
      }
    }
    if (!pdf) throw new Error('Die PDF-Verarbeitung konnte keinen passenden PDF-Worker starten. Prüfe die Sicherheitsrichtlinie und lade die Seite neu. Details: ' + workerErrors.join(' | '));
    if (pdf.numPages > MAX_PAGES) throw new Error('Die Datei hat ' + pdf.numPages + ' Seiten. Aktuell können höchstens ' + MAX_PAGES + ' Seiten auf einmal erkannt werden.');
    const canvases = [], textPages = [], textLayouts = [], dimensions = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      progress('PDF-Seite ' + i + ' von ' + pdf.numPages + ' wird vorbereitet …');
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 }), scale = Math.min(2.2, OCR_WIDTH / base.width, OCR_HEIGHT / base.height);
      dimensions.push({ width: base.width, height: base.height, unit: 'pt' });
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
      try {
        const content = await page.getTextContent();
        const extracted = pdfItemsToTextLayout(content.items || [], base.width, base.height, scale);
        textPages.push(extracted.text);
        textLayouts.push(extracted.layout);
      } catch { textPages.push(''); textLayouts.push(null); }
      if (canvases.length > MAX_PAGES) throw new Error('Zu viele PDF-Seiten.');
    }
    return { canvases, textPages, textLayouts, dimensions };
  }

  async function loadZip() { await loadScript('zip', () => !!global.JSZip); return global.JSZip; }

  function listZipFiles(zip, regex) {
    return Object.values(zip.files).filter(f => !f.dir && regex.test(f.name));
  }

  async function extractGoodnotes(zip, progress) {
    const noteFiles = listZipFiles(zip, /^notes\/[^/]+$/i).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (noteFiles.length > MAX_PAGES) throw new Error('Das GoodNotes-Notizbuch hat ' + noteFiles.length + ' Seiten. Pro Import sind höchstens ' + MAX_PAGES + ' Seiten möglich.');
    const pdfFiles = listZipFiles(zip, /\.pdf$/i).sort((a, b) => b.name.length - a.name.length);
    let pdfGeometry = null;
    if (pdfFiles.length) {
      try { pdfGeometry = await loadPdfCanvases(await pdfFiles[0].async('arraybuffer'), progress); }
      catch (error) { console.warn('GoodNotes-Hintergrund-PDF konnte nicht gelesen werden:', error); }
    }
    const pages = [], dimensions = [];
    for (let i = 0; i < noteFiles.length && pages.length < MAX_PAGES; i++) {
      progress('GoodNotes-Seite ' + (i + 1) + ' wird mit Hintergrund und Stiftstrichen gelesen …');
      const paths = parseGoodnotesPage(await noteFiles[i].async('uint8array'));
      const sourceDim = pdfGeometry?.dimensions?.[i] || pdfGeometry?.dimensions?.[0] || { width: 455.04, height: 588.45, unit: 'pt' };
      const basePage = pdfGeometry?.canvases?.[i] || pdfGeometry?.canvases?.[0] || null;
      if (basePage || paths.length) {
        const ink = paths.length ? renderNativePathsToCanvas(paths, sourceDim.width, sourceDim.height, true) : null;
        pages.push(overlayNativeInk(basePage, ink));
        dimensions.push({ ...sourceDim, unit: 'pt' });
      }
    }
    if (pages.length) return { canvases: pages, dimensions, method: 'native-with-background', name: 'GoodNotes-Seiten mit Originalhintergrund', sourceFormat: 'goodnotes' };
    if (pdfGeometry?.canvases?.length) return { ...pdfGeometry, method: 'embedded-pdf', name: 'eingebettete PDF-Seiten', sourceFormat: 'goodnotes' };
    const images = listZipFiles(zip, /(?:thumbnail|preview|page|media).*\.(?:png|jpe?g|webp)$/i).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (images.length > MAX_PAGES) throw new Error('Das GoodNotes-Archiv enthält mehr als ' + MAX_PAGES + ' Bildseiten.');
    if (images.length) {
      const result = [];
      for (const image of images.slice(0, MAX_PAGES)) result.push(await fileToImageCanvas(await image.async('blob')));
      return { canvases: result, dimensions: result.map(c => ({ width: c.width, height: c.height, unit: 'px' })), method: 'preview-image', name: 'GoodNotes-Vorschaubild(er)', sourceFormat: 'goodnotes' };
    }
    throw new Error('In dieser GoodNotes-Datei wurden keine lesbaren Stiftstriche, PDF-Seiten oder Vorschaubilder gefunden. Exportiere sie alternativ als PDF.');
  }

  async function extractSamsung(zip, progress) {
    const pageFiles = listZipFiles(zip, /\.page$/i).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (pageFiles.length > MAX_PAGES) throw new Error('Die Samsung-Notes-Datei hat ' + pageFiles.length + ' Seiten. Pro Import sind höchstens ' + MAX_PAGES + ' Seiten möglich.');
    const pdfFiles = listZipFiles(zip, /\.pdf$/i);
    let pdfGeometry = null;
    if (pdfFiles.length) {
      try { pdfGeometry = await loadPdfCanvases(await pdfFiles[0].async('arraybuffer'), progress); }
      catch (error) { console.warn('Eingebettete Samsung-Hintergrund-PDF konnte nicht gelesen werden:', error); }
    }
    const canvases = [], dimensions = [];
    for (let i = 0; i < pageFiles.length && i < MAX_PAGES; i++) {
      progress('Samsung-Notes-Seite ' + (i + 1) + ' wird mit Hintergrund und Stiftstrichen gelesen …');
      const page = parseSamsungPage(await pageFiles[i].async('uint8array'));
      const basePage = pdfGeometry?.canvases?.[i] || pdfGeometry?.canvases?.[0] || null;
      const d = page ? { width: page.width, height: page.height, unit: 'native' } : (pdfGeometry?.dimensions?.[i] || pdfGeometry?.dimensions?.[0] || null);
      if (!d) continue;
      const ink = page?.paths?.length ? renderNativePathsToCanvas(page.paths, page.width, page.height, true) : null;
      if (basePage || ink) {
        canvases.push(overlayNativeInk(basePage, ink));
        dimensions.push(basePage && pdfGeometry?.dimensions?.[i] ? { ...pdfGeometry.dimensions[i] } : d);
      }
    }
    if (!canvases.length && pdfGeometry?.canvases?.length) return { ...pdfGeometry, method: 'embedded-pdf', name: 'eingebettete Samsung-PDF-Seiten', sourceFormat: 'sdocx' };
    if (canvases.length) return { canvases, dimensions, method: 'native-with-background', name: 'Samsung-Notes-Seiten', sourceFormat: 'sdocx' };
    const images = listZipFiles(zip, /(?:thumbnail|preview|media).*\.(?:png|jpe?g|webp)$/i);
    if (images.length > MAX_PAGES) throw new Error('Das Samsung-Archiv enthält mehr als ' + MAX_PAGES + ' Bildseiten.');
    if (images.length) {
      const result = [];
      for (const image of images.slice(0, MAX_PAGES)) result.push(await fileToImageCanvas(await image.async('blob')));
      return { canvases: result, dimensions: result.map(c => ({ width: c.width, height: c.height, unit: 'px' })), method: 'preview-image', name: 'Samsung-Notes-Vorschaubild(er)', sourceFormat: 'sdocx' };
    }
    throw new Error('Die Samsung-Datei enthält keine lesbaren Seitenbilder oder Stiftstriche. Exportiere sie bitte aus Samsung Notes als PDF.');
  }

  async function loadDocumentPages(file, progress) {
    const name = file.name || 'Dokument';
    const ext = name.toLowerCase().split('.').pop();
    if (file.size > MAX_FILE_BYTES) throw new Error('Die Datei ist größer als 50 MB. Bitte verkleinere sie oder teile das Dokument auf.');
    if (ext === 'pdf' || file.type === 'application/pdf') return { ...(await loadPdfCanvases(await file.arrayBuffer(), progress)), method: 'pdf', name: 'PDF-Seiten', sourceFormat: 'pdf' };
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext) || file.type.startsWith('image/')) { const canvas = await fileToImageCanvas(file); return { canvases: [canvas], dimensions: [{ width: canvas.width, height: canvas.height, unit: 'px' }], method: 'image', name: 'Bild', sourceFormat: 'png' }; }
    if (['goodnotes', 'sdocx', 'zip'].includes(ext)) {
      const JSZip = await loadZip();
      let zip;
      try { zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false, createFolders: false }); }
      catch { throw new Error('Das Notizbuch ist kein lesbares ZIP-Archiv. Verwende eine .goodnotes- oder .sdocx-Datei oder exportiere eine PDF.'); }
      let total = 0;
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const size = Number(entry._data?.uncompressedSize || 0); total += size;
        if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('Das entpackte Notizbuch ist zu groß. Bitte exportiere weniger Seiten.');
      }
      if (ext === 'sdocx') return await extractSamsung(zip, progress);
      if (ext === 'goodnotes') return await extractGoodnotes(zip, progress);
      // A .goodnotes.zip backup can contain individual .goodnotes documents.
      const nested = listZipFiles(zip, /\.goodnotes$/i);
      if (nested.length) {
        const inner = await JSZip.loadAsync(await nested[0].async('arraybuffer'));
        return await extractGoodnotes(inner, progress);
      }
      if (listZipFiles(zip, /\.page$/i).length) return await extractSamsung(zip, progress);
      return await extractGoodnotes(zip, progress);
    }
    throw new Error('Dieses Dateiformat wird nicht unterstützt. Wähle .goodnotes, .sdocx, .pdf, .png, .jpg oder .webp.');
  }

  function medianNumber(values) { const list = values.filter(Number.isFinite).sort((a,b)=>a-b); if (!list.length) return 0; const m = Math.floor(list.length/2); return list.length%2 ? list[m] : (list[m-1]+list[m])/2; }

  async function createTesseractWorker(language, progress, pageMode = '3') {
    const tesseractUrl = await loadScript('tesseract', () => !!global.Tesseract);
    progress('Ergänzende Erkennung wird vorbereitet. OCR-Engine und Sprachmodell werden geladen …');
    const logger = message => {
      if (!message) return;
      if (message.status === 'loading tesseract core') progress('OCR-Engine wird geladen …');
      else if (message.status === 'initializing tesseract') progress('OCR-Engine wird vorbereitet …');
      else if (message.status === 'loading language traineddata') progress('Sprachmodell wird geladen …');
      else if (message.status === 'recognizing text') progress('Text wird verglichen … ' + Math.round((message.progress || 0) * 100) + '%');
    };
    const workerUrl = tesseractUrl.includes('cdnjs.cloudflare.com')
      ? 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/worker.min.js'
      : tesseractUrl.includes('unpkg.com')
        ? 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js'
        : 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js';
    const workerConfigurations = [
      { workerPath: workerUrl, corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0', langPath: 'https://tessdata.projectnaptha.com/4.0.0' },
      { workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js', corePath: 'https://unpkg.com/tesseract.js-core@5.0.0', langPath: 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0' },
      { workerPath: 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js', corePath: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js-core/5.0.0', langPath: 'https://tessdata.projectnaptha.com/4.0.0' }
    ];
    const errors = [];
    for (const config of workerConfigurations) {
      let worker = null;
      try {
        worker = await global.Tesseract.createWorker(language || 'deu+eng', 1, { ...config, logger, cacheMethod: 'write', gzip: true });
        try { await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: String(pageMode) }); } catch { /* worker defaults remain usable */ }
        return worker;
      } catch (error) { errors.push(config.workerPath + ': ' + (error?.message || 'Worker-Initialisierung fehlgeschlagen')); try { await worker?.terminate(); } catch {} }
    }
    throw new Error('Tesseract konnte nicht initialisiert werden. ' + errors.join(' | '));
  }

  function normalizeOcrText(value) {
    return String(value || '').replace(/\r/g, '').normalize('NFC').replace(/[\u00a0\t]+/g, ' ').replace(/[ ]+\n/g, '\n').trim();
  }

  function tesseractLineResults(data) {
    return (data?.lines || []).map(line => {
      const box = line?.bbox;
      if (!box || ![box.x0, box.y0, box.x1, box.y1].every(value => Number.isFinite(Number(value)))) return null;
      const text = normalizeOcrText(line.text);
      if (!text) return null;
      return { text, confidence: Number(line.confidence) || Number(data?.confidence) || 0, engine: 'Tesseract', left: Number(box.x0), top: Number(box.y0), right: Number(box.x1), bottom: Number(box.y1) };
    }).filter(Boolean).sort((a,b)=>a.top-b.top || a.left-b.left);
  }

  function ocrWordParts(value) {
    const match = String(value || '').match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’\-]*)([^\p{L}\p{N}]*)$/u);
    return match ? { prefix: match[1], word: match[2], suffix: match[3] } : null;
  }

  function wordSimilarity(a, b) {
    const left = String(a || '').toLocaleLowerCase('de-DE').normalize('NFC');
    const right = String(b || '').toLocaleLowerCase('de-DE').normalize('NFC');
    if (!left || !right) return 0;
    const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 1; i <= left.length; i++) {
      let diagonal = previous[0]; previous[0] = i;
      for (let j = 1; j <= right.length; j++) {
        const above = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return 1 - previous[right.length] / Math.max(left.length, right.length, 1);
  }

  // The DE+EN Tesseract model uses its German/English word lists to offer a lexical
  // second opinion. Only confidently aligned, similar words replace a low-confidence HTR token.
  function repairWordsWithBilingualOcr(htrText, ocrWords, htrConfidence) {
    const source = normalizeOcrText(htrText);
    if (!source || !Array.isArray(ocrWords) || !ocrWords.length) return null;
    const sourceTokens = source.split(/\s+/u);
    if (sourceTokens.length !== ocrWords.length) return null;
    const confidence = Math.max(0, Math.min(1, Number(htrConfidence) || 0));
    let changed = false;
    const repaired = sourceTokens.map((token, index) => {
      const sourceParts = ocrWordParts(token);
      const candidateRaw = String(ocrWords[index]?.text || '').trim();
      const candidateParts = ocrWordParts(candidateRaw);
      const candidateConfidence = Math.max(0, Math.min(100, Number(ocrWords[index]?.confidence) || 0));
      if (!sourceParts || !candidateParts || candidateConfidence < 68) return token;
      const similarity = wordSimilarity(sourceParts.word, candidateParts.word);
      const samePrefix = sourceParts.word.toLocaleLowerCase('de-DE').startsWith(candidateParts.word.toLocaleLowerCase('de-DE'))
        || candidateParts.word.toLocaleLowerCase('de-DE').startsWith(sourceParts.word.toLocaleLowerCase('de-DE'));
      const ratio = candidateParts.word.length / Math.max(1, sourceParts.word.length);
      const plausibleLength = ratio >= .62 && ratio <= 1.55;
      const htrIsUncertain = confidence < .94;
      if (!plausibleLength || !(similarity >= .56 || (samePrefix && similarity >= .42)) || (!htrIsUncertain && similarity < .82)) return token;
      if (sourceParts.word === candidateParts.word) return token;
      changed = true;
      const prefix = sourceParts.prefix || candidateParts.prefix;
      const suffix = sourceParts.suffix || candidateParts.suffix;
      const initial = sourceParts.word[0] === sourceParts.word[0]?.toUpperCase()
        ? candidateParts.word.charAt(0).toLocaleUpperCase('de-DE') + candidateParts.word.slice(1)
        : candidateParts.word;
      return prefix + initial + suffix;
    });
    return changed ? repaired.join(' ') : null;
  }

  function shouldUseAlternativeLine(alternativeText, alternativeConfidence, htrMeta) {
    const alt = normalizeOcrText(alternativeText);
    if (!alt) return false;
    const altConfidence = Math.max(0, Math.min(100, Number(alternativeConfidence) || 0));
    const htrConfidence = Math.max(0, Math.min(1, Number(htrMeta?.confidence) || 0));
    const alphabet = String(htrMeta?.alphabet || '');
    const hasUnsupported = Array.from(alt).some(char => !/\s/u.test(char) && !alphabet.includes(char));
    const htrText = normalizeOcrText(htrMeta?.text);
    const veryDifferentLength = htrText.length > 0 && alt.replace(/\s/g, '').length > htrText.replace(/\s/g, '').length * 1.55;
    // Trust Tesseract for high-confidence printed lines, low-confidence HTR, or Unicode
    // symbols/accented characters the compact German CTC alphabet cannot emit.
    return (altConfidence >= 78 && htrConfidence < 0.93)
      || (altConfidence >= 52 && htrConfidence < 0.48)
      || (hasUnsupported && altConfidence >= 42)
      || (veryDifferentLength && altConfidence >= 88)
      || (!htrText && altConfidence >= 38);
  }


  async function runOcr(canvases, language, progress, embeddedTextPages = [], embeddedTextLayouts = []) {
    // Existing German-handwriting choice now runs the automatic mixed mode: DE·HTR reads handwriting from different writers; a
    // Tesseract line pass competes on the exact same colour-normalized line crops.
    // This preserves printed lines and symbols without replacing good handwriting output.
    if ((language === 'auto' || language === 'de-htr') && !canvases.every((_, i) => String(embeddedTextPages?.[i] || '').trim())) {
      let worker = null;
      try {
        const recognizer = global.SchreibbotGermanHandwritingRecognition;
        if (!recognizer?.recognizePages) throw new Error('Das Handschriftmodell ist nicht eingebunden.');
        // Tesseract is an optional second opinion. If its CDN or language data are blocked,
        // the specialised handwriting model must still be allowed to finish on its own.
        try { worker = await createTesseractWorker('deu+eng', progress, '7'); try { await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '7', tessedit_enable_dict_correction: '1', load_system_dawg: '1', load_freq_dawg: '1' }); } catch {} }
        catch (error) { console.warn('Zusätzliche Druckschrift-/Symbol-OCR nicht verfügbar; DE·HTR läuft allein:', error); progress('Zusatz-OCR nicht erreichbar. Deutsche Handschrift wird trotzdem erkannt …'); }
        const hybrid = await recognizer.recognizePages(canvases, progress, embeddedTextPages, embeddedTextLayouts, worker ? async (lineCanvas, meta) => {
          const response = await worker.recognize(lineCanvas);
          const data = response?.data || {};
          const text = normalizeOcrText(data.text);
          const confidence = Number(data.confidence) || 0;
          if (shouldUseAlternativeLine(text, confidence, meta)) {
            return { useAlternate: true, text, confidence: confidence / 100, engine: 'Tesseract (Deutsch + Englisch)' };
          }
          const repaired = repairWordsWithBilingualOcr(meta?.text, data.words, meta?.confidence);
          if (repaired) return { useAlternate: true, text: repaired, confidence: Math.max(.68, confidence / 100), engine: 'Tesseract-Wortkorrektur (DE + EN)' };
          return null;
        } : null);
        const emptyPages = hybrid.pageTexts.map((page, index) => String(page || '').trim() ? -1 : index).filter(index => index >= 0 && !String(embeddedTextPages?.[index] || '').trim());
        if (emptyPages.length && worker) {
          progress(emptyPages.length + ' Seite(n) sind noch leer. Vollseiten-OCR als zweite Stufe …');
          try { await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' }); } catch {}
          for (const pageIndex of emptyPages) {
            const fallback = await worker.recognize(canvases[pageIndex]);
            const text = normalizeOcrText(fallback?.data?.text);
            if (text) hybrid.pageTexts[pageIndex] = text;
            if (Array.isArray(hybrid.lineResults)) hybrid.lineResults[pageIndex] = tesseractLineResults(fallback?.data || {});
          }
          hybrid.text = hybrid.pageTexts.join('\n\n\n');
          hybrid.method = (hybrid.method || 'DE·HTR') + ' + Vollseiten-Ersatz-OCR';
        }
        if (Array.isArray(hybrid.pageTexts)) return hybrid;
      } catch (error) {
        console.warn('Automatische Handschrift-/Druckschrifterkennung nicht vollständig verfügbar:', error);
        progress('Automatische Erkennung teilweise nicht verfügbar. Standard-OCR wird verwendet …');
      } finally { try { await worker?.terminate(); } catch {} }
      language = 'deu+eng';
    }


    // Tesseract is primarily a printed-text OCR engine. For modern German handwriting,
    // use the dedicated line recognizer first; its page segmentation keeps the original
    // line order, paragraph gaps and indentation for the editor renderer.
    if (language === 'de-htr' && !canvases.every((_, i) => String(embeddedTextPages?.[i] || '').trim())) {
      try {
        const recognizer = global.SchreibbotGermanHandwritingRecognition;
        if (!recognizer?.recognizePages) throw new Error('Das deutsche Handschriftmodell ist nicht eingebunden.');
        const result = await recognizer.recognizePages(canvases, progress, embeddedTextPages, embeddedTextLayouts);
        if (Array.isArray(result?.pageTexts)) {
          const missingIndices = result.pageTexts.map((text, index) => String(text || '').trim() ? -1 : index).filter(index => index >= 0);
          if (missingIndices.length) {
            progress(missingIndices.length + ' Seite(n) sind noch leer. Für diese Seiten startet eine zweite Erkennung …');
            const fallback = await runOcr(missingIndices.map(index => canvases[index]), 'deu+eng', progress, [], []);
            const fallbackPages = fallback.pageTexts || [fallback.text || ''];
            missingIndices.forEach((index, fallbackIndex) => {
              const text = String(fallbackPages[fallbackIndex] || '').trim();
              if (text) result.pageTexts[index] = text;
              if (Array.isArray(result.lineResults)) result.lineResults[index] = fallback.lineResults?.[fallbackIndex] || [];
              if (result.layout?.pages && fallback.layout?.pages?.[fallbackIndex]) result.layout.pages[index] = fallback.layout.pages[fallbackIndex];
            });
            result.text = result.pageTexts.join('\n\n\n');
            result.method = (result.method || 'DE·HTR') + ' + Ersatz-OCR für leere Seiten';
            result.lineCount = (result.lineCount || 0) + (fallback.lineCount || 0);
            if (fallback.confidence != null) result.confidence = result.confidence == null ? fallback.confidence : (result.confidence + fallback.confidence) / 2;
          }
        }
        // Per-page fallback was already attempted above. Do not start a second full-document
        // OCR pass when that fallback also returned empty pages.
        if (Array.isArray(result?.pageTexts) || String(result?.text || '').trim()) return result;
        progress('Das Handschriftmodell hat keinen Text erkannt. Tesseract versucht eine zweite Erkennung …');
      } catch (error) {
        console.warn('DE·HTR konnte nicht verwendet werden; Tesseract wird als Ausweichweg gestartet:', error);
        progress('Das spezialisierte Handschriftmodell ist nicht verfügbar. Die Standarderkennung wird als Ersatz geladen …');
      }
      language = 'deu+eng';
    }

    if (canvases.every((_, i) => String(embeddedTextPages?.[i] || '').trim())) {
      const pages = canvases.map((_, i) => String(embeddedTextPages[i] || '').replace(/\r/g, '').trim());
      const lineResults = canvases.map((_, index) => (embeddedTextLayouts?.[index]?.lineBoxes || []).map(line => ({ ...line })));
      return { text: pages.join('\n\n\n'), pageTexts: pages, lineResults, confidence: 100, method: 'PDF-Textschicht · layouttreu', lineCount: pages.reduce((sum, page) => sum + (page.match(/\n/g) || []).length + (page ? 1 : 0), 0), layout: { pages: embeddedTextLayouts, source: 'pdf-text-layer', pageCount: canvases.length } };
    }

    const needsOcr = canvases.some((_, i) => !String(embeddedTextPages?.[i] || '').trim());
    let worker = null;
    if (needsOcr) {
      worker = await createTesseractWorker(language || 'deu+eng', progress, '3');
    }
    const pages = [], confidences = [], pageLayouts = [], lineResults = [];
    try {
      if (worker) {
        // PSM 3 is better for a mixed page layout; Tesseract remains only a fallback
        // for print or for languages without the dedicated German handwriting model.
        try { await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' }); } catch { /* default segmentation remains usable */ }
      }
      for (let i = 0; i < canvases.length; i++) {
        const embeddedText = String(embeddedTextPages?.[i] || '').replace(/\r/g, '').trim();
        if (embeddedText) {
          // Prefer a real PDF text layer over OCR; it is generally more accurate and preserves selectable text.
          progress('Text auf PDF-Seite ' + (i + 1) + ' wird direkt übernommen …');
          pages.push(embeddedText);
          confidences.push(100);
          pageLayouts.push(embeddedTextLayouts?.[i] || { width: canvases[i].width, height: canvases[i].height, lineCount: (embeddedText.match(/\n/g) || []).length + 1 });
          lineResults.push((embeddedTextLayouts?.[i]?.lineBoxes || []).map(line => ({ ...line })));
          continue;
        }
        progress('Seite ' + (i + 1) + ' von ' + canvases.length + ' wird erkannt …');
        const result = await worker.recognize(canvases[i]);
        const text = normalizeOcrText(result?.data?.text);
        pages.push(text);
        if (Number.isFinite(Number(result?.data?.confidence))) confidences.push(Number(result.data.confidence));
        const boxes = (result?.data?.lines || []).map(line => line?.bbox).filter(box => box && Number.isFinite(box.x0) && Number.isFinite(box.y0) && Number.isFinite(box.x1) && Number.isFinite(box.y1));
        const heights = boxes.map(box => Math.max(1, box.y1 - box.y0));
        const centers = boxes.map(box => (box.y0 + box.y1) / 2);
        lineResults.push(tesseractLineResults(result?.data || {}));
        const spacing = centers.slice(1).map((center, j) => Math.abs(center - centers[j]));
        pageLayouts.push({ width: canvases[i].width, height: canvases[i].height, lineCount: boxes.length || ((text.match(/\n/g) || []).length + (text ? 1 : 0)), medianLineHeight: medianNumber(heights), medianLineSpacing: medianNumber(spacing), left: boxes.length ? Math.min(...boxes.map(box=>box.x0)) : 0, top: boxes.length ? Math.min(...boxes.map(box=>box.y0)) : 0, right: boxes.length ? Math.max(...boxes.map(box=>box.x1)) : canvases[i].width, bottom: boxes.length ? Math.max(...boxes.map(box=>box.y1)) : canvases[i].height });
      }
    } finally { if (worker) await worker.terminate(); }
    return {
      text: pages.join('\n\n\n'),
      pageTexts: pages,
      lineResults,
      lineCount: pageLayouts.reduce((sum, page) => sum + (page.lineCount || 0), 0),
      confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
      method: 'Tesseract · Standard-OCR',
      layout: { pages: pageLayouts, source: 'tesseract', pageCount: canvases.length }
    };
  }

  async function runPrintedOcr(canvases, progress) {
    const worker = await createTesseractWorker('deu+eng', progress, '3');
    const pages = [];
    try {
      try { await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3', tessedit_enable_dict_correction: '1', load_system_dawg: '1', load_freq_dawg: '1' }); } catch {}
      for (let i = 0; i < canvases.length; i++) {
        progress('Gedruckter Text auf Seite ' + (i + 1) + ' wird getrennt gesucht …');
        const result = await worker.recognize(canvases[i]);
        pages.push(tesseractLineResults(result?.data || {}).filter(line => Number(line.confidence) >= 45));
      }
      return pages;
    } finally { try { await worker.terminate(); } catch {} }
  }

  function linesOverlap(a, b) {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const area = x * y;
    const minArea = Math.max(1, Math.min((a.right-a.left)*(a.bottom-a.top), (b.right-b.left)*(b.bottom-b.top)));
    return area / minArea;
  }

  function lineTextSimilarity(a, b) {
    const clean = value => String(value || '').toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]+/gu, '');
    const x = clean(a), y = clean(b);
    if (!x || !y) return 0;
    if (x === y || x.includes(y) || y.includes(x)) return 1;
    return wordSimilarity(x, y);
  }

  function sortPageLines(lines) {
    return (lines || []).filter(line => normalizeOcrText(line.text) && [line.left,line.top,line.right,line.bottom].every(value => Number.isFinite(Number(value))) && Number(line.right)>Number(line.left) && Number(line.bottom)>Number(line.top)).sort((a,b)=>a.top-b.top || a.left-b.left);
  }

  function lineBounds(canvas) {
    const ctx = canvas?.getContext?.('2d', { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return null;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    return right < left || bottom < top ? null : { left, top, right: right + 1, bottom: bottom + 1, width: right - left + 1, height: bottom - top + 1 };
  }

  function detectHandwritingInkHue(canvas, box) {
    // On mixed worksheets handwritten notes often overlap printed text. In that
    // situation, identify the dark coloured pen ink (e.g. blue) so the printed
    // black letters can remain untouched. Bright marker bands are excluded.
    const left=Math.max(0,Math.floor(Number(box.left))), right=Math.min(canvas.width,Math.ceil(Number(box.right)));
    const top=Math.max(0,Math.floor(Number(box.top))), bottom=Math.min(canvas.height,Math.ceil(Number(box.bottom)));
    if(right<=left||bottom<=top)return null;
    const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(left,top,right-left,bottom-top).data;
    const counts={blue:0,red:0,green:0,purple:0,orange:0};
    for(let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2],lum=.2126*r+.7152*g+.0722*b;
      if(lum>172)continue;
      const max=Math.max(r,g,b),min=Math.min(r,g,b);if(max-min<32)continue;
      if(b>r*1.18&&b>g*.92)counts.blue++;
      else if(r>g*1.20&&r>b*1.14)counts.red++;
      else if(g>r*1.14&&g>b*1.10)counts.green++;
      else if(r>g*1.08&&b>g*1.08)counts.purple++;
      else if(r>g*1.10&&g>b*1.05)counts.orange++;
    }
    const best=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    return best&&best[1]>=10?best[0]:null;
  }

  function pixelMatchesInkHue(r,g,b,hue) {
    if(!hue)return true;
    const lum=.2126*r+.7152*g+.0722*b;if(lum>172)return false;
    if(hue==='blue')return b>r*1.18&&b>g*.92&&Math.max(r,g,b)-Math.min(r,g,b)>=32;
    if(hue==='red')return r>g*1.20&&r>b*1.14&&Math.max(r,g,b)-Math.min(r,g,b)>=32;
    if(hue==='green')return g>r*1.14&&g>b*1.10&&Math.max(r,g,b)-Math.min(r,g,b)>=32;
    if(hue==='purple')return r>g*1.08&&b>g*1.08&&Math.max(r,g,b)-Math.min(r,g,b)>=32;
    if(hue==='orange')return r>g*1.10&&g>b*1.05&&Math.max(r,g,b)-Math.min(r,g,b)>=32;
    return false;
  }

  function eraseDetectedInk(canvas, boxes) {
    if (!Array.isArray(boxes) || !boxes.length) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data, original = new Uint8ClampedArray(data);
    const read = (x, y, c) => original[(Math.max(0, Math.min(canvas.height - 1, y)) * canvas.width + Math.max(0, Math.min(canvas.width - 1, x))) * 4 + c];
    const luminance = (r,g,b) => .2126*r + .7152*g + .0722*b;
    for (const box of boxes) {
      // If a handwriting line lies on top of printed text, erase only its detected
      // pen colour. If no separate pen colour is detectable, keep the page unchanged
      // rather than destroying the original typeset text underneath it.
      if(box.preservePrintedInk && !box.eraseHue) continue;
      const lineH = Math.max(2, Number(box.bottom) - Number(box.top));
      const padX = Math.max(2, Math.round(lineH * .16));
      const left = Math.max(0, Math.floor(Number(box.left) - padX)), right = Math.min(canvas.width, Math.ceil(Number(box.right) + padX));
      const top = Math.max(0, Math.floor(Number(box.top))), bottom = Math.min(canvas.height, Math.ceil(Number(box.bottom)));
      const sampleGap = Math.max(2, Math.round(lineH * .18));
      const yA = Math.max(0, top - sampleGap), yB = Math.min(canvas.height - 1, bottom + sampleGap);
      for (let x = left; x < right; x++) {
        const tr=read(x,yA,0),tg=read(x,yA,1),tb=read(x,yA,2),br=read(x,yB,0),bg=read(x,yB,1),bb=read(x,yB,2);
        for (let y = top; y < bottom; y++) {
          const i = (y * canvas.width + x) * 4, t=(y-top)/Math.max(1,bottom-top-1);
          if(box.preservePrintedInk&&!pixelMatchesInkHue(original[i],original[i+1],original[i+2],box.eraseHue))continue;
          const er=Math.round(tr*(1-t)+br*t), eg=Math.round(tg*(1-t)+bg*t), eb=Math.round(tb*(1-t)+bb*t);
          const currentL=luminance(data[i],data[i+1],data[i+2]), expectedL=luminance(er,eg,eb);
          const delta=Math.abs(data[i]-er)+Math.abs(data[i+1]-eg)+Math.abs(data[i+2]-eb);
          if (currentL < expectedL - 15 && delta > 38) {
            data[i]=er; data[i+1]=eg; data[i+2]=eb; data[i+3]=255;
          }
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  async function composeOriginalPages(sourcePages, linePages, renderLine, progress, drawHandwriting = true) {
    if (drawHandwriting && typeof renderLine !== 'function') throw new Error('Der Handschrift-Renderer ist nicht verfügbar.');
    const outputs = [];
    for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex++) {
      progress('Seite ' + (pageIndex + 1) + ' von ' + sourcePages.length + ': Originalelemente werden erhalten …');
      const source = sourcePages[pageIndex], page = document.createElement('canvas');
      page.width = source.width; page.height = source.height;
      const ctx = page.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0);
      const lines = sortPageLines(linePages[pageIndex] || []);
      eraseDetectedInk(page, lines);
      if (drawHandwriting) {
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex], text = normalizeOcrText(line.text);
          progress('Seite ' + (pageIndex + 1) + ': Zeile ' + (lineIndex + 1) + ' von ' + lines.length + ' wird eingesetzt …');
          const glyphCanvas = await renderLine(text);
          const bounds = lineBounds(glyphCanvas);
          if (!bounds) { try { glyphCanvas.width=1; glyphCanvas.height=1; } catch {} continue; }
          const boxW = Math.max(1, Number(line.right) - Number(line.left));
          const boxH = Math.max(1, Number(line.bottom) - Number(line.top));
          const factor = Math.min((boxW * 1.03) / bounds.width, (boxH * .90) / bounds.height);
          const drawW = bounds.width * factor, drawH = bounds.height * factor;
          const x = Math.max(0, Number(line.left));
          const y = Math.max(0, Number(line.top) + (boxH - drawH) / 2);
          ctx.drawImage(glyphCanvas, bounds.left, bounds.top, bounds.width, bounds.height, x, y, drawW, drawH);
          try { glyphCanvas.width = 1; glyphCanvas.height = 1; } catch {}
        }
      }
      outputs.push(page);
    }
    return outputs;
  }

  function init(options) {
    const fileInput = document.getElementById('handwritingImportFile');
    if (!fileInput) return;
    const status = document.getElementById('handwritingImportStatus');
    const fileLabel = document.getElementById('handwritingImportFileName');
    const startButton = document.getElementById('handwritingImportRun');
    const review = document.getElementById('handwritingImportText');
    const reviewWrap = document.getElementById('handwritingImportReview');
    const preview = document.getElementById('handwritingImportPreview');
    const applyButton = document.getElementById('handwritingImportApply');
    const createButton = document.getElementById('handwritingImportCreate');
    const targetSelect = document.getElementById('handwritingImportTarget');
    const languageSelect = document.getElementById('handwritingImportLanguage');
    const convertPrinted = document.getElementById('handwritingImportConvertPrinted');
    let selectedFile = null, preparedPages = null, preparedHandwritingLines = null, preparedPrintedLines = null;
    let lastConfidence = null, preparedLayout = null, lastMethod = '', busy = false;

    function activeLinePages() {
      return (preparedPages || []).map((_, index) => sortPageLines([
        ...(preparedHandwritingLines?.[index] || []),
        ...(convertPrinted?.checked ? (preparedPrintedLines?.[index] || []) : [])
      ]));
    }
    function makeReviewText(linesByPage) { return linesByPage.map(lines => lines.map(line => line.text).join('\n')).join('\n\n\n'); }
    function updateReviewForMode() {
      if (!preparedPages) return;
      const active = activeLinePages();
      review.value = makeReviewText(active);
      const handCount = preparedHandwritingLines?.reduce((n, lines) => n + (lines?.length || 0), 0) || 0;
      const printCount = convertPrinted?.checked ? (preparedPrintedLines?.reduce((n, lines) => n + (lines?.length || 0), 0) || 0) : 0;
      if (!handCount && !printCount) setStatus(status, 'Keine passenden Zeilen erkannt. Aktiviere „Gedruckten Text mit umwandeln“ oder nutze eine schärfere Datei.', 'error');
      else setStatus(status, (convertPrinted?.checked ? 'Handschrift und gedruckter Text' : 'Nur handschriftliche Zeilen') + ' ausgewählt · ' + active.reduce((n, lines) => n + lines.length, 0) + ' Zeile(n).', 'success');
      createButton.disabled = active.every(lines => !lines.length);
      applyButton.disabled = !review.value.trim();
    }

    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files?.[0] || null;
      preparedPages = null; preparedHandwritingLines = null; preparedPrintedLines = null; lastConfidence = null; preparedLayout = null; lastMethod = '';
      review.value = ''; reviewWrap.hidden = true; preview.hidden = true; preview.replaceChildren();
      fileLabel.textContent = selectedFile ? selectedFile.name + ' · ' + Math.ceil(selectedFile.size / 1024) + ' KB' : 'Noch keine Datei ausgewählt';
      startButton.disabled = !selectedFile || busy; applyButton.disabled = true; createButton.disabled = true;
      if (targetSelect) targetSelect.value = 'auto';
      setStatus(status, selectedFile ? 'Datei bereit. Ausgabeformat wird aus der Originaldatei übernommen.' : 'Noch keine Datei ausgewählt.', '');
    });
    convertPrinted?.addEventListener('change', updateReviewForMode);

    async function recognise() {
      if (!selectedFile || busy) return;
      busy = true; startButton.disabled = true; applyButton.disabled = true; createButton.disabled = true;
      reviewWrap.hidden = true; preview.hidden = true; preview.replaceChildren();
      const progress = message => setStatus(status, message, 'working');
      try {
        progress('Datei wird geöffnet …');
        const loaded = await loadDocumentPages(selectedFile, progress);
        const canvases = loaded.canvases || [];
        if (!canvases.length) throw new Error('Es wurden keine Seiten zum Erkennen gefunden.');
        if (canvases.length > MAX_PAGES) throw new Error('Es können maximal ' + MAX_PAGES + ' Seiten pro Import verarbeitet werden.');
        preparedPages = canvases;
        const first = canvases[0], img = document.createElement('canvas');
        img.className = 'handwritingImportThumb'; img.width = first.width; img.height = first.height;
        img.getContext('2d').drawImage(first, 0, 0); preview.appendChild(img); preview.hidden = false;
        // Always run handwriting recognition on the rendered page, even when the PDF
        // also has a selectable text layer. The latter is kept separately as printed text.
        const result = await runOcr(canvases, languageSelect.value, progress, [], []);
        lastConfidence = result.confidence;
        preparedLayout = result.layout || { pages: canvases.map(canvas => ({ width: canvas.width, height: canvas.height })), source: result.method || 'unknown', pageCount: canvases.length };
        preparedLayout.sourceDimensions = loaded.dimensions || canvases.map(canvas => ({ width: canvas.width, height: canvas.height, unit: 'px' }));
        preparedLayout.sourceFile = selectedFile?.name || '';
        preparedLayout.sourceFormat = loaded.sourceFormat || 'pdf';
        lastMethod = result.method || 'Texterkennung';

        const rawLines = Array.isArray(result.lineResults) ? result.lineResults : canvases.map(() => []);
        preparedHandwritingLines = rawLines.map(lines => sortPageLines(lines.filter(line => !/tesseract|pdf-textschicht/i.test(String(line.engine || '')))));
        const printedPages = canvases.map((_, index) => sortPageLines(loaded.textLayouts?.[index]?.lineBoxes || []));
        const needsPrintedOcr = canvases.map((_, index) => !printedPages[index].length);
        if (needsPrintedOcr.some(Boolean)) {
          try {
            const scannedIndexes = needsPrintedOcr.map((needed, index) => needed ? index : -1).filter(index => index >= 0);
            const detected = await runPrintedOcr(scannedIndexes.map(index => canvases[index]), progress);
            scannedIndexes.forEach((pageIndex, localIndex) => { printedPages[pageIndex] = sortPageLines(detected[localIndex] || []); });
          } catch (error) {
            console.warn('Zusätzliche Drucktexterkennung nicht verfügbar:', error);
            progress('Drucktexterkennung nicht verfügbar. Erkannte Handschrift kann trotzdem umgewandelt werden …');
          }
        }
        // Remove printed-line matches from the handwriting set so the unchecked mode
        // never overwrites ordinary typeset text. Tesseract high-confidence line matches
        // and PDF text-layer geometry are treated as print, not as handwriting.
        preparedPrintedLines = printedPages;
        preparedHandwritingLines = preparedHandwritingLines.map((lines, index) => lines.flatMap(hand => {
          const printMatches=(preparedPrintedLines[index]||[]).map(print=>({print,overlap:linesOverlap(hand,print)})).filter(match=>match.overlap>=.28);
          if(!printMatches.length)return [hand];
          // Treat nearly identical HTR/print output as the same printed line. If the
          // HTR text differs, keep it as a handwritten annotation. Its pen colour is
          // removed selectively so the printed letters remain visible when the
          // printed-text checkbox is off.
          const strongest=printMatches.sort((a,b)=>b.overlap-a.overlap)[0];
          if(lineTextSimilarity(hand.text,strongest.print.text)>=.78)return [];
          const eraseHue=detectHandwritingInkHue(canvases[index],hand);
          return [{...hand,preservePrintedInk:true,eraseHue}];
        }));
        preparedLayout.textPages = loaded.textPages || [];
        reviewWrap.hidden = false;
        updateReviewForMode();
        const active = activeLinePages();
        const activeCount = active.reduce((n, lines) => n + lines.length, 0);
        const handCount = preparedHandwritingLines.reduce((n, lines) => n + lines.length, 0);
        const printCount = preparedPrintedLines.reduce((n, lines) => n + lines.length, 0);
        const confidence = lastConfidence == null ? '' : ' · Modell-Richtwert ca. ' + Math.round(lastConfidence) + '%';
        if (!activeCount) {
          setStatus(status, 'Keine Zeilen für diese Auswahl erkannt. Prüfe die Datei oder aktiviere die Umwandlung von gedrucktem Text.' + confidence, 'error');
          applyButton.disabled = true; createButton.disabled = true;
        } else {
          setStatus(status, canvases.length + ' Seite(n) erkannt · ' + handCount + ' Handschriftzeile(n) · ' + printCount + ' Drucktextzeile(n). ' + (convertPrinted?.checked ? 'Beide Arten werden ersetzt.' : 'Standard: Nur Handschrift wird ersetzt.') + confidence, 'success');
          applyButton.disabled = false; createButton.disabled = false;
        }
      } catch (error) {
        console.error('Schreibbot-Handschriftimport fehlgeschlagen:', error);
        setStatus(status, error?.message || 'Die Datei konnte nicht verarbeitet werden.', 'error');
      } finally { busy = false; startButton.disabled = !selectedFile; }
    }

    function applyText() {
      const text = String(review.value || '').replace(/\r/g, '').trimEnd();
      if (!text.trim()) { setStatus(status, 'Es gibt keinen erkannten Text zum Übernehmen.', 'error'); return false; }
      try { options.applyLayout?.(preparedLayout); } catch (error) { console.warn('Import-Layout konnte nicht automatisch übernommen werden:', error); }
      options.textEl.value = text;
      const fontSelect = document.getElementById('fontPreset');
      if (fontSelect) { fontSelect.value = 'handwriting'; fontSelect.dispatchEvent(new Event('change', { bubbles: true })); }
      options.textEl.dispatchEvent(new Event('input', { bubbles: true }));
      options.textEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setStatus(status, 'Text wurde in den Editor übernommen.', 'success');
      return true;
    }

    applyButton.addEventListener('click', applyText);
    createButton.addEventListener('click', async () => {
      const pageLines = activeLinePages();
      if (!preparedPages?.length || pageLines.every(lines => !lines.length)) {
        setStatus(status, 'Für diese Auswahl wurden keine passenden Textpositionen erkannt.', 'error'); return;
      }
      const fileBase = (selectedFile?.name || 'schreibbot').replace(/\.[^.]+$/, '').replace(/\.goodnotes$/i,'');
      const kind = targetSelect?.value === 'auto' || !targetSelect?.value ? preparedLayout.sourceFormat : targetSelect.value;
      if (kind === 'sdocx') {
        setStatus(status, 'Samsung-Notes-Dateien mit Fotos und Markierungen können noch nicht sicher als natives .sdocx zurückgeschrieben werden. Dafür benötige ich eine echte .sdocx-Beispieldatei mit einer Seite, auf der Bild oder Textmarker enthalten sind.', 'error');
        return;
      }
      if (!['pdf','png','goodnotes'].includes(kind)) { setStatus(status, 'Das Ausgabeformat ist nicht verfügbar.', 'error'); return; }
      createButton.disabled = true; applyButton.disabled = true;
      try {
        setStatus(status, 'Originalseiten werden kopiert. Nur die ausgewählten Schriftzeilen werden entfernt und neu eingesetzt …', 'working');
        const correctedPages = review.value.replace(/\r/g,'').split(/\n{3,}/u);
        const renderLines = pageLines.map((lines, pageIndex) => {
          const raw = String(correctedPages[pageIndex] ?? '').replace(/\r/g,'');
          const edited = raw.split('\n').map(line => line.trim()).filter(Boolean);
          if (edited.length !== lines.length) throw new Error('Bitte ändere beim Korrigieren nicht die Anzahl oder Reihenfolge der Zeilen. Pro erkannter Zeile muss eine Textzeile stehen.');
          return lines.map((line, index) => ({ ...line, text: edited[index] }));
        });
        const progress = message => setStatus(status, message, 'working');
        const backgroundPages = await composeOriginalPages(preparedPages, renderLines, options.renderLine, progress, false);
        const resultPages = await composeOriginalPages(preparedPages, renderLines, options.renderLine, progress, true);
        await options.exportRewrittenDocument({ pages: resultPages, backgroundPages, linePages: renderLines, renderLine: options.renderLine, dimensions: preparedLayout.sourceDimensions || [], target: kind, sourceFormat: preparedLayout.sourceFormat, fileBase });
        const doneName = kind === 'goodnotes' ? 'GoodNotes-Notizbuch mit editierbaren Stiftstrichen' : kind === 'png' ? 'PNG-Datei(en)' : 'PDF-Datei';
        setStatus(status, doneName + ' erstellt. Bilder, Farben und Markierungen blieben als Seitenhintergrund erhalten.', 'success');
      } catch (error) {
        console.error('Originalseiten-Import konnte nicht exportiert werden:', error);
        setStatus(status, 'Umwandlung fehlgeschlagen: ' + (error?.message || error), 'error');
      } finally { createButton.disabled = false; applyButton.disabled = false; }
    });

    startButton.addEventListener('click', recognise);
  }

  global.SchreibbotHandwritingImport = { init };
})(window);
