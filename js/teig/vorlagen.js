// vorlagen.js – eingebaute und eigene Vorlagen.
//
// Eingebaute Vorlagen stehen hier in Gramm, so wie man ein Rezept aufschreibt,
// und werden beim Laden in Prozent umgerechnet.
// Eigene Vorlagen liegen NICHT hier im Code, sondern im Speicher auf dem Handy
// (Sammlung "teigvorlagen") – in Prozent, zusammen mit der Mehlmenge.
//
// Jede Vorlage hat eine Kategorie (oder keine – ältere Vorlagen) und einen Modus:
//   'mehl'      – man gibt die Mehlmenge ein
//   'teiglinge' – man gibt Anzahl × Gewicht ein, das Mehl wird errechnet
// Favoriten und ausgeblendete Vorlagen sind Geräte-Einstellungen (jedes Handy hat eigene).

import { teigAusGramm, STANDARD_VERLUST } from './rechner.js';
import { MEHLE, SAATEN, idNachName } from './zutaten.js';

// Version des Teig-Formats. 2 = Mehle/Saaten mit id, Quellwasser in % vom Gesamtmehl.
const FORMAT = 2;

const SAMMLUNG = 'teigvorlagen';

/**
 * Kategorien in der Reihenfolge der Vorlagenliste.
 * teiglinge: Vorbelegung für neue Vorlagen – mit Angabe Teiglinge-Modus, ohne Mehl-Modus.
 */
export const KATEGORIEN = [
  { id: 'brot', name: 'Brot' },
  { id: 'broetchen', name: 'Brötchen', teiglinge: { anzahl: 8, gewicht: 85 } },
  { id: 'pizza', name: 'Pizza', teiglinge: { anzahl: 4, gewicht: 250 } },
  { id: 'focaccia', name: 'Focaccia' },
  { id: 'gebaeck', name: 'Gebäck' },
];
export const OHNE_KATEGORIE = 'Ohne Kategorie';
export const MODI = ['mehl', 'teiglinge'];
export const SUCHE_AB = 10; // ab so vielen sichtbaren Vorlagen gibt es eine Suche

/** Startwerte im Teiglinge-Modus, wenn noch nichts eingestellt ist. */
export const STANDARD_TEIGLINGE = { anzahl: 4, gewicht: 250, verlust: STANDARD_VERLUST };

/** Ausgangsbasis „leer“ für eine neue Vorlage: nur Mehl, Wasser, Salz. */
export const LEERER_TEIG = {
  hydration: 65, starter: 0, salz: 2, oel: 0, hefe: 0, hefeArt: 'frisch',
  mehlsorten: [{ id: 'weizen550', name: 'Weizen 550', anteil: 100 }],
  saaten: [], quellwasser: 0, zusaetze: [], format: FORMAT,
};
export const LEERES_MEHL = 500; // g zugegebenes Mehl

// Geräte-Einstellungen
const FAVORITEN = 'teig.favoriten';
const AUSGEBLENDET = 'teig.ausgeblendet';

export const VORLAGEN = [
  {
    id: 'focaccia',
    name: 'Focaccia',
    kategorie: 'focaccia',
    modus: 'mehl',
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
    name: 'Weizenvollkornbrot',
    kategorie: 'brot',
    modus: 'mehl',
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
    ...eigene.map((v) => ({
      ...v,
      teig: normalisiereTeig(v.teig),
      teiglinge: bereinigeTeiglinge(v.teiglinge),
      kategorie: bereinigeKategorie(v.kategorie),
      modus: modusVon(v),
      konflikt: bereinigeKonflikt(v.konflikt),
      eingebaut: false,
    })),
  ];
}

/**
 * Vermerk an einer Konflikt-Kopie (vom Abgleich angelegt, siehe kern/sync.js):
 * { von: id der anderen Fassung, am: Zeitpunkt (ms) } oder null.
 */
export function bereinigeKonflikt(k) {
  if (!k || typeof k !== 'object' || typeof k.von !== 'string' || !Number.isFinite(k.am)) return null;
  return { von: k.von, am: k.am };
}

/**
 * Text des Vermerks: „Gleichzeitig auf beiden Handys geändert. Die andere Fassung heißt „Brot“.“
 * Gibt es die andere Fassung nicht mehr, fehlt der zweite Satz. null = kein Vermerk.
 */
export function vermerkText(vorlage, vorlagen) {
  const k = bereinigeKonflikt(vorlage?.konflikt);
  if (!k) return null;
  const andere = vorlagen.find((v) => v.id === k.von && v.id !== vorlage.id);
  return andere
    ? `Gleichzeitig auf beiden Handys geändert. Die andere Fassung heißt „${andere.name}“.`
    : 'Gleichzeitig auf beiden Handys geändert.';
}

/** Vermerk entfernen („Behalten“): Die Kopie wird eine ganz normale Vorlage. */
export function entferneVermerk(speicher, id) {
  const gespeichert = speicher.hole(SAMMLUNG, id);
  if (!gespeichert || !gespeichert.konflikt) return false;
  const { konflikt, ...rest } = gespeichert;
  return speicher.speichere(SAMMLUNG, rest) !== null;
}

/** Gültige Kategorie-id oder null („Ohne Kategorie“). */
export function bereinigeKategorie(kategorie) {
  return KATEGORIEN.some((k) => k.id === kategorie) ? kategorie : null;
}

/**
 * Modus einer Vorlage. Ältere Vorlagen haben keinen: Dann gilt wie bisher
 * „mit Teiglinge-Angabe = Teiglinge-Modus“.
 */
export function modusVon(vorlage) {
  if (MODI.includes(vorlage?.modus)) return vorlage.modus;
  return bereinigeTeiglinge(vorlage?.teiglinge) ? 'teiglinge' : 'mehl';
}

// ---------- Neue Vorlage ----------

/**
 * Vorbelegung je Kategorie: { modus, teiglinge }.
 * Pizza und Brötchen in Teiglingen (4 × 250 g bzw. 8 × 85 g), alles andere in Mehl.
 */
export function vorbelegung(kategorie) {
  const tl = KATEGORIEN.find((k) => k.id === kategorie)?.teiglinge;
  return tl
    ? { modus: 'teiglinge', teiglinge: { ...tl, verlust: STANDARD_VERLUST } }
    : { modus: 'mehl', teiglinge: null };
}

/**
 * Daten für eine neue eigene Vorlage (zum Speichern mit `speichereEigeneVorlage`).
 * basis: eine bestehende Vorlage als Kopiervorlage, oder null für „leer“.
 * Die Teiglinge-Werte kommen aus der Basis, wenn sie welche hat, sonst aus der Kategorie.
 */
export function neueVorlage({ name, kategorie = null, modus, basis = null }) {
  const geladen = basis ? ladeVorlage(basis) : null;
  const gruppe = bereinigeKategorie(kategorie);
  const vor = vorbelegung(gruppe);
  return {
    name: name.trim(),
    kategorie: gruppe,
    modus: MODI.includes(modus) ? modus : vor.modus,
    teig: geladen ? geladen.teig : structuredClone(LEERER_TEIG),
    mehl: geladen ? geladen.mehl : LEERES_MEHL,
    teiglinge: geladen?.teiglinge ?? vor.teiglinge ?? { ...STANDARD_TEIGLINGE },
  };
}

// ---------- Vorlagenliste (Startseite) ----------

/** Liste von ids aus den Einstellungen, geprüft. */
function idListe(speicher, name) {
  const liste = speicher.einstellung(name, []);
  return Array.isArray(liste) ? liste.filter((id) => typeof id === 'string') : [];
}

export const favoriten = (speicher) => idListe(speicher, FAVORITEN);
export const ausgeblendet = (speicher) => idListe(speicher, AUSGEBLENDET);

/** Stern an/aus. */
export function schalteFavorit(speicher, id) {
  const liste = favoriten(speicher);
  return speicher.setzeEinstellung(FAVORITEN, liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]);
}

/** Eingebaute Vorlage aus- bzw. wieder einblenden. Eigene werden stattdessen gelöscht. */
export function blendeAus(speicher, id, aus = true) {
  const liste = ausgeblendet(speicher).filter((x) => x !== id);
  return speicher.setzeEinstellung(AUSGEBLENDET, aus ? [...liste, id] : liste);
}

/**
 * Ordnet die Vorlagen für die Startseite:
 *   favoriten   – mit Stern, ganz oben (erscheinen nicht noch einmal in ihrer Kategorie)
 *   gruppen     – [{ id, name, vorlagen }] in der Reihenfolge von KATEGORIEN,
 *                 leere Gruppen fehlen, „Ohne Kategorie“ (id null) am Ende
 *   ausgeblendet – ausgeblendete eingebaute Vorlagen
 *   anzahl      – sichtbare Vorlagen ohne Suche (für „Suche ab 10“)
 * Die Suche filtert nach dem Namen, ohne Rücksicht auf Groß-/Kleinschreibung.
 */
export function ordneVorlagen(vorlagen, { favoriten: sterne = [], ausgeblendet: aus = [], suche = '' } = {}) {
  const versteckt = new Set(aus);
  const istVersteckt = (v) => v.eingebaut && versteckt.has(v.id);
  const sichtbar = vorlagen.filter((v) => !istVersteckt(v));
  const nachName = (a, b) => a.name.localeCompare(b.name, 'de');
  const wort = suche.trim().toLocaleLowerCase('de');
  const treffer = sichtbar.filter((v) => !wort || v.name.toLocaleLowerCase('de').includes(wort));

  const stern = new Set(sterne);
  const ohneStern = treffer.filter((v) => !stern.has(v.id));
  const gruppen = [...KATEGORIEN, { id: null, name: OHNE_KATEGORIE }]
    .map((k) => ({ ...k, vorlagen: ohneStern.filter((v) => (v.kategorie ?? null) === k.id).sort(nachName) }))
    .filter((g) => g.vorlagen.length > 0);

  return {
    favoriten: treffer.filter((v) => stern.has(v.id)).sort(nachName),
    gruppen,
    ausgeblendet: vorlagen.filter(istVersteckt).sort(nachName),
    anzahl: sichtbar.length,
  };
}

/** Nur die eigenen (gespeicherten) Vorlagen. */
export function eigeneVorlagen(speicher) {
  return alleVorlagen(speicher).filter((v) => !v.eingebaut);
}

/**
 * Liefert { teig, mehl, teiglinge, modus, kategorie } als frische Kopie,
 * damit Änderungen die Vorlage nicht verändern.
 * teiglinge ist null, wenn die Vorlage keine Teiglinge-Angabe hat.
 */
export function ladeVorlage(vorlage) {
  const gemeinsam = {
    teiglinge: bereinigeTeiglinge(vorlage.teiglinge),
    modus: modusVon(vorlage),
    kategorie: bereinigeKategorie(vorlage.kategorie),
  };
  if (vorlage.rezept) {
    const { teig, mehl } = teigAusGramm(vorlage.rezept);
    return { teig: { ...teig, zusaetze: [], format: FORMAT }, mehl, ...gemeinsam };
  }
  return { teig: normalisiereTeig(vorlage.teig), mehl: vorlage.mehl, ...gemeinsam };
}

/**
 * Optionale Teiglinge-Angabe einer Vorlage: { anzahl, gewicht, verlust } (Verlust in %).
 * Ihr Vorhandensein bedeutet „Teiglinge-Modus“. Liefert eine saubere Kopie oder null
 * (fehlt, unvollständig oder unsinnig → die Vorlage gilt als ohne Angabe).
 */
export function bereinigeTeiglinge(roh) {
  if (!roh || typeof roh !== 'object') return null;
  const grenze = (x, max) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
  const anzahl = grenze(roh.anzahl, 10_000);
  const gewicht = grenze(roh.gewicht, 100_000);
  const verlust = grenze(roh.verlust, 100);
  if (anzahl === null || gewicht === null || verlust === null) return null;
  return { anzahl, gewicht, verlust };
}

/**
 * Speichert eine eigene Vorlage (neu ohne id, sonst Änderung). Gibt sie zurück oder null.
 * Ein Konflikt-Vermerk fällt dabei weg: Wer die Kopie bearbeitet und speichert, hat sie angesehen.
 * Ohne Modus gilt: mit Teiglinge-Angabe Teiglinge-Modus, sonst Mehl-Modus.
 * Die Teiglinge-Angabe wird nur im Teiglinge-Modus gespeichert – so verstehen auch
 * ältere App-Stände (ohne Modus) die Vorlage richtig.
 */
export function speichereEigeneVorlage(speicher, { id, name, teig, mehl, teiglinge = null, modus, kategorie = null }) {
  const angabe = bereinigeTeiglinge(teiglinge);
  const art = MODI.includes(modus) ? modus : angabe ? 'teiglinge' : 'mehl';
  const mitAngabe = art === 'teiglinge' ? angabe ?? { ...STANDARD_TEIGLINGE } : null;
  const gruppe = bereinigeKategorie(kategorie);
  return speicher.speichere(SAMMLUNG, {
    ...(id ? { id } : {}),
    name: name.trim(),
    teig: structuredClone(teig),
    mehl,
    modus: art,
    ...(gruppe ? { kategorie: gruppe } : {}),
    ...(mitAngabe ? { teiglinge: mitAngabe } : {}), // ohne Angabe: Feld fehlt, wie bei alten Vorlagen
  });
}


export function loescheEigeneVorlage(speicher, id) {
  return speicher.loesche(SAMMLUNG, id);
}

/** Eine eigene Vorlage genau so, wie sie gespeichert ist (z. B. um das Löschen rückgängig zu machen). */
export function holeEigeneVorlage(speicher, id) {
  return speicher.hole(SAMMLUNG, id);
}

/** Gelöschte eigene Vorlage mit ihrem alten Inhalt zurückholen (gilt als neue Änderung, geht beim Abgleich hoch). */
export function stelleEigeneVorlageWiederHer(speicher, datensatz) {
  return speicher.speichere(SAMMLUNG, datensatz);
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
  kopie.zusaetze = bereinigeZusaetze(kopie.zusaetze);
  if (kopie.format === FORMAT) return kopie;

  kopie.mehlsorten = kopie.mehlsorten.map((s) => ({ ...s, id: s.id ?? idNachName(MEHLE, s.name) }));
  kopie.saaten = kopie.saaten.map((s) => ({ ...s, id: s.id ?? idNachName(SAATEN, s.name) }));
  const saatenProzent = kopie.saaten.reduce((a, s) => a + (s.prozent || 0), 0);
  kopie.quellwasser = (saatenProzent * (kopie.quellwasser || 0)) / 100;
  kopie.format = FORMAT;
  return kopie;
}

/**
 * Zusatzzutaten (Milch, Ei …) prüfen: nur Zeilen mit Namen, Prozent ≥ 0 und Wasseranteil 0–100 %.
 * Ältere Teige haben keine – dann eine leere Liste.
 */
export function bereinigeZusaetze(liste) {
  if (!Array.isArray(liste)) return [];
  const zahl = (x, max) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
  return liste
    .filter((z) => z && typeof z.name === 'string' && z.name.trim() && zahl(z.prozent, 100_000) !== null)
    .map((z) => ({
      id: typeof z.id === 'string' ? z.id : null,
      name: z.name,
      prozent: z.prozent,
      wasser: zahl(z.wasser, 100) ?? 0,
    }));
}
