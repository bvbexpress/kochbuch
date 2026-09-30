// Tests für Schritt 6: Mehlauswahl, Wasseraufnahme, Quellstück, Hinweise.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  berechne,
  mischwert,
  hydrationNachMehlwechsel,
  mehlsortenMitGramm,
  mehlsortenMitAnteil,
  quellbedarf,
  quellwasserNachSaatwechsel,
  mehlHinweise,
} from '../js/teig/rechner.js';
import { MEHLE, SAATEN, mehle, saaten, werteVon, artVon } from '../js/teig/zutaten.js';
import { VORLAGEN, ladeVorlage, normalisiereTeig, alleVorlagen } from '../js/teig/vorlagen.js';
import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';

function ungefaehr(ist, soll, text) {
  assert.ok(Math.abs(ist - soll) < 1e-9, `${text ?? ''} erwartet ${soll}, erhalten ${ist}`);
}

const wasserVon = werteVon(MEHLE, 'wasser', 65);
const verhaeltnisVon = werteVon(SAATEN, 'verhaeltnis', 1);
const art = artVon(MEHLE);
const neuerSpeicher = () => erstelleSpeicher(speicherImArbeitsspeicher());

// ---------- Standardwerte ----------

test('Standardwerte wie abgesprochen', () => {
  const w = Object.fromEntries(MEHLE.map((m) => [m.name, m.wasser]));
  assert.deepEqual(w, {
    'Tipo 00': 60, 'Weizen 550': 65, Weizenvollkorn: 75, Dinkelvollkorn: 70,
    'Roggen 1150': 78, Roggenvollkorn: 83, Hafervollkorn: 80,
  });
  const v = Object.fromEntries(SAATEN.map((s) => [s.name, s.verhaeltnis]));
  assert.deepEqual(v, {
    Leinsamen: 2.5, Sonnenblumenkerne: 1, Kürbiskerne: 1, Sesam: 1, Chiasamen: 5, Haferflocken: 2,
  });
});

// ---------- Mischwert und Wasseranpassung ----------

test('Mischwert ist der gewichtete Mittelwert', () => {
  ungefaehr(mischwert([{ id: 'tipo00', anteil: 50 }, { id: 'weizenvollkorn', anteil: 50 }], wasserVon), 67.5);
  ungefaehr(mischwert([{ id: 'tipo00', anteil: 70 }, { id: 'roggenvollkorn', anteil: 30 }], wasserVon), 66.9);
  assert.equal(mischwert([{ id: 'tipo00', anteil: 0 }], wasserVon), null);
});

test('Unbekanntes Mehl rechnet mit 65 %', () => {
  ungefaehr(mischwert([{ id: 'gibtsnicht', anteil: 100 }], wasserVon), 65);
});

test('Mehl tauschen ohne Starter: Hydration ändert sich um den Unterschied', () => {
  const teig = { hydration: 60, starter: 0 };
  const neu = hydrationNachMehlwechsel(teig, [{ id: 'tipo00', anteil: 100 }], [{ id: 'weizenvollkorn', anteil: 100 }], wasserVon);
  ungefaehr(neu, 75);
});

test('Focaccia: halb Weizenvollkorn ergibt rund 81 % (Starter-Mehl bleibt)', () => {
  const { teig } = ladeVorlage(VORLAGEN[0]);
  const neu = hydrationNachMehlwechsel(
    teig,
    teig.mehlsorten,
    [{ id: 'tipo00', anteil: 50 }, { id: 'weizenvollkorn', anteil: 50 }],
    wasserVon,
  );
  // 76,9 % + 7,5 × (300 / 325)
  ungefaehr(neu, teig.hydration + 7.5 * (300 / 325));
  assert.equal(neu.toFixed(1), '83.8');
});

test('Selbst eingetippte Hydration bleibt Ausgangspunkt der Anpassung', () => {
  const teig = { hydration: 90, starter: 0 };
  const neu = hydrationNachMehlwechsel(teig, [{ id: 'weizen550', anteil: 100 }], [{ id: 'tipo00', anteil: 100 }], wasserVon);
  ungefaehr(neu, 85);
});

test('Hin und zurück tauschen ergibt wieder die Ausgangs-Hydration', () => {
  const teig = { hydration: 72, starter: 20 };
  const a = [{ id: 'tipo00', anteil: 100 }];
  const b = [{ id: 'dinkelvollkorn', anteil: 60 }, { id: 'roggen1150', anteil: 40 }];
  teig.hydration = hydrationNachMehlwechsel(teig, a, b, wasserVon);
  teig.hydration = hydrationNachMehlwechsel(teig, b, a, wasserVon);
  ungefaehr(teig.hydration, 72);
});

test('Ohne Mischwert (alle Anteile 0) keine Anpassung', () => {
  const teig = { hydration: 70, starter: 0 };
  assert.equal(hydrationNachMehlwechsel(teig, [{ id: 'tipo00', anteil: 0 }], [{ id: 'weizenvollkorn', anteil: 100 }], wasserVon), 70);
});

// ---------- Anteile in % oder Gramm ----------

test('Zwei Mehle: der andere Anteil wird auf 100 % ergänzt', () => {
  const sorten = [{ id: 'tipo00', anteil: 100 }, { id: 'weizenvollkorn', anteil: 0 }];
  const neu = mehlsortenMitAnteil(sorten, 1, 30);
  assert.deepEqual(neu.map((s) => s.anteil), [70, 30]);
});

test('Drei Mehle: die anderen bleiben unverändert', () => {
  const sorten = [{ anteil: 50 }, { anteil: 30 }, { anteil: 20 }];
  assert.deepEqual(mehlsortenMitAnteil(sorten, 0, 60).map((s) => s.anteil), [60, 30, 20]);
});

test('Eingabe in Gramm: Mehlmenge ist die Summe, Anteile passen', () => {
  const sorten = [{ id: 'tipo00', anteil: 100 }, { id: 'weizenvollkorn', anteil: 0 }];
  const { mehl, mehlsorten } = mehlsortenMitGramm(sorten, 1, 200, 300);
  assert.equal(mehl, 500);
  ungefaehr(mehlsorten[0].anteil, 60);
  ungefaehr(mehlsorten[1].anteil, 40);
});

// ---------- Quellstück ----------

test('Quellbedarf nach Verhältnis', () => {
  // 10 % Leinsamen × 2,5 + 5 % Sesam × 1
  ungefaehr(quellbedarf([{ id: 'leinsamen', prozent: 10 }, { id: 'sesam', prozent: 5 }], verhaeltnisVon), 30);
});

test('Vorlage Vollkornbrot behält exakt 80 g Quellwasser', () => {
  const { teig } = ladeVorlage(VORLAGEN[1]);
  ungefaehr(berechne(teig, 550).quellwasser, 80);
});

test('Saat hinzufügen: nur deren Bedarf kommt dazu', () => {
  const { teig } = ladeVorlage(VORLAGEN[1]);
  const kuerbis = { id: 'kuerbiskerne', prozent: (20 / 550) * 100 };
  teig.quellwasser = quellwasserNachSaatwechsel(teig, teig.saaten, [...teig.saaten, kuerbis], verhaeltnisVon);
  teig.saaten = [...teig.saaten, kuerbis];
  ungefaehr(berechne(teig, 550).quellwasser, 100); // 80 + 20 × 1
});

test('Saatmenge ändern: Mehrbedarf nach Verhältnis', () => {
  const { teig } = ladeVorlage(VORLAGEN[1]);
  const neu = teig.saaten.map((s) => (s.id === 'leinsamen' ? { ...s, prozent: (35 / 550) * 100 } : s));
  teig.quellwasser = quellwasserNachSaatwechsel(teig, teig.saaten, neu, verhaeltnisVon);
  ungefaehr((teig.quellwasser * 550) / 100, 105); // 80 + 10 × 2,5
});

test('Alle Saaten entfernt: kein Quellwasser', () => {
  const { teig } = ladeVorlage(VORLAGEN[1]);
  assert.equal(quellwasserNachSaatwechsel(teig, teig.saaten, [], verhaeltnisVon), 0);
});

test('Negatives Quellwasser wird als 0 gerechnet', () => {
  const teig = { hydration: 70, starter: 0, salz: 2, oel: 0, hefe: 0, mehlsorten: [],
    saaten: [{ id: 'sesam', prozent: 5 }], quellwasser: -3 };
  assert.equal(berechne(teig, 1000).quellwasser, 0);
});

// ---------- Hinweise ----------

test('Hafer: Hinweis bei Beimischung, deutlicher ab 20 %', () => {
  const t = (anteil) => ({ starter: 20, mehlsorten: [
    { id: 'weizen550', anteil: 100 - anteil }, { id: 'hafervollkorn', anteil }] });
  assert.deepEqual(mehlHinweise(t(0), art), []);
  assert.deepEqual(mehlHinweise(t(10), art), ['hafer']);
  assert.deepEqual(mehlHinweise(t(20), art), ['hafer-viel']);
});

test('Roggen ab 50 %: Hinweis nur ohne Sauerteig-Starter', () => {
  const sorten = [{ id: 'roggen1150', anteil: 50 }, { id: 'weizen550', anteil: 50 }];
  assert.deepEqual(mehlHinweise({ starter: 0, hefe: 1, mehlsorten: sorten }, art), ['roggen-ohne-sauerteig']);
  assert.deepEqual(mehlHinweise({ starter: 15, hefe: 0, mehlsorten: sorten }, art), []);
  const wenig = [{ id: 'roggenvollkorn', anteil: 40 }, { id: 'weizen550', anteil: 60 }];
  assert.deepEqual(mehlHinweise({ starter: 0, hefe: 1, mehlsorten: wenig }, art), []);
});

test('Eigene Mehle werden am Namen als Roggen/Hafer erkannt', () => {
  assert.equal(art('x', 'Roggen 997'), 'roggen');
  assert.equal(art('y', 'Haferkleie'), 'hafer');
  assert.equal(art('z', 'Emmer'), null);
});

// ---------- Einstellungen: eigene Sorten und geänderte Werte ----------

test('Wert eines eingebauten Mehls ändern und zurücksetzen', () => {
  const s = neuerSpeicher();
  mehle.setzeWert(s, 'tipo00', 58);
  assert.equal(mehle.alle(s).find((m) => m.id === 'tipo00').wasser, 58);
  mehle.entferne(s, 'tipo00');
  assert.equal(mehle.alle(s).find((m) => m.id === 'tipo00').wasser, 60);
  mehle.setzeWert(s, 'tipo00', 62); // nach Zurücksetzen wieder änderbar
  assert.equal(mehle.alle(s).find((m) => m.id === 'tipo00').wasser, 62);
});

test('Eigenes Mehl anlegen, ändern, löschen – als Datensatz mit Sync-Feldern', () => {
  const s = neuerSpeicher();
  const emmer = mehle.neu(s, ' Emmer ');
  assert.equal(emmer.name, 'Emmer');
  assert.equal(emmer.wasser, 65);
  assert.ok(emmer.id && emmer.geaendert && emmer.geloescht === false);
  mehle.setzeWert(s, emmer.id, 72);
  assert.equal(mehle.alle(s).at(-1).wasser, 72);
  assert.equal(mehle.alle(s).at(-1).name, 'Emmer');
  mehle.entferne(s, emmer.id);
  assert.equal(mehle.alle(s).length, MEHLE.length);
});

test('Eigene Saat mit eigenem Verhältnis', () => {
  const s = neuerSpeicher();
  const hanf = saaten.neu(s, 'Hanfsamen', 1.5);
  assert.equal(saaten.alle(s).find((x) => x.id === hanf.id).verhaeltnis, 1.5);
});

// ---------- Alte gespeicherte Daten (Format aus Schritt 5) ----------

test('Alte eigene Vorlage wird umgerechnet: gleiche Grammzahlen wie vorher', () => {
  const alt = {
    hydration: 81.8, starter: 18.2, salz: 2, oel: 0, hefe: 0, hefeArt: 'frisch',
    mehlsorten: [{ name: 'Weizenvollkorn', anteil: 100 }],
    saaten: [{ name: 'Sonnenblumenkerne', prozent: (50 / 550) * 100 }, { name: 'Leinsamen', prozent: (25 / 550) * 100 }],
    quellwasser: (80 / 75) * 100,
  };
  const neu = normalisiereTeig(alt);
  assert.equal(neu.mehlsorten[0].id, 'weizenvollkorn');
  assert.equal(neu.saaten[1].id, 'leinsamen');
  ungefaehr(berechne(neu, 550).quellwasser, 80);
  // zweimal normalisieren ändert nichts
  ungefaehr(berechne(normalisiereTeig(neu), 550).quellwasser, 80);
});

test('alleVorlagen liefert eigene Vorlagen im neuen Format', () => {
  const s = neuerSpeicher();
  s.speichere('teigvorlagen', { name: 'Alt', mehl: 300, teig: {
    hydration: 70, starter: 0, salz: 2, oel: 0, hefe: 1, mehlsorten: [{ name: 'Tipo 00', anteil: 100 }] } });
  const v = alleVorlagen(s).at(-1);
  assert.equal(v.teig.mehlsorten[0].id, 'tipo00');
  assert.deepEqual(v.teig.saaten, []);
});
