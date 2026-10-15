# Handschrift – GitHub-Upload-Paket (Goodnotes Standard A4 / Mehrseiten)

## Installieren
1. ZIP entpacken.
2. **Alle Dateien** aus dem Ordner in das Hauptverzeichnis (Root) deines GitHub-Repositories hochladen und gleichnamige Dateien ersetzen.
3. Prüfe, dass `index.html`, `goodnotes-template.js`, `service-worker.js`, `register-sw.js` und `manifest.webmanifest` direkt im Root liegen.
4. Nach dem GitHub-Pages-Deployment die installierte Website vollständig schließen und wieder öffnen. Der Service-Worker-Cache wurde auf `handschrift-pwa-v16` erhöht.

`app-release.apk` ist die bisherige APK und wurde durch dieses Website-Paket nicht neu gebaut. Für eine native Android-App muss das Android-Studio-Projekt separat aktualisiert und neu gebaut werden.

## Goodnotes-Export
- Der Export erzeugt eine `.goodnotes`-Datei mit nativen Vektor-Stiftstrichen, nicht bloß eine umbenannte PDF.
- Die Exportseite verwendet automatisch **A4 Hochformat (595,28 × 841,89 PDF-Punkte bei 72 dpi)**, unabhängig davon, welches Papierformat in der Vorschau ausgewählt wurde. Inhalt aus anderen Formaten wird proportional skaliert und mittig platziert, damit Schrift nicht verzerrt wird.
- Mehrere Seiten werden in den Notizseitenindex und in die eingebettete A4-PDF aufgenommen.
- „Eigene Handschrift“ verwendet vorhandene Vektorpfade. Nicht gespeicherte Sonderzeichen und vorhandene Raster-Glyphen werden auf einer separaten transparenten Ebene ebenfalls in native Stift-Mittellinien nachgezeichnet. Die übrigen Schriftarten werden aus einer transparenten Darstellung in Mittellinien umgewandelt. Das ist eine geometrische Annäherung; besonders Serifenschriften, dünne Linien, Umlaute und Symbole können optisch vom Vorschaubild abweichen.
- `goodnotes-template.js` muss im Root neben `index.html` liegen. Der Service Worker cached diese Datei auch für die Offline-Nutzung.

## Samsung Notes
- Der bestehende Export als `.sdocx` bleibt separat und unverändert. Er erzeugt native Samsung-Notes-Strichobjekte auf Grundlage seiner eigenen Vorlagen.
- Samsung Notes verwendet ein anderes Dateiformat als Goodnotes; für diese App ist der Goodnotes-A4-Export nicht zuständig.

## Weitere Websitefunktionen
- PNG/PDF-Export und transparente PNG-Schriftkopie bleiben enthalten.
- `datenschutz.html`, `impressum.html`, Icons, Manifest und Service-Worker-Dateien bitte zusammen mit `index.html` hochladen.

## Geprüft / nicht garantiert
- JavaScript-Syntax sowie ZIP- und PDF-Containerstruktur geprüft.
- Test mit drei nativen Notizseiten erfolgreich: ZIP enthält drei `notes/`-Seitendaten, die Seiten stehen im `index.notes.pb`, und die eingebettete A4-PDF hat ebenfalls drei Seiten.
- Unicode-Test für deutsche Umlaute, kombinierte Akzente und verbundene Emoji-Grapheme erfolgreich. Die komplette Export-UI konnte in dieser Umgebung nicht mit einem normalen Browser geöffnet werden, daher ist der komplette Canvas-Trace nicht end-to-end verifiziert.
- Ein vollständiger Goodnotes-App-Import mit Radier-Test lässt sich in dieser Umgebung nicht selbst ausführen. Bitte erst eine kurze Testnotiz importieren und die Schrift auf mehreren Seiten samt Radieren prüfen. Das `.goodnotes`-Format ist nicht offiziell dokumentiert; die Exportlogik basiert auf einer Reverse-Engineering-Vorlage aus der bereitgestellten Testdatei.


## Goodnotes-Mehrseiten- und Sonderzeichen-Fix (v16)

- Der Goodnotes-Export übernimmt alle automatisch erzeugten Notizseiten, nicht nur die erste Seite. Pro Seite werden native Notiz-Strichdaten und ein Eintrag im Seitenindex erstellt; die beigefügte PDF wird auf dieselbe Seitenzahl gesetzt.
- Texte werden vor dem Layout in Unicode-NFC normalisiert und mit Graphem-Clustern verarbeitet. Dadurch bleiben zusammengesetzte Umlaute und mehrteilige Zeichen zusammen.
- Im Modus „Eigene Handschrift“ werden Zeichen ohne gespeicherten Vektor-Glyphenpfad (z. B. €, §, © oder nicht angelegte Umlaute) als Systemschrift-Fallback gezeichnet und in native Goodnotes-Striche nachgezeichnet, statt den gesamten Export daran scheitern zu lassen.
- Der Export mit anderen Schriftarten wandelt weiterhin die gerenderte Schrift lokal in native Stiftpfade um. Die Form kann durch das Centerline-Tracing etwas von der Vorschau abweichen.
- Der Web-App-Cache wurde auf v16 erhöht. Nach dem Upload auf GitHub Pages die App vollständig schließen und erneut öffnen.

Technisch geprüft: JavaScript-Syntax, Unicode-/Graphem-Layout-Helfer, native Strichpfad-Erzeugung, ZIP-Struktur und Mehrseiten-Index. Der tatsächliche Import und Radierer müssen weiterhin in Goodnotes auf dem Zielgerät getestet werden.


## Update v17 – Goodnotes-Format, Samsung-Download, Regler und Feedback

- Goodnotes: native Seiten und eingebettete PDF verwenden die Maße aus der mitgelieferten Goodnotes-Vorlage (aktuell 455,04 × 588,45 PDF-Punkte), und Text/Striche werden proportional in diese Seite eingepasst.
- Samsung Notes: `.sdocx` wird als `application/octet-stream` mit der passenden Dateiendung ausgeliefert. Der SHA-256-Wert am Ende von `note.note` und der zugehörige Wert in `pageIdInfo.dat` werden nach Änderung der Seitengröße ebenfalls neu berechnet. Außerdem ist das UUID-Feld der nativen Stiftobjekte korrigiert: es wird am richtigen Offset als ASCII/UTF-8 geschrieben, statt per UTF-16 zwei Bytes zu früh angrenzende Strichdaten zu überschreiben. Die Schrift bleibt als native Strichobjekte angelegt. Bitte den Import und das Radieren auf dem Gerät testen; ein Start in Samsung Notes ist in dieser Umgebung nicht simulierbar.
- Regler: Zahlenwerte bleiben neben dem tatsächlichen Range-Control ausgerichtet. Neuer Regler für zusätzlichen linken Einzug jeder Textzeile (0–40 mm) wird gespeichert und direkt auf die Vorschau angewendet.
- Feedback: optionale 1–5-Sterne-Bewertung. Sie wird im bestehenden Backend kompatibel im Feedbacktext abgelegt, sodass keine Änderung der vorhandenen Datenbanktabelle nötig ist.

Cache-Version auf `handschrift-pwa-v17` erhöht. Nach dem Deployment die installierte Website vollständig schließen und neu öffnen.


## Update v18 – Mehrseiten in Goodnotes und Samsung Notes

- Goodnotes: Neben den `notes/<ID>`-Stiftdaten und den Einträgen in `index.notes.pb`/`index.search.pb` werden auch die seitenspezifischen Einträge des längenpräfixierten `index.events.pb` für jede zusätzliche Seite mit eigenen Content-/Entity-IDs angelegt. Vor dem Download prüft der Export, ob jede Seite in allen erwarteten Indexen und als eigene Stiftdatei vorhanden ist.
- Samsung Notes: Der Export baut weiterhin eine `.page`-Datei pro Ausgabeseite plus die übliche leere Schlussseite für Kompatibilität. `pageIdInfo.dat` erhält nun ausdrücklich den Hash-/Prüfblock aus der jeweils dazugehörigen `.page`-Datei; vor dem Download werden Reihenfolge, Anzahl, Dateinamen und Prüffelder gegen die komplette Seitenliste geprüft.
- Der Service-Worker-Cache wurde auf `handschrift-pwa-v18` erhöht.

Diese Prüfungen stellen sicher, dass die erstellte Datei strukturell alle Seiten enthält. Da Goodnotes- und Samsung-Notes-Importe proprietäre App-Logik verwenden, muss das Öffnen in den Ziel-Apps weiterhin auf dem Gerät verifiziert werden.
