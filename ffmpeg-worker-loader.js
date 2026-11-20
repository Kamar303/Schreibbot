// Same-origin entry for the FFmpeg module worker.
// Keep the official ESM worker at its CDN URL so ./const.js and ./errors.js
// resolve relative to the package directory (not to a blob: URL).
import 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js';
