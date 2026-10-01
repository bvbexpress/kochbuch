// Tests für den Offline-Betrieb: Dateiliste und Version im Service Worker, Manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const wurzel = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(wurzel, 'sw.js'), 'utf8');
const dateien = [...sw.match(/const DATEIEN = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const version = sw.match(/const VERSION = '([^']*)'/)[1];

/** Alle Dateien eines Ordners (rekursiv), als './pfad'. */
function alleIn(ordner) {
  return readdirSync(join(wurzel, ordner), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => `./${join(d.parentPath ?? d.path, d.name).slice(wurzel.length).replace(/^\/+/, '')}`);
}

test('Jede Datei im Service-Worker-Cache gibt es wirklich, alle Pfade relativ', () => {
  for (const datei of dateien) {
    assert.match(datei, /^\.\//, datei);
    assert.ok(existsSync(join(wurzel, datei)), `fehlt: ${datei}`);
  }
});

test('Alle Dateien der App stehen im Service-Worker-Cache (sonst fehlen sie offline)', () => {
  const noetig = [
    './index.html',
    './manifest.webmanifest',
    ...alleIn('css'),
    ...alleIn('js'),
    ...alleIn('icons').filter((d) => d.endsWith('.png')),
  ];
  for (const datei of noetig) assert.ok(dateien.includes(datei), `nicht im Cache: ${datei} – in sw.js bei DATEIEN eintragen`);
});

test('VERSION in sw.js passt zum Inhalt der Dateien (sonst kommt das Update nicht aufs Handy)', () => {
  const pruefsumme = createHash('sha256');
  for (const datei of dateien) {
    pruefsumme.update(datei);
    pruefsumme.update(readFileSync(join(wurzel, datei)));
  }
  const erwartet = pruefsumme.digest('hex').slice(0, 8);
  assert.equal(version, erwartet, `Dateien geändert: in sw.js VERSION = '${erwartet}' setzen`);
});

test('Manifest: gültig, relative Pfade, Icons vorhanden', () => {
  const manifest = JSON.parse(readFileSync(join(wurzel, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\.\//);
    assert.ok(existsSync(join(wurzel, icon.src)), `fehlt: ${icon.src}`);
  }
});

test('index.html bindet Manifest, Icon und nur relative Pfade ein', () => {
  const html = readFileSync(join(wurzel, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\.\/icons\/icon-180\.png"/);
  for (const [, pfad] of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.match(pfad, /^\.\//, pfad);
});
