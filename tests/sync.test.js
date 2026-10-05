// Tests für den Abgleich (kern/sync.js) gegen einen nachgebauten Server.
//
// Der nachgebaute Server verhält sich wie hochladen/herunterladen in datenbank/schema.sql
// (Versionen, „alles seit stand“, Seiten, Prüfungen) – samt Eigenheit von PostgreSQL (jsonb),
// die Felder eines Objekts umzusortieren. Zwei Handys = zwei Speicher am selben Server.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { erstelleSync, kopieName } from '../js/kern/sync.js';
import { speichereRezept, alleRezepte } from '../js/rezepte/rezept.js';

/** Wie jsonb: Felder nach Länge, dann alphabetisch sortiert. */
function wieJsonb(x) {
  if (Array.isArray(x)) return x.map(wieJsonb);
  if (!x || typeof x !== 'object') return x;
  const keys = Object.keys(x).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((k) => [k, wieJsonb(x[k])]));
}

function nachgebauterServer() {
  const zeilen = new Map(); // "sammlung/id" → { sammlung, id, daten, geloescht, version, stand }
  let stand = 0;
  const s = {
    zeilen,
    netz: true,          // false = kein Netz
    seitenGroesse: 500,
    aufrufe: { hochladen: 0, herunterladen: 0 },
    waehrend: null,      // wird während eines Aufrufs ausgeführt (z. B. Änderung auf dem Handy)

    async hochladen(aenderungen) {
      s.aufrufe.hochladen++;
      await pause(s);
      if (aenderungen.length > 200) throw new Error('zu viele');
      return structuredClone(aenderungen).map((e) => {
        const gueltig = /^[a-z][a-z0-9_]{0,39}$/.test(e.sammlung) && typeof e.id === 'string' && e.id
          && e.daten && typeof e.daten === 'object' && typeof e.geloescht === 'boolean'
          && Number.isInteger(e.basis) && e.basis >= 0 && JSON.stringify(e.daten).length <= 100000;
        if (!gueltig) return { sammlung: e.sammlung, id: e.id, ok: false, fehler: 'ungueltig' };
        const alt = zeilen.get(`${e.sammlung}/${e.id}`);
        if ((alt?.version ?? 0) !== e.basis) {
          return { sammlung: e.sammlung, id: e.id, ok: false, version: alt?.version ?? 0,
            daten: alt ? structuredClone(alt.daten) : null, geloescht: alt?.geloescht ?? null };
        }
        zeilen.set(`${e.sammlung}/${e.id}`, { sammlung: e.sammlung, id: e.id, daten: wieJsonb(e.daten),
          geloescht: e.geloescht, version: e.basis + 1, stand: ++stand });
        return { sammlung: e.sammlung, id: e.id, ok: true, version: e.basis + 1 };
      });
    },

    async herunterladen(seit) {
      s.aufrufe.herunterladen++;
      await pause(s);
      const liste = [...zeilen.values()].filter((z) => z.stand > seit).sort((a, b) => a.stand - b.stand)
        .slice(0, s.seitenGroesse);
      return {
        datensaetze: structuredClone(liste),
        stand: liste.length ? liste.at(-1).stand : seit,
        mehr: liste.length === s.seitenGroesse,
      };
    },

    /** Server-Fassung eines Datensatzes (wie im Dashboard). */
    zeile: (sammlung, id) => zeilen.get(`${sammlung}/${id}`),
  };
  return s;
}

async function pause(server) {
  await null; // wie eine echte Netz-Anfrage: erst später fertig
  if (server.waehrend) {
    const fn = server.waehrend;
    server.waehrend = null;
    fn();
  }
  if (!server.netz) throw new TypeError('Failed to fetch');
}

function testUhr() {
  let zeit = 1_000_000;
  return () => (zeit += 1000);
}

function handy(server) {
  const speicher = erstelleSpeicher(speicherImArbeitsspeicher(), testUhr());
  return { speicher, sync: erstelleSync({ speicher, server, jetzt: () => 42 }) };
}

/** Zwei Handys am selben Server. */
function haushalt() {
  const server = nachgebauterServer();
  return { server, a: handy(server), b: handy(server) };
}

const teig = (wasser) => ({ format: 2, wasser, salz: 2 });
const vorlagen = (h) => h.speicher.alle('teigvorlagen');

test('Neue Vorlage kommt auf das andere Handy, danach ist nichts mehr offen', async () => {
  const { a, b } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'Pizza', teig: teig(65), mehl: 500 });

  const ergebnisA = await a.sync.abgleichen();
  assert.equal(ergebnisA.ok, true);
  assert.equal(ergebnisA.hochgeladen, 1);
  assert.equal(ergebnisA.offen, 0);

  const ergebnisB = await b.sync.abgleichen();
  assert.equal(ergebnisB.heruntergeladen, 1);
  assert.deepEqual(b.speicher.hole('teigvorlagen', v.id), v);
  assert.deepEqual(b.speicher.offene('teigvorlagen'), []);
});

test('Änderung und Löschen gehen hin und zurück', async () => {
  const { a, b } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: teig(70), mehl: 500 });
  await a.sync.abgleichen();
  await b.sync.abgleichen();

  b.speicher.speichere('teigvorlagen', { ...b.speicher.hole('teigvorlagen', v.id), mehl: 1000 });
  await b.sync.abgleichen();
  await a.sync.abgleichen();
  assert.equal(a.speicher.hole('teigvorlagen', v.id).mehl, 1000);

  a.speicher.loesche('teigvorlagen', v.id);
  await a.sync.abgleichen();
  await b.sync.abgleichen();
  assert.equal(b.speicher.hole('teigvorlagen', v.id), null);
  assert.equal(a.speicher.offene('teigvorlagen').length + b.speicher.offene('teigvorlagen').length, 0);
});

test('Eigener Upload kommt beim Herunterladen nicht doppelt an', async () => {
  const { a } = haushalt();
  a.speicher.speichere('teigvorlagen', { name: 'X', teig: teig(60), mehl: 300 });
  const ergebnis = await a.sync.abgleichen();
  assert.equal(ergebnis.heruntergeladen, 0);
  assert.equal(vorlagen(a).length, 1);
});

test('Gleichzeitig geänderte Vorlage: Server-Fassung bleibt, eigene wird Kopie mit Vermerk', async () => {
  const { a, b, server } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: teig(70), mehl: 500 });
  await a.sync.abgleichen();
  await b.sync.abgleichen();

  a.speicher.speichere('teigvorlagen', { ...a.speicher.hole('teigvorlagen', v.id), teig: teig(72) });
  const eigen = b.speicher.speichere('teigvorlagen', { ...b.speicher.hole('teigvorlagen', v.id), teig: teig(75) });
  await a.sync.abgleichen(); // A war zuerst
  const ergebnis = await b.sync.abgleichen();
  assert.equal(ergebnis.kopien, 1);
  assert.equal(ergebnis.offen, 0);

  const aufB = vorlagen(b);
  assert.equal(aufB.length, 2);
  assert.equal(b.speicher.hole('teigvorlagen', v.id).teig.wasser, 72, 'Server-Fassung (von A) bleibt');
  const kopie = aufB.find((x) => x.id !== v.id);
  assert.equal(kopie.teig.wasser, 75);
  assert.equal(kopie.name, kopieName('Brot', eigen.geaendert), 'Name mit Datum der eigenen Änderung');
  assert.equal(vorlagen(b).filter((x) => x.name === 'Brot').length, 1, 'keine zwei gleichnamigen');
  assert.deepEqual(kopie.konflikt, { von: v.id, am: 42 });
  assert.ok(server.zeile('teigvorlagen', kopie.id), 'Kopie ist auch auf dem Server');

  await a.sync.abgleichen();
  assert.deepEqual(vorlagen(a).map((x) => x.teig.wasser).sort(), [72, 75]);
});

test('Inhaltlich gleiche Änderung auf beiden Handys: kein Konflikt, keine Kopie', async () => {
  const { a, b } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: teig(70), mehl: 500 });
  await a.sync.abgleichen();
  await b.sync.abgleichen();

  a.speicher.speichere('teigvorlagen', { ...a.speicher.hole('teigvorlagen', v.id), name: 'Landbrot' });
  b.speicher.speichere('teigvorlagen', { ...b.speicher.hole('teigvorlagen', v.id), name: 'Landbrot' });
  await a.sync.abgleichen();
  const ergebnis = await b.sync.abgleichen();
  assert.equal(ergebnis.kopien, 0);
  assert.equal(ergebnis.offen, 0);
  assert.equal(vorlagen(b).length, 1);
});

test('Gleich auch dann, wenn die Datenbank die Felder umsortiert hat', async () => {
  const { a, b } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: { salz: 2, wasser: 70, format: 2 }, mehl: 500 });
  await a.sync.abgleichen();
  // B hat denselben Inhalt (über einen Link) als offene Änderung auf Basis 0
  b.speicher.uebernimm('teigvorlagen', { ...v, geaendert: v.geaendert + 5 });
  const ergebnis = await b.sync.abgleichen();
  assert.equal(ergebnis.kopien, 0);
  assert.equal(vorlagen(b).length, 1);
});

test('Löschen gegen Ändern: Ändern gewinnt – egal wer zuerst hochlädt', async () => {
  for (const loeschtZuerst of [true, false]) {
    const { a, b } = haushalt();
    const v = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: teig(70), mehl: 500 });
    await a.sync.abgleichen();
    await b.sync.abgleichen();

    a.speicher.loesche('teigvorlagen', v.id);
    b.speicher.speichere('teigvorlagen', { ...b.speicher.hole('teigvorlagen', v.id), mehl: 800 });
    const [erst, dann] = loeschtZuerst ? [a, b] : [b, a];
    await erst.sync.abgleichen();
    await dann.sync.abgleichen();
    await erst.sync.abgleichen();

    for (const h of [a, b]) {
      assert.equal(h.speicher.hole('teigvorlagen', v.id)?.mehl, 800, `loeschtZuerst=${loeschtZuerst}`);
      assert.equal(vorlagen(h).length, 1, 'keine Kopie');
      assert.deepEqual(h.speicher.offene('teigvorlagen'), []);
    }
  }
});

test('Beide gelöscht: kein Konflikt', async () => {
  const { a, b } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: teig(70), mehl: 500 });
  await a.sync.abgleichen();
  await b.sync.abgleichen();
  a.speicher.loesche('teigvorlagen', v.id);
  b.speicher.loesche('teigvorlagen', v.id);
  await a.sync.abgleichen();
  const ergebnis = await b.sync.abgleichen();
  assert.equal(ergebnis.offen, 0);
  assert.deepEqual(vorlagen(b), []);
});

test('Wasserwert eines Mehls: zuletzt hochgeladen gewinnt, keine Kopie', async () => {
  const { a, b, server } = haushalt();
  a.speicher.speichere('mehle', { id: 'weizen550', wasser: 66 });
  await a.sync.abgleichen();
  await b.sync.abgleichen();

  a.speicher.speichere('mehle', { ...a.speicher.hole('mehle', 'weizen550'), wasser: 67 });
  b.speicher.speichere('mehle', { ...b.speicher.hole('mehle', 'weizen550'), wasser: 68 });
  await a.sync.abgleichen();
  const ergebnis = await b.sync.abgleichen(); // B lädt zuletzt hoch
  assert.equal(ergebnis.kopien, 0);
  assert.equal(server.zeile('mehle', 'weizen550').daten.wasser, 68);

  await a.sync.abgleichen();
  for (const h of [a, b]) {
    assert.equal(h.speicher.alle('mehle').length, 1);
    assert.equal(h.speicher.hole('mehle', 'weizen550').wasser, 68);
  }
});

test('Mehl zurückgesetzt gegen geändert: Ändern gewinnt', async () => {
  const { a, b } = haushalt();
  a.speicher.speichere('mehle', { id: 'tipo00', wasser: 62 });
  await a.sync.abgleichen();
  await b.sync.abgleichen();
  b.speicher.speichere('mehle', { ...b.speicher.hole('mehle', 'tipo00'), wasser: 63 });
  a.speicher.loesche('mehle', 'tipo00');
  await b.sync.abgleichen();
  await a.sync.abgleichen();
  assert.equal(a.speicher.hole('mehle', 'tipo00').wasser, 63);
});

test('Kein Netz: Ergebnis meldet den Fehler, nichts geht verloren, später klappt es', async () => {
  const { a, b, server } = haushalt();
  server.netz = false;
  a.speicher.speichere('teigvorlagen', { name: 'Offline', teig: teig(65), mehl: 500 });
  const ergebnis = await a.sync.abgleichen();
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.fehler, /fetch/);
  assert.equal(ergebnis.offen, 1);
  assert.equal(vorlagen(a).length, 1);

  server.netz = true;
  assert.equal((await a.sync.abgleichen()).ok, true);
  await b.sync.abgleichen();
  assert.equal(vorlagen(b)[0].name, 'Offline');
});

test('Netz bricht beim Herunterladen ab: Stand bleibt, nächstes Mal kommt alles', async () => {
  const { a, b, server } = haushalt();
  a.speicher.speichere('teigvorlagen', { name: 'A', teig: teig(65), mehl: 500 });
  await a.sync.abgleichen();
  server.waehrend = () => { server.netz = false; };
  assert.equal((await b.sync.abgleichen()).ok, false);
  assert.equal(b.speicher.syncStand(), 0);
  server.netz = true;
  await b.sync.abgleichen();
  assert.equal(vorlagen(b).length, 1);
  assert.ok(b.speicher.syncStand() > 0);
});

test('Antwort verloren nach dem Speichern auf dem Server: zweiter Versuch ohne Kopie', async () => {
  const { a, server } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'A', teig: teig(65), mehl: 500 });
  const echt = server.hochladen;
  server.hochladen = async (x) => { await echt(x); throw new Error('Verbindung abgebrochen'); };
  assert.equal((await a.sync.abgleichen()).ok, false);
  server.hochladen = echt;

  // Server hat Version 1, das Handy beruht noch auf 0 → Konflikt mit gleichem Inhalt
  const ergebnis = await a.sync.abgleichen();
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.kopien, 0);
  assert.equal(ergebnis.offen, 0);
  assert.equal(vorlagen(a).length, 1);
  assert.equal(server.zeile('teigvorlagen', v.id).version, 1);
});

test('Änderung während des Hochladens bleibt nicht liegen', async () => {
  const { a, b, server } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'A', teig: teig(65), mehl: 500 });
  server.waehrend = () => a.speicher.speichere('teigvorlagen', { ...a.speicher.hole('teigvorlagen', v.id), name: 'A2' });
  const ergebnis = await a.sync.abgleichen();
  assert.equal(ergebnis.offen, 0);
  assert.equal(server.zeile('teigvorlagen', v.id).daten.name, 'A2');
  assert.equal(server.zeile('teigvorlagen', v.id).version, 2);
  await b.sync.abgleichen();
  assert.equal(vorlagen(b)[0].name, 'A2');
});

test('Läuft schon ein Abgleich, startet kein zweiter gleichzeitig – aber danach noch einer', async () => {
  const { a, server } = haushalt();
  a.speicher.speichere('teigvorlagen', { name: 'A', teig: teig(65), mehl: 500 });
  const erster = a.sync.abgleichen();
  a.speicher.speichere('teigvorlagen', { name: 'B', teig: teig(65), mehl: 500 });
  const zweiter = a.sync.abgleichen();
  assert.equal(erster, zweiter);
  const ergebnis = await zweiter;
  assert.equal(ergebnis.offen, 0);
  assert.equal(server.zeilen.size, 2);
});

test('Mehr als 200 Änderungen: Hochladen in Teilen, Herunterladen seitenweise', async () => {
  const { a, b, server } = haushalt();
  for (let i = 0; i < 450; i++) a.speicher.speichere('teigvorlagen', { name: `V${i}`, teig: teig(65), mehl: i + 1 });
  const ergebnisA = await a.sync.abgleichen();
  assert.equal(ergebnisA.hochgeladen, 450);
  assert.equal(server.aufrufe.hochladen, 3);

  server.seitenGroesse = 100;
  const ergebnisB = await b.sync.abgleichen();
  assert.equal(ergebnisB.heruntergeladen, 450);
  assert.equal(vorlagen(b).length, 450);
});

test('Unbekannte Sammlungen vom Server werden gespeichert (für spätere App-Versionen)', async () => {
  const { a, server } = haushalt();
  server.zeilen.set('rezepte/r1', { sammlung: 'rezepte', id: 'r1', daten: { name: 'Suppe' }, geloescht: false, version: 1, stand: 1 });
  await a.sync.abgleichen();
  assert.equal(a.speicher.hole('rezepte', 'r1').name, 'Suppe');
  assert.equal(a.speicher.syncStand(), 1);
});

test('Kaputte Einträge vom Server werden übersprungen, der Rest kommt an', async () => {
  const speicher = erstelleSpeicher(speicherImArbeitsspeicher());
  const sync = erstelleSync({
    speicher,
    server: {
      hochladen: async () => [],
      herunterladen: async () => ({
        datensaetze: [
          null,
          { sammlung: '../x', id: 'a', daten: {}, geloescht: false, version: 1 },
          { sammlung: 'teigvorlagen', id: 'b', daten: null, geloescht: false, version: 2 },
          { sammlung: 'teigvorlagen', id: 'c', daten: { name: 'Gut' }, geloescht: false, version: 1 },
        ],
        stand: 4,
        mehr: false,
      }),
    },
  });
  const ergebnis = await sync.abgleichen();
  assert.equal(ergebnis.ok, true);
  assert.deepEqual(speicher.alle('teigvorlagen').map((v) => v.name), ['Gut']);
  assert.equal(speicher.syncStand(), 4);
});

test('Unbrauchbare Server-Antworten: nichts wird als hochgeladen markiert', async () => {
  for (const antwort of [null, {}, [null], [{ sammlung: 'teigvorlagen', id: 'falsch', ok: true, version: 1 }]]) {
    const speicher = erstelleSpeicher(speicherImArbeitsspeicher());
    speicher.speichere('teigvorlagen', { name: 'A' });
    const sync = erstelleSync({
      speicher,
      server: { hochladen: async () => antwort, herunterladen: async () => ({ datensaetze: [], stand: 0, mehr: false }) },
    });
    const ergebnis = await sync.abgleichen();
    assert.equal(ergebnis.offen, 1, JSON.stringify(antwort));
  }
});

test('Vom Server abgewiesener Eintrag bleibt offen, blockiert aber den Rest nicht', async () => {
  const { a, server } = haushalt();
  a.speicher.speichere('teigvorlagen', { name: 'Riesig', teig: teig(65), notiz: 'x'.repeat(100_001) });
  a.speicher.speichere('teigvorlagen', { name: 'Normal', teig: teig(65), mehl: 500 });
  const ergebnis = await a.sync.abgleichen();
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.abgewiesen, 1);
  assert.equal(ergebnis.offen, 1);
  assert.equal(server.zeilen.size, 1);
  assert.equal(server.aufrufe.hochladen, 1, 'nicht in jeder Runde erneut gesendet');
});

test('Abgebrochen nach dem Anlegen der Kopie: beim nächsten Mal keine zweite Kopie', async () => {
  const { a, b } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: teig(70), mehl: 500 });
  await a.sync.abgleichen();
  await b.sync.abgleichen();
  a.speicher.speichere('teigvorlagen', { ...a.speicher.hole('teigvorlagen', v.id), mehl: 600 });
  await a.sync.abgleichen();

  // B legt die Kopie an, „stirbt“ aber vor dem Übernehmen der Server-Fassung
  const eigen = { ...b.speicher.hole('teigvorlagen', v.id), mehl: 700 };
  b.speicher.speichere('teigvorlagen', eigen);
  const { id, erstellt, geaendert, geloescht, ...inhalt } = b.speicher.hole('teigvorlagen', v.id);
  b.speicher.speichere('teigvorlagen', { ...inhalt, name: kopieName(inhalt.name, geaendert), konflikt: { von: id, am: 1 } });

  const ergebnis = await b.sync.abgleichen();
  assert.equal(ergebnis.kopien, 0);
  assert.equal(ergebnis.offen, 0);
  assert.deepEqual(vorlagen(b).map((x) => x.mehl).sort(), [600, 700]);
});

test('Server hat den Datensatz nicht mehr: eigener Stand wird neu hochgeladen', async () => {
  const { a, server } = haushalt();
  const v = a.speicher.speichere('teigvorlagen', { name: 'A', teig: teig(65), mehl: 500 });
  await a.sync.abgleichen();
  server.zeilen.clear(); // z. B. im Dashboard gelöscht
  a.speicher.speichere('teigvorlagen', { ...a.speicher.hole('teigvorlagen', v.id), mehl: 900 });
  const ergebnis = await a.sync.abgleichen();
  assert.equal(ergebnis.offen, 0);
  assert.equal(server.zeile('teigvorlagen', v.id).daten.mehl, 900);
});

test('Name der Konflikt-Kopie: Datum der Änderung, kein doppelter Zusatz, nicht zu lang', () => {
  const zeit = new Date(2026, 9, 3, 18, 30).getTime(); // 3. Oktober, Ortszeit
  assert.equal(kopieName('Brot', zeit), 'Brot (Änderung vom 3.10.)');
  assert.equal(kopieName('Brot (Änderung vom 1.9.)', zeit), 'Brot (Änderung vom 3.10.)');
  const lang = kopieName('x'.repeat(80), zeit);
  assert.equal(lang.length, 80);
  assert.ok(lang.endsWith(' (Änderung vom 3.10.)'));
});

// ---------- Etappe 3: Rezepte und Zutaten ----------

test('Rezepte: gleichzeitige Änderung wird Kopie; dieselbe neue Zutat auf beiden Handys ist kein Konflikt', async () => {
  const { a, b } = haushalt();
  const neu = (h, notiz) => speichereRezept(h.speicher, {
    art: 'kochen', name: 'Curry', portionen: 4, notiz, zutaten: [{ name: 'Kokosmilch', menge: 400, einheit: 'ml' }],
  });
  const r = neu(a, '');
  await a.sync.abgleichen();
  await b.sync.abgleichen();

  // beide Handys legen „Kokosmilch“ nicht an (gibt es schon durch a) – und ändern gleichzeitig die Notiz
  speichereRezept(a.speicher, { ...r, notiz: 'mehr Chili' });
  speichereRezept(b.speicher, { ...b.speicher.hole('rezepte', r.id), notiz: 'weniger Salz' });
  await a.sync.abgleichen();
  const ergebnis = await b.sync.abgleichen();
  assert.equal(ergebnis.kopien, 1);
  const aufB = alleRezepte(b.speicher);
  assert.equal(aufB.length, 2);
  assert.equal(aufB.find((x) => x.id === r.id).notiz, 'mehr Chili', 'Server-Fassung bleibt');
  assert.equal(aufB.find((x) => x.id !== r.id).notiz, 'weniger Salz');
  assert.ok(aufB.find((x) => x.id !== r.id).konflikt);

  // zwei neue Zutaten mit demselben Namen, gleichzeitig angelegt: gleiche id, gleicher Inhalt
  const ergebnisA = speichereRezept(a.speicher, { art: 'kochen', name: 'Dal', portionen: 2, zutaten: [{ name: 'Tempeh' }] });
  const ergebnisB = speichereRezept(b.speicher, { art: 'kochen', name: 'Suppe', portionen: 2, zutaten: [{ name: 'tempeh' }] });
  assert.ok(ergebnisA && ergebnisB);
  await a.sync.abgleichen();
  const nachB = await b.sync.abgleichen();
  await a.sync.abgleichen();
  assert.equal(nachB.ok, true);
  assert.equal(a.speicher.alle('zutaten').filter((z) => z.id === 'tempeh').length, 1);
  assert.equal(b.speicher.alle('zutaten').filter((z) => z.id === 'tempeh').length, 1);
  assert.equal(a.speicher.alle('zutaten').length, b.speicher.alle('zutaten').length);
  assert.equal(a.speicher.offene('zutaten').length + b.speicher.offene('zutaten').length, 0);
});
