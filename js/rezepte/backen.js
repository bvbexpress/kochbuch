// backen.js – Rezept-Teil eines Back-Rezepts (Etappe 3, D). Das Back-Rezept öffnet im Rechner
// (teig/ansicht.js: Menge, Teig, Klappen); darunter steht dieser Teil: weitere Zutaten (Belag …,
// skalieren mit dem Mehl), Status, Notiz, Geräte und die Schritte zum Abhaken.
// Gerechnet wird in rechner.js, gespeichert über rezept.js. Haken gelten nur, solange die App offen ist.
// Eigene `data-b…`-Attribute (siehe teile.js), damit sich Rechner und Kochen nicht gestört fühlen.

import { speicher } from '../kern/speicher.js';
import { text } from '../kern/html.js';
import { holeRezept, speichereRezept } from './rezept.js';
import { alleZutaten, zutatName } from './katalog.js';
import { skaliere, mengeText } from './rechner.js';
import { schritteHtml, statusHtml, notizHtml, geraeteHtml } from './teile.js';

const NOTIZ_PAUSE = 500; // ms nach dem letzten Tippen, dann wird die Notiz gespeichert

let wurzel = null;
let neuZeichnen = () => {};
let offen = null;               // id des gerade gezeigten Back-Rezepts
let notizZeitgeber = null;
const erledigt = new Map();     // rezept-id → Set der abgehakten Schritte

/** Einmal beim Start. neuZeichnen = Rechner neu zeichnen, ohne dass die Seite springt. */
export function startBacken(ziel, { neuZeichnen: zeichnen }) {
  wurzel = ziel;
  neuZeichnen = zeichnen;
  wurzel.addEventListener('click', beiKlick);
  wurzel.addEventListener('input', (e) => {
    if (e.target.dataset?.bnotiz === undefined) return;
    clearTimeout(notizZeitgeber);
    notizZeitgeber = setTimeout(speichereNotizJetzt, NOTIZ_PAUSE);
  });
  wurzel.addEventListener('change', (e) => {
    if (e.target.dataset?.bnotiz !== undefined) speichereNotizJetzt();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') speichereNotizJetzt();
  });
}

/** HTML des Rezept-Teils; r = gespeichertes Back-Rezept (holeRezept). */
export function backenTeilHtml(r) {
  offen = r.id;
  const katalog = alleZutaten(speicher);
  const zutaten = r.zutaten.map((z, i) => `
      <li class="zutat">
        <output class="zahl zutat-menge" data-ausgabe="bz-${i}"></output>
        <span>${text(zutatName(katalog, z.zutat))}</span>
      </li>`).join('');
  return `
    ${zutaten ? `<section class="karte" aria-label="Weitere Zutaten">
        <h2 class="karte-titel">Weitere Zutaten</h2>
        <ul class="zutaten-liste">${zutaten}</ul>
      </section>` : ''}
    <section class="karte" aria-label="Status">${statusHtml(r.status, 'b')}</section>
    ${notizHtml(r.notiz, 'b')}
    ${geraeteHtml(r)}
    ${schritteHtml(r, { haken: erledigt.get(r.id) ?? new Set(), p: 'b' })}`;
}

/** Weitere Zutaten auf das eingestellte Mehl umrechnen (bei jedem Tastendruck). */
export function aktualisiereBacken(r, mehl) {
  if (!r?.zutaten.length) return;
  skaliere(r, { mehl }).zutaten.forEach((z, i) => {
    const el = wurzel.querySelector(`[data-ausgabe="bz-${i}"]`);
    if (el) {
      el.textContent = mengeText(z.menge, z.einheit);
      el.classList.toggle('leise', z.menge === null);
    }
  });
}

/** Gerade getippte Notiz sofort speichern (vor dem Verlassen des Rezepts, vor anderem Speichern). */
export function speichereNotizJetzt() {
  clearTimeout(notizZeitgeber);
  notizZeitgeber = null;
  const feld = wurzel?.querySelector('[data-bnotiz]');
  if (!feld || !offen) return;
  const r = holeRezept(speicher, offen);
  if (r && r.notiz !== feld.value.trim()) speichereRezept(speicher, { ...r, notiz: feld.value });
}

function beiKlick(ereignis) {
  const ziel = ereignis.target;
  const schritt = ziel.closest('[data-bschritt]');
  if (schritt) return schalteSchritt(Number(schritt.dataset.bschritt));
  const status = ziel.closest('[data-bstatus]');
  if (status) return setzeStatus(status.dataset.bstatus);
  if (ziel.closest('[data-b]')?.dataset.b === 'haken-weg') {
    erledigt.delete(offen);
    neuZeichnen();
  }
}

function schalteSchritt(index) {
  const haken = erledigt.get(offen) ?? new Set();
  if (haken.has(index)) haken.delete(index);
  else haken.add(index);
  erledigt.set(offen, haken);
  neuZeichnen();
  // Der neue aktuelle Schritt soll im Blick bleiben (nur scrollen, wenn er zu nah am Rand ist)
  const jetzt = wurzel.querySelector('.schritt.jetzt');
  if (jetzt) {
    const kante = jetzt.getBoundingClientRect();
    if (kante.top < 90 || kante.bottom > window.innerHeight - 90) jetzt.scrollIntoView({ block: 'center' });
  }
}

function setzeStatus(status) {
  speichereNotizJetzt(); // eine gerade getippte Notiz nicht verlieren
  const r = holeRezept(speicher, offen);
  if (!r || r.status === status) return;
  speichereRezept(speicher, { ...r, status });
  neuZeichnen();
}
