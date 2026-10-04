// Tests für Etappe 3, Schritt 2: Kochen – Liste ordnen, Favoriten, „neu“, Mengen in den Schritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { speichereRezept, alleRezepte, holeRezept } from '../js/rezepte/rezept.js';
import { alleZutaten } from '../js/rezepte/katalog.js';
import { skaliere } from '../js/rezepte/rechner.js';
import {
  ordneRezepte, portionenText, rezeptFavoriten, schalteRezeptFavorit, gesehen, markiereGesehen,
  mengenInSchritten, SUCHE_AB,
} from '../js/rezepte/liste.js';

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
