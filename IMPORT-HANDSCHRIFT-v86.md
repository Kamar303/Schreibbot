# Schreibbot v86 – Handschrift genauer erkennen und in das eigene Schriftprofil umwandeln

## Was neu ist

- Deutsche Handschrift nutzt standardmäßig DE·HTR v2, ein spezialisiertes Zeilenmodell statt Tesseract als primäre Erkennung.
- Die Seite wird lokal in Schreibzeilen zerlegt; Zeilenfolge, Absatzabstände und Einzüge werden rekonstruiert.
- Wenn das Handschriftmodell nicht geladen werden kann, versucht Schreibbot weiterhin die vorhandene Tesseract-Standard-OCR. Einzelne leere Seiten werden ebenfalls separat mit der Ersatz-OCR nachbearbeitet, ohne bereits erkannte Seiten zu ersetzen.
- PDF-Textebenen werden positionsbasiert in Zeilen rekonstruiert; Zeilenumbrüche, Einzüge und Absatzabstände bleiben weitgehend erhalten.
- Seitenmaße aus PDF-/GoodNotes-Papier werden verwendet, wenn sie physisch zuverlässig bestimmbar sind. Foto-Seiten ändern das Papierformat nicht automatisch, weil das Seitenverhältnis allein A3/A4/A5 nicht unterscheiden kann.
- Der erkannte Text bleibt vor dem Anwenden bearbeitbar. Nach dem Anwenden wird er mit den gespeicherten eigenen Glyphen, Wörtern und Verbindungen gerendert. Die vorhandenen Regler für Stiftdicke, Wortabstand, Zeilenabstand und natürliche Variation bleiben erhalten.
- Dokumente und erkannter Text werden nicht zu einem Schreibbot-Server hochgeladen. Das Modell wird einmalig von Hugging Face geladen und in IndexedDB auf dem Gerät zwischengespeichert.

## Unterstützter Erkennungsbereich

DE·HTR ist für moderne deutsche Handschrift ausgelegt und arbeitet zeilenweise. Die Zeilensegmentierung auf der gesamten Seite wird lokal von Schreibbot vorgenommen. Historische Kurrent/Sütterlin, sehr stark verbundene oder stark verschnörkelte Schrift sowie andere Sprachen sind nicht garantiert; dort ist eine sorgfältige Korrektur im Textfeld erforderlich. Für Druckschrift und andere angebotene Sprachen bleibt Tesseract als Ersatz vorhanden.

## Modell und Lizenzhinweis

Das DE·HTR-Modell wird von `naeyn/de-htr-web-v2` (Apache-2.0) bezogen. Die veröffentlichte Modellkarte nennt einen Test-CER-Wert von 8,5681 % für das quantisierte Modell auf dem dort beschriebenen Testdatensatz. Das ist ein Benchmark des Modellautors, keine Genauigkeitsgarantie für jedes Foto oder jede persönliche Handschrift.

- Modellkarte: https://huggingface.co/naeyn/de-htr-web-v2
- Quellprojekt/Lizenz: https://github.com/naeyn/de-htr-web
- ONNX Runtime Web: https://onnxruntime.ai/

## Dateien aktualisieren

In GitHub ersetzen: `index.html`, `handwriting-import.js`, `service-worker.js`; neu hinzufügen: `handwriting-recognition.js`. `goodnotes-template.js` bleibt unverändert im selben Ordner. Keine Supabase-Migration nötig. Danach die Website neu laden und die PWA vollständig schließen und erneut öffnen (Cache v86).

## Geprüft

JavaScript-Syntax, HTML-Struktur, Einbindung des Handwriting-Moduls, Service-Worker-App-Shell, synthetische Zeilentrennung, CTC-Decodierung, PDF-Zeilen-/Absatzrekonstruktion und statische Layoutdaten wurden geprüft. Eine echte ONNX-Inferenz mit persönlicher Handschrift konnte in dieser Build-Umgebung nicht ausgeführt werden, da die Modellgewichte nicht live geladen werden konnten. Vor der produktiven Nutzung bitte eine echte Probe mit einem gut lesbaren deutschen Handschriftfoto kontrollieren.
