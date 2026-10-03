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
// Für den Abgleich (Etappe 2) trägt jeder Datensatz intern ein Feld `sync`:
//   version – Server-Version, auf der der Stand hier beruht (0 = nie auf dem Server)
//   offen   – true, solange eine Änderung von hier noch nicht hochgeladen ist
// Datensätze ohne `sync` (von vor Etappe 2) gelten als offen mit Version 0.
// Nach außen (alle, hole) wird `sync` nie mitgegeben.
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
    return Array.isArray(liste) ? liste.filter((d) => d && typeof d === 'object' && typeof d.id === 'string') : [];
  };

  const sammlungSchreiben = (sammlung, liste) => schreib(`daten.${sammlung}`, liste);

  /** Ersetzt den Datensatz mit gleicher id oder hängt ihn an. */
  const einsetzen = (liste, datensatz) =>
    liste.some((d) => d.id === datensatz.id)
      ? liste.map((d) => (d.id === datensatz.id ? datensatz : d))
      : [...liste, datensatz];

  /** Lokale Änderung: auf der bisherigen Server-Version aufbauen, als offen markieren. */
  const alsOffen = (datensatz, alt) => ({ ...datensatz, sync: { version: syncVon(alt).version, offen: true } });

  // Zuhörer für lokale Änderungen (Auslöser für den Abgleich kurz nach dem Speichern)
  const zuhoerer = new Set();
  const gemeldet = (ok) => {
    if (ok) {
      for (const f of zuhoerer) {
        try {
          f();
        } catch {
          // ein Zuhörer darf das Speichern nie stören
        }
      }
    }
    return ok;
  };

  return {
    /** Alle nicht gelöschten Datensätze einer Sammlung, älteste zuerst. */
    alle(sammlung) {
      return sammlungLesen(sammlung)
        .filter((d) => !d.geloescht)
        .sort((a, b) => a.erstellt - b.erstellt)
        .map(ohneSync);
    },

    hole(sammlung, id) {
      const d = sammlungLesen(sammlung).find((x) => x.id === id && !x.geloescht);
      return d ? ohneSync(d) : null;
    },

    /** Legt einen Datensatz an oder ändert ihn. Gibt den gespeicherten Datensatz zurück. */
    speichere(sammlung, daten) {
      const liste = sammlungLesen(sammlung);
      const zeit = jetzt();
      const alt = daten.id ? liste.find((d) => d.id === daten.id) : null;
      const datensatz = {
        ...ohneSync(daten),
        id: daten.id ?? neueId(),
        erstellt: alt?.erstellt ?? zeit,
        geaendert: zeit,
        geloescht: false,
      };
      return gemeldet(sammlungSchreiben(sammlung, einsetzen(liste, alsOffen(datensatz, alt)))) ? datensatz : null;
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
      const datensatz = { ...ohneSync(daten), erstellt: alt?.erstellt ?? jetzt(), geloescht: false };
      return gemeldet(sammlungSchreiben(sammlung, einsetzen(liste, alsOffen(datensatz, alt)))) ? ergebnis : null;
    },

    /** Markiert als gelöscht. Die Nutzdaten werden entfernt, nur der "Grabstein" bleibt. */
    loesche(sammlung, id) {
      const liste = sammlungLesen(sammlung).map((d) =>
        d.id === id
          ? alsOffen({ id: d.id, erstellt: d.erstellt, geaendert: jetzt(), geloescht: true }, d)
          : d,
      );
      return gemeldet(sammlungSchreiben(sammlung, liste));
    },

    /**
     * `f()` wird nach jeder lokalen Änderung aufgerufen (speichere, uebernimm, loesche) –
     * nicht bei Daten vom Server. Gibt eine Funktion zum Abmelden zurück.
     */
    beiAenderung(f) {
      zuhoerer.add(f);
      return () => zuhoerer.delete(f);
    },

    // ---- Abgleich mit dem Server (Etappe 2) ----

    /**
     * Änderungen seit dem letzten Abgleich: alle offenen Datensätze einer Sammlung,
     * auch Grabsteine. Je Eintrag { datensatz, version } – version ist die Server-Version,
     * auf der die Änderung beruht (0 = neu).
     */
    offene(sammlung) {
      return sammlungLesen(sammlung)
        .filter((d) => syncVon(d).offen)
        .map((d) => ({ datensatz: ohneSync(d), version: syncVon(d).version }));
    },

    /**
     * Nach erfolgreichem Hochladen: neue Server-Version merken. Nicht mehr offen ist der
     * Datensatz nur, wenn er seit dem Hochladen hier nicht erneut geändert wurde
     * (`datensatz` = der hochgeladene Stand). Sonst bleibt er offen, beruht aber auf der neuen Version.
     */
    hochgeladen(sammlung, datensatz, version) {
      if (!gueltigeVersion(version)) return false;
      const liste = sammlungLesen(sammlung);
      const alt = liste.find((d) => d.id === datensatz.id);
      if (!alt || version <= syncVon(alt).version) return false;
      const unveraendert = gleich(ohneSync(alt), ohneSync(datensatz));
      return sammlungSchreiben(sammlung, einsetzen(liste, { ...alt, sync: { version, offen: !unveraendert } }));
    },

    /**
     * Nach einem Konflikt, wenn die eigene Änderung trotzdem gelten soll: Sie bleibt offen,
     * beruht aber ab jetzt auf der Server-Version `version` (0 = gibt es auf dem Server nicht).
     * Nur für offene Datensätze.
     */
    neueBasis(sammlung, id, version) {
      if (!Number.isSafeInteger(version) || version < 0) return false;
      const liste = sammlungLesen(sammlung);
      const alt = liste.find((d) => d.id === id);
      if (!alt || !syncVon(alt).offen) return false;
      return sammlungSchreiben(sammlung, einsetzen(liste, { ...alt, sync: { version, offen: true } }));
    },

    /**
     * Übernimmt einen Datensatz vom Server: { id, daten, geloescht, version }.
     * Ergebnis:
     *   'uebernommen' – gespeichert, nicht offen
     *   'bekannt'     – diese oder eine neuere Server-Version ist hier schon bekannt
     *   'offen'       – hier gibt es eine noch nicht hochgeladene Änderung; nichts geändert
     *                   (mit `{ offeneErsetzen: true }` wird sie überschrieben – nur nach Konfliktlösung)
     *   'ungueltig'   – unbrauchbare Daten vom Server; nichts geändert
     *   null          – Speichern gescheitert
     */
    vomServer(sammlung, { id, daten, geloescht, version }, { offeneErsetzen = false } = {}) {
      const istObjekt = daten && typeof daten === 'object' && !Array.isArray(daten);
      if (typeof id !== 'string' || !id || !gueltigeVersion(version) || (!geloescht && !istObjekt)) return 'ungueltig';
      const liste = sammlungLesen(sammlung);
      const alt = liste.find((d) => d.id === id);
      if (alt && syncVon(alt).version >= version) return 'bekannt';
      if (alt && syncVon(alt).offen && !offeneErsetzen) return 'offen';
      const zahl = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      const erstellt = zahl(daten?.erstellt) ?? alt?.erstellt ?? jetzt();
      const geaendert = zahl(daten?.geaendert) ?? jetzt();
      const datensatz = geloescht
        ? { id, erstellt, geaendert, geloescht: true }
        : { ...ohneSync(daten), id, erstellt, geaendert, geloescht: false };
      return sammlungSchreiben(sammlung, einsetzen(liste, { ...datensatz, sync: { version, offen: false } }))
        ? 'uebernommen'
        : null;
    },

    /** Server-Stand des letzten Herunterladens („alles seit …“), 0 = noch nie. */
    syncStand() {
      const stand = lies('sync.stand', 0);
      return Number.isSafeInteger(stand) && stand >= 0 ? stand : 0;
    },

    setzeSyncStand(stand) {
      return Number.isSafeInteger(stand) && stand >= 0 ? schreib('sync.stand', stand) : false;
    },

    einstellung(name, ersatz = null) {
      return lies(`geraet.${name}`, ersatz);
    },

    setzeEinstellung(name, wert) {
      return schreib(`geraet.${name}`, wert);
    },
  };
}

/** Sync-Angaben eines gespeicherten Datensatzes; fehlen sie (alt), gilt er als offen. */
function syncVon(d) {
  const s = d?.sync;
  if (!s || typeof s !== 'object') return { version: 0, offen: true };
  return { version: gueltigeVersion(s.version) ? s.version : 0, offen: s.offen !== false };
}

function ohneSync(d) {
  const { sync, ...rest } = d;
  return rest;
}

const gueltigeVersion = (v) => Number.isSafeInteger(v) && v > 0;

/** Inhaltlich gleich? (gleiche Herkunft → gleiche Reihenfolge der Felder) */
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
