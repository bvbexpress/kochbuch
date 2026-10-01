// Prüft Teilen-Link, Einlesen (auch von bösen Links) und Übernahme-Regeln.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erstelleSpeicher, speicherImArbeitsspeicher } from '../js/kern/speicher.js';
import {
  VORLAGEN,
  ladeVorlage,
  alleVorlagen,
  eigeneVorlagen,
  speichereEigeneVorlage,
  loescheEigeneVorlage,
  pruefeUebernahme,
  uebernehmeVorlagen,
} from '../js/teig/vorlagen.js';
import { erstelleLink, liesLink, hatTeilenCode, bereinigeVorlage } from '../js/teig/teilen.js';

const BASIS = 'https://beispiel.test/kochbuch/';

function neuerSpeicher(jetzt) {
  return erstelleSpeicher(speicherImArbeitsspeicher(), jetzt);
}

function eigene(s, name = 'Müsli-Brot ✓ „Test“', salz = 2.2) {
  const { teig } = ladeVorlage(VORLAGEN[1]);
  teig.salz = salz;
  return speichereEigeneVorlage(s, { name, teig, mehl: 450 });
}

/** Baut einen Link mit beliebigem Inhalt (für Angriffs-Tests). */
async function linkMit(inhalt) {
  const roh = await erstelleLink([], BASIS);
  const code = roh.split('teilen=')[1];
  // Gleiche Verpackung, anderer Inhalt: ungepackt ("r.") reicht für die Prüfung
  const bytes = new TextEncoder().encode(JSON.stringify(inhalt));
  const b64 = Buffer.from(bytes).toString('base64url');
  assert.ok(code.startsWith('z.') || code.startsWith('r.'));
  return `${BASIS}#teilen=r.${b64}`;
}

test('Link: Vorlage hin und zurück, alles bleibt exakt gleich', async () => {
  const s = neuerSpeicher();
  const v = eigene(s);
  const link = await erstelleLink(eigeneVorlagen(s), BASIS);
  assert.ok(link.startsWith(`${BASIS}#teilen=`));
  assert.match(link, /^[\x21-\x7e]+$/, 'nur druckbare ASCII-Zeichen, damit WhatsApp den Link nicht zerreißt');

  const gelesen = await liesLink(link);
  assert.equal(gelesen.verworfen, 0);
  assert.equal(gelesen.vorlagen.length, 1);
  const g = gelesen.vorlagen[0];
  assert.equal(g.id, v.id);
  assert.equal(g.name, 'Müsli-Brot ✓ „Test“');
  assert.equal(g.mehl, 450);
  assert.equal(g.geaendert, v.geaendert);
  assert.deepEqual(g.teig, alleVorlagen(s).at(-1).teig);
});

test('Link ist kompakt genug für WhatsApp', async () => {
  const s = neuerSpeicher();
  eigene(s);
  const link = await erstelleLink(eigeneVorlagen(s), BASIS);
  assert.ok(link.length < 700, `Link hat ${link.length} Zeichen`);
});

test('Link mit mehreren Vorlagen (Sicherung)', async () => {
  const s = neuerSpeicher();
  eigene(s, 'A');
  eigene(s, 'B', 3);
  const gelesen = await liesLink(await erstelleLink(eigeneVorlagen(s), BASIS));
  assert.deepEqual(gelesen.vorlagen.map((v) => v.name), ['A', 'B']);
});

test('Einlesen: Link mitten in einem Text, nur Code, Müll', async () => {
  const s = neuerSpeicher();
  eigene(s);
  const link = await erstelleLink(eigeneVorlagen(s), BASIS);
  assert.equal((await liesLink(`Schau mal:\n${link}\nViel Spaß!`)).vorlagen.length, 1);
  assert.equal((await liesLink(link.split('teilen=')[1])).vorlagen.length, 1);
  assert.equal(hatTeilenCode(link), true);
  for (const muell of ['', '   ', 'hallo', `${BASIS}#teilen=`, `${BASIS}#teilen=z.!!!`, `${BASIS}#teilen=z.AAAA`, null, undefined]) {
    assert.equal(await liesLink(muell), null, String(muell));
  }
});

test('Einlesen: ungültige Vorlagen werden verworfen, gültige bleiben', async () => {
  const s = neuerSpeicher();
  const gut = eigene(s);
  const gutes = (await liesLink(await erstelleLink(eigeneVorlagen(s), BASIS))).vorlagen[0];
  const link = await linkMit({
    v: 1,
    vorlagen: [
      gutes,
      { ...gutes, id: 'focaccia' },                      // keine UUID (Kollision mit eingebauter Vorlage)
      { ...gutes, name: '   ' },                          // ohne Namen
      { ...gutes, mehl: 'viel' },                         // keine Zahl
      { ...gutes, teig: { ...gutes.teig, salz: -5 } },    // negativ
      { ...gutes, teig: { ...gutes.teig, hefe: 1e12 } },  // absurd groß
      { ...gutes, teig: { ...gutes.teig, mehlsorten: 'x' } },
      42,
    ],
  });
  const gelesen = await liesLink(link);
  assert.equal(gelesen.vorlagen.length, 1);
  assert.equal(gelesen.verworfen, 7);
  assert.equal(gelesen.vorlagen[0].id, gut.id);
});

test('Einlesen: fremde Felder fliegen raus, Namen werden gekürzt, HTML bleibt Text', () => {
  const { teig } = ladeVorlage(VORLAGEN[0]);
  const v = bereinigeVorlage({
    id: '123e4567-e89b-42d3-a456-426614174000',
    name: `<img src=x onerror=alert(1)>${'x'.repeat(500)}`,
    mehl: 300,
    geaendert: 1,
    boese: 'ja',
    teig: { ...teig, __proto__: { x: 1 }, extra: 'weg', mehlsorten: [{ ...teig.mehlsorten[0], boese: 1 }] },
  });
  assert.equal(v.boese, undefined);
  assert.equal(v.teig.extra, undefined);
  assert.equal(v.teig.mehlsorten[0].boese, undefined);
  assert.ok(v.name.length <= 80);
  assert.ok(v.name.startsWith('<img'), 'Name wird nicht verändert – die Oberfläche maskiert ihn');
});

test('Einlesen: Zeitpunkt in ferner Zukunft wird gekappt', () => {
  const { teig } = ladeVorlage(VORLAGEN[0]);
  const v = bereinigeVorlage(
    { id: '123e4567-e89b-42d3-a456-426614174000', name: 'X', mehl: 1, teig, geaendert: 9e15 },
    1_000_000,
  );
  assert.ok(v.geaendert <= 1_000_000 + 24 * 60 * 60 * 1000);
});

test('Schutz vor Zip-Bomben: riesiger entpackter Inhalt wird abgelehnt', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const bombe = deflateRawSync(Buffer.alloc(50_000_000, 'a')).toString('base64url');
  assert.ok(bombe.length < 300_000);
  assert.equal(await liesLink(`${BASIS}#teilen=z.${bombe}`), null);
});

// ---------- Übernahme-Regeln ----------

async function ausLink(quelle) {
  return (await liesLink(await erstelleLink(eigeneVorlagen(quelle), BASIS))).vorlagen;
}

test('Übernehmen: neue Vorlage bekommt id und Stand des Absenders', async () => {
  const a = neuerSpeicher();
  const v = eigene(a);
  const b = neuerSpeicher();
  const vorlagen = await ausLink(a);
  assert.deepEqual(pruefeUebernahme(b, vorlagen).map((p) => p.status), ['neu']);
  assert.deepEqual(uebernehmeVorlagen(b, vorlagen), { neu: 1, aktualisiert: 0, uebersprungen: 0, fehler: 0 });
  const mein = eigeneVorlagen(b);
  assert.equal(mein.length, 1);
  assert.equal(mein[0].id, v.id);
  assert.equal(mein[0].geaendert, v.geaendert);
  assert.equal(mein[0].geloescht, false);
});

test('Übernehmen: zweites Mal ändert nichts ("gleich")', async () => {
  const a = neuerSpeicher();
  eigene(a);
  const b = neuerSpeicher();
  const vorlagen = await ausLink(a);
  uebernehmeVorlagen(b, vorlagen);
  assert.deepEqual(pruefeUebernahme(b, vorlagen).map((p) => p.status), ['gleich']);
  assert.deepEqual(uebernehmeVorlagen(b, vorlagen), { neu: 0, aktualisiert: 0, uebersprungen: 1, fehler: 0 });
  assert.equal(eigeneVorlagen(b).length, 1);
});

test('Übernehmen: neuere Version gewinnt, ältere nicht', async () => {
  let zeit = 1000;
  const a = neuerSpeicher(() => zeit);
  const v = eigene(a);
  const b = neuerSpeicher(() => zeit);
  uebernehmeVorlagen(b, await ausLink(a));

  zeit = 2000; // A ändert
  speichereEigeneVorlage(a, { id: v.id, name: 'Neu bei A', teig: v.teig, mehl: 500 });
  const vonA = await ausLink(a);
  assert.deepEqual(pruefeUebernahme(b, vonA).map((p) => p.status), ['neuer']);
  assert.equal(uebernehmeVorlagen(b, vonA).aktualisiert, 1);
  assert.equal(eigeneVorlagen(b)[0].name, 'Neu bei A');

  zeit = 3000; // B ändert danach selbst → der Link von A ist jetzt älter
  speichereEigeneVorlage(b, { id: v.id, name: 'Neu bei B', teig: v.teig, mehl: 500 });
  assert.deepEqual(pruefeUebernahme(b, vonA).map((p) => p.status), ['aelter']);
  assert.equal(uebernehmeVorlagen(b, vonA).uebersprungen, 1);
  assert.equal(eigeneVorlagen(b)[0].name, 'Neu bei B');
});

test('Übernehmen als Kopie: neue id, Original bleibt', async () => {
  const a = neuerSpeicher();
  eigene(a, 'Brot');
  const b = neuerSpeicher();
  const vorlagen = await ausLink(a);
  uebernehmeVorlagen(b, vorlagen);
  uebernehmeVorlagen(b, vorlagen, { alsKopie: true });
  const mein = eigeneVorlagen(b);
  assert.deepEqual(mein.map((v) => v.name), ['Brot', 'Brot (Kopie)']);
  assert.notEqual(mein[0].id, mein[1].id);
});

test('Sicherung: gelöschte Vorlage kommt aus dem Link zurück – außer sie wurde danach gelöscht', async () => {
  let zeit = 1000;
  const s = neuerSpeicher(() => zeit);
  const v = eigene(s);
  const sicherung = await ausLink(s);

  zeit = 2000;
  loescheEigeneVorlage(s, v.id);
  assert.equal(eigeneVorlagen(s).length, 0);
  // Gelöscht NACH der Sicherung → Sicherung ist älter, nichts kommt automatisch zurück
  assert.deepEqual(pruefeUebernahme(s, sicherung).map((p) => p.status), ['aelter']);
  // Neuer Speicher (z. B. neues Handy): alles kommt zurück
  const neu = neuerSpeicher(() => 3000);
  assert.equal(uebernehmeVorlagen(neu, sicherung).neu, 1);
  assert.equal(eigeneVorlagen(neu)[0].id, v.id);
  // Als Kopie klappt auch auf dem Handy, wo sie gelöscht wurde
  assert.equal(uebernehmeVorlagen(s, sicherung, { alsKopie: true }).neu, 1);
});

test('Übernommene Vorlage lässt sich laden und rechnen', async () => {
  const a = neuerSpeicher();
  eigene(a);
  const b = neuerSpeicher();
  uebernehmeVorlagen(b, await ausLink(a));
  const { teig, mehl } = ladeVorlage(eigeneVorlagen(b)[0]);
  assert.equal(mehl, 450);
  assert.equal(teig.saaten.length, 2);
});
