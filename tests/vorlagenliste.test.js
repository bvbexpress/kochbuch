// Tests für Schritt 12: Kategorien, Modus je Vorlage, Vorlagenliste, Zusatzzutaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import {
  VORLAGEN,
  ladeVorlage,
  alleVorlagen,
  eigeneVorlagen,
  holeEigeneVorlage,
  loescheEigeneVorlage,
  stelleEigeneVorlageWiederHer,
  speichereEigeneVorlage,
  ordneVorlagen,
  modusVon,
  bereinigeKategorie,
  favoriten,
  ausgeblendet,
  schalteFavorit,
  blendeAus,
  normalisiereTeig,
  STANDARD_TEIGLINGE,
} from '../js/teig/vorlagen.js';
import { bereinigeVorlage } from '../js/teig/pruefung.js';
import { sicherungsDatei, liesSicherung, stelleWiederHer } from '../js/kern/sicherung.js';
import { zusammenfassung, vorlagenListeHtml } from '../js/teig/startseite.js';
import { berechne, gesamtmehlAusMehl, mehlFuerTeiglinge, mehlAusTeiglingen } from '../js/teig/rechner.js';
import { ZUSAETZE } from '../js/teig/zutaten.js';

const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());
const teigVon = (i = 0) => ladeVorlage(VORLAGEN[i]).teig;

/** Eigene Vorlage in einem Test-Speicher anlegen. */
function lege(s, name, extra = {}) {
  return speichereEigeneVorlage(s, { name, teig: teigVon(), mehl: 400, ...extra });
}

// ---------- Eingebaute Vorlagen ----------

test('Eingebaute Vorlagen: Namen, Kategorien, Mehl-Modus', () => {
  const [focaccia, brot] = VORLAGEN;
  assert.equal(focaccia.name, 'Focaccia');
  assert.equal(brot.name, 'Weizenvollkornbrot');
  assert.equal(focaccia.kategorie, 'focaccia');
  assert.equal(brot.kategorie, 'brot');
  for (const v of VORLAGEN) assert.equal(ladeVorlage(v).modus, 'mehl');
});

test('Liste zeigt dieselbe Hydration wie der Rechner (Focaccia 76,9 %)', () => {
  assert.equal(zusammenfassung(VORLAGEN[0]), '300 g Mehl · 76,9 %');
  assert.equal(zusammenfassung(VORLAGEN[1]), '500 g Mehl · 81,8 %');
  const { teig } = ladeVorlage(VORLAGEN[0]);
  assert.equal(Math.round(teig.hydration * 10) / 10, 76.9);
});

test('Liste im Teiglinge-Modus: Anzahl × Gewicht', () => {
  const s = neuerSpeicher();
  lege(s, 'Pizza', { modus: 'teiglinge', teiglinge: { anzahl: 4, gewicht: 250, verlust: 2 } });
  assert.equal(zusammenfassung(eigeneVorlagen(s)[0]), '4 × 250 g · 76,9 %');
});

// ---------- Modus und Kategorie ----------

test('Modus: ausdrücklich gespeichert, sonst wie bisher aus der Teiglinge-Angabe', () => {
  assert.equal(modusVon({ modus: 'teiglinge' }), 'teiglinge');
  assert.equal(modusVon({ modus: 'mehl', teiglinge: STANDARD_TEIGLINGE }), 'mehl');
  assert.equal(modusVon({ teiglinge: STANDARD_TEIGLINGE }), 'teiglinge'); // alte Vorlage
  assert.equal(modusVon({}), 'mehl');
  assert.equal(modusVon({ modus: 'quatsch' }), 'mehl');
});

test('Kategorie: nur bekannte, sonst „Ohne Kategorie“ (null)', () => {
  assert.equal(bereinigeKategorie('pizza'), 'pizza');
  for (const x of [undefined, null, '', 'Pizza', 'kuchen', 3]) assert.equal(bereinigeKategorie(x), null);
});

test('Speichern mit Kategorie und Modus; Laden liefert beides zurück', () => {
  const s = neuerSpeicher();
  lege(s, 'Buns', { kategorie: 'broetchen', modus: 'teiglinge', teiglinge: { anzahl: 8, gewicht: 85, verlust: 2 } });
  const v = eigeneVorlagen(s)[0];
  const geladen = ladeVorlage(v);
  assert.equal(geladen.kategorie, 'broetchen');
  assert.equal(geladen.modus, 'teiglinge');
  assert.deepEqual(geladen.teiglinge, { anzahl: 8, gewicht: 85, verlust: 2 });
});

test('Mehl-Modus speichert keine Teiglinge-Angabe (ältere App-Stände verstehen das richtig)', () => {
  const s = neuerSpeicher();
  const v = lege(s, 'Brot', { modus: 'mehl', teiglinge: { anzahl: 8, gewicht: 85, verlust: 2 } });
  assert.equal('teiglinge' in v, false);
  assert.equal(v.modus, 'mehl');
});

test('Teiglinge-Modus ohne Angabe bekommt Startwerte', () => {
  const s = neuerSpeicher();
  const v = lege(s, 'Pizza', { modus: 'teiglinge' });
  assert.deepEqual(v.teiglinge, STANDARD_TEIGLINGE);
});

test('Alte eigene Vorlage ohne Kategorie und Modus lädt weiter', () => {
  const s = neuerSpeicher();
  s.speichere('teigvorlagen', { name: 'Alt', teig: teigVon(), mehl: 450, teiglinge: { anzahl: 4, gewicht: 250, verlust: 2 } });
  s.speichere('teigvorlagen', { name: 'Alt2', teig: teigVon(), mehl: 450 });
  const [a, b] = eigeneVorlagen(s);
  assert.equal(a.kategorie, null);
  assert.equal(a.modus, 'teiglinge');
  assert.equal(b.modus, 'mehl');
});

// ---------- Vorlagenliste ----------

test('Liste: nach Kategorien in fester Reihenfolge, „Ohne Kategorie“ am Ende, leere Gruppen fehlen', () => {
  const s = neuerSpeicher();
  lege(s, 'Margherita', { kategorie: 'pizza' });
  lege(s, 'Alt');
  lege(s, 'Brioche', { kategorie: 'gebaeck' });
  const o = ordneVorlagen(alleVorlagen(s));
  assert.deepEqual(o.gruppen.map((g) => g.name), ['Brot', 'Pizza', 'Focaccia', 'Gebäck', 'Ohne Kategorie']);
  assert.deepEqual(o.gruppen.at(-1).vorlagen.map((v) => v.name), ['Alt']);
  assert.equal(o.anzahl, 5);
});

test('Liste: innerhalb einer Gruppe alphabetisch', () => {
  const s = neuerSpeicher();
  for (const n of ['Zwiebelbrot', 'Bauernbrot', 'Ölbrot']) lege(s, n, { kategorie: 'brot' });
  const brot = ordneVorlagen(alleVorlagen(s)).gruppen[0];
  assert.deepEqual(brot.vorlagen.map((v) => v.name), ['Bauernbrot', 'Ölbrot', 'Weizenvollkornbrot', 'Zwiebelbrot']);
});

test('Favoriten oben und nicht doppelt in ihrer Kategorie', () => {
  const s = neuerSpeicher();
  schalteFavorit(s, 'focaccia');
  const o = ordneVorlagen(alleVorlagen(s), { favoriten: favoriten(s) });
  assert.deepEqual(o.favoriten.map((v) => v.id), ['focaccia']);
  assert.ok(!o.gruppen.some((g) => g.vorlagen.some((v) => v.id === 'focaccia')));
  schalteFavorit(s, 'focaccia');
  assert.deepEqual(favoriten(s), []);
});

test('Ausblenden: nur eingebaute, wieder einblendbar, zählt nicht für die Suche', () => {
  const s = neuerSpeicher();
  const eigene = lege(s, 'Eigene');
  blendeAus(s, 'focaccia');
  blendeAus(s, eigene.id); // eigene werden nicht ausgeblendet, sondern gelöscht
  let o = ordneVorlagen(alleVorlagen(s), { ausgeblendet: ausgeblendet(s) });
  assert.deepEqual(o.ausgeblendet.map((v) => v.id), ['focaccia']);
  assert.equal(o.anzahl, 2);
  assert.ok(o.gruppen.some((g) => g.vorlagen.some((v) => v.id === eigene.id)));
  blendeAus(s, 'focaccia', false);
  o = ordneVorlagen(alleVorlagen(s), { ausgeblendet: ausgeblendet(s) });
  assert.equal(o.ausgeblendet.length, 0);
});

test('Suche: Teil des Namens, Groß-/Kleinschreibung egal, auch in Favoriten', () => {
  const s = neuerSpeicher();
  lege(s, 'Pizza Napoli', { kategorie: 'pizza' });
  lege(s, 'Pinsa', { kategorie: 'pizza' });
  schalteFavorit(s, 'focaccia');
  const o = ordneVorlagen(alleVorlagen(s), { favoriten: favoriten(s), suche: '  PI ' });
  assert.deepEqual(o.gruppen.flatMap((g) => g.vorlagen.map((v) => v.name)), ['Pinsa', 'Pizza Napoli']);
  assert.equal(o.favoriten.length, 0);
  assert.equal(o.anzahl, 4); // Anzahl ohne Suche – sonst verschwände das Suchfeld beim Tippen
  assert.deepEqual(ordneVorlagen(alleVorlagen(s), { favoriten: favoriten(s), suche: 'acc' }).favoriten.map((v) => v.id), ['focaccia']);
});

test('Kaputte Einstellungen für Favoriten/Ausgeblendet blockieren nichts', () => {
  const s = neuerSpeicher();
  s.setzeEinstellung('teig.favoriten', 'kaputt');
  s.setzeEinstellung('teig.ausgeblendet', [1, null, 'focaccia']);
  assert.deepEqual(favoriten(s), []);
  assert.deepEqual(ausgeblendet(s), ['focaccia']);
});

// ---------- Sicherung und Prüfung von außen ----------

test('Sicherung: Kategorie, Modus und Zusatzzutaten kommen mit', () => {
  const s = neuerSpeicher();
  const teig = { ...teigVon(), zusaetze: [{ id: 'milch', name: 'Milch', prozent: 20, wasser: 87 }] };
  speichereEigeneVorlage(s, { name: 'Brioche', teig, mehl: 500, kategorie: 'gebaeck', modus: 'teiglinge',
    teiglinge: { anzahl: 2, gewicht: 450, verlust: 2 } });
  const gelesen = liesSicherung(sicherungsDatei(s).inhalt);
  const [v] = gelesen.sammlungen.teigvorlagen;
  assert.equal(v.kategorie, 'gebaeck');
  assert.equal(v.modus, 'teiglinge');
  assert.deepEqual(v.teig.zusaetze, [{ id: 'milch', name: 'Milch', prozent: 20, wasser: 87 }]);

  const b = neuerSpeicher();
  stelleWiederHer(b, gelesen);
  const zurueck = eigeneVorlagen(b)[0];
  assert.equal(zurueck.kategorie, 'gebaeck');
  assert.equal(zurueck.modus, 'teiglinge');
});

test('Prüfung: alte Vorlage ohne Kategorie, Modus, Zusatzzutaten funktioniert', () => {
  const s = neuerSpeicher();
  const v = lege(s, 'Alt');
  const alt = { id: v.id, name: 'Alt', mehl: 400, geaendert: 1, teig: { ...v.teig } };
  delete alt.teig.zusaetze;
  const sauber = bereinigeVorlage(alt);
  assert.ok(sauber);
  assert.equal('kategorie' in sauber, false);
  assert.equal(modusVon(sauber), 'mehl');
  assert.deepEqual(sauber.teig.zusaetze, []);
});

test('Prüfung: unbekannte Kategorie/Modus fallen weg, unsinnige Zusatzzutaten verwerfen die Vorlage', () => {
  const s = neuerSpeicher();
  const v = lege(s, 'X');
  const roh = { id: v.id, name: 'X', mehl: 400, geaendert: 1, teig: v.teig };
  const sauber = bereinigeVorlage({ ...roh, kategorie: '<b>', modus: 'alles' });
  assert.equal('kategorie' in sauber, false);
  assert.equal('modus' in sauber, false);
  const zusatz = (z) => bereinigeVorlage({ ...roh, teig: { ...v.teig, zusaetze: [z] } });
  assert.equal(zusatz({ name: 'Milch', prozent: 20, wasser: 120 }), null);
  assert.equal(zusatz({ name: 'Milch', prozent: -1, wasser: 87 }), null);
  assert.equal(zusatz({ name: '', prozent: 20, wasser: 87 }), null);
  assert.ok(zusatz({ name: 'Milch', prozent: 20, wasser: 87 }));
});

// ---------- Zusatzzutaten im Rechner ----------

const MILCH = { id: 'milch', name: 'Milch', prozent: 30, wasser: 87 };
const EI = { id: 'ei', name: 'Ei', prozent: 10, wasser: 75 };
const einfacherTeig = (zusaetze) => ({
  hydration: 65, starter: 0, salz: 2, oel: 0, hefe: 1, hefeArt: 'frisch',
  mehlsorten: [{ id: 'weizen550', name: 'Weizen 550', anteil: 100 }], saaten: [], quellwasser: 0, zusaetze,
});

test('Zusatzzutaten: ihr Wasser zählt zur Hydration, es kommt weniger Wasser dazu', () => {
  // 500 g Mehl, 65 % → 325 g Wasser gesamt. 30 % Milch = 150 g, davon 130,5 g Wasser.
  const e = berechne(einfacherTeig([MILCH]), 500);
  assert.equal(e.wasserGesamt, 325);
  assert.equal(e.zusaetze[0].gramm, 150);
  assert.ok(Math.abs(e.zusatzWasser - 130.5) < 1e-9);
  assert.ok(Math.abs(e.wasser - 194.5) < 1e-9);
  assert.deepEqual(e.hinweise, []);
});

test('Zusatzzutaten: Teig gesamt zählt nichts doppelt', () => {
  const ohne = berechne(einfacherTeig([]), 500);
  const mit = berechne(einfacherTeig([MILCH, EI]), 500);
  // Gewogen wird: Mehl + Wasser + Milch + Ei + Salz + Hefe
  const gewogen = mit.mehl + mit.wasser + mit.zusaetze[0].gramm + mit.zusaetze[1].gramm + mit.salz + mit.hefe;
  assert.ok(Math.abs(mit.teigGesamt - gewogen) < 1e-9);
  // Nur die Trockenmasse von Milch und Ei kommt dazu
  assert.ok(Math.abs(mit.teigGesamt - ohne.teigGesamt - (150 * 0.13 + 50 * 0.25)) < 1e-9);
});

test('Zusatzzutaten mit Starter: Wasser aus beiden wird abgezogen', () => {
  const teig = { ...einfacherTeig([MILCH]), starter: 20 };
  const e = berechne(teig, 500);
  assert.ok(Math.abs(e.wasser - (325 - 50 - 130.5)) < 1e-9);
});

test('Zu viel Milch für die Hydration → Hinweis, kein negatives Wasser', () => {
  const e = berechne(einfacherTeig([{ ...MILCH, prozent: 90 }]), 500);
  assert.ok(e.hinweise.includes('hydration-zu-niedrig'));
  assert.equal(e.wasser, 0);
});

test('Teiglinge-Modus mit Zusatzzutaten trifft das Teiggewicht genau', () => {
  const teig = { ...einfacherTeig([MILCH, EI]), starter: 15 };
  const mehl = mehlFuerTeiglinge(teig, 6, 80, 0);
  const e = berechne(teig, gesamtmehlAusMehl(teig, mehl));
  assert.ok(Math.abs(e.teigGesamt - 480) < 1e-6);
  assert.ok(Math.abs(mehlAusTeiglingen(teig, 6, 80, 0) - e.gesamtmehl) < 1e-6);
});

test('Ältere Teige ohne Zusatzzutaten bekommen eine leere Liste; Unsinniges fliegt raus', () => {
  assert.deepEqual(normalisiereTeig(teigVon()).zusaetze, []);
  const t = normalisiereTeig({ ...teigVon(), zusaetze: [MILCH, null, { name: 'X', prozent: 'viel' }, { name: 'Y', prozent: 5, wasser: 300 }] });
  assert.deepEqual(t.zusaetze, [MILCH, { id: null, name: 'Y', prozent: 5, wasser: 0 }]);
});

test('Katalog der Zusatzzutaten: Milch, Ei, Butter, Zucker, Honig mit Wasseranteil 0–100', () => {
  assert.deepEqual(ZUSAETZE.map((z) => z.name), ['Milch', 'Ei', 'Butter', 'Zucker', 'Honig']);
  for (const z of ZUSAETZE) assert.ok(z.wasser >= 0 && z.wasser <= 100, z.id);
});

// ---------- Wischen: Löschen/Ausblenden mit „Rückgängig“ ----------

test('Löschen rückgängig: eigene Vorlage kommt mit altem Inhalt und gleicher id zurück', () => {
  const s = neuerSpeicher();
  const v = lege(s, 'Mein Brot', { kategorie: 'brot' });
  const alt = holeEigeneVorlage(s, v.id);
  assert.ok(loescheEigeneVorlage(s, v.id));
  assert.equal(holeEigeneVorlage(s, v.id), null);
  assert.equal(s.offene('teigvorlagen').length, 1, 'der Grabstein geht beim Abgleich hoch');

  assert.ok(stelleEigeneVorlageWiederHer(s, alt));
  const zurueck = holeEigeneVorlage(s, v.id);
  assert.equal(zurueck.name, 'Mein Brot');
  assert.equal(zurueck.kategorie, 'brot');
  assert.equal(zurueck.mehl, 400);
  assert.equal(zurueck.erstellt, alt.erstellt);
  assert.ok(alleVorlagen(s).some((x) => x.id === v.id));
  assert.equal(s.offene('teigvorlagen').length, 1, 'wiederhergestellt = offene Änderung');
});

test('Ausblenden rückgängig: eingebaute Vorlage ist wieder sichtbar', () => {
  const s = neuerSpeicher();
  const id = VORLAGEN[0].id;
  blendeAus(s, id);
  assert.ok(ordneVorlagen(alleVorlagen(s), { ausgeblendet: ausgeblendet(s) }).ausgeblendet.some((x) => x.id === id));
  blendeAus(s, id, false);
  assert.deepEqual(ausgeblendet(s), []);
});

test('Vorlagenliste: roter Knopf heißt „Löschen“ (eigene) bzw. „Ausblenden“ (eingebaute)', () => {
  const s = neuerSpeicher();
  lege(s, 'Mein Brot');
  const html = vorlagenListeHtml(
    ordneVorlagen(alleVorlagen(s), {}),
    { sterne: new Set(), suche: '', ausgeblendetOffen: false },
  );
  const knoepfe = [...html.matchAll(/class="vorlage-weg"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.equal(knoepfe.length, alleVorlagen(s).length);
  assert.equal(knoepfe.filter((t) => t === 'Löschen').length, 1);
  assert.equal(knoepfe.filter((t) => t === 'Ausblenden').length, VORLAGEN.length);
  assert.ok(!html.includes('vorlage-weg" data-weg="" '), 'jede Zeile hat eine id');
});
