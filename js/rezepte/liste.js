// liste.js – Kochen: Liste ordnen, Favoriten, „neu“, Mengen in den Schritten.
// Reine Logik ohne Oberfläche, darum testbar. Gerechnet wird in rechner.js.

import { KOCH_KATEGORIEN, PORTIONSARTEN } from './rezept.js';
import { zutatName } from './katalog.js';
import { formatMenge } from '../kern/zahlen.js';

export const SUCHE_AB = 10;          // ab so vielen Kochrezepten gibt es eine Suche
export const OHNE_KATEGORIE = 'Ohne Kategorie';

// Geräte-Einstellungen (nicht im Abgleich)
const FAVORITEN = 'kochen.favoriten';
const GESEHEN = 'rezepte.gesehen';

function idListe(speicher, name) {
  const liste = speicher.einstellung(name, []);
  return Array.isArray(liste) ? liste.filter((id) => typeof id === 'string') : [];
}

export const rezeptFavoriten = (speicher) => idListe(speicher, FAVORITEN);

/** Stern an/aus. */
export function schalteRezeptFavorit(speicher, id) {
  const liste = rezeptFavoriten(speicher);
  return speicher.setzeEinstellung(FAVORITEN, liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]);
}

/** „Neu“ = noch nie geöffnet (auf diesem Handy). */
export const gesehen = (speicher) => new Set(idListe(speicher, GESEHEN));

export function markiereGesehen(speicher, id) {
  const liste = idListe(speicher, GESEHEN);
  if (liste.includes(id)) return true;
  return speicher.setzeEinstellung(GESEHEN, [...liste, id]);
}

/**
 * Sortiert Kochrezepte für die Liste:
 *   favoriten – mit Stern, ganz oben (nicht noch einmal in der Kategorie), A–Z
 *   gruppen   – [{ id, name, rezepte }] in der Reihenfolge von KOCH_KATEGORIEN, innerhalb A–Z;
 *               ohne (bekannte) Kategorie unter „Ohne Kategorie“ am Ende
 *   anzahl    – alle Kochrezepte ohne Suche (für „Suche ab 10“)
 */
export function ordneRezepte(rezepte, { favoriten: sterne = [], suche = '' } = {}) {
  const nachName = (a, b) => a.name.localeCompare(b.name, 'de');
  const wort = suche.trim().toLocaleLowerCase('de');
  const treffer = rezepte.filter((r) => !wort || r.name.toLocaleLowerCase('de').includes(wort));
  const stern = new Set(sterne);
  const ohneStern = treffer.filter((r) => !stern.has(r.id));
  const bekannt = new Set(KOCH_KATEGORIEN.map((k) => k.id));
  const kategorieVon = (r) => (bekannt.has(r.kategorie) ? r.kategorie : null); // Unbekanntes landet bei „Ohne Kategorie“
  const gruppen = [...KOCH_KATEGORIEN, { id: null, name: OHNE_KATEGORIE }]
    .map((k) => ({ ...k, rezepte: ohneStern.filter((r) => kategorieVon(r) === k.id).sort(nachName) }))
    .filter((g) => g.rezepte.length > 0);
  return {
    favoriten: treffer.filter((r) => stern.has(r.id)).sort(nachName),
    gruppen,
    anzahl: rezepte.length,
  };
}

/** „4 Personen“, „1 Person“, „12 Stück“, „1 Laib“. */
export function portionenText(portionen, art = 'personen') {
  const einzahl = { personen: 'Person', stueck: 'Stück', laibe: 'Laib' };
  const mehrzahl = Object.fromEntries(PORTIONSARTEN.map((p) => [p.id, p.name]));
  const einsen = Math.abs(portionen - 1) < 0.005;
  return `${formatMenge(portionen)} ${einsen ? einzahl[art] ?? einzahl.personen : mehrzahl[art] ?? mehrzahl.personen}`;
}

/**
 * Alle Geräte, die das Rezept braucht, in der Reihenfolge ihres ersten Auftretens (ohne Doppelte,
 * Groß-/Kleinschreibung egal). Ohne Geräte: leere Liste.
 */
export function geraeteListe(rezept) {
  const gesehen = new Set();
  const liste = [];
  for (const g of rezept.schrittgeraete ?? []) {
    const schluessel = g.toLowerCase();
    if (!g || gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    liste.push(g);
  }
  return liste;
}

// ---------- Mengen direkt in den Schritten ----------

/** Kleinbuchstaben, Umlaute ausgeschrieben, nur Buchstaben und Ziffern je Wort. */
function woerter(s) {
  return String(s)
    .toLowerCase()
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Schlüsselwort einer Zutat für die Suche im Schrittext: das letzte Wort des Namens, das keine
 * Zahl ist („Rote Linsen“ → linsen, „Weizenmehl 550“ → weizenmehl). Endet es auf n/e, zählt auch
 * die Form ohne („Zwiebeln“ ↔ „Zwiebel“). Sehr kurze Wörter („Ei“, „Öl“) müssen ganz passen.
 */
function schluesselwoerter(name) {
  const ws = woerter(name).filter((w) => !/^\d+$/.test(w));
  const wort = ws.at(-1);
  if (!wort) return null;
  const formen = new Set([wort]);
  if (wort.length >= 5 && /[ne]$/.test(wort)) formen.add(wort.slice(0, -1));
  if (wort.length >= 6 && wort.endsWith('en')) formen.add(wort.slice(0, -2));
  return { formen: [...formen], kurz: wort.length < 4 };
}

function kommtVor(schluessel, schrittWoerter) {
  return schrittWoerter.some((w) => schluessel.formen.some((f) => (
    schluessel.kurz ? w === f || w === `${f}er` || w === `${f}en` || w === `${f}s` : w.startsWith(f)
  )));
}

/**
 * Welche Zutaten kommen in welchem Schritt vor? Gefunden wird über den Namen im Schrittext
 * (ganze Wörter bzw. Wortanfang: „Zwiebeln“ passt zu „Zwiebel“, „Salz“ nicht zu „Salat“).
 * zutaten: Zutaten mit skalierter `menge` (aus `skaliere`), katalog: Liste aus `alleZutaten`.
 * Gibt je Schritt eine Liste { name, menge, einheit, zutat } zurück – Reihenfolge wie in der Zutatenliste.
 */
export function mengenInSchritten(schritte, zutaten, katalog) {
  const schluessel = zutaten.map((z) => {
    const name = zutatName(katalog, z.zutat);
    return { z, name, wort: schluesselwoerter(name) };
  });
  return schritte.map((schritt) => {
    const ws = woerter(schritt);
    return schluessel
      .filter(({ wort }) => wort && kommtVor(wort, ws))
      .map(({ z, name }) => ({ zutat: z.zutat, name, menge: z.menge, einheit: z.einheit }));
  });
}
