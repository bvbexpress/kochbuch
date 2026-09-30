// Prüft die eingebauten Vorlagen auf Tippfehler.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VORLAGEN, ladeVorlage } from '../js/teig/vorlagen.js';
import { berechne } from '../js/teig/rechner.js';

test('Jede Vorlage hat eine eindeutige id und einen Namen', () => {
  const ids = VORLAGEN.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const v of VORLAGEN) assert.ok(v.name.length > 0);
});

test('Jede Vorlage rechnet ohne Hinweise und mit Mehlanteilen von 100 %', () => {
  for (const v of VORLAGEN) {
    const { teig, gesamtmehl } = ladeVorlage(v);
    assert.ok(gesamtmehl > 0, v.id);
    assert.deepEqual(berechne(teig, gesamtmehl).hinweise, [], v.id);
  }
});

test('Laden liefert eine Kopie: Änderungen verändern die Vorlage nicht', () => {
  const erster = ladeVorlage(VORLAGEN[0]);
  erster.teig.salz = 99;
  assert.notEqual(ladeVorlage(VORLAGEN[0]).teig.salz, 99);
});
