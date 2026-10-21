# Schreibbot Arcade v48

## Einmal kaufbarer 4×-Coin-Multiplikator

Im Upgrade-Bereich des Arcade-Shops kann einmal pro Spielerprofil ein permanenter 4×-Coin-Multiplikator für **10.000 virtuelle Coins** gekauft werden. Der Server speichert den Besitz als `multiplier_x4` im Profil-Inventar. Der Kauf wird durch eine Zeilensperre atomar ausgeführt und kann deshalb auch bei schnellen Doppelklicks nicht doppelt abgerechnet werden.

Der 4×-Bonus gilt für alle Grundgewinne und wird mit der bestehenden Gewinnserie kombiniert. Der Serienfaktor bleibt 1× beim ersten Gewinn, 2× beim zweiten, 4× beim dritten, 8× beim vierten usw. Beispiel: Grundgewinn 25 beim zweiten Treffer × Serienfaktor 2 × gekaufter 4×-Bonus = 200 Coins. Nach einer Niete wird nur die Gewinnserie zurückgesetzt; der gekaufte 4×-Bonus bleibt permanent aktiv. Das Coin-Konto ist weiterhin auf 1.000.000.000 begrenzt.

## Dateien

- `index.html`: Shop-Karte, Kaufstatus und Beschriftungen für den 4×-Bonus.
- `service-worker.js`: Cache auf v48 angehoben, damit die installierte PWA die aktualisierte Seite lädt.
- `supabase_slot_machine_update_v48.sql`: aktualisiert `buy_slot_shop_item` (10.000 Coins, einmaliger Kauf) und `spin_slot_machine` (serverseitige 4×-Berechnung).
- Frühere SQL-Migrationen bleiben im ZIP erhalten.

## Installation

1. Lade die Dateien des ZIP in dein bestehendes GitHub-Repository hoch und überschreibe die alten Website-Dateien.
2. Voraussetzung: Das vollständige v47-Supabase-Setup ist bereits aktiv. Öffne dasselbe Supabase-Projekt → SQL Editor und führe `supabase_slot_machine_update_v48.sql` aus.
3. Warte auf das GitHub-Pages-Deployment. Schließe die installierte PWA vollständig und öffne sie erneut.
4. Teste den Kauf mit mindestens 10.000 Coins. Der Button muss danach `✓ Bereits gekauft` anzeigen. Teste einen Gewinn und kontrolliere, dass die serverseitige Auszahlung sowohl den Streakfaktor als auch ×4 berücksichtigt.

## Regeln und Grenzen

- Der Kauf kostet 10.000 Coins und kann pro Profil nur einmal erfolgen.
- Der Bonus ist permanent, gilt auch nach Nieten weiter und stackt mit der Gewinnserie.
- Der bisherige alte `multiplier_steps`-Upgradepfad bleibt deaktiviert; `multiplier_x4` ist eine separate Inventarmarkierung.
- Keine Echtgeldkäufe oder Auszahlungen.
- SQL-/JavaScript-Syntax und ZIP-Integrität wurden lokal geprüft. Ein Live-Test gegen das Supabase-Projekt ist aus dieser Umgebung nicht möglich.
