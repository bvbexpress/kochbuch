// Live-Test gegen das echte Supabase-Projekt (Etappe 2): Anmeldung, stilles Erneuern, Status-Abfrage.
//
// Nicht Teil von `npm test` (hängt am Netz und am Zustand des Projekts). Aufruf: `npm run test:live`
// (setzt NODE_USE_ENV_PROXY=1, damit Node in der Cloud-Umgebung den Proxy nutzt).
// Läuft nur, wenn ein Testkonto in den Umgebungsvariablen steht – sonst übersprungen:
//   SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORT
//
// Schreibt NIE Datensätze (kein `hochladen`). `herunterladen` fragt nur „alles seit sehr großem Stand“ ab
// (liefert nichts) und setzt dabei den letzten Abgleich des Testkontos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { erstelleAnmeldung } from '../js/kern/anmeldung.js';
import { erstelleServer } from '../js/kern/server.js';
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

test('Live: falsches Passwort → „falsch“, nichts gespeichert', { skip }, async () => {
  const h = handy();
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, `${PASSWORT}-falsch`), { ok: false, grund: 'falsch' });
  assert.equal(h.anmeldung.zustand(), 'abgemeldet');
});

test('Live: anmelden, erneuern, abgebrochenes Erneuern (Elternschlüssel), Status lesen', { skip }, async () => {
  const h = handy();
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, PASSWORT), { ok: true });
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
  assert.match(h.anmeldung.konto(), /^[0-9a-f-]{36}$/);
  const gespeichert = JSON.stringify(h.speicher.einstellung('anmeldung'));
  assert.ok(!gespeichert.includes(PASSWORT) && !gespeichert.includes(EMAIL), 'weder E-Mail noch Passwort gespeichert');

  // Erneuern: neuer Erneuerungsschlüssel, sofort gespeichert
  const alt = h.speicher.einstellung('anmeldung');
  assert.ok(await h.anmeldung.zugangsschluessel({ erneuern: true }));
  const neu = h.speicher.einstellung('anmeldung');
  assert.notEqual(neu.erneuerung, alt.erneuerung);

  // Abgebrochenes Erneuern nachstellen: Handy hat nur noch den vorigen Schlüssel → Supabase nimmt ihn an
  h.speicher.setzeEinstellung('anmeldung', { ...alt, ablauf: 0 });
  assert.ok(await h.anmeldung.zugangsschluessel(), 'Elternschlüssel angenommen');
  assert.equal(h.anmeldung.zustand(), 'angemeldet');

  // Status: Mitglieder des eigenen Haushalts (Row Level Security)
  const mitglieder = await h.server.mitglieder();
  assert.ok(Array.isArray(mitglieder));
  assert.ok(mitglieder.length > 0, 'Testkonto muss in „mitglieder“ eingetragen sein');
  assert.ok(mitglieder.some((m) => m.konto === h.anmeldung.konto()), 'eigenes Konto in der Liste');

  // Herunterladen ohne Inhalt: setzt den letzten Abgleich des Testkontos
  const antwort = await h.server.herunterladen(Number.MAX_SAFE_INTEGER);
  assert.deepEqual(antwort.datensaetze, []);

  // Bereich auf dem Verwalter-Handy zeigt das Testkonto als „heute abgeglichen“
  setzeVerwalter(h.speicher, true);
  const bereich = erstelleAbgleichBereich(h);
  await bereich.ladeMitglieder();
  assert.match(bereich.html(), /\(dieses Handy\): heute abgeglichen/);
});

test('Live: ohne Anmeldung keine Daten (Row Level Security)', { skip }, async () => {
  const { SERVER_ADRESSE, OEFFENTLICHER_SCHLUESSEL } = await import('../js/kern/server.js');
  const antwort = await fetch(`${SERVER_ADRESSE}/rest/v1/mitglieder?select=konto`, {
    headers: { apikey: OEFFENTLICHER_SCHLUESSEL },
  });
  const daten = await antwort.json();
  assert.ok(!antwort.ok || (Array.isArray(daten) && daten.length === 0), 'anonym nichts lesbar');
});
