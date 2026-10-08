// Tests: Backplan rückwärts (Zeiten aus den Schritttexten, rückwärts und „Ab jetzt“, Nacht, Starter, Ofen).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { schrittDauer, dauerVon } from '../js/rezepte/zeit.js';
import { berechneBackplan, backplanListeHtml, backplanKlappeHtml } from '../js/rezepte/backplan.js';
import { BACK_REZEPTE } from '../js/rezepte/umzug.js';
import { LEERER_TEIG } from '../js/teig/vorlagen.js';

// Ortszeit, damit die Tests in jeder Zeitzone gleich laufen
const d = (m, t, h, min = 0) => new Date(2026, m - 1, t, h, min);
const hm = (x) => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
const plan = (zeilen) => zeilen.map((z) => `${hm(z.zeit)} ${z.art}`);

const rezept = (schritte, extra = {}) => ({
  schritte: schritte.map((s) => (Array.isArray(s) ? s[0] : s)),
  schrittgeraete: schritte.map((s) => (Array.isArray(s) ? s[1] : '')),
  ...extra,
});

test('Zeiten: feste Angaben, Spannen, Summen, Sonderwörter', () => {
  assert.deepEqual(dauerVon('20 Min.'), { min: 20, max: 20 });
  assert.deepEqual(dauerVon('2–3 Std.'), { min: 120, max: 180 });
  assert.deepEqual(dauerVon('1,5 Stunden'), { min: 90, max: 90 });
  assert.deepEqual(dauerVon('1 Stunde 30 Minuten'), { min: 90, max: 90 });
  assert.deepEqual(dauerVon('8 bis 10 Minuten'), { min: 8, max: 10 });
  assert.deepEqual(dauerVon('Eine halbe Stunde'), { min: 30, max: 30 });
  assert.deepEqual(dauerVon('über Nacht'), { nacht: true });
  assert.deepEqual(dauerVon('3 Tage'), { min: 4320, max: 4320 });
});

test('Schritt mit mehreren Zeiten: die längste zählt, „über Nacht“ gewinnt, ohne Zeit = null', () => {
  assert.deepEqual(schrittDauer('Stockgare ca. 3 Std. bei 24–26 °C, nach 30, 60 und 90 Min. dehnen'), { min: 180, max: 180 });
  assert.deepEqual(schrittDauer('Über Nacht im Kühlschrank, vor dem Backen 1 Std. wärmen'), { nacht: true });
  assert.equal(schrittDauer('Salz einarbeiten. Ofen auf 240 °C'), null);
});

test('rückwärts: Schritte hintereinander, Spanne = Mitte, Schritt ohne Zeit = 5 Min.', () => {
  const r = rezept(['Mischen, 30 Min. ruhen.', 'Falten.', ['Backen, 40–50 Min.', 'Ofen 220 °C']]);
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9), starter: false });
  // Backen 45 Min. (17:15), Falten 5 Min. (17:10), Mischen 30 Min. (16:40), Ofen 45 Min. vor dem Backen (16:30)
  assert.deepEqual(plan(p.zeilen), ['16:30 ofen', '16:40 schritt', '17:10 schritt', '17:15 schritt', '18:00 fertig']);
  assert.match(p.zeilen[3].dauer, /^ca\. 45 Min\.$/);
  assert.match(p.zeilen[2].dauer, /angenommen/);
  assert.equal(p.zuSpaet, false);
});

test('Ofen vorheizen: nicht doppelt, wenn ein Schritt es schon sagt; nicht bei Ofen unter 150 °C', () => {
  const mit = rezept(['Ofen mit Topf vorheizen.', ['Backen, 30 Min.', 'Ofen 230 °C']]);
  const p1 = berechneBackplan(mit, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9) });
  assert.ok(!p1.zeilen.some((z) => z.art === 'ofen'));
  const warm = rezept([['Gare im Ofen, 1 Std.', 'Ofen 30 °C'], ['Backen, 30 Min.', 'Ofen 230 °C']]);
  const p2 = berechneBackplan(warm, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9) });
  assert.equal(hm(p2.zeilen.find((z) => z.art === 'ofen').zeit), '16:45');
});

test('Schritte nach dem Backen (auskühlen) sind nur ein Hinweis, „Fertig“ = Ende des Back-Schritts', () => {
  const r = rezept([['Backen, 30 Min.', 'Ofen 230 °C'], 'Mindestens 1 Std. auskühlen lassen.']);
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9) });
  assert.deepEqual(plan(p.zeilen), ['16:45 ofen', '17:30 schritt', '18:00 fertig']);
  assert.deepEqual(p.danach, ['Mindestens 1 Std. auskühlen lassen.']);
});

test('Nacht: Fenster zwischen „abends“ und morgens, davor wird ab dem Abend gerechnet', () => {
  const r = rezept(['Teig mischen, 20 Min. ruhen.', 'Über Nacht im Kühlschrank.', 'Formen, 1 Std. gehen lassen.',
    ['Backen, 40 Min.', 'Ofen 230 °C']]);
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 12), jetzt: d(10, 8, 9), abend: '21:30' });
  // Backen 11:20, Formen 10:20, Nacht endet 10:20; Abend ≤ 02:20 → 21:30 am 9.10. (= 12:50 Std.), Mischen 21:10
  const z = Object.fromEntries(p.zeilen.filter((x) => x.art !== 'ofen').map((x) => [x.schritt + x.art, hm(x.zeit)]));
  assert.equal(z['0schritt'], '21:10');
  assert.equal(z['1nacht'], '21:30');
  assert.equal(z['2schritt'], '10:20');
  assert.equal(z['3schritt'], '11:20');
  assert.equal(p.zeilen.find((x) => x.art === 'nacht').zeit.getDate(), 9);
  assert.equal(p.zeilen.find((x) => x.art === 'nacht').dauer, '13 Std.');
  assert.equal(p.hinweise.length, 0);
});

test('Nacht länger als 14 Std.: ruhiger Hinweis, trotzdem ein Plan; im Fenster kein Hinweis', () => {
  const r = rezept(['Über Nacht im Kühlschrank.', ['Backen, 40 Min.', 'Ofen 230 °C']]);
  // Nacht endet 17:20, der Abend liegt mindestens 8 Std. davor: 21:30 am Vortag = 19 Std. 50 Min.
  const lang = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9), abend: '21:30' });
  assert.match(lang.hinweise[0], /Später in den Kühlschrank/);
  assert.match(lang.hinweise[0], /20 Std\./);
  assert.ok(lang.zeilen.length >= 3);
  const ok = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 8), jetzt: d(10, 8, 9), abend: '21:30' });
  assert.equal(ok.hinweise.length, 0); // Nacht endet 07:20, Abend 21:30 → 9 Std. 50 Min.
});

test('Nacht ohne gültige Abend-Zeit: feste 10 Std.', () => {
  const r = rezept(['Über Nacht im Kühlschrank.', ['Backen, 40 Min.', 'Ofen 230 °C']]);
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 12), jetzt: d(10, 8, 9), abend: '' });
  assert.equal(hm(p.zeilen.find((x) => x.art === 'nacht').zeit), '01:20');
});

test('Starter auffrischen: Reifezeit vor dem ersten Schritt mit Starter', () => {
  const r = rezept(['Mehl und Wasser mischen, 30 Min. ruhen.', 'Starter einarbeiten, 10 Min. kneten.',
    ['Backen, 40 Min.', 'Ofen 230 °C']], { schrittteig: [[{ teil: 'mehl' }], [{ teil: 'starter' }], []] });
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9), starter: true, reifeStd: 6 });
  // Backen 17:20, Starter-Schritt 17:10, Mehl 16:40 → Starter muss 11:10 starten
  const s = p.zeilen.find((x) => x.art === 'starter');
  assert.equal(hm(s.zeit), '11:10');
  assert.equal(s.dauer, 'Reifezeit 6 Std.');
  assert.equal(p.zeilen[0].art, 'starter');
  // ohne Schalter keine Zeile; unsinnige Reifezeit → Vorgabe 6 Std.
  assert.ok(!berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9) }).zeilen.some((x) => x.art === 'starter'));
  const p0 = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9), starter: true, reifeStd: 0 });
  assert.equal(hm(p0.zeilen.find((x) => x.art === 'starter').zeit), '11:10');
  // Starter über Nacht (12 Std.)
  const n = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9), starter: true, reifeStd: 12 });
  assert.equal(hm(n.zeilen[0].zeit), '05:10');
});

test('Ab jetzt: vorwärts, Fertig-Zeit; Starter und Ofen schieben alles nach hinten', () => {
  const r = rezept(['Mischen, 30 Min. ruhen.', 'Starter einarbeiten.', ['Backen, 40 Min.', 'Ofen 230 °C']],
    { schrittteig: [[], [{ teil: 'starter' }], []] });
  const ohne = berechneBackplan(r, { modus: 'jetzt', jetzt: d(10, 8, 9, 2), starter: false });
  // 9:02 → aufgerundet 9:05; Mischen 9:05, Starter 9:35, Backen 9:40, fertig 10:20; Ofen 8:55 liegt davor → alles +10 Min.
  assert.deepEqual(plan(ohne.zeilen), ['09:05 ofen', '09:15 schritt', '09:45 schritt', '09:50 schritt', '10:30 fertig']);
  assert.equal(hm(ohne.fertig), '10:30');
  const mit = berechneBackplan(r, { modus: 'jetzt', jetzt: d(10, 8, 9, 0), starter: true, reifeStd: 6 });
  assert.equal(hm(mit.zeilen[0].zeit), '09:00');
  assert.equal(mit.zeilen[0].art, 'starter');
  // Der Starter braucht 6 Std. vor seinem Schritt (nach 30 Min. Mischen): alles beginnt 5:30 Std. später als ohne
  assert.equal(hm(mit.fertig), '15:45');
});

test('Ab jetzt mit Nacht: 10 Std. angenommen, mit „ca.“', () => {
  const r = rezept(['Über Nacht im Kühlschrank.', ['Backen, 30 Min.', 'Ofen 230 °C']]);
  const p = berechneBackplan(r, { modus: 'jetzt', jetzt: d(10, 8, 21, 0) });
  assert.equal(p.zeilen.find((x) => x.art === 'nacht').dauer, 'ca. 10 Std.');
  assert.equal(hm(p.fertig), '07:30'); // Ofen vorheizen schiebt nicht: 07:00 − 45 Min. liegt nach jetzt
});

test('Rückwärts in der Vergangenheit: Hinweis; ohne Datum oder Schritte: leer', () => {
  const r = rezept([['Backen, 30 Min.', 'Ofen 230 °C']]);
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 8, 9, 30), jetzt: d(10, 8, 9, 0) });
  assert.equal(p.zuSpaet, true);
  assert.match(p.hinweise.join(' '), /Vergangenheit/);
  assert.deepEqual(berechneBackplan(r, { modus: 'fertig', fertig: null, jetzt: d(10, 8, 9) }).zeilen, []);
  assert.deepEqual(berechneBackplan(rezept([]), { modus: 'jetzt', jetzt: d(10, 8, 9) }).zeilen, []);
});

test('Sommerzeit: Dauern sind echte Minuten, keine Uhrzeit-Verschiebung', () => {
  // 2026 endet die Sommerzeit am 25.10.: Die Nacht davor hat 25 Stunden. Nur Minuten rechnen, nie Uhrzeiten.
  const r = rezept(['Teig mischen, 1 Std. ruhen.', ['Backen, 30 Min.', 'Ofen 230 °C']]);
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 25, 4, 0), jetzt: d(10, 8, 9) });
  const schritt = p.zeilen.filter((z) => z.art === 'schritt');
  assert.equal(p.zeilen.at(-1).zeit - schritt[1].zeit, 30 * 60_000);
  assert.equal(schritt[1].zeit - schritt[0].zeit, 60 * 60_000);
});

test('Eingebautes Brot: Quellzeit, Gare, Backen mit Ofen vorheizen', () => {
  const brot = BACK_REZEPTE.find((e) => e.vorlage === 'weizenvollkorn');
  const r = {
    schritte: brot.schritte.map((s) => s[0]),
    schrittgeraete: brot.schritte.map((s) => s[1]),
    schrittteig: brot.schritte.map((s) => s[2] ?? []),
  };
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 18), jetzt: d(10, 8, 9), starter: true, reifeStd: 6 });
  // Ende: 15 Min. + 37,5 → 40 (Mitte 37,5 → 40 gerundet auf 5) Min. = 55 Min. Backen, davor Formen 5, Gare 180, …
  assert.equal(hm(p.fertig), '18:00');
  assert.equal(p.zeilen.filter((z) => z.art === 'schritt').length, 9);
  assert.ok(p.zeilen.some((z) => z.art === 'ofen'));
  const zeiten = p.zeilen.map((z) => z.zeit.getTime());
  assert.deepEqual(zeiten, [...zeiten].sort((a, b) => a - b), 'Liste ist nach Zeit geordnet');
});

test('Oberfläche: Liste maskiert Texte, Tageswechsel als Überschrift, Klappe zeigt nur passende Felder', () => {
  const r = rezept(['<b>Mischen</b>, 30 Min. ruhen.', ['Backen, 30 Min.', 'Ofen 230 °C']]);
  const p = berechneBackplan(r, { modus: 'fertig', fertig: d(10, 10, 0, 10), jetzt: d(10, 8, 9) });
  const html = backplanListeHtml(p, 'fertig');
  assert.ok(!html.includes('<b>Mischen'));
  assert.match(html, /&lt;b&gt;Mischen/);
  assert.equal((html.match(/class="bp-tag"/g) ?? []).length, 2); // 9.10. und 10.10.
  const jetzt = backplanListeHtml(berechneBackplan(r, { modus: 'jetzt', jetzt: d(10, 8, 9) }), 'jetzt');
  assert.match(jetzt, /Fertig am/);

  const teig = { ...structuredClone(LEERER_TEIG), starter: 0 };
  const klappe = backplanKlappeHtml({ ...r, id: 'x' }, teig, true);
  assert.match(klappe, /data-klappe="backplan"/);
  assert.match(klappe, /open/);
  assert.ok(!klappe.includes('Starter vorher auffrischen'), 'ohne Starter im Teig kein Schalter');
  assert.ok(!klappe.includes('Abends in den Kühlschrank'), 'ohne Nachtschritt kein Abend-Feld');
  const mitStarter = backplanKlappeHtml(r, { ...teig, starter: 20 });
  assert.match(mitStarter, /Starter vorher auffrischen/);
  assert.equal(backplanKlappeHtml(rezept([]), teig), '');
});
