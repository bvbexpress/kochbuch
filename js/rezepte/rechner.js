// rechner.js (Rezepte) – Mengen umrechnen. Die Oberfläche rechnet nicht selbst.
//
// Kochen: Faktor = gewünschte Portionen / Portionen im Rezept.
// Backen: Faktor = gewünschtes Mehl / Mehl im Rezept (bei Teiglingen: Mehl aus Anzahl × Gewicht).
//   Mehl, Wasser, Salz … rechnet der Teigrechner (teig/rechner.js); hier skalieren nur die übrigen
//   Zutaten (Belag …) und die Portionen mit.
//
// Regel je Zutat: linear = Menge × Faktor · ganz = auf ganze Stück gerundet, mindestens 1 ·
// fix = bleibt gleich (z. B. 1 Päckchen Backpulver). Ohne Menge („nach Geschmack“) bleibt es so.

import { mehlFuerTeiglinge } from '../teig/rechner.js';
import { formatMenge } from '../kern/zahlen.js';

/**
 * Faktor für ein Ziel: { portionen } (Kochen), { mehl } oder { teiglinge: { anzahl, gewicht, verlust } }
 * (Backen). Leeres oder unsinniges Ziel ergibt 0 (wie im Teigrechner bei leerem Feld).
 */
export function faktorFuer(rezept, ziel) {
  const basis = rezept.art === 'backen' ? rezept.mehl : rezept.portionen;
  if (!(basis > 0) || !ziel) return 0;
  let neu = 0;
  if (rezept.art === 'backen') {
    neu = ziel.teiglinge
      ? mehlFuerTeiglinge(rezept.teig, ziel.teiglinge.anzahl, ziel.teiglinge.gewicht, ziel.teiglinge.verlust ?? 0)
      : ziel.mehl;
  } else {
    neu = ziel.portionen;
  }
  return Number.isFinite(neu) && neu > 0 ? neu / basis : 0;
}

/** Eine Menge nach Regel umrechnen. */
export function skaliereMenge(menge, regel, faktor) {
  if (menge === null || menge === undefined) return null;
  if (regel === 'fix') return menge;
  if (!(faktor > 0)) return 0;
  const roh = menge * faktor;
  return regel === 'ganz' ? Math.max(1, Math.round(roh)) : roh;
}

/** Rezept auf ein Ziel umrechnen: { faktor, portionen (oder null), zutaten } – das Rezept bleibt unverändert. */
export function skaliere(rezept, ziel) {
  const faktor = faktorFuer(rezept, ziel);
  return {
    faktor,
    portionen: rezept.portionen ? rezept.portionen * faktor : null,
    zutaten: rezept.zutaten.map((z) => ({ ...z, menge: skaliereMenge(z.menge, z.regel, faktor) })),
  };
}

/** Anzeige einer Zutat: „400 ml“, „2 Stück“, „nach Geschmack“. */
export function mengeText(menge, einheit = '') {
  if (menge === null || menge === undefined) return 'nach Geschmack';
  return `${formatMenge(menge)}${einheit ? ` ${einheit}` : ''}`;
}
