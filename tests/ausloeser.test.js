// Tests für Etappe 2, Schritt F: Auslöser des Abgleichs (kern/ausloeser.js).
// Ohne Browser: Fenster, Zeitgeber und Abgleich sind nachgebaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleAusloeser, NACH_DEM_SPEICHERN } from '../js/kern/ausloeser.js';
import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { erstelleSync } from '../js/kern/sync.js';

/** Nachgebautes Fenster: Ereignisse auslösen, Zeitgeber von Hand weiterdrehen. */
function testUmgebung() {
  const zuhoerer = {};
  const fuer = (ziel) => (art, f) => {
    (zuhoerer[`${ziel}.${art}`] ??= []).push(f);
  };
  let zeit = 0;
  let naechste = 1;
  const zeitgeber = new Map(); // nummer → { um, f }
  const u = {
    document: { visibilityState: 'visible', addEventListener: fuer('document') },
    addEventListener: fuer('window'),
    setTimeout(f, ms) {
      zeitgeber.set(naechste, { um: zeit + ms, f });
      return naechste++;
    },
    clearTimeout(n) {
      zeitgeber.delete(n);
    },
    loese(ziel, art) {
      for (const f of zuhoerer[`${ziel}.${art}`] ?? []) f();
    },
    sichtbar(ja) {
      u.document.visibilityState = ja ? 'visible' : 'hidden';
      u.loese('document', 'visibilitychange');
    },
    /** Uhr vorstellen und fällige Zeitgeber ausführen. */
    warte(ms) {
      zeit += ms;
      for (const [n, z] of [...zeitgeber]) {
        if (z.um <= zeit) {
          zeitgeber.delete(n);
          z.f();
        }
      }
    },
    wartend: () => zeitgeber.size,
  };
  return u;
}

function testSync() {
  const s = {
    aufrufe: 0,
    async abgleichen() {
      s.aufrufe++;
      return { ok: true, hochgeladen: 0, heruntergeladen: 0, kopien: 0, abgewiesen: 0, offen: 0 };
    },
  };
  return s;
}

function aufbau({ bereit = true } = {}) {
  const umgebung = testUmgebung();
  const sync = testSync();
  const zustand = { bereit, berichte: [] };
  const ausloeser = erstelleAusloeser({
    sync,
    bereit: () => zustand.bereit,
    nachAbgleich: (b) => zustand.berichte.push(b),
    umgebung,
  });
  return { umgebung, sync, zustand, ausloeser };
}

const warte = () => new Promise((r) => setTimeout(r, 0));

test('App-Start, Rückkehr in die App und Netz wieder da lösen je einen Abgleich aus', async () => {
  const { umgebung, sync, zustand, ausloeser } = aufbau();
  await ausloeser.start();
  assert.equal(sync.aufrufe, 1, 'beim Start');
  umgebung.sichtbar(false);
  assert.equal(sync.aufrufe, 1, 'Verlassen ohne wartende Änderung: nichts');
  umgebung.sichtbar(true);
  assert.equal(sync.aufrufe, 2, 'Rückkehr in die App');
  umgebung.loese('window', 'online');
  assert.equal(sync.aufrufe, 3, 'Netz wieder da');
  await warte();
  assert.equal(zustand.berichte.length, 3, 'nach jedem Abgleich gemeldet');
});

test('Nicht bereit (nicht angemeldet, Sicherung offen): kein Abgleich', async () => {
  const { umgebung, sync, ausloeser } = aufbau({ bereit: false });
  assert.equal(await ausloeser.start(), null);
  umgebung.sichtbar(true);
  umgebung.loese('window', 'online');
  ausloeser.nachAenderung();
  umgebung.warte(NACH_DEM_SPEICHERN);
  assert.equal(sync.aufrufe, 0);
});

test('Kurz nach dem Speichern: mehrere Änderungen hintereinander → ein Abgleich', () => {
  const { umgebung, sync, ausloeser } = aufbau();
  ausloeser.nachAenderung();
  umgebung.warte(1000);
  ausloeser.nachAenderung();
  umgebung.warte(1000);
  ausloeser.nachAenderung();
  umgebung.warte(NACH_DEM_SPEICHERN - 1);
  assert.equal(sync.aufrufe, 0, 'wartet noch auf weitere Änderungen');
  umgebung.warte(1);
  assert.equal(sync.aufrufe, 1);
  assert.equal(umgebung.wartend(), 0);
});

test('App wird verlassen, während eine Änderung wartet: sofort hochladen', () => {
  const { umgebung, sync, ausloeser } = aufbau();
  ausloeser.start();
  ausloeser.nachAenderung();
  umgebung.sichtbar(false);
  assert.equal(sync.aufrufe, 2);
  assert.equal(umgebung.wartend(), 0, 'kein zweiter Abgleich hinterher');
});

test('Fehler in der Anzeige nach dem Abgleich stört nichts', async () => {
  const umgebung = testUmgebung();
  const sync = testSync();
  const ausloeser = erstelleAusloeser({
    sync,
    bereit: () => true,
    nachAbgleich: () => {
      throw new Error('kaputt');
    },
    umgebung,
  });
  const bericht = await ausloeser.jetzt();
  assert.equal(bericht.ok, true);
});

// ---------- Zusammenspiel mit Speicher und echtem Abgleich ----------

/** Kleiner Server wie in datenbank/schema.sql (nur das Nötigste). */
function kleinerServer() {
  const zeilen = new Map();
  let stand = 0;
  return {
    zeilen,
    async hochladen(aenderungen) {
      return aenderungen.map((e) => {
        const alt = zeilen.get(e.id);
        if ((alt?.version ?? 0) !== e.basis) return { sammlung: e.sammlung, id: e.id, ok: false, version: alt.version, daten: alt.daten, geloescht: alt.geloescht };
        zeilen.set(e.id, { ...structuredClone(e), version: e.basis + 1, stand: ++stand });
        return { sammlung: e.sammlung, id: e.id, ok: true, version: e.basis + 1 };
      });
    },
    async herunterladen(seit) {
      const liste = [...zeilen.values()].filter((z) => z.stand > seit);
      return { datensaetze: structuredClone(liste), stand: Math.max(seit, ...liste.map((z) => z.stand)), mehr: false };
    },
  };
}

function handy(server) {
  const speicher = erstelleSpeicher(speicherImArbeitsspeicher());
  const umgebung = testUmgebung();
  const berichte = [];
  const ausloeser = erstelleAusloeser({
    sync: erstelleSync({ speicher, server }),
    bereit: () => true,
    nachAbgleich: (b) => berichte.push(b),
    umgebung,
  });
  speicher.beiAenderung(() => ausloeser.nachAenderung());
  return { speicher, umgebung, ausloeser, berichte };
}

test('Speichern auf Handy 1 → kurz danach hochgeladen; Handy 2 bekommt es bei der Rückkehr in die App', async () => {
  const server = kleinerServer();
  const a = handy(server);
  const b = handy(server);
  await a.ausloeser.start();
  await b.ausloeser.start();

  const brot = a.speicher.speichere('teigvorlagen', { name: 'Brot', teig: { wasser: 70 } });
  assert.equal(a.speicher.offene('teigvorlagen').length, 1);
  a.umgebung.warte(NACH_DEM_SPEICHERN);
  await warte();
  assert.equal(a.speicher.offene('teigvorlagen').length, 0, 'hochgeladen');

  b.umgebung.sichtbar(true);
  await warte();
  assert.equal(b.speicher.hole('teigvorlagen', brot.id)?.name, 'Brot');
  assert.equal(b.berichte.at(-1).heruntergeladen, 1);
  assert.equal(b.umgebung.wartend(), 0, 'Daten vom Server lösen keinen neuen Abgleich aus');
});

test('Umzug: Datensätze von vor der Anmeldung gehen beim ersten Abgleich hoch', async () => {
  const server = kleinerServer();
  const backend = speicherImArbeitsspeicher();
  // Stand von vor Etappe 2: Datensätze ohne Sync-Angaben
  backend.setItem('kochbuch.v1.daten.teigvorlagen', JSON.stringify([
    { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Alt', erstellt: 1, geaendert: 1, geloescht: false },
  ]));
  backend.setItem('kochbuch.v1.daten.mehle', JSON.stringify([
    { id: 'weizen550', wasser: 62, erstellt: 1, geaendert: 1, geloescht: false },
  ]));
  const speicher = erstelleSpeicher(backend);
  const ausloeser = erstelleAusloeser({
    sync: erstelleSync({ speicher, server }), bereit: () => true, umgebung: testUmgebung(),
  });
  const bericht = await ausloeser.start();
  assert.equal(bericht.hochgeladen, 2);
  assert.equal(bericht.offen, 0);
  assert.equal(server.zeilen.size, 2);
  assert.equal(speicher.hole('teigvorlagen', 'a1b2c3d4-0000-4000-8000-000000000001').name, 'Alt', 'bleibt lokal');
});
