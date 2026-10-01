// aktualisierung.js – meldet den Service Worker an und sagt Bescheid, wenn eine neue Version bereitliegt.
// Die eigentliche Offline-Logik steht in ../../sw.js.

/**
 * Startet den Offline-Betrieb.
 *   beiNeuerVersion(aktualisieren) – wird aufgerufen, sobald eine neue Version geladen ist;
 *                                    aktualisieren() schaltet um und lädt die App neu.
 * Gibt die Registrierung zurück (oder null, wenn der Browser keinen Service Worker kann).
 */
export async function starteOfflineBetrieb(beiNeuerVersion, umgebung = globalThis) {
  const { navigator, document, location } = umgebung;
  const sw = navigator?.serviceWorker;
  if (!sw) return null;

  let neuLaden = false;
  sw.addEventListener('controllerchange', () => {
    if (neuLaden) location.reload();
  });

  let registrierung;
  try {
    // updateViaCache: 'none' – sw.js nie aus dem Browser-Cache, damit Updates sofort auffallen
    registrierung = await sw.register('./sw.js', { updateViaCache: 'none' });
  } catch {
    return null; // ohne Service Worker läuft die App trotzdem, nur nicht offline
  }

  function aktualisieren() {
    const wartend = registrierung.waiting;
    if (!wartend) return location.reload();
    neuLaden = true;
    wartend.postMessage('aktivieren');
  }

  // Beim allerersten Start gibt es noch keinen controller – dann ist es keine „neue“ Version
  function pruefe() {
    if (registrierung.waiting && sw.controller) beiNeuerVersion(aktualisieren);
  }

  pruefe();
  registrierung.addEventListener('updatefound', () => {
    const neu = registrierung.installing;
    neu?.addEventListener('statechange', () => {
      if (neu.state === 'installed') pruefe();
    });
  });

  // Die Homescreen-App bleibt oft tagelang im Hintergrund offen: bei jeder Rückkehr nach Updates sehen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registrierung.update().catch(() => {});
  });

  return registrierung;
}

/** Fragt den laufenden Service Worker nach seiner Version (oder null). */
export function frageVersion(umgebung = globalThis) {
  const sw = umgebung.navigator?.serviceWorker;
  if (!sw?.controller) return Promise.resolve(null);
  return new Promise((erfuellt) => {
    const antwort = (ereignis) => {
      if (typeof ereignis.data?.version !== 'string') return;
      sw.removeEventListener('message', antwort);
      erfuellt(ereignis.data.version);
    };
    sw.addEventListener('message', antwort);
    sw.controller.postMessage('version');
    setTimeout(() => erfuellt(null), 2000);
  });
}
