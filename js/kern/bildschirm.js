// bildschirm.js – hält den Bildschirm an, solange die App offen ist (Wake Lock).
// Das System gibt die Sperre frei, sobald die App in den Hintergrund geht;
// bei der Rückkehr wird sie neu angefordert.

export function bildschirmAnLassen(umgebung = globalThis) {
  const { navigator, document } = umgebung;
  const wakeLock = navigator?.wakeLock;
  if (!wakeLock) return { aktiv: () => false, anfordern: async () => {} };

  let sperre = null;
  let laeuft = null; // laufende Anfrage, damit nicht doppelt angefordert wird

  function anfordern() {
    if (sperre || laeuft || document.visibilityState !== 'visible') return laeuft ?? Promise.resolve();
    laeuft = wakeLock.request('screen')
      .then((neu) => {
        sperre = neu;
        neu.addEventListener('release', () => {
          if (sperre === neu) sperre = null;
        });
      })
      .catch(() => {}) // z. B. Stromsparmodus – dann eben ohne
      .finally(() => {
        laeuft = null;
      });
    return laeuft;
  }

  document.addEventListener('visibilitychange', anfordern);
  // Falls der Browser die Sperre erst nach einer Berührung erlaubt: beim nächsten Tipper erneut versuchen
  document.addEventListener('click', anfordern, { capture: true, passive: true });
  anfordern();

  return { aktiv: () => sperre !== null, anfordern };
}
