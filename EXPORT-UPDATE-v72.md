# Schreibbot – Update v72

## Was geändert wurde

### Arcade / Slotmaschine
- Ein Paar auf den ersten beiden Walzen zahlt jetzt **exakt 10.000 virtuelle Coins**. Dieser Paar-Gewinn wird nicht mehr mit dem Gewinnserien-Faktor multipliziert. Drei gleiche Symbole behalten die bisherige 10.500-Basis-Auszahlung samt Serienregel; der Milchstraßen-Jackpot bleibt separat.
- Bei einer Niete werden **höchstens 5.000 Coins** abgezogen, höchstens jedoch das vorhandene Guthaben.
- Die Spin-Kaufbuttons werden nach erfolgreichem oder fehlgeschlagenem Kauf wieder freigegeben. Wiederholte Käufe sind dadurch möglich; die vorhandene Serverfunktion aus v58 akzeptiert weiterhin 1, 2 oder 3 Spins pro Kauf und prüft Guthaben sowie Vorratslimit.
- Jeder gespeicherte Gewinn löst eine Konfetti-Animation über dem Bildschirm aus. Die Einstellung „Bewegung reduzieren“ wird berücksichtigt.

### Papierformate und Notizexporte
- Der Dialog für GoodNotes und Samsung Notes rendert jetzt eine echte Vorschau der ersten Seite aus dem aktuellen Text und den aktuellen Reglern.
- Alle unterstützten Formate bleiben auswählbar: A3, A4, A5, B5, A6 und US Letter, jeweils Hoch- oder Querformat.
- Die Schriftgröße, der Zeilenabstand, Buchstaben-/Wortabstände sowie Linien-, Raster- und Punktabstände werden proportional zur Papierfläche angepasst. Seitenränder und Einzug bleiben als physische Maße erhalten.
- Das gewählte Format bleibt nach dem Export auch im Haupteditor und in dessen Vorschau aktiv.
- GoodNotes erhält die ausgewählten physischen Seitengrößen über die Seitenmaße und eingebetteten Seitengrafiken. Samsung Notes erhält dieselben Seitenmaße und formatgerecht skalierte native Linien-/Raster-/Punktpfade.
- Die eigentlichen Handschriftzüge werden bei den nativen GoodNotes- und Samsung-Notes-Exporten weiterhin als einzelne Stiftpfade geschrieben. PDF und PNG sind flache Ausgaben und deshalb nicht stiftweise radierbar.

## Geänderte Dateien

- `index.html` – Arcade-Regeln, wiederholte Spin-Käufe, Konfetti, Papierformat-Skalierung und echte Formatvorschau.
- `service-worker.js` – Cache-Version auf `schreibbot-app-v72` erhöht, damit installierte PWA-Versionen die aktualisierte Seite abrufen.
- `supabase_slot_machine_update_v60.sql` – serverseitige Auszahlung und Verlustlimit.

`goodnotes-template.js` und die übrigen Projektdateien bleiben unverändert und müssen weiterhin im Projektordner liegen.

## Installation

1. Die Dateien `index.html` und `service-worker.js` im GitHub-Projekt ersetzen und die neue Datei `supabase_slot_machine_update_v60.sql` hinzufügen.
2. Im Supabase SQL Editor `supabase_slot_machine_update_v60.sql` ausführen. Die Migration baut auf dem bisherigen Stand v59 auf. Falls die Datenbank noch nicht auf v59 ist, zuerst die bisherigen Slot-Migrationen in der vorgesehenen Reihenfolge bis v59 ausführen.
3. Die Website neu laden. Bei einer installierten PWA die App vollständig schließen und neu öffnen, damit der Cache v72 geladen wird.

## Prüfung und Grenzen

- Alle ausführbaren Inline-JavaScript-Blöcke wurden mit `node --check` geprüft.
- Die neue SQL-Datei wurde auf die feste Paar-Auszahlung, den deaktivierten Serienmultiplikator für Paare und das maximale Verlustlimit geprüft. Die bestehende v58-Kauffunktion wurde auf die Mengen 1, 2 und 3 geprüft.
- Eine Live-Verbindung zur Supabase-Datenbank sowie ein echter Import-/Radier-Test in GoodNotes und Samsung Notes waren in dieser Umgebung nicht verfügbar. Die Dateien sind auf native Einzelstriche ausgelegt; der letzte Importtest muss in den jeweiligen Apps erfolgen.
- Die Android-APK wurde nicht neu gebaut. Dieses Update betrifft die Website/PWA-Dateien und die Supabase-Migration.
