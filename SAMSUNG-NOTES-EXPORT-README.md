# Handschrift – Samsung Notes Native Export (Beta)

This release adds a **Samsung Notes `.sdocx` export** button to the page. It writes separate Samsung S-Pen stroke objects instead of flattening the output into a PNG or PDF.

## How to test
1. Deploy the website version to GitHub Pages (HTTPS), or open the installed web app where file download support is available.
2. Enter a short text (for example `Hallo`).
3. Select the regular system font or your saved-handwriting option and click **Samsung Notes – radierbare Stiftstriche (.sdocx)**.
4. Import `Handschrift-Samsung-Notes-radierbar.sdocx` into Samsung Notes.
5. Try the normal eraser on one of the generated letters.

## Important limitations
- The source code and generated package structure were checked, including ZIP integrity and native stroke-object records. The final app import/eraser test has **not** been run in this environment; it must be confirmed on your Samsung device.
- Common system fonts are converted to approximate centerline strokes to make them erasable. These paths can look slightly different from the rendered font. Saved vector handwriting uses its saved paths directly.
- The selected paper background color is carried over. Printed rules/grid lines are not currently embedded as a page bitmap, because that would be separate from the native stroke layer.
- PNG and PDF exports remain available as before; those are flattened exports and their generated text is not individually erasable as handwriting.
- Goodnotes export is not included in this change.
