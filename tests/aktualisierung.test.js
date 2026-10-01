// Tests für Update-Hinweis und Bildschirm-an – mit nachgebauten Browser-Teilen statt echtem iPhone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { starteOfflineBetrieb } from '../js/kern/aktualisierung.js';
import { bildschirmAnLassen } from '../js/kern/bildschirm.js';

/** Dokument, dessen Sichtbarkeit sich umschalten lässt. */
function testDokument(sichtbar = true) {
  const dok = new EventTarget();
  dok.visibilityState = sichtbar ? 'visible' : 'hidden';
  dok.zeige = (wert) => {
    dok.visibilityState = wert ? 'visible' : 'hidden';
    dok.dispatchEvent(new Event('visibilitychange'));
  };
  return dok;
}

const warte = () => new Promise((r) => setTimeout(r, 0));

// ---------- Update-Hinweis ----------

function testServiceWorker({ controller = true, wartend = false } = {}) {
  const gesendet = [];
  const neuerWorker = () => Object.assign(new EventTarget(), {
    state: 'installing',
    postMessage: (n) => gesendet.push(n),
  });
  const registrierung = Object.assign(new EventTarget(), {
    waiting: wartend ? neuerWorker() : null,
    installing: null,
    updates: 0,
    update: async () => { registrierung.updates += 1; },
  });
  const sw = Object.assign(new EventTarget(), {
    controller: controller ? {} : null,
    register: async () => registrierung,
  });
  // Simuliert: Neue Version wurde im Hintergrund geladen
  const neueVersion = () => {
    const w = neuerWorker();
    registrierung.installing = w;
    registrierung.dispatchEvent(new Event('updatefound'));
    w.state = 'installed';
    registrierung.installing = null;
    registrierung.waiting = w;
    w.dispatchEvent(new Event('statechange'));
  };
  return { sw, registrierung, gesendet, neueVersion };
}

function testUmgebung(sw) {
  const location = { neuGeladen: 0, reload() { this.neuGeladen += 1; } };
  return { navigator: { serviceWorker: sw }, document: testDokument(), location };
}

test('Ohne Service Worker im Browser: kein Fehler, App läuft weiter', async () => {
  assert.equal(await starteOfflineBetrieb(() => {}, { navigator: {}, document: testDokument() }), null);
});

test('Erster Start (noch kein controller): kein Update-Hinweis', async () => {
  const t = testServiceWorker({ controller: false, wartend: true });
  let hinweise = 0;
  await starteOfflineBetrieb(() => hinweise++, testUmgebung(t.sw));
  assert.equal(hinweise, 0);
});

test('Wartende neue Version beim Start → Hinweis; Tipper aktiviert und lädt neu', async () => {
  const t = testServiceWorker({ wartend: true });
  const umgebung = testUmgebung(t.sw);
  let aktualisieren = null;
  await starteOfflineBetrieb((f) => { aktualisieren = f; }, umgebung);
  assert.equal(typeof aktualisieren, 'function');

  aktualisieren();
  assert.deepEqual(t.gesendet, ['aktivieren']);
  assert.equal(umgebung.location.neuGeladen, 0); // erst wenn der neue Worker übernimmt
  t.sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(umgebung.location.neuGeladen, 1);
});

test('Neue Version während die App offen ist → Hinweis', async () => {
  const t = testServiceWorker();
  let hinweise = 0;
  await starteOfflineBetrieb(() => hinweise++, testUmgebung(t.sw));
  assert.equal(hinweise, 0);
  t.neueVersion();
  assert.equal(hinweise, 1);
});

test('Ohne Tipper kein Neuladen, auch wenn ein anderer Worker übernimmt', async () => {
  const t = testServiceWorker();
  const umgebung = testUmgebung(t.sw);
  await starteOfflineBetrieb(() => {}, umgebung);
  t.sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(umgebung.location.neuGeladen, 0);
});

test('Rückkehr in die App → nach Updates suchen', async () => {
  const t = testServiceWorker();
  const umgebung = testUmgebung(t.sw);
  await starteOfflineBetrieb(() => {}, umgebung);
  umgebung.document.zeige(false);
  umgebung.document.zeige(true);
  assert.equal(t.registrierung.updates, 1);
});

// ---------- Bildschirm bleibt an ----------

function testWakeLock({ fehler = false } = {}) {
  const wl = { anfragen: 0, sperren: [] };
  wl.request = async (art) => {
    assert.equal(art, 'screen');
    wl.anfragen += 1;
    if (fehler) throw new Error('nicht erlaubt');
    const sperre = new EventTarget();
    sperre.freigeben = () => sperre.dispatchEvent(new Event('release'));
    wl.sperren.push(sperre);
    return sperre;
  };
  return wl;
}

test('Bildschirm-an: Sperre gleich beim Start', async () => {
  const wl = testWakeLock();
  const b = bildschirmAnLassen({ navigator: { wakeLock: wl }, document: testDokument() });
  await warte();
  assert.equal(wl.anfragen, 1);
  assert.equal(b.aktiv(), true);
});

test('Bildschirm-an: nach Rückkehr in die App erneut angefordert', async () => {
  const wl = testWakeLock();
  const dok = testDokument();
  const b = bildschirmAnLassen({ navigator: { wakeLock: wl }, document: dok });
  await warte();
  // App geht in den Hintergrund: System gibt die Sperre frei
  dok.zeige(false);
  wl.sperren[0].freigeben();
  await warte();
  assert.equal(b.aktiv(), false);
  assert.equal(wl.anfragen, 1); // im Hintergrund keine neue Anfrage
  dok.zeige(true);
  await warte();
  assert.equal(wl.anfragen, 2);
  assert.equal(b.aktiv(), true);
});

test('Bildschirm-an: keine doppelten Anfragen, solange die Sperre steht', async () => {
  const wl = testWakeLock();
  const dok = testDokument();
  bildschirmAnLassen({ navigator: { wakeLock: wl }, document: dok });
  dok.dispatchEvent(new Event('click')); // während die erste Anfrage noch läuft
  await warte();
  dok.dispatchEvent(new Event('click'));
  dok.zeige(true);
  await warte();
  assert.equal(wl.anfragen, 1);
});

test('Bildschirm-an: abgelehnt → kein Fehler, beim nächsten Tipper neuer Versuch', async () => {
  const wl = testWakeLock({ fehler: true });
  const dok = testDokument();
  const b = bildschirmAnLassen({ navigator: { wakeLock: wl }, document: dok });
  await warte();
  assert.equal(b.aktiv(), false);
  dok.dispatchEvent(new Event('click'));
  await warte();
  assert.equal(wl.anfragen, 2);
});

test('Bildschirm-an: Browser ohne Wake Lock → nichts passiert', () => {
  const b = bildschirmAnLassen({ navigator: {}, document: testDokument() });
  assert.equal(b.aktiv(), false);
});
