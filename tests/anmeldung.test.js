// Tests für Anmeldung (kern/anmeldung.js) und Server-Verbindung (kern/server.js)
// gegen ein nachgebautes Supabase (als `fetch`).
//
// Der Nachbau verhält sich beim Erneuern wie Supabase (GoTrue) mit Schlüssel-Rotation:
//   - jeder Erneuerungsschlüssel wird beim Benutzen ersetzt (alter gilt als „widerrufen“)
//   - ein widerrufener Schlüssel, dessen direkter Nachfolger noch aktiv ist („Elternschlüssel“),
//     bekommt diesen aktiven Nachfolger zurück – kein Abmelden
//   - jeder andere widerrufene Schlüssel: ganze Familie gesperrt, 400 refresh_token_already_used
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { erstelleAnmeldung } from '../js/kern/anmeldung.js';
import { erstelleServer, SERVER_ADRESSE, OEFFENTLICHER_SCHLUESSEL } from '../js/kern/server.js';
import { erstelleSync } from '../js/kern/sync.js';

const KONTO = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'test@example.org';
const PASSWORT = 'geheim';

function nachgebautesSupabase() {
  let zaehler = 0;
  const erneuerung = new Map(); // Schlüssel → { familie, widerrufen, nachfolger, gesperrt }
  const zugaenge = new Map();   // Zugangsschlüssel → gültig bis (Server-Uhr, ms)
  const sb = {
    uhr: 1_000_000,       // Uhr des Servers (ms)
    netz: true,           // false: Anfrage kommt nie an
    antwortVerloren: false, // true: Server verarbeitet, Antwort geht verloren (App geschlossen, Netz weg)
    pausiert: false,      // true: Projekt pausiert (Supabase antwortet mit Fehler)
    anfragen: [],         // { pfad, headers, body }
    rpc: {},              // Funktion → (body) => Ergebnis

    neueSitzung(familie = ++zaehler) {
      const zugang = `zugang-${++zaehler}`;
      const schluessel = `erneuerung-${++zaehler}`;
      zugaenge.set(zugang, sb.uhr + 3600_000);
      erneuerung.set(schluessel, { familie, widerrufen: false, nachfolger: null });
      return { zugang, schluessel };
    },

    antwortFuer(zugang, schluessel) {
      return {
        access_token: zugang, refresh_token: schluessel, token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(sb.uhr / 1000) + 3600, user: { id: KONTO, email: EMAIL },
      };
    },

    zugangGueltig: (z) => zugaenge.has(z) && zugaenge.get(z) > sb.uhr,
    erneuerung,

    verarbeite(pfad, body, headers) {
      if (sb.pausiert) return [503, { message: 'project paused' }];
      if (headers.apikey !== OEFFENTLICHER_SCHLUESSEL) return [401, { message: 'No API key found' }];

      if (pfad === '/auth/v1/token?grant_type=password') {
        if (body.email !== EMAIL || body.password !== PASSWORT) {
          return [400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }];
        }
        const { zugang, schluessel } = sb.neueSitzung();
        return [200, sb.antwortFuer(zugang, schluessel)];
      }

      if (pfad === '/auth/v1/token?grant_type=refresh_token') {
        const t = erneuerung.get(body.refresh_token);
        if (!t) return [400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }];
        if (t.gesperrt) return [400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Already Used' }];
        if (t.widerrufen) {
          const kind = erneuerung.get(t.nachfolger);
          if (kind && !kind.widerrufen && !kind.gesperrt) {
            // Elternschlüssel: aktiven Nachfolger zurückgeben (neuer Zugangsschlüssel dazu)
            const zugang = `zugang-${++zaehler}`;
            zugaenge.set(zugang, sb.uhr + 3600_000);
            return [200, sb.antwortFuer(zugang, t.nachfolger)];
          }
          for (const x of erneuerung.values()) if (x.familie === t.familie) x.gesperrt = true;
          return [400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Already Used' }];
        }
        const neu = sb.neueSitzung(t.familie);
        t.widerrufen = true;
        t.nachfolger = neu.schluessel;
        return [200, sb.antwortFuer(neu.zugang, neu.schluessel)];
      }

      const rpc = pfad.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      if (rpc && sb.rpc[rpc[1]]) {
        const zugang = headers.Authorization?.replace(/^Bearer /, '');
        if (!sb.zugangGueltig(zugang)) return [401, { code: 'PGRST301', message: 'JWT expired' }];
        return [200, sb.rpc[rpc[1]](body)];
      }
      return [404, { message: 'not found' }];
    },

    async fetch(url, optionen) {
      await Promise.resolve();
      assert.ok(url.startsWith(SERVER_ADRESSE), url);
      const pfad = url.slice(SERVER_ADRESSE.length);
      const body = JSON.parse(optionen.body);
      sb.anfragen.push({ pfad, headers: optionen.headers, body });
      if (!sb.netz) throw new TypeError('Load failed');
      const [status, daten] = sb.verarbeite(pfad, body, optionen.headers);
      if (sb.antwortVerloren) throw new TypeError('Load failed');
      return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => structuredClone(daten),
      };
    },
  };
  return sb;
}

/** Ein Handy: eigener Speicher, eigene Uhr. */
function handy(sb, { backend = speicherImArbeitsspeicher(), uhr = { jetzt: 5_000_000 } } = {}) {
  const speicher = erstelleSpeicher(backend);
  const anmeldung = erstelleAnmeldung({ speicher, fetch: sb.fetch, jetzt: () => uhr.jetzt });
  const server = erstelleServer({ anmeldung, fetch: sb.fetch });
  return { speicher, anmeldung, server, uhr, backend };
}

const STUNDE = 3600_000;

// --- Anmeldung ---------------------------------------------------------------

test('Anmelden speichert die Schlüssel als Geräte-Einstellung, nicht E-Mail oder Passwort', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  assert.equal(h.anmeldung.zustand(), 'abgemeldet');
  assert.deepEqual(await h.anmeldung.anmelden(` ${EMAIL} `, PASSWORT), { ok: true });
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
  assert.equal(h.anmeldung.konto(), KONTO);

  const gespeichert = h.speicher.einstellung('anmeldung');
  assert.match(gespeichert.zugang, /^zugang-/);
  assert.match(gespeichert.erneuerung, /^erneuerung-/);
  const alles = JSON.stringify(gespeichert);
  assert.ok(!alles.includes(EMAIL) && !alles.includes(PASSWORT));

  const anfrage = sb.anfragen[0];
  assert.equal(anfrage.headers.apikey, OEFFENTLICHER_SCHLUESSEL);
  assert.equal(anfrage.body.email, EMAIL); // Leerzeichen entfernt
});

test('Anmelden meldet Gründe statt zu werfen', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, 'falsch'), { ok: false, grund: 'falsch' });
  sb.netz = false;
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, PASSWORT), { ok: false, grund: 'netz' });
  sb.netz = true;
  sb.pausiert = true;
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, PASSWORT), { ok: false, grund: 'server' });
  sb.verarbeite = () => [429, { msg: 'rate limit' }];
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, PASSWORT), { ok: false, grund: 'zuoft' });
  assert.equal(h.anmeldung.zustand(), 'abgemeldet');
});

test('Ohne Anmeldung gibt es keinen Zugangsschlüssel und keine Anfrage', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  assert.equal(await h.anmeldung.zugangsschluessel(), null);
  assert.equal(sb.anfragen.length, 0);
});

test('Kaputte gespeicherte Anmeldung blockiert nicht', async () => {
  const sb = nachgebautesSupabase();
  for (const kaputt of [42, 'x', [], { zugang: 'a' }, { erneuerung: 5 }, { erneuerung: '' }]) {
    const h = handy(sb);
    h.speicher.setzeEinstellung('anmeldung', kaputt);
    assert.equal(h.anmeldung.zustand(), 'abgemeldet');
    assert.equal(await h.anmeldung.zugangsschluessel(), null);
  }
});

// --- Stilles Erneuern --------------------------------------------------------

test('Gültiger Zugangsschlüssel wird ohne Anfrage benutzt, kurz vor Ablauf still erneuert', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  const erster = await h.anmeldung.zugangsschluessel();
  assert.equal(sb.anfragen.length, 1);

  h.uhr.jetzt += STUNDE - 30_000; // noch 30 s gültig → schon erneuern
  const zweiter = await h.anmeldung.zugangsschluessel();
  assert.notEqual(zweiter, erster);
  assert.equal(sb.anfragen.at(-1).pfad, '/auth/v1/token?grant_type=refresh_token');
  assert.equal(h.speicher.einstellung('anmeldung').zugang, zweiter, 'sofort gespeichert');
  assert.equal(await h.anmeldung.zugangsschluessel(), zweiter);
  assert.equal(sb.anfragen.length, 2);
});

test('Erneuern läuft nur einmal gleichzeitig', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  h.uhr.jetzt += 2 * STUNDE;
  const ergebnisse = await Promise.all([1, 2, 3, 4].map(() => h.anmeldung.zugangsschluessel()));
  assert.equal(new Set(ergebnisse).size, 1);
  assert.ok(ergebnisse[0]);
  assert.equal(sb.anfragen.filter((a) => a.pfad.includes('refresh_token')).length, 1);
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
});

test('Nach Tagen ohne Nutzung (Zugang lange abgelaufen) still weiter – ohne neue Anmeldung', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  for (let tag = 0; tag < 30; tag++) {
    h.uhr.jetzt += 24 * STUNDE;
    sb.uhr += 24 * STUNDE;
    assert.ok(sb.zugangGueltig(await h.anmeldung.zugangsschluessel()), `Tag ${tag}`);
  }
  assert.equal(sb.anfragen.filter((a) => a.pfad.includes('password')).length, 1);
});

test('Kein Netz oder Server pausiert beim Erneuern: nichts geht verloren, später klappt es', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  const vorher = h.speicher.einstellung('anmeldung');
  h.uhr.jetzt += 2 * STUNDE;

  sb.netz = false;
  assert.equal(await h.anmeldung.zugangsschluessel(), null);
  sb.netz = true;
  sb.pausiert = true;
  assert.equal(await h.anmeldung.zugangsschluessel(), null);
  sb.pausiert = false;
  sb.verarbeite = ((alt) => (...a) => (a[0].includes('refresh') ? [500, null] : alt(...a)))(sb.verarbeite);
  assert.equal(await h.anmeldung.zugangsschluessel(), null);

  assert.deepEqual(h.speicher.einstellung('anmeldung'), vorher);
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
});

// --- Abgebrochenes Erneuern ----------------------------------------------------

test('Abgebrochenes Erneuern (Antwort verloren) meldet nicht ab – auch mehrmals hintereinander', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  const alterSchluessel = h.speicher.einstellung('anmeldung').erneuerung;

  for (let i = 0; i < 3; i++) {
    h.uhr.jetzt += 2 * STUNDE;
    sb.antwortVerloren = true; // Server ersetzt den Schlüssel, die App erfährt es nie
    assert.equal(await h.anmeldung.zugangsschluessel(), null);
    assert.equal(h.speicher.einstellung('anmeldung').erneuerung, alterSchluessel, 'alter Schlüssel bleibt');
  }
  assert.ok(sb.erneuerung.get(alterSchluessel).widerrufen, 'auf dem Server ersetzt');

  sb.antwortVerloren = false;
  const zugang = await h.anmeldung.zugangsschluessel();
  assert.ok(sb.zugangGueltig(zugang), 'Elternschlüssel wird angenommen');
  assert.equal(h.anmeldung.zustand(), 'angemeldet');

  // und danach geht es normal weiter
  h.uhr.jetzt += 2 * STUNDE;
  assert.ok(sb.zugangGueltig(await h.anmeldung.zugangsschluessel()));
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
});

test('App beim Erneuern geschlossen: nach dem Neustart geht es mit dem gespeicherten Schlüssel weiter', async () => {
  const sb = nachgebautesSupabase();
  const backend = speicherImArbeitsspeicher();
  const uhr = { jetzt: 5_000_000 };
  const vorher = handy(sb, { backend, uhr });
  await vorher.anmeldung.anmelden(EMAIL, PASSWORT);

  uhr.jetzt += 2 * STUNDE;
  sb.antwortVerloren = true;
  await vorher.anmeldung.zugangsschluessel();
  sb.antwortVerloren = false;

  const nachher = handy(sb, { backend, uhr }); // App neu gestartet, gleicher Speicher
  assert.equal(nachher.anmeldung.zustand(), 'angemeldet');
  assert.ok(sb.zugangGueltig(await nachher.anmeldung.zugangsschluessel()));
});

test('Neuer Schlüssel nicht gespeichert (Speicher voll): diese Sitzung läuft, nach Neustart Elternschlüssel', async () => {
  const sb = nachgebautesSupabase();
  const backend = speicherImArbeitsspeicher();
  const uhr = { jetzt: 5_000_000 };
  const h = handy(sb, { backend, uhr });
  await h.anmeldung.anmelden(EMAIL, PASSWORT);

  uhr.jetzt += 2 * STUNDE;
  const setItem = backend.setItem;
  backend.setItem = () => { throw new Error('voll'); };
  assert.ok(sb.zugangGueltig(await h.anmeldung.zugangsschluessel()));
  backend.setItem = setItem;

  const neu = handy(sb, { backend, uhr });
  assert.ok(sb.zugangGueltig(await neu.anmeldung.zugangsschluessel()));
  assert.equal(neu.anmeldung.zustand(), 'angemeldet');
});

test('Nur ausdrückliche Ablehnung durch Supabase gilt als abgemeldet', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  const gestohlen = h.speicher.einstellung('anmeldung').erneuerung;

  // Schlüssel zweimal weiter rotiert, dann ein uralter benutzt → Supabase sperrt die Familie
  h.uhr.jetzt += 2 * STUNDE;
  await h.anmeldung.zugangsschluessel();
  h.uhr.jetzt += 2 * STUNDE;
  await h.anmeldung.zugangsschluessel();
  const [status] = sb.verarbeite('/auth/v1/token?grant_type=refresh_token', { refresh_token: gestohlen },
    { apikey: OEFFENTLICHER_SCHLUESSEL });
  assert.equal(status, 400);

  h.uhr.jetzt += 2 * STUNDE;
  assert.equal(await h.anmeldung.zugangsschluessel(), null);
  assert.equal(h.anmeldung.zustand(), 'abgelehnt');

  // Danach keine weiteren sinnlosen Anfragen
  const anzahl = sb.anfragen.length;
  assert.equal(await h.anmeldung.zugangsschluessel(), null);
  assert.equal(sb.anfragen.length, anzahl);

  // Neu anmelden hilft
  assert.deepEqual(await h.anmeldung.anmelden(EMAIL, PASSWORT), { ok: true });
  assert.equal(h.anmeldung.zustand(), 'angemeldet');
  assert.ok(await h.anmeldung.zugangsschluessel());
});

test('Falsch gehende Handy-Uhr stört nicht: Ablauf zählt ab Antwort, nicht nach Server-Uhr', async () => {
  const sb = nachgebautesSupabase();
  const h = handy(sb, { uhr: { jetzt: sb.uhr + 400 * 24 * STUNDE } }); // Handy über ein Jahr vor
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  const anzahl = sb.anfragen.length;
  assert.ok(sb.zugangGueltig(await h.anmeldung.zugangsschluessel()));
  assert.equal(sb.anfragen.length, anzahl, 'nicht sofort wieder erneuert');
});

// --- Server-Verbindung ---------------------------------------------------------

test('Server ruft die Datenbank-Funktionen mit Schlüssel und Zugangsschlüssel auf', async () => {
  const sb = nachgebautesSupabase();
  sb.rpc.hochladen = (body) => body.aenderungen.map((e) => ({ sammlung: e.sammlung, id: e.id, ok: true, version: 1 }));
  sb.rpc.herunterladen = (body) => ({ datensaetze: [], stand: body.seit, mehr: false });
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);

  const ergebnis = await h.server.hochladen([{ sammlung: 'mehle', id: 'a', daten: {}, geloescht: false, basis: 0 }]);
  assert.deepEqual(ergebnis, [{ sammlung: 'mehle', id: 'a', ok: true, version: 1 }]);
  assert.deepEqual(await h.server.herunterladen(7), { datensaetze: [], stand: 7, mehr: false });

  const [hoch, runter] = sb.anfragen.slice(-2);
  assert.equal(hoch.pfad, '/rest/v1/rpc/hochladen');
  assert.equal(runter.pfad, '/rest/v1/rpc/herunterladen');
  assert.deepEqual(runter.body, { seit: 7 });
  assert.equal(hoch.headers.apikey, OEFFENTLICHER_SCHLUESSEL);
  assert.match(hoch.headers.Authorization, /^Bearer zugang-/);
});

test('Server: Zugangsschlüssel abgelehnt (401) → einmal erneuern und wiederholen', async () => {
  const sb = nachgebautesSupabase();
  sb.rpc.herunterladen = () => ({ datensaetze: [], stand: 0, mehr: false });
  const h = handy(sb);
  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  sb.uhr += 2 * STUNDE; // Server-Uhr weiter als die Handy-Uhr: Handy hält den Schlüssel noch für gültig

  assert.deepEqual(await h.server.herunterladen(0), { datensaetze: [], stand: 0, mehr: false });
  assert.deepEqual(sb.anfragen.slice(1).map((a) => a.pfad), [
    '/rest/v1/rpc/herunterladen', '/auth/v1/token?grant_type=refresh_token', '/rest/v1/rpc/herunterladen',
  ]);
});

test('Server wirft bei Problemen – der Abgleich meldet sie nur und behält offene Änderungen', async () => {
  const sb = nachgebautesSupabase();
  sb.rpc.hochladen = (body) => body.aenderungen.map((e) => ({ sammlung: e.sammlung, id: e.id, ok: true, version: 1 }));
  sb.rpc.herunterladen = (body) => ({ datensaetze: [], stand: body.seit, mehr: false });
  const h = handy(sb);
  const sync = erstelleSync({ speicher: h.speicher, server: h.server });
  h.speicher.speichere('teigvorlagen', { name: 'Brot' });

  await assert.rejects(h.server.herunterladen(0), /nicht angemeldet/);
  let bericht = await sync.abgleichen();
  assert.equal(bericht.ok, false);
  assert.equal(bericht.offen, 1);

  await h.anmeldung.anmelden(EMAIL, PASSWORT);
  sb.netz = false;
  bericht = await sync.abgleichen();
  assert.equal(bericht.ok, false);
  assert.equal(bericht.offen, 1);

  sb.netz = true;
  sb.pausiert = true;
  await assert.rejects(h.server.herunterladen(0), /503/);

  sb.pausiert = false;
  bericht = await sync.abgleichen();
  assert.equal(bericht.ok, true);
  assert.equal(bericht.hochgeladen, 1);
  assert.equal(bericht.offen, 0);
});

test('Anfragen haben eine Zeitgrenze (hängendes Netz blockiert den Abgleich nicht)', async () => {
  const sb = nachgebautesSupabase();
  sb.rpc.herunterladen = () => ({ datensaetze: [], stand: 0, mehr: false });
  const signale = [];
  const fetch = (url, o) => {
    signale.push(o.signal);
    return sb.fetch(url, o);
  };
  const speicher = erstelleSpeicher(speicherImArbeitsspeicher());
  const anmeldung = erstelleAnmeldung({ speicher, fetch });
  await anmeldung.anmelden(EMAIL, PASSWORT);
  await erstelleServer({ anmeldung, fetch }).herunterladen(0);
  assert.equal(signale.length, 2);
  for (const s of signale) assert.ok(s instanceof AbortSignal);
});
