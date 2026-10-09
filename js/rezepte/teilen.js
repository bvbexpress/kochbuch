// teilen.js – „Rezept teilen“: das Rezept als einfacher, gut lesbarer Text (WhatsApp, Mail) mit den Mengen, die gerade
// eingestellt sind (Portionen, Mehl, Teiglinge), nicht den gespeicherten. Nichts wird gespeichert, kein Server, keine Links.
// Gerechnet wird in rechner.js bzw. teig/rechner.js; hier wird nur zusammengesetzt. Teilen übers Teilen-Menü des iPhones,
// ohne Teilen-Menü wird der Text in die Zwischenablage kopiert.

import { zutatName } from './katalog.js';
import { skaliere } from './rechner.js';
import { geraeteListe, mengenInSchritten, portionenText } from './liste.js';
import { berechne, gesamtmehlAusMehl, mehlFuerTeiglinge, teigInSchritten } from '../teig/rechner.js';
import { formatMenge, formatGramm, formatGrammFein } from '../kern/zahlen.js';

// ---------- „mit Notiz“ (Schalter am Knopf, nicht gespeichert, nach dem Teilen wieder aus) ----------

const mitNotizFuer = new Set(); // rezept-ids

export const notizMitteilen = (id) => mitNotizFuer.has(id);

export function setzeNotizMitteilen(id, an) {
  if (an) mitNotizFuer.add(id);
  else mitNotizFuer.delete(id);
}

// ---------- Text ----------

/** Eine Zutat als Zeile: „400 g Rote Linsen“, „2 × Zwiebel“ (Stückzahl ohne Einheit), „Salz (nach Geschmack)“. */
export function mengeZeile({ name, menge, einheit }) {
  if (menge === null || menge === undefined) return `${name} (nach Geschmack)`;
  const zahl = formatMenge(menge);
  return einheit ? `${zahl} ${einheit} ${name}` : `${zahl} × ${name}`;
}

/** Teigteil in Gramm; Hefe unter 10 g mit einer Nachkommastelle (wie im Rechner). */
function teigZeile({ name, gramm }) {
  return `${gramm < 10 && name.endsWith('hefe') ? formatGrammFein(gramm) : formatGramm(gramm)} g ${name}`;
}

// Alle Teile in der Reihenfolge der Zutatenliste im Rezept; was der Teig nicht hat, fällt in teigInSchritten weg.
const ALLE_TEIGTEILE = ['mehl', 'wasser', 'starter', 'salz', 'oel', 'hefe', 'zusaetze', 'saaten', 'quellwasser']
  .map((teil) => ({ teil }));

/**
 * Das Rezept als Text. Eingestellt wird (wie im Rezept):
 *   Kochen:  portionen
 *   Backen:  teig + mehl (zugegebenes Mehl in g) oder teiglinge { anzahl, gewicht, verlust } (dann folgt das Mehl daraus)
 * katalog = Zutatenkatalog (`alleZutaten`), mitNotiz = Notiz anhängen.
 */
export function rezeptAlsText(r, { katalog, portionen, teig, mehl, teiglinge = null, mitNotiz = false }) {
  const backen = r.art === 'backen';
  let kopf = [];
  let zutaten = [];
  let jeSchritt = [];

  if (backen) {
    const mehlGegeben = teiglinge
      ? mehlFuerTeiglinge(teig, teiglinge.anzahl, teiglinge.gewicht, teiglinge.verlust ?? 0)
      : mehl;
    const e = berechne(teig, gesamtmehlAusMehl(teig, mehlGegeben));
    const skaliert = skaliere(r, { mehl: mehlGegeben });
    const mehlText = `Mehl ${formatGramm(mehlGegeben)} g`;
    kopf = [teiglinge
      ? `${formatMenge(teiglinge.anzahl)} × ${formatMenge(teiglinge.gewicht)} g (${mehlText})`
      : mehlText];
    if (skaliert.portionen) kopf.push(portionenText(skaliert.portionen, r.portionsart));

    const teigTeile = teigInSchritten([ALLE_TEIGTEILE], teig, e)[0].filter((m) => m.gramm > 0);
    zutaten = [
      ...teigTeile.map(teigZeile),
      ...skaliert.zutaten.map((z) => mengeZeile({ ...z, name: zutatName(katalog, z.zutat) })),
    ];
    const teigJe = teigInSchritten(r.schrittteig, teig, e);
    jeSchritt = r.schritte.map((_, i) => [
      ...(teigJe?.[i] ?? []).map(teigZeile),
      ...(skaliert.schritte?.[i] ?? []).map((m) => mengeZeile({ ...m, name: zutatName(katalog, m.zutat) })),
    ]);
  } else {
    const skaliert = skaliere(r, { portionen });
    kopf = [portionenText(portionen, r.portionsart)];
    zutaten = skaliert.zutaten.map((z) => mengeZeile({ ...z, name: zutatName(katalog, z.zutat) }));
    const mengen = skaliert.schritte
      ? skaliert.schritte.map((je) => je.map((m) => ({ ...m, name: zutatName(katalog, m.zutat) })))
      : mengenInSchritten(r.schritte, skaliert.zutaten, katalog);
    jeSchritt = mengen.map((je) => je.map(mengeZeile));
  }

  const geraete = geraeteListe(r);
  const zeilen = [`*${r.name}*`, kopf.join(' · ')];
  if (geraete.length) zeilen.push(`Geräte: ${geraete.join(', ')}`);
  if (zutaten.length) zeilen.push('', '*Zutaten*', ...zutaten.map((z) => `• ${z}`));
  if (r.schritte.length) {
    zeilen.push('', '*Schritte*');
    r.schritte.forEach((s, i) => {
      zeilen.push(`${i + 1}. ${s}`);
      const geraet = r.schrittgeraete?.[i];
      if (geraet) zeilen.push(`   Gerät: ${geraet}`);
      if (jeSchritt[i]?.length) zeilen.push(`   Dazu: ${jeSchritt[i].join(', ')}`);
    });
  }
  const notiz = String(r.notiz ?? '').trim();
  if (mitNotiz && notiz) zeilen.push('', '*Notiz*', notiz);
  return zeilen.join('\n');
}

// ---------- Weitergeben (nur im Browser) ----------

/**
 * Teilen-Menü des iPhones; ohne Menü in die Zwischenablage. Gibt 'geteilt', 'kopiert', 'abgebrochen' oder 'fehler' zurück.
 * Muss direkt aus dem Tipp aufgerufen werden (Safari verlangt das), der Text ist darum schon fertig.
 */
export async function teileText(inhalt, titel) {
  const nav = globalThis.navigator;
  if (nav?.share) {
    try {
      await nav.share({ title: titel, text: inhalt });
      return 'geteilt';
    } catch (fehler) {
      if (fehler?.name === 'AbortError') return 'abgebrochen'; // Menü bewusst geschlossen
    }
  }
  try {
    await nav.clipboard.writeText(inhalt);
    return 'kopiert';
  } catch {
    return 'fehler';
  }
}

/** Knopf „Rezept teilen“ auslösen: teilen, danach Schalter „mit Notiz“ wieder aus; „Kopiert“ kurz am Knopf. Keine Fehlermeldung. */
export async function teileAusKnopf(knopf, r, inhalt) {
  const ergebnis = await teileText(inhalt, r.name);
  if (ergebnis === 'geteilt' || ergebnis === 'kopiert') {
    setzeNotizMitteilen(r.id, false);
    const schalter = knopf.closest('.teilen')?.querySelector('input[type="checkbox"]');
    if (schalter) schalter.checked = false;
  }
  if (ergebnis === 'kopiert') {
    const alt = knopf.textContent;
    knopf.textContent = 'Kopiert ✓';
    setTimeout(() => { if (knopf.isConnected) knopf.textContent = alt; }, 2000);
  }
  return ergebnis;
}
