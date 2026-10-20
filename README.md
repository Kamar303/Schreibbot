# Handschrift – GitHub-Upload-Paket (Goodnotes Standard A4 / Mehrseiten)

## Installieren
1. ZIP entpacken.
2. **Alle Dateien** aus dem Ordner in das Hauptverzeichnis (Root) deines GitHub-Repositories hochladen und gleichnamige Dateien ersetzen.
3. Prüfe, dass `index.html`, `goodnotes-template.js`, `service-worker.js`, `register-sw.js` und `manifest.webmanifest` direkt im Root liegen.
4. Nach dem GitHub-Pages-Deployment die installierte Website vollständig schließen und wieder öffnen. Der Service-Worker-Cache dieser Version ist `handschrift-pwa-v40`.

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
- Der Service-Worker-Cache dieser Version ist `handschrift-pwa-v39`.

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


## v27: Goodnotes-Schrift füllt die Seite

Der native Goodnotes-Export rendert den Inhalt nun mit export-spezifischer, automatisch gewählter Schriftgröße neu. Die Schrift wird erneut umbrochen, bis Breite und Höhe der beschriebenen Fläche den größten Teil der Seite einnehmen. Die Größeinstellung der Website wird danach wiederhergestellt; die Vorschau und die gespeicherten Nutzereinstellungen bleiben unverändert. Längere Texte können dadurch auf mehr Goodnotes-Seiten umbrochen werden.


## Goodnotes-Seitenfüllung v28

Der native Goodnotes-Export durchläuft jetzt bis zu 10 adaptive Render-Schritte und erhöht die Export-Schriftgröße bis zu einer klaren Grenze. Die Zeilen werden bei jedem Durchlauf neu umbrochen. Ziel ist ca. 88 % Seitenbreite und 84 % Seitenhöhe; lange Texte dürfen zusätzliche Notizseiten erzeugen. Die Größe in der Website-Vorschau wird nach dem Export unverändert wiederhergestellt. In der Browser-Konsole stehen gemessene Breite/Höhe und die Zahl der Canvas-Seiten.


## v29 – Arcade-Slotmaschine mit Hebel und Rangliste

- Der Online-Spielbereich enthält jetzt drei Modi: Tic-Tac-Toe, Stadt-Land-Fluss und eine Slotmaschine im Retro-Arcade-Stil.
- Die Slotmaschine hat drei animierte Walzen, einen sichtbaren ziehbaren Hebel, Gewinnanimation, Spielername, Punktestand und eine globale Top-10-Rangliste.
- Nur kostenlose Drehungen und virtuelle Spielpunkte: keine Einsätze, keine Echtgeldfunktion, keine Käufe und keine Auszahlung. Punkte sind nicht gegen Geld/Waren eintauschbar.
- Das Ergebnis jeder Drehung und die Punkte werden serverseitig durch Supabase RPC berechnet, nicht nur im Browser. Das verhindert, dass die Animation allein das Ergebnis festlegt. Die Rangliste nutzt anonyme Supabase-Spielersitzungen.
- Neue SQL-Datei: `supabase_slot_machine_setup.sql` (eine entsprechende `.txt`-Kopie für leichteres Kopieren). Im selben Supabase-Projekt wie die Website im SQL Editor einmal ausführen. Anonymous Sign-Ins müssen in Supabase Auth eingeschaltet sein.
- Die Website meldet klar, wenn die SQL-Einrichtung fehlt. Bei Anzeige „Rangliste noch nicht eingerichtet“ SQL ausführen, auf GitHub Pages warten und App neu öffnen.
- Datenschutzdatei aktualisiert, PWA-Cache auf `handschrift-pwa-v29` gesetzt.

### Setup der Slotmaschine
1. Lade alle Website-Dateien aus dem Paket in das GitHub-Hauptverzeichnis und überschreibe die alten Dateien.
2. Öffne Supabase → SQL Editor im bestehenden Projekt und führe `supabase_slot_machine_setup.sql` einmal aus.
3. Kontrolliere unter Authentication, dass Anonymous Sign-Ins aktiviert ist.
4. Warte auf GitHub Pages-Deployment, schließe die installierte Website vollständig und öffne sie erneut.
5. Online spielen → Slotmaschine. Trage einen Anzeigenamen ein und drücke „Kostenlos drehen“. Die Rangliste erscheint nach dem ersten Eintrag.

### Technische Prüfungen
JavaScript-Syntax, IDs der Slot-Steuerelemente, SQL-Funktionen, Cache-Version und ZIP-Integrität können lokal geprüft werden. Ein echter Datenbankaufruf erfordert das Supabase-Projekt des Website-Betreibers; er wurde in dieser Umgebung nicht live ausgeführt.


## v30 – Arcade-Thema, sichere Slot-Punkte und Handschrift-Autosave

- Beim Auswählen der Slotmaschine wird die Website in eine dunkle Casino-/Arcade-Farbwelt umgeschaltet. Mit „Slotmodus verlassen“ oder beim Wechsel in ein anderes Spiel wird das normale Theme wiederhergestellt.
- Die Slot-Walzen enthalten jetzt 🍓. Drei Erdbeeren ergeben 750 Arcade-Punkte; die Resultate bleiben serverseitig zufällig. Neue Spielprofile erhalten 10 kostenlose Startpunkte. Die Punkte können nicht eingesetzt, verloren, gekauft oder ausgezahlt werden; jeder Dreh bleibt kostenlos.
- Slot-Leaderboard-Namen sind editierbar und werden im Browser sowie serverseitig auf beleidigende/diskriminierende Begriffe geprüft. Für bestehende Datenbanken `supabase_slot_machine_update_v30.sql` einmal im SQL Editor ausführen.
- Stadt-Land-Fluss: Wahl zwischen Tastatur und Handschrift. Im Handschriftmodus wird auf der Leinwand ausschließlich ein vom Browser als aktiver Digitalstift erkannter Pen-Eingabestrom akzeptiert (z. B. S Pen, Apple Pencil oder kompatibler Dell-Stift); Finger und Handballen-Eingaben zeichnen nicht. Eingaben/Striche werden automatisch über `save_slf_draft` gespeichert. Es gibt keinen Abgabe-Button mehr; nach Ablauf der Runde wird das Reveal gezeigt.
- Handschriftantworten werden als Strichdaten angezeigt, nicht automatisch mit OCR in Text umgewandelt. Die automatische Punktevergabe vergleicht daher nur getippte Antworten; Handschriftantworten müssen die Spieler gemeinsam bewerten.
- Für bestehende Datenbanken die Migration `supabase_slf_autosave_handwriting_v30.sql` einmal im selben Supabase-Projekt ausführen. Beide Migrationen sind auch als `.txt`-Kopie vorhanden.
- Cache auf `handschrift-pwa-v30` erhöht.

### Update von v29
1. Alle Dateien aus diesem Paket in das GitHub-Hauptverzeichnis laden und überschreiben.
2. Im bestehenden Supabase-Projekt SQL Editor öffnen und `supabase_slf_autosave_handwriting_v30.sql` ausführen.
3. Danach `supabase_slot_machine_update_v30.sql` ausführen.
4. GitHub Pages Deployment abwarten und die installierte Website komplett schließen und neu starten.

Es bleiben Freispiele mit Punkten statt Einsätzen/Verlusten; das System ist ein kostenloses Arcade-Spiel und kein Geldspiel. JavaScript/Dateien und das Browser-Verhalten wurden lokal geprüft; Live-SQL musste im eigenen Supabase-Projekt noch ausgeführt werden.


## v31 – Slot-Coins, Reel-Stop-Animation und SLF-Autosave

- Die Slotmaschine zeigt virtuelle Arcade-Coins (10 Start-Coins für neue Profile). Spins sind kostenlos: kein Einsatz, kein Coin-Abzug und keine Verlust-/Game-over-Schleife. Server-RNG vergibt bei Treffer Coins; drei Erdbeeren ergeben +750 Coins. Die Walzen stoppen nacheinander mit kurzer Animation.
- Das Casino-Theme bleibt auf den ausgewählten Slotmodus beschränkt; bei „Slotmodus verlassen“/Spielwechsel wird die normale Website-Farbwelt zurückgestellt.
- Namen können editiert werden und werden im Browser sowie serverseitig auf beleidigende/diskriminierende Begriffe geprüft. Die Online-Top-10 zeigt Coins statt einer undurchsichtigen Punktzahl.
- Stadt-Land-Fluss unterstützt weiterhin Tastatur oder Handschrift mit automatischer Speicherung. Handschrift liegt als Stiftspur vor und wird beim Reveal sichtbar, aber nicht automatisch per OCR transkribiert; getippte Antworten werden automatisch gespeichert und ausgewertet.
- Für bestehende Supabase-Projekte aus v29/v30 die vorhandenen Migrationen ausführen, falls noch nicht getan: `supabase_slf_autosave_handwriting_v30.sql` und `supabase_slot_machine_update_v30.sql`. Der Slot-Update-Name ist wichtig für Editierbarkeit und Filter.
- PWA-Cache auf `handschrift-pwa-v31` erhöht.


## v31 – Arcade-Coins und Animation

- Slotmodus hat jetzt eine eigene dunkle Casino-/Arcade-Optik, die nur aktiv ist, solange die Slotmaschine ausgewählt ist. Der Button „Slotmodus verlassen“ führt zurück zum zuvor ausgewählten Spiel und entfernt die Casino-Optik.
- Die Slotmaschine zieht Symbole serverseitig zufällig. Neue Profile starten mit 10 virtuellen Arcade-Coins. Drehs kosten keine Coins; bei Treffern können Coins hinzukommen, aber Coins werden nicht gesetzt oder abgezogen und es gibt keine Echtgeldfunktion oder Auszahlung. Erdbeer-Jackpot 🍓🍓🍓: +750 Coins.
- Die Walzen stoppen nacheinander, damit der Hebel-/Slot-Effekt deutlicher aussieht. Anzeigenamen sind änderbar und werden mit einem respektvollen Namensfilter geprüft.
- Stadt-Land-Fluss unterstützt weiterhin Tastatur und handschriftliche Stiftspuren; beides wird automatisch gespeichert. Ein manueller Abgabe-Button ist nicht nötig. Handschrift wird als Strichspur angezeigt, nicht automatisch durch OCR in Text umgewandelt.

### Für ein bestehendes v29/v30-Supabase-Projekt
Wenn du die Migrationen noch nicht ausgeführt hast, öffne Supabase → SQL Editor und führe nacheinander `supabase_slf_autosave_handwriting_v30.sql` und `supabase_slot_machine_update_v30.sql` im selben Projekt aus. Danach alle Website-Dateien hochladen, GitHub Pages abwarten und die installierte PWA vollständig schließen und neu öffnen.


## v32 – Slotmaschine poliert, freiwillige Checkliste und Spielzeit-Check-in

- Verbesserte Hebel-Rückfederung, Walzen-Stoppanimation, laufende Kabinettslichter und kurze, begrenzte Treffer-Partikel.
- Neue freiwillige Arcade-Checkliste mit drei Punkten: Anzeigenamen prüfen, Regeln ansehen, einen kostenlosen Probedreh durchführen. Sie vergibt keine Coins, Serien oder Ranglistenboni. Fortschritt wird nur lokal gespeichert.
- Eine Spielzeitanzeige zählt nur, solange Slotmodus aktiv und nicht pausiert ist. Nach zehn Minuten erscheint ein kleiner, nicht blockierender Pausenhinweis. Pause, Hinweis schließen, Slotmodus verlassen und Fertig-für-jetzt stehen immer zur Verfügung. Es gibt keinen Bonus für lange Sitzungen.
- Stadt-Land-Fluss behält die Auswahl zwischen Tastatur und Stift bei. Eingetippte Antworten sowie Stiftspuren werden nach kurzer Verzögerung automatisch in Supabase gespeichert; eine manuelle Abgabe ist nicht nötig. Der Status zeigt Speichern, Erfolg oder Fehler.
- Keine neuen Tabellen nötig; die bestehende v31 Slot- und Stadt-Land-Fluss-SQL bleibt gültig. Service-Worker-Cache auf `handschrift-pwa-v32` angehoben.

### Update
Alle Dateien aus diesem Paket in den Root des GitHub-Pages-Repositories hochladen und die alten Dateien ersetzen. Nach abgeschlossenem Deployment die installierte Website vollständig schließen und neu öffnen, damit der neue Cache verwendet wird.

Hinweis: Die Website/PWA-Dateien wurden aktualisiert. `app-release.apk` ist die bisherige Datei und wurde in diesem Schritt nicht neu kompiliert.


## v33 – Goodnotes-Export füllt die Seite

Die Ursache im bisherigen Auto-Fit war eine zu frühe Abbruchbedingung: Der Algorithmus akzeptierte bereits ca. 78 % Seitenbreite und 80 % Seitenhöhe, obwohl das Ziel bei 88/84 % lag. v33 verlangt jetzt mindestens 98 % des Zielwertes für Breite und Höhe (Ziel 91 % / 90 %) bevor die Suche stoppt und reflowt weiter bis zur gewählten Seitenausnutzung. Der Cache wurde auf `handschrift-pwa-v33` aktualisiert.


## v34 – native Goodnotes-Stiftstriche auf A4 einpassen

Die automatische Textgröße wird jetzt an der nutzbaren Seitenbreite (eingestellte Seitenränder werden berücksichtigt) und an 92 % der Seitenhöhe ausgerichtet. Danach misst ein zweiter, separater Schritt die tatsächlichen nativen Stiftstriche und setzt sie proportional mit einem einheitlichen Skalierungsfaktor auf A4: die dominante Dimension nutzt 94 % der Seite; alle Folgeseiten erhalten dieselbe Schriftgröße. Die Stiftpfade bleiben native, radierbare Striche. Die Datei trägt den Namen `handschrift-goodnotes-v34-A4-vollseite.goodnotes`, sodass sie leicht von älteren Exporten zu unterscheiden ist. PWA-Cache: `handschrift-pwa-v34`.


### v34 Testnachweis

Ein lokaler Browser-Export mit Beispieltext wurde erzeugt und die `.goodnotes`-ZIP-Inhalte wurden geprüft. Der eingebettete PDF-Anhang hat A4-Maße (595,28 × 841,89 pt); die nativen Stiftkoordinaten der ersten Seite belegen im Test rund 85–86 % der Seitenbreite und 94 % der Seitenhöhe. Das prüft die erzeugten Koordinaten, ersetzt aber keinen tatsächlichen Importtest in der Goodnotes-App auf dem iPad.


## v35 – Slotmaschine sichtbar und mit Hinweis vor dem Öffnen

- Die Spielauswahl zeigt jetzt drei gut sichtbare Kacheln. „Slotmaschine“ lässt sich direkt aus der Spieleübersicht oder über den Menüpunkt „Slotmaschine direkt öffnen“ auswählen, statt nur über den dritten Reiter gesucht werden zu müssen.
- Vor dem ersten Öffnen der Slotmaschine pro Seitenaufruf erscheint ein Hinweis: reine Glückssimulation, zufällige Ergebnisse, Coins ohne Geldwert, keine Echtgeldzahlungen und keine Auszahlung; dazu ein klarer Pausenhinweis.
- Die Gestaltung verwendet keine Serienboni oder Zeitdruck. Es gibt bis zu zwei kostenlose Freispiele und zusätzlich gekaufte virtuelle Spins, die ausschließlich mit erspielten Coins bezahlt werden. Coins haben keinen Geldwert.
- Geänderte Website-Dateien: `index.html` und `service-worker.js`. Der Service-Worker-Cache ist auf `handschrift-pwa-v35` erhöht, damit die PWA die Aktualisierung laden kann. Supabase-SQL muss für diese Änderungen nicht erneut ausgeführt werden.


## v39 – Coin-Multiplikator, Spin-Pakete und Spin-Sound

- Coin-Multiplikator: ein Upgrade erhöht den Bonus auf Gewinne um +0,1 Prozentpunkte und kostet 5 virtuelle Coins. Der Multiplikator ist bei 200 % Gesamtmultiplikator gedeckelt. Der Bonus wird serverseitig berechnet; Bruchteile werden gespeichert und gesammelt, bis sie einen ganzen Coin ergeben.
- Spin-Shop: 1 gekaufter Spin kostet 50 Coins; 3 gekaufte Spins kosten zusammen 125 Coins. Gekaufte Spins werden zuerst verbraucht. Bis zu 2 Freispiele regenerieren im Serverprofil alle 30 Sekunden. Bei zwei gleichen Symbolen kommt ein Freispiel dazu, sofern noch Platz im 2er-Vorrat ist.
- Der bestehende Shop für digitale Sammlerstücke (Goldener Stift, Neon-Atelier, Bugatti, Yacht) bleibt vorhanden; die vollständige Sammlung schaltet den Platin-Sammler-Look frei. Alles ist virtuell und nicht auszahlbar.
- Der Spin-Sound wird ohne externe Audiodatei über Web Audio erzeugt und lässt sich im Spiel ein-/ausschalten. Der Hebel bekommt eine längere Rückfeder-Animation.
- Neue Migration: `supabase_slot_machine_update_v39.sql`. Nach den bisherigen Slot-SQL-Dateien im selben Supabase-Projekt im SQL Editor einmal ausführen.
- PWA-Cache ist auf `handschrift-pwa-v39` erhöht und die Service-Worker-Vorladeliste enthält nur tatsächlich benötigte vorhandene Dateien.

### Upgrade von v35/v36/v38
1. Website-Dateien aus diesem Paket ins Repository-Root hochladen und alte Dateien ersetzen.
2. In Supabase nacheinander das bisherige Basis-Setup (`supabase_slot_machine_setup.sql`), falls noch nicht geschehen, dann `supabase_slot_machine_update_v30.sql` und anschließend `supabase_slot_machine_update_v39.sql` ausführen. Falls die bisherigen Slot-Funktionen bereits laufen, genügt normalerweise v39.
3. Auf GitHub Pages warten und die installierte PWA vollständig schließen und erneut öffnen.
4. Den Spin-Sound kannst du unter „Soundeffekte“ jederzeit ausschalten.


## v40 – Arcade-Streaks, Code-Belohnungen, 3D-Shop und Münzwurf

- Nieten ziehen bis zu 15 virtuelle Coins ab (nie mehr als das vorhandene Guthaben). Back-to-back Gewinne erhöhen den Grundgewinn je aufeinanderfolgendem Treffer: 15, 30, 45 Coins usw.
- Der Coin-Multiplikator kostet 10 Coins pro Upgrade und steigt um +0,5× pro Stufe (max. 10×).
- Gewinne ab 500 Coins können optional über „Doppelt oder Nichts“ per serverseitigem, zufälligem Münzwurf riskiert werden. Die Wahl von Kopf/Zahl und das Ergebnis werden serverseitig geprüft.
- Die nächsten zwei Jackpot-Spins lassen sich durch einen speziellen Belohnungscode garantieren. Zusätzliche Arcade-Codes vergeben 10.000 Coins, 100 Bonus-Spins und virtuelle OP-Rechte. Codes sind pro Spielerprofil einmal einlösbar; OP-Rechte erlauben nur virtuelle Spielbelohnungen für das eigene Profil.
- Der Coin-Shop hat zehn Sammlerstücke inklusive Bugatti Chiron und Gegenständen bis 50.000 Coins. CSS-basierte 3D-Drehanimationen zeigen die Gegenstände sowohl im Shop als auch in der Garage.
- Stadt-Land-Fluss unterstützt Runden bis fünf Minuten. Im Handschriftmodus akzeptiert das Canvas nur Pointer-Eingaben des Typs „pen“; die tatsächliche Stifterkennung hängt vom Betriebssystem und Browser ab.
- Neue Migration: `supabase_slot_machine_update_v40.sql`. In demselben Supabase-Projekt nach den bisherigen Slot-Dateien und `supabase_slot_machine_update_v39.sql` einmal im SQL Editor ausführen. Erst danach funktionieren die neuen Serverfunktionen live.
- Der Service-Worker-Cache ist auf `handschrift-pwa-v40` erhöht. Nach dem Deployment die installierte Website vollständig schließen und erneut öffnen.

Technisch geprüft: JavaScript-Syntax, eindeutige HTML-IDs, Verknüpfung der neuen UI-Elemente, Code-Hashwerte und SQL-RPC-Schnittstellen statisch geprüft. Eine echte End-to-End-Ausführung mit deiner Supabase-Instanz war hier nicht möglich; Migration und Live-Spiel müssen nach dem Import auf dem Zielprojekt getestet werden.


## v41 – Arcade-Fixes für Nieten, Multiplikator, Codes und Doppelt oder Nichts

- Eine Niete zieht jetzt bis zu 250 virtuelle Coins ab. Das Guthaben fällt nicht unter null.
- Der zusätzliche Geldbonus greift nur beim zweiten Gewinn in Folge. Der erste, dritte und spätere Gewinne erhalten nur den jeweiligen Grundgewinn.
- Codes werden robuster geprüft, unabhängig davon, ob `pgcrypto` im Supabase-Projekt im Schema `public` oder `extensions` liegt. Die vier bekannten Codes werden beim Ausführen der Migration erneut aktiviert.
- Ein Gewinn ab 500 Coins bleibt offen, bis Kopf/Zahl gewählt wurde. Ein weiterer Spin ist bis dahin gesperrt, damit der Münzwurf nicht versehentlich überschrieben wird.
- Doppelt oder Nichts wird serverseitig aufgelöst und aktualisiert das Coin-Guthaben nach dem Ergebnis.

### Update auf v41
1. Lade alle Dateien aus dem ZIP ins Repository und ersetze die alten Dateien.
2. Öffne Supabase → SQL Editor im selben Projekt.
3. Führe `supabase_slot_machine_update_v41.sql` aus. Dafür müssen Setup, v30, v39 und v40 bereits eingerichtet sein.
4. Warte, bis GitHub Pages aktualisiert wurde, und lade die Website hart neu bzw. schließe und starte die installierte PWA.
5. Teste zuerst einen Code, danach einen Spin. Bei einem Gewinn ab 500 Coins musst du den Münzwurf auflösen, bevor du erneut drehst.

Die lokale Prüfung deckt JavaScript-Syntax, SQL-Objekte, Code-Hashes und ZIP-Inhalt ab. Ein Live-Test gegen das Supabase-Projekt ist ohne Zugriff auf dein Projekt nicht möglich.




## v42 – Reparatur für Codes, Münzwurf und Slotmaschinen-Sound

- Niete: zieht 250 virtuelle Coins ab, höchstens bis auf 0.
- Geldbonus: der Back-to-back-Bonus gilt ausschließlich beim zweiten Gewinn hintereinander. Dritter und weitere Gewinne gehen wieder auf den normalen Grundgewinn zurück.
- Gekaufter +0,5x-Multiplikator: wird ebenfalls nur beim zweiten Gewinn in Folge addiert und wird korrekt auf den Grundgewinn statt auf den bereits verdoppelten Gewinn berechnet.
- Codes: die vier mitgelieferten Codes werden serverseitig explizit auf ihre Hashes abgebildet; so hängt die Einlösung nicht davon ab, in welchem Schema `pgcrypto` installiert ist. Jeder Code kann je anonymem Spielerprofil einmal eingelöst werden.
- Doppelt oder Nichts: der offene Gewinn bleibt erhalten, bis Kopf/Zahl gewählt wird. Die Statusmeldung bleibt bei einem Ladefehler sichtbar; während ein offener Münzwurf besteht, wird ein weiterer Spin blockiert.
- Sound: mechanisches Walzenrattern mit beschleunigtem Motor, langsamer werdenden Klicks und eigenem Klack beim Stoppen jeder Walze. Es werden keine externen Audio-Dateien geladen.

### Update auf v42
1. Lade alle Dateien aus dem ZIP in das Root-Verzeichnis des Repositories hoch und ersetze die vorhandenen Dateien.
2. In Supabase muss das bisherige Slot-Setup (Setup, v30, v39 und v40) bereits eingerichtet sein.
3. Führe `supabase_slot_machine_update_v42.sql` im Supabase-SQL-Editor aus. Die Migration bündelt die v41-Struktur und behebt die Funktionen; sie kann auch nach einer bereits ausgeführten v41-Migration angewendet werden.
4. Stelle in Supabase unter Authentication sicher, dass **Anonymous Sign-Ins** aktiviert sind.
5. Warte, bis das Deployment abgeschlossen ist, und schließe die installierte PWA vollständig, dann öffne sie neu.
6. Teste einen der vier Codes. Falls er bereits für dieses Spielerprofil eingelöst wurde, ist eine erneute Einlösung absichtlich gesperrt.
7. Für Doppelt oder Nichts muss ein einzelner Gewinn mindestens 500 Coins betragen. Wähle anschließend Kopf oder Zahl, bevor du den nächsten Spin startest.

Der Code wurde lokal auf Syntax, Hash-Zuordnung, SQL-Funktionssignaturen, ZIP-Integrität und die zentrale Gewinnlogik geprüft. Ein Live-Test gegen die Supabase-Datenbank war ohne Zugriff auf das Benutzerprojekt nicht möglich.
