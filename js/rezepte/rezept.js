// rezept.js – Datenmodell der Rezepte (Sammlung "rezepte"): prüfen, bereinigen, speichern.
//
// Ein Rezept (gespeichert):
//   art          'kochen' | 'backen'
//   name, kategorie (id aus KOCH_KATEGORIEN bzw. teig/vorlagen.js KATEGORIEN, sonst weg = „Ohne Kategorie“)
//   portionen + portionsart ('personen' | 'stueck' | 'laibe') – bei Kochen Pflicht, bei Backen optional
//   zutaten      [{ zutat: Katalog-id, menge: Zahl | null („nach Geschmack“), einheit, regel }]
//   schritte     [Text] – kurz, ein Handgriff pro Schritt (Abhaken wird nicht gespeichert)
//   status       'erprobt' | 'testen'      notiz (kurz)      quelle 'claude' | 'import' | 'hand'
//   nur Backen:  teig, mehl, modus, teiglinge – wie bei den Teigvorlagen; Mehl, Wasser, Salz usw. rechnet
//                der Teigrechner, `zutaten` sind nur das Übrige (Belag …) und skalieren mit dem Mehl
//
// Rezepte können von überall kommen (Abgleich, Connector, eingefügter Code): Alles geht durch
// `bereinigeRezept`, unbekannte Felder fallen weg, Unsinn ergibt null.

import { bereinigeTeig } from '../teig/teilen.js';
import {
  KATEGORIEN, MODI, STANDARD_TEIGLINGE, bereinigeTeiglinge, bereinigeKonflikt,
} from '../teig/vorlagen.js';
import { alleZutaten, findeOderNeu, gueltigeZutatId, speichereZutat } from './katalog.js';

export const SAMMLUNG = 'rezepte';
export const ARTEN = ['kochen', 'backen'];
export const PORTIONSARTEN = [
  { id: 'personen', name: 'Personen' },
  { id: 'stueck', name: 'Stück' },
  { id: 'laibe', name: 'Laibe' },
];
export const REGELN = ['linear', 'ganz', 'fix']; // linear · ganze Stück (rundet) · fix (bleibt gleich)
export const STATUS = ['erprobt', 'testen'];
export const QUELLEN = ['claude', 'import', 'hand'];

/** Kategorien beim Kochen, in der Reihenfolge der Liste (Backen: KATEGORIEN aus teig/vorlagen.js). */
export const KOCH_KATEGORIEN = [
  { id: 'pasta', name: 'Pasta & Gnocchi' },
  { id: 'currys', name: 'Currys & Dal' },
  { id: 'wok', name: 'Wok & Pfanne' },
  { id: 'suppen', name: 'Suppen & Eintöpfe' },
  { id: 'auflaeufe', name: 'Aufläufe & Ofengerichte' },
  { id: 'burger', name: 'Burger & Wraps' },
  { id: 'salate', name: 'Salate & Bowls' },
  { id: 'grillen', name: 'Grillen' },
  { id: 'snacks', name: 'Snacks & Fingerfood' },
  { id: 'beilagen', name: 'Beilagen' },
  { id: 'saucen', name: 'Saucen & Dips' },
  { id: 'fruehstueck', name: 'Frühstück & Süßes' },
  { id: 'sonstiges', name: 'Sonstiges' }, // Auffangkategorie
];

const MAX_NAME = 80;
const MAX_EINHEIT = 20;
const MAX_ZUTATEN = 80;
const MAX_SCHRITTE = 60;
const MAX_SCHRITT = 500;
const MAX_NOTIZ = 2000;
const MAX_ZAHL = 100_000;
const MAX_PORTIONEN = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (x, max) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, max) : null);
const zahl = (x, min, max) => (typeof x === 'number' && Number.isFinite(x) && x > min && x <= max ? x : null);

/** Kategorien-Liste zur Art. */
export const kategorienFuer = (art) => (art === 'backen' ? KATEGORIEN : KOCH_KATEGORIEN);

/**
 * Prüft ein Rezept und gibt eine saubere Kopie zurück – oder null, wenn es unbrauchbar ist.
 * Zutaten brauchen hier schon ihre Katalog-id (Namen löst `speichereRezept` auf).
 * Fehlt die id, bleibt sie weg (neues Rezept); ist sie da, muss sie eine UUID sein.
 */
export function bereinigeRezept(roh) {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  if (roh.id !== undefined && !(typeof roh.id === 'string' && UUID.test(roh.id))) return null;
  if (!ARTEN.includes(roh.art)) return null;
  const name = text(roh.name, MAX_NAME);
  if (!name) return null;

  const backen = roh.art === 'backen';
  let portionen = null;
  if (roh.portionen !== undefined && roh.portionen !== null) {
    portionen = zahl(roh.portionen, 0, MAX_PORTIONEN);
    if (portionen === null) return null;
  }
  if (!backen && portionen === null) return null;

  const zutaten = bereinigeZutaten(roh.zutaten ?? []);
  const schritte = bereinigeSchritte(roh.schritte ?? []);
  if (!zutaten || !schritte) return null;

  const quelle = QUELLEN.includes(roh.quelle) ? roh.quelle : 'hand';
  const status = STATUS.includes(roh.status) ? roh.status : quelle === 'import' ? 'testen' : 'erprobt';
  const kategorie = kategorienFuer(roh.art).some((k) => k.id === roh.kategorie) ? roh.kategorie : null;
  const notiz = text(roh.notiz, MAX_NOTIZ) ?? '';
  const konflikt = bereinigeKonflikt(roh.konflikt);

  const rezept = {
    ...(roh.id ? { id: roh.id.toLowerCase() } : {}),
    art: roh.art,
    name,
    ...(kategorie ? { kategorie } : {}),
    ...(portionen !== null ? { portionen } : {}),
    portionsart: PORTIONSARTEN.some((p) => p.id === roh.portionsart) ? roh.portionsart : 'personen',
    zutaten,
    schritte,
    status,
    notiz,
    quelle,
    ...(konflikt ? { konflikt } : {}),
  };

  if (backen) {
    const teig = bereinigeTeig(roh.teig);
    const mehl = zahl(roh.mehl, 0, MAX_ZAHL);
    if (!teig || mehl === null) return null;
    const angabe = bereinigeTeiglinge(roh.teiglinge);
    const modus = MODI.includes(roh.modus) ? roh.modus : angabe ? 'teiglinge' : 'mehl';
    Object.assign(rezept, {
      teig, mehl, modus,
      // Teiglinge-Angabe nur im Teiglinge-Modus, wie bei den Teigvorlagen
      ...(modus === 'teiglinge' ? { teiglinge: angabe ?? { ...STANDARD_TEIGLINGE } } : {}),
    });
  }
  return rezept;
}

function bereinigeZutaten(liste) {
  if (!Array.isArray(liste) || liste.length > MAX_ZUTATEN) return null;
  const sauber = [];
  for (const z of liste) {
    if (!z || typeof z !== 'object' || !gueltigeZutatId(z.zutat)) return null;
    const menge = z.menge === undefined || z.menge === null ? null : zahl(z.menge, 0, MAX_ZAHL);
    if (z.menge !== undefined && z.menge !== null && menge === null) return null;
    sauber.push({
      zutat: z.zutat,
      menge,
      einheit: text(z.einheit, MAX_EINHEIT) ?? '',
      regel: REGELN.includes(z.regel) ? z.regel : 'linear',
    });
  }
  return sauber;
}

function bereinigeSchritte(liste) {
  if (!Array.isArray(liste) || liste.length > MAX_SCHRITTE) return null;
  const sauber = [];
  for (const s of liste) {
    if (typeof s !== 'string') return null;
    const t = text(s, MAX_SCHRITT);
    if (t) sauber.push(t); // leere Schritte fallen weg
  }
  return sauber;
}

/**
 * Zutaten mit `name` statt `zutat` (von Claude, aus einem Code) auf Katalog-ids umstellen.
 * Gibt { roh, neu } zurück: das Rezept mit ids und die Katalogeinträge, die es noch nicht gibt.
 * Zutaten ohne brauchbaren Namen bleiben ohne id – `bereinigeRezept` weist das Rezept dann ab.
 */
export function loeseNamenAuf(roh, katalog) {
  if (!roh || typeof roh !== 'object' || !Array.isArray(roh.zutaten)) return { roh, neu: [] };
  const neu = [];
  const liste = [...katalog];
  const zutaten = roh.zutaten.map((z) => {
    if (!z || typeof z !== 'object' || z.zutat !== undefined) return z;
    const treffer = findeOderNeu(liste, z.name, z.art);
    if (!treffer) return z;
    if (treffer.neu) {
      neu.push(treffer.eintrag);
      liste.push(treffer.eintrag);
    }
    const { name, art, ...rest } = z;
    return { ...rest, zutat: treffer.eintrag.id };
  });
  return { roh: { ...roh, zutaten }, neu };
}

// ---------- Speichern ----------

/** Alle gültigen Rezepte (kaputte werden übersprungen). */
export function alleRezepte(speicher, art = null) {
  return speicher.alle(SAMMLUNG)
    .map((d) => {
      const r = bereinigeRezept(d);
      return r ? { ...r, id: d.id, erstellt: d.erstellt, geaendert: d.geaendert } : null;
    })
    .filter((r) => r && (!art || r.art === art));
}

export function holeRezept(speicher, id) {
  return alleRezepte(speicher).find((r) => r.id === id) ?? null;
}

/**
 * Prüft ein Rezept, legt unbekannte Zutaten im Katalog an und speichert es.
 * Gibt das gespeicherte Rezept zurück oder null (ungültig oder Speicher voll) – dann ändert sich nichts.
 * Ein Konflikt-Vermerk bleibt nur, wenn er mitgegeben wird; wer das Rezept speichert, hat es gesehen.
 */
export function speichereRezept(speicher, roh) {
  const { roh: mitIds, neu } = loeseNamenAuf(roh, alleZutaten(speicher));
  const { konflikt, ...ohneVermerk } = mitIds ?? {};
  const rezept = bereinigeRezept(ohneVermerk);
  if (!rezept) return null;
  for (const eintrag of neu) {
    if (!speichereZutat(speicher, eintrag)) return null;
  }
  return speicher.speichere(SAMMLUNG, rezept);
}
