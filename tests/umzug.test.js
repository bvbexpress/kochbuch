// Tests für den Umzug der Teigvorlagen in Back-Rezepte (rezepte/umzug.js). Zwei Handys: tests/sync.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import { zieheVorlagenUm, BACK_REZEPTE, eingebautesBackRezept, rezeptAusVorlage } from '../js/rezepte/umzug.js';
import { alleRezepte, holeRezept, bereinigeRezept } from '../js/rezepte/rezept.js';
import { VORLAGEN, ladeVorlage, speichereEigeneVorlage } from '../js/teig/vorlagen.js';
import { zusammenfassung } from '../js/teig/startseite.js';
import { faktorFuer } from '../js/rezepte/rechner.js';

const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());
const gesehen = (s) => s.einstellung('rezepte.gesehen', []);

test('Eingebaute Back-Rezepte: erprobt, Schritte mit Gerät, Teig wie die alte Vorlage', () => {
  for (const e of BACK_REZEPTE) {
    const r = eingebautesBackRezept(e);
    const vorlage = VORLAGEN.find((v) => v.id === e.vorlage);
    assert.ok(r, e.name);
    assert.equal(r.art, 'backen');
    assert.equal(r.status, 'erprobt');
    assert.equal(r.kategorie, vorlage.kategorie);
    assert.equal(r.schrittgeraete.length, r.schritte.length);
    assert.deepEqual(r.teig, ladeVorlage(vorlage).teig);
    assert.equal(zusammenfassung(r), zusammenfassung(vorlage), 'Liste zeigt dieselben Werte');
    assert.deepEqual(bereinigeRezept(r), r, 'unverändert gültig');
    assert.ok(r.notiz.length > 0);
  }
  const brot = eingebautesBackRezept(BACK_REZEPTE[0]);
  assert.equal(brot.name, 'Weizenvollkorn-Sauerteigbrot');
  assert.equal(brot.schritte.length, 9);
  assert.equal(brot.schrittgeraete[7], 'Ofen 240 °C');
  const focaccia = eingebautesBackRezept(BACK_REZEPTE[1]);
  assert.equal(focaccia.name, 'Sauerteig-Focaccia');
  assert.equal(focaccia.schritte.length, 8);
  assert.equal(focaccia.mehl, 300);
});

test('Eigene Vorlage wird Back-Rezept mit derselben id, Menge, Modus und Teiglinge bleiben', () => {
  const s = neuerSpeicher();
  const v = speichereEigeneVorlage(s, {
    name: 'Pizza', kategorie: 'pizza', modus: 'teiglinge', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 600,
    teiglinge: { anzahl: 6, gewicht: 230, verlust: 2 },
  });
  assert.deepEqual(zieheVorlagenUm(s), { angelegt: 3, fehler: 0 });
  const r = holeRezept(s, v.id);
  assert.equal(r.name, 'Pizza');
  assert.equal(r.modus, 'teiglinge');
  assert.deepEqual(r.teiglinge, { anzahl: 6, gewicht: 230, verlust: 2 });
  assert.equal(r.mehl, 600);
  assert.equal(zusammenfassung(r), zusammenfassung(v));
  assert.deepEqual(r.schritte, []);
  assert.equal(faktorFuer(r, { teiglinge: r.teiglinge }) > 0, true);
  assert.equal(s.offene('rezepte').length, 3, 'geht beim nächsten Abgleich hoch');
});

test('Gleiche Vorlage → genau dasselbe Rezept (beide Handys erzeugen denselben Inhalt)', () => {
  const v = { id: '11111111-2222-4333-8444-555555555555', name: 'Brot', teig: ladeVorlage(VORLAGEN[1]).teig, mehl: 500 };
  assert.deepEqual(rezeptAusVorlage(structuredClone(v)), rezeptAusVorlage(structuredClone(v)));
  assert.equal(rezeptAusVorlage({ ...v, teig: { kaputt: true } }), null);
});

test('Zweiter Aufruf ändert nichts; Konflikt-Vermerk zieht mit um', () => {
  const s = neuerSpeicher();
  const a = speichereEigeneVorlage(s, { name: 'Brot', teig: ladeVorlage(VORLAGEN[1]).teig, mehl: 500 });
  const kopie = s.speichere('teigvorlagen', {
    name: 'Brot (Änderung vom 3.10.)', teig: ladeVorlage(VORLAGEN[1]).teig, mehl: 600, konflikt: { von: a.id, am: 5 },
  });
  zieheVorlagenUm(s);
  const davor = JSON.stringify(s.alle('rezepte'));
  assert.deepEqual(zieheVorlagenUm(s), { angelegt: 0, fehler: 0 });
  assert.equal(JSON.stringify(s.alle('rezepte')), davor);
  assert.deepEqual(holeRezept(s, kopie.id).konflikt, { von: a.id, am: 5 });
});

test('Unbrauchbare Vorlage: wird gezählt, bleibt als Vorlage erhalten, der Rest zieht um', () => {
  const s = neuerSpeicher();
  const kaputt = s.speichere('teigvorlagen', { name: 'Alt', teig: { hydration: 'viel' }, mehl: 500 });
  assert.deepEqual(zieheVorlagenUm(s), { angelegt: 2, fehler: 1 });
  assert.ok(s.hole('teigvorlagen', kaputt.id));
  assert.equal(alleRezepte(s, 'backen').length, 2);
});

test('Favoriten der eingebauten Vorlagen gehen aufs Back-Rezept über; Umgezogenes gilt als gesehen', () => {
  const s = neuerSpeicher();
  const v = speichereEigeneVorlage(s, { name: 'Brot', teig: ladeVorlage(VORLAGEN[1]).teig, mehl: 500 });
  s.setzeEinstellung('teig.favoriten', ['focaccia', v.id]);
  s.setzeEinstellung('rezepte.gesehen', ['x']);
  zieheVorlagenUm(s);
  const focaccia = BACK_REZEPTE.find((e) => e.vorlage === 'focaccia').id;
  assert.deepEqual(s.einstellung('teig.favoriten'), [focaccia, v.id]);
  assert.deepEqual(new Set(gesehen(s)), new Set(['x', ...BACK_REZEPTE.map((e) => e.id), v.id]));
  // Stern später entfernt: ein weiterer Umzug setzt ihn nicht wieder
  s.setzeEinstellung('teig.favoriten', [v.id]);
  zieheVorlagenUm(s);
  assert.deepEqual(s.einstellung('teig.favoriten'), [v.id]);
});

test('speicher.kennt: auch gelöschte Datensätze zählen', () => {
  const s = neuerSpeicher();
  const d = s.speichere('rezepte', { name: 'x' });
  assert.equal(s.kennt('rezepte', d.id), true);
  s.loesche('rezepte', d.id);
  assert.equal(s.kennt('rezepte', d.id), true);
  assert.equal(s.hole('rezepte', d.id), null);
  assert.equal(s.kennt('rezepte', 'gibt-es-nicht'), false);
});

// ---------- Teigmengen je Schritt (schrittteig) ----------

import { berechne, gesamtmehlAusMehl, teigInSchritten } from '../js/teig/rechner.js';

const mengen = (r, mehl) => teigInSchritten(r.schrittteig, r.teig, berechne(r.teig, gesamtmehlAusMehl(r.teig, mehl)))
  .map((je) => je.map((m) => `${Math.round(m.gramm)} ${m.name}`));

test('Brot: Zutaten je Schritt, Wasser fest 90 % / 10 % aufgeteilt, skaliert mit dem Mehl', () => {
  const brot = eingebautesBackRezept(BACK_REZEPTE[0]);
  assert.equal(brot.schrittteig.length, brot.schritte.length);
  const m = mengen(brot, 500);
  assert.deepEqual(m.slice(0, 5), [
    ['50 Sonnenblumenkerne', '25 Leinsamen', '80 Quellwasser'],
    ['500 Weizenvollkorn', '360 Wasser'],
    ['100 Starter', '40 Wasser'],
    ['11 Salz'],
    [],
  ]);
  const doppelt = mengen(brot, 1000);
  assert.deepEqual(doppelt[1], ['1000 Weizenvollkorn', '720 Wasser']);
  assert.deepEqual(doppelt[2], ['200 Starter', '80 Wasser']);
  assert.ok(brot.notiz.includes('gusseisernen Topf'));
});

test('Focaccia: Schritt 1 Starter, ganzes Wasser, Mehl; Schritt 2 Salz und Öl', () => {
  const f = eingebautesBackRezept(BACK_REZEPTE[1]);
  const m = mengen(f, 300);
  assert.deepEqual(m[0], ['50 Starter', '225 Wasser', '300 Tipo 00']);
  assert.deepEqual(m[1], ['7 Salz', '15 Öl']);
  assert.equal(f.schritte[0], 'Starter im Wasser auflösen, Mehl einarbeiten.');
});

test('schrittteig: nur bekannte Teile, je Schritt einmal, Anteil 0–1, nur bei Back-Rezepten, leere Schritte nehmen ihren Eintrag mit', () => {
  const f = eingebautesBackRezept(BACK_REZEPTE[1]);
  const r = bereinigeRezept({
    ...f,
    schritte: ['A', '', 'B'],
    schrittgeraete: ['', '', ''],
    schrittteig: [
      [{ teil: 'wasser', anteil: 0.5 }, { teil: 'wasser' }, { teil: 'zucker' }, { teil: 'salz', anteil: 2 }],
      [{ teil: 'mehl' }],
      [{ teil: 'mehl', anteil: 1 }],
    ],
  });
  assert.deepEqual(r.schrittteig, [[{ teil: 'wasser', anteil: 0.5 }], [{ teil: 'mehl' }]]);
  assert.equal(bereinigeRezept({ ...f, schrittteig: [[], []] }).schrittteig, undefined, 'ohne Einträge fehlt das Feld');
  const kochen = bereinigeRezept({ art: 'kochen', name: 'Dal', portionen: 2, schritte: ['A'], schrittteig: [[{ teil: 'mehl' }]] });
  assert.equal(kochen.schrittteig, undefined);
});

test('teigInSchritten: Teile, die der Teig nicht hat, fehlen; ohne Ergebnis nur Namen', () => {
  const f = eingebautesBackRezept(BACK_REZEPTE[1]);
  const ohne = teigInSchritten([[{ teil: 'hefe' }, { teil: 'quellwasser' }, { teil: 'oel' }]], f.teig);
  assert.deepEqual(ohne, [[{ name: 'Öl', gramm: null }]]);
  assert.equal(teigInSchritten(undefined, f.teig), null);
});
