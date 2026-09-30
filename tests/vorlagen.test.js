// Prüft die eingebauten Vorlagen auf Tippfehler.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VORLAGEN, ladeVorlage } from '../js/teig/vorlagen.js';
import { berechne, gesamtmehlAusMehl } from '../js/teig/rechner.js';

test('Jede Vorlage hat eine eindeutige id und einen Namen', () => {
  const ids = VORLAGEN.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const v of VORLAGEN) assert.ok(v.name.length > 0);
});

test('Jede Vorlage rechnet ohne Hinweise und mit Mehlanteilen von 100 %', () => {
  for (const v of VORLAGEN) {
    const { teig, mehl } = ladeVorlage(v);
    assert.ok(mehl > 0, v.id);
    assert.deepEqual(berechne(teig, gesamtmehlAusMehl(teig, mehl)).hinweise, [], v.id);
  }
});

test('Laden liefert eine Kopie: Änderungen verändern die Vorlage nicht', () => {
  const erster = ladeVorlage(VORLAGEN[0]);
  erster.teig.salz = 99;
  assert.notEqual(ladeVorlage(VORLAGEN[0]).teig.salz, 99);
});

// ---------- Eigene Vorlagen ----------

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import {
  alleVorlagen,
  speichereEigeneVorlage,
  loescheEigeneVorlage,
  istGueltigerTeig,
} from '../js/teig/vorlagen.js';

function neuerSpeicher() {
  return erstelleSpeicher(speicherImArbeitsspeicher());
}

test('Eigene Vorlage speichern, laden und exakt zurückbekommen', () => {
  const s = neuerSpeicher();
  const { teig } = ladeVorlage(VORLAGEN[0]);
  teig.salz = 2.5;
  const gespeichert = speichereEigeneVorlage(s, { name: '  Pizza  ', teig, mehl: 500 });

  const liste = alleVorlagen(s);
  assert.equal(liste.length, VORLAGEN.length + 1);
  const eigene = liste.at(-1);
  assert.equal(eigene.name, 'Pizza');
  assert.equal(eigene.eingebaut, false);
  assert.equal(eigene.id, gespeichert.id);

  const geladen = ladeVorlage(eigene);
  assert.equal(geladen.mehl, 500);
  assert.equal(geladen.teig.salz, 2.5);
});

test('Gespeicherte Vorlage ist eine Kopie: spätere Eingaben ändern sie nicht', () => {
  const s = neuerSpeicher();
  const { teig } = ladeVorlage(VORLAGEN[0]);
  speichereEigeneVorlage(s, { name: 'X', teig, mehl: 300 });
  teig.salz = 99;
  assert.notEqual(alleVorlagen(s).at(-1).teig.salz, 99);
});

test('Eigene Vorlage ändern und löschen', () => {
  const s = neuerSpeicher();
  const { teig } = ladeVorlage(VORLAGEN[0]);
  const v = speichereEigeneVorlage(s, { name: 'X', teig, mehl: 300 });
  speichereEigeneVorlage(s, { id: v.id, name: 'X', teig, mehl: 400 });
  assert.equal(alleVorlagen(s).at(-1).mehl, 400);
  assert.equal(alleVorlagen(s).length, VORLAGEN.length + 1);

  loescheEigeneVorlage(s, v.id);
  assert.equal(alleVorlagen(s).length, VORLAGEN.length);
});

test('istGueltigerTeig erkennt kaputte Daten', () => {
  assert.equal(istGueltigerTeig(ladeVorlage(VORLAGEN[0]).teig), true);
  assert.equal(istGueltigerTeig(null), false);
  assert.equal(istGueltigerTeig({ hydration: '70' }), false);
  assert.equal(istGueltigerTeig({ hydration: 70, starter: 0, salz: 2, oel: 0, hefe: NaN, mehlsorten: [] }), false);
});
