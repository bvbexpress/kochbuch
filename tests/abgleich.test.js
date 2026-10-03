// Tests für Etappe 2, Schritt E: Bereich „Abgleich“ (kern/abgleich.js) und Vermerk an Konflikt-Kopien.
// Ohne Browser: Anmeldung und Server sind nachgebaut, die Seite ist ein kleiner Ersatz für addEventListener.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import {
  erstelleAbgleichBereich,
  statusZeilen,
  wannText,
  tageZwischen,
  bereinigeMitglieder,
  istVerwalter,
  setzeVerwalter,
  WARNEN_AB_TAGEN,
} from '../js/kern/abgleich.js';
import {
  VORLAGEN,
  ladeVorlage,
  alleVorlagen,
  speichereEigeneVorlage,
  bereinigeKonflikt,
  vermerkText,
  entferneVermerk,
  ordneVorlagen,
} from '../js/teig/vorlagen.js';
import { vorlagenListeHtml } from '../js/teig/startseite.js';
import { erstelleLink, liesLink } from '../js/teig/teilen.js';

const TAG = 24 * 60 * 60 * 1000;
const JETZT = new Date(2026, 9, 3, 12, 0).getTime(); // 3.10.2026, 12 Uhr (Uhr des Handys)
const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());

// ---------- Hilfen: Zeit und Mitglieder ----------

test('tageZwischen zählt Kalendertage, nicht 24-Stunden-Blöcke', () => {
  const abends = new Date(2026, 9, 2, 23, 30).getTime();
  const morgens = new Date(2026, 9, 3, 0, 30).getTime();
  assert.equal(tageZwischen(abends, morgens), 1);
  assert.equal(tageZwischen(morgens, morgens + 5 * 60 * 60 * 1000), 0);
  assert.equal(tageZwischen(JETZT - 4 * TAG, JETZT), 4);
  assert.equal(tageZwischen(JETZT + TAG, JETZT), 0, 'Zeit in der Zukunft (Uhr falsch) → nie negativ');
});

test('wannText: heute, gestern, seit X Tagen, noch nie', () => {
  assert.equal(wannText(JETZT - 60_000, JETZT), 'heute abgeglichen');
  assert.equal(wannText(JETZT - TAG, JETZT), 'gestern abgeglichen');
  assert.equal(wannText(JETZT - 4 * TAG, JETZT), 'seit 4 Tagen nicht abgeglichen');
  assert.equal(wannText(null, JETZT), 'noch nie abgeglichen');
});

test('bereinigeMitglieder prüft die Antwort des Servers', () => {
  assert.equal(bereinigeMitglieder(null), null);
  assert.equal(bereinigeMitglieder({ message: 'Fehler' }), null);
  assert.deepEqual(bereinigeMitglieder([
    { konto: 'a', name: ' Handy 1 ', letzter_abgleich: '2026-10-03T08:00:00.123+00:00' },
    { konto: 'b', name: 'Handy 2', letzter_abgleich: null },
    { konto: 'c', name: '', letzter_abgleich: null },
    { konto: 5, name: 'kaputt' },
    { konto: 'd', name: 'x'.repeat(80), letzter_abgleich: 'kein Datum' },
    null,
  ]), [
    { konto: 'a', name: 'Handy 1', letzter: Date.parse('2026-10-03T08:00:00.123Z') },
    { konto: 'b', name: 'Handy 2', letzter: null },
    { konto: 'd', name: 'x'.repeat(50), letzter: null },
  ]);
});

// ---------- Statuszeilen (nur Verwalter-Handy) ----------

const mitglied = (konto, name, tage) => ({ konto, name, letzter: tage === null ? null : JETZT - tage * TAG });

test('Status: „Handy 2 seit X Tagen nicht abgeglichen“ erst ab WARNEN_AB_TAGEN als Achtung', () => {
  const zeilen = statusZeilen({
    zustand: 'angemeldet',
    offen: 0,
    mitglieder: [mitglied('k1', 'Handy 1', 0), mitglied('k2', 'Handy 2', WARNEN_AB_TAGEN), mitglied('k3', 'Tablet', 1)],
    konto: 'k1',
    jetzt: JETZT,
  });
  assert.deepEqual(zeilen, [
    { text: 'Handy 1 (dieses Handy): heute abgeglichen', achtung: false },
    { text: `Handy 2: seit ${WARNEN_AB_TAGEN} Tagen nicht abgeglichen`, achtung: true },
    { text: 'Tablet: gestern abgeglichen', achtung: false },
  ]);
});

test('Status: noch nie abgeglichen, wartende Änderungen, abgemeldet, kein Haushalt, Server weg', () => {
  const basis = { zustand: 'angemeldet', offen: 0, konto: 'k1', jetzt: JETZT };
  assert.deepEqual(statusZeilen({ ...basis, mitglieder: [mitglied('k2', 'Handy 2', null)] }),
    [{ text: 'Handy 2: noch nie abgeglichen', achtung: true }]);
  assert.deepEqual(statusZeilen({ ...basis, offen: 1, mitglieder: [] }), [
    { text: '1 Änderung wartet aufs Hochladen.', achtung: false },
    { text: 'Dieses Konto gehört zu keinem Haushalt. Im Supabase-Dashboard in „mitglieder“ eintragen.', achtung: true },
  ]);
  assert.deepEqual(statusZeilen({ ...basis, offen: 3, mitglieder: null }), [
    { text: '3 Änderungen warten aufs Hochladen.', achtung: false },
    { text: 'Server gerade nicht erreichbar – Stand der Handys unbekannt.', achtung: false },
  ]);
  assert.deepEqual(statusZeilen({ ...basis, mitglieder: undefined }),
    [{ text: 'Stand der Handys wird geladen …', achtung: false }]);
  assert.deepEqual(statusZeilen({ ...basis, zustand: 'abgelehnt', mitglieder: false }),
    [{ text: 'Dieses Handy ist abgemeldet. Bitte unten neu anmelden.', achtung: true }]);
  assert.deepEqual(statusZeilen({ ...basis, zustand: 'abgemeldet', mitglieder: false }), []);
});

// ---------- Bereich: Anmeldung, Verwalter, Laden des Status ----------

/** Nachgebaute Anmeldung (Schnittstelle wie kern/anmeldung.js). */
function testAnmeldung({ zustand = 'abgemeldet', konto = 'k1', antwort = { ok: true } } = {}) {
  const a = {
    zustandWert: zustand,
    versuche: [],
    zustand: () => a.zustandWert,
    konto: () => konto,
    async anmelden(email, passwort) {
      a.versuche.push({ email, passwort });
      if (antwort.ok) a.zustandWert = 'angemeldet';
      return antwort;
    },
  };
  return a;
}

/** Nachgebauter Server: mitglieder() liefert die Liste oder wirft (kein Netz). */
function testServer(liste = []) {
  const s = {
    liste,
    netz: true,
    anfragen: 0,
    async mitglieder() {
      s.anfragen++;
      if (!s.netz) throw new TypeError('Load failed');
      return structuredClone(s.liste);
    },
  };
  return s;
}

/** Ersatz für das Seiten-Element: sammelt Zuhörer und löst Ereignisse aus. */
function testWurzel() {
  const zuhoerer = {};
  return {
    addEventListener: (art, f) => {
      (zuhoerer[art] ??= []).push(f);
    },
    loese(art, ereignis) {
      for (const f of zuhoerer[art] ?? []) f(ereignis);
    },
  };
}

function aufbau({ anmeldung = testAnmeldung(), server = testServer(), verwalter = false, uhr = { jetzt: JETZT } } = {}) {
  const speicher = neuerSpeicher();
  if (verwalter) setzeVerwalter(speicher, true);
  const bereich = erstelleAbgleichBereich({ speicher, anmeldung, server, jetzt: () => uhr.jetzt });
  const wurzel = testWurzel();
  let gezeichnet = 0;
  bereich.verbinde(wurzel, () => gezeichnet++);
  return { speicher, anmeldung, server, bereich, wurzel, uhr, gezeichnet: () => gezeichnet };
}

/** Absenden des Anmelde-Formulars nachstellen. */
function sendeFormular(wurzel, email, passwort) {
  const knopf = { disabled: false, textContent: 'Anmelden' };
  let verhindert = false;
  wurzel.loese('submit', {
    target: {
      matches: (s) => s === '[data-anmelden]',
      elements: { email: { value: email }, passwort: { value: passwort } },
      querySelector: () => knopf,
    },
    preventDefault: () => {
      verhindert = true;
    },
  });
  return { knopf, verhindert: () => verhindert };
}

/** Was der Bereich und die Anmeldung speichern (für „nichts Geheimes gespeichert“). */
function speicherInhalt(speicher) {
  return { anmeldung: speicher.einstellung('anmeldung'), verwalter: speicher.einstellung('abgleich.verwalter') };
}

const warte = () => new Promise((r) => setTimeout(r, 0));

test('Nicht angemeldet: Formular mit E-Mail und Passwort für den Schlüsselbund, sonst nichts', () => {
  const { bereich } = aufbau();
  const html = bereich.html();
  assert.match(html, /data-klappe="abgleich"/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /type="password" name="passwort" autocomplete="current-password"/);
  assert.doesNotMatch(html, /bitte ansehen/);
  assert.doesNotMatch(html, / open/, 'zu Beginn zugeklappt');
});

test('Anmelden: E-Mail und Passwort gehen an die Anmeldung, danach kein Formular mehr', async () => {
  const { bereich, wurzel, anmeldung, speicher, gezeichnet } = aufbau();
  const f = sendeFormular(wurzel, ' ich@example.org ', 'geheim');
  assert.ok(f.verhindert(), 'Seite lädt nicht neu');
  assert.equal(f.knopf.disabled, true);
  await warte();
  assert.deepEqual(anmeldung.versuche, [{ email: 'ich@example.org', passwort: 'geheim' }]);
  assert.ok(gezeichnet() > 0);
  const html = bereich.html();
  assert.doesNotMatch(html, /data-anmelden/);
  assert.match(html, /Angemeldet\. Die Handys gleichen sich von selbst ab\./);
  assert.ok(!JSON.stringify(speicherInhalt(speicher)).includes('geheim'), 'Passwort nirgends gespeichert');
});

test('Anmelden scheitert: verständlicher Satz, E-Mail bleibt im Feld, Passwort nicht', async () => {
  const anmeldung = testAnmeldung({ antwort: { ok: false, grund: 'falsch' } });
  const { bereich, wurzel } = aufbau({ anmeldung });
  sendeFormular(wurzel, 'ich@example.org', 'falsch');
  await warte();
  const html = bereich.html();
  assert.match(html, /E-Mail oder Passwort stimmt nicht\./);
  assert.match(html, /value="ich@example\.org"/);
  assert.doesNotMatch(html, /value="falsch"/);

  for (const [grund, satz] of [['netz', /kein Netz/], ['zuoft', /Zu viele Versuche/], ['server', /antwortet gerade nicht/]]) {
    const b = aufbau({ anmeldung: testAnmeldung({ antwort: { ok: false, grund } }) });
    sendeFormular(b.wurzel, 'a@b.de', 'x');
    await warte();
    assert.match(b.bereich.html(), satz);
  }
});

test('Anderes Handy (kein Verwalter): nie ein Status, nie „bitte ansehen“, keine Server-Anfrage', async () => {
  const server = testServer([mitglied('k2', 'Handy 2', 10)]);
  const { bereich, wurzel } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server });
  bereich.start();
  wurzel.loese('toggle', { target: { dataset: { klappe: 'abgleich' }, open: true } });
  await warte();
  assert.equal(server.anfragen, 0);
  const html = bereich.html();
  assert.doesNotMatch(html, /bitte ansehen|abgleich-status/);
});

test('Abgelehnt auf einem anderen Handy: nur das Formular, keine Meldung', () => {
  const { bereich } = aufbau({ anmeldung: testAnmeldung({ zustand: 'abgelehnt' }) });
  const html = bereich.html();
  assert.match(html, /data-anmelden/);
  assert.doesNotMatch(html, /abgemeldet|bitte ansehen/);
});

test('Verwalter-Handy: Status beim Start laden, „bitte ansehen“ im Titel, wenn ein Handy lange nicht abglich', async () => {
  const server = testServer([
    { konto: 'k1', name: 'Handy 1', letzter_abgleich: new Date(JETZT).toISOString() },
    { konto: 'k2', name: 'Handy 2', letzter_abgleich: new Date(JETZT - 5 * TAG).toISOString() },
  ]);
  const { bereich, gezeichnet } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, verwalter: true });
  assert.match(bereich.html(), /wird geladen/);
  bereich.start();
  await warte();
  assert.equal(server.anfragen, 1);
  assert.ok(gezeichnet() > 0, 'nach dem Laden neu gezeichnet');
  const html = bereich.html();
  assert.match(html, /bitte ansehen/);
  assert.match(html, /Handy 1 \(dieses Handy\): heute abgeglichen/);
  assert.match(html, /<li class="achtung">Handy 2: seit 5 Tagen nicht abgeglichen<\/li>/);
});

test('Verwalter-Handy: Server nicht erreichbar → ruhiger Satz; Neu-Laden höchstens einmal pro Minute', async () => {
  const server = testServer([mitglied('k1', 'Handy 1', 0)]);
  server.netz = false;
  const uhr = { jetzt: JETZT };
  const { bereich, wurzel } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, verwalter: true, uhr });
  const aufklappen = () => wurzel.loese('toggle', { target: { dataset: { klappe: 'abgleich' }, open: true } });
  aufklappen();
  await warte();
  assert.match(bereich.html(), /Server gerade nicht erreichbar/);
  assert.doesNotMatch(bereich.html(), /bitte ansehen/, 'Netzprobleme sind kein Grund zur Sorge');
  assert.match(bereich.html(), / open/, 'bleibt beim Neuzeichnen aufgeklappt');

  server.netz = true;
  aufklappen();
  await warte();
  assert.equal(server.anfragen, 1, 'nicht gleich wieder');
  uhr.jetzt += 61_000;
  aufklappen();
  await warte();
  assert.equal(server.anfragen, 2);
  assert.doesNotMatch(bereich.html(), /nicht erreichbar/);
});

test('Verwalter ein- und ausschalten ist eine Geräte-Einstellung', async () => {
  const server = testServer([]);
  const { bereich, wurzel, speicher } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server });
  const tippe = (aktion) => wurzel.loese('click', { target: { closest: () => ({ dataset: { abgleich: aktion } }) } });
  tippe('verwalter-an');
  await warte();
  assert.equal(istVerwalter(speicher), true);
  assert.equal(server.anfragen, 1);
  assert.match(bereich.html(), /gehört zu keinem Haushalt/);
  tippe('verwalter-aus');
  assert.equal(istVerwalter(speicher), false);
  assert.doesNotMatch(bereich.html(), /abgleich-status/);
});

test('Verwalter-Handy abgemeldet: Hinweis, wartende Änderungen und das Formular', () => {
  const { bereich, speicher } = aufbau({ anmeldung: testAnmeldung({ zustand: 'abgelehnt' }), verwalter: true });
  speichereEigeneVorlage(speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 500 });
  const html = bereich.html();
  assert.match(html, /bitte ansehen/);
  assert.match(html, /Dieses Handy ist abgemeldet/);
  assert.match(html, /1 Änderung wartet aufs Hochladen/);
  assert.match(html, /data-anmelden/);
});

test('Namen vom Server werden maskiert', async () => {
  const server = testServer([{ konto: 'k2', name: '<img src=x onerror=alert(1)>', letzter_abgleich: null }]);
  const { bereich } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, verwalter: true });
  await bereich.ladeMitglieder();
  assert.doesNotMatch(bereich.html(), /<img/);
});

// ---------- Vermerk an Konflikt-Kopien ----------

/** Konflikt-Kopie so anlegen, wie kern/sync.js es tut. */
function konfliktKopie(speicher) {
  const original = speichereEigeneVorlage(speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[1]).teig, mehl: 500 });
  const kopie = speicher.speichere('teigvorlagen', {
    name: 'Brot (Änderung vom 3.10.)', teig: ladeVorlage(VORLAGEN[1]).teig, mehl: 600, modus: 'mehl',
    konflikt: { von: original.id, am: JETZT },
  });
  return { original, kopie };
}

test('bereinigeKonflikt: nur { von, am } oder null', () => {
  assert.deepEqual(bereinigeKonflikt({ von: 'a', am: 5, extra: 1 }), { von: 'a', am: 5 });
  for (const k of [null, undefined, 'x', { von: 3, am: 5 }, { von: 'a' }, { von: 'a', am: NaN }]) {
    assert.equal(bereinigeKonflikt(k), null);
  }
});

test('Vermerk: Text nennt die andere Fassung; fehlt sie, nur der erste Satz', () => {
  const speicher = neuerSpeicher();
  const { original, kopie } = konfliktKopie(speicher);
  const alle = alleVorlagen(speicher);
  const k = alle.find((v) => v.id === kopie.id);
  assert.deepEqual(k.konflikt, { von: original.id, am: JETZT });
  assert.equal(alle.find((v) => v.id === original.id).konflikt, null);
  assert.equal(vermerkText(k, alle), 'Gleichzeitig auf beiden Handys geändert. Die andere Fassung heißt „Brot“.');
  assert.equal(vermerkText(alle.find((v) => v.id === original.id), alle), null);

  speicher.loesche('teigvorlagen', original.id);
  assert.equal(vermerkText(k, alleVorlagen(speicher)), 'Gleichzeitig auf beiden Handys geändert.');
});

test('Vermerk in der Vorlagenliste sichtbar', () => {
  const speicher = neuerSpeicher();
  konfliktKopie(speicher);
  const html = vorlagenListeHtml(ordneVorlagen(alleVorlagen(speicher)), { sterne: new Set(), suche: '' });
  assert.equal(html.match(/Gleichzeitig geändert – bitte ansehen/g)?.length, 1);
});

test('„Diese behalten“ entfernt den Vermerk und gilt als Änderung (geht beim Abgleich hoch)', () => {
  const speicher = neuerSpeicher();
  const { kopie } = konfliktKopie(speicher);
  for (const o of speicher.offene('teigvorlagen')) speicher.hochgeladen('teigvorlagen', o.datensatz, 1);
  assert.equal(speicher.offene('teigvorlagen').length, 0);

  assert.equal(entferneVermerk(speicher, kopie.id), true);
  const gespeichert = speicher.hole('teigvorlagen', kopie.id);
  assert.equal('konflikt' in gespeichert, false);
  assert.equal(gespeichert.name, 'Brot (Änderung vom 3.10.)');
  assert.equal(gespeichert.mehl, 600);
  assert.deepEqual(speicher.offene('teigvorlagen').map((o) => o.datensatz.id), [kopie.id]);
  assert.equal(entferneVermerk(speicher, kopie.id), false, 'kein Vermerk mehr → nichts zu tun');
});

test('Bearbeiten und Speichern der Kopie entfernt den Vermerk ebenfalls', () => {
  const speicher = neuerSpeicher();
  const { kopie } = konfliktKopie(speicher);
  const v = alleVorlagen(speicher).find((x) => x.id === kopie.id);
  speichereEigeneVorlage(speicher, { ...v, name: 'Brot hell' });
  assert.equal(alleVorlagen(speicher).find((x) => x.id === kopie.id).konflikt, null);
});

test('Vermerk geht nicht in Teilen-Links', async () => {
  const speicher = neuerSpeicher();
  const { kopie } = konfliktKopie(speicher);
  const v = alleVorlagen(speicher).find((x) => x.id === kopie.id);
  const gelesen = await liesLink(await erstelleLink([v], 'https://beispiel.test/kochbuch/'));
  assert.equal('konflikt' in gelesen.vorlagen[0], false);
});
