// sw.js – Service Worker: macht die App offline nutzbar und bringt neue Versionen zuverlässig aufs Handy.
//
// So kommen Updates an:
// - VERSION ändert sich bei jeder Änderung an einer ausgelieferten Datei (ein Test prüft das).
//   Dadurch ist sw.js eine neue Datei, das Handy merkt das beim nächsten Öffnen.
// - Der neue Service Worker lädt alle Dateien frisch aus dem Netz in einen eigenen Cache.
// - Die App zeigt „Neue Version“; ein Tipper aktiviert sie und lädt neu.
// - Beim Aktivieren werden alte Caches gelöscht.
// - Alles kommt aus dem Cache, auch index.html: sofortiger Start, auch offline.
//   Ob es ein Update gibt, prüft der Browser selbst anhand von sw.js.
//
// Alle Pfade relativ, weil die App unter /kochbuch/ läuft.

const VERSION = 'f2c4d8d6'; // = Prüfsumme der Dateien unten, siehe tests/pwa.test.js
const CACHE = `kochbuch-${VERSION}`;

// Alles, was die App zum Laufen braucht (außer sw.js selbst)
const DATEIEN = [
  './index.html',
  './manifest.webmanifest',
  './css/basis.css',
  './css/teig.css',
  './js/app.js',
  './js/kern/abgleich.js',
  './js/kern/aktualisierung.js',
  './js/kern/anmeldung.js',
  './js/kern/bildschirm.js',
  './js/kern/html.js',
  './js/kern/server.js',
  './js/kern/speicher.js',
  './js/kern/sync.js',
  './js/kern/zahlen.js',
  './js/teig/ansicht.js',
  './js/teig/rechner.js',
  './js/teig/startseite.js',
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

/** Die Seite selbst: aus dem Cache dieser Version (sofortiger Start), nur wenn dort nicht vorhanden aus dem Netz. */
async function seite(anfrage) {
  const gespeichert = await caches.open(CACHE).then((cache) => cache.match('./index.html'));
  return gespeichert ?? fetch(anfrage);
}

/** Alle anderen Dateien: aus dem Cache dieser Version, nur wenn dort nicht vorhanden aus dem Netz. */
async function datei(anfrage) {
  const gespeichert = await caches.open(CACHE).then((cache) => cache.match(anfrage));
  return gespeichert ?? fetch(anfrage);
}
