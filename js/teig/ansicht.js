// ansicht.js – Oberfläche des Teigrechners.
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
  STANDARD_VERLUST,
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
  eigeneVorlagen,
  pruefeUebernahme,
  uebernehmeVorlagen,
} from './vorlagen.js';
import { erstelleLink, liesLink, hatTeilenCode } from './teilen.js';
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
const TEIGLINGE = 'teig.teiglinge';    // Teiglinge-Modus: { aktiv, anzahl, gewicht, verlust }
const AUFFRISCHUNG = 'teig.auffrischung'; // Starter-Auffrischung: { bedarf, rest, verhaeltnis }
const VERHAELTNISSE = [[1, 1, 1], [1, 1.5, 1.5], [1, 2.5, 2.5]]; // Schnellwahl Anstellgut:Mehl:Wasser
const STANDARD_REST = 20;             // g Starter für den Kühlschrank
const EIGENE = '__eigene';             // Auswahl-Eintrag „Eigene Sorte …“

let wurzel;   // das HTML-Element, in dem der Teigrechner steht
let zustand;  // { vorlageId, teig, mehl, geaendert, anpassung } – mehl = zugegebenes Mehl
let katalog;  // { mehle, saaten, wasserVon, verhaeltnisVon, art } – aus den Einstellungen
const offeneKlappen = new Set(); // welche einklappbaren Bereiche offen sind
let paket = null;   // erhaltene Vorlagen aus einem Link, wartet auf „Übernehmen“: { vorlagen, verworfen, link }
let aufHinweis = null; // einmaliger Hinweis in der Starter-Auffrischung
let meldung = null; // einmalige Rückmeldung (wird beim nächsten Zeichnen angezeigt und gelöscht)

export function zeigeTeigrechner(ziel) {
  wurzel = ziel;
  ladeKatalog();
  zustand = letzterStand() ?? vorlageZustand(alleVorlagen(speicher)[0]);
  zeichne();
  pruefeAdresse();
  window.addEventListener('hashchange', pruefeAdresse);

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

/** Einstellung als Zahl ≥ 0 lesen, sonst Ersatzwert (gespeicherte Daten immer prüfen). */
function zahlOder(wert, ersatz) {
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? wert : ersatz;
}

function teiglinge() {
  const t = speicher.einstellung(TEIGLINGE) ?? {};
  return {
    aktiv: t.aktiv === true,
    anzahl: zahlOder(t.anzahl, 4),
    gewicht: zahlOder(t.gewicht, 250),
    verlust: zahlOder(t.verlust, STANDARD_VERLUST),
  };
}

function setzeTeiglinge(aenderung) {
  speicher.setzeEinstellung(TEIGLINGE, { ...teiglinge(), ...aenderung });
}

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

  const tl = teiglinge();
  const hinweisMeldung = meldung;
  meldung = null;

  wurzel.innerHTML = `
    ${hinweisMeldung ? `<p class="karte hinweis-ok" role="status">${text(hinweisMeldung)}</p>` : ''}
    ${paket ? uebernahmeKarte() : ''}
    <section class="vorlagen" aria-label="Vorlagen">${vorlagenKnoepfe}</section>

    <section class="karte">
      <div class="umschaltgruppe" role="group" aria-label="Menge angeben als">
        <button type="button" class="knopf" data-aktion="modus" data-modus="mehl"
                aria-pressed="${!tl.aktiv}">Mehl</button>
        <button type="button" class="knopf" data-aktion="modus" data-modus="teiglinge"
                aria-pressed="${tl.aktiv}">Teiglinge</button>
      </div>
      ${tl.aktiv ? teigeZeilen() : ''}
      <label class="feld">
        <span class="feld-name">Mehl${tl.aktiv ? '<small>errechnet</small>' : ''}</span>
        <span class="mit-einheit">
          <input class="eingabe eingabe-gross" data-feld="mehl" ${tl.aktiv ? 'readonly' : ''}
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
    ${auffrischKlappe()}
    ${einstellungenKlappe()}
    ${teilenKlappe()}

    <section class="aktionen">
      ${eigene
        ? `<button type="button" class="knopf knopf-voll" data-aktion="teilen" ${zustand.geaendert ? 'hidden' : ''}>
             Vorlage teilen</button>
           <button type="button" class="knopf knopf-voll" data-aktion="aktualisieren" hidden>
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

/** Teiglinge-Modus: Anzahl, Gewicht je Teigling, Verlust-Zuschlag. */
function teigeZeilen() {
  const zeile = (name, zusatz, feld, einheit) => `
      <li class="zeile">
        <label class="zeile-name" for="feld-${feld}">${name}${zusatz ? `<small>${zusatz}</small>` : ''}</label>
        <span class="mit-einheit prozent">
          <input class="eingabe" id="feld-${feld}" data-feld="${feld}" inputmode="decimal"
                 autocomplete="off" value="${feldWert(feld)}" aria-label="${name} in ${einheit}">
          <span class="einheit">${einheit}</span>
        </span>
      </li>`;
  return `<ul class="zutaten">
      ${zeile('Anzahl', 'z. B. 4 Pizzen', 'tl-anzahl', '×')}
      ${zeile('Gewicht je Teigling', '', 'tl-gewicht', 'g')}
      ${zeile('Verlust-Zuschlag', 'Rest in der Schüssel', 'tl-verlust', '%')}
    </ul>`;
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
          <input class="eingabe" data-feld="mehlanteil" data-index="${i}" inputmode="decimal" ${teiglinge().aktiv && gramm ? 'readonly' : ''}
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
  if (feld === 'tl-anzahl') return formatProzent(teiglinge().anzahl);
  if (feld === 'tl-gewicht') return formatProzent(teiglinge().gewicht);
  if (feld === 'tl-verlust') return formatProzent(teiglinge().verlust);
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
  const { teig } = zustand;
  // Teiglinge-Modus: Das Mehl folgt aus Anzahl × Gewicht (+ Verlust) und dem Teig
  const tl = teiglinge();
  if (tl.aktiv) zustand.mehl = mehlFuerTeiglinge(teig, tl.anzahl, tl.gewicht, tl.verlust);
  const mehl = zustand.mehl;
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
  zeigeAuffrischung();
  synchronisiereFelder();

  // "Änderungen speichern" nur zeigen, wenn eine eigene Vorlage verändert wurde
  const aktualisieren = wurzel.querySelector('[data-aktion="aktualisieren"]');
  if (aktualisieren) aktualisieren.hidden = !zustand.geaendert;
  // Geteilt wird die gespeicherte Vorlage – darum erst nach dem Speichern
  const teilen = wurzel.querySelector('[data-aktion="teilen"]');
  if (teilen) teilen.hidden = zustand.geaendert;
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

function beiEingabe(ereignis) {
  const ziel = ereignis.target;
  if (ziel.dataset.einstellung) return aendereEinstellung(ziel);
  if (ziel.dataset.auf) return aendereAuffrischung(ziel);
  const feld = ziel.dataset.feld;
  if (!feld) return;
  const wert = leseZahl(ziel.value);
  const { teig } = zustand;

  if (feld === 'mehl') {
    zustand.mehl = wert;
  } else if (feld.startsWith('tl-')) {
    setzeTeiglinge({ [feld.slice(3)]: wert });
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
  if (aktion === 'modus') wechsleModus(knopf.dataset.modus === 'teiglinge');
  if (aktion === 'verhaeltnis') waehleVerhaeltnis(knopf.dataset.wert);
  if (aktion === 'bedarf-uebernehmen') uebernimmBedarf();
  if (aktion === 'sorte-weg') entferneSorte(knopf.dataset.art, knopf.dataset.id);
  if (aktion === 'hefeart') wechsleHefeart();
  if (aktion === 'neu') speichereAlsNeu();
  if (aktion === 'aktualisieren') speichereAenderungen();
  if (aktion === 'loeschen') loescheVorlage();
  if (aktion === 'teilen') teileVorlage();
  if (aktion === 'sichern') sichereAlle();
  if (aktion === 'einfuegen') fuegeLinkEin();
  if (aktion === 'import-ja') uebernehmePaket(false);
  if (aktion === 'import-kopie') uebernehmePaket(true);
  if (aktion === 'import-kopieren') kopiereLink(paket?.link);
  if (aktion === 'import-weg') verwerfePaket();
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

/** Ein Tipper: zwischen Mehl- und Teiglinge-Modus umschalten. */
function wechsleModus(aktiv) {
  setzeTeiglinge({ aktiv });
  zeichne();
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
  const liste = art === 'mehl' ? mehle : saaten;
  const sorte = (art === 'mehl' ? katalog.mehle : katalog.saaten).find((s) => s.id === id);
  if (!sorte) return;
  if (!sorte.eingebaut && !window.confirm(`„${sorte.name}“ löschen?`)) return;
  liste.entferne(speicher, id);
  ladeKatalog();
  zeichne();
}

function ladeUndZeige(vorlage, rueckmeldung = null) {
  zustand = vorlageZustand(vorlage);
  merkeStand();
  meldung = rueckmeldung;
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

async function sichereAlle() {
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

async function liesPaket(eingabe, ausAdresse = false) {
  const gelesen = await liesLink(eingabe);
  if (!gelesen) {
    meldung = 'In diesem Link habe ich keine Vorlage gefunden. Ist er vollständig kopiert?';
    if (ausAdresse) adresseSaeubern();
    return zeichne();
  }
  paket = { ...gelesen, link: ausAdresse ? location.href : eingabe.trim() };
  zeichne();
  window.scrollTo(0, 0);
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
        <small>${formatGramm(v.mehl)} g Mehl, ${formatProzent(v.teig.hydration)} % Wasser · ${STATUS_TEXT[status]}</small></li>`).join('');

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

/** Einklappbarer Bereich unten: Link einfügen und alle Vorlagen sichern. */
function teilenKlappe() {
  return klappe('teilen', 'Teilen und Sichern', `
      <button type="button" class="knopf knopf-voll" data-aktion="einfuegen">Link einfügen</button>
      <p class="info">Hast du einen Vorlagen-Link bekommen (z. B. per WhatsApp)? Link kopieren, hier tippen und einfügen.</p>
      <button type="button" class="knopf" data-aktion="sichern">Alle meine Vorlagen sichern</button>
      <p class="info">Erzeugt einen Link mit allen eigenen Vorlagen. Im Teilen-Menü z. B. in Notizen
        ablegen oder dir selbst schicken. Wer den Link kennt, kann die Vorlagen lesen – nicht öffentlich posten.
        Eigene Mehl- und Saatensorten und die Wasserwerte in den Einstellungen sind nicht enthalten.</p>`);
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
