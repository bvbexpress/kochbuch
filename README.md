# Kochbuch

Eine kleine Koch- und Back-App fürs Handy – als Web-App (PWA), die man zum
Homescreen hinzufügen kann und die auch offline funktioniert.

**App öffnen:** https://bvbexpress.github.io/kochbuch/

## Etappen

1. **Teigrechner** – Bäckerprozente, Mehlmischungen, Starter, Quellstück, Vorlagen *(in Arbeit)*
2. **Rezeptsammlung** *(später)*
3. **Vorratsverwaltung** mit Sync zwischen zwei Handys *(später)*

## Technik

- Reines HTML, CSS und JavaScript – keine Frameworks, keine Build-Tools.
- JavaScript als Module (`import`/`export`), die der Browser direkt versteht.
- Alle Pfade sind relativ (`./…`), damit die App unter GitHub Pages
  (`https://<name>.github.io/kochbuch/`) funktioniert.

## Ordner

| Pfad | Inhalt |
|---|---|
| `index.html` | Die einzige HTML-Seite |
| `css/basis.css` | Farben (hell/dunkel), Schrift, Knöpfe, Felder |
| `css/<bereich>.css` | Design eines einzelnen Bereichs |
| `js/app.js` | Start und Navigation |
| `js/kern/` | Gemeinsames: Speicher, Bildschirm-an |
| `js/teig/` | Teigrechner (Rechenlogik, Vorlagen, Mehle & Saaten, Oberfläche) |
| `tests/` | Tests der Rechenlogik |

Ordner für spätere Etappen (`js/rezepte/`, `js/vorrat/`) werden angelegt,
sobald dort Code entsteht.

## Tests

Die Rechenlogik wird mit dem eingebauten Testwerkzeug von Node.js geprüft
(keine zusätzlichen Pakete): `npm test`

## Datenschutz

Eigene Vorlagen, Rezepte und Vorräte werden **nur im Browser auf dem Handy**
gespeichert – niemals in diesem Repository. Das Repository enthält nur den
Programmcode und die fest eingebauten Beispiel-Vorlagen.
