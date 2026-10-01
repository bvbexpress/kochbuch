// app.js – Startpunkt der App.
// Später kommen hier weitere Bereiche (Rezepte, Vorrat) und eine Navigation dazu.

import { zeigeTeigrechner } from './teig/ansicht.js';
import { starteOfflineBetrieb, frageVersion } from './kern/aktualisierung.js';
import { bildschirmAnLassen } from './kern/bildschirm.js';

zeigeTeigrechner(document.getElementById('inhalt'));
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
