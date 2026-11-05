# Schreibbot – Export-Update v71

## Geänderte Dateien

- `index.html` – gemeinsamer Exportdialog, Papierformate A3/A4/A5/B5/A6/US Letter, Hoch-/Querformat, PNG-Sammel-ZIP, direkter mehrseitiger PDF-Export und formatabhängige native Goodnotes-/Samsung-Notes-Exporte. Die Exportwerte werden während des Vorgangs eingefroren, sodass alle Regler konsistent angewendet werden.
- `service-worker.js` – Cache-Version auf `schreibbot-app-v71` erhöht, damit installierte PWA-Versionen die aktualisierte `index.html` neu laden.
- `SAMSUNG-NOTES-EXPORT-README.md` – Dokumentation der Formate, Editierbarkeit und Geräteprüfung aktualisiert.

## Einbau

Die drei Dateien in deinem GitHub-Repository im Ordner `Schreibbot-main` durch die gleichnamigen Dateien ersetzen. `goodnotes-template.js` bleibt unverändert und muss weiterhin im selben Ordner wie `index.html` liegen. Danach committen/pushen und die Website mit HTTPS neu laden. Bei einer installierten PWA kann ein vollständiges Schließen und erneutes Öffnen nötig sein, damit der neue Service Worker aktiv ist.

## Editierbarkeit

Die nativen Dateien `.goodnotes` und `.sdocx` bestehen aus einzelnen Strichobjekten und sind für das Bearbeiten/Radieren in der Ziel-App vorgesehen. PDF und PNG sind flache Exporte und nicht buchstabenweise radierbar. Der endgültige Import- und Radier-Test muss auf dem jeweiligen Gerät in Goodnotes bzw. Samsung Notes erfolgen.
