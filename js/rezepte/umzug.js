// umzug.js – Umzug der Teigvorlagen in Back-Rezepte (Etappe 3, D) und die eingebauten Back-Rezepte.
//
// Jede eigene Teigvorlage wird ein Back-Rezept mit DERSELBEN id; die zwei eingebauten Vorlagen werden
// Back-Rezepte mit festen ids (BACK_REZEPTE). Der Inhalt folgt nur aus der Vorlage bzw. dem Code –
// beide Handys erzeugen also genau dasselbe. Laden beide hoch, sieht der Abgleich „inhaltlich gleich“:
// kein Doppel, keine Konflikt-Kopie.
//
// Regeln:
// - Angelegt wird nur, was es unter dieser id noch gar nicht gibt – auch kein gelöschtes Rezept
//   (wer ein Back-Rezept löscht, bekommt es nicht wieder). Kam das Rezept schon vom anderen Handy, bleibt es.
// - Die Sammlung `teigvorlagen` bleibt unverändert als Sicherung (wird hier nur gelesen).
// - Läuft bei jedem Aufruf erneut und ist dann ohne Wirkung; eine Vorlage, die später noch von einem
//   Handy mit alter App-Version kommt, zieht so ebenfalls um.
// - Wann aufgerufen wird, entscheidet app.js: angemeldet erst nach dem ersten erfolgreichen Abgleich
//   (dann sind die Vorlagen auf dem neuesten Stand und Rezepte vom anderen Handy schon da).
//
// Geräte-Einstellungen: Favoriten der eingebauten Vorlagen gehen auf ihr Back-Rezept über, alle
// umgezogenen Rezepte gelten als „gesehen“ (keine „Neu“-Markierung für Altbekanntes).

import { VORLAGEN, ladeVorlage, istGueltigerTeig } from '../teig/vorlagen.js';
import { bereinigeRezept, SAMMLUNG } from './rezept.js';

const VORLAGEN_SAMMLUNG = 'teigvorlagen';
const FAVORITEN = 'teig.favoriten';  // Favoriten der Back-Liste (vorher: der Vorlagenliste)
const GESEHEN = 'rezepte.gesehen';

/**
 * Eingebaute Back-Rezepte. `vorlage` = id der eingebauten Teigvorlage, aus der Teig und Menge kommen.
 * Die ids sind fest, damit beide Handys dasselbe Rezept anlegen. Inhalt nie nachträglich ändern
 * (zwei App-Stände würden sonst Verschiedenes anlegen) – Änderungen macht man am gespeicherten Rezept.
 */
export const BACK_REZEPTE = [
  {
    id: '4c70ead4-b8b9-47d5-a436-ed4e8e7f8ea2',
    vorlage: 'weizenvollkorn',
    name: 'Weizenvollkorn-Sauerteigbrot',
    schritte: [
      ['Quellstück: Sonnenblumenkerne und Leinsamen mit kochendem Wasser übergießen, abgedeckt abkühlen lassen.', 'Wasserkocher'],
      ['Mehl mit dem Großteil des Wassers mischen, 20–30 Min. quellen lassen.', 'Große Schüssel'],
      ['Starter im restlichen Wasser auflösen und einarbeiten.', ''],
      ['Salz einarbeiten.', ''],
      ['Abgekühltes Quellstück unterarbeiten.', ''],
      ['Stockgare ca. 3 Std. bei 24–26 °C, nach 30, 60 und 90 Min. dehnen und falten, danach ruhen lassen.', ''],
      ['Schonend formen, Spannung aufbauen, in die Form geben, einschneiden.', 'Kastenform'],
      ['15 Min. mit Dampf backen.', 'Ofen 240 °C'],
      ['Dampf ablassen, 35–40 Min. fertig backen.', 'Ofen 205 °C'],
    ],
    notiz: 'Klebriger Teig ist bei Vollkorn normal. Nach viel Gasaufbau nicht mehr spät falten.',
  },
  {
    id: '92c672f5-0f30-46a2-900d-925a4a89d911',
    vorlage: 'focaccia',
    name: 'Sauerteig-Focaccia',
    schritte: [
      ['Starter in einem Großteil des Wassers auflösen, Mehl einarbeiten.', 'Große Schüssel'],
      ['Salz, dann Öl einarbeiten. Der Teig darf weich und klebrig sein.', ''],
      ['Mehrfach dehnen und falten.', ''],
      ['Abgedeckt über Nacht in den Kühlschrank.', 'Kühlschrank'],
      ['Morgens temperieren lassen.', ''],
      ['Auf dem geölten Blech nur auf ca. 20 × 25 cm ausziehen, bei Widerstand 10–15 Min. entspannen lassen.', 'Backblech'],
      ['Nochmals gehen lassen, Öl darüber, Mulden drücken, salzen.', ''],
      ['22–25 Min. backen, ab Minute 20 nach Farbe entscheiden.', 'Ofen 230 °C'],
    ],
    notiz: '30 Min. waren zu dunkel. Dick backen, nicht über das ganze Blech ziehen.',
  },
];

/** Back-Rezept aus Teig-Angaben (Teigvorlage oder eingebaute Vorlage), geprüft – oder null. */
function backRezept(vorlage, extra) {
  const { teig, mehl, modus, teiglinge, kategorie } = ladeVorlage(vorlage);
  return bereinigeRezept({
    art: 'backen',
    name: vorlage.name,
    ...(kategorie ? { kategorie } : {}),
    zutaten: [],
    schritte: [],
    status: 'erprobt',
    notiz: '',
    quelle: 'hand',
    teig, mehl, modus,
    ...(teiglinge ? { teiglinge } : {}),
    ...extra,
  });
}

/** Das eingebaute Back-Rezept (ohne Zeitstempel), z. B. für Tests. */
export function eingebautesBackRezept(eintrag) {
  const vorlage = VORLAGEN.find((v) => v.id === eintrag.vorlage);
  return backRezept(vorlage, {
    id: eintrag.id,
    name: eintrag.name,
    schritte: eintrag.schritte.map(([s]) => s),
    schrittgeraete: eintrag.schritte.map(([, g]) => g),
    notiz: eintrag.notiz,
  });
}

/** Back-Rezept aus einer eigenen Teigvorlage (gleiche id, Konflikt-Vermerk bleibt) – oder null. */
export function rezeptAusVorlage(vorlage) {
  if (!vorlage || typeof vorlage.id !== 'string' || !istGueltigerTeig(vorlage.teig)) return null;
  return backRezept(vorlage, { id: vorlage.id, ...(vorlage.konflikt ? { konflikt: vorlage.konflikt } : {}) });
}

/**
 * Zieht um, was noch fehlt. Ergebnis: { angelegt, fehler } – angelegt = neue Back-Rezepte,
 * fehler = Vorlagen, die sich nicht übernehmen ließen (bleiben in `teigvorlagen` erhalten).
 */
export function zieheVorlagenUm(speicher) {
  const ergebnis = { angelegt: 0, fehler: 0 };
  const kandidaten = [
    ...BACK_REZEPTE.map((e) => ({ id: e.id, rezept: () => eingebautesBackRezept(e) })),
    ...speicher.alle(VORLAGEN_SAMMLUNG).map((v) => ({ id: v.id, rezept: () => rezeptAusVorlage(v) })),
  ];
  for (const { id, rezept: erzeuge } of kandidaten) {
    if (speicher.kennt(SAMMLUNG, id)) continue;
    const rezept = erzeuge();
    // Konflikt-Vermerk direkt mitspeichern (speichereRezept würde ihn entfernen)
    if (rezept && speicher.speichere(SAMMLUNG, rezept)) ergebnis.angelegt++;
    else ergebnis.fehler++;
  }
  uebernimmEinstellungen(speicher, kandidaten.map((k) => k.id));
  return ergebnis;
}

/** Favoriten der eingebauten Vorlagen auf ihr Back-Rezept umstellen; Umgezogenes gilt als gesehen. */
function uebernimmEinstellungen(speicher, ids) {
  const liste = (name) => {
    const roh = speicher.einstellung(name, []);
    return Array.isArray(roh) ? roh.filter((x) => typeof x === 'string') : [];
  };
  const favoriten = liste(FAVORITEN);
  const neu = favoriten.map((id) => BACK_REZEPTE.find((e) => e.vorlage === id)?.id ?? id);
  const ohneDoppel = [...new Set(neu)];
  if (JSON.stringify(ohneDoppel) !== JSON.stringify(favoriten)) speicher.setzeEinstellung(FAVORITEN, ohneDoppel);

  const gesehen = liste(GESEHEN);
  const fehlen = ids.filter((id) => !gesehen.includes(id));
  if (fehlen.length) speicher.setzeEinstellung(GESEHEN, [...gesehen, ...fehlen]);
}
