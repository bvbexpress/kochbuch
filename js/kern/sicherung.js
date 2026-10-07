// sicherung.js – „Alles sichern“ und „Aus Sicherung wiederherstellen“ (versteckte Verwaltung).
//
// Die Sicherung ist eine Datei (JSON) mit allen Datensätzen der synchronisierten Sammlungen
// (Rezepte, Vorlagen, Zutaten, Wasserwerte) und den Geräte-Einstellungen, die man vermissen würde
// (Favoriten, Ausgeblendet, gesehene Rezepte). Nicht enthalten: Anmeldung, Abgleich-Stand, Grabsteine.
// Auf dem iPhone geht die Datei übers Teilen-Menü („In Dateien sichern“).
//
// Wiederherstellen holt nur zurück, was hier fehlt oder gelöscht ist – Vorhandenes bleibt unverändert.
// So kann eine alte Sicherung nie neuere Änderungen überschreiben. Zurückgeholtes gilt als neue
// Änderung und geht beim nächsten Abgleich auch aufs andere Handy (Löschen gegen Ändern: Ändern gewinnt).
//
// WICHTIG: Eine Datei kann von überall kommen. Alles wird geprüft wie bei Rezepten vom Connector:
// unbekannte Sammlungen und Felder fallen weg, unbrauchbare Einträge werden verworfen.

import { SAMMLUNGEN } from './sync.js';
import { bereinigeVorlage } from '../teig/pruefung.js';
import { bereinigeRezept } from '../rezepte/rezept.js';
import { bereinigeEintrag } from '../rezepte/katalog.js';

const FORMAT = 'kochbuch-sicherung';
const VERSION = 1;
const MAX_GROESSE = 5_000_000;   // Zeichen der Datei
const MAX_JE_SAMMLUNG = 5000;
const MAX_IDS = 5000;            // Einträge je Einstellungsliste
const LETZTE = 'sicherung.letzte'; // Geräte-Einstellung: Zeitpunkt der letzten Sicherung (ms)
export const SICHERUNG_WARNEN_AB_TAGEN = 30;

/** Geräte-Einstellungen in der Sicherung: Listen von ids, beim Wiederherstellen ergänzt (nie gekürzt). */
export const EINSTELLUNGEN = ['teig.favoriten', 'teig.ausgeblendet', 'kochen.favoriten', 'rezepte.gesehen'];

const ID = /^[\w-]{1,100}$/;
const zahl = (x, max) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
const name = (x) => (typeof x === 'string' && x.trim() ? x.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : null);

/** Mehle, Saaten, Zusätze: geänderter Standardwert (feste id) oder eigene Sorte (mit Name). */
const sorte = (wertName, max) => (d) => {
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !ID.test(d.id)) return null;
  const wert = zahl(d[wertName], max);
  if (wert === null) return null;
  return { id: d.id, ...(name(d.name) ? { name: name(d.name) } : {}), [wertName]: wert };
};

/** Prüfung je Sammlung: gibt eine saubere Kopie (mit id) zurück oder null. */
const PRUEFUNG = {
  teigvorlagen: bereinigeVorlage,
  rezepte: (d) => (typeof d?.id === 'string' ? bereinigeRezept(d) : null),
  zutaten: bereinigeEintrag,
  mehle: sorte('wasser', 200),
  saaten: sorte('verhaeltnis', 100),
  zusaetze: sorte('wasser', 100),
};

// ---------- Sichern ----------

/** Inhalt der Sicherung als Objekt. */
export function erstelleSicherung(speicher, jetzt = Date.now()) {
  const sammlungen = {};
  for (const s of Object.keys(SAMMLUNGEN)) {
    const liste = speicher.alle(s);
    if (liste.length) sammlungen[s] = liste;
  }
  const einstellungen = {};
  for (const e of EINSTELLUNGEN) {
    const liste = idListe(speicher.einstellung(e));
    if (liste.length) einstellungen[e] = liste;
  }
  return { format: FORMAT, v: VERSION, erstellt: jetzt, sammlungen, einstellungen };
}

/** Datei zum Sichern: { name: „kochbuch-sicherung-2026-10-07.json“, inhalt }. */
export function sicherungsDatei(speicher, jetzt = Date.now()) {
  const d = new Date(jetzt);
  const zwei = (n) => String(n).padStart(2, '0');
  return {
    name: `kochbuch-sicherung-${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}.json`,
    inhalt: JSON.stringify(erstelleSicherung(speicher, jetzt)),
  };
}

/** Zeitpunkt der letzten Sicherung auf diesem Handy (ms) oder null. */
export function letzteSicherung(speicher) {
  const zeit = speicher.einstellung(LETZTE);
  return typeof zeit === 'number' && Number.isFinite(zeit) && zeit > 0 ? zeit : null;
}

export function merkeSicherung(speicher, jetzt = Date.now()) {
  return speicher.setzeEinstellung(LETZTE, jetzt);
}

// ---------- Lesen ----------

/**
 * Liest den Text einer Sicherungsdatei. Gibt { erstellt, sammlungen, einstellungen, verworfen } zurück
 * (alles geprüft) – oder null, wenn es keine Sicherung des Kochbuchs ist.
 */
export function liesSicherung(text) {
  if (typeof text !== 'string' || text.length > MAX_GROESSE) return null;
  let roh;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (!roh || typeof roh !== 'object' || roh.format !== FORMAT || roh.v !== VERSION) return null;
  if (!roh.sammlungen || typeof roh.sammlungen !== 'object') return null;

  const sammlungen = {};
  let verworfen = 0;
  for (const [s, pruefe] of Object.entries(PRUEFUNG)) {
    const liste = roh.sammlungen[s];
    if (!Array.isArray(liste)) continue;
    const gesehen = new Set();
    const sauber = [];
    for (const d of liste.slice(0, MAX_JE_SAMMLUNG)) {
      const geprueft = pruefe(d);
      if (!geprueft || gesehen.has(geprueft.id)) {
        verworfen++;
        continue;
      }
      gesehen.add(geprueft.id);
      // Reihenfolge der Liste bleibt erhalten: der ursprüngliche Anlegezeitpunkt kommt mit
      const erstellt = zahl(d.erstellt, Number.MAX_SAFE_INTEGER);
      sauber.push(erstellt ? { ...geprueft, erstellt } : geprueft);
    }
    verworfen += Math.max(0, liste.length - MAX_JE_SAMMLUNG);
    if (sauber.length) sammlungen[s] = sauber;
  }

  const einstellungen = {};
  const roheEinstellungen = roh.einstellungen && typeof roh.einstellungen === 'object' ? roh.einstellungen : {};
  for (const e of EINSTELLUNGEN) {
    const liste = idListe(roheEinstellungen[e]);
    if (liste.length) einstellungen[e] = liste;
  }

  return { erstellt: zahl(roh.erstellt, Number.MAX_SAFE_INTEGER), sammlungen, einstellungen, verworfen };
}

function idListe(roh) {
  if (!Array.isArray(roh)) return [];
  return [...new Set(roh.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, MAX_IDS);
}

// ---------- Wiederherstellen ----------

/**
 * Was würde das Wiederherstellen tun? { fehlen: { sammlung: Anzahl }, anzahlFehlen, vorhanden }.
 * „Fehlt“ = gibt es hier nicht oder ist gelöscht.
 */
export function pruefeWiederherstellung(speicher, gelesen) {
  const fehlen = {};
  let anzahlFehlen = 0;
  let vorhanden = 0;
  for (const [s, liste] of Object.entries(gelesen.sammlungen)) {
    for (const d of liste) {
      if (speicher.hole(s, d.id)) {
        vorhanden++;
      } else {
        fehlen[s] = (fehlen[s] ?? 0) + 1;
        anzahlFehlen++;
      }
    }
  }
  return { fehlen, anzahlFehlen, vorhanden };
}

/**
 * Holt alles zurück, was hier fehlt oder gelöscht ist; Vorhandenes bleibt unverändert.
 * Einstellungslisten werden ergänzt. Gibt { wiederhergestellt, fehler } zurück.
 */
export function stelleWiederHer(speicher, gelesen) {
  const ergebnis = { wiederhergestellt: 0, fehler: 0 };
  for (const [s, liste] of Object.entries(gelesen.sammlungen)) {
    for (const d of liste) {
      const status = speicher.stelleWiederHer(s, d);
      if (status === 'wiederhergestellt') ergebnis.wiederhergestellt++;
      if (status === null) ergebnis.fehler++;
    }
  }
  for (const [e, liste] of Object.entries(gelesen.einstellungen)) {
    const bisher = idListe(speicher.einstellung(e));
    const neu = liste.filter((id) => !bisher.includes(id));
    if (neu.length && !speicher.setzeEinstellung(e, [...bisher, ...neu])) ergebnis.fehler++;
  }
  return ergebnis;
}

/** „5 Rezepte, 2 Vorlagen und 3 weitere Einträge“ – für die Rückfrage vor dem Wiederherstellen. */
export function fehlenText({ fehlen }) {
  const teile = [];
  const rezepte = fehlen.rezepte ?? 0;
  const vorlagen = fehlen.teigvorlagen ?? 0;
  const weitere = Object.entries(fehlen)
    .filter(([s]) => s !== 'rezepte' && s !== 'teigvorlagen')
    .reduce((n, [, a]) => n + a, 0);
  if (rezepte) teile.push(rezepte === 1 ? '1 Rezept' : `${rezepte} Rezepte`);
  if (vorlagen) teile.push(vorlagen === 1 ? '1 Vorlage' : `${vorlagen} Vorlagen`);
  if (weitere) teile.push(weitere === 1 ? '1 weiterer Eintrag (Zutaten, Wasserwerte)'
    : `${weitere} weitere Einträge (Zutaten, Wasserwerte)`);
  return teile.length > 1 ? `${teile.slice(0, -1).join(', ')} und ${teile.at(-1)}` : (teile[0] ?? '');
}

// ---------- Datei weitergeben (nur im Browser) ----------

/**
 * Gibt die Datei weiter: auf dem iPhone übers Teilen-Menü („In Dateien sichern“),
 * sonst als Download. Gibt false zurück, wenn das Teilen-Menü geschlossen wurde.
 */
export async function teileDatei({ name: dateiName, inhalt }) {
  const nav = globalThis.navigator;
  for (const typ of ['application/json', 'text/plain']) {
    const datei = new File([inhalt], dateiName, { type: typ });
    if (!nav?.canShare?.({ files: [datei] })) continue;
    try {
      await nav.share({ files: [datei], title: 'Kochbuch-Sicherung' });
      return true;
    } catch (fehler) {
      if (fehler?.name === 'AbortError') return false; // Menü bewusst geschlossen
      break; // sonst: Download versuchen
    }
  }
  const adresse = URL.createObjectURL(new Blob([inhalt], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: adresse, download: dateiName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
  return true;
}
