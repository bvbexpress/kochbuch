// Tests für „+ Neue Vorlage“: Vorbelegung nach Kategorie, leere Basis, Kopie einer Vorlage.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import {
  VORLAGEN,
  ladeVorlage,
  eigeneVorlagen,
  speichereEigeneVorlage,
  vorbelegung,
  neueVorlage,
  LEERER_TEIG,
  LEERES_MEHL,
  STANDARD_TEIGLINGE,
  istGueltigerTeig,
} from '../js/teig/vorlagen.js';
import { berechne, gesamtmehlAusMehl } from '../js/teig/rechner.js';

const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());

test('Vorbelegung: Pizza 4 × 250 g, Brötchen 8 × 85 g, sonst Mehl', () => {
  assert.deepEqual(vorbelegung('pizza'), { modus: 'teiglinge', teiglinge: { anzahl: 4, gewicht: 250, verlust: 2 } });
  assert.deepEqual(vorbelegung('broetchen'), { modus: 'teiglinge', teiglinge: { anzahl: 8, gewicht: 85, verlust: 2 } });
  for (const k of ['brot', 'focaccia', 'gebaeck', null, 'quatsch']) {
    assert.deepEqual(vorbelegung(k), { modus: 'mehl', teiglinge: null }, String(k));
  }
});

test('Leere Basis: gültiger Grundteig ohne Hinweise', () => {
  const v = neueVorlage({ name: ' Mein Brot ', kategorie: 'brot' });
  assert.equal(v.name, 'Mein Brot');
  assert.equal(v.modus, 'mehl');
  assert.equal(v.mehl, LEERES_MEHL);
  assert.deepEqual(v.teig, LEERER_TEIG);
  assert.ok(istGueltigerTeig(v.teig));
  assert.deepEqual(berechne(v.teig, gesamtmehlAusMehl(v.teig, v.mehl)).hinweise, []);
});

test('Leere Basis ist eine Kopie: Änderungen verändern LEERER_TEIG nicht', () => {
  neueVorlage({ name: 'A' }).teig.salz = 99;
  assert.equal(LEERER_TEIG.salz, 2);
});

test('Modus folgt der Kategorie, lässt sich aber ausdrücklich ändern', () => {
  const pizza = neueVorlage({ name: 'Pizza', kategorie: 'pizza' });
  assert.equal(pizza.modus, 'teiglinge');
  assert.deepEqual(pizza.teiglinge, { anzahl: 4, gewicht: 250, verlust: 2 });
  assert.equal(neueVorlage({ name: 'Pizza', kategorie: 'pizza', modus: 'mehl' }).modus, 'mehl');
  const brot = neueVorlage({ name: 'Brot', kategorie: 'brot', modus: 'teiglinge' });
  assert.equal(brot.modus, 'teiglinge');
  assert.deepEqual(brot.teiglinge, STANDARD_TEIGLINGE);
});

test('Kopie einer eingebauten Vorlage übernimmt Teig und Mehl, nicht Name/Kategorie', () => {
  const v = neueVorlage({ name: 'Meine Focaccia', kategorie: 'pizza', basis: VORLAGEN[0] });
  assert.deepEqual(v.teig, ladeVorlage(VORLAGEN[0]).teig);
  assert.equal(v.mehl, 300);
  assert.equal(v.kategorie, 'pizza');
  assert.equal(v.modus, 'teiglinge');
  assert.deepEqual(v.teiglinge, { anzahl: 4, gewicht: 250, verlust: 2 }); // Basis hat keine → Kategorie
});

test('Kopie einer eigenen Teiglinge-Vorlage behält deren Anzahl und Gewicht', () => {
  const s = neuerSpeicher();
  speichereEigeneVorlage(s, { name: 'Napoli', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 400,
    modus: 'teiglinge', teiglinge: { anzahl: 6, gewicht: 280, verlust: 3 }, kategorie: 'pizza' });
  const v = neueVorlage({ name: 'Napoli 2', kategorie: 'pizza', basis: eigeneVorlagen(s)[0] });
  assert.deepEqual(v.teiglinge, { anzahl: 6, gewicht: 280, verlust: 3 });
});

test('Neue Vorlage speichern und wieder laden: Modus, Kategorie, Teiglinge stimmen', () => {
  const s = neuerSpeicher();
  speichereEigeneVorlage(s, neueVorlage({ name: 'Buns', kategorie: 'broetchen' }));
  const geladen = ladeVorlage(eigeneVorlagen(s)[0]);
  assert.equal(geladen.modus, 'teiglinge');
  assert.equal(geladen.kategorie, 'broetchen');
  assert.deepEqual(geladen.teiglinge, { anzahl: 8, gewicht: 85, verlust: 2 });
  assert.deepEqual(geladen.teig, LEERER_TEIG);
});

test('Ohne Kategorie: Mehl-Modus', () => {
  const v = neueVorlage({ name: 'X', kategorie: '' });
  assert.equal(v.kategorie, null);
  assert.equal(v.modus, 'mehl');
});
