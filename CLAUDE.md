# CLAUDE.md – Leitfaden für dieses Repo

Koch- und Back-App als PWA, **deutsch**, **mobile first**.
Nutzer: zwei iPhones mit iOS 26, Nutzung **nur als Homescreen-Web-App**.
Veröffentlichung über GitHub Pages aus `main`: https://bvbexpress.github.io/kochbuch/ – **das Repo ist öffentlich**.
Der Nutzer ist Anfänger und arbeitet nur in der Cloud: Erklärungen knapp halten.

## Grundsatz – gilt für alles

**Die zweite Nutzerin muss die App ohne Erklärung bedienen können.**
- Keine verschachtelten Menüs, keine zusätzlichen Schritte im Alltag. Alles direkt dort bearbeitbar, wo man es sieht.
- **Im Zweifel eine Funktion weglassen**, statt die Bedienung komplizierter zu machen.
- Technische Probleme (kein Netz, Server pausiert, Anmeldung abgelaufen) zeigen sich im Alltag **nie** als Meldung.
  Die App arbeitet lokal weiter und löst sie möglichst selbst. Falls doch jemand handeln muss, sieht das nur
  das Verwalter-Handy (Geräte-Einstellung), ruhig und an einer Stelle.

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
- **„+ Neue Vorlage“** (unter der Liste): Karte mit Name, Kategorie, Modus (vorbelegt nach Kategorie:
  Pizza 4 × 250 g, Brötchen 8 × 85 g in Teiglingen, sonst Mehl; `vorbelegung`) und Ausgangsbasis
  (leer = `LEERER_TEIG`: Weizen 550, 65 % Wasser, 2 % Salz, 500 g – oder Kopie einer Vorlage; `neueVorlage`).
  Wird sofort gespeichert und im Rechner geöffnet.
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

### Etappe 2 – Gemeinsame Daten *(fertig)*
**Entschieden:** Supabase, Region Frankfurt, Gratis-Stufe. **Weg A: nur `fetch`, keine Bibliothek.**
- Persönliche Daten liegen **nur in der Datenbank**, nie im Repo. Im Code stehen nur Projekt-URL und öffentlicher
  Schlüssel (publishable). Der geheime Schlüssel (secret/`service_role`) kommt nie in App oder Repo.
- **Zugriffsschutz:** Row Level Security auf jeder Tabelle. Zugriff nur für Konten, die in `mitglieder` dem Haushalt
  zugeordnet sind. `mitglieder` pflegt nur der Verwalter im Dashboard. Registrieren ist in Supabase abgeschaltet.
- **Anmeldung:** E-Mail + Passwort, **einmal pro Handy** beim Einrichten (Schlüsselbund füllt aus). Danach nie wieder:
  Der Erneuerungsschlüssel läuft nicht ab, die App erneuert den Zugangsschlüssel still. Kein Link per E-Mail.
  Erneuern immer nur einmal gleichzeitig, neuen Schlüssel sofort speichern. Supabase akzeptiert den vorigen Schlüssel
  erneut (Ausnahme „Elternschlüssel“), ein abgebrochenes Erneuern meldet also nicht ab.
- **Datenmodell Server:** eine Tabelle `datensaetze` (`haushalt`, `sammlung`, `id`, `daten` JSON, `geloescht`, `version`,
  `stand`, `geaendert_von`). Neue Bereiche (Rezepte, Vorrat, Zutatenkatalog) = neue `sammlung`, keine neue Tabelle.
- **Sync** (eigener Code in `kern/`, Anbieter-Teil nur in `kern/server.js` und `kern/anmeldung.js`):
  lokal zuerst speichern, Datensatz als „offen“ markieren. Hochladen über eine Datenbank-Funktion, die nur schreibt,
  wenn die Server-`version` noch die ist, auf der die Änderung beruht. Herunterladen „alles seit `stand`“.
  **Entscheidend ist die Server-Version, nie die Uhr des Handys.** Auslöser: Start, Rückkehr in die App, Netz wieder da,
  kurz nach dem Speichern.
- **Konflikte:** Vorlagen/Rezepte → die Server-Fassung bleibt, die eigene wird zur Kopie mit kleinem Vermerk direkt an der
  Vorlage (kein Dialog). Inhaltlich gleich = kein Konflikt. Löschen gegen Ändern: Ändern gewinnt.
  Einzelwerte (Wasserwert eines Mehls): zuletzt hochgeladen gewinnt.
- **Umzug:** Bei der ersten Anmeldung werden alle eigenen Datensätze hochgeladen. Vorher wird automatisch ein Sicherungs-Link
  angeboten (nur auf dem Verwalter-Handy). Favoriten, Ausgeblendet, zuletzt geöffnet bleiben Geräte-Einstellungen.
- **Gegen das Pausieren** (Supabase pausiert nach 7 Tagen ohne Anfragen): GitHub Action ruft zweimal pro Woche
  eine kleine Datenbank-Funktion `ping` auf. Achtung: GitHub schaltet Zeitpläne in öffentlichen Repos nach 60 Tagen
  ohne Repo-Aktivität ab – die Action hält sich deshalb selbst aktiv. Schlägt sie fehl, mailt GitHub dem Verwalter.
- **Fehler bleiben unsichtbar** (siehe Grundsatz): Die App arbeitet lokal weiter, offene Änderungen gehen nie verloren.
  Nur das Verwalter-Handy zeigt den Abgleich-Status, auch „Handy 2 hat seit X Tagen nicht abgeglichen“.
- Teilen per Link bleibt als Sicherung.
- Erkennung doppelt benutzter Erneuerungsschlüssel in Supabase **nicht** abschalten (die Elternschlüssel-Ausnahme reicht).
  Abschalten nur als Notlösung, falls der Praxistest Abmeldungen zeigt.
- **Bauplan** (je Schritt ein PR mit Tests; Reihenfolge fest):
  - **A** *(fertig)* `kern/speicher.js`: Markierung „offen“ und Server-Version je Datensatz (internes Feld `sync`,
    nie nach außen), `offene`, `hochgeladen`, `vomServer` (überschreibt nie offene Änderungen), `syncStand`. Ohne Netz.
  - **B** *(fertig)* `datenbank/schema.sql`: Tabellen, RLS, `hochladen`/`herunterladen` (Logik in Schema `intern`), `ping`,
    letzter Abgleich je Konto (`mitglieder.letzter_abgleich`). Getestet gegen echtes PostgreSQL (`tests/datenbank.test.js`,
    lokal übersprungen ohne PostgreSQL, bei GitHub Pflicht). Das Skript setzt alle Freigaben selbst; getestet mit
    alter Supabase-Grundeinstellung und streng (keine automatischen Freigaben, automatische RLS). Danach richtet der Nutzer
    Supabase ein: Projekt (Frankfurt, Free), zwei Konten mit „Auto Confirm“, Registrieren aus, Skript ausführen,
    Haushalt/Mitglieder per Zusatz-SQL (nur im Chat, enthält E-Mails, **nie ins Repo**), URL + publishable key an Claude,
    Security Advisor prüfen.
    **Einrichtung abgeschlossen:** Projekt in Frankfurt (Free), „Automatically expose new tables“ aus,
    „Enable automatic RLS“ an, Haushalt mit zwei Mitgliedern. URL und publishable key in `js/kern/server.js`.
    Das Skript entzieht `public.rls_auto_enable()` (von Supabase angelegt) das Ausführungsrecht; die automatische
    RLS wirkt weiter. Security Advisor: 0 Fehler; Warnung „Leaked Password Protection Disabled“ bewusst ignoriert
    (Registrieren ist aus).
  - **C** *(fertig)* `kern/sync.js`: `erstelleSync({ speicher, server })` → `abgleichen()` (erst hoch, dann runter;
    nie gleichzeitig, wirft nie, Ergebnis mit `ok`/`fehler`/`offen`/`kopien`). Server wird mitgegeben (kommt in D).
    Sammlungen und Konfliktart in `SAMMLUNGEN`: `teigvorlagen` = `kopie` (Name „Brot (Änderung vom 3.10.)“ +
    Vermerk `konflikt: { von, am }`),
    `mehle`/`saaten`/`zusaetze` = `zuletzt`. Inhaltsvergleich ohne Zeitstempel und unabhängig von der
    Feld-Reihenfolge (jsonb sortiert um). Erst Kopie sichern, dann überschreiben (Abbruch verliert nichts,
    keine doppelte Kopie). Unbekannte Sammlungen vom Server werden trotzdem gespeichert.
    Neu in `speicher.js`: `neueBasis` (eigene Änderung gilt, setzt auf Server-Version auf).
    Tests: `tests/sync.test.js` mit nachgebautem Server und zwei Handys. **Neue Sammlung → in `SAMMLUNGEN` eintragen.**
  - **D** *(fertig)* `kern/anmeldung.js`: `erstelleAnmeldung({ speicher })` → `anmelden(email, passwort)`
    (wirft nie, `{ ok, grund: falsch|netz|zuoft|server }`), `zugangsschluessel()` (still erneuert, nur einmal
    gleichzeitig, sofort gespeichert; `null` = gerade keiner), `zustand()` (`abgemeldet`|`angemeldet`|`abgelehnt`),
    `konto()`. Gespeichert als Geräte-Einstellung `anmeldung` (ohne E-Mail/Passwort). Ablauf aus `expires_in` mit
    Handy-Uhr. `abgelehnt` nur bei ausdrücklicher Ablehnung durch Supabase, nie bei Netz-/Server-Fehlern.
    `kern/server.js`: `erstelleServer({ anmeldung })` → `hochladen`, `herunterladen` für `sync.js`
    (wirft bei Problemen, bei 401 einmal erneuern und wiederholen, Zeitgrenze 20 s).
    Tests: `tests/anmeldung.test.js` mit nachgebautem Supabase (Schlüssel-Rotation, Elternschlüssel-Regel,
    abgebrochenes Erneuern, App-Neustart). Noch nicht in der Oberfläche eingebunden (kommt in E/F).
  - **E** *(fertig)* `kern/abgleich.js`: Klappe „Abgleich zwischen den Handys“ unten auf der Startseite (zugeklappt).
    Nicht angemeldet: Formular E-Mail/Passwort (`autocomplete` für den Schlüsselbund), auf jedem Handy.
    Verwalter-Handy = Geräte-Einstellung `abgleich.verwalter`, **nur per Häkchen beim Anmelden** (kein Umschalt-Knopf).
    Andere Handys: nach der Anmeldung keine Klappe mehr (erst wieder mit Formular, falls Supabase ablehnt).
    Verwalter: Status mit wartenden Änderungen
    und „Handy 2: seit X Tagen nicht abgeglichen“ (aus `mitglieder.letzter_abgleich`, `server.mitglieder()`,
    höchstens einmal pro Minute); ab `WARNEN_AB_TAGEN` (3) oder bei Abmeldung/kein Haushalt „· bitte ansehen“ im
    Titel. Die Oberfläche gleicht selbst nicht ab (Auslöser in F).
    Konflikt-Kopien: Vermerk in der Liste und als Karte im Rechner („Diese behalten“ entfernt `konflikt`,
    „Diese löschen“); Speichern der Kopie entfernt ihn ebenfalls. Verdrahtung in `app.js`.
    Live-Test: `npm run test:live` (`tests/live-supabase.js`, nicht in `npm test`) mit `SUPABASE_TEST_EMAIL`/
    `SUPABASE_TEST_PASSWORT`. Das Testkonto gehört **bewusst zu keinem Haushalt**: Der Test prüft Anmelden,
    Erneuern, Elternschlüssel und dass das Konto (und anonym) nichts lesen und nichts schreiben kann.
    Abgleich mit Haushalt prüft Schritt H auf den iPhones.
    **Versteckte Verwaltung:** langes Drücken (0,7 s) auf die Versionsnummer ganz unten → Karte „Verwaltung“
    mit „Verwalter-Handy: an/aus“ und „Abmelden“. Abmelden gleicht vorher noch einmal ab, fragt (nennt noch
    nicht hochgeladene Änderungen), vergisst die Schlüssel (`anmeldung.abmelden()`, Supabase-Logout nur
    nebenbei) und setzt `syncStand` auf 0. Daten und offene Änderungen bleiben und gehen nach der nächsten
    Anmeldung hoch. Eine späte Antwort beim Erneuern meldet nach dem Abmelden nicht wieder an.
  - **F** *(fertig)* `kern/ausloeser.js`: `erstelleAusloeser({ sync, bereit, nachAbgleich })` → `start()`
    (App-Start, Rückkehr in die App, Netz wieder da), `nachAenderung()` (2 s nach der letzten lokalen Änderung;
    beim Verlassen der App sofort), `jetzt()`. Lokale Änderungen meldet `speicher.beiAenderung` (nur
    `speichere`/`uebernimm`/`loesche`, nie Server-Daten). `bereit()` aus `abgleich.js`: angemeldet und Umzug frei.
    **Umzug:** Daten von vor Etappe 2 gelten als offen (Version 0) und gehen beim ersten Abgleich hoch.
    Verwalter-Handy mit eigenen Vorlagen: vorher Karte in der Klappe („Sicherung erstellen“ = Sicherungs-Link,
    „Abgleich starten“), bis dahin kein Abgleich; „· bitte ansehen“ im Titel. Geräte-Einstellung
    `abgleich.umzug` = true nach „Abgleich starten“ oder dem ersten erfolgreichen Abgleich (danach nie wieder).
    Andere Handys gleichen nach der Anmeldung sofort ab. Neue Daten vom Server: `datenAktualisiert()` in
    `ansicht.js` lädt Liste und Werte neu (nicht während getippt wird); die offene Vorlage im Rechner nur, wenn
    hier nicht geändert – Mehlmenge und Teiglinge bleiben.
  - **G** *(fertig)* `.github/workflows/ping.yml` („Weckruf“): Mo + Do 06:17 UTC `rpc/ping` per `curl`, Lauf rot bei
    Fehler oder Antwort ≠ `"ok"` (GitHub mailt). Zweiter Job schaltet den Zeitplan per API wieder ein
    (`actions: write`, keine Commits), damit er nach 60 Tagen Ruhe nicht abgeschaltet wird. Von Hand startbar
    (`workflow_dispatch`). Adresse und publishable key stehen auch im Workflow; `tests/ping.test.js` prüft, dass sie zu
    `server.js` passen. Kein Secret nötig.
  - **H** *(fertig)* Praxistest auf beiden iPhones bestanden: Abgleich in beide Richtungen, offline, gleichzeitige Änderung
    mit Konflikt-Kopie, Löschen kommt am anderen Handy an, keine technischen Meldungen auf dem zweiten Handy, versteckte
    Verwaltung. „Löschen gegen Ändern“ bewusst nicht von Hand getestet (nur in `tests/sync.test.js`).
    Danach ergänzt: **Takt** – bei offener, sichtbarer App alle 45 s (`TAKT` in `ausloeser.js`) still abgleichen; jeder andere
    Abgleich setzt ihn neu, im Hintergrund läuft er nicht.
- **Nach Etappe 2 ergänzt – Wischen in der Vorlagenliste** (`wischen.js`, Knopf in `startseite.js`): Zeile nach links wischen →
  roter Knopf „Löschen“ (eigene) bzw. „Ausblenden“ (eingebaute). Keine Nachfrage, dafür 6 s lang „Rückgängig“
  (`entferneAusListe` in `ansicht.js`; Löschen = Grabstein, Rückgängig stellt den alten Inhalt als neue Änderung wieder her).
  Während eines Wischens zeichnet `datenAktualisiert()` nicht neu, sondern holt es danach nach.

### Etappe 3 – Rezepte *(in Planung, noch nichts gebaut)*

**Aufbau der App**
- **Startseite:** zwei große Kacheln „Backen“ und „Kochen“, darunter eine Suche über alle Rezepte und „Weiter mit: …“
  (die letzten 2 geöffneten Rezepte). Das automatische Öffnen der zuletzt benutzten Vorlage beim Start entfällt.
- **Backen** öffnet **direkt die Back-Rezeptliste** (keine Zwischenebene), oben dauerhaft ein Knopf „Teigrechner“
  (Schnellrechnung ohne Rezept, mit Knopf „Als Rezept speichern“).
- **Kochen:** Rezepte nach Kategorien (Currys, Pasta, Suppen, Aufläufe …), innerhalb alphabetisch, Favoriten oben, Suche.
- Die bisherigen Teigrechner-Vorlagen werden **Back-Rezepte** (Teigwerte plus Arbeitsschritte): keine zwei Listen.

**Rezept**
- `portionen` + `portionsart` (Personen/Stück/Laibe) wählbar, Mengen passen sich an.
- Zutat: Katalog-`id`, `menge` (leer = „nach Geschmack“), `einheit`, `regel` (linear | ganze Stück | fix).
- Schritte kurz und kleinteilig, beim Kochen abhakbar (nicht gespeichert). Bildschirm bleibt an (gibt es schon).
- **Zutaten je Schritt** (`schrittzutaten`, parallel zu `schritte`, gleiche Reihenfolge): je Schritt eine Liste
  `{ zutat: Katalog-id einer Zutat des Rezepts, menge?: Teilmenge }`. Ohne `menge` gilt die ganze Menge der Zutat; mit `menge`
  (gleiche Einheit wie im Rezept) ist es ein Teil, z. B. Wasser 1500 ml in Schritt 2 und 500 ml in Schritt 4. Teilmengen skalieren
  mit den Portionen nach der Regel der Zutat (`skaliereSchritte` in `rechner.js`). Die App zeigt sie als Chips unter dem Schritt.
  Geprüft in `bereinigeRezept`: nur Zutaten des Rezepts, Menge > 0, jede Zutat höchstens einmal je Schritt; leere Schritte nehmen
  ihren Eintrag mit. Beim Speichern darf statt `zutat` auch `name` stehen (wie bei den Zutaten). **Rückfall:** hat kein Schritt einen
  Eintrag, fehlt das Feld, und die App sucht die Zutaten über den Namen im Schrittext (`mengenInSchritten`). Gilt für das ganze
  Rezept: sobald ein Schritt Einträge hat, gelten nur die Einträge (ein Schritt ohne Eintrag zeigt dann keine Mengen).
- `status`: **erprobt** | **noch testen**, ein Tipper. **Per Connector gespeicherte Rezepte sind „erprobt“**, „noch testen“ nur für
  importierte (`quelle: import`). Kurze Notiz am Rezept. „Neu“-Markierung bis zum ersten Öffnen
  (Geräte-Einstellung mit gesehenen `id`s; beim Umzug gelten alle alten Vorlagen als gesehen).
- **Sammlung `rezepte`** (`art`: backen | kochen, Name, Kategorie, Portionen, Zutaten, Schritte, Status, Notiz, `quelle`:
  claude | import | hand, `teig` nur bei Back-Rezepten). Konfliktart `kopie` wie bei Vorlagen.
  **Sammlung `zutaten`** (Katalog: `id`, Name, Art; Konfliktart `zuletzt`): schlank, Mehle/Saaten mit ihren festen `id`s
  sind der Anfang, Einheiten-Umrechnung erst mit dem Vorrat (Etappe 4). Unbekannter Name beim Speichern = neuer Eintrag.
  Neue Sammlungen in `SAMMLUNGEN` eintragen.
- **Back-Rezept:** Mehl, Wasser, Salz usw. rechnet der Teigrechner (keine zweite Pflege), Belag u. ä. sind normale Zutaten.
  Skaliert wird über Mehl bzw. Teiglinge.
- **Neue Sammlung statt alte erweitern:** Ein Handy mit alter App-Version könnte neue Felder in `teigvorlagen` beim
  Hochladen abschneiden.

**Umzug Vorlagen → Back-Rezepte (ohne Datenverlust)**
- Jede Vorlage wird ein Back-Rezept **mit derselben `id`** (beide Handys gleichzeitig = kein Doppel, gleicher Inhalt = kein Konflikt).
- `teigvorlagen` bleibt **unverändert als Sicherung** (löschen nur später, bewusst, in eigenem Schritt). Vorher Sicherungs-Link
  anbieten wie in Etappe 2. Lücke: Ändert ein Handy mit alter Version danach eine Vorlage, ändert es nur das Archiv
  (Update-Hinweis und Versionsanzeige decken das ab).

**Teigrechner ↔ Back-Rezept und Vereinfachung**
- Im Back-Rezept „Im Teigrechner anpassen“. Zurück nur **„Nur für heute“** (Rezept zeigt die angepassten Mengen, Original
  bleibt) oder **„Ins Rezept übernehmen“** (dauerhaft).
- Dadurch entfallen die **Speichern-Karte** (Name/Kategorie/Modus) und die **Klappe „Vorlage“**. Name, Kategorie, Modus liegen
  beim Bearbeiten des Rezepts; „Als neue speichern“ wird „Kopie machen“ im Rezept.
- Ein voller Zutaten-Editor am Handy ist **nicht** vorgesehen (Hauptweg = Connector); zuerst nur Notiz, Status, Schritte ändern.

**Connector „Rezepte direkt aus Claude“** (Remote-MCP-Server für claude.ai)
- **Geprüft in Schritt 0:** Eigener Connector im Pro-Konto (Customize → Connectors → „Add custom connector“), Anmeldung
  „Keine Anmeldung“, **Request-Header** `authorization` = `Bearer <Schlüssel>` (Beta, im Konto vorhanden). Läuft im Browser,
  im Projekt „Kochen & Backen“ und in der iPhone-App; in neuen Chats ist er schon eingeschaltet (er ist also in **jedem** Chat
  verfügbar, nicht nur im Projekt). Supabase Free: 500.000 Aufrufe pro Monat (reicht weit).
- Läuft als **Supabase Edge Function** im selben Projekt (Free: 0 $). Eingefügt **im Dashboard** (kein Zugangstoken als
  GitHub-Secret). Der Code liegt trotzdem im Repo (`supabase/functions/…`), mit Test, dass die eingefügte Kopie dem Repo-Stand
  entspricht (Deno kann keine Dateien aus `js/` laden → Prüflogik als Kopie + Test gegen das Original, wie bei `ping.test.js`).
  Funktion ohne Supabase-JWT-Prüfung (`verify_jwt` aus), dafür eigene Prüfung des Schlüssels.
- **Werkzeuge (mehr gibt es nicht):** `zutaten_liste` (nur Namen), `rezept_anlegen` (auch mehrere, für den Import; **immer mit `schrittzutaten`**, geprüft wie in `bereinigeRezept`),
  `rezept_aktualisieren` (nur mit der Version, auf der Claude aufbaut; sonst Konfliktkopie, nie überschreiben; ändert Claude Schritte oder Zutaten, liefert es `schrittzutaten` neu mit),
  `rezepte_finden` (Titel/`id`, ein Rezept per `id`). **Kein Löschen, kein Zugriff auf andere Tabellen, Konten, Vorrat.**
- **Sicherheit:** langer Zufallsschlüssel nur als Supabase-Secret (nie im Repo, Repo ist öffentlich). Schreiben nur über
  eine Datenbank-Funktion `rezept_speichern`, aufrufbar von einer **eigenen Datenbank-Rolle**, die nur diese Funktion ausführen
  darf (nicht `service_role`). Nur Sammlungen `rezepte` und `zutaten`, nie `geloescht`, `geaendert_von` = „claude“.
  Prüfung wie bei Teilen-Links (Größenlimit, nur bekannte Felder, Zahlenbereiche). Schlüssel tauschbar in einer Minute.
  Schlimmster Fall bei Diebstahl: Rezepte werden hinzugefügt, nichts gelesen, nichts gelöscht.
- **Schlüssel nur als Kopfzeile** `Authorization: Bearer <Schlüssel>` (entschieden nach Schritt 0). **Kein** Schlüssel im Pfad,
  kein `x-api-key`, kein OAuth. Fehlt das Secret oder ist es kürzer als 32 Zeichen, ist die Funktion zu (401).
  Plan B (Schlüssel im Pfad, OAuth) entfällt.
- **Notlösung „Rezept einfügen“:** Kochbuch-Code (derselbe wie beim Connector, geprüft wie Links) in der App einfügen.
  Claude gibt ihn aus, wenn der Connector fehlt. Auch Weg für den späteren Import der bisherigen Sammlung.
- **Projektanweisung (Vorschlag, für das Claude-Projekt „Kochen & Backen“):**
  > Wenn wir ein Gericht oder Backwerk zu Ende gekocht haben und es gelungen ist, frage genau einmal: „Soll ich das Rezept im
  > Kochbuch speichern?“ Speichere nur nach einem Ja. Frage vorher mit `zutaten_liste` die vorhandenen Zutatennamen ab und
  > benutze diese Namen. Schreibe Mengen für die Portionszahl, für die wir gekocht haben, mit Einheit und Regel
  > (linear / ganze Stück / fix). Schreibe Schritte kurz und kleinteilig, ein Handgriff pro Schritt. **Liefere zu jedem Schritt
  > in `schrittzutaten` alle Zutaten mit, die in diesem Schritt gebraucht werden** (Verweis auf die Zutat des Rezepts); wird eine
  > Zutat auf mehrere Schritte verteilt, gib bei jedem Schritt die Teilmenge an (z. B. Wasser 1500 ml in Schritt 2, 500 ml in
  > Schritt 4), sonst gilt die ganze Menge. Schritte ohne Zutaten bekommen eine leere Liste. Status ist „erprobt“,
  > weil wir es gerade gekocht haben. Übernimm unsere Anpassungen („weniger Salz“) als Notiz. Gibt es das Rezept schon
  > (`rezepte_finden`), dann aktualisiere es, statt ein neues anzulegen. Ist der Connector nicht erreichbar, gib das Rezept als
  > Kochbuch-Code aus, den ich in die App einfüge.
  > (Beim Import alter Rezepte setzt Claude `quelle: import` und „noch testen“.)

**Bauplan** (je Schritt ein PR mit Tests). **Reihenfolge: zuerst der Connector, der Back-Umbau danach.**
Kosten grob (±50 %, nach Schritt 1 mit den echten Zahlen korrigieren; Guthaben anfangs ca. 50 $):
- **0** Test, 1–2 $: Mini-Connector „Hallo“ als Edge Function (im Dashboard eingefügt), in claude.ai (Pro) hinzufügen.
  Klärt verbindlich: fester Schlüssel einstellbar? Läuft er im **Projekt** und in der **iPhone-App**? Muss er pro Chat
  eingeschaltet werden? Edge-Function-Limits (Free) nachlesen. Danach Plan B wählen, falls nötig. Nichts davon kommt in die App.
  ***(fertig, bestanden)*** `supabase/functions/hallo/index.ts` (Werkzeug `hallo`, liest/schreibt nichts), Secret
  `KOCHBUCH_SCHLUESSEL`, Tests `tests/connector-hallo.test.js`. Ergebnis: Header-Weg klappt in Browser, Projekt und iPhone,
  ohne Einschalten pro Chat (siehe „Geprüft in Schritt 0“). Panne: Secret-Name zuerst mit Tippfehler → Funktion blieb wie
  gewollt zu (401). Test-Funktion und Connector „Kochbuch Test“ werden nicht mehr gebraucht (löschen), **Secret bleibt** für den
  echten Connector. Der Code von `hallo` (MCP-Grundgerüst) ist die Basis für Schritt 8 und wird dort ersetzt (dann ohne
  Pfad-/`x-api-key`-Weg).
- **1** Datenmodell, Prüfung, Skalierung (`rechner`-Teil, `js/rezepte/`), Zutatenkatalog, `SAMMLUNGEN`. Kein Bildschirm. 3–5 $.
  ***(fertig)*** `js/rezepte/`: `rezept.js` (`bereinigeRezept`, `speichereRezept` löst Zutatennamen auf und legt neue im Katalog an,
  `alleRezepte`, `loeseNamenAuf`; Kategorien beim Kochen in `KOCH_KATEGORIEN`: Pasta & Gnocchi, Currys & Dal, Wok & Pfanne, Suppen & Eintöpfe, Aufläufe & Ofengerichte, Burger & Wraps, Salate & Bowls, Grillen, Snacks & Fingerfood, Beilagen, Saucen & Dips, Frühstück & Süßes, Sonstiges), `katalog.js` (Sammlung `zutaten`, eingebaut = Mehle/Saaten/
  Zusätze; **id einer neuen Zutat = Name in Kleinbuchstaben ohne Sonderzeichen** (`zutatId`: „Kokosmilch“ → `kokosmilch`), damit gleichzeitiges Anlegen
  auf zwei Handys oder durch Claude kein Doppel gibt – die Edge Function rechnet genauso; `zutatenNamen` für `zutaten_liste`),
  `rechner.js` (`skaliere`: Kochen über Portionen, Backen über Mehl bzw. Teiglinge; Regeln linear/ganz/fix; leeres Ziel = Faktor 0),
  `formatMenge` in `zahlen.js`. Back-Rezept = Vorlagenfelder (`teig`, `mehl`, `modus`, `teiglinge`) plus Zutaten/Schritte, Portionen optional.
  `SAMMLUNGEN`: `rezepte` = `kopie`, `zutaten` = `zuletzt`. Noch nirgends in der Oberfläche eingebunden; Tests `tests/rezepte.test.js`, `tests/sync.test.js`.
- **2** Kochen: Liste (Kategorien, A–Z, Favoriten, Suche), Rezeptansicht (Portionen, Schritte, Status, Notiz, „neu“). 5–8 $.
  ***(fertig)*** `js/rezepte/liste.js` (reine Logik: `ordneRezepte`, Favoriten `kochen.favoriten` und „gesehen“ `rezepte.gesehen` als
  Geräte-Einstellungen, `portionenText`, `mengenInSchritten`), `js/rezepte/kochen.js` (Oberfläche, eigene `data-k…`-Attribute),
  `css/kochen.css`, Tests `tests/kochen.test.js`. Einstieg: Knopf „Kochen · N Rezepte“ unter „+ Neue Vorlage“, nur sichtbar, wenn es
  Kochrezepte gibt (Back-Rezepte erscheinen erst in Schritt 5). Rezept: große − / +, Portionen (1–99, nur bis zum Schließen der App
  gemerkt), Status Erprobt/Noch testen und Notiz sofort gespeichert (Notiz 0,5 s nach dem Tippen), Zutaten eingeklappt (die Mengen
  stehen in den Schritten), Schritte antippen = abhaken (nicht gespeichert, „Alle Haken entfernen“), aktueller Schritt = erster
  offener, hervorgehoben. **Mengen in den Schritten:** Zutat wird über ihren Namen im Schrittext gefunden (Wortanfang, letztes Wort
  des Namens, „Zwiebel“ ↔ „Zwiebeln“); kommt eine Zutat in keinem Schritt vor, steht sie nur in der Zutatenliste. (Ursprünglich nur diese
  Namenssuche; jetzt Rückfall, siehe unten.) Konflikt-Kopien: Vermerk in der Liste, im Rezept „Diese behalten“ / „Diese löschen“. Kein Bearbeiten von Name/Zutaten.
  **Danach ergänzt:** Zutaten je Schritt (`schrittzutaten`, siehe „Rezept“ oben; Namenssuche nur noch als Rückfall) und
  **Wischen in der Kochen-Liste** (wie bei den Vorlagen): Zeile nach links wischen → „Löschen“, ohne Nachfrage, 6 s „Rückgängig“
  (alter Inhalt kommt als neue Änderung zurück). Die Leiste „Rückgängig“ gehört `ansicht.js` und wird `startKochen` mitgegeben.
- **7** Datenbank-Teil des Connectors: `rezept_speichern`, eigene Rolle, Tests gegen PostgreSQL. 3–5 $.
  ***(fertig)*** In `datenbank/schema.sql`: Rolle `kochbuch_connector` (nologin, noinherit, keine Sonderrechte, 3 Verbindungen,
  10 s Zeitgrenze) darf **nur** vier Funktionen im Schema `connector` ausführen (sonst keine Tabelle, keine Funktion; Handys und
  anonym kommen nicht an `connector`): `zutaten_liste()` → `[{ id, name }]`, `rezepte_finden(suche)` (Teilwort/id, ≤ 100) →
  `[{ id, name, art, kategorie, version }]`, `rezept_lesen(id)` → `{ id, version, daten }` (ohne Verwaltungsfelder),
  `rezept_speichern({ zutaten: [{ id, name, art }], rezepte: [{ id?, basis?, daten }] })` (≤ 50 Rezepte, ≤ 200 Zutaten).
  Schreibt nur `rezepte`/`zutaten` im Haushalt mit `haushalte.connector = true` (höchstens einer, setzt der Verwalter),
  nie `geloescht`; `geaendert_von` bleibt leer (Spalte ist eine Konto-uuid; erkennbar an `quelle` im Rezept).
  Zutaten nur neu anlegen (vorhandene bleiben unverändert). Rezept: gleicher Inhalt = nichts schreiben (Wiederholung mit
  gleicher id ist sicher); passende `basis` oder gelöscht (Ändern gewinnt) → schreiben; sonst Konfliktkopie
  „Name (Änderung vom 4.10.)“ mit `konflikt: { von, am }`, keine zweite bei Wiederholung. Prüfung in
  `intern.connector_pruefe_rezept` (nur bekannte Felder, Grenzen wie `bereinigeRezept`, `quelle` nur claude|import,
  `schrittzutaten` nur Zutaten des Rezepts, je Schritt einmal, ≤ 100 kB) – weist ab mit `grund`, kürzt nie.
  `datenbank/connector-pruefen.sql` listet, was die Rolle darf (Dashboard-Kontrolle; der Test nutzt dieselbe Datei).
  Tests in `tests/datenbank.test.js` (beide Modi). **Anmeldung der Rolle** (`alter role … login password …`, Passwort nur als
  Supabase-Secret) erst in Schritt 8; die Edge Function verbindet sich direkt per Postgres (Pooler, Benutzer
  `kochbuch_connector.<projekt>`), nicht über PostgREST.
- **8** Edge Function (Werkzeuge, Schlüsselprüfung, Prüfung von `schrittzutaten` wie in `bereinigeRezept`), Test der Repo-Kopie. Nutzer fügt sie im Dashboard ein. 4–7 $.
- **9** Praxistest, Projektanweisung ins Claude-Projekt, Import der bisherigen Sammlung (zuerst per Connector, sonst „Einfügen“). 2–5 $.
- **3** „Rezept einfügen“ (Notlösung) und einfacher Editor (Notiz, Status, Schritte). 3–5 $.
- **4** Neue Startseite (Kacheln, Suche über alles, „Weiter mit“). 3–5 $.
- **5** Umzug Vorlagen → Back-Rezepte, Back-Rezeptansicht. 5–8 $.
- **6** „Im Teigrechner anpassen“, „Nur für heute“/„Ins Rezept übernehmen“, Speichern-Karte und Klappe „Vorlage“ weg. 6–10 $.
- Wird das Geld knapp: Schritt 6 verkleinern (nur die beiden Knöpfe), Editor weglassen, 4–6 notfalls später (Back-Teil bleibt
  bis dahin wie heute, die Rezepte per Connector laufen unabhängig davon).
- Reihenfolge-Hinweis: Bis Schritt 4 hat die App noch die alte Startseite. Kochen-Rezepte bekommen dafür in Schritt 2 einen
  einfachen Einstieg (eigener Bereich unter der Vorlagenliste), der in Schritt 4 durch die Kacheln ersetzt wird.

**Was der Nutzer selbst einrichtet:** Funktions-Secret (Schlüssel) in Supabase; Datenbank-Skript ausführen; Edge Function im
Dashboard einfügen; in claude.ai Connector hinzufügen (Name, URL, Schlüssel) und im Projekt aktivieren; Projektanweisung
einfügen; Praxistest auf beiden iPhones.

**Risiken:** Claude benutzt das Werkzeug falsch
(doppelte Rezepte, Zutatennamen: Servervalidierung, `zutaten_liste`, Anweisung); Überschreiben von Notizen/Änderungen
(Versionsprüfung; „Vorherige Fassung“ nur auf Wunsch); Umzug mit alter App-Version auf einem Handy (gering); zu viel Umfang
(Grundsatz „im Zweifel weglassen“).

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
| `css/<bereich>.css` | Design eines Bereichs (z. B. `teig.css`, `kochen.css`) |
| `js/app.js` | Start und (später) Navigation |
| `js/kern/` | Gemeinsames: `speicher.js`, `zahlen.js`, `html.js` (`text()` maskiert Namen), `aktualisierung.js` (Service Worker, Update-Hinweis), `bildschirm.js` (Wake Lock), `sync.js` (Abgleich), `server.js` (Supabase-Adresse, öffentlicher Schlüssel, Abfragen), `anmeldung.js` (Anmeldung, stilles Erneuern), `abgleich.js` (Klappe Abgleich: Anmelde-Formular, Status auf dem Verwalter-Handy, Umzug, versteckte Verwaltung), `ausloeser.js` (wann abgeglichen wird) |
| `js/rezepte/` | Rezepte (Etappe 3): `rezept.js` (Modell, Prüfung, Speichern), `katalog.js` (Zutatenkatalog), `rechner.js` (Skalieren), `liste.js` (Ordnen, Favoriten, Mengen in Schritten), `kochen.js` (Oberfläche Kochen) |
| `js/teig/` | Teigrechner: `rechner.js` (Logik), `vorlagen.js` (inkl. Kategorien, Ordnen der Liste), `zutaten.js` (Mehle/Saaten/Zusatzzutaten), `teilen.js` (Teilen-Link), `startseite.js` (HTML der Vorlagenliste), `ansicht.js` (Oberfläche, Navigation) |
| `supabase/functions/` | Edge Functions (Connector), im Dashboard eingefügt; nicht Teil der App |
| `datenbank/schema.sql` | Supabase-Datenbank (Tabellen, Zugriffsschutz, Sync-Funktionen, Connector-Rolle); nicht Teil der App |
| `datenbank/connector-pruefen.sql` | Kontrollabfrage: was die Connector-Rolle darf (im Dashboard ausführen) |
| `tests/` | Tests (`*.test.js`) |

`js/vorrat/` erst anlegen, wenn dort Code entsteht.

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
- `id` – UUID, auf beiden Handys gleich (Ausnahme: geänderte eingebaute Mehle/Saaten/Zusätze behalten deren feste
  id wie `weizen550`, das ist auf beiden Handys ebenfalls gleich)
- `geaendert` – Zeitstempel (ms) der letzten Änderung. Für Teilen-Links gewinnt die neuere Version; beim Sync
  entscheidet die Server-`version` (siehe Etappe 2)
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

## Gestaltung „Moos & Holz“

- Warm, ruhig, natürlich: Leinen-Hintergrund, Karten in Mehlweiß, **Moosgrün** (`--akzent`) für Knöpfe und aktive Felder,
  **Holzbraun** (`--holz`) für Überschriften, Sterne, Zurück-Pfeil. Dunkelmodus: dunkles Nussholz.
- Farben nur als Variablen in `css/basis.css`; Bereiche nutzen nur diese Variablen, keine festen Farbwerte.
- Grammwerte und Summen in `--zahl` (höchster Kontrast). Kleine Schrift mindestens 4,5:1 Kontrast.
- Weiche Formen (`--radius` 22 px), Karten mit Rahmen **und** zartem Schatten (Rahmen bleibt bei grellem Licht sichtbar).
- Feedback beim Tippen nur sichtbar (kurz nachgeben, `--akzent-weich`), Übergänge mit `--dauer`/`--kurve`, aus bei
  „Bewegung reduzieren“. Keine Vibration (Safari kann es nicht, der Schalter-Trick ist unzuverlässig).
- Keine eigenen Schriften: Systemschrift. Grid-Spalten mit Text als `minmax(0, 1fr)`, sonst ragt der Inhalt über den Rand.

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
