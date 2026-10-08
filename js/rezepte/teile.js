// teile.js – HTML-Bausteine, die Koch- und Back-Rezepte gemeinsam haben: Schritte (abhakbar, mit Gerät
// und Mengen), Status, Notiz, Geräte-Liste, Vermerk an Konflikt-Kopien. Nur Aufbau, kein Rechnen, kein Speichern.
//
// `p` ist die Vorsilbe der data-Attribute: 'k' beim Kochen (rezepte/kochen.js), 'b' beim Backen
// (rezepte/backen.js) – so stören sich die Klick-Zuhörer der beiden Oberflächen nicht.
//   data-<p>schritt="i"  Schritt abhaken      data-<p>status="erprobt|testen"
//   data-<p>notiz        Notizfeld            data-<p>="haken-weg|behalten|loeschen"

import { text } from '../kern/html.js';
import { mengeText } from './rechner.js';
import { geraeteListe } from './liste.js';

// Zeitangaben im Schritttext: „8–10 Min.“, „1,5 Std.“, „1 Stunde 30 Minuten“, „über Nacht“.
// Nur Anzeige: Der gespeicherte Text bleibt unverändert. Grad („200 °C“) und Gramm sind keine Zeiten.
const ZAHL = String.raw`\d+(?:[.,]\d+)?`;
const EINHEIT = String.raw`(?:Sekunden?|Sek\.?|Minuten?|Min\.?|Stunden?|Std\.?|Stdn\.?|h|Tage?n?)`;
const DAUER = String.raw`${ZAHL}(?:\s*(?:[–—−-]|bis)\s*${ZAHL})?\s*${EINHEIT}`;
const WORT = String.raw`(?:(?:eine?\s+)?(?:halbe|viertel)\s+Stunde|eine\s+(?:Stunde|Minute|Viertelstunde)|über\s+Nacht)`;
const ZEIT = new RegExp(
  String.raw`(?<![\p{L}\d])(?:${DAUER}(?:\s*(?:und\s+)?${DAUER})?|${WORT})(?![\p{L}\d])`, 'giu');

/** Schritttext als HTML (maskiert), Zeitangaben in `<span class="zeit">`. */
export function schrittTextHtml(s) {
  const t = String(s);
  let html = '';
  let ab = 0;
  for (const treffer of t.matchAll(ZEIT)) {
    html += `${text(t.slice(ab, treffer.index))}<span class="zeit">${text(treffer[0])}</span>`;
    ab = treffer.index + treffer[0].length;
  }
  return html + text(t.slice(ab));
}

/**
 * Schritte als Liste. mengen: je Schritt [{ name, menge, einheit }] oder null (keine Mengen); hat ein Eintrag
 * `ausgabe` statt `menge`, bleibt die Zahl leer und wird live eingetragen (`data-ausgabe`, Teig im Back-Rezept).
 * haken: Set der abgehakten Schritte. Der erste offene Schritt ist der aktuelle.
 */
export function schritteHtml(r, { mengen = null, haken, p }) {
  const jetzt = r.schritte.findIndex((_, i) => !haken.has(i));
  const schritte = r.schritte.map((s, i) => {
    const fertig = haken.has(i);
    const chips = (mengen?.[i] ?? []).map((m) => (m.ausgabe
      ? `<span class="menge-chip"><b class="zahl"><output data-ausgabe="${text(m.ausgabe)}"></output></b> ${text(m.name)}</span>`
      : m.menge === null
      ? `<span class="menge-chip">${text(m.name)}, <span class="leise">nach Geschmack</span></span>`
      : `<span class="menge-chip"><b class="zahl">${text(mengeText(m.menge, m.einheit))}</b> ${text(m.name)}</span>`)).join('');
    const geraet = r.schrittgeraete?.[i] ?? '';
    const klasse = fertig ? 'erledigt' : i === jetzt ? 'jetzt' : '';
    return `<li class="schritt ${klasse}">
        <button type="button" class="schritt-knopf" data-${p}schritt="${i}" aria-pressed="${fertig}" ${i === jetzt ? 'aria-current="step"' : ''}>
          <span class="schritt-nr" aria-hidden="true">${fertig ? '✓' : i + 1}</span>
          <span class="schritt-inhalt">
            ${geraet ? `<span class="geraet-tag">${text(geraet)}</span>` : ''}
            <span class="schritt-text">${schrittTextHtml(s)}</span>
            ${chips ? `<span class="schritt-mengen">${chips}</span>` : ''}
          </span>
        </button>
      </li>`;
  }).join('');
  return `<section aria-label="Schritte">
      <ol class="schritte">${schritte || '<li class="info">Keine Schritte.</li>'}</ol>
      ${haken.size ? `<button type="button" class="knopf knopf-leise haken-weg" data-${p}="haken-weg">Alle Haken entfernen</button>` : ''}
    </section>`;
}

/** Umschalter Erprobt / Noch testen. */
export function statusHtml(status, p) {
  return `<div class="umschaltgruppe status" role="group" aria-label="Status">
      <button type="button" class="knopf" data-${p}status="erprobt" aria-pressed="${status === 'erprobt'}">Erprobt</button>
      <button type="button" class="knopf" data-${p}status="testen" aria-pressed="${status === 'testen'}">Noch testen</button>
    </div>`;
}

/**
 * Notiz als einzeilige Vorschau (Kochen und Backen); antippen klappt das Feld zum Lesen und Bearbeiten auf.
 * Leere Notiz: nur „Notiz hinzufügen“. `offen` = Zustand der Klappe (bleibt beim Neuzeichnen).
 */
export function notizKlappeHtml(notiz, p, offen = false) {
  const vorschau = String(notiz ?? '').trim();
  return `<details class="klappe notiz-klappe" data-klappe="notiz" ${offen ? 'open' : ''}>
      <summary aria-label="Notiz">
        <span class="notiz-titel">${vorschau ? 'Notiz' : 'Notiz hinzufügen'}</span>
        ${vorschau ? `<span class="notiz-vorschau">${text(vorschau)}</span>` : ''}
      </summary>
      <div class="klappe-inhalt">
        <textarea class="eingabe notiz-feld" data-${p}notiz rows="3" maxlength="2000"
                  placeholder="z. B. weniger Salz …" aria-label="Notiz" autocomplete="off">${text(notiz)}</textarea>
      </div>
    </details>`;
}

/** „Geräte: Wok · Ofen 200 °C“ oben im Rezept; ohne Geräte nichts. */
export function geraeteHtml(r) {
  const geraete = geraeteListe(r);
  return geraete.length
    ? `<p class="geraete" aria-label="Geräte"><span class="leise">Geräte:</span> ${geraete.map((g) => `<span class="geraet-tag">${text(g)}</span>`).join(' ')}</p>`
    : '';
}

/** Vermerk an einer Konflikt-Kopie mit „Diese behalten“ / „Diese löschen“; ohne Vermerk nichts. */
export function vermerkHtml(vermerk, p) {
  return vermerk ? `<section class="karte vermerk-karte" aria-label="Gleichzeitig geändert">
        <p>${text(vermerk)}</p>
        <div class="aktionen">
          <button type="button" class="knopf knopf-voll" data-${p}="behalten">Diese behalten</button>
          <button type="button" class="knopf knopf-leise" data-${p}="loeschen">Diese löschen</button>
        </div>
      </section>` : '';
}
