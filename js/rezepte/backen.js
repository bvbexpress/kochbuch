// backen.js – Rezept-Teil eines Back-Rezepts (Etappe 3, D; schlanke Ansicht „1a“). Ein Back-Rezept öffnet
// kompakt (teig/ansicht.js: Menge, Status, dann diese Teile): Schritte zum Abhaken mit den Teigmengen
// des Schritts (`schrittteig`, live aus dem eingestellten Teig), die Zutatenliste (Teig und weitere
// Zutaten, skalieren mit dem Mehl) und die Notiz-Eingabe. Der volle Teigrechner ist ein Knopf weiter.
// Gerechnet wird in rechner.js, gespeichert über rezept.js. Haken gelten nur, solange die App offen ist.
// Eigene `data-b…`-Attribute (siehe teile.js), damit sich Rechner und Kochen nicht gestört fühlen.

import { speicher } from '../kern/speicher.js';
import { text } from '../kern/html.js';
import { holeRezept, speichereRezept } from './rezept.js';
import { alleZutaten, zutatName } from './katalog.js';
import { skaliere, mengeText } from './rechner.js';
import { schritteHtml } from './teile.js';
import { teigInSchritten } from '../teig/rechner.js';
import { formatGramm, formatGrammFein } from '../kern/zahlen.js';

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

/** Zeilen des Teigs für die Zutatenliste: [{ name, ausgabe }] – nur, was im Teig vorkommt. `ausgabe` = Name des Live-Feldes. */
export function teigZutaten(teig) {
  const zeilen = teig.mehlsorten.map((s, i) => ({ name: s.name, ausgabe: `mehlsorte-${i}` }));
  const wenn = (wert, name, ausgabe) => { if (wert > 0) zeilen.push({ name, ausgabe }); };
  wenn(teig.hydration, 'Wasser', 'wasser');
  wenn(teig.starter, 'Starter', 'starter');
  wenn(teig.salz, 'Salz', 'salz');
  wenn(teig.oel, 'Öl', 'oel');
  wenn(teig.hefe, teig.hefeArt === 'trocken' ? 'Trockenhefe' : 'Frischhefe', 'hefe');
  teig.zusaetze.forEach((z, i) => zeilen.push({ name: z.name, ausgabe: `zusatz-${i}` }));
  teig.saaten.forEach((s, i) => zeilen.push({ name: s.name, ausgabe: `saat-${i}` }));
  if (teig.saaten.length) zeilen.push({ name: 'Quellwasser', ausgabe: 'quellwasser' });
  return zeilen;
}

/** Inhalt der eingeklappten Zutatenliste (Teig, dann weitere Zutaten) und ihre Anzahl; die Zahlen trägt `aktualisiereBacken` ein. */
export function backenZutatenHtml(r, teig) {
  const katalog = alleZutaten(speicher);
  const zeile = (name, ausgabe) => `
      <li class="zutat">
        <output class="zahl zutat-menge" data-ausgabe="${text(ausgabe)}"></output>
        <span>${text(name)}</span>
      </li>`;
  const teigZeilen = teigZutaten(teig);
  const weitere = r.zutaten.map((z, i) => zeile(zutatName(katalog, z.zutat), `bz-${i}`));
  return {
    anzahl: teigZeilen.length + weitere.length,
    html: `<ul class="zutaten-liste">${teigZeilen.map((z) => zeile(z.name, z.ausgabe)).join('')}${weitere.join('')}</ul>`,
  };
}

/** Schritte zum Abhaken mit den Teigmengen je Schritt; r = gespeichertes Back-Rezept, teig = der eingestellte Teig. */
export function backenSchritteHtml(r, teig) {
  offen = r.id;
  if (!r.schritte.length) return '';
  return schritteHtml(r, { mengen: teigChips(r, teig), haken: erledigt.get(r.id) ?? new Set(), p: 'b' });
}

/** Teigmengen je Schritt als Chips ohne Zahl (die trägt `aktualisiereBacken` ein); null ohne `schrittteig`. */
function teigChips(r, teig) {
  return teigInSchritten(r.schrittteig, teig)?.map((je, i) => je.map((m, j) => ({ name: m.name, ausgabe: `bs-${i}-${j}` }))) ?? null;
}

/**
 * Bei jedem Tastendruck: Teigmengen der Schritte aus dem eingestellten Teig (e = Ergebnis von `berechne`)
 * und weitere Zutaten auf das eingestellte Mehl umrechnen.
 */
export function aktualisiereBacken(r, mehl, teig, e) {
  if (!r) return;
  teigInSchritten(r.schrittteig, teig, e)?.forEach((je, i) => je.forEach((m, j) => {
    const el = wurzel.querySelector(`[data-ausgabe="bs-${i}-${j}"]`);
    // wie im Rechner: ganze Gramm, Hefe unter 10 g mit einer Nachkommastelle
    if (el) el.textContent = `${m.gramm < 10 && m.name.endsWith('hefe') ? formatGrammFein(m.gramm) : formatGramm(m.gramm)} g`;
  }));
  if (!r.zutaten.length) return;
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
