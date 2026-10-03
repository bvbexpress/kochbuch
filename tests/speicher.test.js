// Tests für die Speicher-Schicht (mit Speicher im Arbeitsspeicher statt localStorage).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';

// Uhr, die bei jedem Aufruf eine Sekunde weiterläuft – macht Zeitstempel vorhersagbar
function testUhr() {
  let zeit = 1_000_000;
  return () => (zeit += 1000);
}

function neuerSpeicher() {
  return erstelleSpeicher(speicherImArbeitsspeicher(), testUhr());
}

test('Neuer Datensatz bekommt id, erstellt, geaendert und geloescht=false', () => {
  const s = neuerSpeicher();
  const d = s.speichere('vorlagen', { name: 'Pizza' });
  assert.match(d.id, /^[0-9a-f-]{36}$/);
  assert.equal(d.geloescht, false);
  assert.equal(d.erstellt, d.geaendert);
  assert.deepEqual(s.alle('vorlagen').map((v) => v.name), ['Pizza']);
});

test('Ändern behält id und erstellt, aktualisiert geaendert', () => {
  const s = neuerSpeicher();
  const d = s.speichere('vorlagen', { name: 'Pizza' });
  const d2 = s.speichere('vorlagen', { ...d, name: 'Pizza Napoli' });
  assert.equal(d2.id, d.id);
  assert.equal(d2.erstellt, d.erstellt);
  assert.ok(d2.geaendert > d.geaendert);
  assert.equal(s.alle('vorlagen').length, 1);
  assert.equal(s.hole('vorlagen', d.id).name, 'Pizza Napoli');
});

test('Löschen hinterlässt einen Grabstein ohne Nutzdaten', () => {
  const backend = speicherImArbeitsspeicher();
  const s = erstelleSpeicher(backend, testUhr());
  const d = s.speichere('vorlagen', { name: 'Pizza' });
  s.loesche('vorlagen', d.id);
  assert.deepEqual(s.alle('vorlagen'), []);
  assert.equal(s.hole('vorlagen', d.id), null);

  const roh = JSON.parse(backend.getItem('kochbuch.v1.daten.vorlagen'));
  assert.equal(roh.length, 1);
  assert.equal(roh[0].geloescht, true);
  assert.equal(roh[0].name, undefined);
});

test('Reihenfolge: älteste zuerst, auch nach Änderungen', () => {
  const s = neuerSpeicher();
  const a = s.speichere('vorlagen', { name: 'A' });
  s.speichere('vorlagen', { name: 'B' });
  s.speichere('vorlagen', { ...a, name: 'A2' });
  assert.deepEqual(s.alle('vorlagen').map((v) => v.name), ['A2', 'B']);
});

test('Sammlungen sind getrennt', () => {
  const s = neuerSpeicher();
  s.speichere('vorlagen', { name: 'Pizza' });
  assert.deepEqual(s.alle('rezepte'), []);
});

test('Geräte-Einstellungen: speichern, lesen, Ersatzwert', () => {
  const s = neuerSpeicher();
  assert.equal(s.einstellung('fehlt', 'ersatz'), 'ersatz');
  s.setzeEinstellung('teig.stand', { mehl: 300 });
  assert.deepEqual(s.einstellung('teig.stand'), { mehl: 300 });
});

test('Kaputte Daten im Speicher blockieren die App nicht', () => {
  const backend = speicherImArbeitsspeicher();
  backend.setItem('kochbuch.v1.daten.vorlagen', '{kaputt');
  backend.setItem('kochbuch.v1.geraet.x', 'auch kaputt');
  const s = erstelleSpeicher(backend);
  assert.deepEqual(s.alle('vorlagen'), []);
  assert.equal(s.einstellung('x', 'ersatz'), 'ersatz');
});

test('Voller Speicher: speichere gibt null zurück statt abzustürzen', () => {
  const s = erstelleSpeicher({
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
  });
  assert.equal(s.speichere('vorlagen', { name: 'X' }), null);
});

// ---- Abgleich (Etappe 2, Schritt A) ----

test('Speichern, Übernehmen und Löschen markieren als offen', () => {
  const s = neuerSpeicher();
  const a = s.speichere('vorlagen', { name: 'A' });
  s.uebernimm('vorlagen', { id: '11111111-1111-4111-8111-111111111111', name: 'Link', geaendert: 5 });
  const b = s.speichere('vorlagen', { name: 'B' });
  s.loesche('vorlagen', b.id);
  const offen = s.offene('vorlagen');
  assert.equal(offen.length, 3);
  assert.ok(offen.every((o) => o.version === 0));
  assert.equal(offen.find((o) => o.datensatz.id === b.id).datensatz.geloescht, true);
  assert.equal(offen.find((o) => o.datensatz.id === a.id).datensatz.name, 'A');
});

test('Sync-Angaben bleiben intern (alle, hole, speichere geben sie nicht heraus)', () => {
  const s = neuerSpeicher();
  const d = s.speichere('vorlagen', { name: 'A', sync: { version: 99, offen: false } });
  assert.equal(d.sync, undefined);
  assert.equal(s.hole('vorlagen', d.id).sync, undefined);
  assert.equal(s.alle('vorlagen')[0].sync, undefined);
  assert.equal(s.offene('vorlagen')[0].version, 0, 'von außen eingeschmuggelte Version zählt nicht');
});

test('Alte Datensätze ohne Sync-Angaben gelten als offen mit Version 0', () => {
  const backend = speicherImArbeitsspeicher();
  backend.setItem('kochbuch.v1.daten.vorlagen', JSON.stringify([
    { id: 'x', name: 'Alt', erstellt: 1, geaendert: 1, geloescht: false },
  ]));
  const s = erstelleSpeicher(backend);
  assert.deepEqual(s.offene('vorlagen'), [
    { datensatz: { id: 'x', name: 'Alt', erstellt: 1, geaendert: 1, geloescht: false }, version: 0 },
  ]);
});

test('Hochgeladen: nicht mehr offen, Server-Version wird gemerkt', () => {
  const s = neuerSpeicher();
  s.speichere('vorlagen', { name: 'A' });
  const [{ datensatz }] = s.offene('vorlagen');
  assert.equal(s.hochgeladen('vorlagen', datensatz, 1), true);
  assert.deepEqual(s.offene('vorlagen'), []);

  // nächste Änderung baut auf Version 1 auf
  s.speichere('vorlagen', { ...s.hole('vorlagen', datensatz.id), name: 'A2' });
  assert.equal(s.offene('vorlagen')[0].version, 1);
});

test('Hochgeladen, aber inzwischen erneut geändert: bleibt offen, beruht auf neuer Version', () => {
  const s = neuerSpeicher();
  s.speichere('vorlagen', { name: 'A' });
  const [{ datensatz }] = s.offene('vorlagen');
  s.speichere('vorlagen', { ...datensatz, name: 'A2' }); // Änderung während des Hochladens
  s.hochgeladen('vorlagen', datensatz, 1);
  const offen = s.offene('vorlagen');
  assert.equal(offen.length, 1);
  assert.equal(offen[0].version, 1);
  assert.equal(offen[0].datensatz.name, 'A2');
});

test('Hochgeladen: unsinnige oder ältere Version wird ignoriert', () => {
  const s = neuerSpeicher();
  s.speichere('vorlagen', { name: 'A' });
  const [{ datensatz }] = s.offene('vorlagen');
  assert.equal(s.hochgeladen('vorlagen', datensatz, 0), false);
  assert.equal(s.hochgeladen('vorlagen', datensatz, 1.5), false);
  assert.equal(s.hochgeladen('vorlagen', { id: 'fehlt' }, 1), false);
  s.hochgeladen('vorlagen', datensatz, 3);
  assert.equal(s.hochgeladen('vorlagen', datensatz, 2), false);
});

test('Vom Server übernehmen: neu, Änderung, Grabstein – danach nicht offen', () => {
  const s = neuerSpeicher();
  const daten = { id: 'v1', name: 'Server', erstellt: 10, geaendert: 20 };
  assert.equal(s.vomServer('vorlagen', { id: 'v1', daten, geloescht: false, version: 1 }), 'uebernommen');
  assert.deepEqual(s.hole('vorlagen', 'v1'), { ...daten, geloescht: false });
  assert.deepEqual(s.offene('vorlagen'), []);

  s.vomServer('vorlagen', { id: 'v1', daten: { ...daten, name: 'Neu' }, geloescht: false, version: 2 });
  assert.equal(s.hole('vorlagen', 'v1').name, 'Neu');

  s.vomServer('vorlagen', { id: 'v1', daten: { id: 'v1', geaendert: 30 }, geloescht: true, version: 3 });
  assert.equal(s.hole('vorlagen', 'v1'), null);
  assert.deepEqual(s.offene('vorlagen'), []);
});

test('Vom Server übernehmen: bekannte oder ältere Version ändert nichts', () => {
  const s = neuerSpeicher();
  s.vomServer('vorlagen', { id: 'v1', daten: { name: 'Neu' }, geloescht: false, version: 5 });
  assert.equal(s.vomServer('vorlagen', { id: 'v1', daten: { name: 'Alt' }, geloescht: false, version: 4 }), 'bekannt');
  assert.equal(s.vomServer('vorlagen', { id: 'v1', daten: { name: 'Alt' }, geloescht: false, version: 5 }), 'bekannt');
  assert.equal(s.hole('vorlagen', 'v1').name, 'Neu');
});

test('Vom Server übernehmen überschreibt keine offene Änderung (nur mit offeneErsetzen)', () => {
  const s = neuerSpeicher();
  s.vomServer('vorlagen', { id: 'v1', daten: { name: 'Server' }, geloescht: false, version: 1 });
  s.speichere('vorlagen', { ...s.hole('vorlagen', 'v1'), name: 'Meins' });

  const server2 = { id: 'v1', daten: { name: 'Server2' }, geloescht: false, version: 2 };
  assert.equal(s.vomServer('vorlagen', server2), 'offen');
  assert.equal(s.hole('vorlagen', 'v1').name, 'Meins');
  assert.equal(s.offene('vorlagen').length, 1);

  assert.equal(s.vomServer('vorlagen', server2, { offeneErsetzen: true }), 'uebernommen');
  assert.equal(s.hole('vorlagen', 'v1').name, 'Server2');
  assert.deepEqual(s.offene('vorlagen'), []);
});

test('Vom Server übernehmen: ungültige Daten werden abgewiesen', () => {
  const s = neuerSpeicher();
  for (const kaputt of [
    { id: '', daten: {}, geloescht: false, version: 1 },
    { id: 'a', daten: null, geloescht: false, version: 1 },
    { id: 'a', daten: [1], geloescht: false, version: 1 },
    { id: 'a', daten: {}, geloescht: false, version: 0 },
    { id: 'a', daten: {}, geloescht: false, version: '2' },
  ]) assert.equal(s.vomServer('vorlagen', kaputt), 'ungueltig');
  assert.deepEqual(s.alle('vorlagen'), []);
});

test('Server-Daten: id und Sync-Angaben kommen nie aus den Nutzdaten', () => {
  const s = neuerSpeicher();
  s.vomServer('vorlagen', { id: 'v1', daten: { id: 'anders', name: 'X', sync: { offen: true } }, geloescht: false, version: 1 });
  assert.equal(s.hole('vorlagen', 'v1').name, 'X');
  assert.equal(s.hole('vorlagen', 'anders'), null);
  assert.deepEqual(s.offene('vorlagen'), []);
});

test('Sync-Stand: Startwert 0, merkt sich ganze Zahlen, ignoriert Unsinn', () => {
  const s = neuerSpeicher();
  assert.equal(s.syncStand(), 0);
  assert.equal(s.setzeSyncStand(42), true);
  assert.equal(s.syncStand(), 42);
  assert.equal(s.setzeSyncStand(-1), false);
  assert.equal(s.setzeSyncStand(1.5), false);
  assert.equal(s.syncStand(), 42);
});

test('Neue Basis nach Konflikt: bleibt offen, beruht auf Server-Version; nur für offene', () => {
  const s = neuerSpeicher();
  const d = s.speichere('vorlagen', { name: 'A' });
  assert.equal(s.neueBasis('vorlagen', d.id, 7), true);
  assert.deepEqual(s.offene('vorlagen').map((o) => o.version), [7]);
  assert.equal(s.neueBasis('vorlagen', d.id, 0), true, '0 = gibt es auf dem Server nicht');
  assert.equal(s.neueBasis('vorlagen', d.id, -1), false);
  assert.equal(s.neueBasis('vorlagen', d.id, 1.5), false);
  assert.equal(s.neueBasis('vorlagen', 'fehlt', 1), false);
  s.hochgeladen('vorlagen', s.offene('vorlagen')[0].datensatz, 1);
  assert.equal(s.neueBasis('vorlagen', d.id, 5), false, 'nicht offen');
});

// ---- Zuhörer für lokale Änderungen (Auslöser „kurz nach dem Speichern“, Schritt F) ----

test('beiAenderung: nur lokale Änderungen melden, nicht Daten vom Server oder Einstellungen', () => {
  const s = neuerSpeicher();
  let meldungen = 0;
  const abmelden = s.beiAenderung(() => meldungen++);

  const d = s.speichere('vorlagen', { name: 'Pizza' });
  assert.equal(meldungen, 1);
  s.uebernimm('vorlagen', { ...d, name: 'Pizza 2', geaendert: d.geaendert + 5000 });
  assert.equal(meldungen, 2);
  s.loesche('vorlagen', d.id);
  assert.equal(meldungen, 3);

  s.hochgeladen('vorlagen', s.offene('vorlagen')[0].datensatz, 1);
  s.vomServer('vorlagen', { id: crypto.randomUUID(), daten: { name: 'Brot' }, geloescht: false, version: 1 });
  s.setzeEinstellung('teig.stand', { x: 1 });
  s.setzeSyncStand(4);
  assert.equal(meldungen, 3, 'Server-Daten und Einstellungen lösen nichts aus');

  abmelden();
  s.speichere('vorlagen', { name: 'Focaccia' });
  assert.equal(meldungen, 3);
});

test('beiAenderung: ein fehlerhafter Zuhörer stört das Speichern nicht', () => {
  const s = neuerSpeicher();
  s.beiAenderung(() => {
    throw new Error('kaputt');
  });
  const d = s.speichere('vorlagen', { name: 'Pizza' });
  assert.equal(s.hole('vorlagen', d.id).name, 'Pizza');
});
