/* Schreibbot v97 – color-separated handwriting OCR, adaptive line segmentation and CTC beam search
 * Uses the Apache-2.0 DE·HTR line recognizer (ONNX) for modern German handwriting.
 * The model is downloaded once and cached locally in IndexedDB. Page-line segmentation,
 * crops and inference run in the browser; source documents are not uploaded.
 * DE·HTR handles modern German handwriting from varied writers; Tesseract is used per line as a print/symbol fallback.
 * Color ink is normalized to high-contrast monochrome before recognition; source documents stay local.
 */
(function (global) {
  'use strict';

  const ORT_VERSION = '1.27.0';
  const ORT_SOURCES = [
    `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.min.js`,
    `https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.min.js`
  ];
  const MODEL_VARIANTS = [
    {
      id: 'de-htr-v2',
      label: 'DE·HTR v2',
      url: 'https://huggingface.co/naeyn/de-htr-web-v2/resolve/main/model.onnx?download=true',
      config: {
        formatVersion: 2, inputName: 'image', outputName: 'logits', inputChannels: 1,
        imageHeight: 64, maxWidth: 1024, outputStride: 4, blankIndex: 0,
        alphabet: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZäöüÄÖÜß0123456789 .,;:!?"\'()[]{}<>-–—_/\\@#%&*+=|€§°²³→←↑↓×÷',
        preprocessing: { scale: 1 / 255, padValue: 1 }
      }
    },
    {
      id: 'de-htr-v1',
      label: 'DE·HTR v1 (Ausweichmodell)',
      url: 'https://huggingface.co/naeyn/de-htr-web/resolve/main/model.onnx?download=true',
      config: {
        formatVersion: 1, inputName: 'images', outputName: 'log_probs', inputChannels: 3,
        imageHeight: 64, maxWidth: 2048, outputStride: 4, blankIndex: 0,
        alphabet: ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿōال–’”',
        normalization: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] }
      }
    }
  ];

  let runtimePromise = null;
  let activeSessionPromise = null;
  let memoryModelCache = new Map();

  function report(progress, message) { if (typeof progress === 'function') progress(message); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function median(values) {
    const list = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!list.length) return 0;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let finished = false;
      const timer = setTimeout(() => finish(new Error('Ladezeit überschritten: ' + url)), 12000);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) { script.remove(); reject(error); }
        else resolve();
      }
      script.async = true;
      script.src = url;
      script.onload = () => global.ort?.InferenceSession ? finish() : finish(new Error('ONNX Runtime wurde geladen, aber ist nicht verfügbar.'));
      script.onerror = () => finish(new Error('ONNX Runtime konnte nicht geladen werden: ' + url));
      document.head.appendChild(script);
    });
  }

  async function loadRuntime(progress) {
    if (global.ort?.InferenceSession) return global.ort;
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
      const failures = [];
      for (const url of ORT_SOURCES) {
        try {
          report(progress, 'Handschriftmodell: ONNX-Laufzeit wird geladen …');
          await loadScript(url);
          const base = url.slice(0, url.lastIndexOf('/') + 1);
          global.ort.env.wasm.wasmPaths = base;
          const cores = Math.max(1, Number(global.navigator?.hardwareConcurrency) || 2);
          global.ort.env.wasm.numThreads = global.crossOriginIsolated && global.SharedArrayBuffer ? Math.max(1, Math.min(4, cores - 1)) : 1;
          global.ort.env.wasm.proxy = false;
          return global.ort;
        } catch (error) { failures.push(error.message); }
      }
      throw new Error('Die Laufzeit für das Handschriftmodell konnte nicht geladen werden. ' + failures.join(' | '));
    })().catch(error => { runtimePromise = null; throw error; });
    return runtimePromise;
  }

  function openModelDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in global)) return reject(new Error('IndexedDB nicht verfügbar'));
      const request = indexedDB.open('schreibbot-handwriting-models', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('models')) db.createObjectStore('models');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Modellcache konnte nicht geöffnet werden.'));
    });
  }

  async function readCachedModel(id) {
    if (memoryModelCache.has(id)) return memoryModelCache.get(id);
    let db;
    try {
      db = await openModelDb();
      const value = await new Promise((resolve, reject) => {
        const request = db.transaction('models', 'readonly').objectStore('models').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (value instanceof ArrayBuffer && value.byteLength > 5 * 1024 * 1024) {
        memoryModelCache.set(id, value);
        return value;
      }
    } catch (error) { console.warn('Schreibbot: Modellcache konnte nicht gelesen werden:', error); try { db?.close(); } catch {} }
    return null;
  }

  async function writeCachedModel(id, bytes) {
    memoryModelCache.set(id, bytes);
    let db;
    try {
      db = await openModelDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readwrite');
        tx.objectStore('models').put(bytes, id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Modell konnte nicht zwischengespeichert werden.'));
        tx.onabort = () => reject(tx.error || new Error('Modellcache wurde abgebrochen.'));
      });
    } catch (error) { console.warn('Schreibbot: Modell wird nur für diese Sitzung gespeichert:', error); }
    finally { try { db?.close(); } catch {} }
  }

  async function getModelBytes(variant, progress) {
    const cached = await readCachedModel(variant.id);
    if (cached) {
      report(progress, 'Handschriftmodell aus dem Gerätespeicher geladen …');
      return new Uint8Array(cached);
    }
    report(progress, 'Deutsches Handschriftmodell wird einmalig geladen (ca. 10 MB) …');
    let response;
    try { response = await fetch(variant.url, { mode: 'cors', cache: 'force-cache', credentials: 'omit' }); }
    catch (error) { throw new Error('Das deutsche Handschriftmodell konnte nicht geladen werden. Prüfe die Internetverbindung oder erlaube huggingface.co in deinem Netzwerk. Details: ' + (error?.message || error)); }
    if (!response.ok) throw new Error('Das Handschriftmodell antwortet mit HTTP ' + response.status + '. Bitte versuche es später erneut.');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 5 * 1024 * 1024) throw new Error('Die geladene Modelldatei ist unerwartet klein (' + buffer.byteLength + ' Bytes). Der Download wurde nicht verwendet.');
    await writeCachedModel(variant.id, buffer);
    return new Uint8Array(buffer);
  }

  async function createSession(variant, ort, progress) {
    const bytes = await getModelBytes(variant, progress);
    report(progress, variant.label + ' wird initialisiert …');
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    return { session, config: variant.config, variant };
  }

  async function loadSession(progress) {
    if (activeSessionPromise) return activeSessionPromise;
    activeSessionPromise = (async () => {
      const ort = await loadRuntime(progress);
      const errors = [];
      for (const variant of MODEL_VARIANTS) {
        try { return await createSession(variant, ort, progress); }
        catch (error) { errors.push(variant.label + ': ' + (error?.message || error)); }
      }
      throw new Error('Kein deutsches Handschriftmodell konnte gestartet werden. ' + errors.join(' | '));
    })().catch(error => { activeSessionPromise = null; throw error; });
    return activeSessionPromise;
  }

  function estimateBackground(pixels, width, height) {
    const channels = [[], [], []];
    const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 180));
    const add = i => { channels[0].push(pixels[i]); channels[1].push(pixels[i + 1]); channels[2].push(pixels[i + 2]); };
    for (let x = 0; x < width; x += sampleStep) {
      add(x * 4);
      add(((height - 1) * width + x) * 4);
    }
    for (let y = 0; y < height; y += sampleStep) {
      add((y * width) * 4);
      add((y * width + width - 1) * 4);
    }
    const bg = { r: median(channels[0]), g: median(channels[1]), b: median(channels[2]) };
    const edgeDistances = [];
    for (let c = 0; c < channels[0].length; c++) {
      const dr = channels[0][c] - bg.r, dg = channels[1][c] - bg.g, db = channels[2][c] - bg.b;
      edgeDistances.push(Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db));
    }
    bg.threshold = clamp(10 + median(edgeDistances) * 3.2, 12, 38);
    return bg;
  }

  function pixelMetrics(pixels, index, x, y, width, height, background) {
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    const dr = r - background.r, dg = g - background.g, db = b - background.b;
    const distance = Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const at = (px, py) => {
      const i = (py * width + px) * 4;
      return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    };
    let gradient = 255;
    // Only calculate local gradients for bright saturated regions. This keeps the
    // per-pixel pass fast for ordinary black/blue handwriting while suppressing flat marker fills.
    const mayBeHighlighter = lum > 188 && saturation > 42 && distance < 150;
    if (mayBeHighlighter) {
      gradient = 0;
      if (x > 0) gradient = Math.max(gradient, Math.abs(lum - at(x - 1, y)));
      if (x + 1 < width) gradient = Math.max(gradient, Math.abs(lum - at(x + 1, y)));
      if (y > 0) gradient = Math.max(gradient, Math.abs(lum - at(x, y - 1)));
      if (y + 1 < height) gradient = Math.max(gradient, Math.abs(lum - at(x, y + 1)));
    }
    // Pale, flat highlighter fills are not treated as ink. Their edges and any writing
    // placed over them remain detectable; a light coloured pen still has strong edges.
    const flatHighlighter = mayBeHighlighter && gradient < 13;
    return { distance, lum, saturation, gradient, ink: distance > background.threshold && !flatHighlighter };
  }

  function normalizeInkCanvas(sourceCanvas, background) {
    const width = sourceCanvas.width, height = sourceCanvas.height;
    const source = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
    const input = source.data;
    const normalized = document.createElement('canvas');
    normalized.width = width; normalized.height = height;
    const outCtx = normalized.getContext('2d', { alpha: false, willReadFrequently: true });
    const output = outCtx.createImageData(width, height), dest = output.data;
    const threshold = background.threshold;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const metric = pixelMetrics(input, i, x, y, width, height, background);
        let value = 255;
        if (metric.ink) {
          // Convert black, blue, red, green, violet, orange and light marker ink to
          // one consistent black-on-white input while retaining antialiased edges.
          value = 255 - clamp((metric.distance - threshold * 0.35) * 4.5, 0, 255);
        }
        dest[i] = dest[i + 1] = dest[i + 2] = value;
        dest[i + 3] = 255;
      }
    }
    outCtx.putImageData(output, 0, 0);
    return normalized;
  }


  // Extract saturated, dark pen strokes into separate monochrome recognition layers.
  // This prevents blue handwritten corrections from being read together with black
  // printed text on the same baseline. The original page remains untouched.
  function classifyPenHue(r, g, b) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 198 || chroma < 34) return null; // exclude pale highlighters and paper
    if (b > r * 1.16 && b > g * 0.91) return 'blue';
    if (r > g * 1.18 && r > b * 1.12) return 'red';
    if (g > r * 1.15 && g > b * 1.08) return 'green';
    if (r > g * 1.09 && b > g * 1.09) return 'purple';
    if (r > g * 1.13 && g > b * 1.07) return 'orange';
    return null;
  }

  function segmentChromaticHandwritingLines(pageCanvas) {
    const width = pageCanvas?.width || 0, height = pageCanvas?.height || 0;
    if (width < 100 || height < 100) return [];
    const ctx = pageCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    const source = ctx.getImageData(0, 0, width, height).data;
    const hues = ['blue', 'red', 'green', 'purple', 'orange'];
    const masks = Object.fromEntries(hues.map(h => [h, new Uint8Array(width * height)]));
    const counts = Object.fromEntries(hues.map(h => [h, 0]));
    const rowCounts = Object.fromEntries(hues.map(h => [h, new Uint32Array(height)]));
    const rowLeft = Object.fromEntries(hues.map(h => { const a = new Int32Array(height); a.fill(width); return [h, a]; }));
    const rowRight = Object.fromEntries(hues.map(h => { const a = new Int32Array(height); a.fill(-1); return [h, a]; }));

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = rowOffset + x * 4;
        const hue = classifyPenHue(source[i], source[i + 1], source[i + 2]);
        if (!hue) continue;
        const p = y * width + x;
        masks[hue][p] = 1;
        counts[hue]++;
        rowCounts[hue][y]++;
        if (x < rowLeft[hue][y]) rowLeft[hue][y] = x;
        if (x > rowRight[hue][y]) rowRight[hue][y] = x;
      }
    }

    const totalChromatic = hues.reduce((sum, hue) => sum + counts[hue], 0);
    if (totalChromatic < Math.max(120, width * height * 0.000025)) return [];
    const output = [];
    for (const hue of hues) {
      if (counts[hue] < Math.max(90, width * height * 0.000018)) continue;
      const rows = rowCounts[hue], lefts = rowLeft[hue], rights = rowRight[hue];
      const baseThreshold = Math.max(3, Math.round(width * 0.00035));
      const strongRows = Array.from(rows).filter(value => value >= baseThreshold).sort((a, b) => b - a);
      const strongestSample = strongRows.slice(0, Math.max(1, Math.ceil(strongRows.length * 0.20)));
      const rowThreshold = Math.max(baseThreshold, Math.round(median(strongestSample) * 0.06));
      const bridgeGap = 2;
      const mergeGap = clamp(Math.round(height * 0.0032), 4, 9);
      const runs = [];
      let start = -1, last = -1, pixelCount = 0;
      for (let y = 0; y < height; y++) {
        const count = rows[y] > width * 0.48 ? 0 : rows[y];
        if (count >= rowThreshold) {
          if (start < 0) { start = y; pixelCount = 0; }
          last = y; pixelCount += count;
        } else if (start >= 0 && y - last > bridgeGap) {
          runs.push({ top: start, bottom: last, count: pixelCount });
          start = -1; last = -1; pixelCount = 0;
        }
      }
      if (start >= 0) runs.push({ top: start, bottom: last, count: pixelCount });
      const bands = [];
      for (const run of runs) {
        const previous = bands[bands.length - 1];
        if (previous && run.top - previous.bottom <= mergeGap) {
          previous.bottom = Math.max(previous.bottom, run.bottom);
          previous.count += run.count;
        } else bands.push({ ...run });
      }
      const splitBands = [];
      const medianStrongHeight = median(bands.map(band => band.bottom - band.top + 1).filter(value => value >= 6)) || 18;
      for (const band of bands) {
        const heightOfBand = band.bottom - band.top + 1;
        if (heightOfBand < medianStrongHeight * 1.45) { splitBands.push(band); continue; }
        // A projection valley can separate two baselines even when connected or
        // slanted handwriting leaves no fully blank row between them.
        const peaks = [];
        for (let y = band.top + 2; y < band.bottom - 2; y++) {
          const value = rows[y];
          if (value < rowThreshold * 2 || value < rows[y - 1] || value < rows[y + 1]) continue;
          const last = peaks[peaks.length - 1];
          if (last && y - last.y < 12) { if (value > last.value) { last.y = y; last.value = value; } }
          else peaks.push({ y, value });
        }
        const cuts = [];
        for (let i = 1; i < peaks.length; i++) {
          const a = peaks[i - 1], b = peaks[i];
          if (b.y - a.y < Math.max(13, medianStrongHeight * 0.62)) continue;
          let valleyY = a.y, valleyValue = Infinity;
          for (let y = a.y + 1; y < b.y; y++) if (rows[y] < valleyValue) { valleyValue = rows[y]; valleyY = y; }
          if (valleyValue < Math.min(a.value, b.value) * 0.52) cuts.push(valleyY);
        }
        if (!cuts.length) { splitBands.push(band); continue; }
        let segmentTop = band.top;
        for (const cut of cuts) {
          if (cut - segmentTop >= 5) splitBands.push({ top: segmentTop, bottom: Math.max(segmentTop, cut - 1), count: 0 });
          segmentTop = cut + 1;
        }
        if (band.bottom - segmentTop >= 5) splitBands.push({ top: segmentTop, bottom: band.bottom, count: 0 });
      }
      for (const band of splitBands) {
        const bandHeight = band.bottom - band.top + 1;
        if (bandHeight < 6) continue;
        let left = width, right = -1, actualBandCount = 0;
        for (let y = band.top; y <= band.bottom; y++) {
          if (!rows[y]) continue;
          left = Math.min(left, lefts[y]); right = Math.max(right, rights[y]); actualBandCount += rows[y];
        }
        const boxWidth = right - left + 1;
        const density = actualBandCount / Math.max(1, boxWidth * bandHeight);
        // Broad filled marker bands are not handwriting. Real pen strokes occupy
        // only a small fraction of their bounding rectangle.
        if (boxWidth < 14 || boxWidth / Math.max(1, bandHeight) < 0.55 || density > 0.42) continue;
        const padX = clamp(Math.round(bandHeight * 0.28), 6, 20);
        const padY = clamp(Math.round(bandHeight * 0.22), 4, 12);
        const cropLeft = Math.max(0, left - padX), cropRight = Math.min(width, right + padX + 1);
        const cropTop = Math.max(0, band.top - padY), cropBottom = Math.min(height, band.bottom + padY + 1);
        const cropWidth = cropRight - cropLeft, cropHeight = cropBottom - cropTop;
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = cropWidth; maskCanvas.height = cropHeight;
        const maskCtx = maskCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
        const image = maskCtx.createImageData(cropWidth, cropHeight);
        image.data.fill(255);
        let inkPixels = 0;
        for (let cy = 0; cy < cropHeight; cy++) {
          const sourceY = cropTop + cy;
          for (let cx = 0; cx < cropWidth; cx++) {
            const sourceX = cropLeft + cx;
            // Padding stays white. Never let a neighbouring baseline leak into
            // this OCR crop just because it falls inside the vertical margin.
            if (sourceY < band.top || sourceY > band.bottom || !masks[hue][sourceY * width + sourceX]) continue;
            const outIndex = (cy * cropWidth + cx) * 4;
            image.data[outIndex] = image.data[outIndex + 1] = image.data[outIndex + 2] = 0;
            image.data[outIndex + 3] = 255;
            inkPixels++;
          }
        }
        if (inkPixels < 18) { maskCanvas.width = 1; maskCanvas.height = 1; continue; }
        maskCtx.putImageData(image, 0, 0);
        output.push({
          canvas: maskCanvas, rawCanvas: maskCanvas,
          left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom,
          height: bandHeight, width: boxWidth, inkCount: inkPixels,
          inkBounds: { left, top: band.top, right: right + 1, bottom: band.bottom + 1 },
          eraseHue: hue, inkColorOnly: true
        });
      }
      masks[hue] = null; // release the large per-colour mask as soon as it is processed
    }
    return output.sort((a, b) => a.top - b.top || a.left - b.left);
  }

  function lineBoxOverlap(a, b) {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const intersection = x * y;
    const areaA = Math.max(1, (a.right - a.left) * (a.bottom - a.top));
    const areaB = Math.max(1, (b.right - b.left) * (b.bottom - b.top));
    return intersection / Math.max(1, Math.min(areaA, areaB));
  }

  function segmentHandwritingCandidates(pageCanvas) {
    const detected = segmentChromaticHandwritingLines(pageCanvas);
    const chromatic = [];
    // Different colour thresholds can describe the same antialiased stroke. Keep
    // the strongest crop once, not several near-identical OCR lines on top of each other.
    for (const candidate of detected.slice().sort((a, b) => b.inkCount - a.inkCount)) {
      if (chromatic.some(existing => lineBoxOverlap(existing.inkBounds || existing, candidate.inkBounds || candidate) >= 0.68)) {
        try { candidate.canvas.width = 1; candidate.canvas.height = 1; } catch {}
        continue;
      }
      chromatic.push(candidate);
    }
    const ordinary = segmentHandwritingLines(pageCanvas);
    if (!chromatic.length) return ordinary;
    // Ordinary segmentation sees printed black glyphs beneath coloured handwriting.
    // Drop those combined rows when a more precise pen-only crop exists.
    const blackOrNeutral = ordinary.filter(line => !chromatic.some(colour => lineBoxOverlap(line, colour.inkBounds || colour) >= 0.24));
    return [...chromatic, ...blackOrNeutral].sort((a, b) => a.top - b.top || a.left - b.left);
  }

  function segmentHandwritingLines(pageCanvas) {
    const width = pageCanvas?.width || 0, height = pageCanvas?.height || 0;
    if (width < 100 || height < 100) return [];
    const context = pageCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    const image = context.getImageData(0, 0, width, height), pixels = image.data;
    const background = estimateBackground(pixels, width, height);
    const rowCounts = new Uint32Array(height), rowLeft = new Int32Array(height), rowRight = new Int32Array(height);
    rowLeft.fill(width); rowRight.fill(-1);
    for (let y = 0; y < height; y++) {
      let count = 0, left = width, right = -1;
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = rowOffset + x * 4;
        if (pixelMetrics(pixels, i, x, y, width, height, background).ink) {
          count++; if (x < left) left = x; if (x > right) right = x;
        }
      }
      // Ignore long, thin horizontal rules and table borders.
      if (count > width * 0.46) continue;
      rowCounts[y] = count; rowLeft[y] = left; rowRight[y] = right;
    }

    const baseThreshold = Math.max(4, Math.round(width * 0.00075));
    const strongRows = Array.from(rowCounts).filter(value => value >= baseThreshold).sort((a, b) => b - a);
    const strongestSample = strongRows.slice(0, Math.max(1, Math.ceil(strongRows.length * 0.20)));
    const rowThreshold = Math.max(baseThreshold, Math.round(median(strongestSample) * 0.055));
    const bridgeGap = clamp(Math.round(height * 0.002), 2, 5);
    const runs = [];
    let start = -1, last = -1, pixelCount = 0;
    for (let y = 0; y < height; y++) {
      if (rowCounts[y] >= rowThreshold) {
        if (start < 0) { start = y; pixelCount = 0; }
        last = y; pixelCount += rowCounts[y];
      } else if (start >= 0 && y - last > bridgeGap) {
        runs.push({ top: start, bottom: last, count: pixelCount }); start = -1; last = -1; pixelCount = 0;
      }
    }
    if (start >= 0) runs.push({ top: start, bottom: last, count: pixelCount });
    if (!runs.length) return [];

    // Dots and umlauts are merged into their letter line; larger gaps remain distinct.
    const mergeGap = clamp(Math.round(height * 0.006), 9, 17);
    const bands = [];
    for (const run of runs) {
      const previous = bands[bands.length - 1];
      if (previous && run.top - previous.bottom <= mergeGap) {
        previous.bottom = Math.max(previous.bottom, run.bottom); previous.count += run.count;
      } else bands.push({ ...run });
    }

    const lineBoxes = [];
    for (const band of bands) {
      const bandHeight = band.bottom - band.top + 1;
      if (bandHeight < 7 || band.count < 12) continue;
      let left = width, right = -1, inkCount = 0;
      for (let y = band.top; y <= band.bottom; y++) {
        if (!rowCounts[y]) continue;
        left = Math.min(left, rowLeft[y]); right = Math.max(right, rowRight[y]); inkCount += rowCounts[y];
      }
      if (right - left < 18 || inkCount < 16) continue;
      const candidateWidth = right - left + 1;
      const nearPageEdge = band.top <= Math.max(5, Math.round(height * 0.012)) || band.bottom >= height - Math.max(5, Math.round(height * 0.012));
      // Thin full-width borders and scanner edges are not handwriting lines.
      if (nearPageEdge && candidateWidth >= width * 0.72 && bandHeight <= Math.max(10, Math.round(height * 0.009))) continue;
      if (candidateWidth / Math.max(1, bandHeight) > 70 && bandHeight < 12) continue;
      const padX = clamp(Math.round(bandHeight * 0.32), 10, 24);
      const padY = clamp(Math.round(bandHeight * 0.28), 8, 18);
      const cropLeft = Math.max(0, left - padX), cropRight = Math.min(width, right + padX + 1);
      const cropTop = Math.max(0, band.top - padY), cropBottom = Math.min(height, band.bottom + padY + 1);
      const rawCrop = document.createElement('canvas');
      rawCrop.width = Math.max(1, cropRight - cropLeft); rawCrop.height = Math.max(1, cropBottom - cropTop);
      const cropCtx = rawCrop.getContext('2d', { alpha: false, willReadFrequently: true });
      cropCtx.fillStyle = '#fff'; cropCtx.fillRect(0, 0, rawCrop.width, rawCrop.height);
      cropCtx.drawImage(pageCanvas, cropLeft, cropTop, rawCrop.width, rawCrop.height, 0, 0, rawCrop.width, rawCrop.height);
      const crop = normalizeInkCanvas(rawCrop, background);
      lineBoxes.push({ canvas: crop, rawCanvas: rawCrop, left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom, height: bandHeight, width: right - left + 1, inkCount });
    }
    return lineBoxes;
  }

  function makeTensor(canvas, config, ort) {
    const imageHeight = config.imageHeight;
    const resizedWidth = Math.max(1, Math.round(canvas.width * imageHeight / canvas.height));
    const imageWidth = Math.min(resizedWidth, config.maxWidth);
    const width = Math.min(config.maxWidth, Math.max(config.outputStride, Math.ceil(imageWidth / config.outputStride) * config.outputStride));
    const drawnHeight = resizedWidth > config.maxWidth ? Math.max(1, Math.round(imageHeight * config.maxWidth / resizedWidth)) : imageHeight;
    const top = Math.floor((imageHeight - drawnHeight) / 2);
    const target = document.createElement('canvas'); target.width = width; target.height = imageHeight;
    const ctx = target.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, imageHeight);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, top, imageWidth, drawnHeight);
    const data = ctx.getImageData(0, 0, width, imageHeight).data;
    const plane = width * imageHeight;

    if (config.formatVersion === 2) {
      const values = new Float32Array(plane);
      for (let p = 0; p < plane; p++) {
        const i = p * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        values[p] = lum * config.preprocessing.scale;
      }
      return { tensor: new ort.Tensor('float32', values, [1, 1, imageHeight, width]), width };
    }

    const values = new Float32Array(plane * 3);
    for (let p = 0; p < plane; p++) {
      const i = p * 4;
      values[p] = (data[i] / 255 - config.normalization.mean[0]) / config.normalization.std[0];
      values[plane + p] = (data[i + 1] / 255 - config.normalization.mean[1]) / config.normalization.std[1];
      values[plane * 2 + p] = (data[i + 2] / 255 - config.normalization.mean[2]) / config.normalization.std[2];
    }
    return { tensor: new ort.Tensor('float32', values, [1, 3, imageHeight, width]), width };
  }

  function logAdd(a, b) {
    if (!Number.isFinite(a)) return b;
    if (!Number.isFinite(b)) return a;
    const high = Math.max(a, b), low = Math.min(a, b);
    return high + Math.log1p(Math.exp(low - high));
  }

  function decodeCtc(output, width, config, qualityProfile = 'precise') {
    const dimensions = output.dims || [];
    const classes = dimensions[2];
    if (!Number.isInteger(classes) || classes !== config.alphabet.length + 1) {
      throw new Error('Das Handschriftmodell hat eine unerwartete Ausgabeform geliefert: ' + dimensions.join(' × '));
    }
    const timeAxis = config.formatVersion === 2 ? 1 : 0;
    const availableSteps = dimensions[timeAxis];
    const steps = Math.min(availableSteps, Math.ceil(width / config.outputStride));
    const logits = output.data;

    // CTC prefix-beam search is more robust than taking only the strongest character
    // at every frame. It preserves alternative paths which can complete a faint final letter.
    // The independent DE/EN dictionary OCR later re-ranks actual word candidates; no words
    // are generated from an unconstrained language-model guess.
    const beamWidth = qualityProfile === 'fast' ? 5 : 16;
    const symbolsPerFrame = Math.min(classes, qualityProfile === 'fast' ? 10 : 22);
    let beam = new Map([['', { blank: 0, nonBlank: -Infinity }]]);
    let greedyConfidenceSum = 0;
    let greedyConfidenceCount = 0;
    let previousGreedy = -1;

    for (let t = 0; t < steps; t++) {
      const offset = t * classes;
      let maxLogit = -Infinity, greedyBest = 0;
      for (let c = 0; c < classes; c++) {
        const value = logits[offset + c];
        if (value > maxLogit) { maxLogit = value; greedyBest = c; }
      }
      let expSum = 0;
      for (let c = 0; c < classes; c++) expSum += Math.exp(Math.max(-40, logits[offset + c] - maxLogit));
      const logNormalizer = maxLogit + Math.log(Math.max(expSum, 1e-30));
      if (greedyBest !== config.blankIndex && greedyBest !== previousGreedy) {
        greedyConfidenceSum += Math.exp(logits[offset + greedyBest] - logNormalizer);
        greedyConfidenceCount++;
      }
      previousGreedy = greedyBest;

      const ranked = [];
      for (let c = 0; c < classes; c++) ranked.push({ index: c, logp: logits[offset + c] - logNormalizer });
      ranked.sort((a, b) => b.logp - a.logp);
      const candidates = ranked.slice(0, symbolsPerFrame);
      if (!candidates.some(item => item.index === config.blankIndex)) {
        candidates.push({ index: config.blankIndex, logp: logits[offset + config.blankIndex] - logNormalizer });
      }

      const next = new Map();
      const ensure = prefix => {
        let value = next.get(prefix);
        if (!value) { value = { blank: -Infinity, nonBlank: -Infinity }; next.set(prefix, value); }
        return value;
      };

      for (const [prefix, state] of beam) {
        const total = logAdd(state.blank, state.nonBlank);
        for (const candidate of candidates) {
          const symbol = candidate.index;
          const logp = candidate.logp;
          if (symbol === config.blankIndex) {
            const target = ensure(prefix);
            target.blank = logAdd(target.blank, total + logp);
            continue;
          }
          const character = config.alphabet[symbol - 1] || '';
          if (!character) continue;
          const lastCharacter = prefix.slice(-1);
          if (character === lastCharacter) {
            // Repeating a character without an intervening blank leaves the same token.
            const same = ensure(prefix);
            same.nonBlank = logAdd(same.nonBlank, state.nonBlank + logp);
            // A blank-separated repeat creates a second character in the output.
            const extended = ensure(prefix + character);
            extended.nonBlank = logAdd(extended.nonBlank, state.blank + logp);
          } else {
            const extended = ensure(prefix + character);
            extended.nonBlank = logAdd(extended.nonBlank, total + logp);
          }
        }
      }

      beam = new Map([...next.entries()]
        .sort((a, b) => logAdd(b[1].blank, b[1].nonBlank) - logAdd(a[1].blank, a[1].nonBlank))
        .slice(0, beamWidth));
    }

    const bestPrefix = [...beam.entries()]
      .sort((a, b) => logAdd(b[1].blank, b[1].nonBlank) - logAdd(a[1].blank, a[1].nonBlank))[0]?.[0] || '';
    const confidence = greedyConfidenceCount ? greedyConfidenceSum / greedyConfidenceCount : 0;
    return { text: bestPrefix.replace(/\s+/g, ' ').trim(), confidence };
  }

  function pageTextFromLines(lines, pageWidth) {
    if (!lines.length) return '';
    const heights = lines.map(line => line.height);
    const medianHeight = median(heights) || 40;
    const leftEdge = Math.min(...lines.map(line => line.left));
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(Math.max(0, lines[i].top - lines[i - 1].bottom));
    const validGaps = gaps.filter(gap => gap > 0).sort((a, b) => a - b);
    const medianGap = median(validGaps) || medianHeight * 0.5;
    const normalLineGap = validGaps.length ? validGaps[Math.floor((validGaps.length - 1) * 0.35)] : medianGap;
    const paragraphGap = Math.max(medianHeight * 1.55, normalLineGap * 1.45);
    const spaceWidth = Math.max(14, medianHeight * 0.6);
    const output = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i) {
        const gap = line.top - lines[i - 1].bottom;
        output.push(gap > paragraphGap ? '\n\n' : '\n');
      }
      const indent = Math.max(0, line.left - leftEdge);
      const spaces = clamp(Math.round(indent / spaceWidth), 0, Math.floor(pageWidth / 15));
      if (spaces) output.push(' '.repeat(spaces));
      output.push(line.text);
    }
    return output.join('').trimEnd();
  }

  async function recognizePages(canvases, progress, embeddedTextPages = [], embeddedTextLayouts = [], alternateRecognizer = null, qualityProfile = 'precise') {
    const loaded = await loadSession(progress);
    const { session, config, variant } = loaded;
    const pageTexts = [], pageLayouts = [], confidenceValues = [], lineResults = [];
    let totalLineCount = 0;
    try {
      for (let pageIndex = 0; pageIndex < canvases.length; pageIndex++) {
        const pageCanvas = canvases[pageIndex];
        const embedded = String(embeddedTextPages?.[pageIndex] || '').replace(/\r/g, '').trim();
        if (embedded) {
          report(progress, 'Textschicht auf Seite ' + (pageIndex + 1) + ' wird layoutgetreu übernommen …');
          pageTexts.push(embedded);
          lineResults.push((embeddedTextLayouts?.[pageIndex]?.lineBoxes || []).map(line => ({ ...line })));
          pageLayouts.push(embeddedTextLayouts?.[pageIndex] || { width: pageCanvas.width, height: pageCanvas.height, lineCount: (embedded.match(/\n/g) || []).length + 1 });
          continue;
        }
        report(progress, 'Handschrift auf Seite ' + (pageIndex + 1) + ' von ' + canvases.length + ': Zeilen werden erkannt …');
        const boxes = segmentHandwritingCandidates(pageCanvas);
        if (!boxes.length) {
          pageTexts.push('');
          lineResults.push([]);
          pageLayouts.push({ width: pageCanvas.width, height: pageCanvas.height, lineCount: 0, medianLineHeight: 0, medianLineSpacing: 0, left: 0, top: 0 });
          continue;
        }
        const recognized = [];
        for (let lineIndex = 0; lineIndex < boxes.length; lineIndex++) {
          report(progress, 'Seite ' + (pageIndex + 1) + ': handschriftliche Zeile ' + (lineIndex + 1) + ' von ' + boxes.length + ' wird gelesen …');
          const { tensor, width } = makeTensor(boxes[lineIndex].canvas, config, global.ort);
          const outputs = await session.run({ [config.inputName]: tensor });
          const output = outputs[config.outputName];
          if (!output) throw new Error('Das Handschriftmodell hat keine Textausgabe geliefert.');
          const decoded = decodeCtc(output, width, config, qualityProfile);
          let chosen = { text: decoded.text, confidence: decoded.confidence, engine: variant.label };
          if (typeof alternateRecognizer === 'function') {
            try {
              const alternate = await alternateRecognizer(boxes[lineIndex].canvas, {
                pageIndex, lineIndex, text: decoded.text, confidence: decoded.confidence,
                alphabet: config.alphabet, bounds: { left: boxes[lineIndex].left, top: boxes[lineIndex].top, right: boxes[lineIndex].right, bottom: boxes[lineIndex].bottom }
              });
              if (alternate && alternate.useAlternate && String(alternate.text || '').trim()) {
                chosen = { text: String(alternate.text).normalize('NFC').trim(), confidence: Number(alternate.confidence) || 0, engine: alternate.engine || 'Alternative OCR' };
              }
            } catch (error) { report(progress, 'Zusätzliche Erkennung für Zeile ' + (lineIndex + 1) + ' nicht verfügbar: ' + (error?.message || error)); }
          }
          recognized.push({ ...boxes[lineIndex], ...chosen });
          if (chosen.text) confidenceValues.push(chosen.confidence * 100);
        }
        const useful = recognized.filter(line => line.text);
        lineResults.push(useful.map(line => ({ text: line.text, confidence: line.confidence, engine: line.engine, left: line.left, top: line.top, right: line.right, bottom: line.bottom, eraseHue: line.eraseHue || null, inkColorOnly: !!line.inkColorOnly, inkBounds: line.inkBounds || null })));
        totalLineCount += useful.length;
        pageTexts.push(pageTextFromLines(useful, pageCanvas.width));
        const lineCenters = useful.map(line => (line.top + line.bottom) / 2);
        const spacing = lineCenters.slice(1).map((center, i) => center - lineCenters[i]);
        pageLayouts.push({
          width: pageCanvas.width,
          height: pageCanvas.height,
          lineCount: useful.length,
          medianLineHeight: median(useful.map(line => line.height)),
          medianLineSpacing: median(spacing),
          left: useful.length ? Math.min(...useful.map(line => line.left)) : 0,
          top: useful.length ? Math.min(...useful.map(line => line.top)) : 0,
          right: useful.length ? Math.max(...useful.map(line => line.right)) : pageCanvas.width,
          bottom: useful.length ? Math.max(...useful.map(line => line.bottom)) : pageCanvas.height
        });
      }
    } finally {
      // Keep the model session and cached weights for subsequent imports in this tab.
    }
    const nonEmpty = pageTexts.filter(text => text.trim());
    return {
      text: pageTexts.join('\n\n\n'),
      pageTexts,
      lineResults,
      confidence: confidenceValues.length ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length : null,
      method: variant.label + (lineResults.some(lines => lines.some(line => line.engine && line.engine !== variant.label)) ? ' + Tesseract-Zeilenabgleich' : '') + ' · Zeilenerkennung',
      lineCount: totalLineCount,
      layout: { pages: pageLayouts, source: 'de-htr', model: variant.id, pageCount: canvases.length }
    };
  }

  global.SchreibbotGermanHandwritingRecognition = {
    recognizePages,
    segmentHandwritingLines,
    segmentHandwritingCandidates,
    segmentChromaticHandwritingLines,
    normalizeInkCanvas,
    getModelInfo: () => ({ model: 'DE·HTR modern German handwriting', version: 'v2 with v1 fallback', license: 'Apache-2.0' })
  };
})(window);
