// Tests für den Test-Connector „Hallo“ (supabase/functions/hallo/index.ts, Etappe 3 Schritt 0).
// Ohne gültigen Schlüssel geht nichts; mit Schlüssel (Kopfzeile oder Pfad) spricht er MCP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearbeite } from '../supabase/functions/hallo/index.ts';

const SCHLUESSEL = 'testschluessel-0123456789abcdefghijklmnop';
const ADRESSE = 'https://beispiel.supabase.co/functions/v1/hallo';

function anfrage(koerper, { pfad = '', kopf = {}, methode = 'POST' } = {}) {
  return new Request(ADRESSE + pfad, {
    method: methode,
    headers: { 'content-type': 'application/json', ...kopf },
    body: methode === 'POST' ? JSON.stringify(koerper) : undefined,
  });
}

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
const aufruf = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hallo', arguments: {} } };

test('Ohne oder mit falschem Schlüssel: 401', async () => {
  assert.equal((await bearbeite(anfrage(init), SCHLUESSEL)).status, 401);
  assert.equal((await bearbeite(anfrage(init, { kopf: { authorization: 'Bearer falsch' } }), SCHLUESSEL)).status, 401);
  assert.equal((await bearbeite(anfrage(init, { pfad: '/falsch' }), SCHLUESSEL)).status, 401);
  assert.equal((await bearbeite(anfrage(init, { kopf: { authorization: SCHLUESSEL } }), SCHLUESSEL)).status, 401);
});

test('Fehlt das Secret oder ist es zu kurz, ist die Funktion zu', async () => {
  assert.equal((await bearbeite(anfrage(init, { pfad: '/undefined' }), undefined)).status, 401);
  assert.equal((await bearbeite(anfrage(init, { kopf: { authorization: 'Bearer kurz' } }), 'kurz')).status, 401);
  assert.equal((await bearbeite(anfrage(init, { pfad: '/hallo' }), 'hallo')).status, 401);
});

test('Schlüssel als Kopfzeile: Begrüßung nennt den Weg', async () => {
  for (const kopf of [{ authorization: `Bearer ${SCHLUESSEL}` }, { 'x-api-key': SCHLUESSEL }]) {
    const a = await bearbeite(anfrage(aufruf, { kopf }), SCHLUESSEL);
    assert.equal(a.status, 200);
    assert.match((await a.json()).result.content[0].text, /Kopfzeile/);
  }
});

test('Schlüssel im Pfad: Begrüßung nennt den Weg', async () => {
  const a = await bearbeite(anfrage(aufruf, { pfad: `/${SCHLUESSEL}` }), SCHLUESSEL);
  assert.match((await a.json()).result.content[0].text, /Pfad/);
});

test('MCP-Ablauf: initialize, Benachrichtigung, tools/list, ping', async () => {
  const opt = { pfad: `/${SCHLUESSEL}` };
  const i = await (await bearbeite(anfrage(init, opt), SCHLUESSEL)).json();
  assert.equal(i.result.protocolVersion, '2025-06-18');
  assert.deepEqual(i.result.capabilities, { tools: {} });

  const n = await bearbeite(anfrage({ jsonrpc: '2.0', method: 'notifications/initialized' }, opt), SCHLUESSEL);
  assert.equal(n.status, 202);

  const l = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, opt), SCHLUESSEL)).json();
  assert.deepEqual(l.result.tools.map((w) => w.name), ['hallo']);

  const p = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 4, method: 'ping' }, opt), SCHLUESSEL)).json();
  assert.deepEqual(p.result, {});
});

test('Unbekannte Version, Methode, Werkzeug, kaputtes JSON, GET', async () => {
  const opt = { pfad: `/${SCHLUESSEL}` };
  const i = await (await bearbeite(anfrage({ ...init, params: { protocolVersion: '1999-01-01' } }, opt), SCHLUESSEL)).json();
  assert.equal(i.result.protocolVersion, '2025-06-18');
  const m = await (await bearbeite(anfrage({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, opt), SCHLUESSEL)).json();
  assert.equal(m.error.code, -32601);
  const w = await (await bearbeite(anfrage({ ...aufruf, params: { name: 'loeschen' } }, opt), SCHLUESSEL)).json();
  assert.equal(w.error.code, -32602);
  const kaputt = new Request(`${ADRESSE}/${SCHLUESSEL}`, { method: 'POST', body: '{kaputt' });
  assert.equal((await bearbeite(kaputt, SCHLUESSEL)).status, 400);
  assert.equal((await bearbeite(anfrage(null, { ...opt, methode: 'GET' }), SCHLUESSEL)).status, 405);
});
