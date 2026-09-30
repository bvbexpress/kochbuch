// zutaten.js – Mehlsorten und Saaten mit ihren Wasserwerten.
//
// Eingebaute Sorten stehen hier im Code. Geänderte Werte und eigene Sorten
// liegen im Speicher (Sammlungen "mehle" und "saaten") und werden später
// zwischen den Handys synchronisiert:
// - Geänderter Standardwert: Datensatz mit der festen id der eingebauten Sorte
// - Eigene Sorte: Datensatz mit neuer UUID
// Zurücksetzen bzw. Löschen = Datensatz löschen (Grabstein).

/** Wasseraufnahme in %: typische Hydration, wenn das Mehl allein verwendet wird. */
export const MEHLE = [
  { id: 'tipo00', name: 'Tipo 00', wasser: 60 },
  { id: 'weizen550', name: 'Weizen 550', wasser: 65 },
  { id: 'weizenvollkorn', name: 'Weizenvollkorn', wasser: 75 },
  { id: 'dinkelvollkorn', name: 'Dinkelvollkorn', wasser: 70 },
  { id: 'roggen1150', name: 'Roggen 1150', wasser: 78, art: 'roggen' },
  { id: 'roggenvollkorn', name: 'Roggenvollkorn', wasser: 83, art: 'roggen' },
  { id: 'hafervollkorn', name: 'Hafervollkorn', wasser: 80, art: 'hafer' },
];

/** Quellverhältnis: Gramm Wasser je Gramm Saat. */
export const SAATEN = [
  { id: 'leinsamen', name: 'Leinsamen', verhaeltnis: 2.5 },
  { id: 'sonnenblumenkerne', name: 'Sonnenblumenkerne', verhaeltnis: 1 },
  { id: 'kuerbiskerne', name: 'Kürbiskerne', verhaeltnis: 1 },
  { id: 'sesam', name: 'Sesam', verhaeltnis: 1 },
  { id: 'chiasamen', name: 'Chiasamen', verhaeltnis: 5 },
  { id: 'haferflocken', name: 'Haferflocken', verhaeltnis: 2 },
];

export const STANDARD_WASSER = 65;      // Startwert für eigene Mehle
export const STANDARD_VERHAELTNIS = 1;  // Startwert für eigene Saaten

function katalog(sammlung, eingebaut, wertName, standard) {
  const gueltig = (d) =>
    d && typeof d.id === 'string' && typeof d[wertName] === 'number' && Number.isFinite(d[wertName]);

  return {
    /** Eingebaute (mit geänderten Werten) und eigene Sorten. */
    alle(speicher) {
      const gespeichert = speicher.alle(sammlung).filter(gueltig);
      const aenderung = new Map(gespeichert.map((d) => [d.id, d]));
      const feste = eingebaut.map((s) => ({
        ...s,
        [wertName]: aenderung.get(s.id)?.[wertName] ?? s[wertName],
        eingebaut: true,
        geaendertGegenueberStandard: aenderung.has(s.id),
        standard: s[wertName],
      }));
      const istEingebaut = new Set(eingebaut.map((s) => s.id));
      const eigene = gespeichert
        .filter((d) => !istEingebaut.has(d.id) && typeof d.name === 'string')
        .map((d) => ({ id: d.id, name: d.name, [wertName]: d[wertName], eingebaut: false }));
      return [...feste, ...eigene];
    },

    /** Wert ändern (eingebaut oder eigen). */
    setzeWert(speicher, id, wert) {
      const eigene = speicher.hole(sammlung, id);
      return speicher.speichere(sammlung, { ...(eigene ?? { id }), [wertName]: wert });
    },

    /** Neue eigene Sorte mit Startwert. */
    neu(speicher, name, wert = standard) {
      return speicher.speichere(sammlung, { name: name.trim(), [wertName]: wert });
    },

    /** Eigene Sorte löschen bzw. eingebaute auf den Standardwert zurücksetzen. */
    entferne(speicher, id) {
      return speicher.loesche(sammlung, id);
    },
  };
}

export const mehle = katalog('mehle', MEHLE, 'wasser', STANDARD_WASSER);
export const saaten = katalog('saaten', SAATEN, 'verhaeltnis', STANDARD_VERHAELTNIS);

/** Nachschlage-Funktion id → Wert; Unbekanntes bekommt den Startwert. */
export function werteVon(liste, wertName, standard) {
  const karte = new Map(liste.map((s) => [s.id, s[wertName]]));
  return (id) => karte.get(id) ?? standard;
}

/**
 * Art eines Mehls für Hinweise: 'hafer', 'roggen' oder null.
 * Eigene Mehle werden am Namen erkannt (z. B. "Roggen 997").
 */
export function artVon(liste) {
  const karte = new Map(liste.map((s) => [s.id, s]));
  return (id, name = '') => {
    const eintrag = karte.get(id);
    if (eintrag?.art) return eintrag.art;
    const text = (eintrag?.name ?? name).toLowerCase();
    if (text.includes('hafer')) return 'hafer';
    if (text.includes('roggen')) return 'roggen';
    return null;
  };
}

/** Sucht die eingebaute Sorte zu einem Namen (für ältere gespeicherte Daten ohne id). */
export function idNachName(liste, name) {
  return liste.find((s) => s.name === name)?.id ?? null;
}
