// ansicht.js – Oberfläche des Teigrechners.
// Liest Eingaben, ruft den Rechner auf und schreibt die Grammzahlen in die Seite.
// Gerechnet wird hier nichts – das macht ausschließlich rechner.js.
// Gespeichert wird hier nichts direkt – das läuft über vorlagen.js bzw. speicher.js.

import { berechne, gesamtmehlAusMehl, hefeUmrechnen } from './rechner.js';
import {
  alleVorlagen,
  ladeVorlage,
  speichereEigeneVorlage,
  loescheEigeneVorlage,
  istGueltigerTeig,
} from './vorlagen.js';
import { speicher } from '../kern/speicher.js';
import { leseZahl, formatGramm, formatGrammFein, formatProzent } from '../kern/zahlen.js';

const HINWEISE = {
  'starter-zu-viel': 'Mehr Starter als Mehl – bitte den Starter-Anteil verringern.',
  'hydration-zu-niedrig': 'Die Hydration ist niedriger als das Wasser im Starter.',
  'mehlanteile-nicht-100': 'Die Mehlanteile ergeben zusammen nicht 100 %.',
};

// Geräte-Einstellung: der zuletzt offene Teig (wird nicht synchronisiert)
const STAND = 'teig.stand';

let wurzel;   // das HTML-Element, in dem der Teigrechner steht
let zustand;  // { vorlageId, teig, mehl, geaendert } – mehl = zugegebenes Mehl

export function zeigeTeigrechner(ziel) {
  wurzel = ziel;
  zustand = letzterStand() ?? vorlageZustand(alleVorlagen(speicher)[0]);
  zeichne();

  // Ein Zuhörer für alle Felder statt einer pro Feld ("Event-Delegation")
  wurzel.addEventListener('input', beiEingabe);
  wurzel.addEventListener('click', beiKlick);
  // Beim Antippen eines Feldes den Inhalt markieren → einfach drübertippen
  wurzel.addEventListener('focusin', (e) => {
    if (e.target.matches('input')) e.target.select();
  });
}

function vorlageZustand(vorlage) {
  const { teig, mehl } = ladeVorlage(vorlage);
  return { vorlageId: vorlage.id, teig, mehl, geaendert: false };
}

function letzterStand() {
  const stand = speicher.einstellung(STAND);
  if (!stand || !istGueltigerTeig(stand.teig) || typeof stand.mehl !== 'number') return null;
  return stand;
}

function merkeStand() {
  speicher.setzeEinstellung(STAND, zustand);
}

function aktuelleVorlage() {
  return alleVorlagen(speicher).find((v) => v.id === zustand.vorlageId) ?? null;
}

// ---------- Aufbau der Seite (beim Start, beim Laden/Speichern einer Vorlage) ----------

function zeichne() {
  const { teig, mehl, vorlageId } = zustand;
  const vorlage = aktuelleVorlage();
  const eigene = vorlage && !vorlage.eingebaut;

  const vorlagenKnoepfe = alleVorlagen(speicher).map(
    (v) => `<button type="button" class="knopf vorlage" data-vorlage="${text(v.id)}"
              aria-pressed="${v.id === vorlageId}">${text(v.name)}</button>`,
  ).join('');

  const mehlZeilen = teig.mehlsorten
    .map((s, i) => zeileNurGramm(s.name, `mehlsorte-${i}`))
    .join('');

  const quellstueck = teig.saaten?.length
    ? `<li class="zeile-titel">Quellstück</li>
       ${teig.saaten.map((s, i) => zeileNurGramm(s.name, `saat-${i}`)).join('')}
       ${zeileNurGramm('Quellwasser', 'quellwasser')}`
    : '';

  const trocken = teig.hefeArt === 'trocken';
  const hefeName = trocken ? 'Trockenhefe' : 'Frischhefe';
  const hefeWechsel = trocken ? '⇄ frisch' : '⇄ trocken';

  wurzel.innerHTML = `
    <section class="vorlagen" aria-label="Vorlagen">${vorlagenKnoepfe}</section>

    <section class="karte">
      <label class="feld">
        <span class="feld-name">Mehl</span>
        <span class="mit-einheit">
          <input class="eingabe eingabe-gross" data-feld="mehl"
                 inputmode="decimal" autocomplete="off" value="${Math.round(mehl)}">
          <span class="einheit">g</span>
        </span>
      </label>
      <p class="info">Gesamtmehl inkl. Starter:
        <output class="zahl" data-ausgabe="gesamtmehl"></output></p>
    </section>

    <section class="karte">
      <ul class="zutaten">
        ${mehlZeilen}
        ${zeileMitProzent('Wasser', 'Hydration', 'hydration', 'wasser')}
        ${zeileMitProzent('Starter', '100 % Hydration', 'starter', 'starter')}
        ${zeileMitProzent('Salz', '', 'salz', 'salz')}
        ${zeileMitProzent('Öl', '', 'oel', 'oel')}
        ${zeileMitProzent(hefeName, hefeWechsel, 'hefe', 'hefe', true)}
        ${quellstueck}
      </ul>
      <p class="summe">
        <span>Teig gesamt</span>
        <output class="zahl" data-ausgabe="teigGesamt"></output>
      </p>
      <p class="hinweis" data-ausgabe="hinweise" role="status" hidden></p>
    </section>

    <section class="aktionen">
      ${eigene
        ? `<button type="button" class="knopf knopf-voll" data-aktion="aktualisieren" hidden>
             Änderungen in „${text(vorlage.name)}“ speichern</button>`
        : ''}
      <button type="button" class="knopf" data-aktion="neu">Als neue Vorlage speichern</button>
      ${eigene
        ? `<button type="button" class="knopf knopf-leise" data-aktion="loeschen">
             „${text(vorlage.name)}“ löschen</button>`
        : ''}
    </section>`;

  aktualisiere();
}

function zeileNurGramm(name, ausgabe) {
  return `<li class="zeile">
      <span class="zeile-name">${text(name)}</span>
      <output class="gramm zahl" data-ausgabe="${ausgabe}"></output>
    </li>`;
}

function zeileMitProzent(name, zusatz, feld, ausgabe, istHefe = false) {
  const wert = formatProzent(zustand.teig[feld] ?? 0);
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

// ---------- Live-Aktualisierung (bei jedem Tastendruck) ----------

function aktualisiere() {
  const { teig, mehl } = zustand;
  const e = berechne(teig, gesamtmehlAusMehl(teig, mehl));

  const werte = {
    gesamtmehl: e.gesamtmehl,
    wasser: e.wasser,
    starter: e.starter,
    salz: e.salz,
    oel: e.oel,
    quellwasser: e.quellwasser,
    teigGesamt: e.teigGesamt,
  };
  e.mehlsorten.forEach((s, i) => (werte[`mehlsorte-${i}`] = s.gramm));
  e.saaten.forEach((s, i) => (werte[`saat-${i}`] = s.gramm));

  for (const [name, gramm] of Object.entries(werte)) {
    setzeAusgabe(name, `${formatGramm(gramm)} g`);
  }
  // Hefe unter 10 g mit einer Nachkommastelle, sonst wären 0,4 g "0 g"
  setzeAusgabe('hefe', `${e.hefe < 10 ? formatGrammFein(e.hefe) : formatGramm(e.hefe)} g`);

  const hinweis = wurzel.querySelector('[data-ausgabe="hinweise"]');
  hinweis.textContent = e.hinweise.map((h) => HINWEISE[h]).join(' ');
  hinweis.hidden = e.hinweise.length === 0;

  // "Änderungen speichern" nur zeigen, wenn eine eigene Vorlage verändert wurde
  const aktualisieren = wurzel.querySelector('[data-aktion="aktualisieren"]');
  if (aktualisieren) aktualisieren.hidden = !zustand.geaendert;
}

function setzeAusgabe(name, wert) {
  const el = wurzel.querySelector(`[data-ausgabe="${name}"]`);
  if (el) el.textContent = wert;
}

// ---------- Eingaben ----------

function beiEingabe(ereignis) {
  const feld = ereignis.target.dataset.feld;
  if (!feld) return;
  const wert = leseZahl(ereignis.target.value);
  if (feld === 'mehl') {
    zustand.mehl = wert;
  } else {
    zustand.teig[feld] = wert;
  }
  zustand.geaendert = true;
  aktualisiere();
  merkeStand();
}

function beiKlick(ereignis) {
  const vorlageKnopf = ereignis.target.closest('[data-vorlage]');
  if (vorlageKnopf) {
    const vorlage = alleVorlagen(speicher).find((v) => v.id === vorlageKnopf.dataset.vorlage);
    if (vorlage) ladeUndZeige(vorlage);
    return;
  }

  const aktion = ereignis.target.closest('[data-aktion]')?.dataset.aktion;
  if (aktion === 'hefeart') wechsleHefeart();
  if (aktion === 'neu') speichereAlsNeu();
  if (aktion === 'aktualisieren') speichereAenderungen();
  if (aktion === 'loeschen') loescheVorlage();
}

function ladeUndZeige(vorlage) {
  zustand = vorlageZustand(vorlage);
  merkeStand();
  zeichne();
}

function wechsleHefeart() {
  const { teig } = zustand;
  const neu = teig.hefeArt === 'trocken' ? 'frisch' : 'trocken';
  teig.hefe = hefeUmrechnen(teig.hefe, teig.hefeArt, neu);
  teig.hefeArt = neu;
  zustand.geaendert = true;
  merkeStand();
  zeichne();
}

// ---------- Eigene Vorlagen ----------

function speichereAlsNeu() {
  const aktuell = aktuelleVorlage();
  const vorschlag = !aktuell ? '' : aktuell.eingebaut ? `${aktuell.name} (eigene)` : aktuell.name;
  const name = window.prompt('Name der neuen Vorlage:', vorschlag)?.trim();
  if (!name) return; // abgebrochen oder leer

  const neu = speichereEigeneVorlage(speicher, { name, teig: zustand.teig, mehl: zustand.mehl });
  if (!neu) return meldeFehler();
  ladeUndZeige(neu);
}

function speichereAenderungen() {
  const vorlage = aktuelleVorlage();
  if (!vorlage || vorlage.eingebaut) return;
  const gespeichert = speichereEigeneVorlage(speicher, {
    id: vorlage.id,
    name: vorlage.name,
    teig: zustand.teig,
    mehl: zustand.mehl,
  });
  if (!gespeichert) return meldeFehler();
  zustand.geaendert = false;
  merkeStand();
  zeichne();
}

function loescheVorlage() {
  const vorlage = aktuelleVorlage();
  if (!vorlage || vorlage.eingebaut) return;
  if (!window.confirm(`Vorlage „${vorlage.name}“ wirklich löschen?`)) return;
  loescheEigeneVorlage(speicher, vorlage.id);
  // Die Zahlen bleiben stehen, sie gehören nur zu keiner Vorlage mehr
  zustand.vorlageId = null;
  merkeStand();
  zeichne();
}

function meldeFehler() {
  window.alert('Speichern hat nicht geklappt. Ist der Speicher des Handys voll?');
}

// Schützt vor HTML in Namen (wichtig bei eigenen Vorlagen)
function text(wert) {
  return String(wert)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
