// anmeldung.js – Anmeldung bei Supabase (Etappe 2). Anbieter-Teil, zusammen mit server.js.
//
// Einmal pro Handy: E-Mail + Passwort → Zugangsschlüssel (kurzlebig, ~1 Stunde) und
// Erneuerungsschlüssel (läuft nicht ab). E-Mail und Passwort werden nicht gespeichert.
// Danach erneuert die App den Zugangsschlüssel still, nie wieder eine Anmeldung.
//
// Regeln beim Erneuern:
//   - immer nur einmal gleichzeitig (alle Anfragen warten auf dasselbe Erneuern)
//   - neuen Schlüssel sofort speichern
//   - kein Netz, Server pausiert, Server-Fehler → nichts ändern, später noch einmal
//   - nur wenn Supabase den Erneuerungsschlüssel ausdrücklich ablehnt, gilt das Handy als
//     abgemeldet (`zustand()` = 'abgelehnt'); das zeigt später nur das Verwalter-Handy
// Abgebrochenes Erneuern (App geschlossen, Netz weg, bevor die Antwort ankam): Der alte
// Schlüssel ist dann auf dem Server schon ersetzt. Supabase gibt für ihn aber den aktuellen
// zurück, solange er der direkte Vorgänger ist („Elternschlüssel“) – es meldet also nicht ab.
//
// Ablaufzeit: aus `expires_in` (Sekunden ab Antwort) mit der Uhr des Handys gerechnet, nicht
// aus `expires_at` (Uhr des Servers) – so stört eine falsch gehende Handy-Uhr nicht.
//
// Gespeichert als Geräte-Einstellung 'anmeldung' (nie im Sync, nie im Link):
//   { zugang, erneuerung, ablauf (ms, Handy-Uhr), konto (Konto-id), abgelehnt? }

import { SERVER_ADRESSE, OEFFENTLICHER_SCHLUESSEL, zeitgrenze } from './server.js';

const EINSTELLUNG = 'anmeldung';
const VORLAUF = 60_000;     // so lange vor Ablauf schon erneuern (ms)

// Antworten von Supabase, die sicher heißen: Dieser Erneuerungsschlüssel gilt nicht mehr.
const ABGELEHNT = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
]);

export function erstelleAnmeldung({
  speicher,
  fetch = (...a) => globalThis.fetch(...a),
  adresse = SERVER_ADRESSE,
  schluessel = OEFFENTLICHER_SCHLUESSEL,
  jetzt = () => Date.now(),
}) {
  let erneuernLaeuft = null;

  /** Gespeicherte Anmeldung, geprüft; null = keine (brauchbare). */
  function gespeichert() {
    const a = speicher.einstellung(EINSTELLUNG);
    if (!a || typeof a !== 'object') return null;
    if (typeof a.erneuerung !== 'string' || !a.erneuerung) return null;
    return {
      zugang: typeof a.zugang === 'string' ? a.zugang : '',
      erneuerung: a.erneuerung,
      ablauf: Number.isFinite(a.ablauf) ? a.ablauf : 0,
      konto: typeof a.konto === 'string' ? a.konto : '',
      abgelehnt: a.abgelehnt === true,
    };
  }

  /** Antwort von /token prüfen und sofort speichern. Gibt die Anmeldung zurück oder null. */
  function sichern(antwort, konto) {
    if (!antwort || typeof antwort.access_token !== 'string' || typeof antwort.refresh_token !== 'string'
      || !antwort.access_token || !antwort.refresh_token) return null;
    const dauer = Number.isFinite(antwort.expires_in) && antwort.expires_in > 0 ? antwort.expires_in : 3600;
    const neu = {
      zugang: antwort.access_token,
      erneuerung: antwort.refresh_token,
      ablauf: jetzt() + dauer * 1000,
      konto: typeof antwort.user?.id === 'string' ? antwort.user.id : konto,
    };
    speicher.setzeEinstellung(EINSTELLUNG, neu); // klappt das nicht: Schlüssel gilt trotzdem für diese Sitzung
    return neu;
  }

  /** POST an /auth/v1/token. Ergebnis { status, daten } oder wirft (kein Netz, Zeit abgelaufen). */
  async function token(art, inhalt) {
    const antwort = await fetch(`${adresse}/auth/v1/token?grant_type=${art}`, {
      method: 'POST',
      headers: { apikey: schluessel, 'Content-Type': 'application/json' },
      body: JSON.stringify(inhalt),
      signal: zeitgrenze(),
    });
    let daten = null;
    try {
      daten = await antwort.json();
    } catch {
      // kein JSON (z. B. Fehlerseite) – zählt wie ein Server-Fehler
    }
    return { status: antwort.status, daten };
  }

  async function erneuernJetzt() {
    const alt = gespeichert();
    if (!alt || alt.abgelehnt) return null;
    let antwort;
    try {
      antwort = await token('refresh_token', { refresh_token: alt.erneuerung });
    } catch {
      return null; // kein Netz o. Ä.: alles bleibt, wie es ist
    }
    // Inzwischen abgemeldet (oder neu angemeldet)? Dann die Antwort nicht mehr speichern.
    if (gespeichert()?.erneuerung !== alt.erneuerung) return null;
    if (antwort.status === 200) return sichern(antwort.daten, alt.konto)?.zugang ?? null;

    const code = antwort.daten?.error_code ?? antwort.daten?.code;
    const endgueltig = (antwort.status === 400 || antwort.status === 401 || antwort.status === 403)
      && (ABGELEHNT.has(code) || antwort.daten?.error === 'invalid_grant');
    if (endgueltig) {
      speicher.setzeEinstellung(EINSTELLUNG, { ...alt, abgelehnt: true });
    }
    return null;
  }

  function erneuern() {
    if (!erneuernLaeuft) {
      erneuernLaeuft = erneuernJetzt().finally(() => {
        erneuernLaeuft = null;
      });
    }
    return erneuernLaeuft;
  }

  return {
    /**
     * Einmalige Anmeldung mit E-Mail und Passwort. Wirft nie. Ergebnis:
     *   { ok: true } oder { ok: false, grund: 'falsch' | 'netz' | 'zuoft' | 'server' }
     */
    async anmelden(email, passwort) {
      let antwort;
      try {
        antwort = await token('password', { email: String(email).trim(), password: String(passwort) });
      } catch {
        return { ok: false, grund: 'netz' };
      }
      if (antwort.status === 200) {
        return sichern(antwort.daten, '') ? { ok: true } : { ok: false, grund: 'server' };
      }
      if (antwort.status === 429) return { ok: false, grund: 'zuoft' };
      if (antwort.status === 400 || antwort.status === 401 || antwort.status === 422) return { ok: false, grund: 'falsch' };
      return { ok: false, grund: 'server' };
    },

    /**
     * Gültiger Zugangsschlüssel für Anfragen an den Server, bei Bedarf still erneuert.
     * null = gerade keiner (nicht angemeldet, abgelehnt, kein Netz). Wirft nie.
     * `{ erneuern: true }` erneuert auf jeden Fall (wenn der Server den Schlüssel nicht annimmt).
     */
    async zugangsschluessel({ erneuern: erzwingen = false } = {}) {
      const a = gespeichert();
      if (!a || a.abgelehnt) return null;
      if (!erzwingen && a.zugang && a.ablauf - VORLAUF > jetzt()) return a.zugang;
      return erneuern();
    },

    /**
     * Abmelden (versteckte Verwalter-Funktion). Vergisst die Schlüssel auf diesem Handy sofort;
     * Supabase wird – wenn es gerade geht – gebeten, den Erneuerungsschlüssel zu entwerten.
     * Daten bleiben unberührt (offene Änderungen gehen nach der nächsten Anmeldung hoch). Wirft nie.
     */
    async abmelden() {
      const a = gespeichert();
      speicher.setzeEinstellung(EINSTELLUNG, null);
      if (!a?.zugang || a.abgelehnt || a.ablauf <= jetzt()) return;
      try {
        await fetch(`${adresse}/auth/v1/logout?scope=local`, {
          method: 'POST',
          headers: { apikey: schluessel, Authorization: `Bearer ${a.zugang}` },
          signal: zeitgrenze(5000),
        });
      } catch {
        // kein Netz: Auf diesem Handy ist trotzdem abgemeldet
      }
    },

    /** 'abgemeldet' (nie angemeldet) | 'angemeldet' | 'abgelehnt' (neu anmelden nötig) */
    zustand() {
      const a = gespeichert();
      if (!a) return 'abgemeldet';
      return a.abgelehnt ? 'abgelehnt' : 'angemeldet';
    },

    /** Konto-id des angemeldeten Kontos ('' = unbekannt). */
    konto() {
      return gespeichert()?.konto ?? '';
    },
  };
}
