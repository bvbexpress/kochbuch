// app.js – Startpunkt der App.
// Die Startseite mit den Kacheln „Kochen“ und „Backen“ zeichnet teig/ansicht.js.

import { zeigeTeigrechner, datenAktualisiert } from './teig/ansicht.js';
import { starteOfflineBetrieb, frageVersion } from './kern/aktualisierung.js';
import { bildschirmAnLassen } from './kern/bildschirm.js';
import { speicher } from './kern/speicher.js';
import { erstelleAnmeldung } from './kern/anmeldung.js';
import { erstelleServer } from './kern/server.js';
import { erstelleSync } from './kern/sync.js';
import { erstelleAusloeser } from './kern/ausloeser.js';
import { erstelleAbgleichBereich } from './kern/abgleich.js';

// Abgleich zwischen den Handys (Etappe 2): Anmeldung und Status in der versteckten Verwaltung
// (langes Drücken auf die Versionsnummer), abgeglichen wird beim Start, bei Rückkehr in die App, wenn das Netz wieder da ist und kurz nach dem Speichern.
const anmeldung = erstelleAnmeldung({ speicher });
const server = erstelleServer({ anmeldung });
const sync = erstelleSync({ speicher, server });
const abgleich = erstelleAbgleichBereich({
  speicher,
  anmeldung,
  server,
  abgleichen: () => ausloeser.jetzt(),
  nachWiederherstellen: datenAktualisiert,
});
const ausloeser = erstelleAusloeser({
  sync,
  bereit: abgleich.bereit,
  nachAbgleich(bericht) {
    if (bericht.heruntergeladen > 0 || bericht.kopien > 0) datenAktualisiert();
    abgleich.nachAbgleich(bericht);
  },
});

zeigeTeigrechner(document.getElementById('inhalt'));
abgleich.verbindeVerwaltung(
  document.getElementById('versionszeile'), document.getElementById('verwaltung'), document.getElementById('punkt'),
);
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
// Langes Drücken darauf öffnet die versteckte Verwaltung (Anmelden, Sichern, Wiederherstellen, Abmelden, Verwalter-Handy an/aus).
// Der kleine Punkt daneben erscheint nur auf dem Verwalter-Handy, wenn dort etwas nachzusehen ist.
frageVersion().then((version) => {
  if (version) document.getElementById('version').textContent = `Version ${version}`;
});
