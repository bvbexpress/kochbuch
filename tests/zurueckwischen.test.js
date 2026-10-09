// Tests für „Zurück per Wischen“: Entscheidung und Ablauf mit nachgebauten Touch-Ereignissen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gilt, amRand, RAND, startZurueckwischen } from '../js/kern/zurueckwischen.js';

test('gilt: weit genug nach rechts, oder kurz und schnell', () => {
  assert.equal(gilt({ dx: 80, dy: 5, dauer: 600 }), true);
  assert.equal(gilt({ dx: 40, dy: 5, dauer: 150 }), true);
  assert.equal(gilt({ dx: 40, dy: 5, dauer: 600 }), false); // zu kurz und langsam
  assert.equal(gilt({ dx: 10, dy: 0, dauer: 50 }), false);
});

test('gilt: nach links oder schräg zählt nicht', () => {
  assert.equal(gilt({ dx: -90, dy: 0, dauer: 100 }), false);
  assert.equal(gilt({ dx: 80, dy: 70, dauer: 100 }), false);
});

test('amRand: nur der äußerste Streifen links', () => {
  assert.equal(amRand(0), true);
  assert.equal(amRand(RAND), true);
  assert.equal(amRand(RAND + 1), false);
  assert.equal(amRand(200), false);
});

/** Nachgebaute Seite: sammelt die Zuhörer, hat einen (oder keinen) Zurück-Pfeil. */
function aufbau({ pfeil = true, wenig = false } = {}) {
  const zuhoerer = {};
  const ziel = { addEventListener: (art, f) => { zuhoerer[art] = f; } };
  const knopf = { klicks: 0, disabled: false, closest: () => null, click() { this.klicks += 1; } };
  const wurzel = { style: {}, querySelectorAll: () => (pfeil ? [knopf] : []) };
  startZurueckwischen(wurzel, { ziel, wenigerBewegung: () => wenig });
  const ereignis = (x, y, t, extra = {}) => ({
    touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }],
    target: { closest: () => null }, timeStamp: t, cancelable: true, verhindert: false,
    preventDefault() { this.verhindert = true; }, ...extra,
  });
  function wische(punkte, extra) {
    const [erster, ...rest] = punkte;
    zuhoerer.touchstart(ereignis(erster[0], erster[1], 0, extra));
    let letztes;
    rest.forEach(([x, y], i) => { letztes = ereignis(x, y, (i + 1) * 100); zuhoerer.touchmove(letztes); });
    const [x, y] = punkte.at(-1);
    zuhoerer.touchend(ereignis(x, y, rest.length * 100, { type: 'touchend' }));
    return letztes;
  }
  return { wische, knopf, wurzel, zuhoerer, ereignis };
}

test('Wischen vom Rand nach rechts tippt den Zurück-Pfeil an und die Seite geht zurück an ihren Platz', () => {
  const s = aufbau();
  const bewegung = s.wische([[5, 300], [40, 305], [100, 310]]);
  assert.equal(s.knopf.klicks, 1);
  assert.equal(bewegung.verhindert, true);
  assert.equal(s.wurzel.style.transform, '');
});

test('Während des Wischens folgt die Seite dem Finger, aber nur ein Stück', () => {
  const s = aufbau();
  s.zuhoerer.touchstart(s.ereignis(5, 300, 0));
  s.zuhoerer.touchmove(s.ereignis(35, 300, 50));
  assert.equal(s.wurzel.style.transform, 'translateX(18px)');
  s.zuhoerer.touchmove(s.ereignis(400, 300, 100));
  assert.equal(s.wurzel.style.transform, `translateX(${72 * 0.6}px)`);
});

test('Bei „Bewegung reduzieren“ bewegt sich die Seite nicht, zurück geht trotzdem', () => {
  const s = aufbau({ wenig: true });
  s.wische([[5, 300], [60, 300], [120, 300]]);
  assert.equal(s.wurzel.style.transform, undefined);
  assert.equal(s.knopf.klicks, 1);
});

test('Start nicht am Rand: nichts passiert', () => {
  const s = aufbau();
  s.wische([[120, 300], [180, 300], [260, 300]]);
  assert.equal(s.knopf.klicks, 0);
});

test('Start in einem Eingabefeld: nichts passiert', () => {
  const s = aufbau();
  s.wische([[5, 300], [60, 300], [120, 300]], { target: { closest: () => ({}) } });
  assert.equal(s.knopf.klicks, 0);
});

test('Ohne Zurück-Pfeil (Startseite): nichts passiert, nichts bewegt sich', () => {
  const s = aufbau({ pfeil: false });
  s.wische([[5, 300], [60, 300], [120, 300]]);
  assert.equal(s.knopf.klicks, 0);
  assert.equal(s.wurzel.style.transform, undefined);
});

test('Senkrechtes Scrollen vom Rand aus: kein Zurück, keine Bewegung, Scrollen wird nicht blockiert', () => {
  const s = aufbau();
  const letztes = s.wische([[5, 300], [8, 340], [60, 420]]);
  assert.equal(s.knopf.klicks, 0);
  assert.equal(letztes.verhindert, false);
  assert.equal(s.wurzel.style.transform, undefined);
});

test('Zu kurz gewischt (langsam): Seite federt zurück, kein Zurück', () => {
  const s = aufbau();
  s.wische([[5, 300], [15, 300], [25, 300], [35, 300], [45, 300], [45, 300], [45, 300]]); // 600 ms
  assert.equal(s.knopf.klicks, 0);
  assert.equal(s.wurzel.style.transform, '');
});

test('Abbruch (touchcancel) löst kein Zurück aus', () => {
  const s = aufbau();
  s.zuhoerer.touchstart(s.ereignis(5, 300, 0));
  s.zuhoerer.touchmove(s.ereignis(100, 300, 100));
  s.zuhoerer.touchcancel(s.ereignis(100, 300, 120, { type: 'touchcancel' }));
  assert.equal(s.knopf.klicks, 0);
  assert.equal(s.wurzel.style.transform, '');
});
