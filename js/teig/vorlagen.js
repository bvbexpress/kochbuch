// vorlagen.js – eingebaute und eigene Vorlagen.
//
// Eingebaute Vorlagen stehen hier in Gramm, so wie man ein Rezept aufschreibt,
// und werden beim Laden in Prozent umgerechnet.
// Eigene Vorlagen liegen NICHT hier im Code, sondern im Speicher auf dem Handy
// (Sammlung "teigvorlagen") – in Prozent, zusammen mit der Mehlmenge.

import { teigAusGramm } from './rechner.js';

const SAMMLUNG = 'teigvorlagen';

export const VORLAGEN = [
  {
    id: 'focaccia',
    name: 'Sauerteig-Focaccia',
    rezept: {
      mehlsorten: [{ name: 'Tipo 00', gramm: 300 }],
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
      mehlsorten: [{ name: 'Weizenvollkorn', gramm: 500 }],
      starter: 100,
      wasser: 400,
      salz: 11,
      saaten: [
        { name: 'Sonnenblumenkerne', gramm: 50 },
        { name: 'Leinsamen', gramm: 25 },
      ],
      quellwasser: 80,
    },
  },
];

/** Eingebaute und eigene Vorlagen in einer Liste. Eigene haben eingebaut = false. */
export function alleVorlagen(speicher) {
  const eigene = speicher.alle(SAMMLUNG).filter((v) => istGueltigerTeig(v.teig));
  return [
    ...VORLAGEN.map((v) => ({ ...v, eingebaut: true })),
    ...eigene.map((v) => ({ ...v, eingebaut: false })),
  ];
}

/** Liefert { teig, mehl } als frische Kopie, damit Änderungen die Vorlage nicht verändern. */
export function ladeVorlage(vorlage) {
  if (vorlage.rezept) {
    const { teig, mehl } = teigAusGramm(vorlage.rezept);
    return { teig, mehl };
  }
  return { teig: structuredClone(vorlage.teig), mehl: vorlage.mehl };
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
