# Schreibbot Arcade v76 – Spin-Fix

## Behoben
- Ein offener Gewinn aus „Doppelt oder Nichts“ sperrt die Slotmaschine nicht mehr dauerhaft.
- Wenn bei einem offenen Gewinn erneut „Drehen“ gedrückt wird, wird der alte Gewinn zuerst sicher behalten und danach der neue Spin gestartet.
- Die Buttons zeigen bei offenem Gewinn „Gewinn behalten & weiterdrehen“.
- Die bestehende Kopf/Zahl- und Ablehnen-Funktion bleibt verfügbar.
- Normale Spins übergeben `p_test_result: null` explizit an Supabase.
- Die Fehlermeldung zeigt jetzt den tatsächlichen RPC-Fehler, anstatt pauschal nur auf das Setup zu verweisen.
- Supabase-Migration v63 stellt eine eindeutige Zwei-Parameter-RPC plus Ein-Parameter-Kompatibilitätsfunktion bereit. Das vermeidet Probleme bei der Auflösung optionaler PostgREST-Argumente und unterstützt ältere gecachte Clients.
- Service-Worker-Cache auf v76 erhöht.

## Installation
1. `index.html` und `service-worker.js` in GitHub ersetzen.
2. In Supabase SQL Editor `supabase_slot_machine_update_v63.sql` vollständig ausführen (nach v62).
3. Website neu laden; installierte PWA ganz schließen und erneut öffnen.

## Hinweise
- v63 ersetzt nur die RPC-Signatur der Slot-Drehfunktion; Gewinn-, Verlust-, Admin- und Serienregeln aus v62 bleiben unverändert.
- Der Spin-Endpunkt bleibt serverseitig geschützt. Die Kompatibilitätsfunktion delegiert an dieselbe serverseitige Logik.
