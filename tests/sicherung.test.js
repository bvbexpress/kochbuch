// Prüft „Alles sichern“ und „Wiederherstellen“ (kern/sicherung.js): Inhalt der Datei, Prüfung fremder
// Dateien und die Regel „nur Fehlendes und Gelöschtes zurückholen, Vorhandenes bleibt“.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import {
  erstelleSicherung, sicherungsDatei, liesSicherung, pruefeWiederherstellung, stelleWiederHer, fehlenText,
  letzteSicherung, merkeSicherung, EINSTELLUNGEN,
} from '../js/kern/sicherung.js';
import { SAMMLUNGEN } from '../js/kern/sync.js';
import { speichereRezept, alleRezepte, holeRezept } from '../js/rezepte/rezept.js';
import { VORLAGEN, ladeVorlage, speichereEigeneVorlage, eigeneVorlagen } from '../js/teig/vorlagen.js';
import { mehle, saaten } from '../js/teig/zutaten.js';

const JETZT = Date.UTC(2026, 9, 7, 10);
const neuerSpeicher = (uhr = { jetzt: JETZT }) => erstelleSpeicher(speicherImArbeitsspeicher(), () => uhr.jetzt);

function befuellt() {
  const s = neuerSpeicher();
  const rezept = speichereRezept(s, {
    art: 'kochen', name: 'Dal', portionen: 2, notiz: 'weniger Salz',
    zutaten: [{ name: 'Rote Linsen', menge: 200, einheit: 'g' }, { name: 'Tempeh', menge: 100, einheit: 'g' }],
    schritte: ['Linsen kochen', 'Tempeh braten'],
    schrittzutaten: [[{ name: 'Rote Linsen' }], [{ name: 'Tempeh' }]],
    schrittgeraete: ['Topf', 'Pfanne'],
  });
  const vorlage = speichereEigeneVorlage(s, { name: 'Brot', teig: ladeVorlage(VORLAGEN[1]).teig, mehl: 500, kategorie: 'brot' });
  mehle.setzeWert(s, 'weizen550', 68);
  saaten.neu(s, 'Hanfsamen', 1.5);
  s.setzeEinstellung('kochen.favoriten', [rezept.id]);
  s.setzeEinstellung('teig.ausgeblendet', ['focaccia']);
  s.setzeEinstellung('rezepte.gesehen', [rezept.id]);
  return { s, rezept, vorlage };
}

const inhaltVon = (s) => liesSicherung(sicherungsDatei(s).inhalt);
const ohneZeit = ({ erstellt, geaendert, ...rest }) => rest;

test('Datei: Name mit Datum, alle Sammlungen aus dem Abgleich, ohne Anmeldung und ohne Grabsteine', () => {
  const { s, rezept } = befuellt();
  s.setzeEinstellung('anmeldung', { erneuerung: 'geheim' });
  s.setzeEinstellung('abgleich.verwalter', true);
  const geloescht = speichereEigeneVorlage(s, { name: 'Weg', teig: ladeVorlage(VORLAGEN[0]).teig, mehl: 1 });
  s.loesche('teigvorlagen', geloescht.id);

  const datei = sicherungsDatei(s, JETZT);
  assert.equal(datei.name, 'kochbuch-sicherung-2026-10-07.json');
  assert.doesNotMatch(datei.inhalt, /geheim|verwalter|"sync"/);
  const roh = JSON.parse(datei.inhalt);
  assert.equal(roh.format, 'kochbuch-sicherung');
  assert.equal(roh.erstellt, JETZT);
  assert.deepEqual(Object.keys(roh.sammlungen).sort(), ['mehle', 'rezepte', 'saaten', 'teigvorlagen', 'zutaten']);
  assert.ok(Object.keys(roh.sammlungen).every((x) => x in SAMMLUNGEN));
  assert.deepEqual(roh.sammlungen.teigvorlagen.map((v) => v.name), ['Brot'], 'Gelöschtes nicht dabei');
  assert.deepEqual(roh.einstellungen['kochen.favoriten'], [rezept.id]);
  assert.deepEqual(Object.keys(roh.einstellungen).filter((e) => !EINSTELLUNGEN.includes(e)), []);
});

test('Hin und zurück: leeres Handy bekommt alles, Inhalt gleich, alles als offene Änderung', () => {
  const { s, rezept, vorlage } = befuellt();
  const gelesen = inhaltVon(s);
  assert.equal(gelesen.verworfen, 0);

  const leer = neuerSpeicher();
  const pruefung = pruefeWiederherstellung(leer, gelesen);
  assert.equal(pruefung.vorhanden, 0);
  assert.deepEqual(pruefung.fehlen, { rezepte: 1, teigvorlagen: 1, zutaten: 1, mehle: 1, saaten: 1 });
  assert.equal(fehlenText(pruefung), '1 Rezept, 1 Vorlage und 3 weitere Einträge (Zutaten, Wasserwerte)');

  let gemeldet = 0;
  leer.beiAenderung(() => gemeldet++);
  assert.deepEqual(stelleWiederHer(leer, gelesen), { wiederhergestellt: 5, fehler: 0 });
  assert.ok(gemeldet > 0, 'Abgleich wird angestoßen');
  assert.deepEqual(ohneZeit(holeRezept(leer, rezept.id)), ohneZeit(holeRezept(s, rezept.id)));
  assert.deepEqual(ladeVorlage(eigeneVorlagen(leer)[0]), ladeVorlage(vorlage));
  assert.equal(holeRezept(leer, rezept.id).erstellt, rezept.erstellt, 'Reihenfolge bleibt');
  assert.equal(mehle.alle(leer).find((m) => m.id === 'weizen550').wasser, 68);
  assert.ok(saaten.alle(leer).some((x) => x.name === 'Hanfsamen'));
  assert.equal(leer.offene('rezepte').length, 1, 'geht beim nächsten Abgleich hoch');
  assert.deepEqual(leer.einstellung('kochen.favoriten'), [rezept.id]);
  assert.deepEqual(leer.einstellung('teig.ausgeblendet'), ['focaccia']);
});

test('Vorhandenes bleibt unverändert, Gelöschtes kommt zurück', () => {
  const uhr = { jetzt: JETZT };
  const s = neuerSpeicher(uhr);
  const r = speichereRezept(s, { art: 'kochen', name: 'Dal', portionen: 2 });
  const zweites = speichereRezept(s, { art: 'kochen', name: 'Curry', portionen: 4 });
  const gelesen = inhaltVon(s);

  uhr.jetzt += 1000;
  speichereRezept(s, { ...holeRezept(s, r.id), name: 'Dal neu' });
  s.loesche('rezepte', zweites.id);
  const vorher = holeRezept(s, r.id);

  const pruefung = pruefeWiederherstellung(s, gelesen);
  assert.deepEqual(pruefung.fehlen, { rezepte: 1 });
  assert.equal(pruefung.vorhanden, 1);
  assert.deepEqual(stelleWiederHer(s, gelesen), { wiederhergestellt: 1, fehler: 0 });
  assert.deepEqual(holeRezept(s, r.id), vorher, 'neuere Änderung bleibt');
  assert.equal(holeRezept(s, zweites.id).name, 'Curry');
  assert.deepEqual(alleRezepte(s).map((x) => x.name).sort(), ['Curry', 'Dal neu']);

  // zweites Mal: nichts mehr zu tun
  assert.equal(pruefeWiederherstellung(s, gelesen).anzahlFehlen, 0);
  assert.deepEqual(stelleWiederHer(s, gelesen), { wiederhergestellt: 0, fehler: 0 });
});

test('Einstellungen werden ergänzt, nie gekürzt', () => {
  const { s } = befuellt();
  const gelesen = inhaltVon(s);
  const b = neuerSpeicher();
  b.setzeEinstellung('teig.ausgeblendet', ['weizenvollkorn']);
  stelleWiederHer(b, gelesen);
  assert.deepEqual(b.einstellung('teig.ausgeblendet'), ['weizenvollkorn', 'focaccia']);
  stelleWiederHer(b, gelesen);
  assert.deepEqual(b.einstellung('teig.ausgeblendet'), ['weizenvollkorn', 'focaccia'], 'keine Doppel');
});

test('Fremde oder kaputte Dateien ergeben null', () => {
  const gut = JSON.parse(sicherungsDatei(befuellt().s).inhalt);
  for (const schlecht of [
    null, '', 'hallo', '[]', '{}', '{"format":"kochbuch-sicherung","v":2,"sammlungen":{}}',
    JSON.stringify({ ...gut, format: 'anders' }),
    JSON.stringify({ ...gut, sammlungen: 'x' }),
    'x'.repeat(5_000_001),
  ]) {
    assert.equal(liesSicherung(schlecht), null, String(schlecht).slice(0, 40));
  }
});

test('Unbrauchbare Einträge werden verworfen, fremde Felder und Sammlungen fallen weg', () => {
  const { s, rezept } = befuellt();
  const roh = JSON.parse(sicherungsDatei(s).inhalt);
  const r = roh.sammlungen.rezepte[0];
  roh.sammlungen.rezepte.push(
    { ...r },                                   // doppelte id
    { ...r, id: 'keine-uuid' },
    { ...r, id: undefined },
    { ...r, id: '123e4567-e89b-42d3-a456-426614174000', portionen: -1 },
    42,
  );
  roh.sammlungen.rezepte[0] = { ...r, boese: '<script>', sync: { version: 99, offen: false } };
  roh.sammlungen.mehle.push({ id: 'roggen1150', wasser: 9999 }, { id: '../x', wasser: 60 });
  roh.sammlungen.zutaten.push({ id: 'Ö', name: 'x' });
  roh.sammlungen.konten = [{ id: 'a' }];
  roh.einstellungen.anmeldung = ['geheim'];
  roh.einstellungen['kochen.favoriten'].push(5, '<b>');

  const gelesen = liesSicherung(JSON.stringify(roh));
  assert.equal(gelesen.verworfen, 8);
  assert.equal(gelesen.sammlungen.rezepte.length, 1);
  assert.equal(gelesen.sammlungen.rezepte[0].boese, undefined);
  assert.equal(gelesen.sammlungen.rezepte[0].sync, undefined);
  assert.equal(gelesen.sammlungen.konten, undefined);
  assert.equal(gelesen.einstellungen.anmeldung, undefined);
  assert.deepEqual(gelesen.einstellungen['kochen.favoriten'], [rezept.id]);

  const b = neuerSpeicher();
  stelleWiederHer(b, gelesen);
  assert.equal(b.offene('rezepte')[0].version, 0, 'Server-Version aus der Datei zählt nicht');
});

test('Letzte Sicherung: Geräte-Einstellung, unbrauchbare Werte = nie', () => {
  const s = neuerSpeicher();
  assert.equal(letzteSicherung(s), null);
  merkeSicherung(s, JETZT);
  assert.equal(letzteSicherung(s), JETZT);
  s.setzeEinstellung('sicherung.letzte', 'gestern');
  assert.equal(letzteSicherung(s), null);
  assert.equal(erstelleSicherung(s).sammlungen.rezepte, undefined, 'leere Sammlungen fehlen');
});
