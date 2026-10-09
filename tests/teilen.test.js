// Tests für „Rezept teilen“: Text mit den eingestellten Mengen, Stückzahlen, Notiz, Teilen-Menü.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { speichereRezept, holeRezept } from '../js/rezepte/rezept.js';
import { alleZutaten } from '../js/rezepte/katalog.js';
import { rezeptAlsText, mengeZeile, teileText, teileAusKnopf, notizMitteilen, setzeNotizMitteilen } from '../js/rezepte/teilen.js';
import { teilenHtml } from '../js/rezepte/teile.js';
import { LEERER_TEIG } from '../js/teig/vorlagen.js';

const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());

function kochrezept(s, extra = {}) {
  const r = speichereRezept(s, {
    art: 'kochen', name: 'Linsen-Dal', kategorie: 'currys', portionen: 4, notiz: 'Weniger Salz.',
    zutaten: [
      { name: 'Rote Linsen', menge: 200, einheit: 'g' },
      { name: 'Zwiebel', menge: 1, einheit: '', regel: 'ganz' },
      { name: 'Salz', menge: null },
    ],
    schritte: ['Zwiebel würfeln.', 'Linsen 20 Min. kochen.'],
    schrittzutaten: [[{ name: 'Zwiebel' }], [{ name: 'Rote Linsen' }, { name: 'Salz' }]],
    schrittgeraete: ['', 'Wok'],
    ...extra,
  });
  return holeRezept(s, r.id);
}

test('Stückzahl ohne Einheit: „2 × Zwiebel“, mit Einheit wie bisher, ohne Menge „nach Geschmack“', () => {
  assert.equal(mengeZeile({ name: 'Zwiebel', menge: 2, einheit: '' }), '2 × Zwiebel');
  assert.equal(mengeZeile({ name: 'Zwiebel', menge: 2 }), '2 × Zwiebel');
  assert.equal(mengeZeile({ name: 'Linsen', menge: 400, einheit: 'g' }), '400 g Linsen');
  assert.equal(mengeZeile({ name: 'Knoblauch', menge: 2, einheit: 'Zehen' }), '2 Zehen Knoblauch');
  assert.equal(mengeZeile({ name: 'Salz', menge: null, einheit: '' }), 'Salz (nach Geschmack)');
});

test('Kochen: Text mit den eingestellten Portionen, Zutaten, Schritten, Mengen und Geräten', () => {
  const s = neuerSpeicher();
  const r = kochrezept(s);
  const katalog = alleZutaten(s);
  assert.equal(rezeptAlsText(r, { katalog, portionen: 8 }), [
    '*Linsen-Dal*',
    '8 Personen',
    'Geräte: Wok',
    '',
    '*Zutaten*',
    '• 400 g Rote Linsen',
    '• 2 × Zwiebel',
    '• Salz (nach Geschmack)',
    '',
    '*Schritte*',
    '1. Zwiebel würfeln.',
    '   Dazu: 2 × Zwiebel',
    '2. Linsen 20 Min. kochen.',
    '   Gerät: Wok',
    '   Dazu: 400 g Rote Linsen, Salz (nach Geschmack)',
  ].join('\n'));
  // gespeicherte Portionen bleiben unberührt
  assert.match(rezeptAlsText(r, { katalog, portionen: 4 }), /• 200 g Rote Linsen/);
  assert.equal(r.portionen, 4);
});

test('Kochen: ohne Zutaten je Schritt werden die Mengen über den Namen im Schritt gesucht', () => {
  const s = neuerSpeicher();
  const r = kochrezept(s, { schrittzutaten: undefined });
  const text = rezeptAlsText(r, { katalog: alleZutaten(s), portionen: 4 });
  assert.match(text, /1\. Zwiebel würfeln\.\n {3}Dazu: 1 × Zwiebel/);
});

test('Notiz nur mit Schalter, leere Notiz nie', () => {
  const s = neuerSpeicher();
  const r = kochrezept(s);
  const katalog = alleZutaten(s);
  assert.ok(!rezeptAlsText(r, { katalog, portionen: 4 }).includes('Notiz'));
  assert.ok(!rezeptAlsText(r, { katalog, portionen: 4, mitNotiz: false }).includes('Weniger Salz'));
  assert.ok(rezeptAlsText(r, { katalog, portionen: 4, mitNotiz: true }).endsWith('\n\n*Notiz*\nWeniger Salz.'));
  const ohne = kochrezept(s, { notiz: '  ' });
  assert.ok(!rezeptAlsText(ohne, { katalog, portionen: 4, mitNotiz: true }).includes('Notiz'));
});

test('Rezept ohne Schritte und Zutaten: nur Kopf, keine leeren Überschriften', () => {
  const s = neuerSpeicher();
  const r = holeRezept(s, speichereRezept(s, { art: 'kochen', name: 'Leer', portionen: 2 }).id);
  assert.equal(rezeptAlsText(r, { katalog: alleZutaten(s), portionen: 2 }), '*Leer*\n2 Personen');
});

function backrezept(s, extra = {}) {
  const r = speichereRezept(s, {
    art: 'backen', name: 'Brot', kategorie: 'brot', teig: structuredClone(LEERER_TEIG), mehl: 500, notiz: 'Länger backen.',
    zutaten: [{ name: 'Olive', menge: 100, einheit: 'g' }],
    schritte: ['Alles kneten.', 'Oliven unterheben, 30 Min. ruhen.', 'Backen, 40 Min.'],
    schrittzutaten: [[], [{ name: 'Olive' }], []],
    schrittteig: [[{ teil: 'mehl' }, { teil: 'wasser', anteil: 0.9 }, { teil: 'salz' }], [{ teil: 'wasser', anteil: 0.1 }], []],
    schrittgeraete: ['', '', 'Ofen 230 °C'],
    ...extra,
  });
  return holeRezept(s, r.id);
}

test('Backen mit Mehl: Teig in Gramm für das eingestellte Mehl, Teig und Zutaten je Schritt', () => {
  const s = neuerSpeicher();
  const r = backrezept(s);
  assert.ok(r, 'Testrezept muss gültig sein');
  const teig = r.teig;
  const text = rezeptAlsText(r, { katalog: alleZutaten(s), teig, mehl: 1000 });
  const lines = text.split('\n');
  assert.equal(lines[0], '*Brot*');
  assert.equal(lines[1], 'Mehl 1.000 g');
  assert.ok(text.includes('• 1.000 g Weizen 550'));
  assert.ok(text.includes('• 650 g Wasser'));
  assert.ok(text.includes('• 20 g Salz'));
  assert.ok(text.includes('• 200 g Olive'), 'weitere Zutaten skalieren mit dem Mehl');
  assert.ok(text.includes('   Dazu: 1.000 g Weizen 550, 585 g Wasser, 20 g Salz'));
  assert.ok(text.includes('   Dazu: 65 g Wasser, 200 g Olive'));
  assert.ok(text.includes('   Gerät: Ofen 230 °C'));
  assert.ok(text.includes('Geräte: Ofen 230 °C'));
  assert.equal(r.mehl, 500, 'gespeichertes Mehl bleibt unberührt');
});

test('Backen mit Teiglingen: Anzahl × Gewicht, das Mehl folgt daraus (mit Verlust)', () => {
  const s = neuerSpeicher();
  const r = backrezept(s, { modus: 'teiglinge', teiglinge: { anzahl: 8, gewicht: 85, verlust: 2 } });
  const text = rezeptAlsText(r, {
    katalog: alleZutaten(s), teig: r.teig, mehl: 500, teiglinge: { anzahl: 4, gewicht: 250, verlust: 0 },
  });
  const kopf = text.split('\n')[1];
  assert.match(kopf, /^4 × 250 g \(Mehl [\d.]+ g\)$/);
  // 1000 g Teig; Teig LEERER_TEIG: 100 + 65 + 2 = 167 % → Mehl ≈ 599 g
  assert.match(kopf, /Mehl 599 g/);
});

test('Backen: kleine Hefemenge mit Nachkommastelle, Teile die der Teig nicht hat fehlen', () => {
  const s = neuerSpeicher();
  const teig = { ...structuredClone(LEERER_TEIG), hefe: 0.4, hefeArt: 'frisch', starter: 0, oel: 0 };
  const r = backrezept(s, { teig, schrittteig: undefined });
  const text = rezeptAlsText(r, { katalog: alleZutaten(s), teig, mehl: 500 });
  assert.ok(text.includes('• 2 g Frischhefe'));
  const kleiner = rezeptAlsText(r, { katalog: alleZutaten(s), teig: { ...teig, hefe: 0.25 }, mehl: 500 });
  assert.ok(kleiner.includes('• 1,3 g Frischhefe'));
  assert.ok(!text.includes('Starter'));
  assert.ok(!text.includes('Öl'));
});

test('Notiz-Schalter: pro Rezept, standardmäßig aus, nach dem Teilen wieder aus', async () => {
  assert.equal(notizMitteilen('a'), false);
  setzeNotizMitteilen('a', true);
  assert.equal(notizMitteilen('a'), true);
  assert.equal(notizMitteilen('b'), false);
  assert.match(teilenHtml({ id: 'a' }, 'k'), /data-kteilennotiz\s+checked/);
  assert.ok(!/checked/.test(teilenHtml({ id: 'b' }, 'k')));
  assert.match(teilenHtml({ id: 'b' }, 'b'), /data-bteilen>Rezept teilen</);

  const schalter = { checked: true };
  const knopf = {
    textContent: 'Rezept teilen', isConnected: true,
    closest: () => ({ querySelector: () => schalter }),
  };
  await mitNavigator({ share: async () => {} }, async () => {
    assert.equal(await teileAusKnopf(knopf, { id: 'a', name: 'X' }, 'Text'), 'geteilt');
  });
  assert.equal(notizMitteilen('a'), false);
  assert.equal(schalter.checked, false);
});

// ---------- Teilen-Menü ----------

async function mitNavigator(nav, f) {
  const alt = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  try { await f(); } finally {
    if (alt) Object.defineProperty(globalThis, 'navigator', alt);
    else delete globalThis.navigator;
  }
}

test('Teilen: Text und Titel gehen ans Teilen-Menü, Schließen des Menüs ist keine Störung', async () => {
  const gesehen = [];
  await mitNavigator({ share: async (d) => { gesehen.push(d); } }, async () => {
    assert.equal(await teileText('Hallo', 'Brot'), 'geteilt');
  });
  assert.deepEqual(gesehen, [{ title: 'Brot', text: 'Hallo' }]);
  await mitNavigator({ share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }, async () => {
    assert.equal(await teileText('Hallo', 'Brot'), 'abgebrochen');
  });
});

test('Teilen: ohne Teilen-Menü (oder wenn es scheitert) in die Zwischenablage, sonst still', async () => {
  let kopiert = null;
  const clipboard = { writeText: async (t) => { kopiert = t; } };
  await mitNavigator({ clipboard }, async () => assert.equal(await teileText('A', 'T'), 'kopiert'));
  assert.equal(kopiert, 'A');
  await mitNavigator({ share: async () => { throw new Error('kaputt'); }, clipboard }, async () => {
    assert.equal(await teileText('B', 'T'), 'kopiert');
  });
  assert.equal(kopiert, 'B');
  await mitNavigator({}, async () => assert.equal(await teileText('C', 'T'), 'fehler'));
});
