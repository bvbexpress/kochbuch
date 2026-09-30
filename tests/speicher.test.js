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
