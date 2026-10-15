# Handschrift – GitHub-Upload-Paket

## Upload
1. Lade alle Dateien aus diesem ZIP herunter und entpacke sie.
2. Lade **den Inhalt dieses Ordners** in das Hauptverzeichnis (Root) deines GitHub-Repositories hoch.
3. Ersetze gleichnamige Website-/PWA-Dateien. Die vorhandenen Namen `index.html`, `manifest.webmanifest`, `register-sw.js` und `service-worker.js` müssen im Root liegen.
4. Die Datei `app-release.apk` ist die vorhandene APK-Datei, damit der APK-Download-Link der Website weiterhin eine Datei findet. **Sie wurde durch dieses Paket nicht neu gebaut**; für die neue Funktion in einer installierten Android-App muss das aktualisierte Android-Studio-Projekt neu als APK gebaut werden.

## Enthaltene Änderungen
- „Nur Schrift als Bild kopieren“ erstellt eine transparente PNG-Kopie der aktuell angezeigten Seite (ohne Papierhintergrund, Linien oder Raster), damit sie auf ein vorhandenes Arbeitsblatt gesetzt werden kann.
- „Text kopieren“ kopiert den eingegebenen Text als normalen, bearbeitbaren Text.
- Schnellwahlbuttons stellen Goodnotes (`#F8F7E9`) oder Samsung Notes (`#E6E6E6`, Raster `#B8B8B8`) inklusive A4-Papier im Hochformat und passendem Papierstil ein. Danach bleiben Format, Ausrichtung und Farben manuell anpassbar.
- Der Service Worker verwendet Cache-Version `handschrift-pwa-v12`, damit alte zwischengespeicherte Dateien ersetzt werden. `register-sw.js` prüft Updates ausdrücklich für installierte Home-Bildschirm-PWAs.

Der Browser muss die Zwischenablage-Funktion unterstützen und Zugriff erlauben. Wenn Bildkopieren nicht verfügbar ist, wird stattdessen eine transparente PNG-Datei heruntergeladen. Dieses Paket wurde auf HTML-/JavaScript-Syntax und ZIP-Integrität geprüft; es wurde nicht auf einem echten Gerät veröffentlicht oder vollständig durchgeklickt.

## Aktuelle Goodnotes-/Samsung-Notes-Vorlagen
- **Goodnotes:** Hintergrund `#F8F7E9`, warme, dezente graubeige Linien.
- **Samsung Notes:** Hintergrund `#E6E6E6`, kariertes Raster `#B8B8B8` nach dem bereitgestellten Screenshot.
- Die Vorlagen stellen Papierstil, Hintergrund und Linien gemeinsam ein; danach können sie weiter angepasst werden.
- PNG, transparente Schriftkopie und Druck/PDF unterstützen bis zu 600 dpi für einzelne Seiten; bei mehreren Seiten wird die Auflösung zum Begrenzen des Speicherbedarfs angepasst.

## Home-Bildschirm-Installation / PWA
Der Service-Worker-Cache ist auf `handschrift-pwa-v12` erhöht. `register-sw.js` prüft Updates ausdrücklich, damit installierte Home-Bildschirm-Versionen die neue `index.html` nach der Veröffentlichung übernehmen. Nach dem GitHub-Pages-Deployment die installierte App vollständig schließen und erneut öffnen; falls sie noch die alte Version zeigt, erneut schließen und einige Sekunden warten.

## Samsung Notes: echte radierbare Stiftstriche
- Der Button **„Samsung Notes (.sdocx) – radierbare Stiftstriche“** exportiert die Seiten als `.sdocx` mit einzelnen nativen Strichobjekten, nicht als Bild-PDF.
- Voraussetzung: **„Eigene Handschrift“** und gespeicherte Vektor-Strichpfade für alle verwendeten Zeichen/Wörter. Systemschrift- oder Rasterzeichen werden mit Hinweis abgelehnt, damit kein Teil der Schrift stillschweigend fehlt.
- Übernommen wird die Papierfarbe. Linien/Raster werden derzeit nicht als Samsung-Notes-Hintergrundvorlage erzeugt.
- Der ZIP-/Codecheck ist erfolgt; ein abschließender Import- und Radier-Test auf dem Zielgerät bleibt notwendig. Die vorhandene APK wurde nicht neu gebaut.


## Goodnotes: nativer Export mit Vektor-Stiftstrichen (Beta)
- Der neue Button **„Goodnotes (.goodnotes) – radierbare Stiftstriche (Beta)“** erzeugt eine `.goodnotes`-Testdatei mit eigenständigen Vektor-Stiftstrichen aus den gespeicherten eigenen Buchstaben/Wörtern.
- Aktuell unterstützt der Website-Exporter eine Seite pro `.goodnotes`-Datei. Verwende „Eigene Handschrift“; Systemschriften, Fotos und Raster-Buchstaben werden abgelehnt, damit nichts stillschweigend als Bild exportiert wird.
- `goodnotes-template.js` enthält die Strukturvorlage aus der bereitgestellten Testdatei und muss im Root neben `index.html` liegen. Der Service Worker cached sie auch offline.
- **Wichtig:** Die Goodnotes-Dateistruktur ist nicht offiziell dokumentiert. Der HTML-/JavaScript- und ZIP-Check kann erfolgreich sein, ersetzt aber keinen Import- und Radier-Test in Goodnotes selbst. Der native Samsung-Notes-Export bleibt davon unabhängig.
