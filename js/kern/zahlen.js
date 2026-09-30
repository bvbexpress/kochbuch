// zahlen.js – Zahlen einlesen und für die Anzeige formatieren (deutsch).
// Keine Abhängigkeit zur Oberfläche, darum auch in Tests nutzbar.

/**
 * Liest eine Eingabe wie "1,5", "1.5" oder " 300 " als Zahl.
 * Leere oder ungültige Eingaben ergeben 0, negative Werte werden zu 0.
 */
export function leseZahl(text) {
  if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? text : 0;
  const bereinigt = String(text ?? '').trim().replace(',', '.');
  const zahl = Number.parseFloat(bereinigt);
  return Number.isFinite(zahl) && zahl > 0 ? zahl : 0;
}

const ganzeZahl = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const eineStelle = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const zweiStellen = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Gramm auf ganze Gramm gerundet, z. B. "1.234". */
export function formatGramm(gramm) {
  return ganzeZahl.format(Math.round(gramm));
}

/** Gramm mit einer Nachkommastelle, für kleine Mengen wie Hefe, z. B. "0,8". */
export function formatGrammFein(gramm) {
  return eineStelle.format(Math.round(gramm * 10) / 10);
}

/** Prozent: eine Nachkommastelle, unter 1 % zwei (z. B. Hefe 0,25). */
export function formatProzent(prozent) {
  return prozent < 1 ? zweiStellen.format(prozent) : eineStelle.format(prozent);
}
