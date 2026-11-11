// Tests: Timer je Schritt – Rechnung mit Endzeit, mehrere gleichzeitig, Überleben eines App-Neustarts,
// antippbare Zeiten im Schritttext. (Leiste, Ton und Blinken nur von Hand auf dem iPhone prüfbar.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { erstelleTimer, restText, timerDauerMs, leisteHtml } from '../js/kern/timer.js';
import { schrittTextHtml, schritteHtml } from '../js/rezepte/teile.js';

const MIN = 60_000;
const neu = (start = 1_000_000) => {
  const speicher = erstelleSpeicher(speicherImArbeitsspeicher());
  const uhr = { t: start };
  const timer = erstelleTimer({ speicher, jetzt: () => uhr.t });
  return { speicher, uhr, timer };
};

test('Restzeit als Minuten:Sekunden, ab einer Stunde mit Stunden', () => {
  assert.equal(restText(8 * MIN + 5_000), '8:05');
  assert.equal(restText(500), '0:01'); // aufgerundet
  assert.equal(restText(0), '0:00');
  assert.equal(restText(-5000), '0:00');
  assert.equal(restText(62 * MIN + 10_000), '1:02:10');
});

test('Dauer: nur sinnvolle Werte werden zum Timer', () => {
  assert.equal(timerDauerMs(8), 8 * MIN);
  assert.equal(timerDauerMs(0.5), 30_000);
  for (const falsch of [0, -1, NaN, undefined, Infinity, 24 * 60 + 1]) assert.equal(timerDauerMs(falsch), null);
  assert.equal(timerDauerMs(24 * 60), 24 * 60 * MIN);
});

test('Timer läuft über die Endzeit, nicht über einen Zähler', () => {
  const { timer, uhr } = neu();
  assert.equal(timer.starte({ id: 'a', label: 'Brot · Schritt 2', min: 8 }), true);
  assert.equal(timer.laeuft('a'), true);
  assert.equal(timer.liste()[0].rest, 8 * MIN);
  uhr.t += 3 * MIN; // z. B. App im Hintergrund
  assert.equal(timer.liste()[0].rest, 5 * MIN);
  assert.equal(timer.liste()[0].abgelaufen, false);
  uhr.t += 5 * MIN;
  const t = timer.liste()[0];
  assert.equal(t.abgelaufen, true);
  assert.equal(t.ende, 1_000_000 + 8 * MIN); // „abgelaufen seit“ stimmt auch nach langer Pause
  assert.equal(timer.laeuft('a'), false);
});

test('Mehrere Timer gleichzeitig; abgelaufene stehen zuerst', () => {
  const { timer, uhr } = neu();
  timer.starte({ id: 'lang', label: 'A', min: 30 });
  timer.starte({ id: 'kurz', label: 'B', min: 5 });
  timer.starte({ id: 'mittel', label: 'C', min: 10 });
  assert.deepEqual(timer.liste().map((t) => t.id), ['kurz', 'mittel', 'lang']);
  uhr.t += 6 * MIN;
  assert.deepEqual(timer.liste().map((t) => [t.id, t.abgelaufen]), [['kurz', true], ['mittel', false], ['lang', false]]);
});

test('Dieselbe Zeit nochmal antippen: läuft schon = nichts passiert, abgelaufen = neu gestartet', () => {
  const { timer, uhr } = neu();
  assert.equal(timer.starte({ id: 'a', label: 'x', min: 5 }), true);
  uhr.t += MIN;
  assert.equal(timer.starte({ id: 'a', label: 'x', min: 5 }), false);
  assert.equal(timer.liste()[0].rest, 4 * MIN); // nicht neu gestartet, nicht gestoppt
  uhr.t += 10 * MIN;
  assert.equal(timer.starte({ id: 'a', label: 'x', min: 5 }), true);
  assert.equal(timer.liste().length, 1);
  assert.equal(timer.liste()[0].abgelaufen, false);
});

test('Beenden entfernt den Timer (laufend oder abgelaufen); unbekannte id schadet nicht', () => {
  const { timer, uhr } = neu();
  timer.starte({ id: 'a', label: 'x', min: 1 });
  timer.starte({ id: 'b', label: 'y', min: 5 });
  uhr.t += 2 * MIN;
  timer.beende('a');
  timer.beende('gibt-es-nicht');
  assert.deepEqual(timer.liste().map((t) => t.id), ['b']);
  timer.beende('b');
  assert.deepEqual(timer.liste(), []);
});

test('Unsinnige Eingaben starten nichts', () => {
  const { timer } = neu();
  assert.equal(timer.starte({ id: '', label: 'x', min: 5 }), false);
  assert.equal(timer.starte({ id: 'a', label: 'x', min: 0 }), false);
  assert.equal(timer.starte({ id: 'a', label: 'x', min: 'abc' }), false);
  assert.equal(timer.starte({ id: 'a', label: 'x', min: 2000 }), false);
  assert.deepEqual(timer.liste(), []);
});

test('Nach einem Neustart der App sind die Timer noch da (Geräte-Einstellung), abgelaufene auch', () => {
  const { speicher, uhr, timer } = neu();
  timer.starte({ id: 'a', label: 'Brot · Schritt 2', min: 5 });
  timer.starte({ id: 'b', label: 'Brot · Schritt 4', min: 60 });
  uhr.t += 20 * MIN; // App war weg
  const nachNeustart = erstelleTimer({ speicher, jetzt: () => uhr.t });
  assert.deepEqual(nachNeustart.liste().map((t) => [t.id, t.abgelaufen]), [['a', true], ['b', false]]);
  assert.equal(nachNeustart.liste()[0].label, 'Brot · Schritt 2');
});

test('Kaputt gespeicherte Timer werden ignoriert (App hängt nie an kaputten Daten)', () => {
  const speicher = erstelleSpeicher(speicherImArbeitsspeicher());
  speicher.setzeEinstellung('timer', [null, 5, { id: 'x' }, { id: 'ok', label: 'L', ende: 5 }, { id: 'n', label: 'L', ende: 'bald' }]);
  assert.deepEqual(erstelleTimer({ speicher, jetzt: () => 10 }).liste().map((t) => t.id), ['ok']);
  speicher.setzeEinstellung('timer', 'unsinn');
  assert.deepEqual(erstelleTimer({ speicher }).liste(), []);
});

test('Höchstens 20 Timer', () => {
  const { timer } = neu();
  for (let i = 0; i < 20; i++) assert.equal(timer.starte({ id: `t${i}`, label: 'x', min: 5 }), true);
  assert.equal(timer.starte({ id: 'zu-viel', label: 'x', min: 5 }), false);
});

test('Änderungen werden gemeldet', () => {
  const { timer } = neu();
  let n = 0;
  timer.beiAenderung(() => n++);
  timer.starte({ id: 'a', label: 'x', min: 5 });
  timer.starte({ id: 'a', label: 'x', min: 5 }); // läuft schon: keine Änderung
  timer.beende('a');
  assert.equal(n, 2);
});

test('Leiste: laufend mit Restzeit und Stopp, abgelaufen als ganze Zeile mit „seit“; Namen maskiert', () => {
  const html = leisteHtml([
    { id: 'a', label: '<b>Brot</b> · Schritt 2', rest: 3 * MIN, abgelaufen: false, ende: 0 },
    { id: 'b', label: 'Suppe · Schritt 1', rest: -1, abgelaufen: true, ende: Date.UTC(2026, 0, 1, 12, 0) },
  ]);
  assert.match(html, /3:00/);
  assert.match(html, /data-timer-weg="a"/);
  assert.match(html, /&lt;b&gt;Brot/);
  assert.doesNotMatch(html, /<b>Brot/);
  assert.match(html, /timer-fertig/);
  assert.match(html, /Abgelaufen · seit \d\d:\d\d/);
  assert.equal(leisteHtml([]), '');
});

// ---------- antippbare Zeiten ----------

const rezept = { id: 'r1', name: 'Brot', schritte: [] };
const timerDaten = (html) => [...html.matchAll(/<span class="zeit"([^>]*)>(.*?)<\/span>/g)].map((m) => ({
  text: m[2],
  min: /data-timer-min="([^"]*)"/.exec(m[1])?.[1] ?? null,
  id: /data-timer-id="([^"]*)"/.exec(m[1])?.[1] ?? null,
  label: /data-timer-label="([^"]*)"/.exec(m[1])?.[1] ?? null,
}));
const mitTimer = (t) => timerDaten(schrittTextHtml(t, { id: 'r1', nr: 3, name: 'Brot' }));

test('Zeit im Schritt startet einen Timer; bei Spannen die untere Zahl', () => {
  const [z] = mitTimer('Backen, 8–10 Min. bis goldbraun.');
  assert.equal(z.text, '8–10 Min.');
  assert.equal(z.min, '8');
  assert.equal(z.label, 'Brot · Schritt 3');
  assert.match(z.id, /^r1\|3\|/);
  assert.equal(mitTimer('1,5 Std. ruhen')[0].min, '90');
  assert.equal(mitTimer('1 Stunde 30 Minuten ruhen')[0].min, '90');
  assert.equal(mitTimer('20 Sekunden rühren')[0].min, String(20 / 60));
  assert.equal(mitTimer('Eine halbe Stunde ziehen lassen')[0].min, '30');
});

test('„Über Nacht“ und Zeiten über einem Tag sind nicht antippbar (bleiben hervorgehoben)', () => {
  assert.deepEqual(mitTimer('Über Nacht im Kühlschrank ruhen.'), [{ text: 'Über Nacht', min: null, id: null, label: null }]);
  assert.equal(mitTimer('3 Tage reifen lassen')[0].id, null);
});

test('Mehrere Zeiten in einem Schritt haben verschiedene Timer-ids', () => {
  const zeiten = mitTimer('5 Min. anbraten, dann 10 Min. köcheln.');
  assert.equal(zeiten.length, 2);
  assert.notEqual(zeiten[0].id, zeiten[1].id);
});

test('Ohne Timer-Angabe (Backplan) bleibt die Zeit nur hervorgehoben', () => {
  assert.equal(schrittTextHtml('12 Min. backen'), '<span class="zeit">12 Min.</span> backen');
});

test('Schritte im Rezept bekommen Rezept-id, Nummer und Namen für den Timer; Name maskiert', () => {
  const html = schritteHtml({ ...rezept, name: 'A & "B"', schritte: ['Zwiebel würfeln', '12 Min. backen'] }, { haken: new Set(), p: 'k' });
  assert.match(html, /data-timer-id="r1\|2\|0"/);
  assert.match(html, /data-timer-label="A &amp; &quot;B&quot; · Schritt 2"/);
  assert.equal((html.match(/data-timer-id/g) ?? []).length, 1);
});
