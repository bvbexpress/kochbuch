// Connector „Rezepte direkt aus Claude“ (Etappe 3, Schritt 8) – Supabase Edge Function `kochbuch`,
// im Dashboard eingefügt (ohne Supabase-JWT-Prüfung). Ein kleiner MCP-Server mit genau vier Werkzeugen:
//   zutaten_liste · rezepte_finden · rezept_anlegen · rezept_aktualisieren
// Kein Löschen, kein Zugriff auf andere Tabellen, Konten oder den Vorrat.
//
// Zugang nur mit `Authorization: Bearer <Schlüssel>`; der Schlüssel steht nur als Secret
// `KOCHBUCH_SCHLUESSEL` in Supabase (fehlt er oder ist er kürzer als 32 Zeichen: immer 401).
// Die Datenbank erreicht die Funktion als eigene Rolle `kochbuch_connector` (Secret `KOCHBUCH_DB_URL`,
// Pooler im Transaktionsmodus). Die Rolle darf nur die vier Funktionen im Schema `connector` ausführen,
// die alles noch einmal prüfen (datenbank/schema.sql).
//
// Deno kann keine Dateien aus js/ laden: Kategorien, Grenzen, eingebaute Zutaten und `zutatId` sind hier
// Kopien. tests/connector.test.js prüft sie gegen die Originale und dass alles, was diese Funktion speichert,
// von `bereinigeRezept` (js/rezepte/rezept.js) unverändert übernommen wird.
// Back-Rezepte (Teigwerte) nimmt der Connector erst mit dem Back-Umbau (Schritt 5) an.
// Bewusst ohne Typen geschrieben: dieselbe Datei läuft in Deno (Supabase) und in den Tests (Node).

const VERSIONEN = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MIN_LAENGE = 32;
const MAX_ANFRAGE = 1_000_000; // Bytes
const MAX_REZEPTE = 50; // je Aufruf, wie connector.rezept_speichern
const MAX_NEUE_ZUTATEN = 200;

// ---------- Kopien aus js/ (Test vergleicht) ----------

/** = KOCH_KATEGORIEN in js/rezepte/rezept.js */
export const KOCH_KATEGORIEN = [
  { id: 'pasta', name: 'Pasta & Gnocchi' },
  { id: 'currys', name: 'Currys & Dal' },
  { id: 'wok', name: 'Wok & Pfanne' },
  { id: 'suppen', name: 'Suppen & Eintöpfe' },
  { id: 'auflaeufe', name: 'Aufläufe & Ofengerichte' },
  { id: 'burger', name: 'Burger & Wraps' },
  { id: 'salate', name: 'Salate & Bowls' },
  { id: 'grillen', name: 'Grillen' },
  { id: 'snacks', name: 'Snacks & Fingerfood' },
  { id: 'beilagen', name: 'Beilagen' },
  { id: 'saucen', name: 'Saucen & Dips' },
  { id: 'fruehstueck', name: 'Frühstück & Süßes' },
  { id: 'sonstiges', name: 'Sonstiges' },
];
export const PORTIONSARTEN = ['personen', 'stueck', 'laibe'];
export const REGELN = ['linear', 'ganz', 'fix'];
export const STATUS = ['erprobt', 'testen'];
export const QUELLEN = ['claude', 'import']; // 'hand' gibt es nur am Handy
/** = ARTEN in js/rezepte/katalog.js */
export const ZUTAT_ARTEN = ['mehl', 'saat', 'zusatz', 'gemuese', 'obst', 'fleisch', 'milchprodukt', 'gewuerz', 'vorrat', 'sonstiges'];
/** = Grenzen in js/rezepte/rezept.js */
export const GRENZEN = {
  name: 80, einheit: 20, zutaten: 80, schritte: 60, schritt: 500, notiz: 2000, schrittzutaten: 20, zahl: 100_000, portionen: 1000,
};
/** = EINGEBAUT in js/rezepte/katalog.js (Mehle, Saaten, Zusätze mit festen ids) */
export const EINGEBAUT = [
  ['tipo00', 'Tipo 00', 'mehl'], ['weizen550', 'Weizen 550', 'mehl'], ['weizenvollkorn', 'Weizenvollkorn', 'mehl'],
  ['dinkelvollkorn', 'Dinkelvollkorn', 'mehl'], ['roggen1150', 'Roggen 1150', 'mehl'], ['roggenvollkorn', 'Roggenvollkorn', 'mehl'],
  ['hafervollkorn', 'Hafervollkorn', 'mehl'],
  ['leinsamen', 'Leinsamen', 'saat'], ['sonnenblumenkerne', 'Sonnenblumenkerne', 'saat'], ['kuerbiskerne', 'Kürbiskerne', 'saat'],
  ['sesam', 'Sesam', 'saat'], ['chiasamen', 'Chiasamen', 'saat'], ['haferflocken', 'Haferflocken', 'saat'],
  ['milch', 'Milch', 'zusatz'], ['ei', 'Ei', 'zusatz'], ['butter', 'Butter', 'zusatz'], ['zucker', 'Zucker', 'zusatz'],
  ['honig', 'Honig', 'zusatz'],
].map(([id, name, art]) => ({ id, name, art }));

/** = zutatId in js/rezepte/katalog.js: „Weizen 550“ → "weizen550", „Kokos-Milch“ → "kokosmilch". */
export function zutatId(name) {
  if (typeof name !== 'string') return null;
  const id = name
    .toLowerCase()
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 60);
  return id || null;
}

/** = bereinigeZutatenName in js/rezepte/katalog.js */
export function bereinigeZutatenName(name) {
  if (typeof name !== 'string') return null;
  const sauber = name.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GRENZEN.name);
  return zutatId(sauber) ? sauber : null;
}

const gueltigeZutatId = (id) => typeof id === 'string' && /^[\w-]{1,60}$/.test(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Text wie `text()` in js/rezepte/rezept.js, aber ohne Kürzen (zu lang = Fehler). */
const sauber = (x) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim() : null);
const istZahl = (x, max) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= max;

// ---------- Katalog ----------

/** Eingebaute und gespeicherte Zutaten (eingebaute gelten mit ihrem festen Namen, wie `alleZutaten`). */
export function katalogAus(gespeichert) {
  const feste = new Set(EINGEBAUT.map((z) => z.id));
  const eigene = (Array.isArray(gespeichert) ? gespeichert : [])
    .filter((z) => z && gueltigeZutatId(z.id) && !feste.has(z.id) && bereinigeZutatenName(z.name))
    .map((z) => ({ id: z.id, name: bereinigeZutatenName(z.name) }));
  return [...EINGEBAUT, ...eigene];
}

/** Wie `findeOderNeu` in js/rezepte/katalog.js: gefunden über die id aus dem Namen. */
function finde(liste, name) {
  const id = zutatId(name);
  return liste.find((z) => z.id === id || zutatId(z.name) === id) ?? null;
}

const zutatName = (katalog, id) => katalog.find((z) => z.id === id)?.name ?? id;

// ---------- Prüfen ----------

const FELDER = ['name', 'kategorie', 'portionen', 'portionsart', 'zutaten', 'schritte', 'schrittzutaten', 'status', 'notiz', 'quelle'];

function kategorieVon(x) {
  if (typeof x !== 'string') return null;
  const k = x.trim().toLowerCase();
  return KOCH_KATEGORIEN.find((e) => e.id === k || e.name.toLowerCase() === k)?.id ?? null;
}

/**
 * Prüft ein Koch-Rezept von Claude. Zutaten mit `name` (oder intern mit Katalog-`zutat`), Zutaten je
 * Schritt ebenso. Streng: Unsinn wird nicht still repariert, sondern mit Grund abgewiesen, damit Claude
 * es verbessern kann.
 * Ergebnis: { rezept, neu } – `rezept` genau in der Form von `bereinigeRezept` (ohne id), `neu` = neue
 * Katalogeinträge { id, name, art } – oder { fehler: [Text, …] }.
 * `katalog` wird nicht verändert. `bekannt`: weitere erlaubte Katalog-ids (Zutaten des bisherigen Rezepts).
 */
export function pruefeRezept(roh, katalog, { bekannt = [], pflicht = true } = {}) {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return { fehler: ['Rezept fehlt oder ist kein Objekt.'] };
  const fehler = [];
  const f = (t) => fehler.push(t);

  const fremd = Object.keys(roh).filter((k) => !FELDER.includes(k));
  if (fremd.length) f(`Unbekannte Felder: ${fremd.join(', ')}.`);

  const name = sauber(roh.name);
  if (!name) f('name fehlt.');
  else if (name.length > GRENZEN.name) f(`name ist zu lang (höchstens ${GRENZEN.name} Zeichen).`);

  const kategorie = kategorieVon(roh.kategorie);
  if (!kategorie) f(`kategorie fehlt oder ist unbekannt. Erlaubt: ${KOCH_KATEGORIEN.map((k) => k.id).join(', ')}.`);

  if (!istZahl(roh.portionen, GRENZEN.portionen)) f(`portionen muss eine Zahl über 0 sein (höchstens ${GRENZEN.portionen}).`);
  const portionsart = roh.portionsart ?? 'personen';
  if (!PORTIONSARTEN.includes(portionsart)) f(`portionsart: ${PORTIONSARTEN.join(' | ')}.`);

  // Zutaten
  const liste = [...katalog];
  const erlaubt = new Set([...katalog.map((z) => z.id), ...bekannt]);
  const neu = [];
  const zutaten = [];
  if (!Array.isArray(roh.zutaten) || roh.zutaten.length === 0) f('zutaten fehlt (mindestens eine Zutat).');
  else if (roh.zutaten.length > GRENZEN.zutaten) f(`Höchstens ${GRENZEN.zutaten} Zutaten.`);
  else roh.zutaten.forEach((z, i) => {
    const nr = `Zutat ${i + 1}`;
    if (!z || typeof z !== 'object' || Array.isArray(z)) return f(`${nr}: kein Objekt.`);
    const extra = Object.keys(z).filter((k) => !['name', 'zutat', 'menge', 'einheit', 'regel', 'art'].includes(k));
    if (extra.length) f(`${nr}: unbekannte Felder ${extra.join(', ')}.`);
    let id = null;
    if (z.zutat !== undefined) {
      if (gueltigeZutatId(z.zutat) && erlaubt.has(z.zutat)) id = z.zutat;
      else f(`${nr}: unbekannte Zutat.`);
    } else {
      const zname = bereinigeZutatenName(z.name);
      if (!zname) return f(`${nr}: name fehlt.`);
      if (sauber(z.name).length > GRENZEN.name) return f(`${nr}: name ist zu lang.`);
      const treffer = finde(liste, zname);
      if (treffer) id = treffer.id;
      else {
        if (z.art !== undefined && !ZUTAT_ARTEN.includes(z.art)) f(`${nr}: art: ${ZUTAT_ARTEN.join(' | ')}.`);
        const eintrag = { id: zutatId(zname), name: zname, art: ZUTAT_ARTEN.includes(z.art) ? z.art : 'sonstiges' };
        neu.push(eintrag);
        liste.push(eintrag);
        id = eintrag.id;
      }
    }
    const menge = z.menge ?? null;
    if (menge !== null && !istZahl(menge, GRENZEN.zahl)) f(`${nr}: menge muss eine Zahl über 0 sein oder fehlen („nach Geschmack“).`);
    const einheit = z.einheit === undefined || z.einheit === null ? '' : sauber(z.einheit);
    if (einheit === null || einheit.length > GRENZEN.einheit) f(`${nr}: einheit ist kein kurzer Text.`);
    const regel = z.regel ?? 'linear';
    if (!REGELN.includes(regel)) f(`${nr}: regel: ${REGELN.join(' | ')}.`);
    if (id && zutaten.some((x) => x.zutat === id)) f(`${nr}: „${zutatName(liste, id)}“ steht doppelt in den Zutaten.`);
    if (id) zutaten.push({ zutat: id, menge, einheit: einheit ?? '', regel });
  });

  // Schritte
  const schritte = [];
  if (!Array.isArray(roh.schritte) || roh.schritte.length === 0) f('schritte fehlt (mindestens ein Schritt).');
  else if (roh.schritte.length > GRENZEN.schritte) f(`Höchstens ${GRENZEN.schritte} Schritte.`);
  else roh.schritte.forEach((s, i) => {
    const t = sauber(s);
    if (!t) f(`Schritt ${i + 1} ist leer.`);
    else if (t.length > GRENZEN.schritt) f(`Schritt ${i + 1} ist zu lang (höchstens ${GRENZEN.schritt} Zeichen).`);
    else schritte.push(t);
  });

  // Zutaten je Schritt
  let schrittzutaten = null;
  const sz = roh.schrittzutaten;
  if (sz === undefined || sz === null) {
    if (pflicht) f('schrittzutaten fehlt: je Schritt eine Liste der Zutaten dieses Schritts (leere Liste, wenn keine).');
  } else if (!Array.isArray(sz) || !Array.isArray(roh.schritte) || sz.length !== roh.schritte.length) {
    f('schrittzutaten braucht genau so viele Listen wie es Schritte gibt.');
  } else {
    const imRezept = new Set(zutaten.map((z) => z.zutat));
    schrittzutaten = sz.map((je, i) => {
      const nr = `Schritt ${i + 1}`;
      if (!Array.isArray(je)) return f(`${nr}: schrittzutaten ist keine Liste.`), [];
      if (je.length > GRENZEN.schrittzutaten) return f(`${nr}: höchstens ${GRENZEN.schrittzutaten} Zutaten.`), [];
      const eintraege = [];
      for (const e of je) {
        if (!e || typeof e !== 'object' || Array.isArray(e)
          || Object.keys(e).some((k) => !['name', 'zutat', 'menge'].includes(k))) {
          f(`${nr}: Eintrag braucht name und optional menge.`);
          continue;
        }
        const id = e.zutat !== undefined ? e.zutat : finde(liste, bereinigeZutatenName(e.name) ?? '')?.id;
        const anzeige = typeof e.name === 'string' ? e.name : e.zutat;
        if (!id || !imRezept.has(id)) { f(`${nr}: „${anzeige}“ steht nicht in den Zutaten des Rezepts.`); continue; }
        if (eintraege.some((x) => x.zutat === id)) { f(`${nr}: „${anzeige}“ steht doppelt.`); continue; }
        const menge = e.menge ?? null;
        if (menge !== null && !istZahl(menge, GRENZEN.zahl)) { f(`${nr}: menge von „${anzeige}“ muss eine Zahl über 0 sein.`); continue; }
        eintraege.push(menge === null ? { zutat: id } : { zutat: id, menge });
      }
      return eintraege;
    });
  }

  const quelle = roh.quelle ?? 'claude';
  if (!QUELLEN.includes(quelle)) f(`quelle: ${QUELLEN.join(' | ')}.`);
  const status = roh.status ?? (quelle === 'import' ? 'testen' : 'erprobt');
  if (!STATUS.includes(status)) f(`status: ${STATUS.join(' | ')}.`);
  const notiz = roh.notiz === undefined || roh.notiz === null ? '' : sauber(roh.notiz);
  if (notiz === null || notiz.length > GRENZEN.notiz) f(`notiz ist kein Text bis ${GRENZEN.notiz} Zeichen.`);

  if (fehler.length) return { fehler: fehler.slice(0, 15) };
  const benutzt = new Set(zutaten.map((z) => z.zutat));
  return {
    rezept: {
      art: 'kochen',
      name,
      kategorie,
      portionen: roh.portionen,
      portionsart,
      zutaten,
      schritte,
      // wie `bereinigeRezept`: ganz ohne Einträge fehlt das Feld (Rückfall Namenssuche)
      ...(schrittzutaten && schrittzutaten.some((e) => e.length) ? { schrittzutaten } : {}),
      status,
      notiz,
      quelle,
    },
    neu: neu.filter((z) => benutzt.has(z.id)),
  };
}

/** Gespeichertes Rezept (Katalog-ids) → Form für Claude (Namen statt ids). */
export function fuerClaude(id, version, d, katalog) {
  const name = (zid) => zutatName(katalog, zid);
  const zutaten = (Array.isArray(d.zutaten) ? d.zutaten : []).map((z) => ({
    name: name(z.zutat), menge: z.menge ?? null, einheit: z.einheit ?? '', regel: z.regel ?? 'linear',
  }));
  const schritte = Array.isArray(d.schritte) ? d.schritte : [];
  return {
    id, version,
    ...(d.art === 'backen' ? { art: 'backen', hinweis: 'Back-Rezept: Teigwerte kann der Connector noch nicht lesen oder ändern.' } : {}),
    name: d.name, kategorie: d.kategorie ?? null, portionen: d.portionen ?? null, portionsart: d.portionsart ?? 'personen',
    zutaten,
    schritte,
    schrittzutaten: Array.isArray(d.schrittzutaten)
      ? d.schrittzutaten.map((je) => (Array.isArray(je) ? je : []).map((e) => (
        e.menge === undefined ? { name: name(e.zutat) } : { name: name(e.zutat), menge: e.menge })))
      : null,
    status: d.status ?? 'erprobt', notiz: d.notiz ?? '', quelle: d.quelle ?? 'hand',
  };
}

// ---------- Werkzeuge ----------

const ZUTAT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Name aus zutaten_liste, sonst einheitlicher deutscher Name (neue Zutat).' },
    menge: { type: ['number', 'null'], description: 'Menge für die angegebenen Portionen; null = nach Geschmack.' },
    einheit: { type: 'string', description: 'z. B. g, ml, EL, TL, Stück, Zehe; leer bei Stückzahl ohne Einheit.' },
    regel: { type: 'string', enum: REGELN, description: 'linear = wächst mit den Portionen; ganz = ganze Stück (Eier, Zwiebeln); fix = bleibt gleich (Lorbeerblatt).' },
    art: { type: 'string', enum: ZUTAT_ARTEN, description: 'Nur für neue Zutaten.' },
  },
  required: ['name'],
  additionalProperties: false,
};

const REZEPT_FELDER = {
  name: { type: 'string', maxLength: GRENZEN.name },
  kategorie: { type: 'string', enum: KOCH_KATEGORIEN.map((k) => k.id), description: KOCH_KATEGORIEN.map((k) => `${k.id} = ${k.name}`).join('; ') },
  portionen: { type: 'number', exclusiveMinimum: 0, maximum: GRENZEN.portionen },
  portionsart: { type: 'string', enum: PORTIONSARTEN },
  zutaten: { type: 'array', items: ZUTAT_SCHEMA, minItems: 1, maxItems: GRENZEN.zutaten },
  schritte: { type: 'array', items: { type: 'string', maxLength: GRENZEN.schritt }, minItems: 1, maxItems: GRENZEN.schritte, description: 'Kurz, ein Handgriff pro Schritt.' },
  schrittzutaten: {
    type: 'array',
    description: 'Je Schritt (gleiche Reihenfolge) die Zutaten dieses Schritts; leere Liste, wenn keine. Ohne menge gilt die ganze Menge; wird eine Zutat auf mehrere Schritte verteilt, bei jedem die Teilmenge (gleiche Einheit).',
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Name wie in zutaten.' }, menge: { type: 'number', exclusiveMinimum: 0 } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  status: { type: 'string', enum: STATUS, description: 'erprobt = gerade gekocht und gelungen; testen = noch nicht ausprobiert (Import).' },
  notiz: { type: 'string', maxLength: GRENZEN.notiz, description: 'Kurz, z. B. unsere Anpassungen.' },
  quelle: { type: 'string', enum: QUELLEN, description: 'claude (Standard) oder import (übernommenes altes Rezept).' },
};

export const WERKZEUGE = [
  {
    name: 'zutaten_liste',
    description: 'Namen aller Zutaten im Kochbuch. Vor dem Speichern abfragen und genau diese Namen benutzen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Zutaten', readOnlyHint: true },
  },
  {
    name: 'rezepte_finden',
    description: 'Sucht Rezepte nach Namen (Teilwort; leer = alle, höchstens 100). Mit id: das ganze Rezept samt version (für rezept_aktualisieren).',
    inputSchema: {
      type: 'object',
      properties: { suche: { type: 'string' }, id: { type: 'string' } },
      additionalProperties: false,
    },
    annotations: { title: 'Rezepte finden', readOnlyHint: true },
  },
  {
    name: 'rezept_anlegen',
    description: 'Legt Koch-Rezepte neu an (eins oder mehrere, höchstens 50). Gibt es ein Rezept mit gleichem Namen schon, wird es nicht angelegt – dann rezept_aktualisieren. Unbekannte Zutatennamen werden neue Zutaten.',
    inputSchema: {
      type: 'object',
      properties: {
        rezepte: {
          type: 'array', minItems: 1, maxItems: MAX_REZEPTE,
          items: {
            type: 'object', properties: REZEPT_FELDER, additionalProperties: false,
            required: ['name', 'kategorie', 'portionen', 'zutaten', 'schritte', 'schrittzutaten'],
          },
        },
      },
      required: ['rezepte'],
      additionalProperties: false,
    },
    annotations: { title: 'Rezept anlegen', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'rezept_aktualisieren',
    description: 'Ändert ein vorhandenes Rezept. Nötig: id und version aus rezepte_finden. Nur die angegebenen Felder werden ersetzt (notiz ersetzt die alte Notiz ganz). Wer zutaten oder schritte ändert, liefert schrittzutaten neu mit. Wurde das Rezept inzwischen anders geändert, bleibt es unverändert und die Änderung wird eine Kopie.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, version: { type: 'integer', minimum: 1 }, ...REZEPT_FELDER },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    annotations: { title: 'Rezept ändern', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

const ANLEITUNG = 'Kochbuch der Familie (nur Koch-Rezepte). Vor dem Speichern zutaten_liste abfragen und diese Namen benutzen. '
  + 'Vorher mit rezepte_finden prüfen, ob es das Rezept schon gibt; dann rezept_aktualisieren statt neu anlegen. '
  + 'Mengen für die angegebenen Portionen, Schritte kurz, zu jedem Schritt schrittzutaten. Löschen geht nicht.';

/** Fehler, den Claude sieht (isError), statt eines Protokollfehlers. */
class Hinweis extends Error {}

const ergebnis = (daten) => ({ content: [{ type: 'text', text: JSON.stringify(daten) }] });

/** Datenbank-Fehler in einen ruhigen Hinweis übersetzen (Einzelheiten nur im Protokoll). */
async function mitDb(db, fn) {
  if (!db) throw new Hinweis('Das Kochbuch ist noch nicht fertig eingerichtet (Datenbank-Verbindung fehlt).');
  try {
    return await fn(db);
  } catch (e) {
    console.error(JSON.stringify({ fehler: String(e?.code ?? ''), meldung: String(e?.message ?? e).slice(0, 300) }));
    if (/Kein Haushalt/.test(String(e?.message))) throw new Hinweis('Im Kochbuch ist kein Haushalt für den Connector freigegeben.');
    throw new Hinweis('Das Kochbuch ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.');
  }
}

const katalogLaden = (db) => mitDb(db, async (d) => katalogAus(await d.zutatenListe()));

async function zutatenListe(db) {
  const namen = (await katalogLaden(db)).map((z) => z.name).sort((a, b) => a.localeCompare(b, 'de'));
  return ergebnis({ zutaten: namen });
}

async function rezepteFinden(db, a) {
  if (a.id !== undefined) {
    const id = typeof a.id === 'string' ? a.id.trim().toLowerCase() : '';
    if (!UUID.test(id)) throw new Hinweis('id ist keine gültige Rezept-id.');
    const [katalog, gelesen] = await Promise.all([katalogLaden(db), mitDb(db, (d) => d.rezeptLesen(id))]);
    if (!gelesen) throw new Hinweis('Kein Rezept mit dieser id (vielleicht gelöscht).');
    return ergebnis(fuerClaude(gelesen.id, gelesen.version, gelesen.daten, katalog));
  }
  if (a.suche !== undefined && typeof a.suche !== 'string') throw new Hinweis('suche muss Text sein.');
  const treffer = await mitDb(db, (d) => d.rezepteFinden((a.suche ?? '').slice(0, 100)));
  return ergebnis({ rezepte: treffer, hinweis: treffer.length >= 100 ? 'Nur die ersten 100 – Suche genauer eingrenzen.' : undefined });
}

/** Ergebnis von connector.rezept_speichern in Worte für Claude. */
function speicherErgebnis(e, name) {
  if (e?.ok) return { name, id: e.id, version: e.version, gespeichert: true };
  if (e?.kopie) {
    return {
      name, id: e.id, gespeichert: false, kopie: e.kopie,
      hinweis: 'Das Rezept wurde inzwischen anders geändert. Das Original bleibt, deine Fassung ist als Kopie gespeichert.',
    };
  }
  return { name, gespeichert: false, fehler: `Von der Datenbank abgewiesen (${e?.grund ?? 'unbekannt'}).` };
}

async function rezeptAnlegen(db, a) {
  if (!Array.isArray(a.rezepte) || a.rezepte.length === 0) throw new Hinweis('rezepte fehlt (Liste mit mindestens einem Rezept).');
  if (a.rezepte.length > MAX_REZEPTE) throw new Hinweis(`Höchstens ${MAX_REZEPTE} Rezepte auf einmal.`);
  const katalog = await katalogLaden(db);
  const antworten = [];
  const zuSpeichern = []; // { index, daten }
  const neu = new Map();
  const namen = new Set();

  for (const [i, roh] of a.rezepte.entries()) {
    const geprueft = pruefeRezept(roh, [...katalog, ...neu.values()]);
    const name = sauber(roh?.name) ?? `Rezept ${i + 1}`;
    if (geprueft.fehler) {
      antworten[i] = { name, gespeichert: false, fehler: geprueft.fehler };
      continue;
    }
    // Kein zweites Rezept mit gleichem Namen (z. B. Wiederholung nach Netzfehler)
    const schluessel = geprueft.rezept.name.toLowerCase();
    const vorhanden = (await mitDb(db, (d) => d.rezepteFinden(geprueft.rezept.name)))
      .find((r) => typeof r.name === 'string' && r.name.trim().toLowerCase() === schluessel);
    if (vorhanden || namen.has(schluessel)) {
      antworten[i] = {
        name, gespeichert: false,
        fehler: [vorhanden
          ? `Gibt es schon (id ${vorhanden.id}, version ${vorhanden.version}). Zum Ändern rezept_aktualisieren, sonst anderen Namen wählen.`
          : 'Name kommt in diesem Aufruf doppelt vor.'],
      };
      continue;
    }
    namen.add(schluessel);
    for (const z of geprueft.neu) neu.set(z.id, z);
    zuSpeichern.push({ index: i, daten: geprueft.rezept });
  }

  if (neu.size > MAX_NEUE_ZUTATEN) throw new Hinweis('Zu viele neue Zutaten auf einmal – bitte weniger Rezepte je Aufruf.');
  if (zuSpeichern.length) {
    const benutzt = new Set(zuSpeichern.flatMap((r) => r.daten.zutaten.map((z) => z.zutat)));
    const zutaten = [...neu.values()].filter((z) => benutzt.has(z.id));
    const antwort = await mitDb(db, (d) => d.rezeptSpeichern({ zutaten, rezepte: zuSpeichern.map((r) => ({ daten: r.daten })) }));
    zuSpeichern.forEach((r, j) => { antworten[r.index] = speicherErgebnis(antwort?.rezepte?.[j], r.daten.name); });
    if (zutaten.length) return ergebnis({ rezepte: antworten, neue_zutaten: zutaten.map((z) => z.name) });
  }
  return ergebnis({ rezepte: antworten });
}

async function rezeptAktualisieren(db, a) {
  const { id: rohId, version, ...aenderung } = a;
  const id = typeof rohId === 'string' ? rohId.trim().toLowerCase() : '';
  if (!UUID.test(id)) throw new Hinweis('id ist keine gültige Rezept-id (aus rezepte_finden).');
  if (!Number.isInteger(version) || version < 1) throw new Hinweis('version fehlt (aus rezepte_finden).');
  const fremd = Object.keys(aenderung).filter((k) => !FELDER.includes(k));
  if (fremd.length) throw new Hinweis(`Unbekannte Felder: ${fremd.join(', ')}.`);
  if (Object.keys(aenderung).length === 0) throw new Hinweis('Keine Änderung angegeben.');
  if ((aenderung.zutaten !== undefined || aenderung.schritte !== undefined) && aenderung.schrittzutaten === undefined) {
    throw new Hinweis('Wer zutaten oder schritte ändert, muss schrittzutaten neu mitliefern.');
  }

  const [katalog, gelesen] = await Promise.all([katalogLaden(db), mitDb(db, (d) => d.rezeptLesen(id))]);
  if (!gelesen) throw new Hinweis('Kein Rezept mit dieser id (vielleicht gelöscht). Dann mit rezept_anlegen neu anlegen.');
  const alt = gelesen.daten ?? {};
  if (alt.art !== 'kochen') throw new Hinweis('Back-Rezepte kann der Connector noch nicht ändern.');

  // Bisheriger Stand (mit Katalog-ids) plus Änderungen; geprüft wird das Ganze
  const zusammen = {
    name: alt.name, kategorie: alt.kategorie, portionen: alt.portionen, portionsart: alt.portionsart,
    zutaten: alt.zutaten, schritte: alt.schritte, schrittzutaten: alt.schrittzutaten,
    status: alt.status, notiz: alt.notiz,
    quelle: QUELLEN.includes(alt.quelle) ? alt.quelle : 'claude',
    ...aenderung,
  };
  const bekannt = (Array.isArray(alt.zutaten) ? alt.zutaten : []).map((z) => z?.zutat).filter(gueltigeZutatId);
  const geprueft = pruefeRezept(zusammen, katalog, { bekannt, pflicht: false });
  if (geprueft.fehler) throw new Hinweis(`Nicht gespeichert: ${geprueft.fehler.join(' ')}`);

  const antwort = await mitDb(db, (d) => d.rezeptSpeichern({
    zutaten: geprueft.neu, rezepte: [{ id, basis: version, daten: geprueft.rezept }],
  }));
  const e = speicherErgebnis(antwort?.rezepte?.[0], geprueft.rezept.name);
  return ergebnis(geprueft.neu.length ? { ...e, neue_zutaten: geprueft.neu.map((z) => z.name) } : e);
}

const AUSFUEHREN = {
  zutaten_liste: zutatenListe,
  rezepte_finden: rezepteFinden,
  rezept_anlegen: rezeptAnlegen,
  rezept_aktualisieren: rezeptAktualisieren,
};

// ---------- MCP (JSON-RPC) ----------

/** Wie kam der Schlüssel an? Nur `Authorization: Bearer <Schlüssel>`. */
export function erlaubt(anfrage, schluessel) {
  if (typeof schluessel !== 'string' || schluessel.length < MIN_LAENGE) return false; // ohne Secret nie offen
  const bearer = (anfrage.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i)?.[1];
  return gleich(bearer, schluessel);
}

/** Vergleich in fester Zeit (verrät nicht, wie viele Zeichen stimmen). */
function gleich(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let unterschied = 0;
  for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return unterschied === 0;
}

const antwort = (id, result) => ({ jsonrpc: '2.0', id, result });
const fehler = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Eine JSON-RPC-Nachricht. Benachrichtigungen (ohne id) → null (keine Antwort). */
export async function nachricht(n, db) {
  if (!n || typeof n !== 'object' || n.jsonrpc !== '2.0' || typeof n.method !== 'string') {
    return fehler(n?.id, -32600, 'Ungültige Anfrage');
  }
  if (n.id === undefined) return null;
  switch (n.method) {
    case 'initialize': {
      const gewuenscht = n.params?.protocolVersion;
      return antwort(n.id, {
        protocolVersion: VERSIONEN.includes(gewuenscht) ? gewuenscht : VERSIONEN[1],
        capabilities: { tools: {} },
        serverInfo: { name: 'kochbuch', version: '1.0.0' },
        instructions: ANLEITUNG,
      });
    }
    case 'ping':
      return antwort(n.id, {});
    case 'tools/list':
      return antwort(n.id, { tools: WERKZEUGE });
    case 'tools/call': {
      const ausfuehren = Object.hasOwn(AUSFUEHREN, n.params?.name) ? AUSFUEHREN[n.params.name] : null;
      if (!ausfuehren) return fehler(n.id, -32602, 'Unbekanntes Werkzeug');
      const argumente = n.params.arguments ?? {};
      if (typeof argumente !== 'object' || Array.isArray(argumente)) return fehler(n.id, -32602, 'arguments ist kein Objekt');
      try {
        return antwort(n.id, await ausfuehren(db, argumente));
      } catch (e) {
        if (!(e instanceof Hinweis)) console.error(JSON.stringify({ fehler: 'intern', meldung: String(e?.message ?? e).slice(0, 300) }));
        const text = e instanceof Hinweis ? e.message : 'Interner Fehler im Kochbuch-Connector.';
        return antwort(n.id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return fehler(n.id, -32601, 'Unbekannte Methode');
  }
}

const json = (daten, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { 'content-type': 'application/json' } });

/**
 * Bearbeitet eine HTTP-Anfrage (MCP „Streamable HTTP“, nur JSON-Antworten, ohne Sitzung).
 * `db`: { zutatenListe(), rezepteFinden(suche), rezeptLesen(id), rezeptSpeichern(eingabe) } oder null.
 */
export async function bearbeite(anfrage, { schluessel, db }) {
  if (!erlaubt(anfrage, schluessel)) return json({ fehler: 'nicht erlaubt' }, 401);
  if (anfrage.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (Number(anfrage.headers.get('content-length') ?? 0) > MAX_ANFRAGE) return json(fehler(null, -32600, 'Zu groß'), 413);

  let eingang;
  try {
    const text = await anfrage.text();
    if (text.length > MAX_ANFRAGE) return json(fehler(null, -32600, 'Zu groß'), 413);
    eingang = JSON.parse(text);
  } catch {
    return json(fehler(null, -32700, 'Kein gültiges JSON'), 400);
  }
  const liste = Array.isArray(eingang) ? eingang.slice(0, 20) : [eingang];
  // Protokoll ohne Inhalte: nur Methoden und Werkzeuge
  console.log(JSON.stringify({ methoden: liste.map((n) => (n?.method === 'tools/call' ? `tools/call:${n.params?.name}` : n?.method)) }));

  const ergebnisse = (await Promise.all(liste.map((n) => nachricht(n, db)))).filter((e) => e !== null);
  if (ergebnisse.length === 0) return new Response(null, { status: 202 });
  return json(Array.isArray(eingang) ? ergebnisse : ergebnisse[0]);
}

/** Datenbank-Zugriff über postgres.js (`sql` = Verbindung). Nur die vier Connector-Funktionen. */
export function datenbankMit(sql) {
  const eins = async (abfrage) => {
    const e = (await abfrage)[0]?.e ?? null;
    return typeof e === 'string' ? JSON.parse(e) : e;
  };
  return {
    zutatenListe: () => eins(sql`select connector.zutaten_liste() as e`),
    rezepteFinden: (suche) => eins(sql`select connector.rezepte_finden(${suche}::text) as e`),
    rezeptLesen: (id) => eins(sql`select connector.rezept_lesen(${id}::text) as e`),
    // sql.json: als JSON senden (eine fertige Zeichenkette würde noch einmal verpackt)
    rezeptSpeichern: (eingabe) => eins(sql`select connector.rezept_speichern(${sql.json(eingabe)}::jsonb) as e`),
  };
}

if (globalThis.Deno) {
  // Pooler im Transaktionsmodus: keine vorbereiteten Anfragen. Eine Verbindung je Funktions-Instanz.
  const { default: postgres } = await import('npm:postgres@3.4.5');
  const adresse = Deno.env.get('KOCHBUCH_DB_URL');
  const db = adresse
    ? datenbankMit(postgres(adresse, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 }))
    : null;
  Deno.serve((anfrage) => bearbeite(anfrage, { schluessel: Deno.env.get('KOCHBUCH_SCHLUESSEL'), db }));
}
