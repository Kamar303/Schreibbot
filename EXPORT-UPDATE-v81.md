# Schreibbot v81 – GoodNotes- und Samsung-Notes-Export

## Änderungen

### GoodNotes
- Im Formatfenster des nativen GoodNotes-Exports ist **GoodNotes Standard** auswählbar.
- Die Standardgröße stammt aus der eingebetteten GoodNotes-Musterseite: PDF-MediaBox **455,04 × 588,45 pt**, entsprechend **160,528 × 207,592 mm**.
- Hoch- und Querformat werden jeweils als echte Seitengröße im eingebetteten Papierhintergrund angelegt.
- Der Download ist eine native **`.goodnotes`-Notizbuchdatei**. Die Handschrift liegt in separaten nativen Stiftgeometrien; die interne PDF-Seite ist nur der Papier-/Linienhintergrund. Es wird keine eigenständige PDF-Datei als GoodNotes-Export heruntergeladen.
- Die Schriftkoordinaten werden einmal von der Website-Canvasgröße in die tatsächlichen GoodNotes-Punkte umgerechnet. Es gibt keine zweite Skalierung oder zusätzlichen Eck-Offset.
- Der Export prüft vor dem Download, ob die Stiftpunkte innerhalb der gewählten Seite liegen und ob ihre Begrenzung mit der transparenten Website-Vorschau übereinstimmt.
- Die Stiftdicke berücksichtigt Schriftgrößen- und Stiftdickenregler sowie die ausgewählte Papiergröße.

### Samsung Notes
- Der native `.sdocx`-Export übernimmt den Stiftdickenregler und skaliert die gespeicherte native Pen-Size passend auf die gewählte Seitengröße.
- Der Export liest die gespeicherte Stiftbreite direkt nach dem Schreiben aus dem nativen Strichobjekt zurück und bricht bei ungültigen Werten ab.
- Schriftzüge bleiben einzelne native Strichobjekte statt eines flachen Bildes.
- GoodNotes Standard wird im Samsung-Formatdialog nicht angeboten, weil es eine GoodNotes-Vorlagengröße ist. Samsung Notes bietet weiterhin A3, A4, A5, B5, A6 und US Letter.

### Gemeinsame Vorschau
- Die Exportvorschau verwendet weiterhin denselben `renderPaperNow()`-Renderer wie der Schreibbot-Editor. Damit werden Umbrüche, Zeilenabstände, Ränder, Einzug, Wortabstände, Schriftgröße und Höhe nicht separat nachgebildet.
- Die Formatwahl bleibt im Editor aktiv, damit Vorschau und anschließender Export dasselbe Blatt verwenden.
- Die Service-Worker-Version wurde auf v81 angehoben, damit ältere PWA-Dateien nicht weiterverwendet werden.

## Geänderte Dateien
- `index.html`
- `service-worker.js`

`goodnotes-template.js` bleibt unverändert und muss weiterhin im selben Ordner wie `index.html` liegen.

## Durchgeführte technische Prüfungen
- JavaScript-Syntax der Inline-Skripte, des Service Workers und der GoodNotes-Vorlage: erfolgreich.
- HTML-ID-Prüfung: keine doppelten IDs.
- GoodNotes: 7 Papierformate (GoodNotes Standard, A3, A4, A5, B5, A6, Letter) × Hoch-/Querformat = 14 Kombinationen geprüft.
- GoodNotes: native Strichgeometrie erzeugt und aus der nativen Seitenstruktur zurückgelesen; Punktkoordinaten bleiben innerhalb der Seite.
- GoodNotes: Abgleich zur Vorschau im Test mit 0,00 pt Abweichung; eingebetteter Hintergrund-PDF-Test hat 2 Seiten mit exakt 455,04 × 588,45 pt für GoodNotes Standard.
- Samsung Notes: native Strichbreite aus den erzeugten `.page`-Objekten zurückgelesen; drei Stiftdickenstufen wurden für A3, A4, A5, B5, A6 und Letter geprüft und stiegen jeweils monoton an.

## Grenzen der Prüfung
Die Tests prüfen Quellcode, native Datenstrukturen und Größen/Koordinaten. Ein tatsächlicher Import und anschließender Radier-Test in den GoodNotes- und Samsung-Notes-Apps auf einem Tablet konnte nicht ausgeführt werden. Bitte die erste exportierte Datei in der jeweiligen App öffnen und einen einzelnen Strich testweise radieren.
