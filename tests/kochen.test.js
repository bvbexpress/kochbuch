// Tests für Etappe 3, Schritt 2: Kochen – Liste ordnen, Favoriten, „neu“, Mengen in den Schritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { speichereRezept, alleRezepte, holeRezept } from '../js/rezepte/rezept.js';
import { alleZutaten } from '../js/rezepte/katalog.js';
import { skaliere } from '../js/rezepte/rechner.js';
import {
  ordneRezepte, portionenText, rezeptFavoriten, schalteRezeptFavorit, gesehen, markiereGesehen,
  mengenInSchritten, geraeteListe, ernaehrungAnzeige, SUCHE_AB,
} from '../js/rezepte/liste.js';
import { bereinigeRezept } from '../js/rezepte/rezept.js';

const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());
const r = (name, extra = {}) => ({ id: name, name, kategorie: null, ...extra });

// ---------- Liste ordnen ----------

test('Kategorien in fester Reihenfolge, darin A–Z, ohne Kategorie am Ende', () => {
  const o = ordneRezepte([
    r('Tomatensuppe', { kategorie: 'suppen' }),
    r('Zitronenpasta', { kategorie: 'pasta' }),
    r('Äpfel im Schlafrock'),
    r('Arrabbiata', { kategorie: 'pasta' }),
    r('Dal', { kategorie: 'currys' }),
    r('Unbekannt', { kategorie: 'gibtsnicht' }),
  ]);
  assert.deepEqual(o.gruppen.map((g) => g.name), ['Pasta & Gnocchi', 'Currys & Dal', 'Suppen & Eintöpfe', 'Ohne Kategorie']);
  assert.deepEqual(o.gruppen[0].rezepte.map((x) => x.name), ['Arrabbiata', 'Zitronenpasta']);
  assert.deepEqual(o.gruppen[3].rezepte.map((x) => x.name), ['Äpfel im Schlafrock', 'Unbekannt']);
  assert.equal(o.anzahl, 6);
});

test('Favoriten stehen oben und nicht noch einmal in ihrer Kategorie', () => {
  const liste = [r('Dal', { kategorie: 'currys' }), r('Curry', { kategorie: 'currys' }), r('Brei', { kategorie: 'fruehstueck' })];
  const o = ordneRezepte(liste, { favoriten: ['Dal', 'Brei'] });
  assert.deepEqual(o.favoriten.map((x) => x.name), ['Brei', 'Dal']);
  assert.deepEqual(o.gruppen.map((g) => g.name), ['Currys & Dal']);
  assert.deepEqual(o.gruppen[0].rezepte.map((x) => x.name), ['Curry']);
});

test('Suche: nach Name, ohne Groß-/Kleinschreibung; Favoriten werden mitgefiltert', () => {
  const liste = [r('Linsen-Dal', { kategorie: 'currys' }), r('Kichererbsen-Curry', { kategorie: 'currys' }), r('Pasta', { kategorie: 'pasta' })];
  const o = ordneRezepte(liste, { suche: '  CURRY ', favoriten: ['Pasta'] });
  assert.deepEqual(o.gruppen.flatMap((g) => g.rezepte.map((x) => x.name)), ['Kichererbsen-Curry']);
  assert.deepEqual(o.favoriten, []);
  assert.equal(o.anzahl, 3); // die Anzahl für „Suche ab …“ ignoriert die Suche
  assert.equal(SUCHE_AB, 10);
});

test('Portionen-Text: Einzahl und Mehrzahl, krumme Zahlen', () => {
  assert.equal(portionenText(4, 'personen'), '4 Personen');
  assert.equal(portionenText(1, 'personen'), '1 Person');
  assert.equal(portionenText(1, 'laibe'), '1 Laib');
  assert.equal(portionenText(2, 'laibe'), '2 Laibe');
  assert.equal(portionenText(12, 'stueck'), '12 Stück');
  assert.equal(portionenText(1.5, 'personen'), '1,5 Personen');
});

// ---------- Geräte-Einstellungen ----------

test('Favoriten und „gesehen“ sind Geräte-Einstellungen und kaputte Werte stören nicht', () => {
  const s = neuerSpeicher();
  assert.deepEqual(rezeptFavoriten(s), []);
  schalteRezeptFavorit(s, 'a');
  schalteRezeptFavorit(s, 'b');
  schalteRezeptFavorit(s, 'a');
  assert.deepEqual(rezeptFavoriten(s), ['b']);

  assert.equal(gesehen(s).has('a'), false);
  markiereGesehen(s, 'a');
  markiereGesehen(s, 'a');
  assert.deepEqual([...gesehen(s)], ['a']);

  s.setzeEinstellung('kochen.favoriten', 'kaputt');
  s.setzeEinstellung('rezepte.gesehen', [1, null, 'x']);
  assert.deepEqual(rezeptFavoriten(s), []);
  assert.deepEqual([...gesehen(s)], ['x']);
  assert.equal(s.syncStand(), 0);
  assert.equal(s.offene('rezepte').length, 0); // nichts davon geht in den Abgleich
});

// ---------- Mengen in den Schritten ----------

const curry = () => ({
  art: 'kochen', name: 'Kichererbsen-Curry', kategorie: 'currys', portionen: 4,
  zutaten: [
    { name: 'Kichererbsen', menge: 400, einheit: 'g' },
    { name: 'Zwiebeln', menge: 2, einheit: 'Stück', regel: 'ganz' },
    { name: 'Kokosmilch', menge: 400, einheit: 'ml' },
    { name: 'Öl', menge: 2, einheit: 'EL', regel: 'fix' },
    { name: 'Ei', menge: 1, einheit: 'Stück', regel: 'ganz' },
    { name: 'Salz', menge: null },
    { name: 'Rote Linsen', menge: 150, einheit: 'g' },
  ],
  schritte: [
    'Zwiebel würfeln und im Öl anbraten',
    'Kichererbsen abgießen, Kokosmilch dazugeben',
    'Mit Salz abschmecken, Salat dazu',
    'Eigelb trennen, Eier verquirlen',
    'Linsen waschen',
    'Servieren',
  ],
});

function schrittMengen(ziel = 4) {
  const s = neuerSpeicher();
  const gespeichert = speichereRezept(s, curry());
  const rez = holeRezept(s, gespeichert.id);
  const skaliert = skaliere(rez, { portionen: ziel });
  return mengenInSchritten(rez.schritte, skaliert.zutaten, alleZutaten(s))
    .map((liste) => liste.map((m) => m.name));
}

test('Zutaten werden über ihren Namen im Schrittext gefunden', () => {
  const m = schrittMengen();
  assert.deepEqual(m[0], ['Zwiebeln', 'Öl']);          // Zwiebel ↔ Zwiebeln, Öl als ganzes Wort
  assert.deepEqual(m[1], ['Kichererbsen', 'Kokosmilch']);
  assert.deepEqual(m[2], ['Salz']);                    // Salz passt nicht zu Salat
  assert.deepEqual(m[3], ['Ei']);                      // Eier ja, Eigelb nein
  assert.deepEqual(m[4], ['Rote Linsen']);             // letztes Wort des Namens
  assert.deepEqual(m[5], []);
});

test('Die Mengen in den Schritten folgen den Portionen', () => {
  const s = neuerSpeicher();
  const rez = holeRezept(s, speichereRezept(s, curry()).id);
  const katalog = alleZutaten(s);
  const bei = (portionen) => {
    const skaliert = skaliere(rez, { portionen });
    return mengenInSchritten(rez.schritte, skaliert.zutaten, katalog);
  };
  assert.equal(bei(4)[1][0].menge, 400);
  assert.equal(bei(2)[1][0].menge, 200);
  assert.equal(bei(6)[1][0].menge, 600);
  assert.equal(bei(6)[0][0].menge, 3);       // ganze Stück
  assert.equal(bei(6)[0][1].menge, 2);       // fix bleibt
  assert.equal(bei(6)[2][0].menge, null);    // nach Geschmack
  assert.equal(bei(1)[1][0].einheit, 'g');
});

test('Status und Notiz speichern sich über das Rezept; „neu“ und Sterne bleiben unberührt', () => {
  const s = neuerSpeicher();
  const id = speichereRezept(s, curry()).id;
  const alt = holeRezept(s, id);
  assert.equal(alt.status, 'erprobt');
  speichereRezept(s, { ...alt, status: 'testen', notiz: '  weniger Salz ' });
  const neu = holeRezept(s, id);
  assert.equal(neu.status, 'testen');
  assert.equal(neu.notiz, 'weniger Salz');
  assert.equal(neu.zutaten.length, 7);
  assert.equal(alleRezepte(s, 'kochen').length, 1);
  assert.equal(s.offene('rezepte').length, 1);
});

// ---------- Zutaten je Schritt ----------

const mitSchrittzutaten = () => ({
  art: 'kochen', name: 'Nudeln', kategorie: 'pasta', portionen: 2,
  zutaten: [
    { name: 'Wasser', menge: 2000, einheit: 'ml' },
    { name: 'Spaghetti', menge: 200, einheit: 'g' },
    { name: 'Eier', menge: 2, einheit: 'Stück', regel: 'ganz' },
  ],
  schritte: ['Wasser aufsetzen', '', 'Spaghetti kochen', 'Rest vom Wasser zugeben'],
  schrittzutaten: [
    [{ name: 'Wasser', menge: 1500 }],
    [{ name: 'Eier' }],                // gehört zum leeren Schritt, der wegfällt
    [{ name: 'Spaghetti' }, { name: 'Wasser' }, { name: 'Wasser' }],
    [{ name: 'Wasser', menge: 500 }, { zutat: 'gibtsnicht' }, { name: 'Spaghetti', menge: -3 }],
  ],
});

test('Zutaten je Schritt: Namen werden zu ids, leere Schritte nehmen ihre Einträge mit, Unsinn fällt weg', () => {
  const s = neuerSpeicher();
  const r = holeRezept(s, speichereRezept(s, mitSchrittzutaten()).id);
  assert.deepEqual(r.schritte, ['Wasser aufsetzen', 'Spaghetti kochen', 'Rest vom Wasser zugeben']);
  assert.deepEqual(r.schrittzutaten, [
    [{ zutat: 'wasser', menge: 1500 }],
    [{ zutat: 'spaghetti' }, { zutat: 'wasser' }],  // doppelt nur einmal
    [{ zutat: 'wasser', menge: 500 }],               // fremde Zutat und negative Menge weg
  ]);
});

test('Gerät je Schritt: leere Schritte nehmen ihren Eintrag mit, ohne Gerät fehlt das Feld, Liste ohne Doppelte', () => {
  const s = neuerSpeicher();
  const mit = (schrittgeraete) => holeRezept(s, speichereRezept(s, { ...mitSchrittzutaten(), schrittgeraete }).id);
  // Der zweite Schritt ist leer und fällt weg – sein Gerät („Ofen“) mit ihm
  const r = mit(['Wok', 'Ofen', '  Wok  ', 7]);
  assert.deepEqual(r.schritte.length, 3);
  assert.deepEqual(r.schrittgeraete, ['Wok', 'Wok', '']);
  assert.deepEqual(geraeteListe(mit(['Wok', '', 'Ofen 200 °C Umluft', 'wok'])), ['Wok', 'Ofen 200 °C Umluft']);
  assert.deepEqual(mit(['', '', '', '']).schrittgeraete, undefined);
  assert.deepEqual(mit(undefined).schrittgeraete, undefined);
  assert.deepEqual(mit('Wok').schrittgeraete, undefined);
  assert.equal(mit(['x'.repeat(80), '', '', '']).schrittgeraete[0].length, 40);
  assert.deepEqual(geraeteListe(mit(undefined)), []);
});

test('Zutaten je Schritt: ohne Einträge fehlt das Feld (Rückfall auf die Namenssuche)', () => {
  const s = neuerSpeicher();
  const ohne = { ...mitSchrittzutaten(), schrittzutaten: undefined };
  assert.equal(holeRezept(s, speichereRezept(s, ohne).id).schrittzutaten, undefined);
  const leer = { ...mitSchrittzutaten(), schrittzutaten: [[], [], []] };
  assert.equal(holeRezept(s, speichereRezept(s, leer).id).schrittzutaten, undefined);
  const kaputt = { ...mitSchrittzutaten(), schrittzutaten: 'x' };
  assert.equal(holeRezept(s, speichereRezept(s, kaputt).id).schrittzutaten, undefined);
});

test('Zutaten je Schritt: Teilmengen skalieren mit den Portionen, ohne Teilmenge gilt die ganze Menge', () => {
  const s = neuerSpeicher();
  const r = holeRezept(s, speichereRezept(s, mitSchrittzutaten()).id);
  const bei = (portionen) => skaliere(r, { portionen }).schritte;
  assert.deepEqual(bei(2)[0], [{ zutat: 'wasser', menge: 1500, einheit: 'ml' }]);
  assert.deepEqual(bei(4)[0], [{ zutat: 'wasser', menge: 3000, einheit: 'ml' }]);
  assert.equal(bei(4)[2][0].menge, 1000);                   // Rest vom Wasser
  assert.equal(bei(1)[1][0].menge, 100);                    // ganze Menge Spaghetti
  assert.equal(bei(4)[1][1].menge, 4000);                   // Wasser ohne Teilmenge = ganze Menge
  assert.equal(skaliere(holeRezept(s, speichereRezept(s, curry()).id), { portionen: 4 }).schritte, null);
});

test('Zutaten je Schritt: Teilmenge folgt der Regel der Zutat (fix bleibt, ganz rundet)', () => {
  const r = {
    art: 'kochen', portionen: 2,
    zutaten: [{ zutat: 'backpulver', menge: 1, einheit: 'TL', regel: 'fix' }, { zutat: 'eier', menge: 3, einheit: 'Stück', regel: 'ganz' }],
    schrittzutaten: [[{ zutat: 'backpulver', menge: 1 }, { zutat: 'eier', menge: 1 }]],
  };
  const s = skaliere(r, { portionen: 4 }).schritte[0];
  assert.equal(s[0].menge, 1);
  assert.equal(s[1].menge, 2);
});

test('Rezept löschen und „Rückgängig“: gleicher Inhalt, gleiche id', () => {
  const s = neuerSpeicher();
  const id = speichereRezept(s, mitSchrittzutaten()).id;
  const alt = s.hole('rezepte', id);
  s.loesche('rezepte', id);
  assert.equal(holeRezept(s, id), null);
  s.speichere('rezepte', alt);
  const neu = holeRezept(s, id);
  assert.equal(neu.name, 'Nudeln');
  assert.deepEqual(neu.schrittzutaten, holeRezept(s, id).schrittzutaten);
  assert.equal(alleRezepte(s).length, 1);
});

// ---------- Ernährungsform ----------

test('Ernährungsform: Icon und Text, „auch vegetarisch“ nur bei Fisch/Fleisch, ohne Angabe nichts', () => {
  assert.deepEqual(ernaehrungAnzeige({ ernaehrung: 'vegan' }), { zeichen: '🌱', text: 'Vegan' });
  assert.deepEqual(ernaehrungAnzeige({ ernaehrung: 'vegetarisch' }), { zeichen: '🥕', text: 'Vegetarisch' });
  assert.deepEqual(ernaehrungAnzeige({ ernaehrung: 'fisch' }), { zeichen: '🐟', text: 'Fisch' });
  assert.deepEqual(ernaehrungAnzeige({ ernaehrung: 'fleisch', auchVegetarisch: true }),
    { zeichen: '🥩/🥕', text: 'Fleisch · auch vegetarisch möglich' });
  assert.deepEqual(ernaehrungAnzeige({ ernaehrung: 'vegan', auchVegetarisch: true }), { zeichen: '🌱', text: 'Vegan' });
  assert.equal(ernaehrungAnzeige({}), null);
  assert.equal(ernaehrungAnzeige({ ernaehrung: 'pescetarisch' }), null);
  assert.equal(ernaehrungAnzeige(null), null);
});

test('Ernährungsform im Rezept: optional, Unbekanntes fällt weg, „auch vegetarisch“ nur als true bei Fisch/Fleisch', () => {
  const basis = { art: 'kochen', name: 'Curry', portionen: 2 };
  assert.equal('ernaehrung' in bereinigeRezept(basis), false, 'alte Rezepte bleiben gültig');
  assert.equal(bereinigeRezept({ ...basis, ernaehrung: 'vegetarisch' }).ernaehrung, 'vegetarisch');
  assert.equal('ernaehrung' in bereinigeRezept({ ...basis, ernaehrung: 'pescetarisch' }), false);
  const fleisch = bereinigeRezept({ ...basis, ernaehrung: 'fleisch', auchVegetarisch: true });
  assert.deepEqual([fleisch.ernaehrung, fleisch.auchVegetarisch], ['fleisch', true]);
  assert.equal('auchVegetarisch' in bereinigeRezept({ ...basis, ernaehrung: 'vegan', auchVegetarisch: true }), false);
  assert.equal('auchVegetarisch' in bereinigeRezept({ ...basis, ernaehrung: 'fisch', auchVegetarisch: false }), false);
  assert.equal('auchVegetarisch' in bereinigeRezept({ ...basis, ernaehrung: 'fisch', auchVegetarisch: 'ja' }), false);
  assert.equal('auchVegetarisch' in bereinigeRezept({ ...basis, auchVegetarisch: true }), false);
});

test('Ernährungsform bleibt beim Speichern von Status und Notiz erhalten', () => {
  const s = neuerSpeicher();
  const gespeichert = speichereRezept(s, { art: 'kochen', name: 'Chili', portionen: 4, ernaehrung: 'fleisch', auchVegetarisch: true });
  speichereRezept(s, { ...holeRezept(s, gespeichert.id), status: 'testen', notiz: 'Bohnen statt Hack für die Vegetarierin.' });
  const r = holeRezept(s, gespeichert.id);
  assert.deepEqual([r.ernaehrung, r.auchVegetarisch, r.status], ['fleisch', true, 'testen']);
});
