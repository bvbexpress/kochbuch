// app.js – Startpunkt der App.
// Später kommen hier weitere Bereiche (Rezepte, Vorrat) und eine Navigation dazu.

import { zeigeTeigrechner, datenAktualisiert, sichereAlle } from './teig/ansicht.js';
import { eigeneVorlagen } from './teig/vorlagen.js';
import { starteOfflineBetrieb, frageVersion } from './kern/aktualisierung.js';
import { bildschirmAnLassen } from './kern/bildschirm.js';
import { speicher } from './kern/speicher.js';
import { erstelleAnmeldung } from './kern/anmeldung.js';
import { erstelleServer } from './kern/server.js';
import { erstelleSync } from './kern/sync.js';
import { erstelleAusloeser } from './kern/ausloeser.js';
import { erstelleAbgleichBereich } from './kern/abgleich.js';

// Abgleich zwischen den Handys (Etappe 2): Anmeldung und Status unten auf der Startseite,
// abgeglichen wird beim Start, bei Rückkehr in die App, wenn das Netz wieder da ist und kurz nach dem Speichern.
const anmeldung = erstelleAnmeldung({ speicher });
const server = erstelleServer({ anmeldung });
const sync = erstelleSync({ speicher, server });
const abgleich = erstelleAbgleichBereich({
  speicher,
  anmeldung,
  server,
  abgleichen: () => ausloeser.jetzt(),
  sicherung: { anzahl: () => eigeneVorlagen(speicher).length, erstellen: sichereAlle },
});
const ausloeser = erstelleAusloeser({
  sync,
  bereit: abgleich.bereit,
  nachAbgleich(bericht) {
    if (bericht.heruntergeladen > 0 || bericht.kopien > 0) datenAktualisiert();
    abgleich.nachAbgleich(bericht);
  },
});

zeigeTeigrechner(document.getElementById('inhalt'), { abgleich });
abgleich.verbindeVerwaltung(document.getElementById('version'), document.getElementById('verwaltung'));
abgleich.start();
speicher.beiAenderung(() => ausloeser.nachAenderung());
ausloeser.start();
bildschirmAnLassen();

starteOfflineBetrieb((aktualisieren) => {
  const leiste = document.getElementById('update');
  leiste.querySelector('button').onclick = aktualisieren;
  leiste.hidden = false;
});

// Kleine Versionsanzeige ganz unten – so lässt sich prüfen, ob beide Handys gleich aktuell sind.
// Langes Drücken darauf öffnet die versteckte Verwaltung (Abmelden, Verwalter-Handy an/aus).
frageVersion().then((version) => {
  if (version) document.getElementById('version').textContent = `Version ${version}`;
});
