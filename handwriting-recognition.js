/* Schreibbot v87 – color-aware, mixed handwriting/print recognition
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
          global.ort.env.wasm.numThreads = 1;
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

    const rowThreshold = Math.max(4, Math.round(width * 0.00075));
    const bridgeGap = clamp(Math.round(height * 0.0045), 5, 14);
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

  function decodeCtc(output, width, config) {
    const dimensions = output.dims || [];
    const classes = dimensions[2];
    if (!Number.isInteger(classes) || classes !== config.alphabet.length + 1) {
      throw new Error('Das Handschriftmodell hat eine unerwartete Ausgabeform geliefert: ' + dimensions.join(' × '));
    }
    const timeAxis = config.formatVersion === 2 ? 1 : 0;
    const availableSteps = dimensions[timeAxis];
    const steps = Math.min(availableSteps, Math.ceil(width / config.outputStride));
    const logits = output.data;
    const chars = [];
    let previous = -1, confidenceSum = 0, confidenceCount = 0;
    for (let t = 0; t < steps; t++) {
      const offset = t * classes;
      let best = 0, maxLogit = -Infinity;
      for (let c = 0; c < classes; c++) {
        const value = logits[offset + c];
        if (value > maxLogit) { maxLogit = value; best = c; }
      }
      if (best !== config.blankIndex && best !== previous) {
        chars.push(config.alphabet[best - 1] || '');
        let sum = 0;
        for (let c = 0; c < classes; c++) sum += Math.exp(Math.max(-40, logits[offset + c] - maxLogit));
        confidenceSum += 1 / Math.max(1, sum);
        confidenceCount++;
      }
      previous = best;
    }
    return { text: chars.join('').replace(/\s+/g, ' ').trim(), confidence: confidenceCount ? confidenceSum / confidenceCount : 0 };
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

  async function recognizePages(canvases, progress, embeddedTextPages = [], embeddedTextLayouts = [], alternateRecognizer = null) {
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
          lineResults.push([]);
          pageLayouts.push(embeddedTextLayouts?.[pageIndex] || { width: pageCanvas.width, height: pageCanvas.height, lineCount: (embedded.match(/\n/g) || []).length + 1 });
          continue;
        }
        report(progress, 'Handschrift auf Seite ' + (pageIndex + 1) + ' von ' + canvases.length + ': Zeilen werden erkannt …');
        const boxes = segmentHandwritingLines(pageCanvas);
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
          const decoded = decodeCtc(output, width, config);
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
        lineResults.push(useful.map(line => ({ text: line.text, confidence: line.confidence, engine: line.engine, left: line.left, top: line.top, right: line.right, bottom: line.bottom })));
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
    normalizeInkCanvas,
    getModelInfo: () => ({ model: 'DE·HTR modern German handwriting', version: 'v2 with v1 fallback', license: 'Apache-2.0' })
  };
})(window);
