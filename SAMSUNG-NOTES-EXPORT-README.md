# Schreibbot – native Exporte für Samsung Notes und Goodnotes

## Samsung Notes

Der Export erzeugt eine `.sdocx`-Datei mit einzelnen nativen S-Pen-Stiftobjekten. Schriftzüge sowie Linien-, Raster- und Punkthilfen werden nicht zu einem einzigen Seitenbild zusammengefügt. Die Schriftpfade behalten ihre Koordinaten auf dem gewählten Papierformat.

## Goodnotes

Der native Export erzeugt eine `.goodnotes`-Datei mit einzelnen Vektor-Stiftstrichen. Für einen optisch genauen Import gibt es zusätzlich einen PDF-Fallback. Der PDF-Fallback ist eine flache Seite und nicht buchstabenweise radierbar.

## Papierformate und Regler

Bei jedem nativen Goodnotes- oder Samsung-Notes-Export erscheint eine Auswahl für DIN A3, DIN A4, DIN A5, DIN B5, DIN A6 oder US Letter sowie Hoch- oder Querformat. Die Seite wird für das ausgewählte Format neu aufgebaut. Übernommen werden unter anderem Schriftgröße, Stiftdicke, Zeilenabstand, Buchstaben- und Wortabstand, Seitenränder, Einzug, Natürlichkeit, Höhenvariation, Papierstil und Papierfarbe. Die nativen Strichbreiten werden zusammen mit der Schriftgröße und der gewählten Stiftdicke skaliert.

## PNG und PDF

Der PNG-Export lädt alle Seiten in **einer ZIP-Datei** herunter; jede Seite liegt darin als eigene PNG-Datei. Der PDF-Export erstellt eine mehrseitige PDF-Datei. PNG und PDF sind flache Bild-/Dokumentexporte und enthalten keine einzeln radierbaren Stiftobjekte.

## Import und Geräteprüfung

Die ZIP-/Seitenstruktur und die nativen Strichdatensätze werden im Exportcode validiert. Ein endgültiger Import- und Radier-Test in Goodnotes und Samsung Notes konnte in dieser Entwicklungsumgebung nicht auf einem echten Tablet durchgeführt werden. Bitte importiere die erzeugte native Datei einmal in deiner jeweiligen App und prüfe dort das Radieren.
