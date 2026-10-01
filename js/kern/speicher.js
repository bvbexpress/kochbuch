// speicher.js – die EINZIGE Stelle, die Daten dauerhaft speichert.
//
// Zwei Arten von Daten:
//
// 1. Datensätze (Vorlagen, später Rezepte und Vorräte) – sollen später
//    zwischen zwei Handys synchronisiert werden. Darum hat jeder Datensatz:
//      id         – weltweit eindeutig (UUID), auf beiden Handys gleich
//      geaendert  – Zeitpunkt der letzten Änderung (ms), neuere Version gewinnt
//      geloescht  – true statt echtem Löschen, damit das andere Handy
//                   vom Löschen erfährt ("Grabstein")
//
// 2. Geräte-Einstellungen (z. B. der zuletzt geöffnete Teig) – gehören
//    nur zu diesem Handy und werden nie synchronisiert.
//
// Wo gespeichert wird (localStorage), steckt im "Backend". Tests geben
// ein eigenes Backend im Arbeitsspeicher mit.

const PRAEFIX = 'kochbuch.v1.';

/** Backend im Arbeitsspeicher – für Tests und falls localStorage fehlt. */
export function speicherImArbeitsspeicher() {
  const daten = new Map();
  return {
    getItem: (k) => (daten.has(k) ? daten.get(k) : null),
    setItem: (k, v) => daten.set(k, String(v)),
  };
}

export function erstelleSpeicher(backend, jetzt = () => Date.now()) {
  function lies(schluessel, ersatz) {
    try {
      const text = backend.getItem(PRAEFIX + schluessel);
      return text === null ? ersatz : JSON.parse(text);
    } catch {
      return ersatz; // kaputte oder fehlende Daten sollen die App nie blockieren
    }
  }

  function schreib(schluessel, wert) {
    try {
      backend.setItem(PRAEFIX + schluessel, JSON.stringify(wert));
      return true;
    } catch {
      return false; // z. B. Speicher voll
    }
  }

  const sammlungLesen = (sammlung) => {
    const liste = lies(`daten.${sammlung}`, []);
    return Array.isArray(liste) ? liste : [];
  };

  return {
    /** Alle nicht gelöschten Datensätze einer Sammlung, älteste zuerst. */
    alle(sammlung) {
      return sammlungLesen(sammlung)
        .filter((d) => !d.geloescht)
        .sort((a, b) => a.erstellt - b.erstellt);
    },

    hole(sammlung, id) {
      return sammlungLesen(sammlung).find((d) => d.id === id && !d.geloescht) ?? null;
    },

    /** Legt einen Datensatz an oder ändert ihn. Gibt den gespeicherten Datensatz zurück. */
    speichere(sammlung, daten) {
      const liste = sammlungLesen(sammlung);
      const zeit = jetzt();
      const alt = daten.id ? liste.find((d) => d.id === daten.id) : null;
      const datensatz = {
        ...daten,
        id: daten.id ?? neueId(),
        erstellt: alt?.erstellt ?? zeit,
        geaendert: zeit,
        geloescht: false,
      };
      const neu = alt
        ? liste.map((d) => (d.id === datensatz.id ? datensatz : d))
        : [...liste, datensatz];
      return schreib(`daten.${sammlung}`, neu) ? datensatz : null;
    },

    /**
     * Vergleicht einen Datensatz von außen (z. B. aus einem Link) mit dem Gespeicherten:
     *   'neu'    – gibt es hier noch nicht (oder wurde gelöscht und ist jetzt neuer)
     *   'neuer'  – die Version von außen ist neuer als die hier
     *   'gleich' – gleicher Stand
     *   'aelter' – hier gibt es eine neuere Version (oder sie wurde danach gelöscht)
     */
    vergleiche(sammlung, daten) {
      const alt = sammlungLesen(sammlung).find((d) => d.id === daten.id);
      if (!alt) return 'neu';
      if (daten.geaendert > alt.geaendert) return alt.geloescht ? 'neu' : 'neuer';
      return daten.geaendert === alt.geaendert && !alt.geloescht ? 'gleich' : 'aelter';
    },

    /**
     * Übernimmt einen Datensatz von außen mit seiner id und seinem Änderungszeitpunkt.
     * Neuere Version gewinnt: bei 'gleich' oder 'aelter' passiert nichts.
     * Gibt das Ergebnis von `vergleiche` zurück, oder null wenn das Speichern scheitert.
     */
    uebernimm(sammlung, daten) {
      const ergebnis = this.vergleiche(sammlung, daten);
      if (ergebnis === 'gleich' || ergebnis === 'aelter') return ergebnis;
      const liste = sammlungLesen(sammlung);
      const alt = liste.find((d) => d.id === daten.id);
      const datensatz = { ...daten, erstellt: alt?.erstellt ?? jetzt(), geloescht: false };
      const neu = alt ? liste.map((d) => (d.id === datensatz.id ? datensatz : d)) : [...liste, datensatz];
      return schreib(`daten.${sammlung}`, neu) ? ergebnis : null;
    },

    /** Markiert als gelöscht. Die Nutzdaten werden entfernt, nur der "Grabstein" bleibt. */
    loesche(sammlung, id) {
      const liste = sammlungLesen(sammlung).map((d) =>
        d.id === id
          ? { id: d.id, erstellt: d.erstellt, geaendert: jetzt(), geloescht: true }
          : d,
      );
      return schreib(`daten.${sammlung}`, liste);
    },

    einstellung(name, ersatz = null) {
      return lies(`geraet.${name}`, ersatz);
    },

    setzeEinstellung(name, wert) {
      return schreib(`geraet.${name}`, wert);
    },
  };
}

function neueId() {
  return globalThis.crypto.randomUUID();
}

/** localStorage, falls verfügbar (in manchen privaten Modi nicht). */
function standardBackend() {
  try {
    const probe = `${PRAEFIX}probe`;
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return speicherImArbeitsspeicher();
  }
}

/** Bittet den Browser, die Daten nicht bei Platzmangel zu löschen. */
export function dauerhaftSpeichernAnfragen() {
  globalThis.navigator?.storage?.persist?.().catch(() => {});
}

// Der gemeinsame Speicher für die ganze App
export const speicher = typeof window === 'undefined'
  ? erstelleSpeicher(speicherImArbeitsspeicher())
  : erstelleSpeicher(standardBackend());
