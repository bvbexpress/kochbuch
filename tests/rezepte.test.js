// Tests für Etappe 3, Schritt 1: Rezept-Datenmodell, Zutatenkatalog, Skalierung.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { SAMMLUNGEN } from '../js/kern/sync.js';
import { LEERER_TEIG } from '../js/teig/vorlagen.js';
import {
  bereinigeRezept, speichereRezept, alleRezepte, holeRezept, loeseNamenAuf,
} from '../js/rezepte/rezept.js';
import {
  zutatId, alleZutaten, zutatenNamen, zutatName, findeOderNeu, EINGEBAUT,
} from '../js/rezepte/katalog.js';
import { faktorFuer, skaliereMenge, skaliere, mengeText } from '../js/rezepte/rechner.js';
import { formatMenge } from '../js/kern/zahlen.js';

const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());
const UUID = '0b6a1f64-3c1e-4c58-9f0a-6f1d2a3b4c5d';

const curry = () => ({
  art: 'kochen', name: 'Kichererbsen-Curry', kategorie: 'currys', portionen: 4,
  zutaten: [
    { zutat: 'kichererbsen', menge: 400, einheit: 'g' },
    { zutat: 'zwiebel', menge: 1, einheit: 'Stück', regel: 'ganz' },
    { zutat: 'salz', menge: null },
  ],
  schritte: ['Zwiebel würfeln', '', 'Anbraten'],
});

const backrezept = () => ({
  art: 'backen', name: 'Pizza', kategorie: 'pizza',
  teig: structuredClone(LEERER_TEIG), mehl: 500, modus: 'teiglinge',
  zutaten: [{ zutat: 'mozzarella', menge: 250, einheit: 'g' }, { zutat: 'backpulver', menge: 1, einheit: 'Päckchen', regel: 'fix' }],
});

// ---------- Prüfung ----------

test('Kochrezept: Defaults, leere Schritte fallen weg, Status/Quelle', () => {
  const r = bereinigeRezept(curry());
  assert.equal(r.portionsart, 'personen');
  assert.deepEqual(r.schritte, ['Zwiebel würfeln', 'Anbraten']);
  assert.equal(r.zutaten[0].regel, 'linear');
  assert.equal(r.zutaten[2].menge, null);
  assert.equal(r.zutaten[2].einheit, '');
  assert.equal(r.quelle, 'hand');
  assert.equal(r.status, 'erprobt');
  assert.equal(r.notiz, '');
  assert.equal(r.teig, undefined);
  assert.equal(bereinigeRezept({ ...curry(), quelle: 'import' }).status, 'testen');
  assert.equal(bereinigeRezept({ ...curry(), quelle: 'import', status: 'erprobt' }).status, 'erprobt');
});

test('Unbekannte Felder und Back-Felder beim Kochen fallen weg', () => {
  const r = bereinigeRezept({ ...curry(), boese: 1, mehl: 500, teig: LEERER_TEIG });
  assert.equal(r.boese, undefined);
  assert.equal(r.mehl, undefined);
  assert.equal(r.teig, undefined);
});

test('Kategorie gilt nur zur Art; unbekannte fällt weg', () => {
  assert.equal(bereinigeRezept({ ...curry(), kategorie: 'pizza' }).kategorie, undefined);
  assert.equal(bereinigeRezept({ ...backrezept(), kategorie: 'currys' }).kategorie, undefined);
  assert.equal(bereinigeRezept({ ...backrezept() }).kategorie, 'pizza');
});

test('Unbrauchbares wird abgewiesen', () => {
  const schlecht = [
    null, 'x', [], {},
    { ...curry(), name: '  ' },
    { ...curry(), art: 'braten' },
    { ...curry(), portionen: 0 },
    { ...curry(), portionen: undefined },
    { ...curry(), portionen: 5000 },
    { ...curry(), id: 'abc' },
    { ...curry(), zutaten: [{ zutat: 'a b', menge: 1 }] },
    { ...curry(), zutaten: [{ zutat: 'mehl', menge: -1 }] },
    { ...curry(), zutaten: [{ zutat: 'mehl', menge: '5' }] },
    { ...curry(), zutaten: [{ zutat: 'mehl', menge: 0 }] },
    { ...curry(), zutaten: Array(81).fill({ zutat: 'salz' }) },
    { ...curry(), schritte: [1] },
    { ...curry(), schritte: Array(61).fill('x') },
    { ...backrezept(), teig: null },
    { ...backrezept(), mehl: 0 },
  ];
  for (const s of schlecht) assert.equal(bereinigeRezept(s), null, JSON.stringify(s)?.slice(0, 80));
});

test('Texte werden gekürzt, id wird klein geschrieben', () => {
  const r = bereinigeRezept({ ...curry(), id: UUID.toUpperCase(), name: 'x'.repeat(200), notiz: 'n'.repeat(5000) });
  assert.equal(r.id, UUID);
  assert.equal(r.name.length, 80);
  assert.equal(r.notiz.length, 2000);
});

test('Back-Rezept: Teig geprüft, Teiglinge nur im Teiglinge-Modus, Portionen optional', () => {
  const r = bereinigeRezept(backrezept());
  assert.equal(r.modus, 'teiglinge');
  assert.deepEqual(r.teiglinge, { anzahl: 4, gewicht: 250, verlust: 2 }, 'Standard, wenn die Angabe fehlt');
  assert.equal(r.portionen, undefined);
  assert.equal(r.teig.hydration, 65);

  const mehlModus = bereinigeRezept({ ...backrezept(), modus: 'mehl', teiglinge: { anzahl: 8, gewicht: 85, verlust: 2 } });
  assert.equal(mehlModus.teiglinge, undefined);
  const alt = bereinigeRezept({ ...backrezept(), modus: undefined, teiglinge: { anzahl: 8, gewicht: 85, verlust: 2 } });
  assert.equal(alt.modus, 'teiglinge');
  assert.equal(bereinigeRezept({ ...backrezept(), teig: { ...LEERER_TEIG, hydration: 'viel' } }), null);
});

test('Konflikt-Vermerk wird übernommen, wenn gültig', () => {
  assert.deepEqual(bereinigeRezept({ ...curry(), konflikt: { von: 'a', am: 5 } }).konflikt, { von: 'a', am: 5 });
  assert.equal(bereinigeRezept({ ...curry(), konflikt: { von: 1 } }).konflikt, undefined);
});

// ---------- Katalog ----------

test('zutatId: deutsch, ohne Sonderzeichen; eingebaute Mehle passen', () => {
  assert.equal(zutatId('Kokosmilch'), 'kokosmilch');
  assert.equal(zutatId('Olivenöl, nativ'), 'olivenoelnativ');
  assert.equal(zutatId('Crème fraîche'), 'cremefraiche');
  assert.equal(zutatId('Weizen 550'), 'weizen550');
  assert.equal(zutatId('Tipo 00'), 'tipo00');
  assert.equal(zutatId('!!!'), null);
  assert.equal(zutatId(5), null);
  for (const z of EINGEBAUT) assert.equal(zutatId(z.name), z.id, z.id);
  assert.equal(new Set(EINGEBAUT.map((z) => z.id)).size, EINGEBAUT.length, 'keine doppelten ids');
});

test('Katalog: Mehle, Saaten, Zusätze sind der Anfang; eigene kommen alphabetisch dazu', () => {
  const s = neuerSpeicher();
  assert.ok(alleZutaten(s).some((z) => z.id === 'weizen550' && z.art === 'mehl'));
  assert.ok(alleZutaten(s).some((z) => z.id === 'ei' && z.art === 'zusatz'));
  s.speichere('zutaten', { id: 'zwiebel', name: 'Zwiebel', art: 'gemuese' });
  s.speichere('zutaten', { id: 'apfel', name: 'Apfel', art: 'obst' });
  s.speichere('zutaten', { id: 'kaputt', name: 5 });
  s.speichere('zutaten', { id: 'milch', name: 'Falsch' }); // eingebaut gewinnt
  const eigene = alleZutaten(s).slice(EINGEBAUT.length).map((z) => z.name);
  assert.deepEqual(eigene, ['Apfel', 'Zwiebel']);
  assert.equal(alleZutaten(s).find((z) => z.id === 'milch').name, 'Milch');
  assert.ok(zutatenNamen(s).includes('Zwiebel'));
  assert.deepEqual(zutatenNamen(s), [...zutatenNamen(s)].sort((a, b) => a.localeCompare(b, 'de')));
});

test('findeOderNeu: vorhandene Zutat wird gefunden, Unbekanntes ergibt neuen Eintrag', () => {
  const liste = EINGEBAUT;
  assert.deepEqual(findeOderNeu(liste, 'milch'), { eintrag: { id: 'milch', name: 'Milch', art: 'zusatz' }, neu: false });
  assert.equal(findeOderNeu(liste, ' Weizen  550 ').eintrag.id, 'weizen550');
  const neu = findeOderNeu(liste, 'Kokosmilch', 'gewuerz');
  assert.deepEqual(neu, { eintrag: { id: 'kokosmilch', name: 'Kokosmilch', art: 'gewuerz' }, neu: true });
  assert.equal(findeOderNeu(liste, 'Kokosmilch', 'quatsch').eintrag.art, 'sonstiges');
  assert.equal(findeOderNeu(liste, '???'), null);
  assert.equal(zutatName(liste, 'milch'), 'Milch');
  assert.equal(zutatName(liste, 'unbekannt'), 'unbekannt');
});

// ---------- Speichern ----------

test('Rezept mit Namen speichern: Zutaten bekommen ids, neue landen im Katalog', () => {
  const s = neuerSpeicher();
  const r = speichereRezept(s, {
    art: 'kochen', name: 'Dal', portionen: 2,
    zutaten: [
      { name: 'Rote Linsen', art: 'vorrat', menge: 200, einheit: 'g' },
      { name: 'milch', menge: 100, einheit: 'ml' },
      { name: 'Rote  Linsen', menge: 1, einheit: 'EL' },
    ],
  });
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(r.zutaten.map((z) => z.zutat), ['rotelinsen', 'milch', 'rotelinsen']);
  assert.equal(s.alle('zutaten').length, 1, 'nur eine neue Zutat, Milch gibt es schon');
  assert.deepEqual(
    (({ id, name, art }) => ({ id, name, art }))(s.alle('zutaten')[0]),
    { id: 'rotelinsen', name: 'Rote Linsen', art: 'vorrat' },
  );
  assert.equal(holeRezept(s, r.id).name, 'Dal');
  assert.equal(alleRezepte(s, 'backen').length, 0);
  assert.equal(alleRezepte(s, 'kochen').length, 1);
});

test('Ungültiges Rezept: nichts wird gespeichert, auch kein Katalogeintrag', () => {
  const s = neuerSpeicher();
  assert.equal(speichereRezept(s, { art: 'kochen', name: 'X', portionen: 0, zutaten: [{ name: 'Tomate' }] }), null);
  assert.equal(speichereRezept(s, { art: 'kochen', name: 'X', portionen: 2, zutaten: [{ name: '???' }] }), null);
  assert.equal(speichereRezept(s, null), null);
  assert.equal(s.alle('zutaten').length, 0);
  assert.equal(s.alle('rezepte').length, 0);
});

test('Ändern behält id und erstellt; Konflikt-Vermerk fällt beim Speichern weg', () => {
  const s = neuerSpeicher();
  const r = speichereRezept(s, curry());
  const g = speichereRezept(s, { ...r, notiz: 'weniger Salz', konflikt: { von: 'x', am: 1 } });
  assert.equal(g.id, r.id);
  assert.equal(g.erstellt, r.erstellt);
  assert.equal(g.konflikt, undefined);
  assert.equal(s.alle('rezepte').length, 1);
  assert.equal(holeRezept(s, r.id).notiz, 'weniger Salz');
});

test('Kaputte gespeicherte Rezepte werden übersprungen, nicht gezeigt', () => {
  const s = neuerSpeicher();
  s.speichere('rezepte', { name: 'Kaputt' });
  speichereRezept(s, curry());
  assert.equal(alleRezepte(s).length, 1);
});

test('loeseNamenAuf: ids bleiben, Namen werden aufgelöst, jede neue Zutat nur einmal', () => {
  const { roh, neu } = loeseNamenAuf(
    { zutaten: [{ zutat: 'salz' }, { name: 'Tofu' }, { name: 'tofu' }, { name: '' }] },
    EINGEBAUT,
  );
  assert.deepEqual(neu.map((n) => n.id), ['tofu']);
  assert.deepEqual(roh.zutaten.map((z) => z.zutat), ['salz', 'tofu', 'tofu', undefined]);
});

// ---------- Skalieren ----------

test('Kochen: Portionen ändern die Mengen nach Regel', () => {
  const r = bereinigeRezept(curry());
  const s = skaliere(r, { portionen: 6 });
  assert.equal(s.faktor, 1.5);
  assert.equal(s.portionen, 6);
  assert.equal(s.zutaten[0].menge, 600);     // linear
  assert.equal(s.zutaten[1].menge, 2);       // ganz: 1,5 → 2
  assert.equal(s.zutaten[2].menge, null);    // nach Geschmack
  assert.equal(r.zutaten[0].menge, 400, 'Original bleibt');
});

test('Regeln: ganz rundet (mindestens 1), fix bleibt, linear exakt', () => {
  assert.equal(skaliereMenge(1, 'ganz', 0.25), 1);
  assert.equal(skaliereMenge(3, 'ganz', 0.5), 2);
  assert.equal(skaliereMenge(2, 'ganz', 3), 6);
  assert.equal(skaliereMenge(1, 'fix', 5), 1);
  assert.equal(skaliereMenge(1, 'fix', 0), 1);
  assert.equal(skaliereMenge(250, 'linear', 0.5), 125);
  assert.equal(skaliereMenge(null, 'linear', 2), null);
  assert.equal(skaliereMenge(5, 'linear', 0), 0, 'leeres Ziel: 0');
  assert.equal(skaliereMenge(5, 'ganz', 0), 0);
});

test('Backen: Belag skaliert mit dem Mehl', () => {
  const r = bereinigeRezept({ ...backrezept(), portionen: 4, portionsart: 'stueck' });
  const s = skaliere(r, { mehl: 1000 });
  assert.equal(s.faktor, 2);
  assert.equal(s.zutaten[0].menge, 500);
  assert.equal(s.zutaten[1].menge, 1, 'fix');
  assert.equal(s.portionen, 8);
});

test('Backen: Teiglinge bestimmen das Mehl (4 × 250 g bei 65 % Wasser, 2 % Salz)', () => {
  const r = bereinigeRezept(backrezept());
  // Teig = Mehl × (1 + 0,65 + 0,02) → 4 × 250 × 1,02 / 1,67 = 610,8 g Mehl
  const f = faktorFuer(r, { teiglinge: { anzahl: 4, gewicht: 250, verlust: 2 } });
  assert.ok(Math.abs(f - 610.778 / 500) < 0.001, String(f));
  assert.equal(faktorFuer(r, { teiglinge: { anzahl: 0, gewicht: 250 } }), 0);
});

test('Ungültiges Ziel ergibt Faktor 0, nichts bricht', () => {
  const r = bereinigeRezept(curry());
  for (const ziel of [null, {}, { portionen: 0 }, { portionen: NaN }, { portionen: -2 }]) {
    assert.equal(faktorFuer(r, ziel), 0);
  }
  assert.equal(skaliere(r, {}).portionen, 0);
});

test('Anzeige der Mengen', () => {
  assert.equal(formatMenge(333.3), '333');
  assert.equal(formatMenge(2.5), '2,5');
  assert.equal(formatMenge(0.25), '0,25');
  assert.equal(mengeText(400, 'ml'), '400 ml');
  assert.equal(mengeText(2, ''), '2');
  assert.equal(mengeText(null, 'g'), 'nach Geschmack');
});

// ---------- Abgleich ----------

test('Neue Sammlungen sind im Abgleich: Rezepte als Kopie, Zutaten „zuletzt“', () => {
  assert.equal(SAMMLUNGEN.rezepte, 'kopie');
  assert.equal(SAMMLUNGEN.zutaten, 'zuletzt');
});
