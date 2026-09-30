// vorlagen.js – die fest eingebauten Vorlagen.
// Sie stehen hier in Gramm, so wie man ein Rezept aufschreibt,
// und werden beim Laden in Prozent umgerechnet.
// Eigene Vorlagen landen NICHT hier, sondern im Speicher auf dem Handy.

import { teigAusGramm } from './rechner.js';

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

/** Liefert { teig, gesamtmehl } als frische Kopie, damit Änderungen die Vorlage nicht verändern. */
export function ladeVorlage(vorlage) {
  return teigAusGramm(vorlage.rezept);
}
