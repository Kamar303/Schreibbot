# Schreibbot v84 – OCR-Bibliothek wird wieder geladen

## Fehlerursache
Die Content-Security-Policy in `index.html` erlaubte für `script-src` nur `'self'` und Inline-Skripte. Die OCR-, PDF- und ZIP-Bibliotheken werden jedoch von externen CDNs geladen. Der Browser blockierte sie deshalb, bevor die Handschrifterkennung starten konnte.

## Änderungen
- CSP erlaubt jetzt gezielt `cdn.jsdelivr.net`, `cdnjs.cloudflare.com` und `unpkg.com` für die benötigten Bibliotheken.
- `connect-src` erlaubt zusätzlich die CDN-Quellen sowie die Tesseract-Sprachmodell-Hosts.
- `worker-src` und `child-src` erlauben `blob:`-Worker für Tesseract und PDF.js.
- WebAssembly-Ausführung ist über `wasm-unsafe-eval` freigegeben.
- JSZip, PDF.js und Tesseract verwenden drei alternative CDN-Quellen statt nur einer Quelle.
- Skriptladen hat Timeout, Fallback und aussagekräftige Diagnosemeldungen.
- PDF.js probiert Worker-Dateien derselben Version über mehrere CDNs.
- Tesseract verwendet explizite Worker-/Core-Pfade und eine zweite Sprachmodellquelle, falls der erste Pfad nicht erreichbar ist.
- Service-Worker-Cache auf `v84` erhöht, damit Geräte die alte v83-Version nicht weiterverwenden.

## Zu ersetzen
1. `index.html`
2. `handwriting-import.js`
3. `service-worker.js`

Keine Supabase-Migration erforderlich. `goodnotes-template.js` bleibt unverändert.

## Hinweis
Die CDN-Adressen und Versionen sind gemäß den offiziellen Tesseract.js-Unterlagen und den Bibliotheksverzeichnissen festgelegt. Ein echter Geräte-/GitHub-Pages-Live-Test konnte in dieser Umgebung nicht ausgeführt werden; nach dem Upload sollte der Import mit PNG/PDF und anschließend mit `.goodnotes`/`.sdocx` getestet werden.
