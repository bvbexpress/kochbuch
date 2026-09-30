// ansicht.js – Oberfläche des Teigrechners.
// Liest Eingaben, ruft den Rechner auf und schreibt die Grammzahlen in die Seite.
// Gerechnet wird hier nichts – das macht ausschließlich rechner.js.
// Gespeichert wird hier nichts direkt – das läuft über vorlagen.js bzw. speicher.js.

import {
  berechne,
  gesamtmehlAusMehl,
  hefeUmrechnen,
  hydrationNachMehlwechsel,
  mehlsortenMitAnteil,
  mehlsortenMitGramm,
  quellwasserNachSaatwechsel,
  mehlHinweise,
} from './rechner.js';
import {
  alleVorlagen,
  ladeVorlage,
  speichereEigeneVorlage,
  loescheEigeneVorlage,
  istGueltigerTeig,
  normalisiereTeig,
} from './vorlagen.js';
import {
  mehle,
  saaten,
  werteVon,
  artVon,
  STANDARD_WASSER,
  STANDARD_VERHAELTNIS,
} from './zutaten.js';
import { speicher } from '../kern/speicher.js';
import { leseZahl, formatGramm, formatGrammFein, formatProzent } from '../kern/zahlen.js';

const HINWEISE = {
  'starter-zu-viel': 'Mehr Starter als Mehl – bitte den Starter-Anteil verringern.',
  'hydration-zu-niedrig': 'Die Hydration ist niedriger als das Wasser im Starter.',
  'mehlanteile-nicht-100': 'Die Mehlanteile ergeben zusammen nicht 100 %.',
  hafer: 'Hafer nur als Beimischung: Er hat kein Klebereiweiß, der Teig geht damit schlechter auf.',
  'hafer-viel': 'Viel Hafer: Ab 20 % geht der Teig kaum noch auf. Hafer nur als Beimischung verwenden.',
  'roggen-ohne-sauerteig':
    'Ab 50 % Roggen braucht der Teig Säure (Sauerteig), sonst wird die Krume klitschig.',
};

// Geräte-Einstellungen (werden nicht synchronisiert)
const STAND = 'teig.stand';            // der zuletzt offene Teig
const MEHL_EINHEIT = 'teig.mehlEinheit'; // Mehlanteile in 'prozent' oder 'gramm'
const EIGENE = '__eigene';             // Auswahl-Eintrag „Eigene Sorte …“

let wurzel;   // das HTML-Element, in dem der Teigrechner steht
let zustand;  // { vorlageId, teig, mehl, geaendert, anpassung } – mehl = zugegebenes Mehl
let katalog;  // { mehle, saaten, wasserVon, verhaeltnisVon, art } – aus den Einstellungen
const offeneKlappen = new Set(); // welche einklappbaren Bereiche offen sind

export function zeigeTeigrechner(ziel) {
  wurzel = ziel;
  ladeKatalog();
  zustand = letzterStand() ?? vorlageZustand(alleVorlagen(speicher)[0]);
  zeichne();

  // Ein Zuhörer für alle Felder statt einer pro Feld ("Event-Delegation")
  wurzel.addEventListener('input', beiEingabe);
  wurzel.addEventListener('change', beiAuswahl);
  wurzel.addEventListener('click', beiKlick);
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

function ladeKatalog() {
  const mehlListe = mehle.alle(speicher);
  const saatListe = saaten.alle(speicher);
  katalog = {
    mehle: mehlListe,
    saaten: saatListe,
    wasserVon: werteVon(mehlListe, 'wasser', STANDARD_WASSER),
    verhaeltnisVon: werteVon(saatListe, 'verhaeltnis', STANDARD_VERHAELTNIS),
    art: artVon(mehlListe),
  };
}

function vorlageZustand(vorlage) {
  const { teig, mehl } = ladeVorlage(vorlage);
  return { vorlageId: vorlage.id, teig, mehl, geaendert: false, anpassung: neueAnpassung() };
}

/** Summe der automatischen Anpassungen seit dem Laden (für den Hinweis). */
function neueAnpassung() {
  return { wasser: 0, quellwasser: 0 };
}

function letzterStand() {
  const stand = speicher.einstellung(STAND);
  if (!stand || !istGueltigerTeig(stand.teig) || typeof stand.mehl !== 'number') return null;
  return { ...stand, teig: normalisiereTeig(stand.teig), anpassung: stand.anpassung ?? neueAnpassung() };
}

function mehlEinheit() {
  return speicher.einstellung(MEHL_EINHEIT) === 'gramm' ? 'gramm' : 'prozent';
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

  const mehrereMehle = teig.mehlsorten.length > 1;
  const mehlZeilen = teig.mehlsorten
    .map((s, i) => zeileNurGramm(s.name, `mehlsorte-${i}`, mehrereMehle ? `mehlanteil-${i}` : ''))
    .join('');

  const quellstueck = teig.saaten.length
    ? `<li class="zeile-titel">Quellstück</li>
       ${teig.saaten.map((s, i) => zeileMitProzent(s.name, '', `saat-${i}`, `saat-${i}`)).join('')}
       ${zeileMitProzent('Quellwasser', 'Vorschlag, änderbar', 'quellwasser', 'quellwasser')}`
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
      <p class="info" data-ausgabe="anpassung" hidden></p>
      <p class="hinweis" data-ausgabe="hinweise" role="status" hidden></p>
    </section>

    ${mehlKlappe()}
    ${saatenKlappe()}
    ${einstellungenKlappe()}

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

// ---------- Einklappbare Bereiche: Mehle, Saaten, Einstellungen ----------

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
          <input class="eingabe" data-feld="mehlanteil" data-index="${i}" inputmode="decimal"
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

function saatenKlappe() {
  const { saaten: gewaehlt } = zustand.teig;
  const verwendet = new Set(gewaehlt.map((s) => s.id));
  const zeilen = gewaehlt.map((s, i) => `
      <li class="zeile zeile-wahl zeile-wahl-kurz">
        ${auswahl({ liste: katalog.saaten, gewaehlt: s.id, ausser: verwendet, name: s.name,
          daten: `data-wahl="saat" data-index="${i}" aria-label="Saat ${i + 1}"`,
          eigeneText: 'Eigene Saat …' })}
        <button type="button" class="knopf knopf-leise knopf-weg" data-aktion="saat-weg"
                data-index="${i}" aria-label="${text(s.name)} entfernen">✕</button>
      </li>`).join('');

  return klappe('saaten', 'Quellstück: Saaten wählen', `
      <ul class="zutaten">${zeilen}</ul>
      ${auswahl({ liste: katalog.saaten, ausser: verwendet, daten: 'data-wahl="saat-neu" aria-label="Saat hinzufügen"',
        leer: '+ Saat hinzufügen', eigeneText: 'Eigene Saat …' })}
      <p class="info">Neue Saaten starten mit 5 % vom Mehl. Die Menge stellst du oben im Quellstück ein,
        das Quellwasser rechnet die App dazu.</p>`);
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
      <p class="info">Änderungen gelten ab dem nächsten Tauschen oder Mischen.
        Gespeicherte Vorlagen behalten ihr Wasser.</p>`);
}

/** Text, der in einem Eingabefeld steht. */
function feldWert(feld, index) {
  const { teig, mehl } = zustand;
  if (feld === 'mehl') return String(Math.round(mehl));
  if (feld === 'mehlanteil') {
    if (mehlEinheit() === 'gramm') {
      const e = berechne(teig, gesamtmehlAusMehl(teig, mehl));
      return String(Math.round(e.mehlsorten[index]?.gramm ?? 0));
    }
    return formatProzent(teig.mehlsorten[index]?.anteil ?? 0);
  }
  if (feld.startsWith('saat-')) return formatProzent(teig.saaten[Number(feld.slice(5))]?.prozent ?? 0);
  if (feld === 'quellwasser') return formatProzent(Math.max(teig.quellwasser ?? 0, 0));
  return formatProzent(teig[feld] ?? 0);
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
  const anteile = teig.mehlsorten.reduce((a, s) => a + s.anteil, 0);
  teig.mehlsorten.forEach((s, i) =>
    setzeAusgabe(`mehlanteil-${i}`, `${formatProzent(anteile > 0 ? (s.anteil / anteile) * 100 : 0)} %`));

  e.hinweise.push(...mehlHinweise(teig, katalog.art));
  // Hefe unter 10 g mit einer Nachkommastelle, sonst wären 0,4 g "0 g"
  setzeAusgabe('hefe', `${e.hefe < 10 ? formatGrammFein(e.hefe) : formatGramm(e.hefe)} g`);

  const hinweis = wurzel.querySelector('[data-ausgabe="hinweise"]');
  hinweis.textContent = e.hinweise.map((h) => HINWEISE[h]).join(' ');
  hinweis.hidden = e.hinweise.length === 0;

  zeigeAnpassung(e);
  synchronisiereFelder();

  // "Änderungen speichern" nur zeigen, wenn eine eigene Vorlage verändert wurde
  const aktualisieren = wurzel.querySelector('[data-aktion="aktualisieren"]');
  if (aktualisieren) aktualisieren.hidden = !zustand.geaendert;
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

function beiEingabe(ereignis) {
  const ziel = ereignis.target;
  if (ziel.dataset.einstellung) return aendereEinstellung(ziel);
  const feld = ziel.dataset.feld;
  if (!feld) return;
  const wert = leseZahl(ziel.value);
  const { teig } = zustand;

  if (feld === 'mehl') {
    zustand.mehl = wert;
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
  } else {
    teig[feld] = wert;
    // Selbst eingetippt: ab hier ist das der neue Ausgangswert
    if (feld === 'hydration') zustand.anpassung.wasser = 0;
    if (feld === 'quellwasser') zustand.anpassung.quellwasser = 0;
  }
  zustand.geaendert = true;
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

function aendereEinstellung(feld) {
  const liste = feld.dataset.einstellung === 'mehl' ? mehle : saaten;
  liste.setzeWert(speicher, feld.dataset.id, leseZahl(feld.value));
  ladeKatalog();
  aktualisiere();
}

// ---------- Auswahllisten (Mehl/Saat tauschen oder hinzufügen) ----------

function beiAuswahl(ereignis) {
  const ziel = ereignis.target;
  const wahl = ziel.dataset.wahl;
  if (!wahl) return;
  const istMehl = wahl.startsWith('mehl');
  const id = ziel.value === EIGENE ? legeEigeneSorteAn(istMehl) : ziel.value;
  if (!id) return zeichne(); // abgebrochen: Auswahl zurücksetzen

  const liste = istMehl ? katalog.mehle : katalog.saaten;
  const sorte = liste.find((s) => s.id === id);
  if (!sorte) return zeichne();
  const { teig } = zustand;
  const index = Number(ziel.dataset.index);

  if (wahl === 'mehl') {
    setzeMehlsorten(teig.mehlsorten.map((s, i) => (i === index ? { ...s, id, name: sorte.name } : s)));
  } else if (wahl === 'mehl-neu') {
    const anteil = teig.mehlsorten.length === 0 ? 100 : 0;
    setzeMehlsorten([...teig.mehlsorten, { id, name: sorte.name, anteil }]);
  } else if (wahl === 'saat') {
    setzeSaaten(teig.saaten.map((s, i) => (i === index ? { ...s, id, name: sorte.name } : s)));
  } else if (wahl === 'saat-neu') {
    setzeSaaten([...teig.saaten, { id, name: sorte.name, prozent: 5 }]);
  }
  zustand.geaendert = true;
  merkeStand();
  zeichne();
}

/** Fragt Namen (und Wert) für eine eigene Sorte ab. Gibt die neue id zurück oder null. */
function legeEigeneSorteAn(istMehl) {
  const name = window.prompt(istMehl ? 'Name des Mehls:' : 'Name der Saat:')?.trim();
  if (!name) return null;
  const frage = istMehl
    ? 'Wasseraufnahme in % (typische Hydration, z. B. 65):'
    : 'Gramm Wasser je Gramm Saat (z. B. 1):';
  const start = istMehl ? STANDARD_WASSER : STANDARD_VERHAELTNIS;
  const eingabe = window.prompt(frage, formatProzent(start));
  const wert = eingabe === null || leseZahl(eingabe) === 0 ? start : leseZahl(eingabe);
  const neu = (istMehl ? mehle : saaten).neu(speicher, name, wert);
  if (!neu) {
    meldeFehler();
    return null;
  }
  ladeKatalog();
  return neu.id;
}

function beiKlick(ereignis) {
  const vorlageKnopf = ereignis.target.closest('[data-vorlage]');
  if (vorlageKnopf) {
    const vorlage = alleVorlagen(speicher).find((v) => v.id === vorlageKnopf.dataset.vorlage);
    if (vorlage) ladeUndZeige(vorlage);
    return;
  }

  const knopf = ereignis.target.closest('[data-aktion]');
  const aktion = knopf?.dataset.aktion;
  if (aktion === 'mehl-weg') entferneMehl(Number(knopf.dataset.index));
  if (aktion === 'saat-weg') entferneSaat(Number(knopf.dataset.index));
  if (aktion === 'einheit') wechsleEinheit(knopf.dataset.einheit);
  if (aktion === 'sorte-weg') entferneSorte(knopf.dataset.art, knopf.dataset.id);
  if (aktion === 'hefeart') wechsleHefeart();
  if (aktion === 'neu') speichereAlsNeu();
  if (aktion === 'aktualisieren') speichereAenderungen();
  if (aktion === 'loeschen') loescheVorlage();
}

function entferneMehl(index) {
  const rest = zustand.teig.mehlsorten.filter((_, i) => i !== index);
  // Übrige Anteile wieder auf 100 % bringen, im gleichen Verhältnis
  const summe = rest.reduce((a, s) => a + s.anteil, 0);
  setzeMehlsorten(rest.map((s) => ({
    ...s,
    anteil: summe > 0 ? (s.anteil / summe) * 100 : 100 / rest.length,
  })));
  zustand.geaendert = true;
  merkeStand();
  zeichne();
}

function entferneSaat(index) {
  setzeSaaten(zustand.teig.saaten.filter((_, i) => i !== index));
  zustand.geaendert = true;
  merkeStand();
  zeichne();
}

function wechsleEinheit(einheit) {
  speicher.setzeEinstellung(MEHL_EINHEIT, einheit);
  zeichne();
}

/** Eigene Sorte löschen oder eingebaute auf den Standardwert zurücksetzen. */
function entferneSorte(art, id) {
  const liste = art === 'mehl' ? mehle : saaten;
  const sorte = (art === 'mehl' ? katalog.mehle : katalog.saaten).find((s) => s.id === id);
  if (!sorte) return;
  if (!sorte.eingebaut && !window.confirm(`„${sorte.name}“ löschen?`)) return;
  liste.entferne(speicher, id);
  ladeKatalog();
  zeichne();
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
