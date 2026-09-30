// ansicht.js – Oberfläche des Teigrechners.
// Liest Eingaben, ruft den Rechner auf und schreibt die Grammzahlen in die Seite.
// Gerechnet wird hier nichts – das macht ausschließlich rechner.js.

import { berechne, gesamtmehlAusMehl, hefeUmrechnen } from './rechner.js';
import { VORLAGEN, ladeVorlage } from './vorlagen.js';
import { leseZahl, formatGramm, formatGrammFein, formatProzent } from '../kern/zahlen.js';

const HINWEISE = {
  'starter-zu-viel': 'Mehr Starter als Mehl – bitte den Starter-Anteil verringern.',
  'hydration-zu-niedrig': 'Die Hydration ist niedriger als das Wasser im Starter.',
  'mehlanteile-nicht-100': 'Die Mehlanteile ergeben zusammen nicht 100 %.',
};

let wurzel;   // das HTML-Element, in dem der Teigrechner steht
let zustand;  // { vorlageId, teig, mehl } – mehl = zugegebenes Mehl (Eingabefeld)

export function zeigeTeigrechner(ziel) {
  wurzel = ziel;
  zustand = vorlageZustand(VORLAGEN[0]);
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
  return { vorlageId: vorlage.id, teig, mehl };
}

// ---------- Aufbau der Seite (nur beim Start und beim Laden einer Vorlage) ----------

function zeichne() {
  const { teig, mehl, vorlageId } = zustand;

  const vorlagenKnoepfe = VORLAGEN.map(
    (v) => `<button type="button" class="knopf vorlage" data-vorlage="${v.id}"
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
  aktualisiere();
}

function beiKlick(ereignis) {
  const vorlageKnopf = ereignis.target.closest('[data-vorlage]');
  if (vorlageKnopf) {
    const vorlage = VORLAGEN.find((v) => v.id === vorlageKnopf.dataset.vorlage);
    zustand = vorlageZustand(vorlage);
    zeichne();
    return;
  }

  if (ereignis.target.closest('[data-aktion="hefeart"]')) {
    const { teig } = zustand;
    const neu = teig.hefeArt === 'trocken' ? 'frisch' : 'trocken';
    teig.hefe = hefeUmrechnen(teig.hefe, teig.hefeArt, neu);
    teig.hefeArt = neu;
    zeichne();
  }
}

// Schützt vor HTML in Namen (wichtig, sobald eigene Vorlagen dazukommen)
function text(wert) {
  return String(wert)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
