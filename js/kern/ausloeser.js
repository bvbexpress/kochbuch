// ausloeser.js – wann abgeglichen wird (Etappe 2, Schritt F).
//
// Auslöser: App-Start, Rückkehr in die App, Netz wieder da, kurz nach dem Speichern.
// Verlässt man die App, während eine Änderung noch auf ihren Abgleich wartet, geht sie sofort hoch
// (iOS gibt dafür noch ein paar Sekunden).
// Ob abgeglichen werden darf, sagt `bereit()` (angemeldet, Sicherung vor dem ersten Hochladen erledigt).
// Fehler sieht niemand: sync.js wirft nie, offene Änderungen bleiben offen bis zum nächsten Auslöser.

export const NACH_DEM_SPEICHERN = 2000; // so lange nach der letzten Änderung warten (ms)

/**
 *   sync         – aus `erstelleSync` (abgleichen() wirft nie, läuft nie doppelt)
 *   bereit       – () => true, wenn jetzt abgeglichen werden darf
 *   nachAbgleich – (bericht) => …, nach jedem Abgleich (z. B. Seite neu zeichnen)
 *   umgebung     – Fenster mit document, addEventListener, setTimeout (für Tests ersetzbar)
 * Ergebnis: { start(), jetzt(), nachAenderung() }
 */
export function erstelleAusloeser({ sync, bereit, nachAbgleich = () => {}, umgebung = globalThis }) {
  let wartet = null; // Zeitgeber nach dem Speichern

  function jetzt() {
    if (wartet !== null) {
      umgebung.clearTimeout(wartet);
      wartet = null;
    }
    if (!bereit()) return Promise.resolve(null);
    return sync.abgleichen().then((bericht) => {
      try {
        nachAbgleich(bericht);
      } catch {
        // die Anzeige darf den Abgleich nie stören
      }
      return bericht;
    });
  }

  return {
    start() {
      umgebung.document?.addEventListener('visibilitychange', () => {
        if (umgebung.document.visibilityState === 'visible') jetzt();
        else if (wartet !== null) jetzt(); // App wird verlassen: Wartendes gleich hochladen
      });
      umgebung.addEventListener?.('online', () => jetzt());
      return jetzt();
    },

    /** Sofort abgleichen (z. B. nach der Anmeldung). Ergebnis: Bericht oder null (nicht bereit). */
    jetzt,

    /** Nach einer lokalen Änderung: kurz warten (weitere Änderungen sammeln), dann abgleichen. */
    nachAenderung() {
      if (wartet !== null) umgebung.clearTimeout(wartet);
      wartet = umgebung.setTimeout(() => {
        wartet = null;
        jetzt();
      }, NACH_DEM_SPEICHERN);
    },
  };
}
