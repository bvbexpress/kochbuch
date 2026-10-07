// startseite.js – HTML der Back-Liste (früher: Vorlagenliste auf der Startseite).
// Nur der Aufbau; Ordnen und Filtern macht vorlagen.js (`ordneVorlagen`, gilt auch für Back-Rezepte),
// die Klicks verarbeitet ansicht.js.

import { ladeVorlage } from './vorlagen.js';
import { formatGramm, formatProzent } from '../kern/zahlen.js';
import { text } from '../kern/html.js';

/**
 * Kurzinfo zu einer Vorlage, mit denselben Werten wie im Rechner:
 * „300 g Mehl · 76,9 %“ bzw. „4 × 250 g · 65 %“ (Prozent = Hydration).
 */
export function zusammenfassung(vorlage) {
  const { teig, mehl, modus, teiglinge } = ladeVorlage(vorlage);
  const menge = modus === 'teiglinge' && teiglinge
    ? `${formatProzent(teiglinge.anzahl)} × ${formatGramm(teiglinge.gewicht)} g`
    : `${formatGramm(mehl)} g Mehl`;
  return `${menge} · ${formatProzent(teig.hydration)} %`;
}

export function suchfeldHtml(suche) {
  return `<input class="eingabe suche" type="search" data-suche placeholder="Rezept suchen …"
            aria-label="Rezept suchen" autocomplete="off" enterkeyhint="search" value="${text(suche)}">`;
}

/**
 * Favoriten, Gruppen und ausgeblendete Vorlagen.
 * ordnung: Ergebnis von `ordneVorlagen`; sterne: Set der Favoriten-ids;
 * bekannt: Set der schon geöffneten Rezepte (ohne Angabe keine „Neu“-Markierung);
 * ausgeblendetOffen: ist die Klappe „Ausgeblendet“ offen?
 * Back-Rezepte (seit Etappe 3, D) zeigen „Neu“ bis zum ersten Öffnen und „Noch testen“.
 */
export function vorlagenListeHtml(ordnung, { sterne, suche, ausgeblendetOffen, bekannt = null }) {
  const zeile = (v) => {
    const stern = sterne.has(v.id);
    const neu = bekannt !== null && !bekannt.has(v.id);
    const info = zusammenfassung(v) + (v.status === 'testen' ? ' · Noch testen' : '');
    // Nach links wischen zeigt den roten Knopf hinter der Zeile (siehe `beiWischen` in ansicht.js)
    return `<li class="vorlage-zeile" data-zeile>
        <button type="button" class="vorlage-weg" data-weg="${text(v.id)}" tabindex="-1">${v.eingebaut ? 'Ausblenden' : 'Löschen'}</button>
        <div class="vorlage-inhalt">
          <button type="button" class="vorlage-oeffnen" data-oeffnen="${text(v.id)}">
            <span class="vorlage-name">${text(v.name)}${neu ? ' <span class="neu">Neu</span>' : ''}</span>
            <small class="zahl">${text(info)}</small>
            ${v.konflikt ? '<small class="vermerk">Gleichzeitig geändert – bitte ansehen</small>' : ''}
          </button>
          <button type="button" class="stern" data-stern="${text(v.id)}" aria-pressed="${stern}"
                  aria-label="${text(v.name)} ${stern ? 'aus den Favoriten nehmen' : 'als Favorit markieren'}">${stern ? '★' : '☆'}</button>
        </div>
      </li>`;
  };
  const gruppe = (titel, vorlagen) => `
      <section class="gruppe">
        <h2 class="gruppe-titel">${titel}</h2>
        <ul class="vorlagen-liste">${vorlagen.map(zeile).join('')}</ul>
      </section>`;

  const teile = [];
  if (ordnung.favoriten.length) teile.push(gruppe('★ Favoriten', ordnung.favoriten));
  for (const g of ordnung.gruppen) teile.push(gruppe(text(g.name), g.vorlagen));
  if (teile.length === 0) {
    teile.push(`<p class="info">${suche.trim() ? 'Kein Rezept gefunden.' : 'Noch keine Rezepte.'}</p>`);
  }

  if (ordnung.ausgeblendet.length) {
    const zeilen = ordnung.ausgeblendet.map((v) => `
        <li class="zeile zeile-einblenden">
          <span class="zeile-name">${text(v.name)}</span>
          <button type="button" class="knopf knopf-leise" data-einblenden="${text(v.id)}">Einblenden</button>
        </li>`).join('');
    teile.push(`<details class="klappe" data-klappe="ausgeblendet" ${ausgeblendetOffen ? 'open' : ''}>
        <summary>Ausgeblendet (${ordnung.ausgeblendet.length})</summary>
        <div class="klappe-inhalt"><ul class="zutaten">${zeilen}</ul></div>
      </details>`);
  }
  return teile.join('');
}
