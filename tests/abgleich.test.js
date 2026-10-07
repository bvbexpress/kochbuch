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
  sicherungText,
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
import { merkeSicherung, letzteSicherung } from '../js/kern/sicherung.js';

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
    abmeldungen: 0,
    async anmelden(email, passwort) {
      a.versuche.push({ email, passwort });
      if (antwort.ok) a.zustandWert = 'angemeldet';
      return antwort;
    },
    async abmelden() {
      a.abmeldungen++;
      a.zustandWert = 'abgemeldet';
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

function aufbau({
  anmeldung = testAnmeldung(), server = testServer(), verwalter = false, uhr = { jetzt: JETZT }, antworten = [],
  gesichert = JETZT, teilen = async () => true,
} = {}) {
  const speicher = neuerSpeicher();
  if (verwalter) setzeVerwalter(speicher, true);
  if (gesichert !== null) merkeSicherung(speicher, gesichert);
  const protokoll = { abgleiche: 0, sicherungen: [], fragen: [], neuGezeichnet: 0 };
  const bereich = erstelleAbgleichBereich({
    speicher,
    anmeldung,
    server,
    jetzt: () => uhr.jetzt,
    abgleichen: async () => {
      protokoll.abgleiche++;
      return null;
    },
    teilen: async (datei) => {
      protokoll.sicherungen.push(datei);
      return teilen(datei);
    },
    nachWiederherstellen: () => {
      protokoll.neuGezeichnet++;
    },
    fragen: (frage) => {
      protokoll.fragen.push(frage);
      return antworten.shift() ?? true;
    },
  });
  const version = testWurzel();
  const ziel = { ...testWurzel(), innerHTML: '' };
  const punkt = { hidden: true };
  bereich.verbindeVerwaltung(version, ziel, punkt);
  // Alles Sichtbare steht in der Verwaltung: öffnen und lesen
  const html = () => {
    if (!ziel.innerHTML) bereich.oeffneVerwaltung();
    return ziel.innerHTML;
  };
  const tippe = (aktion) => ziel.loese('click', {
    target: { closest: (sel) => (sel === '[data-verwaltung]' ? { dataset: { verwaltung: aktion } } : null) },
  });
  return { speicher, anmeldung, server, bereich, version, ziel, punkt, html, tippe, uhr, protokoll };
}

/** Absenden des Anmelde-Formulars nachstellen. */
function sendeFormular(ziel, email, passwort, verwalter = false) {
  const knopf = { disabled: false, textContent: 'Anmelden' };
  let verhindert = false;
  ziel.loese('submit', {
    target: {
      matches: (s) => s === '[data-anmelden]',
      elements: { email: { value: email }, passwort: { value: passwort }, verwalter: { checked: verwalter } },
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

test('Nicht angemeldet: Formular mit E-Mail und Passwort für den Schlüsselbund, nur in der Verwaltung', () => {
  const { html, ziel } = aufbau();
  assert.equal(ziel.innerHTML, '', 'auf der Seite nichts davon zu sehen');
  const h = html();
  assert.match(h, /autocomplete="username"/);
  assert.match(h, /type="password" name="passwort" autocomplete="current-password"/);
  assert.match(h, /<input type="checkbox" name="verwalter" >/, 'Häkchen Verwalter, nicht gesetzt');
  assert.match(h, /Dieses Handy ist nicht angemeldet/);
  assert.doesNotMatch(h, /bitte ansehen/);
});

test('Anmelden ohne Häkchen: E-Mail und Passwort gehen an die Anmeldung, danach ist das Formular weg', async () => {
  const { html, ziel, anmeldung, speicher, punkt } = aufbau();
  html();
  const f = sendeFormular(ziel, ' ich@example.org ', 'geheim');
  assert.ok(f.verhindert(), 'Seite lädt nicht neu');
  assert.equal(f.knopf.disabled, true);
  await warte();
  assert.deepEqual(anmeldung.versuche, [{ email: 'ich@example.org', passwort: 'geheim' }]);
  assert.doesNotMatch(ziel.innerHTML, /data-anmelden/, 'anderes Handy: kein Formular mehr');
  assert.match(ziel.innerHTML, /Dieses Handy ist angemeldet/);
  assert.equal(istVerwalter(speicher), false);
  assert.equal(punkt.hidden, true, 'anderes Handy: nie ein Punkt');
  assert.ok(!JSON.stringify(speicherInhalt(speicher)).includes('geheim'), 'Passwort nirgends gespeichert');
});

test('Anmelden mit Häkchen: Verwalter-Handy, Status wird gleich geladen', async () => {
  const server = testServer([{ konto: 'k1', name: 'Handy 1', letzter_abgleich: new Date(JETZT).toISOString() }]);
  const { html, ziel, speicher, punkt } = aufbau({ server });
  html();
  sendeFormular(ziel, 'ich@example.org', 'geheim', true);
  await warte();
  await warte();
  assert.equal(istVerwalter(speicher), true);
  assert.equal(server.anfragen, 1);
  assert.match(ziel.innerHTML, /Handy 1 \(dieses Handy\): heute abgeglichen/);
  assert.doesNotMatch(ziel.innerHTML, /data-anmelden/, 'kein Formular mehr');
  assert.equal(punkt.hidden, true, 'alles in Ordnung: kein Punkt');
});

test('Häkchen zählt nur bei erfolgreicher Anmeldung', async () => {
  const { html, ziel, speicher } = aufbau({ anmeldung: testAnmeldung({ antwort: { ok: false, grund: 'falsch' } }) });
  html();
  sendeFormular(ziel, 'ich@example.org', 'falsch', true);
  await warte();
  assert.equal(istVerwalter(speicher), false);
});

test('Anmelden scheitert: verständlicher Satz, E-Mail bleibt im Feld, Passwort nicht', async () => {
  const anmeldung = testAnmeldung({ antwort: { ok: false, grund: 'falsch' } });
  const { html, ziel } = aufbau({ anmeldung });
  html();
  sendeFormular(ziel, 'ich@example.org', 'falsch');
  await warte();
  const h = ziel.innerHTML;
  assert.match(h, /E-Mail oder Passwort stimmt nicht\./);
  assert.match(h, /value="ich@example\.org"/);
  assert.doesNotMatch(h, /value="falsch"/);

  for (const [grund, satz] of [['netz', /kein Netz/], ['zuoft', /Zu viele Versuche/], ['server', /antwortet gerade nicht/]]) {
    const b = aufbau({ anmeldung: testAnmeldung({ antwort: { ok: false, grund } }) });
    b.html();
    sendeFormular(b.ziel, 'a@b.de', 'x');
    await warte();
    assert.match(b.ziel.innerHTML, satz);
  }
});

test('Anderes Handy (kein Verwalter): nie ein Status, nie ein Punkt, keine Server-Anfrage', async () => {
  const server = testServer([mitglied('k2', 'Handy 2', 10)]);
  const { html, bereich, punkt } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, gesichert: null });
  bereich.start();
  const h = html();
  await warte();
  assert.equal(server.anfragen, 0);
  assert.equal(bereich.punkt(), false);
  assert.equal(punkt.hidden, true);
  assert.doesNotMatch(h, /Handy 2|abgeglichen/);
});

test('Abgelehnt auf einem anderen Handy: nur das Formular, kein Punkt', () => {
  const { html, bereich, punkt } = aufbau({ anmeldung: testAnmeldung({ zustand: 'abgelehnt' }) });
  const h = html();
  assert.match(h, /data-anmelden/);
  assert.match(h, /name="verwalter" >/, 'Häkchen nicht gesetzt');
  assert.doesNotMatch(h, /bitte ansehen/);
  assert.equal(bereich.punkt(), false);
  assert.equal(punkt.hidden, true);
});

test('Verwalter-Handy: Status beim Start laden, Punkt, wenn ein Handy lange nicht abglich', async () => {
  const server = testServer([
    { konto: 'k1', name: 'Handy 1', letzter_abgleich: new Date(JETZT).toISOString() },
    { konto: 'k2', name: 'Handy 2', letzter_abgleich: new Date(JETZT - 5 * TAG).toISOString() },
  ]);
  const { html, ziel, bereich, punkt } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, verwalter: true });
  assert.equal(punkt.hidden, true, 'noch nicht geladen: kein Grund zur Sorge');
  bereich.start();
  html();
  assert.match(ziel.innerHTML, /wird geladen/);
  await warte();
  assert.equal(server.anfragen, 1);
  assert.equal(punkt.hidden, false, 'nach dem Laden: Punkt neben der Versionsnummer');
  const h = ziel.innerHTML;
  assert.match(h, /Handy 1 \(dieses Handy\): heute abgeglichen/);
  assert.match(h, /<li class="achtung">Handy 2: seit 5 Tagen nicht abgeglichen<\/li>/);
});

test('Verwalter-Handy: Server nicht erreichbar → ruhiger Satz, kein Punkt; Neu-Laden höchstens einmal pro Minute', async () => {
  const server = testServer([mitglied('k1', 'Handy 1', 0)]);
  server.netz = false;
  const uhr = { jetzt: JETZT };
  const { bereich, ziel, punkt } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, verwalter: true, uhr });
  const oeffnen = () => bereich.oeffneVerwaltung();
  oeffnen();
  await warte();
  assert.match(ziel.innerHTML, /Server gerade nicht erreichbar/);
  assert.doesNotMatch(ziel.innerHTML, /bitte ansehen/);
  assert.equal(punkt.hidden, true, 'Netzprobleme sind kein Grund zur Sorge');

  server.netz = true;
  oeffnen();
  await warte();
  assert.equal(server.anfragen, 1, 'nicht gleich wieder');
  uhr.jetzt += 61_000;
  oeffnen();
  await warte();
  assert.equal(server.anfragen, 2);
  assert.doesNotMatch(ziel.innerHTML, /nicht erreichbar/);
});

test('Verwalter-Handy abgemeldet: Hinweis, wartende Änderungen, Formular und Punkt', () => {
  const { html, speicher, punkt } = aufbau({ anmeldung: testAnmeldung({ zustand: 'abgelehnt' }), verwalter: true });
  speichereEigeneVorlage(speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 500 });
  const h = html();
  assert.match(h, /Dieses Handy ist abgemeldet/);
  assert.match(h, /1 Änderung wartet aufs Hochladen/);
  assert.match(h, /data-anmelden/);
  assert.match(h, /name="verwalter" checked/, 'beim Neu-Anmelden bleibt es Verwalter');
  assert.equal(punkt.hidden, false);
});

test('Verwalter-Handy nie angemeldet: Punkt; nach dem Anmelden weg', async () => {
  const server = testServer([{ konto: 'k1', name: 'Handy 1', letzter_abgleich: new Date(JETZT).toISOString() }]);
  const { bereich, html, ziel, punkt } = aufbau({ verwalter: true, server });
  bereich.start();
  assert.equal(bereich.punkt(), true);
  assert.equal(punkt.hidden, false);
  html();
  sendeFormular(ziel, 'ich@example.org', 'geheim', true);
  await warte();
  await warte();
  assert.equal(punkt.hidden, true);
});

test('Namen vom Server werden maskiert', async () => {
  const server = testServer([{ konto: 'k2', name: '<img src=x onerror=alert(1)>', letzter_abgleich: null }]);
  const { bereich, html } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, verwalter: true });
  await bereich.ladeMitglieder();
  assert.doesNotMatch(html(), /<img/);
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

// ---------- Versteckte Verwaltung: langes Drücken auf die Versionsnummer ----------

const mitVerwaltung = aufbau; // Seite mit Versionsnummer, Punkt und Platz für die Verwaltung

test('Verwaltung: unsichtbar; kurzes Tippen öffnet nichts, langes Drücken schon', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { version, ziel } = mitVerwaltung({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }) });
  assert.equal(ziel.innerHTML, '');
  version.loese('pointerdown');
  t.mock.timers.tick(300);
  version.loese('pointerup');
  t.mock.timers.tick(1000);
  assert.equal(ziel.innerHTML, '', 'kurzes Tippen');
  version.loese('pointerdown');
  t.mock.timers.tick(300);
  version.loese('pointercancel'); // z. B. Scrollen
  t.mock.timers.tick(1000);
  assert.equal(ziel.innerHTML, '', 'Scrollen');
  version.loese('pointerdown');
  t.mock.timers.tick(700);
  assert.match(ziel.innerHTML, /Verwaltung/);
  assert.match(ziel.innerHTML, /Dieses Handy ist angemeldet/);
  assert.match(ziel.innerHTML, /Verwalter-Handy: aus/);
  assert.match(ziel.innerHTML, /data-verwaltung="abmelden"/);
});

test('Verwaltung: Verwalter-Handy nachträglich ein- und ausschalten', async () => {
  const server = testServer([{ konto: 'k1', name: 'Handy 1', letzter_abgleich: new Date(JETZT).toISOString() }]);
  const { bereich, speicher, ziel, tippe } = mitVerwaltung({
    anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server,
  });
  bereich.oeffneVerwaltung();
  assert.doesNotMatch(ziel.innerHTML, /Handy 1/, 'anderes Handy: kein Status');

  tippe('verwalter');
  await warte();
  assert.equal(istVerwalter(speicher), true);
  assert.match(ziel.innerHTML, /Verwalter-Handy: an/);
  assert.match(ziel.innerHTML, /Handy 1 \(dieses Handy\): heute abgeglichen/);

  tippe('verwalter');
  assert.equal(istVerwalter(speicher), false);
  assert.match(ziel.innerHTML, /Verwalter-Handy: aus/);
  assert.doesNotMatch(ziel.innerHTML, /Handy 1/);

  tippe('schliessen');
  assert.equal(ziel.innerHTML, '');
});

test('Verwaltung: nicht angemeldet → kein Abmelden-Knopf, dafür das Anmelde-Formular', () => {
  const { bereich, ziel } = mitVerwaltung();
  bereich.oeffneVerwaltung();
  assert.doesNotMatch(ziel.innerHTML, /data-verwaltung="abmelden"/);
  assert.match(ziel.innerHTML, /nicht angemeldet/);
  assert.match(ziel.innerHTML, /data-anmelden/);
  assert.match(ziel.innerHTML, /data-verwaltung="verwalter"/);
});

test('Verwaltung: Hintergrund-Aktualisierung zeichnet nicht über das, was gerade getippt wird', async (t) => {
  const server = testServer([mitglied('k1', 'Handy 1', 0)]);
  const { bereich, ziel } = mitVerwaltung({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), server, verwalter: true });
  bereich.oeffneVerwaltung();
  await warte();
  const feld = { matches: (sel) => sel === 'input' };
  globalThis.document = { activeElement: feld };
  t.after(() => delete globalThis.document);
  ziel.contains = (x) => x === feld;
  ziel.innerHTML = 'ANGETIPPT';
  bereich.nachAbgleich();
  await warte();
  assert.equal(ziel.innerHTML, 'ANGETIPPT', 'Eingabe bleibt stehen');
});

test('Abmelden: erst abgleichen, dann fragen; Daten und offene Änderungen bleiben', async () => {
  const { bereich, speicher, anmeldung, ziel, tippe, protokoll } = mitVerwaltung({
    anmeldung: testAnmeldung({ zustand: 'angemeldet' }),
  });
  const brot = speichereEigeneVorlage(speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 500 });
  speicher.setzeSyncStand(17);
  bereich.oeffneVerwaltung();
  tippe('abmelden');
  assert.match(ziel.innerHTML, /Wird abgeglichen/);
  await warte();

  assert.equal(protokoll.abgleiche, 1, 'vorher noch einmal abgeglichen');
  assert.match(protokoll.fragen[0], /1 Änderung ist noch nicht hochgeladen\. Sie bleiben auf diesem Handy/);
  assert.equal(anmeldung.abmeldungen, 1);
  assert.equal(anmeldung.zustand(), 'abgemeldet');
  assert.equal(speicher.hole('teigvorlagen', brot.id).name, 'Brot', 'Vorlage bleibt');
  assert.equal(speicher.offene('teigvorlagen').length, 1, 'bleibt offen → geht nach der nächsten Anmeldung hoch');
  assert.equal(speicher.syncStand(), 0, 'nach der nächsten Anmeldung alles neu herunterladen');
  assert.match(ziel.innerHTML, /data-anmelden/, 'Verwaltung bleibt offen, das Formular zum Neu-Anmelden steht gleich da');
  assert.doesNotMatch(ziel.innerHTML, /data-verwaltung="abmelden"/);
});

test('Abmelden: alles hochgeladen → einfache Frage; „Abbrechen“ ändert nichts', async () => {
  const { bereich, speicher, anmeldung, ziel, tippe, protokoll } = mitVerwaltung({
    anmeldung: testAnmeldung({ zustand: 'angemeldet' }), antworten: [false],
  });
  speicher.setzeSyncStand(17);
  bereich.oeffneVerwaltung();
  tippe('abmelden');
  await warte();
  assert.match(protokoll.fragen[0], /^Dieses Handy abmelden\?/);
  assert.equal(anmeldung.abmeldungen, 0);
  assert.equal(anmeldung.zustand(), 'angemeldet');
  assert.equal(speicher.syncStand(), 17);
  assert.match(ziel.innerHTML, /data-verwaltung="abmelden"/, 'Verwaltung bleibt offen');
});

test('Nicht angemeldet: nie bereit', () => {
  const { bereich } = aufbau();
  assert.equal(bereich.bereit(), false);
});

test('Anmelden stößt den ersten Abgleich an', async () => {
  const { ziel, protokoll } = aufbau();
  sendeFormular(ziel, 'ich@example.org', 'geheim');
  await warte();
  assert.equal(protokoll.abgleiche, 1);
});

test('Angemeldet: sofort bereit (kein Umzug mehr vorab), auch auf dem Verwalter-Handy mit eigenen Vorlagen', () => {
  const { bereich, speicher } = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), verwalter: true });
  speichereEigeneVorlage(speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 500 });
  assert.equal(bereich.bereit(), true);
});

// ---------- Sicherung: Status auf dem Verwalter-Handy, „Alles sichern“, „Wiederherstellen“ ----------

test('Sicherung: Text und Warnung erst nach mehr als 30 Tagen (oder nie)', () => {
  assert.equal(sicherungText(null, JETZT), 'Noch nie gesichert.');
  assert.equal(sicherungText(JETZT, JETZT), 'Letzte Sicherung: heute.');
  assert.equal(sicherungText(JETZT - TAG, JETZT), 'Letzte Sicherung: gestern.');
  assert.equal(sicherungText(JETZT - 12 * TAG, JETZT), 'Letzte Sicherung: vor 12 Tagen.');
  const zeile = (gesichert) => statusZeilen({ zustand: 'angemeldet', offen: 0, mitglieder: false, jetzt: JETZT, gesichert })
    .find((z) => /gesichert|Sicherung/.test(z.text));
  assert.equal(zeile(JETZT - 30 * TAG).achtung, false);
  assert.equal(zeile(JETZT - 31 * TAG).achtung, true);
  assert.match(zeile(JETZT - 31 * TAG).text, /Alles sichern/);
  assert.equal(zeile(null).achtung, true);
  assert.equal(statusZeilen({ zustand: 'angemeldet', offen: 0, mitglieder: false, jetzt: JETZT })
    .some((z) => /Sicherung/.test(z.text)), false, 'ohne Angabe keine Zeile');
});

test('Sicherung: Punkt nur auf dem Verwalter-Handy, wenn die letzte Sicherung zu alt ist', () => {
  const alt = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), verwalter: true, gesichert: JETZT - 40 * TAG });
  assert.equal(alt.bereich.punkt(), true);
  assert.equal(alt.punkt.hidden, false);
  assert.match(alt.html(), /Letzte Sicherung: vor 40 Tagen/);
  const nie = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), verwalter: true, gesichert: null });
  assert.equal(nie.bereich.punkt(), true);
  const frisch = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), verwalter: true });
  assert.equal(frisch.bereich.punkt(), false);
  const anderes = aufbau({ anmeldung: testAnmeldung({ zustand: 'angemeldet' }), gesichert: null });
  assert.equal(anderes.bereich.punkt(), false, 'anderes Handy: nie ein Punkt');
  assert.match(anderes.html(), /Noch nie gesichert/, 'in der Verwaltung steht es trotzdem');
});

test('Sicherung: nach „Alles sichern“ verschwindet der Punkt', async () => {
  const server = testServer([{ konto: 'k1', name: 'Handy 1', letzter_abgleich: new Date(JETZT).toISOString() }]);
  const { bereich, punkt, tippe } = mitVerwaltung({
    anmeldung: testAnmeldung({ zustand: 'angemeldet' }), verwalter: true, gesichert: null, server,
  });
  bereich.oeffneVerwaltung();
  assert.equal(punkt.hidden, false);
  tippe('sichern');
  await warte();
  assert.equal(punkt.hidden, true);
});

test('Verwaltung: „Alles sichern“ gibt die Datei weiter und merkt sich den Zeitpunkt', async () => {
  const uhr = { jetzt: JETZT };
  const { bereich, speicher, ziel, tippe, protokoll } = mitVerwaltung({ gesichert: null, uhr });
  speichereEigeneVorlage(speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 500 });
  bereich.oeffneVerwaltung();
  assert.match(ziel.innerHTML, /Noch nie gesichert/);
  assert.match(ziel.innerHTML, /data-verwaltung="sichern"/);
  assert.match(ziel.innerHTML, /data-verwaltung="wiederherstellen"/);
  uhr.jetzt += 5 * TAG;
  tippe('sichern');
  await warte();
  assert.equal(protokoll.sicherungen.length, 1);
  assert.match(protokoll.sicherungen[0].name, /^kochbuch-sicherung-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(protokoll.sicherungen[0].inhalt, /"Brot"/);
  assert.equal(letzteSicherung(speicher), JETZT + 5 * TAG);
  assert.match(ziel.innerHTML, /Gesichert\./);
  assert.match(ziel.innerHTML, /Letzte Sicherung: heute/);
});

test('Verwaltung: Teilen-Menü geschlossen oder Fehler → Zeitpunkt bleibt', async () => {
  const zu = mitVerwaltung({ gesichert: null, teilen: async () => false });
  zu.bereich.oeffneVerwaltung();
  zu.tippe('sichern');
  await warte();
  assert.equal(letzteSicherung(zu.speicher), null);
  assert.doesNotMatch(zu.ziel.innerHTML, /Gesichert\./);

  const kaputt = mitVerwaltung({ gesichert: null, teilen: async () => { throw new Error('x'); } });
  kaputt.bereich.oeffneVerwaltung();
  kaputt.tippe('sichern');
  await warte();
  assert.equal(letzteSicherung(kaputt.speicher), null);
  assert.match(kaputt.ziel.innerHTML, /Sichern hat nicht geklappt/);
});

/** Datei wählen wie im Browser (Ereignis „change“ an der unsichtbaren Dateiauswahl). */
function waehleDatei(ziel, inhalt) {
  const feld = {
    matches: (s) => s === '[data-verwaltung-datei]',
    files: [{ size: inhalt.length, text: async () => inhalt }],
    value: 'C:\\fakepath\\sicherung.json',
  };
  ziel.loese('change', { target: feld });
  return feld;
}

test('Verwaltung: Wiederherstellen fragt nach und holt nur Fehlendes zurück', async () => {
  // Handy A sichert, auf Handy B fehlt dann eine Vorlage
  const a = mitVerwaltung();
  const brot = speichereEigeneVorlage(a.speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 500 });
  speichereEigeneVorlage(a.speicher, { name: 'Pizza', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 300 });
  a.bereich.oeffneVerwaltung();
  a.tippe('sichern');
  await warte();
  const inhalt = a.protokoll.sicherungen[0].inhalt;

  const b = mitVerwaltung({ antworten: [true] });
  speichereEigeneVorlage(b.speicher, { id: brot.id, name: 'Brot neu', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 700 });
  b.bereich.oeffneVerwaltung();
  const feld = waehleDatei(b.ziel, inhalt);
  assert.equal(feld.value, '', 'gleiche Datei später wieder wählbar');
  await warte();
  assert.match(b.protokoll.fragen[0], /Sicherung vom .*: 1 Vorlage fehlt hier und wird wiederhergestellt/);
  const namen = alleVorlagen(b.speicher).filter((v) => !v.eingebaut).map((v) => v.name).sort();
  assert.deepEqual(namen, ['Brot neu', 'Pizza'], 'Vorhandenes bleibt, Fehlendes kommt zurück');
  assert.match(b.ziel.innerHTML, /1 Eintrag wiederhergestellt/);
  assert.equal(b.protokoll.neuGezeichnet, 1);
});

test('Verwaltung: Wiederherstellen – Nein, nichts fehlt, fremde Datei', async () => {
  const a = mitVerwaltung();
  speichereEigeneVorlage(a.speicher, { name: 'Brot', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 500 });
  a.bereich.oeffneVerwaltung();
  a.tippe('sichern');
  await warte();
  const inhalt = a.protokoll.sicherungen[0].inhalt;

  const nein = mitVerwaltung({ antworten: [false] });
  nein.bereich.oeffneVerwaltung();
  waehleDatei(nein.ziel, inhalt);
  await warte();
  assert.equal(nein.protokoll.fragen.length, 1);
  assert.equal(alleVorlagen(nein.speicher).filter((v) => !v.eingebaut).length, 0);

  a.bereich.oeffneVerwaltung();
  waehleDatei(a.ziel, inhalt);
  await warte();
  assert.equal(a.protokoll.fragen.length, 0);
  assert.match(a.ziel.innerHTML, /Nichts wiederherzustellen/);

  const fremd = mitVerwaltung();
  fremd.bereich.oeffneVerwaltung();
  waehleDatei(fremd.ziel, '{"hallo": 1}');
  await warte();
  assert.match(fremd.ziel.innerHTML, /keine Sicherung des Kochbuchs/);
});
