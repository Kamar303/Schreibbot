/* Schreibbot Export Intelligence v99
 * Geometry-aware layout engine. It combines OCR/HTR line boxes with the user's
 * rendered handwriting, preserves glyph proportions and prevents baseline/scale drift.
 * Recognition itself is supplied by the DE·HTR ONNX model in handwriting-recognition.js.
 */
(function (global) {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function inkBounds(canvas) {
    const ctx = canvas?.getContext?.('2d', { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return null;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 18) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return x1 < x0 ? null : { left: x0, top: y0, right: x1 + 1, bottom: y1 + 1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }
  function fitLine(glyphCanvas, line, pageWidth, pageHeight) {
    const ink = inkBounds(glyphCanvas);
    if (!ink) return null;
    // Use the complete OCR line box for layout, not the much tighter ink mask.
    // The latter is only for removing old pixels; using it for placement shrinks text.
    const left = Number(line.left), right = Number(line.right), top = Number(line.top), bottom = Number(line.bottom);
    const boxW = Math.max(1, right - left), boxH = Math.max(1, bottom - top);
    const widthScale = boxW * 0.96 / ink.width;
    const heightScale = boxH * 0.82 / ink.height;
    // Never distort letter proportions. Permit modest enlargement for short OCR boxes.
    const scale = clamp(Math.min(widthScale, heightScale), 0.42, 2.15);
    const drawW = ink.width * scale, drawH = ink.height * scale;
    const x = clamp(left + Math.max(0, (boxW - drawW) * 0.02), 0, Math.max(0, pageWidth - drawW));
    // Align to the lower part of the detected line box; this keeps descenders inside.
    const y = clamp(bottom - drawH - boxH * 0.06, 0, Math.max(0, pageHeight - drawH));
    return { source: ink, x, y, width: drawW, height: drawH, scale };
  }
  global.SchreibbotExportAI = Object.freeze({ version: '99.1', inkBounds, fitLine });
})(window);
