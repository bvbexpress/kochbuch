// ansicht.js – Oberfläche des Teigrechners.
// Zwei Ansichten: die Vorlagenliste (Startseite) und der Rechner für eine Vorlage.
// Liest Eingaben, ruft den Rechner auf und schreibt die Grammzahlen in die Seite.
// Gerechnet wird hier nichts – das macht ausschließlich rechner.js.
// Gespeichert wird hier nichts direkt – das läuft über vorlagen.js bzw. speicher.js.

import {
  berechne,
  auffrischen,
  gesamtmehlAusMehl,
  hefeUmrechnen,
  hydrationNachMehlwechsel,
  mehlsortenMitAnteil,
  mehlsortenMitGramm,
  mehlFuerTeiglinge,
  quellwasserNachSaatwechsel,
  mehlHinweise,
} from './rechner.js';
import {
  alleVorlagen,
  ladeVorlage,
  speichereEigeneVorlage,
  loescheEigeneVorlage,
  holeEigeneVorlage,
  stelleEigeneVorlageWiederHer,
  istGueltigerTeig,
  normalisiereTeig,
  eigeneVorlagen,
  pruefeUebernahme,
  uebernehmeVorlagen,
  bereinigeTeiglinge,
  bereinigeKategorie,
  modusVon,
  ordneVorlagen,
  favoriten,
  ausgeblendet,
  schalteFavorit,
  blendeAus,
  KATEGORIEN,
  OHNE_KATEGORIE,
  MODI,
  SUCHE_AB,
  STANDARD_TEIGLINGE,
  vorbelegung,
  neueVorlage,
  vermerkText,
  entferneVermerk,
} from './vorlagen.js';
import { erstelleLink, liesLink, hatTeilenCode } from './teilen.js';
import {
  mehle,
  saaten,
  zusaetze,
  werteVon,
  artVon,
  STANDARD_WASSER,
  STANDARD_VERHAELTNIS,
  STANDARD_ZUSATZ_WASSER,
} from './zutaten.js';
import { suchfeldHtml, vorlagenListeHtml, zusammenfassung } from './startseite.js';
import { erstelleWischen } from './wischen.js';
import { speicher } from '../kern/speicher.js';
import { leseZahl, formatGramm, formatGrammFein, formatProzent } from '../kern/zahlen.js';
import { text } from '../kern/html.js';
import { startKochen, kochenEinstiegHtml, zeichneKochen } from '../rezepte/kochen.js';

const HINWEISE = {
  'starter-zu-viel': 'Mehr Starter als Mehl – bitte den Starter-Anteil verringern.',
  'hydration-zu-niedrig':
    'Die Hydration ist niedriger als das Wasser, das Starter und Zusatzzutaten mitbringen – Hydration erhöhen.',
  'mehlanteile-nicht-100': 'Die Mehlanteile ergeben zusammen nicht 100 %.',
  hafer: 'Hafer nur als Beimischung: Er hat kein Klebereiweiß, der Teig geht damit schlechter auf.',
  'hafer-viel': 'Viel Hafer: Ab 20 % geht der Teig kaum noch auf. Hafer nur als Beimischung verwenden.',
  'roggen-ohne-sauerteig':
    'Ab 50 % Roggen braucht der Teig Säure (Sauerteig), sonst wird die Krume klitschig.',
};

// Geräte-Einstellungen (werden nicht synchronisiert)
const STAND = 'teig.stand';            // der zuletzt offene Teig
const MEHL_EINHEIT = 'teig.mehlEinheit'; // Mehlanteile in 'prozent' oder 'gramm'
const TEIGLINGE_ALT = 'teig.teiglinge'; // bis Schritt 11: Teiglinge-Modus fürs ganze Gerät (nur noch gelesen)
const AUFFRISCHUNG = 'teig.auffrischung'; // Starter-Auffrischung: { bedarf, rest, verhaeltnis }
const VERHAELTNISSE = [[1, 1, 1], [1, 1.5, 1.5], [1, 2.5, 2.5]]; // Schnellwahl Anstellgut:Mehl:Wasser
const STANDARD_REST = 20;             // g Starter für den Kühlschrank
const NEUER_ZUSATZ = 10;              // % vom Mehl für eine neu gewählte Zusatzzutat
const EIGENE = '__eigene';             // Auswahl-Eintrag „Eigene Sorte …“

let wurzel;   // das HTML-Element, in dem der Teigrechner steht
let ansicht = 'liste'; // 'liste' (Startseite), 'rechner' oder 'kochen' (Rezepte, rezepte/kochen.js)
// { vorlageId, teig, mehl, modus, teiglinge, geaendert, anpassung } – mehl = zugegebenes Mehl.
// geaendert = die Vorlage selbst wurde verändert (nicht nur die Menge).
let zustand = null;
let katalog;  // { mehle, saaten, zusaetze, wasserVon, verhaeltnisVon, art } – aus den Einstellungen
let suche = ''; // Suchtext der Vorlagenliste
let speicherKarte = null; // offene Karte „Speichern“: { name, kategorie, zurueck }
let neuKarte = null; // offene Karte „Neue Vorlage“: { name, kategorie, modus, basis } – basis = id oder ''
const offeneKlappen = new Set(); // welche einklappbaren Bereiche offen sind
let paket = null;   // erhaltene Vorlagen aus einem Link, wartet auf „Übernehmen“: { vorlagen, verworfen, link }
let aufHinweis = null; // einmaliger Hinweis in der Starter-Auffrischung
let meldung = null; // einmalige Rückmeldung (wird beim nächsten Zeichnen angezeigt und gelöscht)
let wischen = null; // Wisch-Geste der Vorlagenliste (wischen.js)
let nachholen = false; // Daten vom Server kamen während eines Wischens an
let rueckgaengig = null; // Leiste „Rückgängig“: { leiste, zeitgeber, f }
let abgleich = null; // Bereich „Abgleich“ (kern/abgleich.js), unten auf der Startseite

/** abgleich: optional, aus `erstelleAbgleichBereich` (ohne ihn fehlt die Klappe). */
export function zeigeTeigrechner(ziel, { abgleich: bereich = null } = {}) {
  wurzel = ziel;
  abgleich = bereich;
  ladeKatalog();
  // Beim Öffnen direkt die zuletzt benutzte Vorlage, sonst die Liste
  zustand = letzterStand();
  ansicht = zustand ? 'rechner' : 'liste';
  zeichne();
  pruefeAdresse();
  window.addEventListener('hashchange', pruefeAdresse);

  // Ein Zuhörer für alle Felder statt einer pro Feld ("Event-Delegation")
  wurzel.addEventListener('input', beiEingabe);
  wurzel.addEventListener('change', beiAuswahl);
  wurzel.addEventListener('click', beiKlick);
  // Kochen (Etappe 3): eigene Oberfläche in rezepte/kochen.js, hier nur Einstieg und Rückweg
  startKochen(wurzel, { zurueck: () => zeige('liste'), beiOeffnen: () => { ansicht = 'kochen'; } });
  wischen = erstelleWischen(wurzel, {
    beiEnde() {
      if (nachholen) datenAktualisiert();
    },
  });
  // Der Abgleich-Bereich zeichnet nur die Startseite neu (z. B. wenn der Status geladen ist)
  abgleich?.verbinde(wurzel, () => {
    if (ansicht === 'liste' && !tipptGerade() && !wischen?.zieht()) zeichne();
  });
  // Offene Klappen merken, damit sie nach dem Neuzeichnen offen bleiben
  wurzel.addEventListener('toggle', (e) => {
    const name = e.target.dataset?.klappe;
    if (!name) return;
    if (e.target.open) offeneKlappen.add(name);
    else offeneKlappen.delete(name);
  }, true);
  // Beim Antippen eines Feldes den Inhalt markieren → einfach drübertippen
  wurzel.addEventListener('focusin', (e) => {
    if (e.target.matches('input')) e.target.select();
  });
}

/** Steht der Cursor gerade in einem Feld? Dann nicht neu zeichnen (sonst ist das Getippte weg). */
function tipptGerade() {
  const feld = document.activeElement;
  return Boolean(feld && wurzel.contains(feld) && feld.matches('input, textarea, select'));
}

/**
 * Nach einem Abgleich mit neuen Daten vom anderen Handy: Liste und Werte neu laden.
 * Im Rechner wird die offene Vorlage nur aufgefrischt, wenn hier nichts an ihr verändert ist;
 * Mehlmenge und Teiglinge bleiben, wie sie gerade eingestellt sind.
 */
export function datenAktualisiert() {
  if (!wurzel || tipptGerade()) return;
  nachholen = Boolean(wischen?.zieht()); // mitten im Wischen nicht neu zeichnen, danach nachholen
  if (nachholen) return;
  ladeKatalog();
  if (ansicht === 'rechner' && zustand && !zustand.geaendert && !speicherKarte) {
    const vorlage = aktuelleVorlage();
    const neu = vorlage && vorlageZustand(vorlage);
    if (neu && (neu.modus !== zustand.modus || JSON.stringify(neu.teig) !== JSON.stringify(zustand.teig))) {
      zustand = { ...neu, mehl: zustand.mehl, teiglinge: zustand.teiglinge };
      merkeStand();
    }
  }
  zeichne();
}

function ladeKatalog() {
  const mehlListe = mehle.alle(speicher);
  const saatListe = saaten.alle(speicher);
  katalog = {
    mehle: mehlListe,
    saaten: saatListe,
    zusaetze: zusaetze.alle(speicher),
    wasserVon: werteVon(mehlListe, 'wasser', STANDARD_WASSER),
    verhaeltnisVon: werteVon(saatListe, 'verhaeltnis', STANDARD_VERHAELTNIS),
    art: artVon(mehlListe),
  };
}

function vorlageZustand(vorlage) {
  const { teig, mehl, teiglinge: angabe, modus } = ladeVorlage(vorlage);
  // Ohne Teiglinge-Angabe bleiben die zuletzt genutzten Werte fürs Umschalten erhalten
  const teiglinge = angabe ?? zustand?.teiglinge ?? { ...STANDARD_TEIGLINGE };
  return { vorlageId: vorlage.id, teig, mehl, modus, teiglinge, geaendert: false, anpassung: neueAnpassung() };
}

/** Summe der automatischen Anpassungen seit dem Laden (für den Hinweis). */
function neueAnpassung() {
  return { wasser: 0, quellwasser: 0 };
}

function letzterStand() {
  const stand = speicher.einstellung(STAND);
  if (!stand || !istGueltigerTeig(stand.teig) || typeof stand.mehl !== 'number') return null;
  // Älterer Stand: Modus und Teiglinge-Werte waren eine Geräte-Einstellung
  const alt = speicher.einstellung(TEIGLINGE_ALT) ?? {};
  return {
    vorlageId: typeof stand.vorlageId === 'string' ? stand.vorlageId : null,
    teig: normalisiereTeig(stand.teig),
    mehl: stand.mehl,
    modus: MODI.includes(stand.modus) ? stand.modus : alt.aktiv === true ? 'teiglinge' : 'mehl',
    teiglinge: bereinigeTeiglinge(stand.teiglinge) ?? bereinigeTeiglinge(alt) ?? { ...STANDARD_TEIGLINGE },
    geaendert: stand.geaendert === true,
    anpassung: stand.anpassung ?? neueAnpassung(),
  };
}

function mehlEinheit() {
  return speicher.einstellung(MEHL_EINHEIT) === 'gramm' ? 'gramm' : 'prozent';
}

/** Einstellung als Zahl ≥ 0 lesen, sonst Ersatzwert (gespeicherte Daten immer prüfen). */
function zahlOder(wert, ersatz) {
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? wert : ersatz;
}

const imTeiglingeModus = () => zustand.modus === 'teiglinge';

function auffrischung() {
  const a = speicher.einstellung(AUFFRISCHUNG) ?? {};
  const v = Array.isArray(a.verhaeltnis) && a.verhaeltnis.length === 3
    ? a.verhaeltnis.map((x) => zahlOder(x, 1)) : VERHAELTNISSE[0];
  return { bedarf: zahlOder(a.bedarf, 50), rest: zahlOder(a.rest, STANDARD_REST), verhaeltnis: v };
}

function setzeAuffrischung(aenderung) {
  speicher.setzeEinstellung(AUFFRISCHUNG, { ...auffrischung(), ...aenderung });
}

function merkeStand() {
  speicher.setzeEinstellung(STAND, zustand);
}

function aktuelleVorlage() {
  if (!zustand) return null;
  return alleVorlagen(speicher).find((v) => v.id === zustand.vorlageId) ?? null;
}

/** Wechselt zwischen Liste und Rechner und springt nach oben. */
function zeige(neu) {
  ansicht = neu;
  if (neu === 'liste') speicherKarte = null;
  if (neu === 'rechner') neuKarte = null;
  zeichne();
  window.scrollTo(0, 0);
}

function zeichne() {
  if (ansicht === 'kochen') zeichneKochen({ scroll: true });
  else if (ansicht === 'rechner' && zustand) zeichneRechner();
  else zeichneListe();
}

function meldungHtml() {
  const hinweis = meldung;
  meldung = null;
  return hinweis ? `<p class="karte hinweis-ok" role="status">${text(hinweis)}</p>` : '';
}

// ---------- Startseite: Vorlagenliste ----------

function zeichneListe() {
  ansicht = 'liste';
  const ordnung = ordnungJetzt();
  wurzel.innerHTML = `
    <header class="seiten-kopf"><h1 class="kopf-titel">Kochbuch</h1></header>
    ${meldungHtml()}
    ${paket ? uebernahmeKarte() : ''}
    ${neuKarte ? neuKarteHtml() : ''}
    ${ordnung.anzahl >= SUCHE_AB || suche ? suchfeldHtml(suche) : ''}
    <div class="vorlagen-gruppen" data-liste>${listeHtml(ordnung)}</div>
    ${neuKarte ? '' : '<button type="button" class="knopf knopf-voll" data-aktion="neu-karte">+ Neue Vorlage</button>'}
    ${neuKarte ? '' : kochenEinstiegHtml()}
    ${teilenKlappe()}
    ${einstellungenKlappe()}
    ${abgleich ? abgleich.html() : ''}`;
}

function ordnungJetzt() {
  return ordneVorlagen(alleVorlagen(speicher), {
    favoriten: favoriten(speicher),
    ausgeblendet: ausgeblendet(speicher),
    suche,
  });
}

function listeHtml(ordnung) {
  return vorlagenListeHtml(ordnung, {
    sterne: new Set(favoriten(speicher)),
    suche,
    ausgeblendetOffen: offeneKlappen.has('ausgeblendet'),
  });
}

/** Nur die Liste neu aufbauen (beim Tippen in der Suche bleibt das Suchfeld unberührt). */
function zeichneListeNeu() {
  const ziel = wurzel.querySelector('[data-liste]');
  if (ziel) ziel.innerHTML = listeHtml(ordnungJetzt());
}

/** Karte „Neue Vorlage“: Name, Kategorie, Modus (vorbelegt nach Kategorie), Ausgangsbasis. */
function neuKarteHtml() {
  const k = neuKarte;
  const kategorien = [...KATEGORIEN, { id: '', name: OHNE_KATEGORIE }]
    .map((x) => `<option value="${x.id}" ${(k.kategorie ?? '') === x.id ? 'selected' : ''}>${text(x.name)}</option>`)
    .join('');
  const basen = alleVorlagen(speicher)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((v) => `<option value="${text(v.id)}" ${k.basis === v.id ? 'selected' : ''}>Kopie von „${text(v.name)}“</option>`)
    .join('');
  const tl = k.modus === 'teiglinge';
  return `<section class="karte speichern" aria-label="Neue Vorlage">
      <h2 class="karte-titel">Neue Vorlage</h2>
      <label class="feld"><span class="feld-name">Name</span>
        <input class="eingabe eingabe-text" data-nk="name" autocomplete="off" maxlength="80" value="${text(k.name)}"></label>
      <label class="feld"><span class="feld-name">Kategorie</span>
        <select class="eingabe auswahl" data-nk="kategorie">${kategorien}</select></label>
      <p class="feld-name">Menge angeben als</p>
      <div class="umschaltgruppe" role="group" aria-label="Menge angeben als">
        <button type="button" class="knopf" data-aktion="nk-modus" data-modus="mehl" aria-pressed="${!tl}">Mehl</button>
        <button type="button" class="knopf" data-aktion="nk-modus" data-modus="teiglinge" aria-pressed="${tl}">Teiglinge</button>
      </div>
      <label class="feld"><span class="feld-name">Ausgangsbasis</span>
        <select class="eingabe auswahl" data-nk="basis">
          <option value="" ${k.basis ? '' : 'selected'}>Leer (Mehl, Wasser, Salz)</option>${basen}
        </select></label>
      <div class="aktionen">
        <button type="button" class="knopf knopf-voll" data-aktion="nk-anlegen">Anlegen und öffnen</button>
        <button type="button" class="knopf knopf-leise" data-aktion="nk-abbrechen">Abbrechen</button>
      </div>
    </section>`;
}

function oeffneNeuKarte() {
  neuKarte = { name: '', kategorie: 'brot', modus: vorbelegung('brot').modus, basis: '' };
  zeichne();
  window.scrollTo(0, 0);
  wurzel.querySelector('[data-nk="name"]')?.focus();
}

/** Neue Vorlage speichern und direkt im Rechner öffnen. */
function legeNeueVorlageAn() {
  const name = neuKarte.name.trim();
  if (!name) {
    window.alert('Bitte einen Namen für die Vorlage eingeben.');
    return wurzel.querySelector('[data-nk="name"]')?.focus();
  }
  const basis = neuKarte.basis ? alleVorlagen(speicher).find((v) => v.id === neuKarte.basis) ?? null : null;
  const gespeichert = speichereEigeneVorlage(speicher, neueVorlage({ ...neuKarte, name, basis }));
  if (!gespeichert) return meldeFehler();
  const vorlage = alleVorlagen(speicher).find((v) => v.id === gespeichert.id);
  ladeUndZeige(vorlage, `„${name}“ angelegt.`);
}

function oeffneVorlage(id) {
  const vorlage = alleVorlagen(speicher).find((v) => v.id === id);
  if (!vorlage) return;
  // Gleiche Vorlage nochmal geöffnet: den aktuellen Stand (z. B. die Menge) behalten
  if (zustand?.vorlageId !== id) {
    zustand = vorlageZustand(vorlage);
    merkeStand();
  }
  zeige('rechner');
}

// ---------- Rechner ----------

function zeichneRechner() {
  const { teig, mehl } = zustand;
  const vorlage = aktuelleVorlage();
  const titel = vorlage ? vorlage.name : 'Eigener Teig';

  const mehrereMehle = teig.mehlsorten.length > 1;
  const mehlZeilen = teig.mehlsorten
    .map((s, i) => zeileNurGramm(s.name, `mehlsorte-${i}`, mehrereMehle ? `mehlanteil-${i}` : ''))
    .join('');

  const quellstueck = teig.saaten.length
    ? `<li class="zeile-titel">Quellstück</li>
       ${teig.saaten.map((s, i) => zeileMitProzent(s.name, '', `saat-${i}`, `saat-${i}`)).join('')}
       ${zeileMitProzent('Quellwasser', 'Vorschlag, änderbar', 'quellwasser', 'quellwasser')}`
    : '';

  const zusatzZeilen = teig.zusaetze.map((z, i) => zeileZusatz(z, i)).join('');

  const trocken = teig.hefeArt === 'trocken';
  const hefeName = trocken ? 'Trockenhefe' : 'Frischhefe';
  const hefeWechsel = trocken ? '⇄ frisch' : '⇄ trocken';

  const menge = imTeiglingeModus()
    ? `<div class="teiglinge-felder">
         ${grossesFeld('Anzahl', 'tl-anzahl', '×')}
         ${grossesFeld('Gewicht je Teigling', 'tl-gewicht', 'g')}
       </div>
       <p class="info">Mehl zum Abwiegen: <output class="zahl" data-ausgabe="mehl-errechnet"></output>
         · Gesamtmehl inkl. Starter: <output class="zahl" data-ausgabe="gesamtmehl"></output></p>`
    : `<label class="feld">
         <span class="feld-name">Mehl</span>
         <span class="mit-einheit">
           <input class="eingabe eingabe-gross" data-feld="mehl"
                  inputmode="decimal" autocomplete="off" value="${Math.round(mehl)}">
           <span class="einheit">g</span>
         </span>
       </label>
       <p class="info">Gesamtmehl inkl. Starter:
         <output class="zahl" data-ausgabe="gesamtmehl"></output></p>`;

  wurzel.innerHTML = `
    <header class="seiten-kopf">
      <button type="button" class="knopf-zurueck" data-aktion="zurueck" aria-label="Zurück zur Vorlagenliste">‹</button>
      <h1 class="kopf-titel">${text(titel)}
        <small class="geaendert" data-ausgabe="geaendert" ${zustand.geaendert ? '' : 'hidden'}>geändert</small></h1>
    </header>
    ${meldungHtml()}
    ${vermerkKarte(vorlage)}
    ${speicherKarte ? speicherKarteHtml(vorlage) : ''}

    <section class="karte">${menge}</section>

    <section class="karte">
      <ul class="zutaten">
        ${mehlZeilen}
        ${zeileMitProzent('Wasser', 'Hydration', 'hydration', 'wasser')}
        ${zeileMitProzent('Starter', '100 % Hydration', 'starter', 'starter')}
        ${zeileMitProzent('Salz', '', 'salz', 'salz')}
        ${zeileMitProzent('Öl', '', 'oel', 'oel')}
        ${zeileMitProzent(hefeName, hefeWechsel, 'hefe', 'hefe', true)}
        ${zusatzZeilen}
        ${quellstueck}
      </ul>
      <p class="summe">
        <span>Teig gesamt</span>
        <output class="zahl" data-ausgabe="teigGesamt"></output>
      </p>
      <p class="info" data-ausgabe="zusatzwasser" hidden></p>
      <p class="info" data-ausgabe="anpassung" hidden></p>
      <p class="hinweis" data-ausgabe="hinweise" role="status" hidden></p>
    </section>

    <button type="button" class="knopf knopf-voll" data-aktion="speichern-karte"
            ${zustand.geaendert && !speicherKarte ? '' : 'hidden'}>Änderungen speichern …</button>

    ${mehlKlappe()}
    ${saatenKlappe()}
    ${zusatzKlappe()}
    ${auffrischKlappe()}
    ${vorlageKlappe(vorlage)}`;

  aktualisiere();
}

/** Vermerk an einer Konflikt-Kopie: direkt an der Vorlage, behalten oder löschen. */
function vermerkKarte(vorlage) {
  const hinweis = vorlage && !vorlage.eingebaut ? vermerkText(vorlage, alleVorlagen(speicher)) : null;
  if (!hinweis) return '';
  return `<section class="karte vermerk-karte" aria-label="Hinweis zu dieser Vorlage">
      <p>${text(hinweis)} Welche brauchst du noch?</p>
      <div class="aktionen">
        <button type="button" class="knopf" data-aktion="vermerk-weg">Diese behalten</button>
        <button type="button" class="knopf knopf-leise" data-aktion="loeschen">Diese löschen</button>
      </div>
    </section>`;
}

/** Großes Zahlenfeld für den Teiglinge-Modus (Anzahl, Gewicht). */
function grossesFeld(name, feld, einheit) {
  return `<label class="feld">
      <span class="feld-name">${name}</span>
      <span class="mit-einheit">
        <input class="eingabe eingabe-gross" data-feld="${feld}" inputmode="decimal"
               autocomplete="off" value="${feldWert(feld)}">
        <span class="einheit">${einheit}</span>
      </span>
    </label>`;
}

function zeileNurGramm(name, ausgabe, zusatzAusgabe = '') {
  const zusatz = zusatzAusgabe ? `<small data-ausgabe="${zusatzAusgabe}"></small>` : '';
  return `<li class="zeile">
      <span class="zeile-name">${text(name)}${zusatz}</span>
      <output class="gramm zahl" data-ausgabe="${ausgabe}"></output>
    </li>`;
}

function zeileMitProzent(name, zusatz, feld, ausgabe, istHefe = false) {
  const wert = feldWert(feld);
  const beschriftung = istHefe
    ? `<button type="button" class="zeile-name umschalter" data-aktion="hefeart">
         ${text(name)}<small>${zusatz}</small></button>`
    : `<label class="zeile-name" for="feld-${feld}">
         ${text(name)}${zusatz ? `<small>${zusatz}</small>` : ''}</label>`;
  return `<li class="zeile">
      ${beschriftung}
      <span class="mit-einheit prozent">
        <input class="eingabe" id="feld-${feld}" data-feld="${feld}"
               inputmode="decimal" autocomplete="off" value="${wert}"
               aria-label="${text(name)} in Prozent">
        <span class="einheit">%</span>
      </span>
      <output class="gramm zahl" data-ausgabe="${ausgabe}"></output>
    </li>`;
}

/** Zeile einer Zusatzzutat; darunter klein, wie viel Wasser sie mitbringt. */
function zeileZusatz(z, i) {
  return `<li class="zeile">
      <label class="zeile-name" for="feld-zusatz-${i}">${text(z.name)}
        <small data-ausgabe="zusatzwasser-${i}"></small></label>
      <span class="mit-einheit prozent">
        <input class="eingabe" id="feld-zusatz-${i}" data-feld="zusatz-${i}"
               inputmode="decimal" autocomplete="off" value="${feldWert(`zusatz-${i}`)}"
               aria-label="${text(z.name)} in Prozent">
        <span class="einheit">%</span>
      </span>
      <output class="gramm zahl" data-ausgabe="zusatz-${i}"></output>
    </li>`;
}

// ---------- Einklappbare Bereiche ----------

function klappe(name, titel, inhalt) {
  return `<details class="klappe" data-klappe="${name}" ${offeneKlappen.has(name) ? 'open' : ''}>
      <summary>${titel}</summary>
      <div class="klappe-inhalt">${inhalt}</div>
    </details>`;
}

/** Auswahlliste; „ausser“ = schon verwendete Sorten, die hier nicht mehr angeboten werden. */
function auswahl({ liste, gewaehlt, ausser, daten, leer, eigeneText, name }) {
  const optionen = liste
    .filter((s) => s.id === gewaehlt || !ausser.has(s.id))
    .map((s) => `<option value="${text(s.id)}" ${s.id === gewaehlt ? 'selected' : ''}>${text(s.name)}</option>`);
  // Sorte, die es nicht mehr gibt (z. B. gelöschtes eigenes Mehl): Namen trotzdem zeigen
  if (gewaehlt !== undefined && !liste.some((s) => s.id === gewaehlt)) {
    optionen.unshift(`<option value="" selected>${text(name ?? '?')}</option>`);
  }
  if (leer) optionen.unshift(`<option value="" selected>${leer}</option>`);
  optionen.push(`<option value="${EIGENE}">${eigeneText}</option>`);
  return `<select class="eingabe auswahl" ${daten}>${optionen.join('')}</select>`;
}

function mehlKlappe() {
  const { mehlsorten } = zustand.teig;
  const gramm = mehlEinheit() === 'gramm';
  const verwendet = new Set(mehlsorten.map((s) => s.id));
  const zeilen = mehlsorten.map((s, i) => `
      <li class="zeile zeile-wahl">
        ${auswahl({ liste: katalog.mehle, gewaehlt: s.id, ausser: verwendet, name: s.name,
          daten: `data-wahl="mehl" data-index="${i}" aria-label="Mehlsorte ${i + 1}"`,
          eigeneText: 'Eigenes Mehl …' })}
        <span class="mit-einheit prozent">
          <input class="eingabe" data-feld="mehlanteil" data-index="${i}" inputmode="decimal" ${imTeiglingeModus() && gramm ? 'readonly' : ''}
                 autocomplete="off" value="${feldWert('mehlanteil', i)}"
                 aria-label="${text(s.name)} in ${gramm ? 'Gramm' : 'Prozent'}">
          <span class="einheit">${gramm ? 'g' : '%'}</span>
        </span>
        <button type="button" class="knopf knopf-leise knopf-weg" data-aktion="mehl-weg"
                data-index="${i}" aria-label="${text(s.name)} entfernen">✕</button>
      </li>`).join('');

  return klappe('mehle', 'Mehlsorten wählen und mischen', `
      <div class="umschaltgruppe" role="group" aria-label="Anteile angeben in">
        <button type="button" class="knopf" data-aktion="einheit" data-einheit="prozent"
                aria-pressed="${!gramm}">in %</button>
        <button type="button" class="knopf" data-aktion="einheit" data-einheit="gramm"
                aria-pressed="${gramm}">in Gramm</button>
      </div>
      <ul class="zutaten">${zeilen}</ul>
      ${auswahl({ liste: katalog.mehle, ausser: verwendet, daten: 'data-wahl="mehl-neu" aria-label="Mehl hinzufügen"',
        leer: '+ Mehl hinzufügen', eigeneText: 'Eigenes Mehl …' })}
      <p class="info">Beim Tauschen oder Mischen passt die App das Wasser an die Wasseraufnahme
        der Mehle an. Das ist ein Vorschlag – die Hydration bleibt frei änderbar.</p>`);
}

/** Saaten und Zusatzzutaten: Zeilen mit Auswahl und ✕, darunter „+ hinzufügen“. */
function wahlZeilen(liste, gewaehlt, art, beschriftung, eigeneText) {
  const verwendet = new Set(gewaehlt.map((s) => s.id));
  const zeilen = gewaehlt.map((s, i) => `
      <li class="zeile zeile-wahl zeile-wahl-kurz">
        ${auswahl({ liste, gewaehlt: s.id, ausser: verwendet, name: s.name,
          daten: `data-wahl="${art}" data-index="${i}" aria-label="${beschriftung} ${i + 1}"`, eigeneText })}
        <button type="button" class="knopf knopf-leise knopf-weg" data-aktion="${art}-weg"
                data-index="${i}" aria-label="${text(s.name)} entfernen">✕</button>
      </li>`).join('');
  return `<ul class="zutaten">${zeilen}</ul>
      ${auswahl({ liste, ausser: verwendet, daten: `data-wahl="${art}-neu" aria-label="${beschriftung} hinzufügen"`,
        leer: `+ ${beschriftung} hinzufügen`, eigeneText })}`;
}

function saatenKlappe() {
  return klappe('saaten', 'Quellstück: Saaten wählen', `
      ${wahlZeilen(katalog.saaten, zustand.teig.saaten, 'saat', 'Saat', 'Eigene Saat …')}
      <p class="info">Neue Saaten starten mit 5 % vom Mehl. Die Menge stellst du oben im Quellstück ein,
        das Quellwasser rechnet die App dazu.</p>`);
}

function zusatzKlappe() {
  return klappe('zusaetze', 'Zusatzzutaten: Milch, Ei, Butter …', `
      ${wahlZeilen(katalog.zusaetze, zustand.teig.zusaetze, 'zusatz', 'Zutat', 'Eigene Zutat …')}
      <p class="info">Menge in % vom Mehl, oben in der Zutatenliste einstellbar. Das Wasser in Milch, Ei & Co.
        zählt zur Hydration – die App zieht es vom Wasser ab. Ei und Butter machen den Teig trotzdem
        fester, als ihr Wasser vermuten lässt: die Hydration nach Gefühl anpassen.</p>`);
}

function auffrischKlappe() {
  const a = auffrischung();
  const feld = (name, daten, wert, einheit) => `
      <li class="zeile">
        <label class="zeile-name" for="auf-${daten}">${name}</label>
        <span class="mit-einheit prozent">
          <input class="eingabe" id="auf-${daten}" data-auf="${daten}" inputmode="decimal"
                 autocomplete="off" value="${formatProzent(wert)}" aria-label="${name}">
          ${einheit ? `<span class="einheit">${einheit}</span>` : ''}
        </span>
      </li>`;
  const schnell = VERHAELTNISSE.map((v) => {
    const gleich = v.every((x, i) => x === a.verhaeltnis[i]);
    return `<button type="button" class="knopf" data-aktion="verhaeltnis" data-wert="${v.join(',')}"
              aria-pressed="${gleich}">${v.map(formatProzent).join(':')}</button>`;
  }).join('');
  const ausgabe = (name, id) => `
      <li class="zeile"><span class="zeile-name">${name}</span>
        <output class="gramm zahl" data-ausgabe="${id}"></output></li>`;
  const hinweis = aufHinweis;
  aufHinweis = null;

  return klappe('auffrischen', 'Starter auffrischen', `
      <ul class="zutaten">
        ${feld('Starter für das Rezept', 'bedarf', a.bedarf, 'g')}
        ${feld('Rest für den Kühlschrank', 'rest', a.rest, 'g')}
      </ul>
      <button type="button" class="knopf" data-aktion="bedarf-uebernehmen">
        Bedarf aus aktuellem Rezept übernehmen</button>
      ${hinweis ? `<p class="info" role="status">${text(hinweis)}</p>` : ''}
      <p class="info">Verhältnis Anstellgut : Mehl : Wasser</p>
      <div class="umschaltgruppe drei" role="group" aria-label="Schnellwahl Verhältnis">${schnell}</div>
      <ul class="zutaten verhaeltnis-felder">
        ${feld('Anstellgut', 'v0', a.verhaeltnis[0], '')}
        ${feld('Mehl', 'v1', a.verhaeltnis[1], '')}
        ${feld('Wasser', 'v2', a.verhaeltnis[2], '')}
      </ul>
      <ul class="zutaten">
        ${ausgabe('Anstellgut', 'auf-anstellgut')}
        ${ausgabe('Mehl', 'auf-mehl')}
        ${ausgabe('Wasser', 'auf-wasser')}
      </ul>
      <p class="summe"><span>Starter gesamt</span><output class="zahl" data-ausgabe="auf-gesamt"></output></p>
      <p class="info" data-ausgabe="auf-hydration"></p>`);
}

/** Umschalter Mehl / Teiglinge (in den Vorlagen-Einstellungen und beim Speichern). */
function modusKnoepfe(aktion) {
  const tl = imTeiglingeModus();
  return `<div class="umschaltgruppe" role="group" aria-label="Menge angeben als">
      <button type="button" class="knopf" data-aktion="${aktion}" data-modus="mehl"
              aria-pressed="${!tl}">Mehl</button>
      <button type="button" class="knopf" data-aktion="${aktion}" data-modus="teiglinge"
              aria-pressed="${tl}">Teiglinge</button>
    </div>`;
}

/** Einstellungen der Vorlage: Modus, Verlust, Speichern, Teilen, Ausblenden/Löschen. */
function vorlageKlappe(vorlage) {
  const eigene = vorlage && !vorlage.eingebaut;
  const verlust = imTeiglingeModus()
    ? `<ul class="zutaten">
         <li class="zeile">
           <label class="zeile-name" for="feld-tl-verlust">Verlust-Zuschlag<small>Rest in der Schüssel</small></label>
           <span class="mit-einheit prozent">
             <input class="eingabe" id="feld-tl-verlust" data-feld="tl-verlust" inputmode="decimal"
                    autocomplete="off" value="${feldWert('tl-verlust')}" aria-label="Verlust-Zuschlag in %">
             <span class="einheit">%</span>
           </span>
         </li>
       </ul>` : '';
  const teilen = !eigene ? ''
    : zustand.geaendert
      ? '<p class="info">Teilen geht nach dem Speichern.</p>'
      : '<button type="button" class="knopf" data-aktion="teilen">Vorlage teilen</button>';
  const weg = !vorlage ? ''
    : eigene
      ? `<button type="button" class="knopf knopf-leise" data-aktion="loeschen">„${text(vorlage.name)}“ löschen</button>`
      : '<button type="button" class="knopf knopf-leise" data-aktion="ausblenden">Vorlage ausblenden</button>';

  return klappe('vorlage', 'Vorlage: Menge, Speichern, Teilen', `
      <p class="info">Menge angeben als</p>
      ${modusKnoepfe('modus')}
      ${verlust}
      <div class="aktionen">
        <button type="button" class="knopf" data-aktion="speichern-karte">Speichern, umbenennen …</button>
        ${teilen}
        ${weg}
      </div>`);
}

/** Karte „Vorlage speichern“: Name, Kategorie, Modus; aktualisieren oder als neue speichern. */
function speicherKarteHtml(vorlage) {
  const eigene = vorlage && !vorlage.eingebaut;
  const k = speicherKarte;
  const optionen = [...KATEGORIEN, { id: '', name: OHNE_KATEGORIE }]
    .map((x) => `<option value="${x.id}" ${(k.kategorie ?? '') === x.id ? 'selected' : ''}>${text(x.name)}</option>`)
    .join('');
  return `<section class="karte speichern" aria-label="Vorlage speichern">
      <h2 class="karte-titel">${k.zurueck ? 'Änderungen speichern?' : 'Vorlage speichern'}</h2>
      <label class="feld"><span class="feld-name">Name</span>
        <input class="eingabe eingabe-text" data-sp="name" autocomplete="off" maxlength="80" value="${text(k.name)}"></label>
      <label class="feld"><span class="feld-name">Kategorie</span>
        <select class="eingabe auswahl" data-sp="kategorie">${optionen}</select></label>
      <p class="feld-name">Menge angeben als</p>
      ${modusKnoepfe('sp-modus')}
      <div class="aktionen">
        ${eigene ? '<button type="button" class="knopf knopf-voll" data-aktion="sp-aktualisieren">Vorlage aktualisieren</button>' : ''}
        <button type="button" class="knopf ${eigene ? '' : 'knopf-voll'}" data-aktion="sp-neu">Als neue speichern</button>
        ${k.zurueck ? '<button type="button" class="knopf knopf-leise" data-aktion="sp-verwerfen">Änderungen verwerfen</button>' : ''}
        <button type="button" class="knopf knopf-leise" data-aktion="sp-abbrechen">Abbrechen</button>
      </div>
      ${eigene ? '' : '<p class="info">Eingebaute Vorlagen bleiben unverändert – Änderungen werden eine neue, eigene Vorlage.</p>'}
    </section>`;
}

function einstellungenKlappe() {
  const zeile = (s, art, wertName, einheit) => {
    const knopf = !s.eingebaut
      ? `<button type="button" class="knopf knopf-leise knopf-weg" data-aktion="sorte-weg"
                 data-art="${art}" data-id="${text(s.id)}" aria-label="${text(s.name)} löschen">✕</button>`
      : s.geaendertGegenueberStandard
        ? `<button type="button" class="knopf knopf-leise knopf-weg" data-aktion="sorte-weg"
                   data-art="${art}" data-id="${text(s.id)}"
                   aria-label="${text(s.name)} auf Standardwert zurücksetzen">↺</button>`
        : '<span></span>';
    return `<li class="zeile zeile-wahl">
        <span class="zeile-name">${text(s.name)}${s.eingebaut
          ? `<small>Standard ${formatProzent(s.standard)}</small>` : '<small>eigene</small>'}</span>
        <span class="mit-einheit prozent">
          <input class="eingabe" data-einstellung="${art}" data-id="${text(s.id)}" inputmode="decimal"
                 autocomplete="off" value="${formatProzent(s[wertName])}"
                 aria-label="${text(s.name)}">
          <span class="einheit">${einheit}</span>
        </span>
        ${knopf}
      </li>`;
  };

  return klappe('einstellungen', 'Einstellungen: Wasserwerte', `
      <p class="info">Wasseraufnahme: typische Hydration, wenn das Mehl allein verwendet wird.</p>
      <ul class="zutaten">${katalog.mehle.map((s) => zeile(s, 'mehl', 'wasser', '%')).join('')}</ul>
      <p class="info">Quellverhältnis: Gramm Wasser je Gramm Saat.</p>
      <ul class="zutaten">${katalog.saaten.map((s) => zeile(s, 'saat', 'verhaeltnis', '×')).join('')}</ul>
      <p class="info">Wasseranteil der Zusatzzutaten: so viel davon zählt zur Hydration.</p>
      <ul class="zutaten">${katalog.zusaetze.map((s) => zeile(s, 'zusatz', 'wasser', '%')).join('')}</ul>
      <p class="info">Änderungen gelten ab dem nächsten Tauschen, Mischen oder Hinzufügen.
        Gespeicherte Vorlagen behalten ihre Werte.</p>`);
}

/** Text, der in einem Eingabefeld steht. */
function feldWert(feld, index) {
  const { teig, mehl, teiglinge } = zustand;
  if (feld === 'mehl') return String(Math.round(mehl));
  if (feld === 'tl-anzahl') return formatProzent(teiglinge.anzahl);
  if (feld === 'tl-gewicht') return formatProzent(teiglinge.gewicht);
  if (feld === 'tl-verlust') return formatProzent(teiglinge.verlust);
  if (feld === 'mehlanteil') {
    if (mehlEinheit() === 'gramm') {
      const e = berechne(teig, gesamtmehlAusMehl(teig, mehl));
      return String(Math.round(e.mehlsorten[index]?.gramm ?? 0));
    }
    return formatProzent(teig.mehlsorten[index]?.anteil ?? 0);
  }
  if (feld.startsWith('saat-')) return formatProzent(teig.saaten[Number(feld.slice(5))]?.prozent ?? 0);
  if (feld.startsWith('zusatz-')) return formatProzent(teig.zusaetze[Number(feld.slice(7))]?.prozent ?? 0);
  if (feld === 'quellwasser') return formatProzent(Math.max(teig.quellwasser ?? 0, 0));
  return formatProzent(teig[feld] ?? 0);
}

// ---------- Live-Aktualisierung (bei jedem Tastendruck) ----------

function aktualisiere() {
  if (ansicht !== 'rechner') return;
  const { teig, teiglinge } = zustand;
  // Teiglinge-Modus: Das Mehl folgt aus Anzahl × Gewicht (+ Verlust) und dem Teig
  if (imTeiglingeModus()) {
    zustand.mehl = mehlFuerTeiglinge(teig, teiglinge.anzahl, teiglinge.gewicht, teiglinge.verlust);
  }
  const mehl = zustand.mehl;
  const e = berechne(teig, gesamtmehlAusMehl(teig, mehl));

  const werte = {
    gesamtmehl: e.gesamtmehl,
    'mehl-errechnet': e.mehl,
    wasser: e.wasser,
    starter: e.starter,
    salz: e.salz,
    oel: e.oel,
    quellwasser: e.quellwasser,
    teigGesamt: e.teigGesamt,
  };
  e.mehlsorten.forEach((s, i) => (werte[`mehlsorte-${i}`] = s.gramm));
  e.saaten.forEach((s, i) => (werte[`saat-${i}`] = s.gramm));
  e.zusaetze.forEach((z, i) => (werte[`zusatz-${i}`] = z.gramm));

  for (const [name, gramm] of Object.entries(werte)) {
    setzeAusgabe(name, `${formatGramm(gramm)} g`);
  }
  e.zusaetze.forEach((z, i) =>
    setzeAusgabe(`zusatzwasser-${i}`, z.wasser > 0 ? `davon ${formatGramm(z.wasser)} g Wasser` : ''));
  const anteile = teig.mehlsorten.reduce((a, s) => a + s.anteil, 0);
  teig.mehlsorten.forEach((s, i) =>
    setzeAusgabe(`mehlanteil-${i}`, `${formatProzent(anteile > 0 ? (s.anteil / anteile) * 100 : 0)} %`));

  e.hinweise.push(...mehlHinweise(teig, katalog.art));
  // Hefe unter 10 g mit einer Nachkommastelle, sonst wären 0,4 g "0 g"
  setzeAusgabe('hefe', `${e.hefe < 10 ? formatGrammFein(e.hefe) : formatGramm(e.hefe)} g`);

  const hinweis = wurzel.querySelector('[data-ausgabe="hinweise"]');
  hinweis.textContent = e.hinweise.map((h) => HINWEISE[h]).join(' ');
  hinweis.hidden = e.hinweise.length === 0;

  // Mit Zusatzzutaten: erklären, warum weniger Wasser dazukommt
  const zusatzInfo = wurzel.querySelector('[data-ausgabe="zusatzwasser"]');
  zusatzInfo.textContent = e.zusatzWasser > 0
    ? `Wasser gesamt ${formatGramm(e.wasserGesamt)} g – davon ${formatGramm(e.zusatzWasser)} g aus den Zusatzzutaten, ` +
      `${formatGramm(e.starterWasser)} g aus dem Starter.`
    : '';
  zusatzInfo.hidden = e.zusatzWasser <= 0;

  zeigeAnpassung(e);
  zeigeAuffrischung();
  synchronisiereFelder();
  zeigeGeaendert();
}

/** Markierung „geändert“ und Knopf „Änderungen speichern“ ein-/ausblenden. */
function zeigeGeaendert() {
  const marke = wurzel.querySelector('[data-ausgabe="geaendert"]');
  if (marke) marke.hidden = !zustand.geaendert;
  const knopf = wurzel.querySelector('.knopf[data-aktion="speichern-karte"]');
  if (knopf) knopf.hidden = !zustand.geaendert || speicherKarte !== null;
}

/** Ergebnis der Starter-Auffrischung in die Seite schreiben. */
function zeigeAuffrischung() {
  const a = auffrischung();
  const e = auffrischen(a.bedarf, a.rest, a.verhaeltnis);
  setzeAusgabe('auf-anstellgut', `${formatGramm(e.anstellgut)} g`);
  setzeAusgabe('auf-mehl', `${formatGramm(e.mehl)} g`);
  setzeAusgabe('auf-wasser', `${formatGramm(e.wasser)} g`);
  setzeAusgabe('auf-gesamt', `${formatGramm(e.gesamt)} g`);
  setzeAusgabe('auf-hydration', e.gesamt > 0 ? `Hydration des Starters: ${formatProzent(e.hydration)} %` : '');
}

/** Kurzer Hinweis, wie viel Wasser die App seit dem Laden automatisch angepasst hat. */
function zeigeAnpassung(e) {
  const { wasser, quellwasser } = zustand.anpassung;
  const vorzeichen = (x) => (x > 0 ? '+' : '−');
  const teile = [];
  if (Math.abs(wasser) >= 0.05) {
    teile.push(`Wasser ${vorzeichen(wasser)}${formatProzent(Math.abs(wasser))} % (Mehlmischung)`);
  }
  if (Math.abs(quellwasser) >= 0.05) {
    const gramm = (e.gesamtmehl * Math.abs(quellwasser)) / 100;
    teile.push(`Quellwasser ${vorzeichen(quellwasser)}${formatGramm(gramm)} g (Saaten)`);
  }
  const el = wurzel.querySelector('[data-ausgabe="anpassung"]');
  el.textContent = teile.length ? `Angepasst: ${teile.join(', ')}. Vorschlag – jederzeit änderbar.` : '';
  el.hidden = teile.length === 0;
}

/** Schreibt Werte in alle Felder – außer in das, in dem gerade getippt wird. */
function synchronisiereFelder() {
  for (const feld of wurzel.querySelectorAll('input[data-feld]')) {
    if (feld === document.activeElement) continue;
    const name = feld.dataset.feld;
    feld.value = feldWert(name, Number(feld.dataset.index));
  }
}

function setzeAusgabe(name, wert) {
  const el = wurzel.querySelector(`[data-ausgabe="${name}"]`);
  if (el) el.textContent = wert;
}

// ---------- Eingaben ----------

// Diese Felder ändern nur die Menge, nicht die Vorlage – dafür fragt die App nicht nach dem Speichern
const NUR_MENGE = new Set(['mehl', 'tl-anzahl', 'tl-gewicht']);

function beiEingabe(ereignis) {
  const ziel = ereignis.target;
  if (ziel.dataset.suche !== undefined) {
    suche = ziel.value;
    return zeichneListeNeu();
  }
  if (ziel.dataset.nk === 'name' && neuKarte) {
    neuKarte.name = ziel.value;
    return;
  }
  if (ziel.dataset.sp === 'name' && speicherKarte) {
    speicherKarte.name = ziel.value;
    return;
  }
  if (ziel.dataset.einstellung) return aendereEinstellung(ziel);
  if (ziel.dataset.auf) return aendereAuffrischung(ziel);
  const feld = ziel.dataset.feld;
  if (!feld) return;
  const wert = leseZahl(ziel.value);
  const { teig } = zustand;

  if (feld === 'mehl') {
    zustand.mehl = wert;
  } else if (feld.startsWith('tl-')) {
    zustand.teiglinge = { ...zustand.teiglinge, [feld.slice(3)]: wert };
  } else if (feld === 'mehlanteil') {
    const index = Number(ziel.dataset.index);
    if (mehlEinheit() === 'gramm') {
      const neu = mehlsortenMitGramm(teig.mehlsorten, index, wert, zustand.mehl);
      zustand.mehl = neu.mehl;
      setzeMehlsorten(neu.mehlsorten);
    } else {
      setzeMehlsorten(mehlsortenMitAnteil(teig.mehlsorten, index, wert));
    }
  } else if (feld.startsWith('saat-')) {
    const index = Number(feld.slice(5));
    setzeSaaten(teig.saaten.map((s, i) => (i === index ? { ...s, prozent: wert } : s)));
  } else if (feld.startsWith('zusatz-')) {
    const index = Number(feld.slice(7));
    teig.zusaetze = teig.zusaetze.map((z, i) => (i === index ? { ...z, prozent: wert } : z));
  } else {
    teig[feld] = wert;
    // Selbst eingetippt: ab hier ist das der neue Ausgangswert
    if (feld === 'hydration') zustand.anpassung.wasser = 0;
    if (feld === 'quellwasser') zustand.anpassung.quellwasser = 0;
  }
  if (!NUR_MENGE.has(feld)) zustand.geaendert = true;
  aktualisiere();
  merkeStand();
}

/** Neue Mehlmischung übernehmen und das Wasser als Vorschlag anpassen. */
function setzeMehlsorten(neu) {
  const { teig } = zustand;
  const vorher = teig.hydration;
  teig.hydration = hydrationNachMehlwechsel(teig, teig.mehlsorten, neu, katalog.wasserVon);
  zustand.anpassung.wasser += teig.hydration - vorher;
  teig.mehlsorten = neu;
}

/** Neue Saaten übernehmen und das Quellwasser als Vorschlag anpassen. */
function setzeSaaten(neu) {
  const { teig } = zustand;
  const vorher = teig.quellwasser ?? 0;
  teig.quellwasser = quellwasserNachSaatwechsel(teig, teig.saaten, neu, katalog.verhaeltnisVon);
  zustand.anpassung.quellwasser += teig.quellwasser - vorher;
  if (neu.length === 0) zustand.anpassung.quellwasser = 0;
  teig.saaten = neu;
}

function aendereAuffrischung(feld) {
  const wert = leseZahl(feld.value);
  const art = feld.dataset.auf;
  if (art.startsWith('v')) {
    const v = [...auffrischung().verhaeltnis];
    v[Number(art.slice(1))] = wert;
    setzeAuffrischung({ verhaeltnis: v });
  } else {
    setzeAuffrischung({ [art]: wert });
  }
  zeigeAuffrischung();
}

// Kataloge je Art: Mehl, Saat, Zusatzzutat
const KATALOGE = { mehl: mehle, saat: saaten, zusatz: zusaetze };
const katalogListe = (art) => ({ mehl: katalog.mehle, saat: katalog.saaten, zusatz: katalog.zusaetze })[art];

function aendereEinstellung(feld) {
  KATALOGE[feld.dataset.einstellung].setzeWert(speicher, feld.dataset.id, leseZahl(feld.value));
  ladeKatalog();
  aktualisiere();
}

// ---------- Auswahllisten (Mehl/Saat/Zusatzzutat tauschen oder hinzufügen) ----------

function beiAuswahl(ereignis) {
  const ziel = ereignis.target;
  if (ziel.dataset.nk === 'kategorie' && neuKarte) {
    // Modus folgt der Kategorie (Pizza/Brötchen: Teiglinge) – danach frei umschaltbar
    neuKarte.kategorie = bereinigeKategorie(ziel.value);
    neuKarte.modus = vorbelegung(neuKarte.kategorie).modus;
    return zeichne();
  }
  if (ziel.dataset.nk === 'basis' && neuKarte) {
    neuKarte.basis = ziel.value;
    return;
  }
  if (ziel.dataset.sp === 'kategorie' && speicherKarte) {
    speicherKarte.kategorie = bereinigeKategorie(ziel.value);
    return;
  }
  const wahl = ziel.dataset.wahl;
  if (!wahl) return;
  const art = wahl.replace('-neu', '');
  const id = ziel.value === EIGENE ? legeEigeneSorteAn(art) : ziel.value;
  if (!id) return zeichne(); // abgebrochen: Auswahl zurücksetzen

  const sorte = katalogListe(art).find((s) => s.id === id);
  if (!sorte) return zeichne();
  const { teig } = zustand;
  const index = Number(ziel.dataset.index);
  const tausche = (liste, neu) => liste.map((s, i) => (i === index ? { ...s, ...neu } : s));

  if (wahl === 'mehl') {
    setzeMehlsorten(tausche(teig.mehlsorten, { id, name: sorte.name }));
  } else if (wahl === 'mehl-neu') {
    const anteil = teig.mehlsorten.length === 0 ? 100 : 0;
    setzeMehlsorten([...teig.mehlsorten, { id, name: sorte.name, anteil }]);
  } else if (wahl === 'saat') {
    setzeSaaten(tausche(teig.saaten, { id, name: sorte.name }));
  } else if (wahl === 'saat-neu') {
    setzeSaaten([...teig.saaten, { id, name: sorte.name, prozent: 5 }]);
  } else if (wahl === 'zusatz') {
    // Der Wasseranteil kommt mit in den Teig – so rechnet die Vorlage auch auf dem anderen Handy gleich
    teig.zusaetze = tausche(teig.zusaetze, { id, name: sorte.name, wasser: sorte.wasser });
  } else if (wahl === 'zusatz-neu') {
    teig.zusaetze = [...teig.zusaetze, { id, name: sorte.name, prozent: NEUER_ZUSATZ, wasser: sorte.wasser }];
  }
  zustand.geaendert = true;
  merkeStand();
  zeichne();
}

const EIGENE_FRAGEN = {
  mehl: { name: 'Name des Mehls:', wert: 'Wasseraufnahme in % (typische Hydration, z. B. 65):', start: STANDARD_WASSER },
  saat: { name: 'Name der Saat:', wert: 'Gramm Wasser je Gramm Saat (z. B. 1):', start: STANDARD_VERHAELTNIS },
  zusatz: {
    name: 'Name der Zutat (z. B. Sahne, Quark):',
    wert: 'Wasseranteil in % (z. B. Sahne 60, Quark 80, Schokolade 0):',
    start: STANDARD_ZUSATZ_WASSER,
  },
};

/** Fragt Namen (und Wert) für eine eigene Sorte ab. Gibt die neue id zurück oder null. */
function legeEigeneSorteAn(art) {
  const frage = EIGENE_FRAGEN[art];
  const name = window.prompt(frage.name)?.trim();
  if (!name) return null;
  const eingabe = window.prompt(frage.wert, formatProzent(frage.start));
  const gelesen = eingabe === null ? frage.start : leseZahl(eingabe);
  // Mehl und Saat ohne Wert ergeben keinen Sinn; beim Wasseranteil ist 0 möglich (z. B. Zucker)
  let wert = art !== 'zusatz' && gelesen === 0 ? frage.start : gelesen;
  if (art === 'zusatz') wert = Math.min(wert, 100);
  const neu = KATALOGE[art].neu(speicher, name, wert);
  if (!neu) {
    meldeFehler();
    return null;
  }
  ladeKatalog();
  return neu.id;
}

function beiKlick(ereignis) {
  const ziel = ereignis.target;
  const oeffnen = ziel.closest('[data-oeffnen]');
  if (oeffnen) return oeffneVorlage(oeffnen.dataset.oeffnen);
  const stern = ziel.closest('[data-stern]');
  if (stern) {
    schalteFavorit(speicher, stern.dataset.stern);
    return zeichneListeNeu();
  }
  const weg = ziel.closest('[data-weg]');
  if (weg) return entferneAusListe(weg.dataset.weg);
  const einblenden = ziel.closest('[data-einblenden]');
  if (einblenden) {
    blendeAus(speicher, einblenden.dataset.einblenden, false);
    return zeichneListeNeu();
  }

  const knopf = ziel.closest('[data-aktion]');
  const aktion = knopf?.dataset.aktion;
  if (aktion === 'zurueck') zurueck();
  if (aktion === 'neu-karte') oeffneNeuKarte();
  if (aktion === 'nk-modus' && neuKarte && MODI.includes(knopf.dataset.modus)) {
    neuKarte.modus = knopf.dataset.modus;
    zeichne();
  }
  if (aktion === 'nk-anlegen') legeNeueVorlageAn();
  if (aktion === 'nk-abbrechen') {
    neuKarte = null;
    zeichne();
  }
  if (aktion === 'mehl-weg') entferneMehl(Number(knopf.dataset.index));
  if (aktion === 'saat-weg') entferneSaat(Number(knopf.dataset.index));
  if (aktion === 'zusatz-weg') entferneZusatz(Number(knopf.dataset.index));
  if (aktion === 'einheit') wechsleEinheit(knopf.dataset.einheit);
  if (aktion === 'modus' || aktion === 'sp-modus') wechsleModus(knopf.dataset.modus);
  if (aktion === 'verhaeltnis') waehleVerhaeltnis(knopf.dataset.wert);
  if (aktion === 'bedarf-uebernehmen') uebernimmBedarf();
  if (aktion === 'sorte-weg') entferneSorte(knopf.dataset.art, knopf.dataset.id);
  if (aktion === 'hefeart') wechsleHefeart();
  if (aktion === 'speichern-karte') oeffneSpeicherKarte(false);
  if (aktion === 'sp-aktualisieren') speichereAenderungen();
  if (aktion === 'sp-neu') speichereAlsNeu();
  if (aktion === 'sp-verwerfen') verwerfeAenderungen();
  if (aktion === 'sp-abbrechen') schliesseSpeicherKarte();
  if (aktion === 'loeschen') loescheVorlage();
  if (aktion === 'vermerk-weg') behalteVorlage();
  if (aktion === 'ausblenden') blendeVorlageAus();
  if (aktion === 'teilen') teileVorlage();
  if (aktion === 'sichern') sichereAlle();
  if (aktion === 'einfuegen') fuegeLinkEin();
  if (aktion === 'import-ja') uebernehmePaket(false);
  if (aktion === 'import-kopie') uebernehmePaket(true);
  if (aktion === 'import-kopieren') kopiereLink(paket?.link);
  if (aktion === 'import-weg') verwerfePaket();
}

/** Zurück zur Liste – mit ungespeicherten Änderungen erst fragen. */
function zurueck() {
  if (zustand.geaendert) return oeffneSpeicherKarte(true);
  zeige('liste');
}

function entferneMehl(index) {
  const rest = zustand.teig.mehlsorten.filter((_, i) => i !== index);
  // Übrige Anteile wieder auf 100 % bringen, im gleichen Verhältnis
  const summe = rest.reduce((a, s) => a + s.anteil, 0);
  setzeMehlsorten(rest.map((s) => ({
    ...s,
    anteil: summe > 0 ? (s.anteil / summe) * 100 : 100 / rest.length,
  })));
  geaendertUndNeu();
}

function entferneSaat(index) {
  setzeSaaten(zustand.teig.saaten.filter((_, i) => i !== index));
  geaendertUndNeu();
}

function entferneZusatz(index) {
  zustand.teig.zusaetze = zustand.teig.zusaetze.filter((_, i) => i !== index);
  geaendertUndNeu();
}

function geaendertUndNeu() {
  zustand.geaendert = true;
  merkeStand();
  zeichne();
}

function wechsleEinheit(einheit) {
  speicher.setzeEinstellung(MEHL_EINHEIT, einheit);
  zeichne();
}

/** Mehl- oder Teiglinge-Modus – gehört zur Vorlage, darum eine Änderung. */
function wechsleModus(modus) {
  if (!MODI.includes(modus) || modus === zustand.modus) return;
  zustand.modus = modus;
  geaendertUndNeu();
}

function waehleVerhaeltnis(wert) {
  setzeAuffrischung({ verhaeltnis: wert.split(',').map(Number) });
  zeichne();
}

/** Startermenge aus dem aktuellen Rezept als Bedarf eintragen. */
function uebernimmBedarf() {
  const e = berechne(zustand.teig, gesamtmehlAusMehl(zustand.teig, zustand.mehl));
  const bedarf = Math.round(e.starter);
  setzeAuffrischung({ bedarf });
  if (bedarf <= 0) aufHinweis = 'Das aktuelle Rezept enthält keinen Starter.';
  zeichne();
}

/** Eigene Sorte löschen oder eingebaute auf den Standardwert zurücksetzen. */
function entferneSorte(art, id) {
  const sorte = katalogListe(art)?.find((s) => s.id === id);
  if (!sorte) return;
  if (!sorte.eingebaut && !window.confirm(`„${sorte.name}“ löschen?`)) return;
  KATALOGE[art].entferne(speicher, id);
  ladeKatalog();
  zeichne();
}

function ladeUndZeige(vorlage, rueckmeldung = null) {
  zustand = vorlageZustand(vorlage);
  merkeStand();
  meldung = rueckmeldung;
  zeige('rechner');
}

function wechsleHefeart() {
  const { teig } = zustand;
  const neu = teig.hefeArt === 'trocken' ? 'frisch' : 'trocken';
  teig.hefe = hefeUmrechnen(teig.hefe, teig.hefeArt, neu);
  teig.hefeArt = neu;
  geaendertUndNeu();
}

// ---------- Eigene Vorlagen: speichern, löschen, ausblenden ----------

function oeffneSpeicherKarte(zurueckDanach) {
  const vorlage = aktuelleVorlage();
  speicherKarte = {
    name: !vorlage ? '' : vorlage.eingebaut ? `${vorlage.name} (eigene)` : vorlage.name,
    kategorie: vorlage?.kategorie ?? null,
    zurueck: zurueckDanach,
  };
  zeichne();
  window.scrollTo(0, 0);
}

function schliesseSpeicherKarte() {
  speicherKarte = null;
  zeichne();
}

/** Name aus der Karte; leer → Hinweis und kein Speichern. */
function nameAusKarte() {
  const name = speicherKarte.name.trim();
  if (!name) {
    window.alert('Bitte einen Namen für die Vorlage eingeben.');
    wurzel.querySelector('[data-sp="name"]')?.focus();
  }
  return name;
}

function vorlagenDaten(name) {
  return {
    name,
    kategorie: speicherKarte.kategorie,
    teig: zustand.teig,
    mehl: zustand.mehl,
    modus: zustand.modus,
    teiglinge: zustand.teiglinge,
  };
}

function nachDemSpeichern(gespeichert, rueckmeldung) {
  if (!gespeichert) return meldeFehler();
  const zurueckDanach = speicherKarte.zurueck;
  speicherKarte = null;
  zustand.vorlageId = gespeichert.id;
  zustand.geaendert = false;
  merkeStand();
  meldung = rueckmeldung;
  zeige(zurueckDanach ? 'liste' : 'rechner');
}

function speichereAlsNeu() {
  const name = nameAusKarte();
  if (!name) return;
  nachDemSpeichern(speichereEigeneVorlage(speicher, vorlagenDaten(name)), `„${name}“ gespeichert.`);
}

function speichereAenderungen() {
  const vorlage = aktuelleVorlage();
  if (!vorlage || vorlage.eingebaut) return;
  const name = nameAusKarte();
  if (!name) return;
  nachDemSpeichern(speichereEigeneVorlage(speicher, { id: vorlage.id, ...vorlagenDaten(name) }),
    `„${name}“ aktualisiert.`);
}

/** Änderungen verwerfen: Die Vorlage gilt wieder wie gespeichert. */
function verwerfeAenderungen() {
  const vorlage = aktuelleVorlage();
  if (vorlage) {
    zustand = vorlageZustand(vorlage);
    merkeStand();
  } else {
    vergissStand();
  }
  zeige('liste');
}

/** Kein „zuletzt benutzt“ mehr – die App startet dann mit der Liste. */
function vergissStand() {
  zustand = null;
  speicher.setzeEinstellung(STAND, null);
}

function loescheVorlage() {
  const vorlage = aktuelleVorlage();
  if (!vorlage || vorlage.eingebaut) return;
  if (!window.confirm(`Vorlage „${vorlage.name}“ wirklich löschen?`)) return;
  loescheEigeneVorlage(speicher, vorlage.id);
  vergissStand();
  meldung = `„${vorlage.name}“ gelöscht.`;
  zeige('liste');
}

/** Konflikt-Kopie behalten: Vermerk weg, sie bleibt als ganz normale Vorlage. */
function behalteVorlage() {
  const vorlage = aktuelleVorlage();
  if (!vorlage || vorlage.eingebaut) return;
  if (!entferneVermerk(speicher, vorlage.id)) return meldeFehler();
  zeichne();
}

function blendeVorlageAus() {
  const vorlage = aktuelleVorlage();
  if (!vorlage || !vorlage.eingebaut) return;
  blendeAus(speicher, vorlage.id);
  vergissStand();
  meldung = `„${vorlage.name}“ ausgeblendet. Unten bei „Ausgeblendet“ wieder einblenden.`;
  zeige('liste');
}

// ---------- Vorlagenliste: wischen → löschen / ausblenden, mit „Rückgängig“ ----------

const RUECKGAENGIG_DAUER = 6000; // so lange bleibt „Rückgängig“ stehen (ms)

/** Eigene Vorlage löschen, eingebaute ausblenden – ohne Nachfrage, dafür mit „Rückgängig“. */
function entferneAusListe(id) {
  const vorlage = alleVorlagen(speicher).find((v) => v.id === id);
  if (!vorlage) return;
  let zurueckholen;
  if (vorlage.eingebaut) {
    blendeAus(speicher, id);
    zurueckholen = () => blendeAus(speicher, id, false);
  } else {
    const alt = holeEigeneVorlage(speicher, id);
    if (!alt || !loescheEigeneVorlage(speicher, id)) return meldeFehler();
    zurueckholen = () => stelleEigeneVorlageWiederHer(speicher, alt);
  }
  if (zustand?.vorlageId === id) vergissStand();
  zeichneListeNeu();
  zeigeRueckgaengig(`„${vorlage.name}“ ${vorlage.eingebaut ? 'ausgeblendet' : 'gelöscht'}`, () => {
    if (!zurueckholen()) return meldeFehler();
    if (ansicht === 'liste') zeichneListeNeu();
  });
}

/** Kleine Leiste unten mit „Rückgängig“; eine neue ersetzt die alte, nach ein paar Sekunden verschwindet sie. */
function zeigeRueckgaengig(hinweis, zurueckholen) {
  if (!rueckgaengig) {
    const leiste = document.createElement('div');
    leiste.className = 'rueckgaengig';
    leiste.setAttribute('role', 'status');
    leiste.hidden = true;
    leiste.innerHTML = '<span data-text></span><button type="button" class="knopf knopf-leise">Rückgängig</button>';
    leiste.querySelector('button').addEventListener('click', () => {
      const f = rueckgaengig.f;
      versteckeRueckgaengig();
      f?.();
    });
    document.body.append(leiste);
    rueckgaengig = { leiste, zeitgeber: null, f: null };
  }
  clearTimeout(rueckgaengig.zeitgeber);
  rueckgaengig.f = zurueckholen;
  rueckgaengig.leiste.querySelector('[data-text]').textContent = hinweis;
  rueckgaengig.leiste.hidden = false;
  rueckgaengig.zeitgeber = setTimeout(versteckeRueckgaengig, RUECKGAENGIG_DAUER);
}

function versteckeRueckgaengig() {
  if (!rueckgaengig) return;
  clearTimeout(rueckgaengig.zeitgeber);
  rueckgaengig.f = null;
  rueckgaengig.leiste.hidden = true;
}

// ---------- Teilen, Sichern, Link einfügen ----------

/** Adresse der App ohne alles nach dem „#“ – Basis für Teilen-Links. */
function appAdresse() {
  return `${location.origin}${location.pathname}`;
}

/** Läuft die App als Homescreen-Web-App (nicht in einem Safari-Tab)? */
function imHomescreen() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

async function teileVorlage() {
  const vorlage = aktuelleVorlage();
  if (!vorlage || vorlage.eingebaut) return;
  const link = await erstelleLink([vorlage], appAdresse());
  await teileLink(link, {
    title: vorlage.name,
    text: `Teigvorlage „${vorlage.name}“ fürs Kochbuch – zum Übernehmen den Link öffnen:`,
  });
}

export async function sichereAlle() {
  const liste = eigeneVorlagen(speicher);
  if (liste.length === 0) {
    window.alert('Du hast noch keine eigenen Vorlagen zum Sichern.');
    return;
  }
  const link = await erstelleLink(liste, appAdresse());
  await teileLink(link, {
    title: 'Kochbuch-Sicherung',
    text: `Sicherung meiner ${liste.length} Kochbuch-Vorlagen – der Link enthält alle Vorlagen:`,
  });
}

/** Öffnet das Teilen-Menü; ohne Teilen-Menü (oder wenn es scheitert) wird der Link kopiert. */
async function teileLink(link, inhalt) {
  if (window.navigator.share) {
    try {
      await window.navigator.share({ ...inhalt, url: link });
      return;
    } catch (fehler) {
      if (fehler?.name === 'AbortError') return; // Menü bewusst geschlossen
    }
  }
  await kopiereLink(link);
}

/** Kopiert den Link; geht das nicht, wird er zum Selbstkopieren angezeigt. */
async function kopiereLink(link) {
  if (!link) return;
  try {
    await window.navigator.clipboard.writeText(link);
    meldung = 'Link kopiert. Jetzt in WhatsApp oder Notizen einfügen.';
    return zeichne();
  } catch {
    window.prompt('Link zum Kopieren (lange antippen → Auswählen → Kopieren):', link);
  }
}

/** Link aus der Zwischenablage holen; wenn das nicht geht, zum Einfügen nachfragen. */
async function fuegeLinkEin() {
  let eingabe = '';
  try {
    eingabe = await window.navigator.clipboard.readText();
  } catch {
    eingabe = '';
  }
  if (!hatTeilenCode(eingabe)) {
    eingabe = window.prompt('Link der Vorlage hier einfügen:') ?? '';
    if (!eingabe.trim()) return;
  }
  await liesPaket(eingabe);
}

/** Beim Start und wenn sich die Adresse ändert: steckt ein Teilen-Link in der Adresse? */
async function pruefeAdresse() {
  if (!hatTeilenCode(location.hash)) return;
  await liesPaket(location.href, true);
}

/** Erhaltene Vorlagen werden auf der Startseite angezeigt. */
async function liesPaket(eingabe, ausAdresse = false) {
  const gelesen = await liesLink(eingabe);
  if (!gelesen) {
    meldung = 'In diesem Link habe ich keine Vorlage gefunden. Ist er vollständig kopiert?';
    if (ausAdresse) adresseSaeubern();
    return zeige('liste');
  }
  paket = { ...gelesen, link: ausAdresse ? location.href : eingabe.trim() };
  zeige('liste');
}

function adresseSaeubern() {
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
}

const STATUS_TEXT = {
  neu: 'neu',
  neuer: 'neuere Version – ersetzt deine',
  gleich: 'hast du schon',
  aelter: 'du hast eine neuere Version',
};

/** Karte oben: Was steckt im Link, und wo lässt es sich übernehmen? */
function uebernahmeKarte() {
  const pruefung = pruefeUebernahme(speicher, paket.vorlagen);
  const anzahl = (...status) => pruefung.filter((p) => status.includes(p.status)).length;
  const zuUebernehmen = anzahl('neu', 'neuer');
  const alsKopie = anzahl('neuer', 'aelter');
  const viele = paket.vorlagen.length > 1;

  const zeilen = pruefung.map(({ vorlage: v, status }) => `
      <li><strong>${text(v.name)}</strong>
        <small>${text(zusammenfassung(v))} · ${STATUS_TEXT[status]}</small></li>`).join('');

  const verworfen = paket.verworfen > 0
    ? `<p class="info">${paket.verworfen} Eintrag/Einträge im Link waren unbrauchbar und wurden ausgelassen.</p>` : '';

  const jaText = zuUebernehmen > 1 ? `${zuUebernehmen} Vorlagen übernehmen` : 'Vorlage übernehmen';
  const ja = zuUebernehmen > 0
    ? `<button type="button" class="knopf ${imHomescreen() ? 'knopf-voll' : 'knopf-leise'}" data-aktion="import-ja">
         ${imHomescreen() ? jaText : 'Nur hier im Browser übernehmen'}</button>` : '';
  const kopie = alsKopie > 0
    ? `<button type="button" class="knopf" data-aktion="import-kopie">Zusätzlich als Kopie übernehmen</button>` : '';

  // Im Safari-Tab landet eine Übernahme im Browser-Speicher – getrennt von der Homescreen-App
  const browserHinweis = imHomescreen() ? '' : `
      <p class="hinweis">Du bist im Browser, nicht in der Kochbuch-App auf dem Homescreen.
        Beide haben getrennte Speicher. So kommt die Vorlage in die App: Link kopieren →
        Kochbuch-App vom Homescreen öffnen → unten bei „Teilen und Sichern“ auf „Link einfügen“ tippen.</p>`;
  const kopieren = imHomescreen() ? ''
    : '<button type="button" class="knopf knopf-voll" data-aktion="import-kopieren">Link kopieren</button>';

  return `<section class="karte uebernahme" aria-label="Erhaltene Vorlage">
      <h2 class="karte-titel">${viele ? `${paket.vorlagen.length} Vorlagen erhalten` : 'Vorlage erhalten'}</h2>
      <ul class="uebernahme-liste">${zeilen}</ul>
      ${verworfen}
      ${browserHinweis}
      <div class="aktionen">
        ${kopieren}${ja}${kopie}
        <button type="button" class="knopf knopf-leise" data-aktion="import-weg">Verwerfen</button>
      </div>
    </section>`;
}

function uebernehmePaket(alsKopie) {
  if (!paket) return;
  const ergebnis = uebernehmeVorlagen(speicher, paket.vorlagen, { alsKopie });
  if (ergebnis.fehler > 0) return meldeFehler();
  const ids = paket.vorlagen.map((v) => v.id);
  const einzel = paket.vorlagen.length === 1;
  verwerfePaket(false);
  const gesamt = ergebnis.neu + ergebnis.aktualisiert;
  const neueste = einzel && !alsKopie ? alleVorlagen(speicher).find((v) => v.id === ids[0]) : eigeneVorlagen(speicher).at(-1);
  if (gesamt > 0 && neueste) return ladeUndZeige(neueste, `${gesamt === 1 ? 'Vorlage' : `${gesamt} Vorlagen`} übernommen.`);
  meldung = 'Nichts zu übernehmen – du hast alles schon.';
  zeichne();
}

function verwerfePaket(neuZeichnen = true) {
  paket = null;
  adresseSaeubern();
  if (neuZeichnen) zeichne();
}

/** Einklappbarer Bereich auf der Startseite: Link einfügen und alle Vorlagen sichern. */
function teilenKlappe() {
  return klappe('teilen', 'Teilen und Sichern', `
      <button type="button" class="knopf knopf-voll" data-aktion="einfuegen">Link einfügen</button>
      <p class="info">Hast du einen Vorlagen-Link bekommen (z. B. per WhatsApp)? Link kopieren, hier tippen und einfügen.</p>
      <button type="button" class="knopf" data-aktion="sichern">Alle meine Vorlagen sichern</button>
      <p class="info">Erzeugt einen Link mit allen eigenen Vorlagen. Im Teilen-Menü z. B. in Notizen
        ablegen oder dir selbst schicken. Wer den Link kennt, kann die Vorlagen lesen – nicht öffentlich posten.
        Eigene Mehl- und Saatensorten, die Wasserwerte in den Einstellungen sowie Favoriten und
        ausgeblendete Vorlagen sind nicht enthalten.</p>`);
}

function meldeFehler() {
  window.alert('Speichern hat nicht geklappt. Ist der Speicher des Handys voll?');
}
