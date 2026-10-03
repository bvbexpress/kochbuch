// app.js – Startpunkt der App.
// Später kommen hier weitere Bereiche (Rezepte, Vorrat) und eine Navigation dazu.

import { zeigeTeigrechner } from './teig/ansicht.js';
import { starteOfflineBetrieb, frageVersion } from './kern/aktualisierung.js';
import { bildschirmAnLassen } from './kern/bildschirm.js';
import { speicher } from './kern/speicher.js';
import { erstelleAnmeldung } from './kern/anmeldung.js';
import { erstelleServer } from './kern/server.js';
import { erstelleAbgleichBereich } from './kern/abgleich.js';

// Abgleich zwischen den Handys (Etappe 2): Anmeldung und Status unten auf der Startseite
const anmeldung = erstelleAnmeldung({ speicher });
const server = erstelleServer({ anmeldung });
const abgleich = erstelleAbgleichBereich({ speicher, anmeldung, server });

zeigeTeigrechner(document.getElementById('inhalt'), { abgleich });
abgleich.start();
bildschirmAnLassen();

starteOfflineBetrieb((aktualisieren) => {
  const leiste = document.getElementById('update');
  leiste.querySelector('button').onclick = aktualisieren;
  leiste.hidden = false;
});

// Kleine Versionsanzeige ganz unten – so lässt sich prüfen, ob beide Handys gleich aktuell sind
frageVersion().then((version) => {
  if (version) document.getElementById('version').textContent = `Version ${version}`;
});
