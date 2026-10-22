# Schreibbot Arcade v50

## Was in v50 geändert wurde

- Die Gewinnserie nutzt **×1 → ×2 → maximal ×3** statt des alten exponentiellen ×4ⁿ-Faktors.
- Der optionale, permanente **Serienbonus kostet 2.500 Coins**. Er startet eine Stufe höher, bleibt aber immer bei maximal ×3.
- Freispiele regenerieren sich langsamer: ein Nachladen pro 45 Sekunden, mit maximal zwei gespeicherten Freispielen.
- Im Coin-Shop gibt es jetzt 13 Sammlerstücke. Neu: **Galaxie-Kern (500.000 Coins)** und **Milchstraße (1.000.000 Coins)**.
- Wenn die komplette Sammlung vorhanden ist, wird der animierte **Platin-Endlevel-Look** mit Profilabzeichen freigeschaltet.
- In der Rangliste steht direkt beim Namen das teuerste gekaufte Sammlerstück mit Preis.
- Der frühere geheime 5×-Logo-Bonus wird auf den begrenzten Serienbonus migriert; bestehende Freischaltungen bleiben erhalten.
- Alle Shoppreise und Auszahlungen werden serverseitig über Supabase geprüft. Coins bleiben virtuell und haben keinen Geldwert.

## Dateien und Installation

1. Lade die Dateien im ZIP in dein bestehendes GitHub-Repository und überschreibe die alten Dateien.
2. Öffne das bisher verwendete Supabase-Projekt → **SQL Editor** und führe **`supabase_slot_machine_update_v50.sql`** aus. Voraussetzung ist, dass das bisherige Slot-Setup bis einschließlich v49 bereits ausgeführt wurde.
3. Die Datei `service-worker.js` ist enthalten, damit installierte PWAs die neue Version übernehmen. Warte auf das GitHub-Pages-Deployment und schließe die installierte PWA vollständig, bevor du sie neu startest.
4. Teste danach den Kauf des Serienbonus, einen normalen Spin und die Rangliste. Für das Platin-Abzeichen müssen alle 13 Sammlerstücke gekauft sein.

## Hinweis

Die Migration wurde lokal auf SQL-/JavaScript-Struktur und ZIP-Integrität geprüft. Ein Live-Test gegen dein Supabase-Projekt ist aus dieser Umgebung nicht möglich.
