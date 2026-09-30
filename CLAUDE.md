# CLAUDE.md – Leitfaden für dieses Repo

Koch- und Back-App als PWA, **deutsch**, **mobile first**, für zwei iPhones (iOS 26).
Live unter https://bvbexpress.github.io/kochbuch/ (GitHub Pages aus `main`).
Der Nutzer ist Anfänger und arbeitet nur in der Cloud: Erklärungen knapp halten.

## Etappen

1. **Teigrechner** – Bäckerprozente, Mehlmischungen, Starter, Quellstück, Vorlagen *(in Arbeit, Schritte 1–5 fertig, Schritt 6: Mehlauswahl + Quellstück)*
2. **Rezeptsammlung** *(später)*
3. **Vorratsverwaltung** mit Sync zwischen zwei Handys *(später)*

## Technik-Vorgaben

- Reines HTML, CSS, JavaScript. **Keine Frameworks, keine Build-Tools, keine npm-Pakete.**
- JS als ES-Module (`import`/`export`), direkt vom Browser geladen.
- Alle Pfade relativ (`./…`) wegen GitHub Pages unter `/kochbuch/`.
- Tests: `npm test` (eingebautes `node --test`, keine Abhängigkeiten). Rechenlogik immer mit Tests.
- Rechnen nur in `rechner.js`, Speichern nur über `kern/speicher.js`, Oberfläche rechnet nicht.
- Namen und Kommentare auf Deutsch, Code-Stil wie im Bestand.

## Ordner

| Pfad | Inhalt |
|---|---|
| `index.html` | einzige HTML-Seite |
| `css/basis.css` | Farben (hell/dunkel), Schrift, Knöpfe, Felder |
| `css/<bereich>.css` | Design eines Bereichs (z. B. `teig.css`) |
| `js/app.js` | Start und (später) Navigation |
| `js/kern/` | Gemeinsames: `speicher.js`, `zahlen.js` |
| `js/teig/` | Teigrechner: `rechner.js` (Logik), `vorlagen.js`, `ansicht.js` (Oberfläche) |
| `tests/` | Tests (`*.test.js`) |

`js/rezepte/`, `js/vorrat/` erst anlegen, wenn dort Code entsteht.

## Rechenregeln

- Alle Prozente beziehen sich auf das **Gesamtmehl inkl. Mehl im Starter**.
- Starter hat **100 % Hydration** (halb Mehl, halb Wasser); sein Wasser zählt zur Hydration.
- Das **Eingabefeld „Mehl“ zeigt das zugegebene Mehl** (was man abwiegt), nicht das Gesamtmehl.
  Gesamtmehl = zugegebenes Mehl / (1 − Starter% / 200).
- Mehlsorten-Anteile beziehen sich auf das zugegebene Mehl (Summe 100 %).
- Quellstück: Saaten in % vom Gesamtmehl, Quellwasser zusätzlich (nicht in der Hydration).
- Hefe: 3 g Frischhefe ≈ 1 g Trockenhefe.

## Datenmodell (für späteren Sync)

Jeder Datensatz (Vorlagen, eigene Mehle/Saaten, später Rezepte, Vorräte) hat:
- `id` – UUID, auf beiden Handys gleich
- `geaendert` – Zeitstempel (ms) der letzten Änderung, neuere Version gewinnt
- `geloescht` – `true` statt echtem Löschen („Grabstein“)

Geräte-Einstellungen (`speicher.einstellung`) gehören nur zu einem Handy und werden nicht synchronisiert.
Gespeicherte Daten beim Laden immer auf Gültigkeit prüfen.

## Bedien-Anforderungen

- Einhändig am iPhone bedienbar; alles Antippbare mind. **56 px** hoch (`--tipp-hoehe`).
- Zahlenfelder mit `inputmode="decimal"`, Komma und Punkt erlaubt; beim Antippen wird der Inhalt markiert.
- **Live-Rechnung** bei jeder Eingabe, kein „Berechnen“-Knopf.
- Heller und dunkler Modus nach Systemeinstellung, Safe-Area (Notch) beachten.
- Letzter Stand wird gemerkt; eingebaute Vorlagen bleiben unverändert.
- Verständliche deutsche Hinweise statt Fehlermeldungen; App darf nie an kaputten Daten hängen.

## Datenschutz – wichtig

**Niemals persönliche Daten ins Repo** (eigene Vorlagen, Rezepte, Vorräte, Exporte, Backups,
Namen, E-Mail-Adressen, Zugangsdaten). Diese liegen nur im Browser auf dem Handy.
Im Repo stehen nur Code und die fest eingebauten Beispiel-Vorlagen und Standardwerte.
