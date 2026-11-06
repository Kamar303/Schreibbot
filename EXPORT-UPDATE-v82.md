# Schreibbot – Export-Update v82

## GoodNotes: native, formatbezogene Seitenanpassung

- Der GoodNotes-Export verwendet weiter `renderPaperNow()` als Layout-Quelle. Der Text wird zuerst **im ausgewählten Papierformat** neu umbrochen; Schriftgröße, Zeilenabstand, Buchstaben-/Wortabstand, Zeileneinzug, Ränder, natürliche Variation und Höhenvariation werden berücksichtigt.
- Danach wird jede Seite separat proportional in den vom Randregler freigegebenen Schreibbereich eingepasst und dort zentriert. Die Stiftbreite wird mit demselben Fit-Faktor skaliert. Sehr kurze Seiten werden bis maximal 10× vergrößert, lange Seiten bei Bedarf verkleinert.
- Der nutzbare Bereich nutzt exakt dieselben Millimeter-Ränder wie `renderPaperNow()` und `exportClipRect()`. Auch bei A6 und maximalem Randregler wird kein Randwert mehr durch eine Prozentbegrenzung heimlich verändert.
- Neue kanonische Exportdatenstruktur (`schemaVersion: 2`): Jede Seite speichert Canvas-Größe, native Seitengröße, Fit-Transformation, druckbaren Bereich, Abdeckungswerte, Vorschau-Striche und native GoodNotes-Striche.
- Die Formatfenster-Vorschau und der `.goodnotes`-Ersteller verwenden dieselben vorbereiteten Seitendaten. Es gibt keine unabhängige zweite Skalierung für die Vorschau.
- Die Striche werden genau einmal von Canvas-Koordinaten in PDF-Punkte umgerechnet. Die eingebettete PDF-Ressource dient nur als Papier-/Linienhintergrund; die Handschrift wird separat als native Stiftobjekte geschrieben.
- Formate: GoodNotes Standard, A3, A4, A5, B5, A6 und US Letter, jeweils Hoch- und Querformat. Mehrseitige Vorschau mit Pfeilnavigation und Wischen bleibt erhalten.

## Samsung Notes

- Der native `.sdocx`-Export bleibt erhalten. Die bereits vorhandene Stiftbreiten-Übernahme und Rückleseprüfung aus v81 bleibt aktiv.
- Die im Exportfenster gewählte Papiergröße und Ausrichtung werden vor dem Samsung-Export in den Editor übernommen; die nativen Samsung-Seiten- und Stiftmaße werden daraus erstellt.

## Dateien zum Ersetzen

- `index.html`
- `service-worker.js`
- `goodnotes-template.js` bleibt unverändert und muss im selben Ordner wie `index.html` liegen.

Keine Supabase-Migration und kein Datenbankumbau erforderlich.

## Technische Prüfungen

- JavaScript-Syntax: beide Inline-JavaScript-Blöcke geprüft.
- HTML-IDs: 309 IDs, keine Duplikate.
- Seiten-Fit: 42 Kombinationen aus sieben Formaten, zwei Ausrichtungen und drei Rand-Einstellungen; je zwei Seiten simuliert (84 Seiten-Fits). Die Striche blieben in jedem Fall innerhalb des freigegebenen Schreibbereichs; Vorschau/native Koordinaten wichen höchstens 0,35 pt ab.
- Eingebetteter GoodNotes-Papierhintergrund: 14 MediaBox-Tests (sieben Formate × zwei Ausrichtungen) mit korrekten Seitenmaßen.
- Native Stiftgeometrie: Erzeugung und Prüfung von zwei getrennten Strichobjekten auf einer A3-Seite erfolgreich.
- `goodnotes-template.js` wurde gegenüber v81 nicht verändert.

## Einschränkung

Der `.goodnotes`-Container wird aus der mitgelieferten GoodNotes-Vorlage aufgebaut; die Seiten enthalten separate native Stiftstrichobjekte. Das beweist die technische Trennung der Striche und ihre Koordinaten, ersetzt aber keinen Import- und Radier-Test in der GoodNotes-App auf einem iPad/Android-Gerät. Diesen letzten App-Test konnte ich hier nicht ausführen.
