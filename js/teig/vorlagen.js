// vorlagen.js – eingebaute und eigene Vorlagen.
//
// Eingebaute Vorlagen stehen hier in Gramm, so wie man ein Rezept aufschreibt,
// und werden beim Laden in Prozent umgerechnet.
// Eigene Vorlagen liegen NICHT hier im Code, sondern im Speicher auf dem Handy
// (Sammlung "teigvorlagen") – in Prozent, zusammen mit der Mehlmenge.

import { teigAusGramm } from './rechner.js';
import { MEHLE, SAATEN, idNachName } from './zutaten.js';

// Version des Teig-Formats. 2 = Mehle/Saaten mit id, Quellwasser in % vom Gesamtmehl.
const FORMAT = 2;

const SAMMLUNG = 'teigvorlagen';

export const VORLAGEN = [
  {
    id: 'focaccia',
    name: 'Sauerteig-Focaccia',
    rezept: {
      mehlsorten: [{ id: 'tipo00', name: 'Tipo 00', gramm: 300 }],
      starter: 50,
      wasser: 225,
      salz: 7,
      oel: 15,
    },
  },
  {
    id: 'weizenvollkorn',
    name: 'Weizenvollkorn-Sauerteigbrot',
    rezept: {
      mehlsorten: [{ id: 'weizenvollkorn', name: 'Weizenvollkorn', gramm: 500 }],
      starter: 100,
      wasser: 400,
      salz: 11,
      saaten: [
        { id: 'sonnenblumenkerne', name: 'Sonnenblumenkerne', gramm: 50 },
        { id: 'leinsamen', name: 'Leinsamen', gramm: 25 },
      ],
      quellwasser: 80, // erprobt – bleibt so, unabhängig von den Quellverhältnissen
    },
  },
];

/** Eingebaute und eigene Vorlagen in einer Liste. Eigene haben eingebaut = false. */
export function alleVorlagen(speicher) {
  const eigene = speicher.alle(SAMMLUNG).filter((v) => istGueltigerTeig(v.teig));
  return [
    ...VORLAGEN.map((v) => ({ ...v, eingebaut: true })),
    ...eigene.map((v) => ({ ...v, teig: normalisiereTeig(v.teig), eingebaut: false })),
  ];
}

/** Liefert { teig, mehl } als frische Kopie, damit Änderungen die Vorlage nicht verändern. */
export function ladeVorlage(vorlage) {
  if (vorlage.rezept) {
    const { teig, mehl } = teigAusGramm(vorlage.rezept);
    return { teig: { ...teig, format: FORMAT }, mehl };
  }
  return { teig: normalisiereTeig(vorlage.teig), mehl: vorlage.mehl };
}

/** Speichert eine eigene Vorlage (neu ohne id, sonst Änderung). Gibt sie zurück oder null. */
export function speichereEigeneVorlage(speicher, { id, name, teig, mehl }) {
  return speicher.speichere(SAMMLUNG, {
    ...(id ? { id } : {}),
    name: name.trim(),
    teig: structuredClone(teig),
    mehl,
  });
}

export function loescheEigeneVorlage(speicher, id) {
  return speicher.loesche(SAMMLUNG, id);
}

/**
 * Prüft, ob gespeicherte Daten wie ein Teig aussehen.
 * Schützt vor kaputten oder veralteten Daten im Speicher.
 */
export function istGueltigerTeig(teig) {
  if (!teig || typeof teig !== 'object') return false;
  const zahlen = ['hydration', 'starter', 'salz', 'oel', 'hefe'];
  return (
    zahlen.every((k) => typeof teig[k] === 'number' && Number.isFinite(teig[k])) &&
    Array.isArray(teig.mehlsorten)
  );
}

/**
 * Bringt gespeicherte Teige auf das aktuelle Format (liefert immer eine Kopie).
 * Format 1 (Schritt 5): Mehle/Saaten nur mit Namen, Quellwasser in % der Saaten.
 */
export function normalisiereTeig(teig) {
  const kopie = structuredClone(teig);
  kopie.saaten = Array.isArray(kopie.saaten) ? kopie.saaten : [];
  if (kopie.format === FORMAT) return kopie;

  kopie.mehlsorten = kopie.mehlsorten.map((s) => ({ ...s, id: s.id ?? idNachName(MEHLE, s.name) }));
  kopie.saaten = kopie.saaten.map((s) => ({ ...s, id: s.id ?? idNachName(SAATEN, s.name) }));
  const saatenProzent = kopie.saaten.reduce((a, s) => a + (s.prozent || 0), 0);
  kopie.quellwasser = (saatenProzent * (kopie.quellwasser || 0)) / 100;
  kopie.format = FORMAT;
  return kopie;
}
