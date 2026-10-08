// Schlanke Back-Ansicht (1a): Zutatenliste aus dem Teig und die Notiz-Vorschau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { teigZutaten } from '../js/rezepte/backen.js';
import { notizKlappeHtml } from '../js/rezepte/teile.js';
import { LEERER_TEIG } from '../js/teig/vorlagen.js';

const teig = (aenderung = {}) => ({ ...structuredClone(LEERER_TEIG), ...aenderung });

test('Zutatenliste: nur, was der Teig wirklich hat', () => {
  const namen = teigZutaten(teig({ starter: 0, oel: 0, hefe: 0 })).map((z) => z.name);
  assert.deepEqual(namen, ['Weizen 550', 'Wasser', 'Salz']);
});

test('Zutatenliste: Starter, Öl, Hefe, Zusätze und Quellstück in der Reihenfolge des Rechners', () => {
  const z = teigZutaten(teig({
    starter: 20, oel: 2, hefe: 0.4, hefeArt: 'trocken',
    zusaetze: [{ id: 'milch', name: 'Milch', prozent: 10, wasser: 87 }],
    saaten: [{ id: 'leinsamen', name: 'Leinsamen', prozent: 5 }], quellwasser: 5,
  }));
  assert.deepEqual(z.map((x) => x.name),
    ['Weizen 550', 'Wasser', 'Starter', 'Salz', 'Öl', 'Trockenhefe', 'Milch', 'Leinsamen', 'Quellwasser']);
  assert.deepEqual(z.map((x) => x.ausgabe),
    ['mehlsorte-0', 'wasser', 'starter', 'salz', 'oel', 'hefe', 'zusatz-0', 'saat-0', 'quellwasser']);
});

test('Notiz: Vorschau in einer Zeile, Feld mit dem vollen Text, maskiert', () => {
  const html = notizKlappeHtml('Weniger Salz <b>\nund länger gehen', 'b');
  assert.match(html, /notiz-vorschau/);
  assert.match(html, /data-bnotiz/);
  assert.ok(!html.includes('<b>'), 'Text muss maskiert sein');
  assert.ok(!/<details[^>]* open/.test(html));
  assert.match(notizKlappeHtml('x', 'b', true), /<details[^>]* open/);
});

test('Notiz: leer = „Notiz hinzufügen“ ohne Vorschau', () => {
  const html = notizKlappeHtml('', 'b');
  assert.match(html, /Notiz hinzufügen/);
  assert.ok(!html.includes('notiz-vorschau'));
});
