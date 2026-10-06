// katalog.js – gemeinsamer Zutatenkatalog (Sammlung "zutaten").
//
// Teigrechner, Rezepte und später der Vorrat verweisen per `id` auf eine Zutat, nie per Freitext.
// Eingebaut sind die Mehle, Saaten und Zusatzzutaten aus teig/zutaten.js (mit ihren festen ids) und
// etwa 75 Standardzutaten zum Kochen (KOCH_ZUTATEN).
// Alles andere entsteht beim Speichern eines Rezepts: unbekannter Name = neuer Eintrag.
//
// Die id einer neuen Zutat folgt aus dem Namen (`zutatId`): „Kokosmilch“ → "kokosmilch". Legen zwei
// Handys (oder Claude) dieselbe Zutat gleichzeitig an, entsteht dieselbe id mit gleichem Inhalt –
// kein Doppel, kein Konflikt. Die Edge Function des Connectors rechnet genauso.

import { MEHLE, SAATEN, ZUSAETZE } from '../teig/zutaten.js';

export const SAMMLUNG = 'zutaten';
export const ARTEN = ['mehl', 'saat', 'zusatz', 'gemuese', 'obst', 'fleisch', 'milchprodukt', 'gewuerz', 'vorrat', 'sonstiges'];
export const STANDARD_ART = 'sonstiges';

const MAX_NAME = 80;
const ID_MUSTER = /^[\w-]{1,60}$/;

/** Name → id: Kleinbuchstaben und Ziffern, Umlaute ausgeschrieben („Weizen 550“ → "weizen550"). */
export function zutatId(name) {
  if (typeof name !== 'string') return null;
  const id = name
    .toLowerCase()
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 60);
  return id || null;
}

export function bereinigeZutatenName(name) {
  if (typeof name !== 'string') return null;
  const sauber = name.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return zutatId(sauber) ? sauber : null;
}

export const gueltigeZutatId = (id) => typeof id === 'string' && ID_MUSTER.test(id);

/**
 * Standardzutaten zum Kochen mit einheitlichen Namen: Grundzutat im Singular, die Form steckt in der Einheit
 * („Knoblauch“, 2 Zehen). Die id folgt aus dem Namen (`zutatId`). Reihenfolge = Kopie in supabase/functions/kochbuch/index.ts.
 */
export const KOCH_ZUTATEN = [
  // Öle und Fette
  ['Olivenöl', 'vorrat'],
  ['Rapsöl', 'vorrat'],
  ['Sesamöl', 'vorrat'],
  // Zwiebeln, Knoblauch, Ingwer
  ['Zwiebel', 'gemuese'],
  ['Rote Zwiebel', 'gemuese'],
  ['Frühlingszwiebel', 'gemuese'],
  ['Knoblauch', 'gemuese'],
  ['Ingwer', 'gemuese'],
  // Würzsaucen
  ['Sojasauce', 'vorrat'],
  ['Worcestersauce', 'vorrat'],
  ['Fischsauce', 'vorrat'],
  ['Tomatenmark', 'vorrat'],
  ['Senf', 'vorrat'],
  ['Sambal Oelek', 'vorrat'],
  // Säuren
  ['Zitronensaft', 'vorrat'],
  ['Limettensaft', 'vorrat'],
  ['Apfelessig', 'vorrat'],
  ['Balsamico', 'vorrat'],
  // Grundgewürze
  ['Salz', 'gewuerz'],
  ['Pfeffer', 'gewuerz'],
  ['Paprikapulver', 'gewuerz'],
  ['Kreuzkümmel', 'gewuerz'],
  ['Currypulver', 'gewuerz'],
  ['Kurkuma', 'gewuerz'],
  ['Oregano', 'gewuerz'],
  ['Zimt', 'gewuerz'],
  ['Chiliflocken', 'gewuerz'],
  // Dosenware
  ['Gehackte Tomaten', 'vorrat'],
  ['Passierte Tomaten', 'vorrat'],
  ['Kokosmilch', 'vorrat'],
  ['Kichererbsen', 'vorrat'],
  ['Kidneybohnen', 'vorrat'],
  ['Mais', 'vorrat'],
  // Häufiges Gemüse
  ['Karotte', 'gemuese'],
  ['Paprika', 'gemuese'],
  ['Tomate', 'gemuese'],
  ['Kartoffel', 'gemuese'],
  ['Zucchini', 'gemuese'],
  ['Champignon', 'gemuese'],
  ['Lauch', 'gemuese'],
  ['Brokkoli', 'gemuese'],
  ['Spinat', 'gemuese'],
  // Sonstiges
  ['Wasser', 'vorrat'],
  ['Gemüsebrühe', 'vorrat'],
  // Oft bei uns: Beilagen und Grundlagen
  ['Vollkornreis', 'vorrat'],
  ['Basmatireis', 'vorrat'],
  ['Vollkornpasta', 'vorrat'],
  ['Spätzle', 'vorrat'],
  ['Gnocchi', 'vorrat'],
  ['Rote Linsen', 'vorrat'],
  ['Berglinsen', 'vorrat'],
  ['Cashew', 'vorrat'],
  ['Pinienkern', 'vorrat'],
  ['Currypaste', 'vorrat'],
  ['Vegetarisches Hack', 'vorrat'],
  // Oft bei uns: Gemüse und Obst
  ['Butternutkürbis', 'gemuese'],
  ['Zuckerschote', 'gemuese'],
  ['Rucola', 'gemuese'],
  ['Romanasalat', 'gemuese'],
  ['Blumenkohl', 'gemuese'],
  ['Schalotte', 'gemuese'],
  ['Limette', 'obst'],
  ['Zitrone', 'obst'],
  // Oft bei uns: Milch, Fleisch
  ['Sahne', 'milchprodukt'],
  ['Hähnchenbrust', 'fleisch'],
  ['Rinderhack', 'fleisch'],
  // Oft bei uns: Gewürze und Kräuter
  ['Garam Masala', 'gewuerz'],
  ['Thymian', 'gewuerz'],
  ['Rosmarin', 'gewuerz'],
  ['Basilikum', 'gewuerz'],
  ['Petersilie', 'gewuerz'],
  ['Koriander', 'gewuerz'],
];

/** Eingebaute Zutaten: Mehle, Saaten, Zusätze, Standardzutaten zum Kochen. */
export const EINGEBAUT = [
  ...MEHLE.map((m) => ({ id: m.id, name: m.name, art: 'mehl' })),
  ...SAATEN.map((s) => ({ id: s.id, name: s.name, art: 'saat' })),
  ...ZUSAETZE.map((z) => ({ id: z.id, name: z.name, art: 'zusatz' })),
  ...KOCH_ZUTATEN.map(([name, art]) => ({ id: zutatId(name), name, art })),
];

/** Geprüfter Katalogeintrag { id, name, art } oder null. */
function bereinigeEintrag(d) {
  if (!d || typeof d !== 'object' || !gueltigeZutatId(d.id)) return null;
  const name = bereinigeZutatenName(d.name);
  if (!name) return null;
  return { id: d.id, name, art: ARTEN.includes(d.art) ? d.art : STANDARD_ART };
}

/** Eingebaute und eigene Zutaten (eingebaute gelten immer mit ihrem festen Namen). */
export function alleZutaten(speicher) {
  const feste = new Set(EINGEBAUT.map((z) => z.id));
  const eigene = speicher.alle(SAMMLUNG)
    .map(bereinigeEintrag)
    .filter((z) => z && !feste.has(z.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return [...EINGEBAUT, ...eigene];
}

/** Nur die Namen, alphabetisch (für `zutaten_liste` im Connector). */
export function zutatenNamen(speicher) {
  return alleZutaten(speicher).map((z) => z.name).sort((a, b) => a.localeCompare(b, 'de'));
}

/** Anzeigename zu einer id; fehlt der Eintrag noch (Abgleich unterwegs), die id selbst. */
export function zutatName(liste, id) {
  return liste.find((z) => z.id === id)?.name ?? id;
}

/**
 * Sucht die Zutat zu einem Namen; gibt es sie nicht, einen neuen (noch nicht gespeicherten) Eintrag.
 * Gefunden wird über die id aus dem Namen („kokosmilch“ = „Kokos-Milch“ = „kokosmilch“).
 * `art` gilt nur für neue Einträge. Gibt null zurück, wenn der Name unbrauchbar ist.
 */
export function findeOderNeu(liste, name, art) {
  const sauber = bereinigeZutatenName(name);
  if (!sauber) return null;
  const id = zutatId(sauber);
  const gefunden = liste.find((z) => z.id === id || zutatId(z.name) === id);
  if (gefunden) return { eintrag: gefunden, neu: false };
  return { eintrag: { id, name: sauber, art: ARTEN.includes(art) ? art : STANDARD_ART }, neu: true };
}

/** Neuen Eintrag speichern (mit fester id, siehe oben). */
export function speichereZutat(speicher, eintrag) {
  return speicher.speichere(SAMMLUNG, eintrag);
}
