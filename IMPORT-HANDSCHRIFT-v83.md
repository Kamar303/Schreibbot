# Schreibbot v83 – Dokumente in eigene Handschrift umwandeln

## Funktion
Der neue Bereich „Dokument in meine Handschrift umwandeln“ ist oberhalb des normalen Texteingabefelds integriert.

Unterstützte Eingaben:
- GoodNotes `.goodnotes` und GoodNotes-ZIP-Backups
- Samsung Notes `.sdocx`
- PDF
- PNG, JPG/JPEG, WEBP und BMP

Unterstützte Ausgaben:
- GoodNotes – native Stiftstriche, danach Auswahl von GoodNotes Standard oder Papierformat/Ausrichtung im vorhandenen Exportdialog
- Samsung Notes – native Stiftstriche, danach Auswahl von Papierformat/Ausrichtung im vorhandenen Exportdialog
- Mehrseitiges PDF
- PNG-Seiten als gemeinsamer ZIP-Download

## Ablauf
1. Quelldatei auswählen.
2. „Handschrift erkennen“ starten.
3. Schreibbot liest native Stiftobjekte aus bekannten GoodNotes-/Samsung-Strukturen, wenn möglich. Andernfalls werden PDF-Seiten oder Vorschaubilder als Erkennungsgrundlage verwendet.
4. PDF-Seiten mit einer echten Textebene werden direkt ausgelesen. Andere Seiten werden mit Tesseract.js erkannt.
5. Erkannten Text kontrollieren und bei Bedarf korrigieren.
6. Zielformat auswählen und „In eigene Handschrift umwandeln & Datei erstellen“ drücken.
7. Der erkannte Text wird in den normalen Editor gesetzt, auf „Eigene Handschrift“ umgestellt und durch die bestehenden Exportfunktionen ausgegeben.

## Datenschutz und Voraussetzungen
- Die Quelldatei und der erkannte Text werden nicht an einen Schreibbot-Server hochgeladen.
- Die Bild-/PDF-Verarbeitung und OCR finden im Browser statt.
- Beim ersten OCR-Aufruf lädt der Browser JSZip, PDF.js, Tesseract.js und die benötigten Sprachdaten von öffentlichen CDNs. Dafür wird Internet benötigt. Diese Bibliotheken/Sprachmodelle werden nicht mit dem Schreibbot-Projekt ausgeliefert.
- Maximale Quelldateigröße: 50 MB.
- Maximale entpackte Archivgröße: 140 MB.
- Maximale Seitenzahl pro Import: 20.

## Grenzen
- Tesseract ist eine allgemeine OCR-Engine und keine spezialisierte Erkennung für jede verbundene Handschrift. Schreibschrift, schlechte Scans, Schatten, schräge Seiten und ungewöhnliche Wörter können falsch erkannt werden. Deshalb ist ein editierbarer Kontrollschritt eingebaut.
- Native GoodNotes- und Samsung-Notizformate können sich zwischen App-Versionen ändern. Der Import versucht die aktuell unterstützten nativen Stiftstrukturen auszulesen. Wenn das nicht gelingt, werden eingebettete PDF-Seiten oder Vorschaubilder verwendet. Bei nicht lesbaren Fremdformaten bitte aus der Notiz-App als PDF exportieren und diese PDF importieren.
- Beim Neuaufbau werden erkannte Inhalte als Text in das gespeicherte eigene Handschriftprofil gesetzt. Das erhält nicht automatisch die ursprüngliche Position jedes einzelnen Wortes, jede Zeichnung, Tabellenstruktur oder das genaue ursprüngliche Layout. Das Layout wird anschließend durch die Schreibbot-Regler bestimmt.
- Der tatsächliche Import und das Radieren in den GoodNotes-/Samsung-Apps wurden in dieser Umgebung nicht auf einem Tablet ausgeführt.

## Geänderte Dateien
- `index.html`: Importoberfläche, Styles, initialisiert das Importmodul.
- `handwriting-import.js`: Dateileser, native Stiftparser, PDF-/Bildrendering, OCR, Textkorrektur und Übergabe an die vorhandenen Exporte.
- `service-worker.js`: Cache-Version v83 und Aufnahme des Importmoduls in den App-Shell-Cache.
