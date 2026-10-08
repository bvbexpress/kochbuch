// zeit.js – Zeitangaben im Schritttext erkennen: „8–10 Min.“, „1,5 Std.“, „1 Stunde 30 Minuten“, „über Nacht“.
// Gemeinsam für die Hervorhebung (teile.js) und den Backplan (backplan.js). Nur Lesen, nichts wird gespeichert.
// Grad („200 °C“) und Gramm sind keine Zeiten.

const ZAHL = String.raw`\d+(?:[.,]\d+)?`;
const EINHEIT = String.raw`(?:Sekunden?|Sek\.?|Minuten?|Min\.?|Stunden?|Std\.?|Stdn\.?|h|Tage?n?)`;
const DAUER = String.raw`${ZAHL}(?:\s*(?:[–—−-]|bis)\s*${ZAHL})?\s*${EINHEIT}`;
const WORT = String.raw`(?:(?:eine?\s+)?(?:halbe|viertel)\s+Stunde|eine\s+(?:Stunde|Minute|Viertelstunde)|über\s+Nacht)`;

/** Alle Zeitangaben eines Textes (mit `matchAll` benutzen). */
export const ZEIT = new RegExp(
  String.raw`(?<![\p{L}\d])(?:${DAUER}(?:\s*(?:und\s+)?${DAUER})?|${WORT})(?![\p{L}\d])`, 'giu');

const TEIL = new RegExp(String.raw`(${ZAHL})(?:\s*(?:[–—−-]|bis)\s*(${ZAHL}))?\s*(${EINHEIT})`, 'giu');

const zahl = (s) => Number(s.replace(',', '.'));

function minutenJe(einheit) {
  const e = einheit.toLowerCase();
  if (e.startsWith('sek')) return 1 / 60;
  if (e.startsWith('min')) return 1;
  if (e.startsWith('tag')) return 1440;
  return 60; // Std., Stunde, h
}

/**
 * Ein Treffer von `ZEIT` in Minuten: { min, max } (bei fester Angabe gleich), oder { nacht: true } für „über Nacht“.
 * „1 Stunde 30 Minuten“ wird addiert, „2–3 Std.“ ergibt min 120, max 180.
 */
export function dauerVon(treffer) {
  const t = treffer.toLowerCase().replace(/\s+/g, ' ');
  if (/nacht/.test(t)) return { nacht: true };
  if (/halbe/.test(t)) return { min: 30, max: 30 };
  if (/viertel/.test(t)) return { min: 15, max: 15 };
  if (/^eine?\s+stunde/.test(t)) return { min: 60, max: 60 };
  if (/^eine?\s+minute/.test(t)) return { min: 1, max: 1 };
  let min = 0;
  let max = 0;
  for (const m of treffer.matchAll(TEIL)) {
    const je = minutenJe(m[3]);
    min += zahl(m[1]) * je;
    max += zahl(m[2] ?? m[1]) * je;
  }
  return { min, max };
}

/**
 * Dauer eines Schritts aus seinem Text: die längste Angabe zählt (Zeiten wie „nach 30, 60, 90 Min. dehnen“
 * liegen innerhalb der Gesamtzeit, sie werden nicht addiert). „Über Nacht“ gewinnt immer.
 * null = keine Zeit im Text.
 */
export function schrittDauer(text) {
  let beste = null;
  for (const treffer of String(text).matchAll(ZEIT)) {
    const d = dauerVon(treffer[0]);
    if (d.nacht) return d;
    if (!beste || d.min + d.max > beste.min + beste.max) beste = d;
  }
  return beste;
}
