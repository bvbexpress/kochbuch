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
// Back-Rezepte (`art: 'backen'`, mit Teigwerten) nimmt der Connector seit Etappe 3, Connector-Erweiterung, an:
// `teig`, `mehl` bzw. `teiglinge`, `modus`, `schrittteig`. Die Teig-Rechnung (Gesamtmehl, Gramm) ist eine Kopie aus
// js/teig/rechner.js; Claude bekommt die errechneten Gramm zurück und kann so Fehler in den Teigwerten sofort sehen.
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
/** = KATEGORIEN in js/teig/vorlagen.js (Back-Rezepte) */
export const BACK_KATEGORIEN = [
  { id: 'brot', name: 'Brot' },
  { id: 'broetchen', name: 'Brötchen' },
  { id: 'pizza', name: 'Pizza' },
  { id: 'focaccia', name: 'Focaccia' },
  { id: 'gebaeck', name: 'Gebäck' },
];
export const ARTEN = ['kochen', 'backen'];
/** = MODI in js/teig/vorlagen.js */
export const MODI = ['mehl', 'teiglinge'];
/** = TEIG_TEILE in js/rezepte/rezept.js */
export const TEIG_TEILE = ['mehl', 'wasser', 'starter', 'salz', 'oel', 'hefe', 'saaten', 'quellwasser', 'zusaetze'];
/** = FORMAT in js/teig/vorlagen.js und STANDARD_VERLUST in js/teig/rechner.js */
export const TEIG_FORMAT = 2;
export const STANDARD_VERLUST = 2;
/** = MEHLE / SAATEN / ZUSAETZE in js/teig/zutaten.js (feste ids; die Werte werden nur für Zusätze gebraucht) */
export const TEIG_MEHLE = [
  ['tipo00', 'Tipo 00'], ['weizen550', 'Weizen 550'], ['weizenvollkorn', 'Weizenvollkorn'], ['dinkelvollkorn', 'Dinkelvollkorn'],
  ['roggen1150', 'Roggen 1150'], ['roggenvollkorn', 'Roggenvollkorn'], ['hafervollkorn', 'Hafervollkorn'],
].map(([id, name]) => ({ id, name }));
export const TEIG_SAATEN = [
  ['leinsamen', 'Leinsamen'], ['sonnenblumenkerne', 'Sonnenblumenkerne'], ['kuerbiskerne', 'Kürbiskerne'],
  ['sesam', 'Sesam'], ['chiasamen', 'Chiasamen'], ['haferflocken', 'Haferflocken'],
].map(([id, name]) => ({ id, name }));
export const TEIG_ZUSAETZE = [
  { id: 'milch', name: 'Milch', wasser: 87 }, { id: 'ei', name: 'Ei', wasser: 75 }, { id: 'butter', name: 'Butter', wasser: 16 },
  { id: 'zucker', name: 'Zucker', wasser: 0 }, { id: 'honig', name: 'Honig', wasser: 17 },
];
export const PORTIONSARTEN = ['personen', 'stueck', 'laibe'];
export const REGELN = ['linear', 'ganz', 'fix'];
export const STATUS = ['erprobt', 'testen'];
export const QUELLEN = ['claude', 'import']; // 'hand' gibt es nur am Handy
export const ERNAEHRUNG = ['vegan', 'vegetarisch', 'fisch', 'fleisch'];
export const MIT_TIER = ['fisch', 'fleisch']; // nur hier gibt es „auch vegetarisch möglich“
/** = ARTEN in js/rezepte/katalog.js */
export const ZUTAT_ARTEN = ['mehl', 'saat', 'zusatz', 'gemuese', 'obst', 'fleisch', 'milchprodukt', 'gewuerz', 'vorrat', 'sonstiges'];
/** = Grenzen in js/rezepte/rezept.js */
export const GRENZEN = {
  name: 80, einheit: 20, zutaten: 80, schritte: 60, schritt: 500, notiz: 2000, schrittzutaten: 20, geraet: 40, zahl: 100_000, portionen: 1000, teigzeilen: 20,
};
/** = EINGEBAUT in js/rezepte/katalog.js (Mehle, Saaten, Zusätze mit festen ids, dazu KOCH_ZUTATEN) */
export const EINGEBAUT = [
  ['tipo00', 'Tipo 00', 'mehl'], ['weizen550', 'Weizen 550', 'mehl'], ['weizenvollkorn', 'Weizenvollkorn', 'mehl'],
  ['dinkelvollkorn', 'Dinkelvollkorn', 'mehl'], ['roggen1150', 'Roggen 1150', 'mehl'], ['roggenvollkorn', 'Roggenvollkorn', 'mehl'],
  ['hafervollkorn', 'Hafervollkorn', 'mehl'],
  ['leinsamen', 'Leinsamen', 'saat'], ['sonnenblumenkerne', 'Sonnenblumenkerne', 'saat'], ['kuerbiskerne', 'Kürbiskerne', 'saat'],
  ['sesam', 'Sesam', 'saat'], ['chiasamen', 'Chiasamen', 'saat'], ['haferflocken', 'Haferflocken', 'saat'],
  ['milch', 'Milch', 'zusatz'], ['ei', 'Ei', 'zusatz'], ['butter', 'Butter', 'zusatz'], ['zucker', 'Zucker', 'zusatz'],
  ['honig', 'Honig', 'zusatz'],
].map(([id, name, art]) => ({ id, name, art }));
/** = KOCH_ZUTATEN in js/rezepte/katalog.js (id folgt aus dem Namen) */
const KOCH_ZUTATEN = [
  // Öle und Fette
  ['Olivenöl', 'vorrat'], ['Rapsöl', 'vorrat'], ['Sesamöl', 'vorrat'],
  // Zwiebeln, Knoblauch, Ingwer
  ['Zwiebel', 'gemuese'], ['Rote Zwiebel', 'gemuese'], ['Frühlingszwiebel', 'gemuese'], ['Knoblauch', 'gemuese'], ['Ingwer', 'gemuese'],
  // Würzsaucen
  ['Sojasauce', 'vorrat'], ['Worcestersauce', 'vorrat'], ['Fischsauce', 'vorrat'], ['Tomatenmark', 'vorrat'], ['Senf', 'vorrat'], ['Sambal Oelek', 'vorrat'],
  // Säuren
  ['Zitronensaft', 'vorrat'], ['Limettensaft', 'vorrat'], ['Apfelessig', 'vorrat'], ['Balsamico', 'vorrat'],
  // Grundgewürze
  ['Salz', 'gewuerz'], ['Pfeffer', 'gewuerz'], ['Paprikapulver', 'gewuerz'], ['Kreuzkümmel', 'gewuerz'], ['Currypulver', 'gewuerz'], ['Kurkuma', 'gewuerz'], ['Oregano', 'gewuerz'], ['Zimt', 'gewuerz'], ['Chiliflocken', 'gewuerz'],
  // Dosenware
  ['Gehackte Tomaten', 'vorrat'], ['Passierte Tomaten', 'vorrat'], ['Kokosmilch', 'vorrat'], ['Kichererbsen', 'vorrat'], ['Kidneybohnen', 'vorrat'], ['Mais', 'vorrat'],
  // Häufiges Gemüse
  ['Karotte', 'gemuese'], ['Paprika', 'gemuese'], ['Tomate', 'gemuese'], ['Kartoffel', 'gemuese'], ['Zucchini', 'gemuese'], ['Champignon', 'gemuese'], ['Lauch', 'gemuese'], ['Brokkoli', 'gemuese'], ['Spinat', 'gemuese'],
  // Sonstiges
  ['Wasser', 'vorrat'], ['Gemüsebrühe', 'vorrat'],
  // Oft bei uns: Beilagen und Grundlagen
  ['Vollkornreis', 'vorrat'], ['Basmatireis', 'vorrat'], ['Vollkornpasta', 'vorrat'], ['Spätzle', 'vorrat'], ['Gnocchi', 'vorrat'], ['Rote Linsen', 'vorrat'], ['Berglinsen', 'vorrat'], ['Cashew', 'vorrat'], ['Pinienkern', 'vorrat'], ['Currypaste', 'vorrat'], ['Vegetarisches Hack', 'vorrat'],
  // Oft bei uns: Gemüse und Obst
  ['Butternutkürbis', 'gemuese'], ['Zuckerschote', 'gemuese'], ['Rucola', 'gemuese'], ['Romanasalat', 'gemuese'], ['Blumenkohl', 'gemuese'], ['Schalotte', 'gemuese'], ['Limette', 'obst'], ['Zitrone', 'obst'],
  // Oft bei uns: Milch, Fleisch
  ['Sahne', 'milchprodukt'], ['Hähnchenbrust', 'fleisch'], ['Rinderhack', 'fleisch'],
  // Oft bei uns: Gewürze und Kräuter
  ['Garam Masala', 'gewuerz'], ['Thymian', 'gewuerz'], ['Rosmarin', 'gewuerz'], ['Basilikum', 'gewuerz'], ['Petersilie', 'gewuerz'], ['Koriander', 'gewuerz'],
].map(([name, art]) => ({ id: zutatId(name), name, art }));
EINGEBAUT.push(...KOCH_ZUTATEN);

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

// ---------- Teig (Back-Rezepte) ----------

const rund = (x, stellen = 1) => Math.round(x * 10 ** stellen) / 10 ** stellen;
const inBereich = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;

/**
 * Prüft die Teigwerte (Prozent vom Gesamtmehl) streng und gibt sie in der Form von `bereinigeTeig`
 * (js/teig/pruefung.js) zurück – oder null und Gründe über `f`. Bekannte Mehle, Saaten und Zusätze
 * bekommen ihre feste id; Zusätze ihren Standard-Wasseranteil, wenn keiner angegeben ist.
 */
export function pruefeTeig(roh, fehler) {
  const f = (t) => { fehler.push(t); };
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return f('teig fehlt oder ist kein Objekt.'), null;
  const vorher = fehler.length;
  const fremd = Object.keys(roh).filter((k) => !['format', 'hydration', 'starter', 'salz', 'oel', 'hefe', 'hefeArt', 'mehlsorten', 'saaten', 'quellwasser', 'zusaetze'].includes(k));
  if (fremd.length) f(`teig: unbekannte Felder ${fremd.join(', ')}.`);
  if (roh.format !== undefined && roh.format !== TEIG_FORMAT) f(`teig.format muss ${TEIG_FORMAT} sein oder fehlen.`);

  const wert = (name, min, max, standard, hinweis) => {
    const x = roh[name] ?? standard;
    if (x === undefined || !inBereich(x, min, max)) { f(`teig.${name} muss eine Zahl von ${min} bis ${max} sein${hinweis ? ` (${hinweis})` : ''}.`); return 0; }
    return x;
  };
  const hydration = wert('hydration', 30, 200, undefined, 'Prozent vom Gesamtmehl');
  const starter = wert('starter', 0, 150, 0, 'Prozent vom Gesamtmehl, Starter hat 100 % Hydration');
  const salz = wert('salz', 0, 10, 0, 'Prozent');
  const oel = wert('oel', 0, 50, 0, 'Prozent');
  const hefe = wert('hefe', 0, 10, 0, 'Prozent, in der Hefe-Art von hefeArt');
  const quellwasser = wert('quellwasser', 0, 200, 0, 'Prozent vom Gesamtmehl, nur für Saaten');
  const hefeArt = roh.hefeArt ?? 'frisch';
  if (!['frisch', 'trocken'].includes(hefeArt)) f('teig.hefeArt: frisch | trocken.');

  /** Zeilen mit name + Zahl (+ id); bekannte Namen bekommen die feste id und ihre Schreibweise. */
  const zeilen = (liste, feld, wertName, bekannte, min, max, wasser = false) => {
    if (liste === undefined || liste === null) return [];
    if (!Array.isArray(liste) || liste.length > GRENZEN.teigzeilen) {
      f(`teig.${feld} muss eine Liste mit höchstens ${GRENZEN.teigzeilen} Einträgen sein.`);
      return [];
    }
    const namen = new Set();
    const aus = [];
    liste.forEach((z, i) => {
      const nr = `teig.${feld} ${i + 1}`;
      if (!z || typeof z !== 'object' || Array.isArray(z)) return f(`${nr}: kein Objekt.`);
      const extra = Object.keys(z).filter((k) => !['id', 'name', wertName, ...(wasser ? ['wasser'] : [])].includes(k));
      if (extra.length) f(`${nr}: unbekannte Felder ${extra.join(', ')}.`);
      const eingabe = sauber(z.name);
      if (!eingabe || eingabe.length > GRENZEN.name) return f(`${nr}: name fehlt oder ist zu lang.`);
      const treffer = bekannte.find((b) => b.name.toLowerCase() === eingabe.toLowerCase() || b.id === z.id);
      const name = treffer?.name ?? eingabe;
      if (namen.has(name.toLowerCase())) return f(`${nr}: „${name}“ steht doppelt.`);
      namen.add(name.toLowerCase());
      if (!inBereich(z[wertName], min, max) || z[wertName] === 0) return f(`${nr} (${name}): ${wertName} muss eine Zahl über 0 bis ${max} sein.`);
      const id = treffer?.id ?? (gueltigeZutatId(z.id) ? z.id : null);
      const zeile = { id, name, [wertName]: z[wertName] };
      if (wasser) {
        const w = z.wasser ?? treffer?.wasser;
        if (!inBereich(w, 0, 100)) return f(`${nr} (${name}): wasser (Wasseranteil in %, 0–100) fehlt – für „${name}“ gibt es keinen Standardwert.`);
        zeile.wasser = w;
      }
      aus.push(zeile);
    });
    return aus;
  };
  const mehlsorten = zeilen(roh.mehlsorten, 'mehlsorten', 'anteil', TEIG_MEHLE, 0, 100);
  if (!Array.isArray(roh.mehlsorten) || roh.mehlsorten.length === 0) f('teig.mehlsorten fehlt (mindestens eine Mehlsorte, Anteile in % vom zugegebenen Mehl).');
  else if (Math.abs(mehlsorten.reduce((a, m) => a + m.anteil, 0) - 100) > 0.5) f('teig.mehlsorten: die Anteile müssen zusammen 100 % ergeben.');
  const saaten = zeilen(roh.saaten, 'saaten', 'prozent', TEIG_SAATEN, 0, 100);
  const zusaetze = zeilen(roh.zusaetze, 'zusaetze', 'prozent', TEIG_ZUSAETZE, 0, 200, true);

  if (fehler.length > vorher) return null;
  return { format: TEIG_FORMAT, hydration, starter, salz, oel, hefe, hefeArt, mehlsorten, saaten, quellwasser, zusaetze };
}

/** Teiglinge-Angabe streng: Anzahl und Gewicht über 0, Verlust 0–100 % (Standard 2 %). */
export function pruefeTeiglinge(roh, fehler) {
  const f = (t) => { fehler.push(t); };
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return f('teiglinge fehlt: { anzahl, gewicht (g je Teigling), verlust (% Zuschlag, Standard 2) }.'), null;
  const fremd = Object.keys(roh).filter((k) => !['anzahl', 'gewicht', 'verlust'].includes(k));
  if (fremd.length) return f(`teiglinge: unbekannte Felder ${fremd.join(', ')}.`), null;
  const verlust = roh.verlust ?? STANDARD_VERLUST;
  if (!inBereich(roh.anzahl, 0, 10_000) || roh.anzahl === 0) return f('teiglinge.anzahl muss eine Zahl über 0 sein (höchstens 10000).'), null;
  if (!inBereich(roh.gewicht, 0, GRENZEN.zahl) || roh.gewicht === 0) return f('teiglinge.gewicht muss eine Zahl über 0 sein (Gramm je Teigling).'), null;
  if (!inBereich(verlust, 0, 100)) return f('teiglinge.verlust muss eine Zahl von 0 bis 100 sein (Prozent).'), null;
  return { anzahl: roh.anzahl, gewicht: roh.gewicht, verlust };
}

const summe = (zahlen) => zahlen.reduce((a, b) => a + (b || 0), 0);

/** = anteileProGrammMehl in js/teig/rechner.js */
function anteileProGrammMehl(teig) {
  const zusatzOhneWasser = summe(teig.zusaetze.map((z) => z.prozent * (1 - z.wasser / 100)));
  return (teig.hydration + teig.salz + teig.oel + teig.hefe + summe(teig.saaten.map((s) => s.prozent)) + teig.quellwasser + zusatzOhneWasser) / 100;
}

/** = mehlFuerTeiglinge in js/teig/rechner.js: zugegebenes Mehl (was man abwiegt) für Anzahl × Gewicht. */
export function mehlFuerTeiglinge(teig, anzahl, gewicht, verlust = 0) {
  const gesamt = anzahl * gewicht * (1 + Math.max(verlust, 0) / 100);
  if (gesamt <= 0) return 0;
  return (gesamt / (1 + anteileProGrammMehl(teig))) * Math.max(1 - teig.starter / 200, 0);
}

/** = berechne in js/teig/rechner.js (gleiche Gramm, ungerundet) für das zugegebene Mehl. */
export function rechneTeig(teig, mehl) {
  const nenner = 1 - teig.starter / 200;
  const gesamtmehl = mehl > 0 && nenner > 0 ? mehl / nenner : 0;
  const p = (prozent) => (gesamtmehl * prozent) / 100;
  const starter = p(teig.starter);
  const zusaetze = teig.zusaetze.map((z) => ({ name: z.name, gramm: p(z.prozent), wasser: (p(z.prozent) * z.wasser) / 100 }));
  const zusatzWasser = summe(zusaetze.map((z) => z.wasser));
  const wasserGesamt = p(teig.hydration);
  const anteile = summe(teig.mehlsorten.map((s) => s.anteil));
  const saaten = teig.saaten.map((s) => ({ name: s.name, gramm: p(s.prozent) }));
  const quellwasser = p(teig.quellwasser);
  const salz = p(teig.salz);
  const oel = p(teig.oel);
  const hefe = p(teig.hefe);
  return {
    gesamtmehl,
    mehl: teig.mehlsorten.map((s) => ({ name: s.name, gramm: anteile > 0 ? (mehl * s.anteil) / anteile : 0 })),
    wasser: wasserGesamt - starter / 2 - zusatzWasser,
    starter, salz, oel, hefe, saaten, quellwasser,
    zusaetze: zusaetze.map(({ name, gramm }) => ({ name, gramm })),
    teigGesamt: gesamtmehl + wasserGesamt + salz + oel + hefe + summe(saaten.map((s) => s.gramm)) + quellwasser
      + summe(zusaetze.map((z) => z.gramm)) - zusatzWasser,
  };
}

/** Gramm für Claude: gerundet, nur was der Teig wirklich hat. */
export function teigGramm(teig, mehl) {
  const r = rechneTeig(teig, mehl);
  const g = (x) => rund(x, 1);
  const mit = (name, x) => (x > 0 ? { [name]: g(x) } : {});
  return {
    gesamtmehl: g(r.gesamtmehl),
    mehl: r.mehl.map((m) => ({ name: m.name, gramm: g(m.gramm) })),
    wasser: g(r.wasser),
    ...mit('starter', r.starter), ...mit('salz', r.salz), ...mit('oel', r.oel), ...mit('hefe', r.hefe), ...mit('quellwasser', r.quellwasser),
    ...(r.saaten.length ? { saaten: r.saaten.map((s) => ({ name: s.name, gramm: g(s.gramm) })) } : {}),
    ...(r.zusaetze.length ? { zusaetze: r.zusaetze.map((z) => ({ name: z.name, gramm: g(z.gramm) })) } : {}),
    teigGesamt: g(r.teigGesamt),
  };
}

/**
 * Teigteile je Schritt streng prüfen: [{ teil, anteil? }] je Schritt (gleiche Länge wie die Schritte).
 * Nur Teile, die der Teig hat; je Schritt einmal; über alle Schritte nie mehr als 100 % eines Teils.
 * Ergebnis { schrittteig, verteilt } – `verteilt` = je Teil, wie viel Prozent in den Schritten vorkommt.
 */
export function pruefeSchrittTeig(roh, anzahlSchritte, teig, fehler) {
  const f = (t) => { fehler.push(t); };
  if (roh === undefined || roh === null) return null;
  if (!Array.isArray(roh) || roh.length !== anzahlSchritte) {
    return f('schrittteig braucht genau so viele Listen wie es Schritte gibt (leere Liste = kein Teigteil in diesem Schritt).'), null;
  }
  const vorhanden = {
    mehl: true, wasser: true, starter: teig.starter > 0, salz: teig.salz > 0, oel: teig.oel > 0, hefe: teig.hefe > 0,
    saaten: teig.saaten.length > 0, quellwasser: teig.saaten.length > 0, zusaetze: teig.zusaetze.length > 0,
  };
  const vorher = fehler.length;
  const gesamt = {};
  const je = roh.map((liste, i) => {
    const nr = `Schritt ${i + 1}`;
    if (!Array.isArray(liste) || liste.length > TEIG_TEILE.length) return f(`${nr}: schrittteig ist keine Liste.`), [];
    const gesehen = new Set();
    const aus = [];
    for (const e of liste) {
      if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some((k) => !['teil', 'anteil'].includes(k))) {
        f(`${nr}: Eintrag braucht teil (${TEIG_TEILE.join(' | ')}) und optional anteil (0–1).`);
        continue;
      }
      if (!TEIG_TEILE.includes(e.teil)) { f(`${nr}: teil „${e.teil}“ unbekannt. Erlaubt: ${TEIG_TEILE.join(', ')}.`); continue; }
      if (!vorhanden[e.teil]) { f(`${nr}: ${e.teil} kommt im Teig nicht vor (Wert ist 0 oder die Liste leer).`); continue; }
      if (gesehen.has(e.teil)) { f(`${nr}: ${e.teil} steht doppelt.`); continue; }
      const anteil = e.anteil ?? 1;
      if (!inBereich(anteil, 0, 1) || anteil === 0) { f(`${nr}: anteil von ${e.teil} muss größer als 0 und höchstens 1 sein.`); continue; }
      gesehen.add(e.teil);
      gesamt[e.teil] = (gesamt[e.teil] ?? 0) + anteil;
      aus.push(anteil === 1 ? { teil: e.teil } : { teil: e.teil, anteil });
    }
    return aus;
  });
  for (const [teil, x] of Object.entries(gesamt)) {
    if (x > 1.001) f(`schrittteig: ${teil} ist insgesamt ${rund(x * 100, 0)} % – mehr als 100 %. Teilmengen mit anteil aufteilen (z. B. 0,9 und 0,1).`);
  }
  if (fehler.length > vorher) return null;
  return {
    schrittteig: je.some((e) => e.length) ? je : null,
    verteilt: Object.fromEntries(Object.entries(gesamt).map(([t, x]) => [t, rund(x * 100, 0)])),
  };
}

// ---------- Prüfen ----------

const FELDER = ['art', 'name', 'kategorie', 'portionen', 'portionsart', 'zutaten', 'schritte', 'schrittzutaten', 'schrittgeraete', 'status',
  'ernaehrung', 'auchVegetarisch', 'notiz', 'quelle', 'teig', 'mehl', 'modus', 'teiglinge', 'schrittteig'];
/** Felder, die nur Back-Rezepte haben. */
const BACK_FELDER = ['teig', 'mehl', 'modus', 'teiglinge', 'schrittteig'];

function kategorieVon(x, liste = KOCH_KATEGORIEN) {
  if (typeof x !== 'string') return null;
  const k = x.trim().toLowerCase();
  return liste.find((e) => e.id === k || e.name.toLowerCase() === k)?.id ?? null;
}

/**
 * Prüft ein Koch-Rezept von Claude. Zutaten mit `name` (oder intern mit Katalog-`zutat`), Zutaten je
 * Schritt ebenso. Streng: Unsinn wird nicht still repariert, sondern mit Grund abgewiesen, damit Claude
 * es verbessern kann.
 * Ergebnis: { rezept, neu } – `rezept` genau in der Form von `bereinigeRezept` (ohne id), `neu` = neue
 * Katalogeinträge { id, name, art } – oder { fehler: [Text, …] }.
 * `katalog` wird nicht verändert. `bekannt`: weitere erlaubte Katalog-ids (Zutaten des bisherigen Rezepts).
 * `pflicht`: schrittzutaten und ernaehrung müssen angegeben sein (Anlegen; beim Aktualisieren alter Rezepte nicht).
 * Back-Rezepte (`art: 'backen'`): Teigwerte (`teig`, `mehl` bzw. `teiglinge`, `modus`, `schrittteig`) werden streng geprüft;
 * Zutaten und Portionen sind dort freiwillig (Belag u. ä.). `teigDurchreichen`: beim Aktualisieren ohne Teig-Änderung gelten
 * die gespeicherten Teigwerte unverändert (alte Rezepte vom Handy sollen sich nicht an der strengen Prüfung stoßen).
 * Ergebnis bei Back-Rezepten zusätzlich: `gramm` (errechnete Mengen) und `verteilt` (Prozent je Teigteil in den Schritten).
 */
export function pruefeRezept(roh, katalog, { bekannt = [], pflicht = true, teigDurchreichen = false } = {}) {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return { fehler: ['Rezept fehlt oder ist kein Objekt.'] };
  const fehler = [];
  const f = (t) => fehler.push(t);

  const fremd = Object.keys(roh).filter((k) => !FELDER.includes(k));
  if (fremd.length) f(`Unbekannte Felder: ${fremd.join(', ')}.`);

  const name = sauber(roh.name);
  if (!name) f('name fehlt.');
  else if (name.length > GRENZEN.name) f(`name ist zu lang (höchstens ${GRENZEN.name} Zeichen).`);

  const art = roh.art ?? 'kochen';
  if (!ARTEN.includes(art)) f(`art: ${ARTEN.join(' | ')}.`);
  const backen = art === 'backen';
  if (!backen) {
    const zuviel = BACK_FELDER.filter((k) => roh[k] !== undefined && roh[k] !== null);
    if (zuviel.length) f(`${zuviel.join(', ')} gibt es nur bei Back-Rezepten (art: backen).`);
  }

  const kategorienListe = backen ? BACK_KATEGORIEN : KOCH_KATEGORIEN;
  const kategorie = kategorieVon(roh.kategorie, kategorienListe);
  if (!kategorie) f(`kategorie fehlt oder ist unbekannt. Erlaubt: ${kategorienListe.map((k) => k.id).join(', ')}.`);

  const ohnePortionen = backen && (roh.portionen === undefined || roh.portionen === null);
  if (!ohnePortionen && !istZahl(roh.portionen, GRENZEN.portionen)) f(`portionen muss eine Zahl über 0 sein (höchstens ${GRENZEN.portionen}).`);
  const portionsart = roh.portionsart ?? 'personen';
  if (!PORTIONSARTEN.includes(portionsart)) f(`portionsart: ${PORTIONSARTEN.join(' | ')}.`);

  // Zutaten
  const liste = [...katalog];
  const erlaubt = new Set([...katalog.map((z) => z.id), ...bekannt]);
  const neu = [];
  const zutaten = [];
  const rohZutaten = backen && (roh.zutaten === undefined || roh.zutaten === null) ? [] : roh.zutaten;
  if (!Array.isArray(rohZutaten) || (rohZutaten.length === 0 && !backen)) f('zutaten fehlt (mindestens eine Zutat).');
  else if (rohZutaten.length > GRENZEN.zutaten) f(`Höchstens ${GRENZEN.zutaten} Zutaten.`);
  else rohZutaten.forEach((z, i) => {
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
    if (pflicht && (!backen || zutaten.length)) f('schrittzutaten fehlt: je Schritt eine Liste der Zutaten dieses Schritts (leere Liste, wenn keine).');
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

  // Gerät je Schritt (optional): gleiche Länge wie die Schritte, leerer Text = kein Gerät
  let schrittgeraete = null;
  const sg = roh.schrittgeraete;
  if (sg !== undefined && sg !== null) {
    if (!Array.isArray(sg) || !Array.isArray(roh.schritte) || sg.length !== roh.schritte.length) {
      f('schrittgeraete braucht genau so viele Einträge wie es Schritte gibt (leerer Text = kein Gerät).');
    } else {
      schrittgeraete = sg.map((g, i) => {
        const t = g === null ? '' : sauber(g);
        if (t === null || t.length > GRENZEN.geraet) {
          f(`Schritt ${i + 1}: Gerät ist kein kurzer Text (höchstens ${GRENZEN.geraet} Zeichen).`);
          return '';
        }
        return t;
      });
    }
  }

  // Teigwerte (nur Back-Rezepte)
  let teig = null;
  let mehl = null;
  let modus = null;
  let teiglinge = null;
  let schrittteig = null;
  let gramm = null;
  let verteilt = null;
  if (backen) {
    modus = roh.modus ?? (roh.teiglinge !== undefined && roh.teiglinge !== null ? 'teiglinge' : 'mehl');
    if (!MODI.includes(modus)) f(`modus: ${MODI.join(' | ')}.`);
    if (teigDurchreichen) {
      teig = roh.teig; mehl = roh.mehl; teiglinge = roh.teiglinge ?? null;
    } else {
      teig = pruefeTeig(roh.teig, fehler);
      if (modus === 'teiglinge') {
        teiglinge = pruefeTeiglinge(roh.teiglinge, fehler);
        if (teig && teiglinge) mehl = rund(mehlFuerTeiglinge(teig, teiglinge.anzahl, teiglinge.gewicht, teiglinge.verlust), 2);
      } else {
        if (roh.teiglinge !== undefined && roh.teiglinge !== null) f('teiglinge gibt es nur im modus teiglinge.');
        if (!istZahl(roh.mehl, GRENZEN.zahl)) f('mehl fehlt: zugegebenes Mehl in Gramm (was man abwiegt, ohne das Mehl im Starter), eine Zahl über 0.');
        else mehl = roh.mehl;
      }
    }
    if (teig && mehl !== null && Array.isArray(roh.schritte)) {
      if (!teigDurchreichen && mehl > 0) {
        const r = rechneTeig(teig, mehl);
        if (r.wasser < -0.05) f(`teig.hydration (${teig.hydration} %) ist zu niedrig: Starter und Zusatzzutaten bringen schon mehr Wasser mit, als der Teig insgesamt hat.`);
      }
      const st = pruefeSchrittTeig(roh.schrittteig, roh.schritte.length, teig, fehler);
      if (st) { schrittteig = st.schrittteig; verteilt = st.verteilt; }
      if (Number.isFinite(mehl) && mehl > 0 && !fehler.length) {
        try { gramm = teigGramm(teig, mehl); } catch { gramm = null; }
      }
    }
  }

  const quelle = roh.quelle ?? 'claude';
  if (!QUELLEN.includes(quelle)) f(`quelle: ${QUELLEN.join(' | ')}.`);
  const status = roh.status ?? (quelle === 'import' ? 'testen' : 'erprobt');
  if (!STATUS.includes(status)) f(`status: ${STATUS.join(' | ')}.`);
  const notiz = roh.notiz === undefined || roh.notiz === null ? '' : sauber(roh.notiz);
  if (notiz === null || notiz.length > GRENZEN.notiz) f(`notiz ist kein Text bis ${GRENZEN.notiz} Zeichen.`);

  // Ernährungsform: beim Anlegen Pflicht; „auch vegetarisch“ nur bei Fisch/Fleisch
  const ernaehrung = roh.ernaehrung ?? null;
  if (ernaehrung === null) {
    if (pflicht) f(`ernaehrung fehlt: ${ERNAEHRUNG.join(' | ')}.`);
  } else if (!ERNAEHRUNG.includes(ernaehrung)) f(`ernaehrung: ${ERNAEHRUNG.join(' | ')}.`);
  const auchVegetarisch = roh.auchVegetarisch ?? false;
  if (typeof auchVegetarisch !== 'boolean') f('auchVegetarisch muss true oder false sein.');
  else if (auchVegetarisch && !MIT_TIER.includes(ernaehrung)) f('auchVegetarisch gibt es nur bei ernaehrung fisch oder fleisch.');

  if (fehler.length) return { fehler: fehler.slice(0, 15) };
  const benutzt = new Set(zutaten.map((z) => z.zutat));
  return {
    ...(backen ? { gramm, verteilt } : {}),
    rezept: {
      art,
      name,
      kategorie,
      ...(ohnePortionen ? {} : { portionen: roh.portionen }),
      portionsart,
      zutaten,
      schritte,
      // wie `bereinigeRezept`: ganz ohne Einträge fehlt das Feld (Rückfall Namenssuche)
      ...(schrittzutaten && schrittzutaten.some((e) => e.length) ? { schrittzutaten } : {}),
      // ebenso: kein einziges Gerät = Feld fehlt
      ...(schrittgeraete && schrittgeraete.some(Boolean) ? { schrittgeraete } : {}),
      status,
      ...(ernaehrung ? { ernaehrung } : {}),
      ...(auchVegetarisch === true ? { auchVegetarisch } : {}),
      notiz,
      quelle,
      ...(backen ? {
        teig, mehl, modus,
        ...(schrittteig ? { schrittteig } : {}),
        // wie bei den Teigvorlagen: Teiglinge-Angabe nur im Teiglinge-Modus
        ...(modus === 'teiglinge' && teiglinge ? { teiglinge } : {}),
      } : {}),
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
    art: d.art === 'backen' ? 'backen' : 'kochen',
    name: d.name, kategorie: d.kategorie ?? null, portionen: d.portionen ?? null, portionsart: d.portionsart ?? 'personen',
    zutaten,
    schritte,
    schrittzutaten: Array.isArray(d.schrittzutaten)
      ? d.schrittzutaten.map((je) => (Array.isArray(je) ? je : []).map((e) => (
        e.menge === undefined ? { name: name(e.zutat) } : { name: name(e.zutat), menge: e.menge })))
      : null,
    schrittgeraete: Array.isArray(d.schrittgeraete) ? d.schrittgeraete : null,
    status: d.status ?? 'erprobt',
    ernaehrung: d.ernaehrung ?? null, auchVegetarisch: d.auchVegetarisch === true,
    notiz: d.notiz ?? '', quelle: d.quelle ?? 'hand',
    ...(d.art === 'backen' ? {
      teig: d.teig ?? null,
      mehl: d.mehl ?? null,
      modus: d.modus === 'teiglinge' ? 'teiglinge' : 'mehl',
      teiglinge: d.modus === 'teiglinge' ? d.teiglinge ?? null : null,
      schrittteig: Array.isArray(d.schrittteig) ? d.schrittteig : null,
    } : {}),
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

const PROZENT_ZEILE = (wertName, beschreibung, mitWasser = false) => ({
  type: 'array',
  maxItems: GRENZEN.teigzeilen,
  description: beschreibung,
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name; bekannte Namen (Mehl, Saaten, Milch, Ei, Butter, Zucker, Honig) bekommen ihre feste id.' },
      [wertName]: { type: 'number', exclusiveMinimum: 0 },
      ...(mitWasser ? { wasser: { type: 'number', minimum: 0, maximum: 100, description: 'Wasseranteil in %; bei Milch, Ei, Butter, Zucker, Honig automatisch.' } } : {}),
    },
    required: ['name', wertName],
    additionalProperties: false,
  },
});

const TEIG_SCHEMA = {
  type: 'object',
  description: 'Teigwerte in Bäckerprozent: alle Prozente beziehen sich auf das Gesamtmehl (inklusive Mehl im Starter). Starter hat 100 % Hydration.',
  properties: {
    hydration: { type: 'number', minimum: 30, maximum: 200, description: 'Gesamtwasser in % vom Gesamtmehl; Wasser im Starter und in Milch/Ei zählt dazu.' },
    starter: { type: 'number', minimum: 0, maximum: 150, description: 'Starter (Anstellgut) in % vom Gesamtmehl; 0 = ohne.' },
    salz: { type: 'number', minimum: 0, maximum: 10 },
    oel: { type: 'number', minimum: 0, maximum: 50 },
    hefe: { type: 'number', minimum: 0, maximum: 10, description: 'In % vom Gesamtmehl, in der Hefe-Art von hefeArt.' },
    hefeArt: { type: 'string', enum: ['frisch', 'trocken'] },
    mehlsorten: PROZENT_ZEILE('anteil', 'Mehlsorten mit Anteil in % vom zugegebenen Mehl; zusammen 100 %. Mindestens eine.'),
    saaten: PROZENT_ZEILE('prozent', 'Saaten (Quellstück) in % vom Gesamtmehl.'),
    quellwasser: { type: 'number', minimum: 0, maximum: 200, description: 'Quellwasser für die Saaten in % vom Gesamtmehl; zählt nicht zur Hydration.' },
    zusaetze: PROZENT_ZEILE('prozent', 'Zusatzzutaten (Milch, Ei, Butter, Zucker, Honig, eigene) in % vom Gesamtmehl.', true),
  },
  required: ['hydration', 'mehlsorten'],
  additionalProperties: false,
};

const REZEPT_FELDER = {
  art: { type: 'string', enum: ARTEN, description: 'kochen (Standard) oder backen (Teig mit Teigwerten).' },
  name: { type: 'string', maxLength: GRENZEN.name },
  kategorie: {
    type: 'string', enum: [...KOCH_KATEGORIEN, ...BACK_KATEGORIEN].map((k) => k.id),
    description: `Kochen: ${KOCH_KATEGORIEN.map((k) => `${k.id} = ${k.name}`).join('; ')}. Backen: ${BACK_KATEGORIEN.map((k) => `${k.id} = ${k.name}`).join('; ')}.`,
  },
  portionen: { type: 'number', exclusiveMinimum: 0, maximum: GRENZEN.portionen, description: 'Pflicht beim Kochen; beim Backen freiwillig.' },
  teig: TEIG_SCHEMA,
  mehl: { type: 'number', exclusiveMinimum: 0, maximum: GRENZEN.zahl, description: 'Nur Backen im modus mehl: zugegebenes Mehl in Gramm (was man abwiegt, ohne das Mehl im Starter).' },
  modus: { type: 'string', enum: MODI, description: 'Nur Backen: mehl (Standard, Menge über das Mehl) oder teiglinge (Anzahl × Gewicht, z. B. Brötchen, Pizza).' },
  teiglinge: {
    type: 'object', description: 'Nur Backen im modus teiglinge: das Mehl wird daraus errechnet.',
    properties: {
      anzahl: { type: 'number', exclusiveMinimum: 0 }, gewicht: { type: 'number', exclusiveMinimum: 0, description: 'Gramm je Teigling.' },
      verlust: { type: 'number', minimum: 0, maximum: 100, description: 'Zuschlag in % (Rest an Schüssel und Händen), Standard 2.' },
    },
    required: ['anzahl', 'gewicht'], additionalProperties: false,
  },
  schrittteig: {
    type: 'array', maxItems: GRENZEN.schritte,
    description: 'Nur Backen, optional: je Schritt (gleiche Länge wie schritte) die Teigteile, die dort gebraucht werden: [{ teil, anteil? }]. teil: mehl, wasser, starter, salz, oel, hefe, saaten, quellwasser, zusaetze (Mehl, Saaten und Zusätze je Sorte). anteil 0–1 für eine Teilmenge (Wasser 0,9 in Schritt 2 und 0,1 in Schritt 3); ohne anteil = alles. Ein Teil darf insgesamt nicht mehr als 100 % ergeben. Leere Liste = kein Teigteil.',
    items: {
      type: 'array', maxItems: TEIG_TEILE.length,
      items: {
        type: 'object',
        properties: { teil: { type: 'string', enum: TEIG_TEILE }, anteil: { type: 'number', exclusiveMinimum: 0, maximum: 1 } },
        required: ['teil'], additionalProperties: false,
      },
    },
  },
  portionsart: { type: 'string', enum: PORTIONSARTEN },
  zutaten: { type: 'array', items: ZUTAT_SCHEMA, maxItems: GRENZEN.zutaten, description: 'Beim Kochen mindestens eine. Beim Backen nur weitere Zutaten (Belag, Füllung …): Mehl, Wasser, Salz, Starter, Hefe, Saaten rechnet der Teig.' },
  schritte: { type: 'array', items: { type: 'string', maxLength: GRENZEN.schritt }, minItems: 1, maxItems: GRENZEN.schritte, description: 'Kurz, ein Handgriff pro Schritt.' },
  schrittgeraete: {
    type: 'array',
    maxItems: GRENZEN.schritte,
    description: 'Optional: je Schritt (gleiche Reihenfolge, gleiche Länge wie schritte) das Gerät, z. B. „Wok“, „Beschichtete Pfanne“, „Ofen 200 °C Umluft“, „Airfryer“; leerer Text = kein Gerät. Kurz, Gerät und Einstellung zusammen.',
    items: { type: 'string', maxLength: GRENZEN.geraet },
  },
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
  ernaehrung: {
    type: 'string', enum: ERNAEHRUNG,
    description: 'vegan = nichts vom Tier; vegetarisch = Milch, Ei, Käse, Honig ja, kein Fleisch und kein Fisch (auch keine Fischsauce, Brühe vom Tier, Gelatine); fisch = Fisch oder Meeresfrüchte, kein Fleisch; fleisch = mit Fleisch.',
  },
  auchVegetarisch: {
    type: 'boolean',
    description: 'Nur bei fisch oder fleisch: true, wenn sich das Gericht leicht für einen Teil vegetarisch machen lässt (die Variante in einem Satz in die notiz).',
  },
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
    description: 'Sucht Rezepte (Kochen und Backen) nach Namen (Teilwort; leer = alle, höchstens 100). Mit id: das ganze Rezept samt version (für rezept_aktualisieren), bei Back-Rezepten mit Teigwerten.',
    inputSchema: {
      type: 'object',
      properties: { suche: { type: 'string' }, id: { type: 'string' } },
      additionalProperties: false,
    },
    annotations: { title: 'Rezepte finden', readOnlyHint: true },
  },
  {
    name: 'rezept_anlegen',
    description: 'Legt Rezepte neu an (eins oder mehrere, höchstens 50): Koch-Rezepte und Back-Rezepte (art: backen, mit teig, mehl bzw. teiglinge, schrittteig). Gibt es ein Rezept mit gleichem Namen schon, wird es nicht angelegt – dann rezept_aktualisieren. Unbekannte Zutatennamen werden neue Zutaten. Bei Back-Rezepten kommen die errechneten Gramm (gramm) und die Verteilung auf die Schritte (schrittteig_verteilt) zurück: bitte gegen das Rezept prüfen.',
    inputSchema: {
      type: 'object',
      properties: {
        rezepte: {
          type: 'array', minItems: 1, maxItems: MAX_REZEPTE,
          items: {
            type: 'object', properties: REZEPT_FELDER, additionalProperties: false,
            required: ['name', 'kategorie', 'schritte', 'ernaehrung'],
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
    description: 'Ändert ein vorhandenes Rezept. Nötig: id und version aus rezepte_finden. Nur die angegebenen Felder werden ersetzt (notiz ersetzt die alte Notiz ganz). Wer zutaten oder schritte ändert, liefert schrittzutaten neu mit (und schrittgeraete bzw. schrittteig, falls das Rezept sie hat). Back-Rezepte: teig wird als Ganzes ersetzt (erst mit rezepte_finden lesen und ändern); die art lässt sich nicht ändern. Wurde das Rezept inzwischen anders geändert, bleibt es unverändert und die Änderung wird eine Kopie.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, version: { type: 'integer', minimum: 1 }, ...REZEPT_FELDER },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    annotations: { title: 'Rezept ändern', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

const ANLEITUNG = 'Kochbuch der Familie (Koch- und Back-Rezepte). Vor dem Speichern zutaten_liste abfragen und diese Namen benutzen. '
  + 'Vorher mit rezepte_finden prüfen, ob es das Rezept schon gibt; dann rezept_aktualisieren statt neu anlegen. '
  + 'Mengen für die angegebenen Portionen, Schritte kurz, zu jedem Schritt schrittzutaten und, wenn bekannt, das Gerät (schrittgeraete). '
  + 'Immer die Ernährungsform (ernaehrung, bei Fisch/Fleisch ggf. auchVegetarisch). '
  + 'Back-Rezepte (art: backen): Teigwerte in Bäckerprozent (teig), zugegebenes Mehl (mehl) oder Anzahl × Gewicht (teiglinge), Teigmengen je Schritt (schrittteig); die Antwort nennt die errechneten Gramm. Löschen geht nicht.';

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

/** Back-Rezept: was der Teig in Gramm ergibt und wie die Schritte ihn verteilen – damit Claude Fehler sieht. */
function rechnungFuerClaude(geprueft) {
  if (!geprueft.gramm) return {};
  return {
    gramm: geprueft.gramm,
    ...(geprueft.rezept.mehl !== undefined && geprueft.rezept.modus === 'teiglinge' ? { mehl_errechnet: geprueft.rezept.mehl } : {}),
    ...(geprueft.verteilt && Object.keys(geprueft.verteilt).length ? { schrittteig_verteilt: geprueft.verteilt } : {}),
  };
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
    zuSpeichern.push({ index: i, daten: geprueft.rezept, rechnung: rechnungFuerClaude(geprueft) });
  }

  if (neu.size > MAX_NEUE_ZUTATEN) throw new Hinweis('Zu viele neue Zutaten auf einmal – bitte weniger Rezepte je Aufruf.');
  if (zuSpeichern.length) {
    const benutzt = new Set(zuSpeichern.flatMap((r) => r.daten.zutaten.map((z) => z.zutat)));
    const zutaten = [...neu.values()].filter((z) => benutzt.has(z.id));
    const antwort = await mitDb(db, (d) => d.rezeptSpeichern({ zutaten, rezepte: zuSpeichern.map((r) => ({ daten: r.daten })) }));
    zuSpeichern.forEach((r, j) => { antworten[r.index] = { ...speicherErgebnis(antwort?.rezepte?.[j], r.daten.name), ...r.rechnung }; });
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

  const [katalog, gelesen] = await Promise.all([katalogLaden(db), mitDb(db, (d) => d.rezeptLesen(id))]);
  if (!gelesen) throw new Hinweis('Kein Rezept mit dieser id (vielleicht gelöscht). Dann mit rezept_anlegen neu anlegen.');
  const alt = gelesen.daten ?? {};
  const altArt = alt.art === 'backen' ? 'backen' : 'kochen';
  // Beim Backen ohne weitere Zutaten gibt es nichts zu verteilen
  const ohneZutaten = altArt === 'backen' && !(Array.isArray(alt.zutaten) && alt.zutaten.length) && !aenderung.zutaten?.length;
  if ((aenderung.zutaten !== undefined || aenderung.schritte !== undefined) && aenderung.schrittzutaten === undefined && !ohneZutaten) {
    throw new Hinweis('Wer zutaten oder schritte ändert, muss schrittzutaten neu mitliefern.');
  }
  if (aenderung.art !== undefined && aenderung.art !== altArt) throw new Hinweis(`Die art eines Rezepts lässt sich nicht ändern (hier: ${altArt}).`);
  if (altArt === 'backen' && aenderung.schritte !== undefined && aenderung.schrittteig === undefined
    && Array.isArray(alt.schrittteig) && alt.schrittteig.some((e) => e?.length)) {
    throw new Hinweis('Wer schritte ändert, muss schrittteig neu mitliefern (je Schritt eine Liste, leer = kein Teigteil).');
  }
  // Geräte gehören zu den Schritten: Ändern sich die Schritte, müssen sie mitkommen (sonst verrutschen sie)
  if (aenderung.schritte !== undefined && aenderung.schrittgeraete === undefined
    && Array.isArray(alt.schrittgeraete) && alt.schrittgeraete.some(Boolean)) {
    throw new Hinweis('Wer schritte ändert, muss schrittgeraete neu mitliefern (je Schritt ein Eintrag, leer = kein Gerät).');
  }

  // Bisheriger Stand (mit Katalog-ids) plus Änderungen; geprüft wird das Ganze
  const zusammen = {
    name: alt.name, kategorie: alt.kategorie, portionen: alt.portionen, portionsart: alt.portionsart,
    zutaten: alt.zutaten, schritte: alt.schritte, schrittzutaten: alt.schrittzutaten, schrittgeraete: alt.schrittgeraete,
    status: alt.status, ernaehrung: alt.ernaehrung, auchVegetarisch: alt.auchVegetarisch, notiz: alt.notiz,
    quelle: QUELLEN.includes(alt.quelle) ? alt.quelle : 'claude',
    art: altArt,
    ...(altArt === 'backen' ? {
      teig: alt.teig, mehl: alt.mehl, modus: alt.modus, teiglinge: alt.teiglinge, schrittteig: alt.schrittteig,
    } : {}),
    ...aenderung,
  };
  // Back-Rezept: Teigwerte unverändert durchreichen, solange Claude sie nicht anfasst (alte Rezepte vom Handy)
  const teigAngefasst = ['teig', 'mehl', 'modus', 'teiglinge'].some((k) => aenderung[k] !== undefined);
  if (altArt === 'backen' && aenderung.modus === 'mehl' && aenderung.teiglinge === undefined) delete zusammen.teiglinge;
  // Neue Ernährungsform ohne Angabe zu „auch vegetarisch“: die alte Angabe passt evtl. nicht mehr
  if (aenderung.ernaehrung !== undefined && aenderung.auchVegetarisch === undefined) delete zusammen.auchVegetarisch;
  const bekannt = (Array.isArray(alt.zutaten) ? alt.zutaten : []).map((z) => z?.zutat).filter(gueltigeZutatId);
  const geprueft = pruefeRezept(zusammen, katalog, { bekannt, pflicht: false, teigDurchreichen: altArt === 'backen' && !teigAngefasst });
  if (geprueft.fehler) throw new Hinweis(`Nicht gespeichert: ${geprueft.fehler.join(' ')}`);

  const antwort = await mitDb(db, (d) => d.rezeptSpeichern({
    zutaten: geprueft.neu, rezepte: [{ id, basis: version, daten: geprueft.rezept }],
  }));
  const e = { ...speicherErgebnis(antwort?.rezepte?.[0], geprueft.rezept.name), ...rechnungFuerClaude(geprueft) };
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
