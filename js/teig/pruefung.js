// pruefung.js – Teigvorlagen von außen prüfen und bereinigen (Sicherungsdatei, Back-Rezepte).
//
// WICHTIG: Eine Sicherungsdatei kann von überall stammen. Übernommen wird nur, was wir
// kennen und prüfen können (`bereinige…`) – alles andere wird verworfen.

import {
  istGueltigerTeig,
  normalisiereTeig,
  bereinigeTeiglinge,
  bereinigeKategorie,
  MODI,
} from './vorlagen.js';

const MAX_ZEILEN = 20;      // Mehlsorten bzw. Saaten je Vorlage
const MAX_NAME = 80;
const MAX_ZAHL = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Prüfen und bereinigen ----------

/** Gibt eine saubere Kopie zurück oder null, wenn die Vorlage unbrauchbar ist. */
export function bereinigeVorlage(v) {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.id !== 'string' || !UUID.test(v.id)) return null;
  const name = bereinigeName(v.name);
  const mehl = zahl(v.mehl);
  const teig = bereinigeTeig(v.teig);
  if (!name || mehl === null || !teig) return null;
  // Teiglinge-Angabe ist optional: fehlt sie oder ist sie unbrauchbar, bleibt die Vorlage trotzdem gültig
  const teiglinge = bereinigeTeiglinge(v.teiglinge);
  // Kategorie und Modus sind optional (ältere Vorlagen): Unbekanntes fällt einfach weg
  const kategorie = bereinigeKategorie(v.kategorie);
  const modus = MODI.includes(v.modus) ? v.modus : null;
  return {
    id: v.id.toLowerCase(), name, mehl, teig,
    ...(teiglinge ? { teiglinge } : {}),
    ...(kategorie ? { kategorie } : {}),
    ...(modus ? { modus } : {}),
  };
}

export function bereinigeTeig(roh) {
  if (!istGueltigerTeig(roh)) return null;
  const teig = normalisiereTeig(roh);
  const mehlsorten = zeilen(teig.mehlsorten, 'anteil');
  const saaten = zeilen(teig.saaten, 'prozent');
  // Ungeprüft von außen, nicht aus normalisiereTeig (das würde Unsinn still reparieren)
  const zusaetze = zusatzZeilen(roh.zusaetze ?? []);
  const zahlen = ['hydration', 'starter', 'salz', 'oel', 'hefe'].map((k) => zahl(teig[k]));
  const quellwasser = teig.quellwasser === undefined ? 0 : zahl(teig.quellwasser, -MAX_ZAHL);
  if (!mehlsorten || !saaten || !zusaetze || quellwasser === null || zahlen.includes(null)) return null;
  const [hydration, starter, salz, oel, hefe] = zahlen;
  return {
    format: teig.format,
    hydration, starter, salz, oel, hefe,
    hefeArt: teig.hefeArt === 'trocken' ? 'trocken' : 'frisch',
    mehlsorten,
    saaten,
    quellwasser,
    zusaetze,
  };
}

/** Zusatzzutaten: wie Saaten, dazu der Wasseranteil (0–100 %). */
function zusatzZeilen(liste) {
  const sauber = zeilen(liste, 'prozent');
  if (!sauber) return null;
  const wasser = liste.map((z) => zahl(z?.wasser));
  if (wasser.some((w) => w === null || w > 100)) return null;
  return sauber.map((z, i) => ({ ...z, wasser: wasser[i] }));
}

/** Mehlsorten bzw. Saaten: nur id, Name und ein Zahlenwert; null bei Unsinn. */
function zeilen(liste, wertName) {
  if (!Array.isArray(liste) || liste.length > MAX_ZEILEN) return null;
  const sauber = [];
  for (const z of liste) {
    const name = bereinigeName(z?.name);
    const wert = zahl(z?.[wertName]);
    if (!name || wert === null) return null;
    const id = typeof z.id === 'string' && z.id.length <= 60 && /^[\w-]+$/.test(z.id) ? z.id : null;
    sauber.push({ id, name, [wertName]: wert });
  }
  return sauber;
}

function bereinigeName(name) {
  if (typeof name !== 'string') return null;
  const sauber = name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_NAME);
  return sauber || null;
}

/** Endliche Zahl von `min` (sonst 0) bis MAX_ZAHL, sonst null. */
function zahl(x, min = 0) {
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= MAX_ZAHL ? x : null;
}
