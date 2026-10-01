// sw.js – Service Worker: macht die App offline nutzbar und bringt neue Versionen zuverlässig aufs Handy.
//
// So kommen Updates an:
// - VERSION ändert sich bei jeder Änderung an einer ausgelieferten Datei (ein Test prüft das).
//   Dadurch ist sw.js eine neue Datei, das Handy merkt das beim nächsten Öffnen.
// - Der neue Service Worker lädt alle Dateien frisch aus dem Netz in einen eigenen Cache.
// - Die App zeigt „Neue Version“; ein Tipper aktiviert sie und lädt neu.
// - Beim Aktivieren werden alte Caches gelöscht.
// - index.html wird zuerst im Netz versucht (mit Zeitlimit), offline kommt sie aus dem Cache.
//
// Alle Pfade relativ, weil die App unter /kochbuch/ läuft.

const VERSION = '0f4be4c8'; // = Prüfsumme der Dateien unten, siehe tests/pwa.test.js
const CACHE = `kochbuch-${VERSION}`;
const ZEITLIMIT_MS = 3000; // so lange wartet der Start höchstens auf das Netz

// Alles, was die App zum Laufen braucht (außer sw.js selbst)
const DATEIEN = [
  './index.html',
  './manifest.webmanifest',
  './css/basis.css',
  './css/teig.css',
  './js/app.js',
  './js/kern/aktualisierung.js',
  './js/kern/bildschirm.js',
  './js/kern/speicher.js',
  './js/kern/zahlen.js',
  './js/teig/ansicht.js',
  './js/teig/rechner.js',
  './js/teig/teilen.js',
  './js/teig/vorlagen.js',
  './js/teig/zutaten.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (ereignis) => {
  // cache: 'reload' umgeht den Browser-Cache – sonst könnten alte Dateien im neuen Cache landen
  ereignis.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(DATEIEN.map((datei) => new Request(datei, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen
      .filter((name) => name.startsWith('kochbuch-') && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ereignis) => {
  if (ereignis.data === 'aktivieren') self.skipWaiting();
  if (ereignis.data === 'version') ereignis.source?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET' || new URL(anfrage.url).origin !== self.location.origin) return;
  ereignis.respondWith(anfrage.mode === 'navigate' ? seite(anfrage) : datei(anfrage));
});

/** Die Seite selbst: zuerst Netz (mit Zeitlimit), sonst aus dem Cache. */
async function seite(anfrage) {
  try {
    const antwort = await mitZeitlimit(fetch(anfrage.url, { cache: 'no-cache' }));
    if (antwort.status < 500) return antwort;
  } catch {
    // offline oder zu langsam
  }
  const gespeichert = await caches.open(CACHE).then((cache) => cache.match('./index.html'));
  return gespeichert ?? fetch(anfrage);
}

/** Alle anderen Dateien: aus dem Cache dieser Version, nur wenn dort nicht vorhanden aus dem Netz. */
async function datei(anfrage) {
  const gespeichert = await caches.open(CACHE).then((cache) => cache.match(anfrage));
  return gespeichert ?? fetch(anfrage);
}

function mitZeitlimit(versprechen) {
  return new Promise((erfuellt, abgelehnt) => {
    const uhr = setTimeout(() => abgelehnt(new Error('Zeitlimit')), ZEITLIMIT_MS);
    versprechen.then(erfuellt, abgelehnt).finally(() => clearTimeout(uhr));
  });
}
