// Prüft das Bereinigen von Teigvorlagen von außen (Sicherungsdatei): Unsinn fliegt raus.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VORLAGEN, ladeVorlage } from '../js/teig/vorlagen.js';
import { bereinigeVorlage } from '../js/teig/pruefung.js';

const { teig } = ladeVorlage(VORLAGEN[1]);
const gut = { id: '123e4567-e89b-42d3-a456-426614174000', name: 'Brot', mehl: 450, teig };

test('Gültige Vorlage bleibt erhalten (id in Kleinbuchstaben)', () => {
  const v = bereinigeVorlage({ ...gut, id: gut.id.toUpperCase(), kategorie: 'brot', modus: 'mehl' });
  assert.equal(v.id, gut.id);
  assert.equal(v.name, 'Brot');
  assert.equal(v.mehl, 450);
  assert.equal(v.kategorie, 'brot');
  assert.equal(v.modus, 'mehl');
});

test('Ungültige Vorlagen ergeben null', () => {
  for (const schlecht of [
    { ...gut, id: 'focaccia' },                        // keine UUID (Kollision mit eingebauter Vorlage)
    { ...gut, name: '   ' },                            // ohne Namen
    { ...gut, mehl: 'viel' },                           // keine Zahl
    { ...gut, teig: { ...teig, salz: -5 } },            // negativ
    { ...gut, teig: { ...teig, hefe: 1e12 } },          // absurd groß
    { ...gut, teig: { ...teig, mehlsorten: 'x' } },
    42,
    null,
  ]) {
    assert.equal(bereinigeVorlage(schlecht), null, JSON.stringify(schlecht));
  }
});

test('Fremde Felder fliegen raus, Namen werden gekürzt, HTML bleibt Text', () => {
  const v = bereinigeVorlage({
    ...gut,
    name: `<img src=x onerror=alert(1)>${'x'.repeat(500)}`,
    boese: 'ja',
    teig: { ...teig, __proto__: { x: 1 }, extra: 'weg', mehlsorten: [{ ...teig.mehlsorten[0], boese: 1 }] },
  });
  assert.equal(v.boese, undefined);
  assert.equal(v.teig.extra, undefined);
  assert.equal(v.teig.mehlsorten[0].boese, undefined);
  assert.ok(v.name.length <= 80);
  assert.ok(v.name.startsWith('<img'), 'Name wird nicht verändert – die Oberfläche maskiert ihn');
});
