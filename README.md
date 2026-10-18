# Handschrift – GitHub-Upload-Paket (Goodnotes Standard A4 / Mehrseiten)

## Installieren
1. ZIP entpacken.
2. **Alle Dateien** aus dem Ordner in das Hauptverzeichnis (Root) deines GitHub-Repositories hochladen und gleichnamige Dateien ersetzen.
3. Prüfe, dass `index.html`, `goodnotes-template.js`, `service-worker.js`, `register-sw.js` und `manifest.webmanifest` direkt im Root liegen.
4. Nach dem GitHub-Pages-Deployment die installierte Website vollständig schließen und wieder öffnen. Der Service-Worker-Cache wurde auf `handschrift-pwa-v21` erhöht.

`app-release.apk` ist die bisherige APK und wurde durch dieses Website-Paket nicht neu gebaut. Für eine native Android-App muss das Android-Studio-Projekt separat aktualisiert und neu gebaut werden.

## Goodnotes-Export
- Der Export erzeugt eine `.goodnotes`-Datei mit nativen Vektor-Stiftstrichen, nicht bloß eine umbenannte PDF.
- Die Exportseite verwendet automatisch **A4 Hochformat (595,28 × 841,89 PDF-Punkte bei 72 dpi)**, unabhängig davon, welches Papierformat in der Vorschau ausgewählt wurde. Inhalt aus anderen Formaten wird proportional skaliert und mittig platziert, damit Schrift nicht verzerrt wird.
- Mehrere Seiten werden in den Notizseitenindex und in die eingebettete A4-PDF aufgenommen.
- „Eigene Handschrift“ verwendet vorhandene Vektorpfade. Nicht gespeicherte Sonderzeichen und vorhandene Raster-Glyphen werden auf einer separaten transparenten Ebene ebenfalls in native Stift-Mittellinien nachgezeichnet. Die übrigen Schriftarten werden aus einer transparenten Darstellung in Mittellinien umgewandelt. Das ist eine geometrische Annäherung; besonders Serifenschriften, dünne Linien, Umlaute und Symbole können optisch vom Vorschaubild abweichen.
- `goodnotes-template.js` muss im Root neben `index.html` liegen. Der Service Worker cached diese Datei auch für die Offline-Nutzung.

## Samsung Notes
- Der Export als `.sdocx` erzeugt native Samsung-Notes-Strichobjekte auf Grundlage seiner eigenen Vorlagen. Die Stiftdicke wird aus dem aktuell eingestellten Regler übernommen und auf die Seiteneinheiten umgerechnet.
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


## Update v19 – Stiftdicke in nativen Exporten

- Die globale Einstellung **Stiftdicke** (`weight`, 65–135 %) wird im Samsung-Notes-Export über die gezeichneten nativen Strichbreiten übernommen. Beim Serialisieren werden die Breiten nur noch in die Seiteneinheiten umgerechnet, nicht ein zweites Mal mit dem Regler multipliziert.
- Goodnotes: Native eigene Handschrift übernimmt die im Strichpfad enthaltene Breite. Die bisherige Obergrenze für die Breite wurde von 5 auf 10 Goodnotes-Punkte erweitert, damit breite Striche nicht vorzeitig abgeschnitten werden.
- Goodnotes: Auch aus anderen Schriftarten erzeugte native Mittellinien verwenden jetzt den aktuellen Stiftdicke-Wert; der Export liest den Regler beim Erstellen der Datei aus.
- Der Service-Worker-Cache wurde auf `handschrift-pwa-v21` erhöht.

Technische Grenze: Der Export enthält native Stiftpfade und den berechneten Dickenwert. Das tatsächliche Aussehen und Radieren muss nach dem Import in der jeweiligen Goodnotes-/Samsung-Notes-App auf dem Gerät getestet werden.


## Update v21 – Goodnotes-Seite und Schriftgröße
- Goodnotes verwendet nicht mehr die kleine Seitengröße der Beispielvorlage (455,04 × 588,45 PDF-Punkte). Die PDF und die nativen Stiftkoordinaten richten sich nach der in der Website gewählten Papiergröße; A4 Hochformat entspricht 595,28 × 841,89 PDF-Punkten.
- Vor dem Export wird der erfasste Schriftblock proportional bis zu 1,9× vergrößert, soweit der verfügbare Schreibbereich es zulässt. Bei langen bzw. dichten Seiten wird die Schrift automatisch so skaliert, dass sie innerhalb der Ränder bleibt. Für alle Seiten eines Dokuments gilt derselbe Skalierungsfaktor.
- Das Raster der Goodnotes-PDF wurde an den Rasterabstand der Website angenähert. Cache-Version auf `handschrift-pwa-v21` erhöht.
- Technisch prüfbar sind Code, Maße und erzeugte PDF. Der echte Import, die endgültige Darstellung und das Radieren in Goodnotes müssen weiterhin auf dem Zielgerät kontrolliert werden.


## Update v21 – Goodnotes-Seite und automatische Schriftanpassung
- Goodnotes verwendet nicht mehr die kleine Seitengröße der älteren Beispielvorlage (455,04 × 588,45 PDF-Punkte). PDF und native Strichkoordinaten richten sich nach der in der Website ausgewählten Papiergröße; A4-Hochformat entspricht 595,28 × 841,89 PDF-Punkten.
- Der erfasste Schriftblock wird proportional bis zu 1,9× vergrößert, soweit der verfügbare Schreibbereich es zulässt. Bei dichten/langen Seiten wird die gemeinsame Skalierung reduziert, um Inhalt innerhalb der Seitenränder zu halten. Der Skalierungsfaktor ist für alle Seiten einer Notiz gleich.
- Die Stiftbreiten werden mit der Schrift mit skaliert; die linke Position und Zeileneinzüge bleiben erhalten. Das Raster der Goodnotes-PDF wurde an den Rasterabstand der Website angenähert.
- Service-Worker-Cache auf `handschrift-pwa-v21` erhöht, damit installierte Apps die neue Exportlogik laden.
- Technisch geprüft: JavaScript-Syntax, ZIP-Struktur, A4-PDF-Seitengröße und Skalierungsfunktion. Der echte Import und das endgültige Erscheinungsbild müssen weiterhin direkt in Goodnotes geprüft werden.


Goodnotes-Fit v21: Native Stiftpfade werden proportional auf die nutzbare Papierfläche skaliert, horizontal zentriert und mit Seitenrändern positioniert. Die Stiftbreite wird mit skaliert.


## Goodnotes-Fit v21
Die nativen Stiftpfade werden proportional an die nutzbare Seitenfläche angepasst, horizontal zentriert und am Seitenrand ausgerichtet. Stiftbreite und Pfadkoordinaten werden gemeinsam skaliert; die frühere feste 1,9-fache Obergrenze wurde entfernt und durch eine Flächenanpassung mit Sicherheitsgrenze ersetzt.


## Update v22 – Goodnotes-Koordinaten korrekt umrechnen

- Die Ursache war eine doppelte Skalierung: Der Export skalierte die Striche erst in Canvas-Koordinaten und anschließend erneut anhand der Canvas-Seitengröße.
- V22 berechnet die Strichpfade direkt in PDF-Punkten aus den tatsächlichen Seitenmaßen und nutzt beim Serialisieren eine Identitätstransformation.
- Der gesamte Textblock wird proportional in die verfügbare Fläche eingepasst und am eingestellten Rand platziert. Ein gemeinsamer Skalierungsfaktor wird für alle Seiten verwendet, damit die Schriftgröße mehrseitig konsistent bleibt.
- Service-Worker-Cache: `handschrift-pwa-v22`.
- JavaScript- und Dateistrukturtests können die Kompatibilität in der echten Goodnotes-App nicht ersetzen.


## Goodnotes-Export-Fix v23

Der Export skaliert die nativen Strichkoordinaten nicht länger anhand der erkannten Schriftbegrenzung. Stattdessen werden die exakt in der Website-Vorschau aufgenommenen Canvas-Koordinaten einmal proportional in die PDF-Punktmaße umgerechnet. Dadurch bleiben Schriftgröße, Position, Zeilenabstand und Einzüge relativ zur Seite wie in der Vorschau erhalten; kurze Textseiten werden nicht mehr unabhängig vergrößert oder zentriert. Der Service-Worker-Cache wurde auf v23 erhöht.


## Update v24 – Online spielen, Tic-Tac-Toe und Seitenmenü

### Website-Update
- Im Header gibt es die Schaltfläche **Online spielen** sowie links das aufklappbare Drei-Striche-Menü.
- Das Menü verlinkt Start/Generator, Online-Spiele, Scanner, eigene Buchstaben, Statistiken, Feedback, Kontakt/Impressum und Datenschutz.
- Tic-Tac-Toe unterstützt Raum erstellen, sechsstelligen Code teilen/eingeben, Lobby mit X/O, Start durch den Ersteller, abwechselnde Züge, Sieg/Unentschieden und eine neue Runde.
- Spielstände werden ungefähr alle 1,5 Sekunden vom Supabase-Projekt abgefragt, sodass mehrere Geräte dieselbe Partie sehen.
- Die Spieltabelle nutzt Row Level Security. Räume können nur von den beiden beigetretenen anonym angemeldeten Spielern gelesen werden; Erstellung, Beitritt, Züge, Spielstart und Rematch werden durch Datenbankfunktionen serverseitig validiert. Nicht verwendete Räume werden bei Erstellung eines neuen Raums entfernt, wenn sie älter als 48 Stunden sind.

### Einmalige Online-Spiel-Einrichtung (notwendig für echte Geräte-übergreifende Partien)
1. Öffne das im `index.html` konfigurierte Supabase-Projekt.
2. Aktiviere unter **Authentication → Sign In / Providers** die anonymen Anmeldungen (**Anonymous Sign-Ins**). Das Feedback-System nutzt dieselbe vorhandene anonyme Anmeldung.
3. Öffne **SQL Editor**, erstelle eine neue Abfrage und kopiere den Inhalt von `supabase_online_tictactoe_setup.sql` hinein. Führe das Skript einmal aus.
4. Lade die Website-Dateien auf GitHub Pages hoch. Die Datei `supabase_online_tictactoe_setup.sql` ist die einmalige Datenbankeinrichtung und wird nicht vom Browser ausgeführt.
5. Teste mit zwei Geräten: Auf Gerät A einen Raum erstellen; Code an Gerät B weitergeben; auf Gerät B beitreten; auf Gerät A „Spiel starten“ drücken.

### Datenschutz
- Im Online-Modus wird eine anonyme Spieler-ID verwendet. In der Tabelle stehen Raumcode, Spieler-IDs, Brettzustand, Zug, Ergebnis und Zeitstempel. Es gibt keine Eingabe für Namen, E-Mail-Adressen oder Kontakte.
- Raumcodes sind nicht für sensible/private Inhalte gedacht. Teile den Code nur mit dem Mitspieler.
- Der Cache wurde auf `handschrift-pwa-v24` angehoben.

### Technischer Prüfstatus
JavaScript-Syntax, Markup-IDs, SQL-Objekte und ZIP-Integrität werden geprüft. Ein tatsächliches Zwei-Geräte-Spiel kann ohne Ausführung des SQL-Skripts im Supabase-Projekt nicht end-to-end vorgetestet werden.


## Update v25 – Stadt, Land, Fluss und Zeichen-Erweiterung

- Online-Spiele haben nun zwei auswählbare Modi: Tic-Tac-Toe und Stadt, Land, Fluss.
- Stadt-Land-Fluss unterstützt sechsstellige Raumcodes, frei gewählte Spielernamen (max. 20 Zeichen), bis zu 8 Spieler, 2–12 eigene Kategorien, einstellbare Rundenzeit (15–180 Sekunden in der Oberfläche) und einen gemeinsamen REVEAL nach Abgabe aller Antworten oder nach Ablauf des Zeitlimits.
- Der Server zieht pro Runde einen Buchstaben, synchronisiert Spieler und Countdown sowie bewahrt die Antworten bis zum Reveal vor den anderen Spielern. Bei der Reveal-Tabelle werden Antworten je Kategorie nebeneinander gestellt. Die Punkteanzeige ist eine Orientierung (einzigartig=10, doppelt=5, leer=0), sie prüft nicht automatisch die Richtigkeit.
- Das SQL-Setup `supabase_online_tictactoe_setup.sql` wurde um die Tabellen `online_slf_rooms`, `online_slf_players`, `online_slf_submissions` sowie die RPCs `create_slf_room`, `join_slf_room`, `start_slf_round`, `submit_slf_answers`, `get_slf_room` und `next_slf_round` erweitert. Führe das gesamte Setup im SQL-Editor desselben Supabase-Projekts erneut aus; das Skript ist auf wiederholte Ausführung ausgelegt. Aktiviere außerdem unter Supabase Authentication die anonymen Anmeldungen (Anonymous Sign-Ins).
- Antworten sind in den zugrunde liegenden Tabellen für Client-Rollen nicht direkt lesbar. RPCs geben Antwortdaten erst im Status `reveal` aus. Ungültige/lange Kategorien und Antworten werden vom Server begrenzt.
- Der Zeichenkatalog der Handschrift-Übung umfasst nun zusätzliche Akzentbuchstaben, internationale Buchstaben, typografische Anführungszeichen, Satzzeichen, mathematische Zeichen, Pfeile und Häkchen/Stars.
- PWA-Service-Worker-Cache auf `handschrift-pwa-v25` erhöht.

### Online-Spiel-Setup
1. Lade alle Dateien dieses Pakets in das Hauptverzeichnis deines GitHub-Pages-Repositories und ersetze die alten Versionen.
2. Öffne dein bestehendes Supabase-Projekt und aktiviere unter Authentication → Anonymous Sign-Ins die anonymen Anmeldungen.
3. Öffne Supabase → SQL Editor und führe die gesamte aktualisierte Datei `supabase_online_tictactoe_setup.sql` aus, einschließlich des angehängten Stadt-Land-Fluss-Abschnitts.
4. Warte auf das GitHub-Pages-Deployment, schließe die installierte PWA vollständig und öffne sie neu. Gehe auf Online spielen → Stadt, Land, Fluss, stelle Namen/Kategorien/Zeit ein und erstelle einen Raum. Das zweite Gerät wählt den SLF-Tab, gibt einen eigenen Namen und den Code ein und tritt bei.

Technical checks cover JavaScript syntax, required DOM IDs, SQL object definitions, and ZIP contents. Cross-device gameplay still requires the SQL setup to be run in the actual Supabase project; this environment cannot authenticate to the user's project to test live multiplayer end-to-end.


## v26: Stadt-Land-Fluss Reveal nach Kategorie und Spieler

Das Reveal zeigt jetzt jeweils eine Kategorie, darunter einen Spielernamen und dessen Wort. Mit „Nächster Spieler“ geht es durch alle Spieler; anschließend wechselt es zur nächsten Kategorie. Nach der letzten Antwort öffnet sich der Punktestand und die kompakte Gesamttabelle. Der Fortschritt ist in Supabase gespeichert und erscheint dadurch auf allen Geräten synchron.

### Update von v25

1. Lade alle Dateien aus dem Paket ins GitHub-Hauptverzeichnis hoch und überschreibe die alten Dateien.
2. Öffne Supabase → SQL Editor und führe **supabase_slf_reveal_step_migration.sql** einmal aus. Du musst nicht das komplette Setup erneut ausführen.
3. Warte auf GitHub Pages und öffne die Website auf beiden Geräten neu.
