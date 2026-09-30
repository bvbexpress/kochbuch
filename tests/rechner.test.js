// Tests für die Rechenlogik. Ausführen mit: npm test  (oder: node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  berechne,
  teigAusGramm,
  mehlAusTeiglingen,
  hefeUmrechnen,
  auffrischen,
} from '../js/teig/rechner.js';
import { leseZahl, formatGramm, formatGrammFein, formatProzent } from '../js/kern/zahlen.js';

// Vergleich mit kleiner Toleranz, weil Kommazahlen im Computer nie ganz exakt sind
function ungefaehr(ist, soll, text) {
  assert.ok(Math.abs(ist - soll) < 1e-9, `${text ?? ''} erwartet ${soll}, erhalten ${ist}`);
}

const focaccia = {
  mehlsorten: [{ name: 'Tipo 00', gramm: 300 }],
  starter: 50,
  wasser: 225,
  salz: 7,
  oel: 15,
};

const vollkornbrot = {
  mehlsorten: [{ name: 'Weizenvollkorn', gramm: 500 }],
  starter: 100,
  wasser: 400,
  salz: 11,
  saaten: [
    { name: 'Sonnenblumenkerne', gramm: 50 },
    { name: 'Leinsamen', gramm: 25 },
  ],
  quellwasser: 80,
};

// ---------- Vorlage in Prozent umrechnen ----------

test('Focaccia: Prozente beziehen sich auf Gesamtmehl inkl. Starter', () => {
  const { teig, gesamtmehl } = teigAusGramm(focaccia);
  assert.equal(gesamtmehl, 325);
  ungefaehr(teig.hydration, (250 / 325) * 100, 'Hydration');
  assert.equal(teig.hydration.toFixed(1), '76.9');
  ungefaehr(teig.starter, (50 / 325) * 100, 'Starter');
  ungefaehr(teig.salz, (7 / 325) * 100, 'Salz');
  ungefaehr(teig.oel, (15 / 325) * 100, 'Öl');
  assert.deepEqual(teig.mehlsorten, [{ name: 'Tipo 00', anteil: 100 }]);
});

test('Focaccia: zurückgerechnet ergeben sich exakt die Originalmengen', () => {
  const { teig, gesamtmehl } = teigAusGramm(focaccia);
  const e = berechne(teig, gesamtmehl);
  ungefaehr(e.mehl, 300, 'Mehl');
  ungefaehr(e.mehlsorten[0].gramm, 300, 'Tipo 00');
  ungefaehr(e.wasser, 225, 'Wasser');
  ungefaehr(e.starter, 50, 'Starter');
  ungefaehr(e.salz, 7, 'Salz');
  ungefaehr(e.oel, 15, 'Öl');
  ungefaehr(e.teigGesamt, 597, 'Teig gesamt');
  assert.deepEqual(e.hinweise, []);
});

test('Vollkornbrot mit Quellstück: zurückgerechnet exakt', () => {
  const { teig, gesamtmehl } = teigAusGramm(vollkornbrot);
  assert.equal(gesamtmehl, 550);
  ungefaehr(teig.quellwasser, (80 / 75) * 100, 'Quellwasser in % der Saaten');

  const e = berechne(teig, gesamtmehl);
  ungefaehr(e.mehl, 500);
  ungefaehr(e.wasser, 400);
  ungefaehr(e.starter, 100);
  ungefaehr(e.salz, 11);
  ungefaehr(e.saaten[0].gramm, 50, 'Sonnenblumenkerne');
  ungefaehr(e.saaten[1].gramm, 25, 'Leinsamen');
  ungefaehr(e.quellwasser, 80);
  ungefaehr(e.teigGesamt, 500 + 100 + 400 + 11 + 50 + 25 + 80);
});

test('Quellwasser zählt nicht zur Hydration', () => {
  const { teig } = teigAusGramm(vollkornbrot);
  ungefaehr(teig.hydration, (450 / 550) * 100);
});

// ---------- Skalieren ----------

test('Doppelte Mehlmenge ergibt doppelte Zutaten', () => {
  const { teig } = teigAusGramm(focaccia);
  const e = berechne(teig, 650);
  ungefaehr(e.mehl, 600);
  ungefaehr(e.wasser, 450);
  ungefaehr(e.starter, 100);
  ungefaehr(e.salz, 14);
});

test('Mehlmenge 0 ergibt überall 0', () => {
  const { teig } = teigAusGramm(focaccia);
  const e = berechne(teig, 0);
  assert.equal(e.teigGesamt, 0);
  assert.equal(e.wasser, 0);
});

// ---------- Mehlmischung ----------

test('Mehlmischung wird auf das zugegebene Mehl verteilt', () => {
  const teig = {
    hydration: 70, starter: 20, salz: 2, oel: 0, hefe: 0,
    mehlsorten: [
      { name: 'Tipo 00', anteil: 70 },
      { name: 'Dinkelvollkorn', anteil: 30 },
    ],
  };
  const e = berechne(teig, 1000);
  // Starter 200 g → 100 g Mehl darin, 900 g zugegebenes Mehl
  ungefaehr(e.mehl, 900);
  ungefaehr(e.mehlsorten[0].gramm, 630);
  ungefaehr(e.mehlsorten[1].gramm, 270);
  assert.deepEqual(e.hinweise, []);
});

test('Mehlanteile ungleich 100 %: im Verhältnis verteilt, mit Hinweis', () => {
  const teig = {
    hydration: 70, starter: 0, salz: 2, oel: 0, hefe: 0,
    mehlsorten: [
      { name: 'A', anteil: 60 },
      { name: 'B', anteil: 60 },
    ],
  };
  const e = berechne(teig, 1000);
  ungefaehr(e.mehlsorten[0].gramm, 500);
  ungefaehr(e.mehlsorten[1].gramm, 500);
  assert.ok(e.hinweise.includes('mehlanteile-nicht-100'));
});

// ---------- Unmögliche Eingaben ----------

test('Mehr Starter als möglich: Hinweis statt negativer Mengen', () => {
  const teig = { hydration: 100, starter: 250, salz: 2, oel: 0, hefe: 0, mehlsorten: [] };
  const e = berechne(teig, 100);
  assert.ok(e.hinweise.includes('starter-zu-viel'));
  assert.equal(e.mehl, 0);
});

test('Hydration niedriger als Wasser im Starter: Hinweis', () => {
  const teig = { hydration: 5, starter: 20, salz: 2, oel: 0, hefe: 0, mehlsorten: [] };
  const e = berechne(teig, 1000);
  assert.ok(e.hinweise.includes('hydration-zu-niedrig'));
  assert.equal(e.wasser, 0);
});

// ---------- Teiglinge ----------

test('Teiglinge: 4 Pizzen à 250 g ergeben genau 1000 g Teig', () => {
  const teig = { hydration: 65, starter: 0, salz: 2.5, oel: 0, hefe: 0.2, mehlsorten: [] };
  const mehl = mehlAusTeiglingen(teig, 4, 250);
  ungefaehr(mehl, 1000 / 1.677);
  ungefaehr(berechne(teig, mehl).teigGesamt, 1000);
});

test('Teiglinge mit Starter und Quellstück: Gesamtgewicht stimmt', () => {
  const { teig } = teigAusGramm(vollkornbrot);
  const mehl = mehlAusTeiglingen(teig, 2, 900);
  ungefaehr(berechne(teig, mehl).teigGesamt, 1800);
});

test('Teiglinge: Anzahl 0 ergibt 0 g Mehl', () => {
  const { teig } = teigAusGramm(focaccia);
  assert.equal(mehlAusTeiglingen(teig, 0, 85), 0);
});

// ---------- Hefe ----------

test('Hefe umrechnen: frisch ↔ trocken (Faktor 3)', () => {
  ungefaehr(hefeUmrechnen(3, 'frisch', 'trocken'), 1);
  ungefaehr(hefeUmrechnen(1, 'trocken', 'frisch'), 3);
  assert.equal(hefeUmrechnen(2, 'frisch', 'frisch'), 2);
});

// ---------- Starter-Auffrischung ----------

test('Auffrischen 1:1:1', () => {
  const a = auffrischen(100, 50, [1, 1, 1]);
  ungefaehr(a.anstellgut, 50);
  ungefaehr(a.mehl, 50);
  ungefaehr(a.wasser, 50);
  ungefaehr(a.hydration, 100);
});

test('Auffrischen mit Kommaverhältnis 1:1,5:1,5', () => {
  const a = auffrischen(100, 60, [1, 1.5, 1.5]);
  ungefaehr(a.gesamt, 160);
  ungefaehr(a.anstellgut, 40);
  ungefaehr(a.mehl, 60);
  ungefaehr(a.wasser, 60);
});

test('Auffrischen 1:2,5:2,5', () => {
  const a = auffrischen(100, 20, [1, 2.5, 2.5]);
  ungefaehr(a.anstellgut, 20);
  ungefaehr(a.mehl, 50);
  ungefaehr(a.wasser, 50);
});

test('Auffrischen mit ungleichem Mehl/Wasser meldet die Hydration', () => {
  const a = auffrischen(100, 0, [1, 2, 1]);
  // Mehl: 0,5 + 2 = 2,5 Teile, Wasser: 0,5 + 1 = 1,5 Teile → 60 %
  ungefaehr(a.hydration, 60);
});

test('Auffrischen ohne Bedarf ergibt 0', () => {
  assert.equal(auffrischen(0, 0, [1, 1, 1]).anstellgut, 0);
});

// ---------- Zahlen einlesen und anzeigen ----------

test('leseZahl versteht Komma und Punkt', () => {
  assert.equal(leseZahl('1,5'), 1.5);
  assert.equal(leseZahl('1.5'), 1.5);
  assert.equal(leseZahl(' 300 '), 300);
  assert.equal(leseZahl(''), 0);
  assert.equal(leseZahl('abc'), 0);
  assert.equal(leseZahl('-5'), 0);
});

test('Formatierung: ganze Gramm, deutsche Schreibweise', () => {
  assert.equal(formatGramm(224.6), '225');
  assert.equal(formatGramm(1234.4), '1.234');
  assert.equal(formatGrammFein(0.84), '0,8');
  assert.equal(formatProzent(76.923), '76,9');
  assert.equal(formatProzent(0.254), '0,25');
});
