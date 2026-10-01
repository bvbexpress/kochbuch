# CLAUDE.md – Leitfaden für dieses Repo

Koch- und Back-App als PWA, **deutsch**, **mobile first**.
Nutzer: zwei iPhones mit iOS 26, Nutzung **nur als Homescreen-Web-App**.
Veröffentlichung über GitHub Pages aus `main`: https://bvbexpress.github.io/kochbuch/ – **das Repo ist öffentlich**.
Der Nutzer ist Anfänger und arbeitet nur in der Cloud: Erklärungen knapp halten.

## Fahrplan

Reihenfolge der Etappen ist fest. **Nichts aus einer späteren Etappe vorab bauen**, nur die Datenmodelle so wählen, dass sie passen.

### Etappe 1 – Teigrechner *(fertig)*
Bäckerprozente, Mehlmischungen, Starter, Quellstück, Vorlagen, Teilen per Link, Teiglinge, Starter-Auffrischung, PWA, Bildschirm-an.

- **Schritt 7 – Teiglinge-Modus:** Anzahl × Gewicht je Teigling (z. B. 4 Pizzen à 250 g, 8 Buns à 85 g), optionaler
  **Verlust-Zuschlag in %** (Standard 2 %). Umschalten zwischen Mehl- und Teiglinge-Modus mit **einem Tipper**.
  Rechnung nur in `rechner.js` (`mehlAusTeiglingen` ist als Grundlage schon da), mit Tests.
- **Schritt 8 – Starter-Auffrischung:** benötigte Startermenge **plus Rest für den Kühlschrank** (Standard 20 g).
  Verhältnis Anstellgut:Mehl:Wasser frei einstellbar, Schnellwahl **1:1:1, 1:1,5:1,5, 1:2,5:2,5**.
  Knopf **„Bedarf aus aktuellem Rezept übernehmen“**. Ergebnis in **ganzen Gramm**. Rechnung in `rechner.js` (`auffrischen`), mit Tests.
- **Schritt 9 – PWA:** Manifest, App-Icon, Service Worker für Offline-Betrieb. **Neue Versionen müssen zuverlässig auf den
  iPhones ankommen und dürfen nicht im Cache hängen bleiben** (Cache mit Versionsnummer, alte Caches beim Aktivieren löschen,
  alles inkl. `index.html` aus dem Cache für sofortigen Start, Update-Hinweis in der App). Alle Pfade relativ wegen `/kochbuch/`.
- **Schritt 10 – Bildschirm bleibt an**, solange die App offen ist (Wake Lock, nach Rückkehr in die App erneut anfordern).

### Schritt 12 – Vorlagen ausbauen *(fertig)*
- **Startseite = Vorlagenliste**, gruppiert nach Kategorien (Brot, Brötchen, Pizza, Focaccia, Gebäck; alte eigene
  Vorlagen ohne Kategorie unter „Ohne Kategorie“ am Ende), Favoriten (Stern) oben, Suche ab 10 Vorlagen.
  Zeile zeigt dieselben Werte wie der Rechner (`zusammenfassung` in `startseite.js`).
- Ein Tipper öffnet den **Rechner**: Name als Überschrift, Zurück-Pfeil. Beim App-Start direkt die zuletzt benutzte Vorlage.
- **Modus je Vorlage** (`modus`: `mehl` | `teiglinge`), nur in der Klappe „Vorlage“ bzw. beim Speichern änderbar.
  Ohne `modus` (alt): Teiglinge-Angabe vorhanden = Teiglinge-Modus. Teiglinge-Angabe nur im Teiglinge-Modus gespeichert.
- **Speichern:** Nur echte Rezeptänderungen zählen als „geändert“ (nicht Mehl, Anzahl, Gewicht). Karte mit Name,
  Kategorie, Modus: „Vorlage aktualisieren“ (nur eigene) oder „Als neue speichern“; bei „Zurück“ zusätzlich „Verwerfen“.
- Eingebaute Vorlagen ausblendbar. **Favoriten und Ausgeblendet sind Geräte-Einstellungen** (nicht im Link, nicht im Sync).
- **Zusatzzutaten** (Milch, Ei, Butter, Zucker, Honig, eigene) in % vom Gesamtmehl, siehe Rechenregeln.

## Offline und Updates (Schritt 9/10)

- `sw.js` (Service Worker) cacht alle Dateien aus `DATEIEN`. **Neue Datei der App → dort eintragen.**
- **Nach jeder Änderung an einer ausgelieferten Datei `VERSION` in `sw.js` anpassen.** `npm test` schlägt sonst fehl
  und nennt den neuen Wert (Prüfsumme der Dateien). Ohne neue Version kommt das Update nicht auf die iPhones.
- Ablauf: neuer Service Worker lädt alles frisch (`cache: 'reload'`) → App zeigt „Neue Version da“ → Tipper aktiviert,
  alte Caches werden gelöscht. Bei Rückkehr in die App wird nach Updates gesucht.
  Alles, auch `index.html`, kommt aus dem Cache (sofortiger Start); Updates laufen nur über `VERSION` und Hinweis.
- Versionsanzeige ganz unten in der App (zum Vergleich beider Handys).
- Icon: Quelle `icons/icon.svg`, daraus die PNGs (180 für iOS, 192/512 fürs Manifest).

### Etappe 2 – Gemeinsame Daten
- Anmeldung und Sync zwischen zwei iPhones über eine Datenbank (Cloud, von GitHub Pages aus per `fetch` erreichbar).
- Persönliche Daten liegen **nur dort**, nie im Repo. Im Code stehen höchstens öffentliche Projekt-Schlüssel, der Schutz
  läuft über Anmeldung und Zugriffsregeln der Datenbank (nur die zwei Konten sehen die Daten).
- Die eigenen Vorlagen ziehen mit um (Datenmodell mit `id`/`geaendert`/`geloescht` ist dafür schon da).
  Eigene Mehle/Saaten samt Wasserwerten werden hier mit synchronisiert.
- App bleibt **offline nutzbar** (lokal speichern, später abgleichen). Teilen per Link bleibt als Sicherung.
- **Die Regel „keine Pakete“ darf hier abgewogen werden:** Eine schlanke, verbreitete Bibliothek des Anbieters ist erlaubt,
  wenn sie Anmeldung und Sync deutlich einfacher und sicherer macht. **In der Planung beide Wege vergleichen**, dann entscheiden:
  - *Weg A, nur `fetch`:* kleinste App, volle Kontrolle, kein Fremdcode. Dafür selbst bauen und pflegen: Anmeldung,
    Token-Erneuerung, Fehlerfälle. Das ist der sicherheitskritische Teil.
  - *Weg B, Bibliothek des Anbieters:* bewährte Anmeldung und Token-Pflege, weniger Eigencode. Dafür größere Dateien
    (Ladezeit, Offline-Cache), Abhängigkeit vom Anbieter, Fremdcode. Dann: feste Version, als Datei im Repo ablegen
    (nicht live von einem CDN laden), Updates nur bewusst.
  - *Tendenz (zu prüfen):* Bibliothek höchstens für die Anmeldung; die eigentliche Sync-Logik (`id`, `geaendert`, `geloescht`) bleibt
    eigener Code in `kern/` hinter einer kleinen Schnittstelle, damit der Anbieter austauschbar bleibt.
- **Anmeldung auf dem iPhone:** Links aus E-Mails öffnen in Safari, nicht in der Homescreen-App, und beide haben getrennte
  Speicher (wie beim Teilen-Link). Ein „Anmelde-Link per E-Mail“ meldet deshalb nur Safari an, nicht die App.
  Besser: Passwort oder Einmal-Code, der in der App eingetippt wird. Beim Vergleich mitprüfen.
- Vor dem Bauen klären: Anbieter der Datenbank, Anmeldeweg, Weg A oder B, Kosten (Gratis-Stufe reicht für zwei Nutzer?).

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
  GitHub führt sie bei jedem Pull Request automatisch aus (`.github/workflows/tests.yml`); rot = nicht mergen.
- Rechnen nur in `rechner.js`, Speichern nur über `kern/speicher.js`, Oberfläche rechnet nicht.
- Namen und Kommentare auf Deutsch, Code-Stil wie im Bestand.

## Ordner

| Pfad | Inhalt |
|---|---|
| `index.html` | einzige HTML-Seite |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline-Betrieb, Homescreen-App, App-Icon |
| `css/basis.css` | Farben (hell/dunkel), Schrift, Knöpfe, Felder |
| `css/<bereich>.css` | Design eines Bereichs (z. B. `teig.css`) |
| `js/app.js` | Start und (später) Navigation |
| `js/kern/` | Gemeinsames: `speicher.js`, `zahlen.js`, `html.js` (`text()` maskiert Namen), `aktualisierung.js` (Service Worker, Update-Hinweis), `bildschirm.js` (Wake Lock) |
| `js/teig/` | Teigrechner: `rechner.js` (Logik), `vorlagen.js` (inkl. Kategorien, Ordnen der Liste), `zutaten.js` (Mehle/Saaten/Zusatzzutaten), `teilen.js` (Teilen-Link), `startseite.js` (HTML der Vorlagenliste), `ansicht.js` (Oberfläche, Navigation) |
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
- Zusatzzutaten: in % vom Gesamtmehl, jede mit Wasseranteil (Milch 87, Ei 75, Butter 16, Honig 17, Zucker 0 %).
  Ihr Wasser zählt zur Hydration wie das Starter-Wasser: zugegebenes Wasser = Gesamtwasser − Starter-Wasser − Zusatz-Wasser.
  Der Wasseranteil steht in der Zutat im Teig (`teig.zusaetze`), damit die Vorlage überall gleich rechnet.
  Keine Korrektur für die festigende Wirkung von Ei/Butter – die Hydration stellt man nach Gefühl ein.
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
- Enthalten seit Schritt 12: `kategorie`, `modus`, `teig.zusaetze`. Alte Links ohne diese Felder funktionieren weiter.
- Nicht enthalten: eigene Mehl-/Saatensorten und Wasserwerte (Einstellungen), Favoriten, Ausgeblendet.

## Bedien-Anforderungen

- **Sehr schnell:** sofortiger Start, offline nutzbar, keine unnötigen Bibliotheken.
- **Küchentauglich:** große Schaltflächen (mind. **56 px**, `--tipp-hoehe`), mit einer Hand und Teig an den Fingern bedienbar.
- **Live-Ergebnisse** beim Tippen, kein „Berechnen“-Knopf.
- Häufigster Weg (Vorlage laden → Mehlmenge ändern → ablesen) in **höchstens zwei Tippern**
  (Vorlage in der Liste antippen → Menge eintippen; die zuletzt benutzte ist beim Start schon offen).
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
