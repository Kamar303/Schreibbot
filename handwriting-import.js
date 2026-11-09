/* Schreibbot handwriting import v84
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

  function renderNativePathsToCanvas(paths, pageWidth, pageHeight) {
    const scale = Math.min(OCR_WIDTH / Math.max(1, pageWidth), OCR_HEIGHT / Math.max(1, pageHeight));
    const width = Math.max(400, Math.round(pageWidth * scale));
    const height = Math.max(400, Math.round(pageHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
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
    const canvases = [], textPages = [], dimensions = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      progress('PDF-Seite ' + i + ' von ' + pdf.numPages + ' wird vorbereitet …');
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 }), scale = Math.min(2.2, OCR_WIDTH / base.width, OCR_HEIGHT / base.height);
      dimensions.push({ width: base.width, height: base.height });
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
      try {
        const content = await page.getTextContent();
        const text = (content.items || []).map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
        textPages.push(text);
      } catch { textPages.push(''); }
      if (canvases.length > MAX_PAGES) throw new Error('Zu viele PDF-Seiten.');
    }
    return { canvases, textPages, dimensions };
  }

  async function loadZip() { await loadScript('zip', () => !!global.JSZip); return global.JSZip; }

  function listZipFiles(zip, regex) {
    return Object.values(zip.files).filter(f => !f.dir && regex.test(f.name));
  }

  async function extractGoodnotes(zip, progress) {
    const noteFiles = listZipFiles(zip, /^notes\/[^/]+$/i).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (noteFiles.length > MAX_PAGES) throw new Error('Das GoodNotes-Notizbuch hat ' + noteFiles.length + ' Seiten. Pro Import sind höchstens ' + MAX_PAGES + ' Seiten möglich.');
    // Use the attached PDF only to read the exact page geometry. In a native GoodNotes
    // notebook it is often just paper/background; the handwriting itself lives in notes/*.pb.
    const pdfFiles = listZipFiles(zip, /\.pdf$/i).sort((a, b) => b.name.length - a.name.length);
    let pdfGeometry = null;
    if (pdfFiles.length) {
      try { pdfGeometry = await loadPdfCanvases(await pdfFiles[0].async('arraybuffer'), progress); }
      catch (error) { console.warn('GoodNotes-Papiermaße konnten nicht aus der PDF-Vorlage gelesen werden:', error); }
    }
    const pages = [];
    for (let i = 0; i < noteFiles.length && pages.length < MAX_PAGES; i++) {
      progress('GoodNotes-Stiftstriche auf Seite ' + (i + 1) + ' werden gelesen …');
      const bytes = await noteFiles[i].async('uint8array');
      const paths = parseGoodnotesPage(bytes);
      if (paths.length) {
        const dimensions = pdfGeometry?.dimensions?.[i] || pdfGeometry?.dimensions?.[0] || { width: 455.04, height: 588.45 };
        pages.push(renderNativePathsToCanvas(paths, dimensions.width, dimensions.height));
      }
    }
    if (pages.length) return { canvases: pages, method: 'native', name: 'GoodNotes-Stiftstriche' };
    // Other GoodNotes documents may contain an embedded PDF or preview image. The PDF is the best fallback.
    if (pdfGeometry?.canvases?.length) return { ...pdfGeometry, method: 'embedded-pdf', name: 'eingebettete PDF-Seiten' };
    const images = listZipFiles(zip, /(?:thumbnail|preview|page|media).*\.(?:png|jpe?g|webp)$/i).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (images.length > MAX_PAGES) throw new Error('Das GoodNotes-Archiv enthält mehr als ' + MAX_PAGES + ' Bildseiten.');
    if (images.length) {
      const result = [];
      for (const image of images.slice(0, MAX_PAGES)) {
        const blob = await image.async('blob'); result.push(await fileToImageCanvas(blob));
      }
      return { canvases: result, method: 'preview-image', name: 'GoodNotes-Vorschaubild(er)' };
    }
    throw new Error('In dieser GoodNotes-Datei wurden keine lesbaren Stiftstriche, PDF-Seiten oder Vorschaubilder gefunden. Exportiere das Notizbuch alternativ aus GoodNotes als PDF und lade diese PDF hier hoch.');
  }

  async function extractSamsung(zip, progress) {
    const pageFiles = listZipFiles(zip, /\.page$/i).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (pageFiles.length > MAX_PAGES) throw new Error('Die Samsung-Notes-Datei hat ' + pageFiles.length + ' Seiten. Pro Import sind höchstens ' + MAX_PAGES + ' Seiten möglich.');
    const canvases = [];
    for (let i = 0; i < pageFiles.length && i < MAX_PAGES; i++) {
      progress('Samsung-Notes-Stiftstriche auf Seite ' + (i + 1) + ' werden gelesen …');
      const bytes = await pageFiles[i].async('uint8array');
      const page = parseSamsungPage(bytes);
      if (page && page.paths.length) canvases.push(renderNativePathsToCanvas(page.paths, page.width, page.height));
    }
    if (canvases.length) return { canvases, method: 'native', name: 'Samsung-Notes-Stiftstriche' };
    const pdfFiles = listZipFiles(zip, /\.pdf$/i);
    if (pdfFiles.length) {
      const result = await loadPdfCanvases(await pdfFiles[0].async('arraybuffer'), progress);
      return { ...result, method: 'embedded-pdf', name: 'eingebettete PDF-Seiten' };
    }
    const images = listZipFiles(zip, /(?:thumbnail|preview|media).*\.(?:png|jpe?g|webp)$/i);
    if (images.length > MAX_PAGES) throw new Error('Das Samsung-Archiv enthält mehr als ' + MAX_PAGES + ' Bildseiten.');
    if (images.length) {
      const result = [];
      for (const image of images.slice(0, MAX_PAGES)) result.push(await fileToImageCanvas(await image.async('blob')));
      return { canvases: result, method: 'preview-image', name: 'Samsung-Notes-Vorschaubild(er)' };
    }
    throw new Error('Die Samsung-Datei enthält keine lesbaren Stiftstriche oder Seitenbilder. Prüfe, ob es eine .sdocx-Datei ist, oder exportiere sie aus Samsung Notes als PDF.');
  }

  async function loadDocumentPages(file, progress) {
    const name = file.name || 'Dokument';
    const ext = name.toLowerCase().split('.').pop();
    if (file.size > MAX_FILE_BYTES) throw new Error('Die Datei ist größer als 50 MB. Bitte verkleinere sie oder teile das Dokument auf.');
    if (ext === 'pdf' || file.type === 'application/pdf') return { ...(await loadPdfCanvases(await file.arrayBuffer(), progress)), method: 'pdf', name: 'PDF-Seiten' };
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext) || file.type.startsWith('image/')) return { canvases: [await fileToImageCanvas(file)], method: 'image', name: 'Bild' };
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

  async function runOcr(canvases, language, progress, embeddedTextPages = []) {
    const needsOcr = canvases.some((_, i) => !String(embeddedTextPages?.[i] || '').trim());
    let worker = null;
    if (needsOcr) {
      const tesseractUrl = await loadScript('tesseract', () => !!global.Tesseract);
      progress('Texterkennung wird vorbereitet. Die OCR-Engine und das Sprachmodell werden geladen …');
      const logger = message => {
        if (!message) return;
        if (message.status === 'loading tesseract core') progress('OCR-Engine wird geladen …');
        else if (message.status === 'initializing tesseract') progress('OCR-Engine wird vorbereitet …');
        else if (message.status === 'loading language traineddata') progress('Sprachmodell wird geladen …');
        else if (message.status === 'recognizing text') progress('Handschrift wird erkannt … ' + Math.round((message.progress || 0) * 100) + '%');
      };
      const workerUrl = tesseractUrl.includes('cdnjs.cloudflare.com')
        ? 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/worker.min.js'
        : tesseractUrl.includes('unpkg.com')
          ? 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js'
          : 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js';
      const workerConfigurations = [
        {
          workerPath: workerUrl,
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
          langPath: 'https://tessdata.projectnaptha.com/4.0.0'
        },
        {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
          corePath: 'https://unpkg.com/tesseract.js-core@5.0.0',
          langPath: 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0'
        }
      ];
      const workerErrors = [];
      for (const config of workerConfigurations) {
        try {
          worker = await global.Tesseract.createWorker(language || 'deu+eng', 1, {
            ...config,
            logger,
            cacheMethod: 'write',
            gzip: true
          });
          break;
        } catch (error) {
          workerErrors.push(config.workerPath + ' / ' + config.langPath + ': ' + (error?.message || 'OCR-Initialisierung fehlgeschlagen'));
        }
      }
      if (!worker) {
        throw new Error('Die OCR-Engine wurde geladen, konnte aber Worker, WASM-Kern oder Sprachmodell nicht initialisieren. Prüfe, ob CDN- und Sprachmodell-Adressen durch dein Netzwerk erlaubt sind. Details: ' + workerErrors.join(' | '));
      }
    }
    const pages = [], confidences = [];
    try {
      if (worker) {
        try { await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' }); } catch { /* default segmentation remains usable */ }
      }
      for (let i = 0; i < canvases.length; i++) {
        const embeddedText = String(embeddedTextPages?.[i] || '').replace(/\r/g, '').trim();
        if (embeddedText) {
          // Prefer a real PDF text layer over OCR; it is generally more accurate and preserves selectable text.
          progress('Text auf PDF-Seite ' + (i + 1) + ' wird direkt übernommen …');
          pages.push(embeddedText);
          confidences.push(100);
          continue;
        }
        progress('Seite ' + (i + 1) + ' von ' + canvases.length + ' wird erkannt …');
        const result = await worker.recognize(canvases[i]);
        const text = String(result?.data?.text || '').replace(/\r/g, '').trim();
        pages.push(text);
        if (Number.isFinite(Number(result?.data?.confidence))) confidences.push(Number(result.data.confidence));
      }
    } finally { if (worker) await worker.terminate(); }
    return { text: pages.join('\n\n'), confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null };
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
    let selectedFile = null, preparedPages = null, lastConfidence = null, busy = false;

    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files?.[0] || null;
      preparedPages = null; lastConfidence = null; review.value = ''; reviewWrap.hidden = true; preview.hidden = true; preview.replaceChildren();
      fileLabel.textContent = selectedFile ? selectedFile.name + ' · ' + Math.ceil(selectedFile.size / 1024) + ' KB' : 'Noch keine Datei ausgewählt';
      startButton.disabled = !selectedFile || busy;
      applyButton.disabled = true; createButton.disabled = true;
      setStatus(status, selectedFile ? 'Datei bereit. Starte die Erkennung.' : 'Noch keine Datei ausgewählt.', '');
    });

    async function recognise() {
      if (!selectedFile || busy) return;
      busy = true; startButton.disabled = true; applyButton.disabled = true; createButton.disabled = true;
      reviewWrap.hidden = true; preview.hidden = true; preview.replaceChildren();
      const progress = message => setStatus(status, message, 'working');
      let canvases = [];
      try {
        progress('Datei wird geöffnet …');
        const loaded = await loadDocumentPages(selectedFile, progress);
        canvases = loaded.canvases || [];
        if (!canvases.length) throw new Error('Es wurden keine Seiten zum Erkennen gefunden.');
        if (canvases.length > MAX_PAGES) throw new Error('Es können maximal ' + MAX_PAGES + ' Seiten pro Import verarbeitet werden.');
        preparedPages = canvases;
        const first = canvases[0];
        const img = document.createElement('canvas'); img.className = 'handwritingImportThumb';
        img.width = first.width; img.height = first.height;
        img.getContext('2d').drawImage(first, 0, 0);
        preview.appendChild(img); preview.hidden = false;
        const result = await runOcr(canvases, languageSelect.value, progress, loaded.textPages || []);
        lastConfidence = result.confidence;
        review.value = result.text;
        reviewWrap.hidden = false;
        const confidence = lastConfidence == null ? '' : ' · mittlere Erkennungssicherheit ca. ' + Math.round(lastConfidence) + '%';
        if (!result.text.trim()) {
          setStatus(status, 'Die Seiten wurden gelesen (' + canvases.length + '), aber es wurde kein Text sicher erkannt. Prüfe das Bild oder exportiere eine schärfere Vorlage.' + confidence, 'error');
          applyButton.disabled = true; createButton.disabled = true;
        } else {
          setStatus(status, canvases.length + ' Seite(n) verarbeitet · Quelle: ' + loaded.name + confidence + '. Bitte den erkannten Text kurz prüfen und Fehler korrigieren.', 'success');
          applyButton.disabled = false; createButton.disabled = false;
        }
      } catch (error) {
        console.error('Schreibbot-Handschriftimport fehlgeschlagen:', error);
        setStatus(status, error?.message || 'Die Datei konnte nicht verarbeitet werden.', 'error');
      } finally {
        busy = false; startButton.disabled = !selectedFile;
      }
    }

    function applyText() {
      const text = String(review.value || '').replace(/\r/g, '').trim();
      if (!text) { setStatus(status, 'Es gibt keinen erkannten Text zum Übernehmen.', 'error'); return false; }
      options.textEl.value = text;
      const fontSelect = document.getElementById('fontPreset');
      if (fontSelect) { fontSelect.value = 'handwriting'; fontSelect.dispatchEvent(new Event('change', { bubbles: true })); }
      options.textEl.dispatchEvent(new Event('input', { bubbles: true }));
      options.textEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setStatus(status, 'Text wurde in den Editor übernommen. Deine gespeicherten Buchstaben und Wörter werden jetzt verwendet.', 'success');
      return true;
    }

    applyButton.addEventListener('click', applyText);
    createButton.addEventListener('click', async () => {
      if (!applyText()) return;
      const kind = targetSelect.value;
      createButton.disabled = true;
      try {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (kind === 'goodnotes') options.exportGoodnotes();
        else if (kind === 'samsung') options.exportSamsung();
        else if (kind === 'png') await options.exportPng();
        else await options.exportPdf();
      } catch (error) {
        console.error('Import-Export konnte nicht gestartet werden:', error);
        setStatus(status, 'Text wurde übernommen, der Export konnte aber nicht gestartet werden: ' + (error?.message || error), 'error');
      } finally { createButton.disabled = false; }
    });

    startButton.addEventListener('click', recognise);
  }

  global.SchreibbotHandwritingImport = { init };
})(window);
