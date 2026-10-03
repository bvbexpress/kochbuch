// Live-Test gegen das echte Supabase-Projekt (Etappe 2): Anmeldung, stilles Erneuern und Zugriffsschutz.
//
// Das Testkonto gehört bewusst zu KEINEM Haushalt. Geprüft wird darum: Anmelden und Erneuern klappen,
// aber das Konto kann nichts lesen und nichts schreiben. Den Abgleich mit Haushalt prüft Schritt H
// auf den iPhones.
//
// Nicht Teil von `npm test` (hängt am Netz und am Zustand des Projekts). Aufruf: `npm run test:live`
// (setzt NODE_USE_ENV_PROXY=1, damit Node in der Cloud-Umgebung den Proxy nutzt).
// Läuft nur, wenn ein Testkonto in den Umgebungsvariablen steht – sonst übersprungen:
//   SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORT
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { erstelleAnmeldung } from '../js/kern/anmeldung.js';
import { erstelleServer, SERVER_ADRESSE, OEFFENTLICHER_SCHLUESSEL } from '../js/kern/server.js';
import { erstelleSync } from '../js/kern/sync.js';
import { erstelleAbgleichBereich, setzeVerwalter } from '../js/kern/abgleich.js';

const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASSWORT = process.env.SUPABASE_TEST_PASSWORT;
const skip = !EMAIL || !PASSWORT ? 'kein Testkonto in den Umgebungsvariablen' : false;

function handy() {
  const speicher = erstelleSpeicher(speicherImArbeitsspeicher());
  const anmeldung = erstelleAnmeldung({ speicher });
  const server = erstelleServer({ anmeldung });
  return { speicher, anmeldung, server };
}

/** Direkte Anfrage an /rest/v1/… (ohne `zugang`: anonym, nur mit öffentlichem Schlüssel). */
async function roh(pfad, { zugang, inhalt } = {}) {
  const headers = { apikey: OEFFENTLICHER_SCHLUESSEL, ...(zugang ? { Authorization: `Bearer ${zugang}` } : {}) };
  const antwort = await fetch(`${SERVER_ADRESSE}/rest/v1/${pfad}`, inhalt === undefined
    ? { headers }
    : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(inhalt) });
  let daten = null;
  try {
    daten = await antwort.json();
  } catch {
    // keine JSON-Antwort
  }
  return { status: antwort.status, daten };
}

/** Lesen ergibt nichts: Fehler oder leere Liste. */
const nichtsGelesen = ({ status, daten }) => status >= 400 || (Array.isArray(daten) && daten.length === 0);

/** Probe-Änderung; käme sie je durch, stünde sie in keinem Haushalt (das Konto hat keinen). */
const PROBE = { sammlung: 'livetest', id: 'probe', daten: { probe: true }, geloescht: false, basis: 0 };

test('Live: falsches Passwort → „falsch“, nichts gespeichert', { skip }, async () => {
  const h = handy();
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, `${PASSWORT}-falsch`), { ok: false, grund: 'falsch' });
  assert.equal(h.anmeldung.zustand(), 'abgemeldet');
});

test('Live: anmelden, erneuern, abgebrochenes Erneuern (Elternschlüssel)', { skip }, async () => {
  const h = handy();
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, PASSWORT), { ok: true });
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
  assert.match(h.anmeldung.konto(), /^[0-9a-f-]{36}$/);
  const gespeichert = JSON.stringify(h.speicher.einstellung('anmeldung'));
  assert.ok(!gespeichert.includes(PASSWORT) && !gespeichert.includes(EMAIL), 'weder E-Mail noch Passwort gespeichert');

  // Erneuern: neuer Erneuerungsschlüssel, sofort gespeichert
  const alt = h.speicher.einstellung('anmeldung');
  assert.ok(await h.anmeldung.zugangsschluessel({ erneuern: true }));
  assert.notEqual(h.speicher.einstellung('anmeldung').erneuerung, alt.erneuerung);

  // Abgebrochenes Erneuern nachstellen: Handy hat nur noch den vorigen Schlüssel → Supabase nimmt ihn an
  h.speicher.setzeEinstellung('anmeldung', { ...alt, ablauf: 0 });
  assert.ok(await h.anmeldung.zugangsschluessel(), 'Elternschlüssel angenommen');
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
});

test('Live: angemeldet, aber ohne Haushalt → nichts lesen, nichts schreiben', { skip }, async () => {
  const h = handy();
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, PASSWORT), { ok: true });
  const zugang = await h.anmeldung.zugangsschluessel();

  // Lesen: Tabellen liefern nichts (Row Level Security)
  assert.deepEqual(await h.server.mitglieder(), []);
  for (const tabelle of ['mitglieder', 'haushalte', 'datensaetze']) {
    assert.ok(nichtsGelesen(await roh(`${tabelle}?select=*`, { zugang })), `${tabelle} nicht lesbar`);
  }

  // Datenbank-Funktionen lehnen ab
  await assert.rejects(() => h.server.herunterladen(0), /Server antwortet mit 4\d\d/);
  await assert.rejects(() => h.server.hochladen([PROBE]), /Server antwortet mit 4\d\d/);

  // Direkt in die Tabelle schreiben geht auch nicht
  const direkt = await roh('datensaetze', {
    zugang,
    inhalt: { haushalt: '00000000-0000-4000-8000-000000000000', ...PROBE, version: 1, stand: 1, basis: undefined },
  });
  assert.ok(direkt.status >= 400, `direktes Schreiben abgelehnt (${direkt.status})`);

  // Abgleich: wirft nicht, meldet den Fehler, die eigene Änderung bleibt offen
  h.speicher.speichere('mehle', { id: 'weizen550', wasser: 66 });
  const bericht = await erstelleSync({ speicher: h.speicher, server: h.server }).abgleichen();
  assert.equal(bericht.ok, false);
  assert.equal(bericht.offen, 1);
  assert.equal(h.speicher.offene('mehle').length, 1);

  // Verwalter-Handy zeigt das ruhig im Status
  setzeVerwalter(h.speicher, true);
  const bereich = erstelleAbgleichBereich(h);
  await bereich.ladeMitglieder();
  assert.match(bereich.html(), /gehört zu keinem Haushalt/);
});

test('Live: ohne Anmeldung nichts lesen, nichts schreiben', { skip }, async () => {
  for (const tabelle of ['mitglieder', 'haushalte', 'datensaetze']) {
    assert.ok(nichtsGelesen(await roh(`${tabelle}?select=*`)), `${tabelle} anonym nicht lesbar`);
  }
  assert.ok((await roh('rpc/herunterladen', { inhalt: { seit: 0 } })).status >= 400);
  assert.ok((await roh('rpc/hochladen', { inhalt: { aenderungen: [PROBE] } })).status >= 400);
  const ping = await roh('rpc/ping', { inhalt: {} });
  assert.deepEqual([ping.status, ping.daten], [200, 'ok'], 'ping geht ohne Anmeldung');
});
