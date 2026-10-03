// server.js – Verbindung zum Server (Supabase). Einzige Stelle mit Anbieter-Angaben
// (zusammen mit anmeldung.js). Nur `fetch`, keine Bibliothek.
//
// Beide Werte sind öffentlich und dürfen im Repo stehen: Der Schlüssel erlaubt nur, was die
// Datenbank (Row Level Security, Rechte in datenbank/schema.sql) zulässt.
// Der geheime Schlüssel (secret) kommt NIE hierher, auch nicht ins Repo.

export const SERVER_ADRESSE = 'https://ewvhbgpxlmnvaqjkobgo.supabase.co';
export const OEFFENTLICHER_SCHLUESSEL = 'sb_publishable_3FqMIFogQnjx0GYSNwQKsg_QSAGI1j2';

const WARTEZEIT = 20_000; // längstens auf eine Antwort warten (ms)

/**
 * Server für den Abgleich (kern/sync.js): ruft die Datenbank-Funktionen aus datenbank/schema.sql auf.
 *   hochladen(aenderungen) → Liste der Ergebnisse
 *   herunterladen(seit)    → { datensaetze, stand, mehr }
 * Wirft bei jedem Problem (nicht angemeldet, kein Netz, Server-Fehler); sync.js fängt das ab.
 * Nimmt der Server den Zugangsschlüssel nicht an (z. B. Handy-Uhr falsch), wird einmal erneuert
 * und noch einmal versucht.
 */
export function erstelleServer({
  anmeldung,
  fetch = (...a) => globalThis.fetch(...a),
  adresse = SERVER_ADRESSE,
  schluessel = OEFFENTLICHER_SCHLUESSEL,
}) {
  async function rpc(funktion, inhalt) {
    for (let versuch = 0; versuch < 2; versuch++) {
      const zugang = await anmeldung.zugangsschluessel({ erneuern: versuch > 0 });
      if (!zugang) throw new Error('nicht angemeldet');
      const antwort = await fetch(`${adresse}/rest/v1/rpc/${funktion}`, {
        method: 'POST',
        headers: {
          apikey: schluessel,
          Authorization: `Bearer ${zugang}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inhalt),
        signal: zeitgrenze(),
      });
      if (antwort.status === 401 && versuch === 0) continue;
      if (!antwort.ok) throw new Error(`Server antwortet mit ${antwort.status}`);
      return antwort.json();
    }
    throw new Error('Zugangsschlüssel nicht angenommen');
  }

  return {
    hochladen: (aenderungen) => rpc('hochladen', { aenderungen }),
    herunterladen: (seit) => rpc('herunterladen', { seit }),
  };
}

/** Abbruch nach WARTEZEIT, damit eine hängende Anfrage den Abgleich nie blockiert. */
export function zeitgrenze(ms = WARTEZEIT) {
  return typeof globalThis.AbortSignal?.timeout === 'function' ? globalThis.AbortSignal.timeout(ms) : undefined;
}
