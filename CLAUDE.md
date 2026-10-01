# CLAUDE.md – Leitfaden für dieses Repo

Koch- und Back-App als PWA, **deutsch**, **mobile first**.
Nutzer: zwei iPhones mit iOS 26, Nutzung **nur als Homescreen-Web-App**.
Veröffentlichung über GitHub Pages aus `main`: https://bvbexpress.github.io/kochbuch/ – **das Repo ist öffentlich**.
Der Nutzer ist Anfänger und arbeitet nur in der Cloud: Erklärungen knapp halten.

## Fahrplan

Reihenfolge der Etappen ist fest. **Nichts aus einer späteren Etappe vorab bauen**, nur die Datenmodelle so wählen, dass sie passen.

### Etappe 1 – Teigrechner abschließen *(Schritte 1–6 und 11 fertig; offen: 7 → 8 → 9 → 10)*
Bäckerprozente, Mehlmischungen, Starter, Quellstück, Vorlagen, Teilen per Link. Die Schritte 7–10 werden vor Etappe 2 abgeschlossen.
Hinweis: Installierbarkeit (Manifest) und Offline-Betrieb (Service Worker) fehlen im Repo noch – spätestens hier einplanen.

### Etappe 2 – Gemeinsame Daten
- Anmeldung und Sync zwischen zwei iPhones über eine Datenbank (Cloud, von GitHub Pages aus per `fetch` erreichbar).
- Persönliche Daten liegen **nur dort**, nie im Repo. Im Code stehen höchstens öffentliche Projekt-Schlüssel, der Schutz
  läuft über Anmeldung und Zugriffsregeln der Datenbank (nur die zwei Konten sehen die Daten).
- Die eigenen Vorlagen ziehen mit um (Datenmodell mit `id`/`geaendert`/`geloescht` ist dafür schon da).
  Eigene Mehle/Saaten samt Wasserwerten werden hier mit synchronisiert.
- App bleibt **offline nutzbar** (lokal speichern, später abgleichen). Teilen per Link bleibt als Sicherung.
- Vor dem Bauen klären: Anbieter der Datenbank, Anmeldeweg, und wie das zu „keine Frameworks/Pakete“ passt (nur `fetch`, kein SDK).

### Etappe 3 – Rezepte
- Rezepte mit **Personenanzahl** und automatischer Mengenanpassung.
- Zutaten strukturiert: **Menge, Einheit, Zutat**, mit **Skalierungsregel je Zutat**: linear, auf ganze Stück runden, nicht skalieren.
- Anleitung **Schritt für Schritt, kurz und kleinteilig**.
- Teigrechner-Vorlagen und Rezepte nutzen dieselben Zutaten (siehe Zutatennamen).

### Etappe 4 – Gemeinsamer Vorrat
- Manuelle Pflege, auch **grobe Zustände** (voll / halb / fast leer) statt nur Mengen.
- Abzug beim Kochen eines Rezepts.
- Funktion **„Was kann ich kochen?“** aus den eigenen Rezepten.
- Knopf **„Vorrat kopieren“** (Text zum Einfügen in Claude).

### Etappe 5 – Foto- und Kassenbon-Erkennung *(optional)*
Über die Claude-API mit einem **eigenen kleinen Server** (der API-Schlüssel darf nie in die App oder ins Repo).
Läuft nur bei Bedarf, die App funktioniert auch ohne.

### Zutatennamen einheitlich
Teigrechner, Rezepte und Vorrat müssen später zusammenpassen. Darum gibt es **einen gemeinsamen Zutatenkatalog**
(Datensatz mit `id`, Name, Art, ggf. Einheit/Umrechnung), auf den alle Bereiche per `id` verweisen – nicht per Freitext.
Der Katalog entsteht **in Etappe 2/3**, die Mehle und Saaten in `zutaten.js` (haben schon `id`s) sind der Anfang.
Bis dahin: neue Zutaten immer mit stabiler `id` und einheitlichem deutschen Namen anlegen, Namen nicht doppeln.

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
| `js/teig/` | Teigrechner: `rechner.js` (Logik), `vorlagen.js`, `zutaten.js` (Mehle/Saaten), `teilen.js` (Teilen-Link), `ansicht.js` (Oberfläche) |
| `tests/` | Tests (`*.test.js`) |

`js/rezepte/`, `js/vorrat/` erst anlegen, wenn dort Code entsteht.

## Rechenregeln

- Alle Prozente beziehen sich auf das **Gesamtmehl inkl. Mehl im Starter**.
- Starter hat **100 % Hydration** (halb Mehl, halb Wasser); sein Wasser zählt zur Hydration.
- Das **Eingabefeld „Mehl“ zeigt das zugegebene Mehl** (was man abwiegt), nicht das Gesamtmehl.
  Gesamtmehl = zugegebenes Mehl / (1 − Starter% / 200).
- Mehlsorten-Anteile beziehen sich auf das zugegebene Mehl (Summe 100 %).
- Quellstück: Saaten und Quellwasser in % vom Gesamtmehl; Quellwasser zählt nicht zur Hydration.
- Hefe mit Umschalter Frisch/Trocken: Trocken = Frisch ÷ 3.
- Starter-Auffrischung mit frei einstellbarem Verhältnis Anstellgut:Mehl:Wasser (z. B. 1:1,5:1,5 oder 1:2,5:2,5).
- Anzeige: Gramm auf ganze Gramm gerundet, Prozente mit einer Nachkommastelle.
- Mehlwasser: Jedes Mehl hat eine Wasseraufnahme (%). Beim Tauschen/Mischen wird die Hydration um den
  Unterschied der Mischwerte angepasst (× Anteil zugegebenes Mehl am Gesamtmehl) – ein Vorschlag, überschreibbar.
- Quellstück: Jede Saat hat ein Wasserverhältnis (g Wasser je g Saat). Vorlagen speichern ihr eigenes
  Quellwasser; die Verhältnisse wirken nur als Zu-/Abschlag, wenn Saaten gewählt oder geändert werden. Überschreibbar.
  Beim Entfernen einer Saat: Ist der Rest knapper als laut Verhältnis, gilt das Verhältnis (nie mehr als vorher).
- Hinweise: Hafer nur als Beimischung (kein Klebereiweiß, ab 20 % deutlicher);
  Roggen ab 50 % ohne Sauerteig-Starter → Hinweis auf Säuerung.

## Datenmodell (für späteren Sync)

Jeder Datensatz (Vorlagen, Mehle/Saaten – eigene und geänderte Standardwerte –, später Rezepte, Vorräte) hat:
- `id` – UUID, auf beiden Handys gleich
- `geaendert` – Zeitstempel (ms) der letzten Änderung, neuere Version gewinnt
- `geloescht` – `true` statt echtem Löschen („Grabstein“)

Geräte-Einstellungen (`speicher.einstellung`) gehören nur zu einem Handy und werden nicht synchronisiert.
Gespeicherte Daten beim Laden immer auf Gültigkeit prüfen.

## Teilen per Link (Schritt 11)

- Link: `<App-Adresse>#teilen=<Code>`; Code = JSON, `deflate-raw`-gepackt, Base64url (`z.`), sonst ungepackt (`r.`).
  Alles nach dem `#` geht nie an einen Server. Ein Link enthält eine Vorlage (Teilen) oder alle eigenen (Sichern).
- Links sind **nicht vertrauenswürdig**: `teilen.js` prüft und bereinigt alles (UUID-id, Zahlenbereiche, Namenslänge,
  Größenlimit gegen Zip-Bomben, nur bekannte Felder). Namen immer mit `text()` maskieren.
- Übernahme mit id und `geaendert` des Absenders, **neuere Version gewinnt** (`speicher.uebernimm`); sonst Angebot „als Kopie“.
- **iOS:** Ein Link öffnet in Safari, nie in der Homescreen-App, und Safari/Homescreen-App haben getrennte Speicher.
  Darum im Browser nur Vorschau + „Link kopieren“; übernommen wird in der App über „Teilen und Sichern → Link einfügen“.
- Nicht enthalten: eigene Mehl-/Saatensorten und Wasserwerte (Einstellungen).

## Bedien-Anforderungen

- **Sehr schnell:** sofortiger Start, offline nutzbar, keine unnötigen Bibliotheken.
- **Küchentauglich:** große Schaltflächen (mind. **56 px**, `--tipp-hoehe`), mit einer Hand und Teig an den Fingern bedienbar.
- **Live-Ergebnisse** beim Tippen, kein „Berechnen“-Knopf.
- Häufigster Weg (Vorlage laden → Mehlmenge ändern → ablesen) in **höchstens zwei Tippern**.
- **Bildschirm bleibt an**, solange die App offen ist.
- **Nur das Nötige sichtbar**, Zusatzoptionen einklappbar (`details.klappe`).
- Zahlenfelder mit `inputmode="decimal"`, Komma und Punkt erlaubt; beim Antippen wird der Inhalt markiert.
- Heller und dunkler Modus nach Systemeinstellung, Safe-Area (Notch) beachten.
- Letzter Stand wird gemerkt; eingebaute Vorlagen bleiben unverändert.
- Verständliche deutsche Hinweise statt Fehlermeldungen; App darf nie an kaputten Daten hängen.

## Datenschutz – wichtig

**Niemals persönliche Daten ins Repo** (eigene Vorlagen, Rezepte, Vorräte, Exporte, Backups,
Namen, E-Mail-Adressen, Zugangsdaten). Diese liegen nur im Browser auf dem Handy.
Im Repo stehen nur Code und die fest eingebauten Beispiel-Vorlagen und Standardwerte.
