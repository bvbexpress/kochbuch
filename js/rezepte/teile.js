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
            <span class="schritt-text">${text(s)}</span>
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

/** Notizfeld (wird kurz nach dem Tippen gespeichert). */
export function notizHtml(notiz, p) {
  return `<section class="karte notiz" aria-label="Notiz">
      <label class="feld"><span class="feld-name">Notiz</span>
        <textarea class="eingabe notiz-feld" data-${p}notiz rows="2" maxlength="2000"
                  placeholder="z. B. weniger Salz …" autocomplete="off">${text(notiz)}</textarea></label>
    </section>`;
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
