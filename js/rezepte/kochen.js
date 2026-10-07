// kochen.js – Oberfläche „Kochen“: Rezeptliste und Rezeptansicht.
// Zwei Seiten: die Liste (Kategorien, A–Z, Favoriten, Suche) und ein Rezept mit Portionen,
// Zutaten, Schritten (mit den Mengen direkt dabei, abhakbar), Status und Notiz.
// Gerechnet wird hier nichts – skaliert wird in rechner.js, geordnet in liste.js.
// Gespeichert wird nur über rezept.js (Status, Notiz) bzw. speicher.js.
//
// Portionen und Haken gelten nur, solange die App offen ist (nicht gespeichert).
// Die Seite nutzt eigene `data-k…`-Attribute, damit sie die Klicks der Teig-Oberfläche nicht stört.

import { speicher } from '../kern/speicher.js';
import { text } from '../kern/html.js';
import { alleRezepte, holeRezept, speichereRezept, SAMMLUNG } from './rezept.js';
import { alleZutaten, zutatName } from './katalog.js';
import { skaliere, mengeText } from './rechner.js';
import {
  SUCHE_AB, ordneRezepte, rezeptFavoriten, schalteRezeptFavorit, gesehen, markiereGesehen,
  portionenText, mengenInSchritten, ernaehrungAnzeige,
} from './liste.js';
import { schritteHtml, statusHtml, notizHtml, geraeteHtml, vermerkHtml } from './teile.js';
import { vermerkText } from '../teig/vorlagen.js';

const MAX_PORTIONEN = 99;
const NOTIZ_PAUSE = 500; // ms nach dem letzten Tippen, dann wird die Notiz gespeichert

let wurzel = null;
let zurueckZurStartseite = () => {};
let beiOeffnen = () => {};
let rueckgaengig = () => {};  // zeigt die Leiste „Rückgängig“ (kommt aus ansicht.js)
let seite = 'liste';        // 'liste' | 'rezept'
let rezeptId = null;
let suche = '';
let zutatenOffen = false;   // zu: die Mengen stehen ohnehin in den Schritten, so sind sie gleich im Blick
let notizZeitgeber = null;
const portionenWahl = new Map(); // rezept-id → gewählte Portionen
const erledigt = new Map();      // rezept-id → Set der abgehakten Schritte (Nummern ab 0)

const kochrezepte = () => alleRezepte(speicher, 'kochen');

/** Einmal beim Start: ziel = Element der App, zurueck = zurück zur Startseite, beiOeffnen = Kochen wurde geöffnet,
 *  rueckgaengig(hinweis, f) = Leiste „Rückgängig“ nach dem Löschen. */
export function startKochen(ziel, { zurueck, beiOeffnen: oeffnen, rueckgaengig: leiste }) {
  wurzel = ziel;
  zurueckZurStartseite = zurueck;
  beiOeffnen = oeffnen;
  rueckgaengig = leiste;
  wurzel.addEventListener('click', beiKlick);
  wurzel.addEventListener('input', beiEingabe);
  wurzel.addEventListener('change', beiAenderung);
  wurzel.addEventListener('toggle', (e) => {
    if (e.target.dataset?.kklappe === 'zutaten') zutatenOffen = e.target.open;
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') speichereNotizJetzt();
  });
}

/** Von der Startseite aus öffnen (Kachel „Kochen“ mit `data-k="kochen"`). */
function zeigeKochen() {
  beiOeffnen();
  seite = 'liste';
  rezeptId = null;
  zeichneKochen();
  window.scrollTo(0, 0);
}

/** Neu zeichnen (auch nach neuen Daten vom anderen Handy). */
export function zeichneKochen({ scroll = false } = {}) {
  const rezept = seite === 'rezept' ? holeRezept(speicher, rezeptId) : null;
  if (seite === 'rezept' && rezept?.art !== 'kochen') seite = 'liste'; // z. B. am anderen Handy gelöscht
  const y = window.scrollY;
  wurzel.innerHTML = seite === 'rezept' ? rezeptHtml(rezept) : listeHtml();
  if (scroll) window.scrollTo(0, y); // beim Abhaken usw. bleibt die Seite stehen
}

// ---------- Liste ----------

function listeHtml() {
  const alle = kochrezepte();
  const ordnung = ordneRezepte(alle, { favoriten: rezeptFavoriten(speicher), suche });
  return `
    <header class="seiten-kopf">
      <button type="button" class="knopf-zurueck" data-k="zurueck" aria-label="Zurück">‹</button>
      <h1 class="kopf-titel">Kochen</h1>
    </header>
    ${alle.length >= SUCHE_AB || suche ? `<input class="eingabe suche" type="search" data-ksuche placeholder="Rezept suchen …"
        aria-label="Rezept suchen" autocomplete="off" enterkeyhint="search" value="${text(suche)}">` : ''}
    <div class="vorlagen-gruppen" data-kliste>${listeInnenHtml(ordnung)}</div>`;
}

function listeInnenHtml(ordnung) {
  const sterne = new Set(rezeptFavoriten(speicher));
  const bekannt = gesehen(speicher);
  const zeile = (r) => {
    const stern = sterne.has(r.id);
    const neu = !bekannt.has(r.id);
    const ernaehrung = ernaehrungAnzeige(r);
    const info = [portionenText(r.portionen, r.portionsart), r.status === 'testen' ? 'Noch testen' : null]
      .filter(Boolean).join(' · ');
    // Nach links wischen zeigt den roten Knopf „Löschen“ hinter der Zeile (Geste: teig/wischen.js)
    return `<li class="vorlage-zeile" data-zeile>
        <button type="button" class="vorlage-weg" data-kweg="${text(r.id)}" tabindex="-1">Löschen</button>
        <div class="vorlage-inhalt">
          <button type="button" class="vorlage-oeffnen" data-koeffnen="${text(r.id)}">
            <span class="vorlage-name">${text(r.name)}${ernaehrung
              ? ` <span class="ernaehrung" role="img" aria-label="${text(ernaehrung.text)}">${ernaehrung.zeichen}</span>` : ''}${neu
              ? ' <span class="neu">Neu</span>' : ''}</span>
            <small class="zahl">${text(info)}</small>
            ${r.konflikt ? '<small class="vermerk">Gleichzeitig geändert – bitte ansehen</small>' : ''}
          </button>
          <button type="button" class="stern" data-kstern="${text(r.id)}" aria-pressed="${stern}"
                  aria-label="${text(r.name)} ${stern ? 'aus den Favoriten nehmen' : 'als Favorit markieren'}">${stern ? '★' : '☆'}</button>
        </div>
      </li>`;
  };
  const gruppe = (titel, rezepte) => `
      <section class="gruppe">
        <h2 class="gruppe-titel">${titel}</h2>
        <ul class="vorlagen-liste">${rezepte.map(zeile).join('')}</ul>
      </section>`;
  const teile = [];
  if (ordnung.favoriten.length) teile.push(gruppe('★ Favoriten', ordnung.favoriten));
  for (const g of ordnung.gruppen) teile.push(gruppe(text(g.name), g.rezepte));
  if (!teile.length) teile.push(`<p class="info">${suche.trim() ? 'Kein Rezept gefunden.' : 'Noch keine Rezepte.'}</p>`);
  return teile.join('');
}

/** Nur die Liste neu aufbauen (das Suchfeld bleibt unberührt). */
function zeichneListeNeu() {
  const ziel = wurzel.querySelector('[data-kliste]');
  if (ziel) ziel.innerHTML = listeInnenHtml(ordneRezepte(kochrezepte(), { favoriten: rezeptFavoriten(speicher), suche }));
}

// ---------- Rezept ----------

function rezeptHtml(r) {
  const katalog = alleZutaten(speicher);
  const portionen = portionenWahl.get(r.id) ?? r.portionen;
  const skaliert = skaliere(r, { portionen });
  const haken = erledigt.get(r.id) ?? new Set();
  // Zutaten je Schritt aus dem Rezept; fehlen sie, über den Namen im Schrittext suchen
  const mengen = skaliert.schritte
    ? skaliert.schritte.map((je) => je.map((m) => ({ ...m, name: zutatName(katalog, m.zutat) })))
    : mengenInSchritten(r.schritte, skaliert.zutaten, katalog);
  const stern = rezeptFavoriten(speicher).includes(r.id);
  const vermerk = vermerkText(r, alleRezepte(speicher));
  const geaendert = Math.abs(portionen - r.portionen) > 0.005;
  const art = r.portionsart;
  const ernaehrung = ernaehrungAnzeige(r);

  const zutatenZeilen = skaliert.zutaten.map((z) => `
      <li class="zutat">
        <span class="zahl zutat-menge ${z.menge === null ? 'leise' : ''}">${text(mengeText(z.menge, z.einheit))}</span>
        <span>${text(zutatName(katalog, z.zutat))}</span>
      </li>`).join('');

  return `
    <header class="seiten-kopf">
      <button type="button" class="knopf-zurueck" data-k="zurueck" aria-label="Zurück">‹</button>
      <h1 class="kopf-titel">${text(r.name)}</h1>
      <button type="button" class="stern" data-kstern="${text(r.id)}" aria-pressed="${stern}"
              aria-label="${stern ? 'Aus den Favoriten nehmen' : 'Als Favorit markieren'}">${stern ? '★' : '☆'}</button>
    </header>
    ${vermerkHtml(vermerk, 'k')}
    <section class="karte" aria-label="Portionen und Status">
      <div class="portionen" role="group" aria-label="Portionen">
        <button type="button" class="knopf portionen-knopf" data-k="minus" aria-label="Eine Portion weniger" ${portionen <= 1 ? 'disabled' : ''}>−</button>
        <div class="portionen-wert" aria-live="polite">
          <strong class="zahl">${text(portionenText(portionen, art))}</strong>
          ${geaendert ? `<small class="leise">Im Rezept: ${text(portionenText(r.portionen, art))}</small>` : ''}
        </div>
        <button type="button" class="knopf portionen-knopf" data-k="plus" aria-label="Eine Portion mehr" ${portionen >= MAX_PORTIONEN ? 'disabled' : ''}>+</button>
      </div>
      ${statusHtml(r.status, 'k')}
    </section>
    ${notizHtml(r.notiz, 'k')}
    ${ernaehrung ? `<p class="ernaehrung-zeile"><span aria-hidden="true">${ernaehrung.zeichen}</span> ${text(ernaehrung.text)}</p>` : ''}
    ${geraeteHtml(r)}
    <details class="klappe" data-kklappe="zutaten" ${zutatenOffen ? 'open' : ''}>
      <summary>Zutaten (${r.zutaten.length})</summary>
      <div class="klappe-inhalt"><ul class="zutaten-liste">${zutatenZeilen || '<li class="leise">Keine Zutaten.</li>'}</ul></div>
    </details>
    ${schritteHtml(r, { mengen, haken, p: 'k' })}`;
}

function oeffneRezept(id) {
  seite = 'rezept';
  rezeptId = id;
  markiereGesehen(speicher, id);
  zeichneKochen();
  window.scrollTo(0, 0);
}

function aendereAnzahl(schritt) {
  const r = holeRezept(speicher, rezeptId);
  if (!r) return;
  const jetzt = portionenWahl.get(r.id) ?? r.portionen;
  const neu = Math.min(MAX_PORTIONEN, Math.max(1, jetzt + schritt));
  if (neu === r.portionen) portionenWahl.delete(r.id);
  else portionenWahl.set(r.id, neu);
  zeichneKochen({ scroll: true });
}

function setzeStatus(status) {
  const r = holeRezept(speicher, rezeptId);
  if (!r || r.status === status) return;
  speichereNotizJetzt(); // eine gerade getippte Notiz nicht verlieren
  const frisch = holeRezept(speicher, rezeptId);
  if (frisch) speichereRezept(speicher, { ...frisch, status });
  zeichneKochen({ scroll: true });
}

function schalteSchritt(index) {
  const haken = erledigt.get(rezeptId) ?? new Set();
  if (haken.has(index)) haken.delete(index);
  else haken.add(index);
  erledigt.set(rezeptId, haken);
  zeichneKochen({ scroll: true });
  // Der neue aktuelle Schritt soll im Blick bleiben (nur scrollen, wenn er zu nah am Rand ist)
  const jetzt = wurzel.querySelector('.schritt.jetzt');
  if (jetzt) {
    const kante = jetzt.getBoundingClientRect();
    if (kante.top < 90 || kante.bottom > window.innerHeight - 90) jetzt.scrollIntoView({ block: 'center' });
  }
}

// ---------- Notiz (wird kurz nach dem Tippen gespeichert) ----------

function speichereNotizJetzt() {
  clearTimeout(notizZeitgeber);
  notizZeitgeber = null;
  const feld = wurzel?.querySelector('[data-knotiz]');
  if (!feld || seite !== 'rezept') return;
  const r = holeRezept(speicher, rezeptId);
  if (r && r.notiz !== feld.value.trim()) speichereRezept(speicher, { ...r, notiz: feld.value });
}

function beiEingabe(ereignis) {
  const ziel = ereignis.target;
  if (ziel.dataset.ksuche !== undefined) {
    suche = ziel.value;
    return zeichneListeNeu();
  }
  if (ziel.dataset.knotiz !== undefined) {
    clearTimeout(notizZeitgeber);
    notizZeitgeber = setTimeout(speichereNotizJetzt, NOTIZ_PAUSE);
  }
}

function beiAenderung(ereignis) {
  if (ereignis.target.dataset.knotiz !== undefined) speichereNotizJetzt();
}

// ---------- Klicks ----------

function beiKlick(ereignis) {
  const ziel = ereignis.target;
  const oeffnen = ziel.closest('[data-koeffnen]');
  if (oeffnen) return oeffneRezept(oeffnen.dataset.koeffnen);
  const stern = ziel.closest('[data-kstern]');
  if (stern) {
    schalteRezeptFavorit(speicher, stern.dataset.kstern);
    return seite === 'rezept' ? zeichneKochen({ scroll: true }) : zeichneListeNeu();
  }
  const weg = ziel.closest('[data-kweg]');
  if (weg) return entferne(weg.dataset.kweg);
  const schritt = ziel.closest('[data-kschritt]');
  if (schritt) return schalteSchritt(Number(schritt.dataset.kschritt));
  const status = ziel.closest('[data-kstatus]');
  if (status) return setzeStatus(status.dataset.kstatus);

  const aktion = ziel.closest('[data-k]')?.dataset.k;
  if (aktion === 'kochen') zeigeKochen();
  else if (aktion === 'zurueck') zurueck();
  else if (aktion === 'plus') aendereAnzahl(1);
  else if (aktion === 'minus') aendereAnzahl(-1);
  else if (aktion === 'haken-weg') {
    erledigt.delete(rezeptId);
    zeichneKochen({ scroll: true });
  } else if (aktion === 'behalten') behalte();
  else if (aktion === 'loeschen') loesche();
}

function zurueck() {
  if (seite === 'rezept') {
    speichereNotizJetzt();
    seite = 'liste';
    rezeptId = null;
    zeichneKochen();
    return window.scrollTo(0, 0);
  }
  zurueckZurStartseite();
}

/** Rezept per Wischen löschen – ohne Nachfrage, dafür mit „Rückgängig“ (der alte Inhalt kommt als neue Änderung zurück). */
function entferne(id) {
  const rezept = holeRezept(speicher, id);
  const alt = speicher.hole(SAMMLUNG, id);
  if (!rezept || !alt || !speicher.loesche(SAMMLUNG, id)) return;
  zeichneListeNeu();
  rueckgaengig(`„${rezept.name}“ gelöscht`, () => {
    speicher.speichere(SAMMLUNG, alt);
    zeichneListeNeu();
  });
}

/** Konflikt-Kopie behalten: Speichern entfernt den Vermerk. */
function behalte() {
  speichereNotizJetzt();
  const r = holeRezept(speicher, rezeptId);
  if (r) speichereRezept(speicher, r);
  zeichneKochen({ scroll: true });
}

/** Konflikt-Kopie löschen (die andere Fassung bleibt). */
function loesche() {
  clearTimeout(notizZeitgeber);
  speicher.loesche(SAMMLUNG, rezeptId);
  seite = 'liste';
  rezeptId = null;
  zeichneKochen();
  window.scrollTo(0, 0);
}
