# Schreibbot v87 – farbige Handschrift, mehrere Schreiber, Druckschrift und Sonderzeichen

## Was geändert wurde

- Neuer Automatikmodus vergleicht jede erkannte Handschriftzeile zusätzlich mit Tesseract. Hochsichere Druckschrift, schwache HTR-Zeilen und Zeichen außerhalb des DE·HTR-Alphabets können so aus der zweiten OCR übernommen werden.
- DE·HTR bleibt der spezialisierte Erkennungspfad für moderne deutsche Handschrift; das Modell wurde auf echten Schriftproben trainiert und auf zurückgehaltenen Seiten verschiedener Schreiber evaluiert. Es ist nicht auf die persönliche Handschrift des Schreibbot-Nutzers beschränkt.
- Die Zeilensegmentierung nutzt jetzt den tatsächlichen RGB-Hintergrund der Seite und farbunabhängigen Kontrast statt eines festen Helligkeitsschwellwerts. Dadurch werden kontrastreiche blaue, rote, grüne, violette, orange und andere Stiftfarben auf hellen Seiten erkannt.
- Farbstift-Zeilen werden in kontrastreiche Schwarz-auf-Weiß-Crops normalisiert; die Farbe beeinflusst dadurch nicht mehr die HTR-Eingabe. Flache helle Markerflächen werden nach Möglichkeit unterdrückt, während Kanten und darauf geschriebene Schrift erhalten bleiben.
- Unicode-Texte werden NFC-normalisiert. Die zweite OCR kann erweiterte lateinische Buchstaben, typografische Zeichen und Sonderzeichen liefern, die das kompakte HTR-Alphabet nicht ausgeben kann.
- Der bestehende Standardmodus „Deutsche Handschrift“ führt jetzt automatisch einen zweiten Zeilenvergleich für Druckschrift und Sonderzeichen aus. Die vorhandene Benutzeroberfläche und alle übrigen App-Bereiche bleiben unverändert.

## Erkennungsstrategie

1. PDF-Textebenen werden weiterhin direkt übernommen, wenn sie vorhanden sind.
2. Bei Rasterseiten zerlegt DE·HTR moderne deutsche Handschrift seitenweise in Zeilen.
3. Im Automatikmodus wird jede normierte Zeile zusätzlich von Tesseract gelesen. Die Auswahl nimmt die zweite OCR nur bei hoher Konfidenz, schwachem HTR-Ergebnis oder Zeichen, die außerhalb des HTR-Alphabets liegen.
4. Leere Seiten erhalten zusätzlich einen Vollseiten-OCR-Durchlauf.
5. Der erkannte Text kann vor dem Einsetzen in das persönliche Schreibprofil korrigiert werden.

## Grenzen, die nicht verschwiegen werden

- „Alle Farben“ bedeutet: kontrastreiche Tintenfarben werden auf hellen Papierhintergründen farbunabhängig verarbeitet. Sehr blasse Tinte, weißer Stift auf weißem Papier, starke Schatten, stark strukturierte Hintergründe und Markerflächen können weiterhin schwierig sein.
- DE·HTR v2 ist für moderne deutsche Handschrift gedacht und arbeitet nicht nur mit dem persönlichen Schreibbot-Profil. Der Modellanbieter berichtet 601 Testzeilen aus 78 zurückgehaltenen Seiten; die Modellkarte weist jedoch darauf hin, dass echte Personen-Identitäten im Datensatz nicht verifiziert sind. Kurrent/Sütterlin, beliebige Sprachen, mathematische Formeln und seltene Glyphen sind nicht garantiert. Für Druckschrift, ausgewählte Sprachen und viele erweiterte Zeichen liefert Tesseract einen zweiten Erkennungskandidaten.
- Die Qualität kann je nach fremder Handschrift, Fotoqualität, Neigung, Größe, Durchstreichungen und Überlappungen stark variieren. Eine Korrektur im Textfeld bleibt wichtig.
- Für andere Handschriftsprachen als Deutsch ist die Qualität des deutschen HTR-Modells nicht garantiert; die gewählte Tesseract-Sprache beeinflusst den Alternativpfad.
- Die technischen Tests dieser Version verwenden synthetische Farbmuster und simulierte OCR-Antworten; kein echter OCR-Modelllauf konnte in dieser Build-Umgebung durchgeführt werden.

## Geänderte Dateien

- `handwriting-recognition.js` – farbunabhängige RGB-Segmentierung, Schwarz-Weiß-Normalisierung und alternativer Zeilen-Erkenner-Hook.
- `handwriting-import.js` – zweiter OCR-Kandidat pro Zeile, Auswahl nach Konfidenz/Unicode-Zeichen, aktualisierte Textnormalisierung.
- `service-worker.js` – Cache auf v87 aktualisiert.

## Installation

In GitHub nur `handwriting-import.js`, `handwriting-recognition.js` und `service-worker.js` ersetzen. `index.html` bleibt unverändert. `goodnotes-template.js` bleibt unverändert. Danach veröffentlichen und die PWA vollständig schließen und neu öffnen. Keine Supabase-Migration nötig.
