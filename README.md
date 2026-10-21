# Schreibbot Arcade v47

## Neue Gewinnserien-Regel

Der alte, separat kaufbare Coin-Multiplikator wird nicht mehr verwendet. Stattdessen verdoppelt sich der gesamte Grundgewinn bei jedem aufeinanderfolgenden Gewinn:

- 1. Gewinn: Grundwert × 1
- 2. Gewinn in Folge: Grundwert × 2
- 3. Gewinn in Folge: Grundwert × 4
- 4. Gewinn in Folge: Grundwert × 8
- 5. Gewinn in Folge: Grundwert × 16

Das gilt auch, wenn sich der Grundwert ändert: Ein Grundgewinn von 25 Coins gefolgt von einem Grundgewinn von 500 Coins zahlt beim zweiten Treffer 1.000 Coins. Eine Niete setzt die Gewinnserie zurück. Die Serverfunktion berechnet die Auszahlung. Das Coin-Konto ist auf 1.000.000.000 begrenzt; eine Auszahlung wird an den freien Platz im Guthaben angepasst, damit keine Überläufe entstehen.

Streak-Punkte bleiben separat kosmetisch: +1 beim ersten Gewinn, +2 beim zweiten, danach maximal +3 pro Treffer. Sie beeinflussen die Coin-Auszahlung nicht.

## Dateien

- `index.html`: aktualisierte Anzeige des Streak-Faktors und Regeln
- `service-worker.js`: Cache v47, damit installierte PWAs die Änderung laden
- `supabase_slot_machine_update_v47.sql`: Datenbank-Migration, aktualisiert die serverseitige Spin-Funktion und behält die Code-Registrierung/den Logo-Geheimbonus bei
- Bisherige SQL-Migrationen bleiben zur Nachvollziehbarkeit enthalten.

## Installation

1. Lade die aktualisierten Dateien aus diesem ZIP in dein vorhandenes GitHub-Repository hoch.
2. Öffne dasselbe Supabase-Projekt wie die Arcade. Voraussetzung ist, dass das vollständige v46-Setup bereits ausgeführt wurde.
3. Im Supabase SQL Editor die Datei `supabase_slot_machine_update_v47.sql` ausführen.
4. Warte auf das Website-Deployment und schließe die installierte PWA vollständig, bevor du sie erneut öffnest. Der Service-Worker-Cache wurde auf v47 erhöht.
5. Teste mindestens diese Folge: Gewinn mit 25 Grundcoins (Auszahlung 25), nächster Gewinn mit 25 Grundcoins (Auszahlung 50), dritter Gewinn 25 (Auszahlung 100), vierter Gewinn 25 (Auszahlung 200). Teste anschließend eine Niete; danach muss die nächste Gewinnserie wieder bei ×1 starten.

## Checks und Grenzen

Die Änderung ist serverseitig: allein das Anzeigen eines Faktors im Browser verändert keine Auszahlung. Die alte `multiplier_steps`-Spalte bleibt aus Kompatibilitätsgründen vorhanden, wird aber auf 0 gesetzt und beeinflusst die Berechnung nicht. Code-Hash-Registrierungen und vorhandene v46-Features sind in der Migration enthalten.

Die lokale JavaScript-Syntax, die Formel an Beispielwerten, die HTML-IDs und die ZIP-Integrität werden vor der Ausgabe geprüft. Ein Live-Test gegen dein Supabase-Projekt ist aus dieser Umgebung nicht möglich; bitte prüfe nach Migration einen Spin, mehrere aufeinanderfolgende Gewinne und einen Verlust. Die mitgelieferte APK wird nicht neu gebaut, nur die Website-/Datenbankdateien werden aktualisiert.
