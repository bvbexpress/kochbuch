// Tests: Zeitangaben im Schritttext hervorheben (nur Anzeige, Text bleibt gespeichert wie er ist).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { schrittTextHtml, schritteHtml } from '../js/rezepte/teile.js';

const z = (t) => [...schrittTextHtml(t).matchAll(/<span class="zeit">(.*?)<\/span>/g)].map((m) => m[1]);

test('übliche Zeitangaben werden gefunden', () => {
  assert.deepEqual(z('Backen, 8–10 Min. bis goldbraun.'), ['8–10 Min.']);
  assert.deepEqual(z('3 Std. gehen lassen'), ['3 Std.']);
  assert.deepEqual(z('Über Nacht im Kühlschrank ruhen.'), ['Über Nacht']);
  assert.deepEqual(z('1,5 Stunden kochen'), ['1,5 Stunden']);
  assert.deepEqual(z('20 Sekunden rühren'), ['20 Sekunden']);
  assert.deepEqual(z('2 h ruhen'), ['2 h']);
  assert.deepEqual(z('8 bis 10 Minuten braten'), ['8 bis 10 Minuten']);
  assert.deepEqual(z('3 Tage reifen lassen'), ['3 Tage']);
  assert.deepEqual(z('Eine halbe Stunde ziehen lassen'), ['Eine halbe Stunde']);
  assert.deepEqual(z('30-40 min backen'), ['30-40 min']);
});

test('mehrteilige Angaben bleiben zusammen, mehrere Angaben werden einzeln markiert', () => {
  assert.deepEqual(z('1 Stunde 30 Minuten backen'), ['1 Stunde 30 Minuten']);
  assert.deepEqual(z('Erst 5 Min. anbraten, dann 20 Min. köcheln.'), ['5 Min.', '20 Min.']);
});

test('Grad, Gramm und Wörter, die nur so anfangen, sind keine Zeiten', () => {
  assert.deepEqual(z('Ofen auf 200 °C vorheizen'), []);
  assert.deepEqual(z('250 g Mehl, 2 EL Öl'), []);
  assert.deepEqual(z('Nach Minuten oder Stunden schauen'), []);
  assert.deepEqual(z('3 Hefewürfel, 5 Haselnüsse, 10 Stück'), []);
  assert.deepEqual(z('Kapitel 12 Tagesplan'), []);
});

test('Text wird maskiert und bleibt sonst unverändert', () => {
  const h = schrittTextHtml('<b>"Ofen"</b> & 10 Min.');
  assert.equal(h, '&lt;b&gt;&quot;Ofen&quot;&lt;/b&gt; &amp; <span class="zeit">10 Min.</span>');
  assert.equal(schrittTextHtml(''), '');
  assert.equal(schrittTextHtml('Zwiebel würfeln'), 'Zwiebel würfeln');
});

test('Schritte im Rezept zeigen die Hervorhebung (Kochen und Backen gleich)', () => {
  const html = schritteHtml({ schritte: ['Im Ofen 12 Min. backen.'] }, { haken: new Set(), p: 'b' });
  assert.match(html, /<span class="zeit">12 Min\.<\/span>/);
});
