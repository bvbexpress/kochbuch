// Prüft die optionale Teiglinge-Angabe (z. B. 8 × 85 g) in Vorlagen und Teilen-Link.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import {
  VORLAGEN,
  ladeVorlage,
  alleVorlagen,
  eigeneVorlagen,
  speichereEigeneVorlage,
  uebernehmeVorlagen,
  bereinigeTeiglinge,
} from '../js/teig/vorlagen.js';
import { erstelleLink, liesLink, bereinigeVorlage } from '../js/teig/teilen.js';

const BASIS = 'https://beispiel.test/kochbuch/';
const BUNS = { anzahl: 8, gewicht: 85, verlust: 2 };

const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());

function speichere(s, teiglinge, name = 'Buns') {
  const { teig } = ladeVorlage(VORLAGEN[0]);
  return speichereEigeneVorlage(s, { name, teig, mehl: 400, teiglinge });
}

test('Vorlage speichert die Teiglinge-Angabe und liefert sie beim Laden zurück', () => {
  const s = neuerSpeicher();
  speichere(s, BUNS);
  const geladen = ladeVorlage(eigeneVorlagen(s)[0]);
  assert.deepEqual(geladen.teiglinge, BUNS);
});

test('Ohne Angabe: Feld fehlt in der Vorlage, Laden liefert null', () => {
  const s = neuerSpeicher();
  const v = speichere(s, null);
  assert.equal('teiglinge' in v, false);
  assert.equal(ladeVorlage(eigeneVorlagen(s)[0]).teiglinge, null);
  assert.equal(ladeVorlage(VORLAGEN[0]).teiglinge, null);
});

test('Alte gespeicherte Vorlage (ohne Feld) lässt sich weiter laden', () => {
  const s = neuerSpeicher();
  const { teig } = ladeVorlage(VORLAGEN[1]);
  s.speichere('teigvorlagen', { name: 'Alt', teig, mehl: 450 });
  const v = alleVorlagen(s).at(-1);
  assert.equal(ladeVorlage(v).mehl, 450);
  assert.equal(ladeVorlage(v).teiglinge, null);
});

test('Unsinnige gespeicherte Angabe zählt als „keine Angabe“', () => {
  for (const kaputt of [null, 'x', {}, { anzahl: 8 }, { ...BUNS, gewicht: -1 }, { ...BUNS, anzahl: 'acht' },
    { ...BUNS, verlust: 500 }, { ...BUNS, anzahl: Infinity }]) {
    assert.equal(bereinigeTeiglinge(kaputt), null);
  }
  assert.deepEqual(bereinigeTeiglinge({ ...BUNS, extra: 1 }), BUNS);
});

test('Link: Teiglinge-Angabe kommt mit, alte Links ohne Angabe gehen weiter', async () => {
  const s = neuerSpeicher();
  speichere(s, BUNS, 'Mit');
  speichere(s, null, 'Ohne');
  const gelesen = await liesLink(await erstelleLink(eigeneVorlagen(s), BASIS));
  assert.equal(gelesen.verworfen, 0);
  const [mit, ohne] = gelesen.vorlagen;
  assert.deepEqual(mit.teiglinge, BUNS);
  assert.equal('teiglinge' in ohne, false);
});

test('Link: kaputte Angabe verwirft nur die Angabe, nicht die Vorlage', () => {
  const s = neuerSpeicher();
  const v = speichere(s, BUNS);
  const gut = bereinigeVorlage({ ...v, teiglinge: BUNS });
  assert.deepEqual(gut.teiglinge, BUNS);
  const schlecht = bereinigeVorlage({ ...v, teiglinge: { anzahl: 1e12, gewicht: 85, verlust: 2 } });
  assert.ok(schlecht);
  assert.equal('teiglinge' in schlecht, false);
});

test('Übernehmen (auch als Kopie) behält die Teiglinge-Angabe', async () => {
  const a = neuerSpeicher();
  speichere(a, BUNS);
  const { vorlagen } = await liesLink(await erstelleLink(eigeneVorlagen(a), BASIS));

  const b = neuerSpeicher();
  uebernehmeVorlagen(b, vorlagen);
  assert.deepEqual(ladeVorlage(eigeneVorlagen(b)[0]).teiglinge, BUNS);

  const c = neuerSpeicher();
  uebernehmeVorlagen(c, vorlagen, { alsKopie: true });
  assert.deepEqual(ladeVorlage(eigeneVorlagen(c)[0]).teiglinge, BUNS);
});

test('Änderung speichern ohne Angabe entfernt eine frühere Angabe', () => {
  const s = neuerSpeicher();
  const v = speichere(s, BUNS);
  const { teig } = ladeVorlage(VORLAGEN[0]);
  speichereEigeneVorlage(s, { id: v.id, name: 'Buns', teig, mehl: 400, teiglinge: null });
  assert.equal(ladeVorlage(eigeneVorlagen(s)[0]).teiglinge, null);
});
