// backplan.js – Backplan rückwärts (Etappe 3, nach E): Wann muss ich womit anfangen?
//
// Aus den Zeiten der Schritttexte (zeit.js) wird eine Liste „Uhrzeit – Schritt“ gerechnet:
//   „Fertig um“  rückwärts vom Ende des letzten Back-Schritts (= aus dem Ofen),
//   „Ab jetzt“   vorwärts, zeigt, wann es fertig wäre.
// Nichts wird gespeichert, es gibt kein neues Datenmodell. Spannen („2–3 Std.“) zählen mit der Mitte,
// Schritte ohne Zeit mit 5 Min., „über Nacht“ ist ein Fenster (siehe unten). Danach folgende Schritte
// (auskühlen …) stehen nur als Hinweis. Der Teil bis `berechneBackplan` rechnet, der Rest ist Oberfläche.

import { text } from '../kern/html.js';
import { leseZahl } from '../kern/zahlen.js';
import { schrittTextHtml } from './teile.js';
import { schrittDauer } from './zeit.js';

export const STANDARD_MIN = 5;          // Schritt ohne Zeit
export const NACHT_JETZT_MIN = 10 * 60; // „Ab jetzt“: angenommene Nacht
export const NACHT_VON_STD = 8;         // übliches Fenster der Nacht (nur Hinweis, wenn außerhalb)
export const NACHT_BIS_STD = 14;
export const VORHEIZEN_MIN = 45;
export const REIFE_STANDARD_STD = 6;
export const ABEND_STANDARD = '21:30';

const MIN = 60_000;
const auf5 = (min) => Math.max(5, Math.round(min / 5) * 5);

/** Dauer in Minuten als Text: „25 Min.“, „1 Std. 30 Min.“, „3 Std.“. */
export function dauerText(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} Std. ${m % 60} Min.` : `${h} Std.`;
}

const stdText = (min) => `${String(Math.round(min / 30) / 2).replace('.', ',')} Std.`;

/** Schritte mit Dauer: { i, text, geraet, min (gerechnet), spanne, nacht, ohneZeit }. */
function schritteMitDauer(r) {
  return r.schritte.map((t, i) => {
    const d = schrittDauer(t);
    const nacht = Boolean(d?.nacht);
    const spanne = d && !nacht && d.min !== d.max;
    return {
      i, text: t, geraet: r.schrittgeraete?.[i] ?? '',
      nacht, spanne, ohneZeit: !d,
      min: nacht ? NACHT_JETZT_MIN : d ? auf5((d.min + d.max) / 2) : STANDARD_MIN,
    };
  });
}

const istOfen = (s) => /^ofen/i.test(s.geraet);

/** Letzter Schritt, der zum Backen gehört (Ofen oder „back…“ im Text); sonst der letzte Schritt. */
function endeIndex(schritte) {
  for (let i = schritte.length - 1; i >= 0; i--) {
    if (istOfen(schritte[i]) || /back/i.test(schritte[i].text)) return i;
  }
  return schritte.length - 1;
}

/** Erster Schritt, der Starter braucht (aus `schrittteig`, sonst am Text, sonst der erste). */
function starterIndex(r, schritte) {
  const nachTeig = r.schrittteig?.findIndex((je) => je?.some((t) => t.teil === 'starter')) ?? -1;
  if (nachTeig >= 0) return nachTeig;
  const nachText = schritte.findIndex((s) => /starter|sauerteig|anstellgut/i.test(s.text));
  return nachText >= 0 ? nachText : 0;
}

/** Erster Schritt im heißen Ofen (Gerät „Ofen …“, ohne Gradangabe oder ab 150 °C); -1 wenn keiner. */
function ofenIndex(schritte, bis) {
  return schritte.slice(0, bis + 1).findIndex((s) => {
    if (!istOfen(s)) return false;
    const grad = s.geraet.match(/(\d+)\s*°/);
    return !grad || Number(grad[1]) >= 150;
  });
}

/** Späteste Uhrzeit „HH:MM“ am oder vor `grenze` (ms). */
function letzteUhrzeit(hhmm, grenze) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(grenze);
  d.setHours(h, m, 0, 0);
  if (d.getTime() > grenze) d.setDate(d.getDate() - 1);
  return d.getTime();
}

const gueltigeUhrzeit = (s) => /^\d{1,2}:\d{2}$/.test(String(s ?? ''));

/**
 * Backplan rechnen. r = Back-Rezept (schritte, schrittgeraete, schrittteig).
 * opt: { modus: 'fertig' | 'jetzt', fertig: Date, jetzt: Date, abend: 'HH:MM', starter: bool, reifeStd: Zahl }
 * Ergebnis: { zeilen: [{ zeit: Date, art, text, geraet, dauer, schritt }], fertig: Date|null, danach: [Text],
 *             hinweise: [Text], zuSpaet: bool, hatNacht: bool }
 * art: 'schritt' | 'nacht' | 'starter' | 'ofen' | 'fertig'
 */
export function berechneBackplan(r, opt) {
  const alle = schritteMitDauer(r);
  const leer = { zeilen: [], fertig: null, danach: [], hinweise: [], zuSpaet: false, hatNacht: false };
  if (!alle.length) return leer;

  const ende = endeIndex(alle);
  const folge = alle.slice(0, ende + 1);
  const danach = alle.slice(ende + 1).map((s) => s.text);
  const nachtIndex = folge.findIndex((s) => s.nacht);
  const rueckwaerts = opt.modus !== 'jetzt';
  const jetzt = Math.ceil(opt.jetzt.getTime() / (5 * MIN)) * 5 * MIN;
  const hinweise = [];
  const start = new Array(folge.length);
  let nachtMin = null;
  let fertig;

  if (rueckwaerts) {
    if (!(opt.fertig instanceof Date) || Number.isNaN(opt.fertig.getTime())) return { ...leer, hatNacht: nachtIndex >= 0 };
    fertig = opt.fertig.getTime();
    let zeiger = fertig;
    for (let i = ende; i >= 0; i--) {
      if (i === nachtIndex && gueltigeUhrzeit(opt.abend)) {
        // Die Nacht ist das flexible Fenster: von „abends in den Kühlschrank“ bis zum Morgen-Schritt.
        // Der Abend liegt mindestens 8 Std. vor dem Ende der Nacht, aber so spät wie möglich.
        const abend = letzteUhrzeit(opt.abend, zeiger - NACHT_VON_STD * 60 * MIN);
        nachtMin = (zeiger - abend) / MIN;
        zeiger = abend;
      } else {
        zeiger -= folge[i].min * MIN;
      }
      start[i] = zeiger;
    }
  } else {
    let zeiger = jetzt;
    folge.forEach((s, i) => { start[i] = zeiger; zeiger += s.min * MIN; });
    fertig = zeiger;
    if (nachtIndex >= 0) nachtMin = folge[nachtIndex].min;
  }

  // Vorlauf: Starter auffrischen und Ofen vorheizen laufen neben den Schritten her
  const vorlauf = [];
  if (opt.starter) {
    const std = opt.reifeStd > 0 ? opt.reifeStd : REIFE_STANDARD_STD;
    const s = Math.min(starterIndex(r, alle), ende);
    vorlauf.push({ zeit: start[s] - std * 60 * MIN, art: 'starter', text: 'Starter auffrischen', geraet: '',
      dauer: `Reifezeit ${stdText(std * 60)}`, schritt: s });
  }
  const heiss = ofenIndex(alle, ende);
  if (heiss >= 0 && !alle.some((s) => /vorheiz/i.test(s.text))) {
    vorlauf.push({ zeit: start[heiss] - VORHEIZEN_MIN * MIN, art: 'ofen', text: 'Ofen vorheizen',
      geraet: alle[heiss].geraet, dauer: `${VORHEIZEN_MIN} Min.`, schritt: heiss });
  }

  if (!rueckwaerts) {
    // „Ab jetzt“: Beginnt ein Vorlauf vor jetzt, wird alles entsprechend nach hinten geschoben
    const frueh = Math.min(...vorlauf.map((v) => v.zeit), jetzt);
    const schub = jetzt - frueh;
    if (schub > 0) {
      start.forEach((_, i) => { start[i] += schub; });
      vorlauf.forEach((v) => { v.zeit += schub; });
      fertig += schub;
    }
  }

  const zeilen = folge.map((s, i) => ({
    zeit: new Date(start[i]), art: s.nacht ? 'nacht' : 'schritt', text: s.text, geraet: s.geraet, schritt: i,
    dauer: s.nacht
      ? (rueckwaerts && nachtMin !== null ? stdText(nachtMin) : `ca. ${stdText(s.min)}`)
      : s.ohneZeit ? `${dauerText(s.min)} angenommen` : s.spanne ? `ca. ${dauerText(s.min)}` : dauerText(s.min),
  }));
  zeilen.push(...vorlauf.map((v) => ({ ...v, zeit: new Date(v.zeit) })));
  zeilen.sort((a, b) => a.zeit - b.zeit); // stabil: gleiche Zeit bleibt in Schritt-Reihenfolge
  zeilen.push({ zeit: new Date(fertig), art: 'fertig', text: 'Fertig, aus dem Ofen', geraet: '', dauer: '', schritt: ende });

  if (rueckwaerts && nachtIndex >= 0 && nachtMin !== null) {
    // Kürzer als 8 Std. wird die Nacht nie (der Abend liegt mindestens so weit vor dem Morgen)
    if (nachtMin > NACHT_BIS_STD * 60) {
      hinweise.push(`Die Nacht dauert ${stdText(nachtMin)} (üblich ${NACHT_VON_STD}–${NACHT_BIS_STD} Std.). `
        + 'Später in den Kühlschrank oder früher fertig wählen.');
    }
  }
  const erster = Math.min(...zeilen.map((z) => z.zeit.getTime()));
  const zuSpaet = rueckwaerts && erster < Math.floor(opt.jetzt.getTime() / MIN) * MIN;
  if (zuSpaet) hinweise.push('Der Anfang läge schon in der Vergangenheit. Später fertig wählen oder „Ab jetzt“ nehmen.');

  return { zeilen, fertig: new Date(fertig), danach, hinweise, zuSpaet, hatNacht: nachtIndex >= 0 };
}

// ---------------------------------------------------------------------------------------------
// Oberfläche: Klappe „Backplan“ im Back-Rezept. Eigene `data-bp…`-Attribute. Eingaben gelten nur,
// solange die App offen ist (nichts wird gespeichert).

const zustand = { modus: 'fertig', fertig: null, abend: ABEND_STANDARD, starter: false, reife: String(REIFE_STANDARD_STD) };

const zweistellig = (n) => String(n).padStart(2, '0');

/** Wert für `<input type="datetime-local">` (Ortszeit). */
export function lokalText(d) {
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}T${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`;
}

/** Vorschlag, solange noch nichts gewählt ist: morgen 18:00. */
export function standardFertig(jetzt = new Date()) {
  const d = new Date(jetzt);
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
}

const uhr = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const tag = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
const gleicherTag = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Die Liste als HTML (maskiert). */
export function backplanListeHtml(plan, modus) {
  if (!plan.zeilen.length) return '<p class="info">Tag und Uhrzeit wählen, dann steht hier der Plan.</p>';
  let zuletzt = null;
  const zeilen = plan.zeilen.map((z) => {
    const kopf = !zuletzt || !gleicherTag(zuletzt, z.zeit) ? `<li class="bp-tag" aria-hidden="true">${text(tag.format(z.zeit))}</li>` : '';
    zuletzt = z.zeit;
    const klein = [z.geraet, z.dauer].filter(Boolean).map(text).join(' · ');
    return `${kopf}<li class="bp-zeile bp-${z.art}">
        <span class="bp-zeit zahl">${uhr.format(z.zeit)}</span>
        <span class="bp-inhalt">
          <span class="bp-text">${z.art === 'schritt' || z.art === 'nacht' ? schrittTextHtml(z.text) : text(z.text)}</span>
          ${klein ? `<small class="leise">${klein}</small>` : ''}
        </span>
      </li>`;
  }).join('');
  const fertig = modus === 'jetzt' && plan.fertig
    ? `<p class="hinweis hinweis-ok">Fertig am <b class="zahl">${text(tag.format(plan.fertig))}, ${uhr.format(plan.fertig)}</b></p>` : '';
  const hinweise = plan.hinweise.map((h) => `<p class="hinweis">${text(h)}</p>`).join('');
  const danach = plan.danach.length
    ? `<p class="info">Danach (nicht eingerechnet): ${plan.danach.map(text).join(' · ')}</p>` : '';
  return `${fertig}${hinweise}<ol class="bp-liste">${zeilen}</ol>${danach}`;
}

function planAusZustand(r) {
  return berechneBackplan(r, {
    modus: zustand.modus,
    fertig: zustand.fertig ? new Date(zustand.fertig) : null,
    jetzt: new Date(),
    abend: zustand.abend,
    starter: zustand.starter,
    reifeStd: leseZahl(zustand.reife),
  });
}

/**
 * Klappe „Backplan“ für das Back-Rezept r. teig = der eingestellte Teig (Schalter „Starter“ nur, wenn er Starter hat).
 * offen = Zustand der Klappe (bleibt beim Neuzeichnen).
 */
export function backplanKlappeHtml(r, teig, offen = false) {
  if (!r.schritte.length) return '';
  if (!zustand.fertig) zustand.fertig = lokalText(standardFertig());
  const plan = planAusZustand(r);
  const mitStarter = teig.starter > 0;
  const knopf = (wert, name) => `<button type="button" class="knopf" data-bp="modus" data-wert="${wert}"
        aria-pressed="${zustand.modus === wert}">${name}</button>`;
  return `<details class="klappe" data-klappe="backplan" ${offen ? 'open' : ''}>
      <summary>Backplan</summary>
      <div class="klappe-inhalt backplan">
        <div class="umschaltgruppe" role="group" aria-label="Plan">${knopf('fertig', 'Fertig um …')}${knopf('jetzt', 'Ab jetzt')}</div>
        ${zustand.modus === 'fertig' ? `<label class="feld">
            <span class="feld-name">Fertig, aus dem Ofen</span>
            <input class="eingabe" type="datetime-local" data-bp="fertig" value="${text(zustand.fertig)}">
          </label>` : ''}
        ${zustand.modus === 'fertig' && plan.hatNacht ? `<label class="feld">
            <span class="feld-name">Abends in den Kühlschrank um</span>
            <input class="eingabe" type="time" data-bp="abend" value="${text(zustand.abend)}">
          </label>` : ''}
        ${mitStarter ? `<button type="button" class="knopf" data-bp="starter" aria-pressed="${zustand.starter}">Starter vorher auffrischen</button>` : ''}
        ${mitStarter && zustand.starter ? `<label class="feld">
            <span class="feld-name">Reifezeit des Starters</span>
            <span class="mit-einheit">
              <input class="eingabe" data-bp="reife" inputmode="decimal" autocomplete="off" value="${text(zustand.reife)}">
              <span class="einheit">Std.</span>
            </span>
          </label>` : ''}
        <div data-bp-ergebnis>${backplanListeHtml(plan, zustand.modus)}</div>
      </div>
    </details>`;
}

/**
 * Einmal beim Start. rezept() = gerade offenes Back-Rezept (oder null), neuZeichnen = Rezept neu zeichnen.
 * Umschalter zeichnen neu (Felder kommen und gehen), Eingaben ändern nur die Liste (der Cursor bleibt im Feld).
 */
export function startBackplan(wurzel, { rezept, neuZeichnen }) {
  wurzel.addEventListener('click', (e) => {
    const knopf = e.target.closest('button[data-bp]');
    if (!knopf) return;
    if (knopf.dataset.bp === 'modus') zustand.modus = knopf.dataset.wert === 'jetzt' ? 'jetzt' : 'fertig';
    else if (knopf.dataset.bp === 'starter') zustand.starter = !zustand.starter;
    else return;
    neuZeichnen();
  });
  const beiEingabe = (e) => {
    const feld = e.target.closest?.('input[data-bp]');
    if (!feld) return;
    const wert = feld.dataset.bp;
    if (wert === 'fertig' || wert === 'abend' || wert === 'reife') zustand[wert] = feld.value;
    const r = rezept();
    const ziel = wurzel.querySelector('[data-bp-ergebnis]');
    if (r && ziel) ziel.innerHTML = backplanListeHtml(planAusZustand(r), zustand.modus);
  };
  wurzel.addEventListener('input', beiEingabe);
  wurzel.addEventListener('change', beiEingabe);
}
