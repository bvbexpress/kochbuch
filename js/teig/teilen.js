// teilen.js – eigene Vorlagen als Link verpacken und Links wieder einlesen.
//
// Der Link sieht so aus:  https://…/kochbuch/#teilen=<Code>
// Alles nach dem "#" wird vom Browser nie an einen Server geschickt – die Vorlagen
// stehen also nur im Link selbst, nirgends sonst.
//
// Der Code ist der Inhalt als JSON, platzsparend gepackt ("z.") und für Links
// geeignet umgeschrieben (Base64url). Wo das Packen fehlt, steht der Inhalt ungepackt ("r.").
//
// WICHTIG: Ein Link kann von jedem stammen. Eingelesen wird darum nur, was wir
// kennen und prüfen können (`bereinige…`) – alles andere wird verworfen.

import {
  istGueltigerTeig,
  normalisiereTeig,
  bereinigeTeiglinge,
  bereinigeKategorie,
  modusVon,
  MODI,
} from './vorlagen.js';

const VERSION = 1;
const MARKE = 'teilen=';
const MAX_CODE = 300_000;   // Zeichen im Link
const MAX_JSON = 1_000_000; // Bytes nach dem Entpacken (Schutz vor "Zip-Bomben")
const MAX_VORLAGEN = 200;
const MAX_ZEILEN = 20;      // Mehlsorten bzw. Saaten je Vorlage
const MAX_NAME = 80;
const MAX_ZAHL = 100_000;
const EIN_TAG = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Link bauen ----------

/**
 * Baut den Link zu einer oder mehreren eigenen Vorlagen.
 * `basis` ist die Adresse der App ohne "#…", z. B. https://…/kochbuch/
 */
export async function erstelleLink(vorlagen, basis) {
  const paket = {
    v: VERSION,
    vorlagen: vorlagen.map((v) => ({
      id: v.id,
      name: v.name,
      mehl: v.mehl,
      teig: normalisiereTeig(v.teig),
      geaendert: v.geaendert,
      modus: modusVon(v),
      ...(bereinigeKategorie(v.kategorie) ? { kategorie: v.kategorie } : {}),
      ...(bereinigeTeiglinge(v.teiglinge) ? { teiglinge: bereinigeTeiglinge(v.teiglinge) } : {}),
    })),
  };
  return `${basis}#${MARKE}${await verpacke(JSON.stringify(paket))}`;
}

// ---------- Link lesen ----------

/**
 * Liest einen Link (oder nur den Code, oder einen Text, in dem ein Link steht).
 * Gibt { vorlagen, verworfen } zurück – oder null, wenn darin keine Vorlage steckt.
 * `vorlagen` sind geprüfte, bereinigte Kopien.
 */
export async function liesLink(eingabe, jetzt = Date.now()) {
  const code = codeAus(eingabe);
  if (!code) return null;
  let paket;
  try {
    paket = JSON.parse(await entpacke(code));
  } catch {
    return null;
  }
  if (!paket || typeof paket !== 'object' || paket.v !== VERSION || !Array.isArray(paket.vorlagen)) {
    return null;
  }
  const roh = paket.vorlagen.slice(0, MAX_VORLAGEN);
  const vorlagen = roh.map((v) => bereinigeVorlage(v, jetzt)).filter(Boolean);
  const verworfen = paket.vorlagen.length - vorlagen.length;
  return vorlagen.length > 0 ? { vorlagen, verworfen } : null;
}

/** Ist im Text ein Teilen-Link? (schnelle Vorab-Prüfung ohne Entpacken) */
export function hatTeilenCode(eingabe) {
  return codeAus(eingabe) !== null;
}

function codeAus(eingabe) {
  const text = String(eingabe ?? '').trim();
  if (!text || text.length > MAX_CODE * 2) return null;
  const treffer = text.match(/teilen=([A-Za-z0-9_.-]+)/);
  const code = treffer ? treffer[1] : /^[zr]\.[A-Za-z0-9_-]+$/.test(text) ? text : null;
  return code && code.length <= MAX_CODE ? code : null;
}

// ---------- Prüfen und bereinigen ----------

/** Gibt eine saubere Kopie zurück oder null, wenn die Vorlage unbrauchbar ist. */
export function bereinigeVorlage(v, jetzt = Date.now()) {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.id !== 'string' || !UUID.test(v.id)) return null;
  const name = bereinigeName(v.name);
  const mehl = zahl(v.mehl);
  const teig = bereinigeTeig(v.teig);
  if (!name || mehl === null || !teig) return null;
  // Ein erfundener Zeitpunkt in ferner Zukunft würde sonst jede Version überstimmen
  const geaendert = typeof v.geaendert === 'number' && Number.isFinite(v.geaendert) && v.geaendert > 0
    ? Math.min(v.geaendert, jetzt + EIN_TAG)
    : 0;
  // Teiglinge-Angabe ist optional: fehlt sie oder ist sie unbrauchbar, bleibt die Vorlage trotzdem gültig
  const teiglinge = bereinigeTeiglinge(v.teiglinge);
  // Kategorie und Modus sind optional (ältere Links): Unbekanntes fällt einfach weg
  const kategorie = bereinigeKategorie(v.kategorie);
  const modus = MODI.includes(v.modus) ? v.modus : null;
  return {
    id: v.id.toLowerCase(), name, mehl, teig, geaendert,
    ...(teiglinge ? { teiglinge } : {}),
    ...(kategorie ? { kategorie } : {}),
    ...(modus ? { modus } : {}),
  };
}

function bereinigeTeig(roh) {
  if (!istGueltigerTeig(roh)) return null;
  const teig = normalisiereTeig(roh);
  const mehlsorten = zeilen(teig.mehlsorten, 'anteil');
  const saaten = zeilen(teig.saaten, 'prozent');
  // Ungeprüft aus dem Link, nicht aus normalisiereTeig (das würde Unsinn still reparieren)
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

// ---------- Packen und Entpacken ----------

async function verpacke(json) {
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    try {
      return `z.${nachBase64url(await durchStrom(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      // fällt auf ungepackt zurück
    }
  }
  return `r.${nachBase64url(bytes)}`;
}

async function entpacke(code) {
  const art = code.slice(0, 2);
  const bytes = vonBase64url(code.slice(2));
  if (art === 'r.') {
    if (bytes.length > MAX_JSON) throw new Error('zu groß');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  if (art === 'z.' && typeof DecompressionStream === 'function') {
    const roh = await durchStrom(bytes, new DecompressionStream('deflate-raw'), MAX_JSON);
    return new TextDecoder('utf-8', { fatal: true }).decode(roh);
  }
  throw new Error('unbekannter Code');
}

/** Schickt Bytes durch einen Strom (packen/entpacken); bricht bei mehr als `max` Bytes ab. */
async function durchStrom(bytes, strom, max = Infinity) {
  const schreiber = strom.writable.getWriter();
  // Fehler beim Schreiben tauchen auch beim Lesen auf – hier nur Abbrüche nicht liegen lassen
  schreiber.write(bytes).then(() => schreiber.close()).catch(() => {});
  const leser = strom.readable.getReader();
  const teile = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.length;
    if (summe > max) {
      leser.cancel().catch(() => {});
      throw new Error('zu groß');
    }
    teile.push(value);
  }
  const aus = new Uint8Array(summe);
  let pos = 0;
  for (const t of teile) {
    aus.set(t, pos);
    pos += t.length;
  }
  return aus;
}

function nachBase64url(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function vonBase64url(text) {
  const binaer = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binaer, (c) => c.charCodeAt(0));
}
