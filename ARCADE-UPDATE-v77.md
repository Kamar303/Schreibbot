# Schreibbot Arcade v77 – Spin- und Speicherreparatur

## Behoben
- Ein Spin benötigt nur noch einen Supabase-Aufruf. Der vorherige separate Aufruf zum Ablehnen/Behalten eines offenen Doppelt-oder-Nichts-Gewinns entfällt.
- Beim nächsten normalen Spin löscht die Datenbank den alten `pending_double_amount`-Marker innerhalb derselben Transaktion. Die Gewinn-Coins wurden bereits beim vorherigen Gewinn zu `total_points` addiert; sie werden daher nicht erneut gutgeschrieben.
- Wenn der Spin wegen fehlender Drehungen oder eines Datenbankfehlers abbricht, rollt die Datenbanktransaktion zurück; der vorherige offene Gewinn bleibt erhalten.
- Die SQL-Migration entfernt den zusätzlichen Ein-Parameter-Overload. Es bleibt eine eindeutige RPC-Signatur mit optionalem `p_test_result`, damit PostgREST die Funktion sicher auflösen kann.
- Ein Fehler beim Aktualisieren der Rangliste zeigt den Spin nicht länger fälschlich als fehlgeschlagen an.
- Bei einem RPC-/Netzwerkfehler wird das Spielerprofil erneut geladen, um einen eventuell bereits gespeicherten Dreh mit dem tatsächlichen Kontostand abzugleichen.
- Cache-Version auf v77 erhöht.

## Installation
1. In GitHub `index.html` und `service-worker.js` aus dem v77-Projekt ersetzen.
2. In Supabase SQL Editor `supabase_slot_machine_update_v64.sql` vollständig ausführen. Die Migration kann nach v63 ausgeführt werden; sie ersetzt nur die Spin-RPC-Signatur und deren Ablauf.
3. Supabase muss die anonyme Anmeldung erlauben (Authentication → Providers / Anonymous Sign-Ins).
4. Website neu laden. Die installierte PWA vollständig schließen und erneut öffnen, damit Cache v77 geladen wird.

## Speicherung
Jeder normale Spin wird in einer einzelnen PostgreSQL-Transaktion ausgeführt. Walzenergebnis, Kontostand, Spin-Zähler, Freispiele, Serienstand und neuer Doppelt-oder-Nichts-Marker werden gemeinsam gespeichert. Schlägt die Transaktion fehl, werden diese Änderungen gemeinsam zurückgerollt.

## Einschränkung
Ein Live-Zugriff auf das private Supabase-Projekt ist in dieser Umgebung nicht vorhanden. Die Migration muss deshalb im Supabase-Projekt des Betreibers ausgeführt werden; danach ist ein echter Gerätetest sinnvoll.
