// Tests für die Edge Function des Connectors (supabase/functions/kochbuch/index.ts, Etappe 3 Schritt 8).
// 1. Die Kopien (Kategorien, Grenzen, eingebaute Zutaten, zutatId) stimmen mit den Originalen in js/ überein,
//    und was die Funktion speichert, übernimmt die App (`bereinigeRezept`) unverändert.
// 2. MCP-Ablauf und Schlüssel. 3. Die Werkzeuge mit einer nachgebauten Datenbank.
// Der Durchlauf gegen echtes PostgreSQL steht in tests/datenbank.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bearbeite, pruefeRezept, katalogAus, fuerClaude, datenbankMit, zutatId, bereinigeZutatenName,
  KOCH_KATEGORIEN, PORTIONSARTEN, REGELN, STATUS, QUELLEN, ERNAEHRUNG, MIT_TIER, ZUTAT_ARTEN, EINGEBAUT, GRENZEN, WERKZEUGE,
} from '../supabase/functions/kochbuch/index.ts';
import * as rezeptJs from '../js/rezepte/rezept.js';
import * as katalogJs from '../js/rezepte/katalog.js';

const SCHLUESSEL = 'testschluessel-0123456789abcdefghijklmnop';
const ADRESSE = 'https://beispiel.supabase.co/functions/v1/kochbuch';
const quelltext = readFileSync(new URL('../supabase/functions/kochbuch/index.ts', import.meta.url), 'utf8');

/** Rezept, wie Claude es schickt (Zutaten mit Namen). */
const curry = (aenderung = {}) => ({
  name: 'Linsencurry', kategorie: 'currys', portionen: 4, ernaehrung: 'vegetarisch',
  zutaten: [
    { name: 'Tempeh', menge: 200, einheit: 'g', art: 'vorrat' },
    { name: 'Zwiebel', menge: 1, einheit: '', regel: 'ganz', art: 'gemuese' },
    { name: 'Wasser', menge: 800, einheit: 'ml' },
    { name: 'Salz', menge: null, regel: 'fix' },
    { name: 'Butter', menge: 20, einheit: 'g' },
  ],
  schritte: ['Zwiebel würfeln.', 'In Butter anschwitzen.', 'Linsen und 600 ml Wasser dazu.', 'Restliches Wasser nach Bedarf, salzen.'],
  schrittzutaten: [
    [{ name: 'Zwiebel' }],
    [{ name: 'Butter' }],
    [{ name: 'Tempeh' }, { name: 'Wasser', menge: 600 }],
    [{ name: 'Wasser', menge: 200 }, { name: 'Salz' }],
  ],
  ...aenderung,
});

// ---------- Kopien = Originale ----------

test('Kopien stimmen mit js/ überein: Kategorien, Arten, Regeln, eingebaute Zutaten', () => {
  assert.deepEqual(KOCH_KATEGORIEN, rezeptJs.KOCH_KATEGORIEN);
  assert.deepEqual(PORTIONSARTEN, rezeptJs.PORTIONSARTEN.map((p) => p.id));
  assert.deepEqual(REGELN, rezeptJs.REGELN);
  assert.deepEqual(STATUS, rezeptJs.STATUS);
  assert.deepEqual(ERNAEHRUNG, rezeptJs.ERNAEHRUNG);
  assert.deepEqual(MIT_TIER, rezeptJs.MIT_TIER);
  assert.deepEqual(QUELLEN, rezeptJs.QUELLEN.filter((q) => q !== 'hand'));
  assert.deepEqual(ZUTAT_ARTEN, katalogJs.ARTEN);
  assert.deepEqual(EINGEBAUT, katalogJs.EINGEBAUT);
});

test('zutatId und Zutatennamen rechnen wie die App', () => {
  for (const name of ['Kokosmilch', 'Kokos-Milch', 'Weizen 550', 'Crème fraîche', 'Grüne Bohnen', 'Süßkartoffel', 'Jalapeño',
    '  Paprika  rot ', 'ÄÖÜ äöü ß', '!!!', '', 'x'.repeat(100), 'Ei\nweiß', 'Tomaten (gehackt, Dose)', 42, null]) {
    assert.equal(zutatId(name), katalogJs.zutatId(name), String(name));
    assert.equal(bereinigeZutatenName(name), katalogJs.bereinigeZutatenName(name), String(name));
  }
});

test('Grenzen wie in der App: Texte werden dort genau auf diese Länge gekürzt, Listen darüber abgewiesen', () => {
  const basis = { art: 'kochen', name: 'R', portionen: 2, zutaten: [], schritte: ['a'] };
  const app = (aenderung) => rezeptJs.bereinigeRezept({ ...basis, ...aenderung });
  assert.equal(app({ name: 'x'.repeat(200) }).name.length, GRENZEN.name);
  assert.equal(app({ schritte: ['x'.repeat(900)] }).schritte[0].length, GRENZEN.schritt);
  assert.equal(app({ notiz: 'x'.repeat(9000) }).notiz.length, GRENZEN.notiz);
  assert.equal(app({ zutaten: [{ zutat: 'salz', einheit: 'x'.repeat(50) }] }).zutaten[0].einheit.length, GRENZEN.einheit);
  assert.equal(app({ zutaten: Array.from({ length: GRENZEN.zutaten }, () => ({ zutat: 'salz' })) }).zutaten.length, GRENZEN.zutaten);
  assert.equal(app({ zutaten: Array.from({ length: GRENZEN.zutaten + 1 }, () => ({ zutat: 'salz' })) }), null);
  assert.equal(app({ schritte: Array(GRENZEN.schritte).fill('a') }).schritte.length, GRENZEN.schritte);
  assert.equal(app({ schritte: Array(GRENZEN.schritte + 1).fill('a') }), null);
  assert.equal(app({ portionen: GRENZEN.portionen }).portionen, GRENZEN.portionen);
  assert.equal(app({ portionen: GRENZEN.portionen + 1 }), null);
  assert.equal(app({ zutaten: [{ zutat: 'salz', menge: GRENZEN.zahl }] }).zutaten[0].menge, GRENZEN.zahl);
  assert.equal(app({ zutaten: [{ zutat: 'salz', menge: GRENZEN.zahl + 1 }] }), null);
  const viele = Array.from({ length: 30 }, (_, i) => ({ zutat: `z${i}` }));
  assert.equal(app({ zutaten: viele, schrittzutaten: [viele] }).schrittzutaten[0].length, GRENZEN.schrittzutaten);
});

/** Was die App aus demselben Rezept machen würde (speichereRezept ohne Speicher: Namen auflösen + bereinigen). */
function wieDieApp(roh, katalog) {
  const { roh: mitIds, neu } = rezeptJs.loeseNamenAuf({ art: 'kochen', quelle: 'claude', ...roh }, katalog);
  return { rezept: rezeptJs.bereinigeRezept(mitIds), neu };
}

test('Gültige Rezepte: genau das, was die App selbst daraus macht (und von ihr unverändert übernommen)', () => {
  const vorhanden = [{ id: 'tempeh-alt', name: 'Tempeh' }, { id: 'kokosmilch', name: 'Kokosmilch' }];
  const katalog = katalogAus(vorhanden);
  const appKatalog = [...katalogJs.EINGEBAUT, ...vorhanden.map((z) => ({ ...z, art: 'sonstiges' }))];
  const faelle = [
    curry(),
    curry({ portionsart: 'stueck', portionen: 2.5, status: 'testen', notiz: '  Weniger Salz.\nMehr Ingwer. ', quelle: 'import' }),
    curry({ quelle: 'import' }),
    curry({ kategorie: 'Currys & Dal', name: '  Curry\tfein  ' }),
    curry({ schrittzutaten: [[], [], [], []] }),
    curry({ schrittgeraete: ['', 'Beschichtete Pfanne', 'Topf', 'Topf'] }),
    curry({ schrittgeraete: ['', '', '', ''] }),
    curry({ zutaten: [{ name: 'Kokos-Milch', menge: 400, einheit: 'ml' }, { name: 'Weizen 550', menge: 1, einheit: 'EL' }],
      schritte: ['Alles.'], schrittzutaten: [[{ name: 'kokosmilch', menge: 100 }, { name: 'WEIZEN 550' }]] }),
  ];
  for (const roh of faelle) {
    const ich = pruefeRezept(roh, katalog);
    assert.ok(ich.rezept, JSON.stringify(ich.fehler));
    // Kategorie darf auch ihr Name sein (Connector macht die id daraus)
    const app = wieDieApp({ ...roh, kategorie: ich.rezept.kategorie }, appKatalog);
    assert.deepEqual(ich.rezept, app.rezept);
    assert.deepEqual(ich.neu, app.neu);
    assert.deepEqual(rezeptJs.bereinigeRezept(ich.rezept), ich.rezept);
  }
  const r = pruefeRezept(curry(), katalog);
  assert.deepEqual(r.neu, []); // Zwiebel, Wasser, Salz sind eingebaut
  assert.equal(r.rezept.zutaten[1].zutat, 'zwiebel');
  assert.equal(r.rezept.zutaten[0].zutat, 'tempeh-alt'); // vorhandene Zutat über den Namen gefunden
  assert.equal(r.rezept.zutaten[4].zutat, 'butter'); // eingebaute
  assert.deepEqual(r.rezept.schrittzutaten[2], [{ zutat: 'tempeh-alt' }, { zutat: 'wasser', menge: 600 }]);
  assert.equal(r.rezept.status, 'erprobt');
  assert.equal(pruefeRezept(curry({ quelle: 'import' }), katalog).rezept.status, 'testen');
  assert.equal(pruefeRezept(curry({ schrittzutaten: [[], [], [], []] }), katalog).rezept.schrittzutaten, undefined);
  assert.deepEqual(pruefeRezept(curry({ schrittgeraete: [' ', 'Wok', null, 'Ofen 200 °C Umluft'] }), katalog).rezept.schrittgeraete, ['', 'Wok', '', 'Ofen 200 °C Umluft']);
  assert.equal(pruefeRezept(curry({ schrittgeraete: ['', '', '', ''] }), katalog).rezept.schrittgeraete, undefined, 'kein Gerät = Feld fehlt');
});

test('Unsinn wird mit verständlichem Grund abgewiesen, nie still repariert', () => {
  const k = katalogAus([]);
  const grund = (roh, opt) => pruefeRezept(roh, k, opt).fehler?.join(' ') ?? 'OK';
  assert.match(grund(null), /kein Objekt/);
  assert.match(grund([]), /kein Objekt/);
  assert.match(grund(curry({ art: 'backen' })), /Unbekannte Felder: art/);
  assert.match(grund(curry({ teig: {} })), /Unbekannte Felder: teig/);
  assert.match(grund(curry({ name: ' ' })), /name fehlt/);
  assert.match(grund(curry({ name: 'x'.repeat(81) })), /name ist zu lang/);
  assert.match(grund(curry({ kategorie: undefined })), /kategorie fehlt.*pasta, currys/);
  assert.match(grund(curry({ kategorie: 'Kuchen' })), /kategorie/);
  assert.match(grund(curry({ portionen: '4' })), /portionen/);
  assert.match(grund(curry({ portionen: 0 })), /portionen/);
  assert.match(grund(curry({ portionsart: 'Teller' })), /portionsart/);
  assert.match(grund(curry({ zutaten: [] })), /mindestens eine Zutat/);
  assert.match(grund(curry({ zutaten: [{ name: '!!' }] })), /Zutat 1: name fehlt/);
  assert.match(grund(curry({ zutaten: [{ name: 'Salz', menge: '1 Prise' }] })), /Zutat 1: menge/);
  assert.match(grund(curry({ zutaten: [{ name: 'Salz', menge: -1 }] })), /Zutat 1: menge/);
  assert.match(grund(curry({ zutaten: [{ name: 'Salz', regel: 'quadratisch' }] })), /regel/);
  assert.match(grund(curry({ zutaten: [{ name: 'Salz', einheit: 'x'.repeat(21) }] })), /einheit/);
  assert.match(grund(curry({ zutaten: [{ name: 'Sternanis', art: 'stein' }] })), /art/);
  assert.match(grund(curry({ zutaten: [{ name: 'Salz', id: 'x' }] })), /unbekannte Felder id/);
  assert.match(grund(curry({ zutaten: [{ zutat: 'erfunden' }] })), /unbekannte Zutat/);
  assert.match(grund(curry({ zutaten: [{ name: 'Salz' }, { name: 'salz' }] })), /doppelt/);
  assert.match(grund(curry({ schritte: [] })), /mindestens ein Schritt/);
  assert.match(grund(curry({ schritte: ['a', ' ', 'b', 'c'] })), /Schritt 2 ist leer/);
  assert.match(grund(curry({ schritte: ['a', 'b', 'c', 'x'.repeat(501)] })), /Schritt 4 ist zu lang/);
  assert.match(grund(curry({ schritte: ['a', 'b', 'c', 4] })), /Schritt 4 ist leer/);
  assert.match(grund(curry({ schrittzutaten: undefined })), /schrittzutaten fehlt/);
  assert.equal(grund(curry({ schrittzutaten: undefined }), { pflicht: false }), 'OK');
  assert.match(grund(curry({ schrittzutaten: [[], []] })), /genau so viele/);
  assert.match(grund(curry({ schrittzutaten: [[{ name: 'Pfeffer' }], [], [], []] })), /Schritt 1: „Pfeffer“ steht nicht in den Zutaten/);
  assert.match(grund(curry({ schrittzutaten: [[{ name: 'Zwiebel' }, { name: 'zwiebel' }], [], [], []] })), /Schritt 1: „zwiebel“ steht doppelt/);
  assert.match(grund(curry({ schrittzutaten: [[{ name: 'Zwiebel', menge: 0 }], [], [], []] })), /Schritt 1: menge/);
  assert.match(grund(curry({ schrittzutaten: [[{ name: 'Zwiebel', zutat: 'x', extra: 1 }], [], [], []] })), /Schritt 1/);
  assert.match(grund(curry({ schrittzutaten: ['Zwiebel', [], [], []] })), /keine Liste/);
  assert.match(grund(curry({ schrittgeraete: ['Wok'] })), /schrittgeraete braucht genau so viele Einträge/);
  assert.match(grund(curry({ schrittgeraete: 'Wok' })), /schrittgeraete braucht genau so viele Einträge/);
  assert.match(grund(curry({ schrittgeraete: ['', 'x'.repeat(41), '', ''] })), /Schritt 2: Gerät ist kein kurzer Text/);
  assert.match(grund(curry({ schrittgeraete: ['', 5, '', ''] })), /Schritt 2: Gerät/);
  assert.match(grund(curry({ status: 'lecker' })), /status/);
  assert.match(grund(curry({ quelle: 'hand' })), /quelle/);
  assert.match(grund(curry({ notiz: 'x'.repeat(2001) })), /notiz/);
  assert.match(grund(curry({ notiz: 5 })), /notiz/);
  // Alle Gründe auf einmal (höchstens 15), damit Claude alles in einem Durchgang verbessert
  assert.equal(pruefeRezept({ name: '', portionen: 0, zutaten: 'x', schritte: 'y', status: 'z' }, k).fehler.length, 8);
  // Was hier abgewiesen wird und die App auch nicht annähme: nie gespeichert
  for (const roh of [curry({ portionen: 0 }), curry({ zutaten: [{ name: 'Salz', menge: -1 }] })]) {
    assert.equal(wieDieApp(roh, katalogJs.EINGEBAUT).rezept, null);
  }
});

test('Ernährungsform: beim Anlegen Pflicht, beim Aktualisieren freiwillig; „auch vegetarisch“ nur bei Fisch/Fleisch', () => {
  const k = katalogAus([]);
  const grund = (roh, opt) => pruefeRezept(roh, k, opt).fehler?.join(' ') ?? 'OK';
  assert.match(grund(curry({ ernaehrung: undefined })), /ernaehrung fehlt: vegan \| vegetarisch \| fisch \| fleisch/);
  assert.equal(grund(curry({ ernaehrung: undefined }), { pflicht: false }), 'OK');
  assert.equal(grund(curry({ ernaehrung: null }), { pflicht: false }), 'OK');
  assert.match(grund(curry({ ernaehrung: 'pescetarisch' })), /ernaehrung: vegan/);
  assert.match(grund(curry({ ernaehrung: 'vegan', auchVegetarisch: true })), /auchVegetarisch gibt es nur bei/);
  assert.match(grund(curry({ ernaehrung: undefined, auchVegetarisch: true }), { pflicht: false }), /auchVegetarisch gibt es nur bei/);
  assert.match(grund(curry({ ernaehrung: 'fisch', auchVegetarisch: 'ja' })), /true oder false/);
  assert.equal(grund(curry({ ernaehrung: 'fisch', auchVegetarisch: false })), 'OK');

  // Gleiche Form wie in der App: false fällt weg, true bleibt
  const appKatalog = katalogJs.EINGEBAUT;
  for (const roh of [curry({ ernaehrung: 'fleisch', auchVegetarisch: true }), curry({ ernaehrung: 'fisch', auchVegetarisch: false })]) {
    const ich = pruefeRezept(roh, k).rezept;
    assert.deepEqual(ich, wieDieApp(roh, appKatalog).rezept);
    assert.deepEqual(rezeptJs.bereinigeRezept(ich), ich);
  }
  assert.equal('auchVegetarisch' in pruefeRezept(curry({ ernaehrung: 'fisch', auchVegetarisch: false }), k).rezept, false);
  // Werkzeug-Beschreibung: beim Anlegen Pflichtfeld
  const anlegen = WERKZEUGE.find((w) => w.name === 'rezept_anlegen');
  assert.ok(anlegen.inputSchema.properties.rezepte.items.required.includes('ernaehrung'));
  assert.deepEqual(anlegen.inputSchema.properties.rezepte.items.properties.ernaehrung.enum, ERNAEHRUNG);
});

test('Ernährungsform per rezept_aktualisieren nachtragen; neue Form ohne Angabe verwirft „auch vegetarisch“', async () => {
  const db = nachgebauteDb();
  const id = '00000000-0000-4000-8000-0000000a1700';
  // altes Rezept ohne Ernährungsform (vor A gespeichert)
  const { rezept } = pruefeRezept(curry({ ernaehrung: undefined }), katalogAus([]), { pflicht: false });
  db.rezepte.set(id, { id, version: 1, daten: rezept });
  assert.equal((await rufe(db, 'rezepte_finden', { id })).daten.ernaehrung, null);

  const n = await rufe(db, 'rezept_aktualisieren', { id, version: 1, ernaehrung: 'fleisch', auchVegetarisch: true });
  assert.deepEqual([n.daten.gespeichert, n.daten.version], [true, 2]);
  assert.deepEqual(db.rezepte.get(id).daten, { ...rezept, ernaehrung: 'fleisch', auchVegetarisch: true });
  const gelesen = (await rufe(db, 'rezepte_finden', { id })).daten;
  assert.deepEqual([gelesen.ernaehrung, gelesen.auchVegetarisch], ['fleisch', true]);

  // Notiz ändern: Ernährungsform bleibt
  await rufe(db, 'rezept_aktualisieren', { id, version: 2, notiz: 'Hack separat braten.' });
  assert.equal(db.rezepte.get(id).daten.auchVegetarisch, true);

  // Auf vegetarisch umstellen ohne Angabe zu auchVegetarisch: die alte Angabe fällt weg statt eines Fehlers
  const v = await rufe(db, 'rezept_aktualisieren', { id, version: 3, ernaehrung: 'vegetarisch' });
  assert.equal(v.fehler, false, v.text);
  assert.equal(db.rezepte.get(id).daten.ernaehrung, 'vegetarisch');
  assert.equal('auchVegetarisch' in db.rezepte.get(id).daten, false);
  assert.match((await rufe(db, 'rezept_aktualisieren', { id, version: 4, auchVegetarisch: true })).text, /nur bei ernaehrung fisch oder fleisch/);
});

test('Gespeichertes Rezept → Form für Claude (Namen statt ids) → wieder gespeichert = gleich', () => {
  const katalog = katalogAus([{ id: 'wasser', name: 'Wasser' }, { id: 'zwiebel', name: 'Zwiebel' }, { id: 'salz', name: 'Salz' },
    { id: 'tempeh', name: 'Tempeh' }]);
  const { rezept } = pruefeRezept(curry(), katalog);
  const fuer = fuerClaude('id-1', 3, rezept, katalog);
  assert.deepEqual(fuer.zutaten[1], { name: 'Zwiebel', menge: 1, einheit: '', regel: 'ganz' });
  assert.deepEqual(fuer.schrittzutaten[2], [{ name: 'Tempeh' }, { name: 'Wasser', menge: 600 }]);
  const { id, version, ...zurueck } = fuer;
  assert.deepEqual([id, version], ['id-1', 3]);
  assert.deepEqual(pruefeRezept(zurueck, katalog).rezept, rezept);
  // Unbekannte id (Katalog noch nicht da): die id als Name; altes Rezept ohne Zutaten je Schritt
  const alt = fuerClaude('id-2', 1, { art: 'kochen', name: 'Alt', portionen: 2, zutaten: [{ zutat: 'geheim', menge: 1 }], schritte: ['a'] }, katalog);
  assert.deepEqual([alt.zutaten[0].name, alt.schrittzutaten, alt.quelle], ['geheim', null, 'hand']);
  assert.match(fuerClaude('id-3', 1, { art: 'backen', name: 'Brot' }, katalog).hinweis, /Back-Rezept/);
  assert.equal(alt.schrittgeraete, null);
  assert.deepEqual(fuerClaude('id-4', 1, { ...rezept, schrittgeraete: ['', 'Wok', '', ''] }, katalog).schrittgeraete, ['', 'Wok', '', '']);
});

test('Katalog: eingebaute gelten mit festem Namen, kaputte Einträge fallen weg', () => {
  const k = katalogAus([{ id: 'butter', name: 'Kräuterbutter' }, { id: 'a b', name: 'X' }, { id: 'ok', name: '!!' }, null, { id: 'ingwer', name: 'Scharfer Ingwer' }, { id: 'sternanis', name: 'Sternanis' }]);
  assert.equal(k.find((z) => z.id === 'butter').name, 'Butter');
  assert.equal(k.find((z) => z.id === 'ingwer').name, 'Ingwer'); // eingebaute behalten ihren Namen
  assert.deepEqual(k.slice(EINGEBAUT.length), [{ id: 'sternanis', name: 'Sternanis' }]);
  assert.equal(katalogAus(null).length, EINGEBAUT.length);
});

// ---------- MCP und Schlüssel ----------

function anfrage(koerper, { kopf = { authorization: `Bearer ${SCHLUESSEL}` }, pfad = '', methode = 'POST' } = {}) {
  return new Request(ADRESSE + pfad, {
    method: methode,
    headers: { 'content-type': 'application/json', ...kopf },
    body: methode === 'POST' ? (typeof koerper === 'string' ? koerper : JSON.stringify(koerper)) : undefined,
  });
}

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };

test('Nur mit Schlüssel als Bearer-Kopfzeile; ohne (langes) Secret ist alles zu', async () => {
  const opt = { schluessel: SCHLUESSEL, db: null };
  assert.equal((await bearbeite(anfrage(init), opt)).status, 200);
  for (const kopf of [{}, { authorization: 'Bearer falsch' }, { authorization: SCHLUESSEL }, { 'x-api-key': SCHLUESSEL },
    { authorization: `Basic ${SCHLUESSEL}` }, { authorization: `Bearer ${SCHLUESSEL}x` }]) {
    assert.equal((await bearbeite(anfrage(init, { kopf }), opt)).status, 401, JSON.stringify(Object.keys(kopf)));
  }
  assert.equal((await bearbeite(anfrage(init, { kopf: {}, pfad: `/${SCHLUESSEL}` }), opt)).status, 401);
  assert.equal((await bearbeite(anfrage(init), { schluessel: undefined, db: null })).status, 401);
  assert.equal((await bearbeite(anfrage(init, { kopf: { authorization: 'Bearer kurz' } }), { schluessel: 'kurz', db: null })).status, 401);
  // Kein Schlüssel, kein x-api-key-, kein Pfad-Weg im Code
  assert.doesNotMatch(quelltext, /x-api-key|pathname/);
});

test('MCP-Ablauf: initialize, Benachrichtigung, tools/list (genau vier Werkzeuge), ping, Fehler', async () => {
  const opt = { schluessel: SCHLUESSEL, db: null };
  const i = await (await bearbeite(anfrage(init), opt)).json();
  assert.equal(i.result.protocolVersion, '2025-06-18');
  assert.deepEqual(i.result.capabilities, { tools: {} });
  assert.equal(i.result.serverInfo.name, 'kochbuch');
  const alt = await (await bearbeite(anfrage({ ...init, params: { protocolVersion: '1999-01-01' } }), opt)).json();
  assert.equal(alt.result.protocolVersion, '2025-06-18');

  assert.equal((await bearbeite(anfrage({ jsonrpc: '2.0', method: 'notifications/initialized' }), opt)).status, 202);
  const l = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), opt)).json();
  assert.deepEqual(l.result.tools.map((w) => w.name), ['zutaten_liste', 'rezepte_finden', 'rezept_anlegen', 'rezept_aktualisieren']);
  assert.ok(l.result.tools.every((w) => w.inputSchema.type === 'object' && w.description));
  assert.deepEqual(WERKZEUGE.filter((w) => w.annotations.readOnlyHint).map((w) => w.name), ['zutaten_liste', 'rezepte_finden']);
  assert.ok(WERKZEUGE.every((w) => !/l(ö|oe)schen/i.test(w.name)));

  const p = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 4, method: 'ping' }), opt)).json();
  assert.deepEqual(p.result, {});
  const m = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 5, method: 'resources/list' }), opt)).json();
  assert.equal(m.error.code, -32601);
  for (const name of ['rezept_loeschen', 'toString', '__proto__', undefined]) {
    const w = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name } }), opt)).json();
    assert.equal(w.error.code, -32602, String(name));
  }
  const arg = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'zutaten_liste', arguments: [] } }), opt)).json();
  assert.equal(arg.error.code, -32602);
  assert.equal((await bearbeite(anfrage('{kaputt'), opt)).status, 400);
  assert.equal((await bearbeite(anfrage(null, { methode: 'GET' }), opt)).status, 405);
  assert.equal((await bearbeite(anfrage(JSON.stringify({ ...init, x: 'x'.repeat(1_000_001) })), opt)).status, 413);
  const u = await (await bearbeite(anfrage({ jsonrpc: '1.0', id: 8, method: 'ping' }), opt)).json();
  assert.equal(u.error.code, -32600);
  const stapel = await (await bearbeite(anfrage([init, { jsonrpc: '2.0', id: 9, method: 'ping' }]), opt)).json();
  assert.deepEqual(stapel.map((x) => x.id), [1, 9]);
});

// ---------- Werkzeuge mit nachgebauter Datenbank ----------

/** Nachbau von connector.* (vereinfacht: Version, Konfliktkopie, Zutaten nur neu). */
function nachgebauteDb() {
  const zutaten = new Map([['ingwer', { id: 'ingwer', name: 'Ingwer' }]]);
  const rezepte = new Map();
  let zaehler = 0;
  const aufrufe = [];
  const db = {
    aufrufe, rezepte, zutaten, kaputt: null,
    async zutatenListe() { aufrufe.push(['zutaten_liste']); if (db.kaputt) throw db.kaputt; return [...zutaten.values()]; },
    async rezepteFinden(suche) {
      aufrufe.push(['rezepte_finden', suche]);
      if (db.kaputt) throw db.kaputt;
      return [...rezepte.values()].filter((r) => !suche || r.id === suche || r.daten.name.toLowerCase().includes(suche.toLowerCase()))
        .map((r) => ({ id: r.id, name: r.daten.name, art: r.daten.art, kategorie: r.daten.kategorie ?? null, version: r.version }));
    },
    async rezeptLesen(id) { aufrufe.push(['rezept_lesen', id]); const r = rezepte.get(id); return r ? structuredClone(r) : null; },
    async rezeptSpeichern(eingabe) {
      aufrufe.push(['rezept_speichern', structuredClone(eingabe)]);
      for (const z of eingabe.zutaten) if (!zutaten.has(z.id)) zutaten.set(z.id, z);
      return {
        zutaten: [],
        rezepte: eingabe.rezepte.map((e) => {
          const id = e.id ?? `00000000-0000-4000-8000-${String(++zaehler).padStart(12, '0')}`;
          const alt = rezepte.get(id);
          if (alt && alt.version !== (e.basis ?? 0)) {
            const kopie = `00000000-0000-4000-8000-${String(++zaehler).padStart(12, '0')}`;
            rezepte.set(kopie, { id: kopie, version: 1, daten: { ...e.daten, name: `${e.daten.name} (Änderung vom 4.10.)` } });
            return { id, ok: false, kopie, version: 1 };
          }
          rezepte.set(id, { id, version: (alt?.version ?? 0) + 1, daten: e.daten });
          return { id, ok: true, version: (alt?.version ?? 0) + 1 };
        }),
      };
    },
  };
  return db;
}

let nr = 100;
async function rufe(db, name, args) {
  const a = await bearbeite(anfrage({ jsonrpc: '2.0', id: ++nr, method: 'tools/call', params: { name, arguments: args } }), { schluessel: SCHLUESSEL, db });
  const { result } = await a.json();
  return { fehler: result.isError === true, text: result.content[0].text, daten: result.isError ? null : JSON.parse(result.content[0].text) };
}

test('zutaten_liste: eingebaute und gespeicherte Namen, alphabetisch', async () => {
  const db = nachgebauteDb();
  const { daten } = await rufe(db, 'zutaten_liste', {});
  assert.ok(daten.zutaten.includes('Ingwer') && daten.zutaten.includes('Weizen 550') && daten.zutaten.includes('Kürbiskerne'));
  assert.deepEqual(daten.zutaten, [...daten.zutaten].sort((a, b) => a.localeCompare(b, 'de')));
});

test('rezept_anlegen: speichert geprüft, legt neue Zutaten an, kein zweites Rezept gleichen Namens', async () => {
  const db = nachgebauteDb();
  const r = await rufe(db, 'rezept_anlegen', { rezepte: [curry(), curry({ name: 'Kaputt', portionen: 0 }), curry({ name: 'linsencurry' })] });
  assert.equal(r.fehler, false);
  const [gut, kaputt, doppelt] = r.daten.rezepte;
  assert.deepEqual([gut.gespeichert, gut.version, gut.name], [true, 1, 'Linsencurry']);
  assert.match(kaputt.fehler.join(' '), /portionen/);
  assert.match(doppelt.fehler.join(' '), /doppelt/);
  assert.deepEqual(r.daten.neue_zutaten, ['Tempeh']);
  // An die Datenbank geht genau ein Speichern mit den geprüften Daten
  const speichern = db.aufrufe.filter((a) => a[0] === 'rezept_speichern');
  assert.equal(speichern.length, 1);
  assert.deepEqual(speichern[0][1].zutaten.map((z) => z.id), ['tempeh']);
  assert.deepEqual(speichern[0][1].rezepte, [{ daten: pruefeRezept(curry(), katalogAus([{ id: 'ingwer', name: 'Ingwer' }])).rezept }]);

  // Wiederholung (z. B. nach Netzfehler): kein Doppel, Hinweis mit id und version
  const nochmal = await rufe(db, 'rezept_anlegen', { rezepte: [curry({ name: ' LINSENCURRY ' })] });
  assert.match(nochmal.daten.rezepte[0].fehler[0], new RegExp(`Gibt es schon \\(id ${gut.id}, version 1\\)`));
  assert.equal(db.aufrufe.filter((a) => a[0] === 'rezept_speichern').length, 1);
  assert.equal(nochmal.daten.neue_zutaten, undefined);

  // Neue Zutat nur einmal, auch wenn zwei Rezepte sie brauchen; abgewiesene Rezepte legen keine Zutaten an
  const zwei = await rufe(db, 'rezept_anlegen', { rezepte: [
    curry({ name: 'A', zutaten: [{ name: 'Sternanis', art: 'gewuerz' }], schritte: ['a'], schrittzutaten: [[]] }),
    curry({ name: 'B', zutaten: [{ name: 'sternanis' }], schritte: ['b'], schrittzutaten: [[{ name: 'Sternanis' }]] }),
    curry({ name: 'C', zutaten: [{ name: 'Safran' }], schritte: ['c'], schrittzutaten: [[]], status: 'x' }),
  ] });
  assert.deepEqual(zwei.daten.neue_zutaten, ['Sternanis']);
  assert.equal(db.zutaten.has('safran'), false);
  assert.deepEqual(db.zutaten.get('sternanis'), { id: 'sternanis', name: 'Sternanis', art: 'gewuerz' });
});

test('rezept_anlegen: falsche Form, zu viele, nicht erreichbar', async () => {
  const db = nachgebauteDb();
  assert.match((await rufe(db, 'rezept_anlegen', {})).text, /rezepte fehlt/);
  assert.match((await rufe(db, 'rezept_anlegen', { rezepte: Array(51).fill(curry()) })).text, /Höchstens 50/);
  db.kaputt = new Error('connect ECONNREFUSED');
  const weg = await rufe(db, 'rezept_anlegen', { rezepte: [curry()] });
  assert.equal(weg.fehler, true);
  assert.match(weg.text, /nicht erreichbar/);
  db.kaputt = new Error('Kein Haushalt für den Connector freigegeben');
  assert.match((await rufe(db, 'zutaten_liste', {})).text, /kein Haushalt/);
  const ohne = await rufe(null, 'zutaten_liste', {});
  assert.match(ohne.text, /nicht fertig eingerichtet/);
});

test('rezepte_finden: Liste nach Name, ein Rezept per id mit Namen und Version', async () => {
  const db = nachgebauteDb();
  const { id } = (await rufe(db, 'rezept_anlegen', { rezepte: [curry()] })).daten.rezepte[0];
  const liste = await rufe(db, 'rezepte_finden', { suche: 'curry' });
  assert.deepEqual(liste.daten.rezepte.map((r) => [r.id, r.name, r.version]), [[id, 'Linsencurry', 1]]);
  assert.equal((await rufe(db, 'rezepte_finden', {})).daten.rezepte.length, 1);
  const eins = await rufe(db, 'rezepte_finden', { id: id.toUpperCase() });
  assert.equal(eins.daten.version, 1);
  assert.deepEqual(eins.daten.schrittzutaten[3], [{ name: 'Wasser', menge: 200 }, { name: 'Salz' }]);
  assert.equal(eins.daten.status, 'erprobt');
  assert.match((await rufe(db, 'rezepte_finden', { id: 'abc' })).text, /keine gültige/);
  assert.match((await rufe(db, 'rezepte_finden', { id: '00000000-0000-4000-8000-999999999999' })).text, /Kein Rezept/);
  assert.match((await rufe(db, 'rezepte_finden', { suche: 5 })).text, /Text/);
});

test('Gerät je Schritt: anlegen, ändern, ohne Geräte ändern; Schritte nur mit neuen Geräten', async () => {
  const db = nachgebauteDb();
  const geraete = ['', 'Beschichtete Pfanne', 'Topf', 'Topf'];
  const { id } = (await rufe(db, 'rezept_anlegen', { rezepte: [curry({ schrittgeraete: geraete })] })).daten.rezepte[0];
  assert.deepEqual(db.rezepte.get(id).daten.schrittgeraete, geraete);
  assert.deepEqual((await rufe(db, 'rezepte_finden', { id })).daten.schrittgeraete, geraete);

  // Nur das Gerät ändern
  const n = await rufe(db, 'rezept_aktualisieren', { id, version: 1, schrittgeraete: ['', 'Wok', 'Topf', 'Topf'] });
  assert.deepEqual([n.daten.gespeichert, n.daten.version], [true, 2]);
  assert.equal(db.rezepte.get(id).daten.schrittgeraete[1], 'Wok');
  // Schritte ändern, Geräte vergessen → abgewiesen (sie würden verrutschen)
  const ohne = await rufe(db, 'rezept_aktualisieren', { id, version: 2, schritte: ['a', 'b'], schrittzutaten: [[], []] });
  assert.equal(ohne.fehler, true);
  assert.match(ohne.text, /schrittgeraete neu mitliefern/);
  // Falsche Länge → abgewiesen
  assert.match((await rufe(db, 'rezept_aktualisieren', { id, version: 2, schrittgeraete: ['Wok'] })).text, /so viele Einträge/);
  // Mit neuen Geräten klappt es; alle leer = Feld fehlt
  const ok = await rufe(db, 'rezept_aktualisieren', { id, version: 2, schritte: ['a', 'b'], schrittzutaten: [[], []], schrittgeraete: ['', ''] });
  assert.equal(ok.daten.version, 3);
  assert.equal(db.rezepte.get(id).daten.schrittgeraete, undefined);

  // Rezept ohne Geräte: Schritte ändern geht auch ohne schrittgeraete
  const { id: id2 } = (await rufe(db, 'rezept_anlegen', { rezepte: [curry({ name: 'Ohne Geräte' })] })).daten.rezepte[0];
  const frei = await rufe(db, 'rezept_aktualisieren', { id: id2, version: 1, schritte: ['a'], schrittzutaten: [[]] });
  assert.equal(frei.daten.version, 2);
  assert.equal(db.rezepte.get(id2).daten.schrittgeraete, undefined);
});

test('rezept_aktualisieren: nur angegebene Felder, mit Version; sonst Kopie, nie überschreiben', async () => {
  const db = nachgebauteDb();
  const { id } = (await rufe(db, 'rezept_anlegen', { rezepte: [curry({ notiz: 'Alte Notiz' })] })).daten.rezepte[0];
  const vorher = db.rezepte.get(id).daten;

  const n = await rufe(db, 'rezept_aktualisieren', { id, version: 1, notiz: 'Weniger Salz.' });
  assert.deepEqual([n.daten.gespeichert, n.daten.version], [true, 2]);
  assert.deepEqual(db.rezepte.get(id).daten, { ...vorher, notiz: 'Weniger Salz.' });

  // Schritte ändern ohne schrittzutaten → abgewiesen
  assert.match((await rufe(db, 'rezept_aktualisieren', { id, version: 2, schritte: ['Alles kochen.'] })).text, /schrittzutaten neu/);
  const s = await rufe(db, 'rezept_aktualisieren', {
    id, version: 2, schritte: ['Alles kochen.'], schrittzutaten: [[{ name: 'Tempeh' }, { name: 'Ingwer' }]],
  });
  assert.equal(s.fehler, true);
  assert.match(s.text, /„Ingwer“ steht nicht in den Zutaten/);
  const z = await rufe(db, 'rezept_aktualisieren', {
    id, version: 2, zutaten: [{ name: 'Tempeh', menge: 250, einheit: 'g' }, { name: 'Ingwer', menge: 1, einheit: 'TL' }, { name: 'Kardamom' }],
    schritte: ['Alles kochen.'], schrittzutaten: [[{ name: 'Tempeh' }, { name: 'Ingwer' }]],
  });
  assert.deepEqual([z.daten.version, z.daten.neue_zutaten], [3, ['Kardamom']]);
  assert.equal(db.rezepte.get(id).daten.notiz, 'Weniger Salz.');

  // Veraltete Version: Original bleibt, Änderung wird Kopie
  const k = await rufe(db, 'rezept_aktualisieren', { id, version: 2, name: 'Linsencurry mild' });
  assert.equal(k.daten.gespeichert, false);
  assert.ok(k.daten.kopie);
  assert.match(k.daten.hinweis, /Kopie/);
  assert.equal(db.rezepte.get(id).daten.name, 'Linsencurry');

  // Falsche Angaben
  assert.match((await rufe(db, 'rezept_aktualisieren', { id, version: 0, notiz: 'x' })).text, /version fehlt/);
  assert.match((await rufe(db, 'rezept_aktualisieren', { id: 'x', version: 1, notiz: 'x' })).text, /id/);
  assert.match((await rufe(db, 'rezept_aktualisieren', { id, version: 3 })).text, /Keine Änderung/);
  assert.match((await rufe(db, 'rezept_aktualisieren', { id, version: 3, geloescht: true })).text, /Unbekannte Felder: geloescht/);
  assert.match((await rufe(db, 'rezept_aktualisieren', { id, version: 3, quelle: 'hand' })).text, /quelle/);
  assert.match((await rufe(db, 'rezept_aktualisieren', { id: '00000000-0000-4000-8000-999999999999', version: 1, notiz: 'x' })).text, /Kein Rezept/);
  db.rezepte.set('00000000-0000-4000-8000-00000000b0b0', { id: '00000000-0000-4000-8000-00000000b0b0', version: 1, daten: { art: 'backen', name: 'Brot' } });
  assert.match((await rufe(db, 'rezept_aktualisieren', { id: '00000000-0000-4000-8000-00000000b0b0', version: 1, notiz: 'x' })).text, /Back-Rezepte/);
});

test('rezept_aktualisieren: Rezept vom Handy (quelle hand, ohne Zutaten je Schritt) bleibt bearbeitbar', async () => {
  const db = nachgebauteDb();
  const id = '00000000-0000-4000-8000-0000000000aa';
  db.rezepte.set(id, { id, version: 4, daten: {
    art: 'kochen', name: 'Suppe', kategorie: 'suppen', portionen: 2, portionsart: 'personen',
    zutaten: [{ zutat: 'nichtimkatalog', menge: 1, einheit: '', regel: 'linear' }], schritte: ['Kochen.'],
    status: 'erprobt', notiz: '', quelle: 'hand',
  } });
  const r = await rufe(db, 'rezept_aktualisieren', { id, version: 4, status: 'testen' });
  assert.equal(r.daten.version, 5);
  const d = db.rezepte.get(id).daten;
  assert.deepEqual([d.status, d.quelle, d.zutaten[0].zutat, d.schrittzutaten], ['testen', 'claude', 'nichtimkatalog', undefined]);
  assert.deepEqual(rezeptJs.bereinigeRezept(d), d);
});

test('datenbankMit: genau die vier Connector-Funktionen, Werte als Parameter', async () => {
  const gesehen = [];
  const sql = (teile, ...werte) => {
    gesehen.push([teile.join('$'), werte]);
    return Promise.resolve([{ e: teile[0].includes('lesen') ? null : '[]' }]);
  };
  sql.json = (x) => ({ alsJson: x });
  const db = datenbankMit(sql);
  assert.deepEqual(await db.zutatenListe(), []);
  await db.rezepteFinden("x'; drop table y; --");
  assert.equal(await db.rezeptLesen('id'), null);
  await db.rezeptSpeichern({ rezepte: [] });
  assert.deepEqual(gesehen, [
    ['select connector.zutaten_liste() as e', []],
    ['select connector.rezepte_finden($::text) as e', ["x'; drop table y; --"]],
    ['select connector.rezept_lesen($::text) as e', ['id']],
    ['select connector.rezept_speichern($::jsonb) as e', [{ alsJson: { rezepte: [] } }]],
  ]);
});

test('Keine Geheimnisse im Code: Schlüssel und Datenbank-Adresse nur als Secret', () => {
  assert.match(quelltext, /Deno\.env\.get\('KOCHBUCH_SCHLUESSEL'\)/);
  assert.match(quelltext, /Deno\.env\.get\('KOCHBUCH_DB_URL'\)/);
  assert.doesNotMatch(quelltext, /postgres(ql)?:\/\/|supabase\.co|service_role|SUPABASE_DB_URL/);
});
