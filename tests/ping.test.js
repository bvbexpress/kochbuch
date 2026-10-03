// Prüft den Weckruf (.github/workflows/ping.yml): Er muss dieselbe Adresse und denselben
// öffentlichen Schlüssel benutzen wie die App, zweimal pro Woche laufen und `ping` aufrufen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SERVER_ADRESSE, OEFFENTLICHER_SCHLUESSEL } from '../js/kern/server.js';

const workflow = readFileSync(new URL('../.github/workflows/ping.yml', import.meta.url), 'utf8');
const wert = (name) => workflow.match(new RegExp(`^\\s+${name}: (\\S+)$`, 'm'))?.[1];

test('Weckruf nutzt Adresse und Schlüssel der App', () => {
  assert.equal(wert('SERVER_ADRESSE'), SERVER_ADRESSE);
  assert.equal(wert('OEFFENTLICHER_SCHLUESSEL'), OEFFENTLICHER_SCHLUESSEL);
});

test('Weckruf läuft Montag und Donnerstag und kann von Hand gestartet werden', () => {
  assert.match(workflow, /cron: '\d+ \d+ \* \* 1,4'/);
  assert.match(workflow, /workflow_dispatch:/);
});

test('Weckruf ruft ping auf und schlägt bei falscher Antwort fehl', () => {
  assert.match(workflow, /rest\/v1\/rpc\/ping/);
  assert.match(workflow, /test "\$antwort" = '"ok"'/);
});

test('Weckruf hält den Zeitplan selbst aktiv, mit nur dem nötigen Recht', () => {
  assert.match(workflow, /actions\/workflows\/ping\.yml\/enable/);
  assert.match(workflow, /actions: write/);
  assert.doesNotMatch(workflow, /service_role|secret key|sb_secret/i);
});
