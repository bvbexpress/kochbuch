// abgleich.js – Bereich „Abgleich“ auf der Startseite (Etappe 2).
//
// - Anmeldung einmal pro Handy: E-Mail + Passwort (der Schlüsselbund füllt aus), danach nie wieder.
// - Verwalter-Handy: Häkchen beim Anmelden (Geräte-Einstellung). Nachträglich nur über die versteckte
//   Verwaltung: langes Drücken auf die Versionsnummer ganz unten → „Abmelden“, „Verwalter-Handy an/aus“.
// - Status nur auf dem Verwalter-Handy: Anmeldung, wartende Änderungen und
//   wann jedes Handy zuletzt abgeglichen hat („Handy 2: seit 4 Tagen nicht abgeglichen“).
//   Dazu, wann zuletzt gesichert wurde (ab 30 Tagen oder nie: „bitte ansehen“).
//   Braucht etwas Aufmerksamkeit, steht das ruhig im Titel der Klappe – nur dort, nur auf diesem Handy.
// - Auf allen anderen Handys verschwindet die Klappe nach der Anmeldung ganz. Sie kommt nur wieder,
//   wenn Supabase die Anmeldung ablehnt (dann mit dem Formular, ohne Meldung).
// - Versteckte Verwaltung: außerdem „Alles sichern“ (Datei) und „Aus Sicherung wiederherstellen“
//   (kern/sicherung.js) – auf jedem Handy.
//
// Abgeglichen wird über kern/ausloeser.js; die Oberfläche stößt es nur nach der Anmeldung
// und vor dem Abmelden an.

import { SAMMLUNGEN } from './sync.js';
import { text } from './html.js';
import {
  sicherungsDatei, teileDatei, letzteSicherung, merkeSicherung, liesSicherung, pruefeWiederherstellung,
  stelleWiederHer, fehlenText, SICHERUNG_WARNEN_AB_TAGEN,
} from './sicherung.js';

const VERWALTER = 'abgleich.verwalter'; // Geräte-Einstellung: true = dieses Handy zeigt den Status
const LANG_DRUECKEN = 700;              // ms bis die Verwaltung aufgeht
export const WARNEN_AB_TAGEN = 3;      // so lange ohne Abgleich → „bitte ansehen“
const NEU_LADEN_NACH = 60_000;          // Mitglieder höchstens einmal pro Minute abfragen (ms)
const TAG = 24 * 60 * 60 * 1000;

const ANMELDE_FEHLER = {
  falsch: 'E-Mail oder Passwort stimmt nicht.',
  netz: 'Gerade kein Netz. Bitte gleich noch einmal versuchen.',
  zuoft: 'Zu viele Versuche. Bitte in ein paar Minuten noch einmal.',
  server: 'Der Server antwortet gerade nicht. Bitte später noch einmal.',
};

export const istVerwalter = (speicher) => speicher.einstellung(VERWALTER) === true;

export function setzeVerwalter(speicher, an) {
  return speicher.setzeEinstellung(VERWALTER, an === true);
}

/**
 * Antwort des Servers auf `mitglieder()` prüfen: [{ konto, name, letzter }] (letzter = ms oder null).
 * null, wenn die Antwort unbrauchbar ist.
 */
export function bereinigeMitglieder(roh) {
  if (!Array.isArray(roh)) return null;
  return roh
    .filter((m) => m && typeof m.konto === 'string' && typeof m.name === 'string' && m.name.trim())
    .map((m) => {
      const zeit = typeof m.letzter_abgleich === 'string' ? Date.parse(m.letzter_abgleich) : NaN;
      return { konto: m.konto, name: m.name.trim().slice(0, 50), letzter: Number.isFinite(zeit) ? zeit : null };
    });
}

/** Kalendertage (Uhr des Handys) zwischen zwei Zeitpunkten; nie negativ. */
export function tageZwischen(zeit, jetzt) {
  const tag = (t) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / TAG;
  };
  return Math.max(0, Math.round(tag(jetzt) - tag(zeit)));
}

/** „Letzte Sicherung: heute“, „… gestern“, „… vor 12 Tagen“, „Noch nie gesichert“. */
export function sicherungText(zeit, jetzt) {
  if (zeit === null) return 'Noch nie gesichert.';
  const tage = tageZwischen(zeit, jetzt);
  if (tage === 0) return 'Letzte Sicherung: heute.';
  if (tage === 1) return 'Letzte Sicherung: gestern.';
  return `Letzte Sicherung: vor ${tage} Tagen.`;
}

/** Sicherung nötig? Noch nie oder länger als 30 Tage her. */
export const sicherungAlt = (zeit, jetzt) => zeit === null || tageZwischen(zeit, jetzt) > SICHERUNG_WARNEN_AB_TAGEN;

/** „heute abgeglichen“, „gestern …“, „seit 4 Tagen nicht abgeglichen“, „noch nie abgeglichen“. */
export function wannText(zeit, jetzt) {
  if (zeit === null) return 'noch nie abgeglichen';
  const tage = tageZwischen(zeit, jetzt);
  if (tage === 0) return 'heute abgeglichen';
  if (tage === 1) return 'gestern abgeglichen';
  return `seit ${tage} Tagen nicht abgeglichen`;
}

/**
 * Statuszeilen fürs Verwalter-Handy: [{ text, achtung }].
 *   zustand    – anmeldung.zustand()
 *   offen      – Anzahl noch nicht hochgeladener Änderungen auf diesem Handy
 *   mitglieder – Liste aus `bereinigeMitglieder`, undefined = wird geladen, null = Server nicht
 *                erreichbar, false = nicht abfragen (nicht angemeldet)
 *   konto      – Konto dieses Handys (markiert „dieses Handy“)
 *   gesichert  – Zeitpunkt der letzten Sicherung (ms) oder null; undefined = keine Zeile
 */
export function statusZeilen({ zustand, offen, mitglieder, konto, jetzt, gesichert }) {
  const zeilen = [];
  if (zustand === 'abgelehnt') {
    zeilen.push({ text: 'Dieses Handy ist abgemeldet. Bitte unten neu anmelden.', achtung: true });
  }
  if (offen > 0) {
    zeilen.push({
      text: offen === 1 ? '1 Änderung wartet aufs Hochladen.' : `${offen} Änderungen warten aufs Hochladen.`,
      achtung: false,
    });
  }
  if (mitglieder === undefined) {
    zeilen.push({ text: 'Stand der Handys wird geladen …', achtung: false });
  } else if (mitglieder === null) {
    zeilen.push({ text: 'Server gerade nicht erreichbar – Stand der Handys unbekannt.', achtung: false });
  } else if (Array.isArray(mitglieder) && mitglieder.length === 0) {
    zeilen.push({
      text: 'Dieses Konto gehört zu keinem Haushalt. Im Supabase-Dashboard in „mitglieder“ eintragen.',
      achtung: true,
    });
  } else if (Array.isArray(mitglieder)) {
    for (const m of mitglieder) {
      const eigen = m.konto === konto ? ' (dieses Handy)' : '';
      const alt = m.letzter === null || tageZwischen(m.letzter, jetzt) >= WARNEN_AB_TAGEN;
      zeilen.push({ text: `${m.name}${eigen}: ${wannText(m.letzter, jetzt)}`, achtung: alt });
    }
  }
  if (zustand === 'angemeldet' && zeilen.length === 0) {
    zeilen.push({ text: 'Alles abgeglichen.', achtung: false });
  }
  if (gesichert !== undefined) {
    const alt = sicherungAlt(gesichert, jetzt);
    zeilen.push({
      text: `${sicherungText(gesichert, jetzt)}${alt ? ' Bitte „Alles sichern“: lange auf die Versionsnummer drücken.' : ''}`,
      achtung: alt,
    });
  }
  return zeilen;
}

/**
 * Bereich „Abgleich“ für die Startseite und die versteckte Verwaltung.
 *   abgleichen – () => Promise: jetzt abgleichen (kern/ausloeser.js, prüft selbst `bereit()`)
 *   teilen     – ({ name, inhalt }) => Promise<boolean>: Sicherungsdatei weitergeben (false = abgebrochen)
 *   nachWiederherstellen – () => void: Daten haben sich geändert, Seite neu zeichnen
 *   fragen     – Ja/Nein-Frage (window.confirm)
 * Ergebnis:
 *   html()                    – HTML der Klappe (zu Beginn zugeklappt; '' auf angemeldeten Nicht-Verwalter-Handys)
 *   verbinde(wurzel, zeichne) – Tipper, Formular und Aufklappen verarbeiten; `zeichne` baut die Seite neu
 *   verbindeVerwaltung(version, ziel) – langes Drücken auf `version` öffnet die Verwaltung in `ziel`
 *   bereit()                  – darf jetzt abgeglichen werden?
 *   nachAbgleich(bericht)     – nach jedem Abgleich: Status auffrischen
 *   start()                   – beim App-Start: Status des Verwalter-Handys im Hintergrund laden
 */
export function erstelleAbgleichBereich({
  speicher,
  anmeldung,
  server,
  abgleichen = () => Promise.resolve(null),
  teilen = teileDatei,
  nachWiederherstellen = () => {},
  fragen = (frage) => globalThis.confirm?.(frage) === true,
  jetzt = () => Date.now(),
}) {
  let mitglieder;       // undefined = noch nicht geladen, null = nicht erreichbar, sonst Liste
  let geladenUm = 0;
  let laden = null;
  let offen = false;    // Klappe aufgeklappt?
  let fehler = '';      // Rückmeldung unter dem Anmelde-Formular
  let email = '';       // bleibt nach einem Fehlversuch im Feld (nur im Arbeitsspeicher)
  let zeichne = () => {};
  let verwaltung = null; // { ziel, offen, laeuft, meldung } – versteckte Verwaltung unter der Versionsnummer

  const bereit = () => anmeldung.zustand() === 'angemeldet';

  const anzahlOffen = () => Object.keys(SAMMLUNGEN).reduce((n, s) => n + speicher.offene(s).length, 0);

  function ladeMitglieder({ erzwingen = false } = {}) {
    if (!istVerwalter(speicher) || anmeldung.zustand() !== 'angemeldet') return Promise.resolve();
    if (laden) return laden;
    if (!erzwingen && mitglieder !== undefined && jetzt() - geladenUm < NEU_LADEN_NACH) return Promise.resolve();
    laden = (async () => {
      try {
        mitglieder = bereinigeMitglieder(await server.mitglieder());
      } catch {
        mitglieder = null; // kein Netz, Server pausiert … – nur hier sichtbar, beim nächsten Öffnen neu
      }
      geladenUm = jetzt();
      laden = null;
      zeichne();
    })();
    return laden;
  }

  function formular(verwalter) {
    return `<form class="anmelden" data-anmelden>
        <p class="info">Einmal pro Handy anmelden. Danach haben beide Handys dieselben Vorlagen und Wasserwerte.</p>
        <label class="feld"><span class="feld-name">E-Mail</span>
          <input class="eingabe eingabe-text" type="email" name="email" autocomplete="username"
                 autocapitalize="off" spellcheck="false" required value="${text(email)}"></label>
        <label class="feld"><span class="feld-name">Passwort</span>
          <input class="eingabe eingabe-text" type="password" name="passwort" autocomplete="current-password"
                 required></label>
        <label class="haken">
          <input type="checkbox" name="verwalter" ${verwalter ? 'checked' : ''}>
          <span>Verwalter-Handy: hier den Abgleich-Status anzeigen</span></label>
        ${fehler ? `<p class="hinweis" role="status">${text(fehler)}</p>` : ''}
        <div class="aktionen">
          <button type="submit" class="knopf knopf-voll">Anmelden</button>
        </div>
      </form>`;
  }

  function statusHtml(zeilen) {
    return `<ul class="abgleich-status">${zeilen
      .map((z) => `<li${z.achtung ? ' class="achtung"' : ''}>${text(z.text)}</li>`).join('')}</ul>`;
  }

  async function anmelden(form) {
    const felder = form.elements;
    email = String(felder.email?.value ?? '').trim();
    const knopf = form.querySelector('button[type="submit"]');
    if (knopf) {
      knopf.disabled = true;
      knopf.textContent = 'Anmelden …';
    }
    const ergebnis = await anmeldung.anmelden(email, String(felder.passwort?.value ?? ''));
    if (ergebnis.ok) {
      setzeVerwalter(speicher, felder.verwalter?.checked === true);
      fehler = '';
      email = '';
      mitglieder = undefined;
      ladeMitglieder({ erzwingen: true });
      abgleichen(); // Umzug: eigene Datensätze hoch, die des anderen Handys herunter
    } else {
      fehler = ANMELDE_FEHLER[ergebnis.grund] ?? ANMELDE_FEHLER.server;
    }
    zeichne();
  }

  // ---------- versteckte Verwaltung (langes Drücken auf die Versionsnummer) ----------

  const ZUSTAND_TEXT = {
    angemeldet: 'Dieses Handy ist angemeldet.',
    abgemeldet: 'Dieses Handy ist nicht angemeldet. Anmelden: Startseite → „Abgleich zwischen den Handys“.',
    abgelehnt: 'Die Anmeldung gilt nicht mehr. Neu anmelden: Startseite → „Abgleich zwischen den Handys“.',
  };

  function verwaltungHtml() {
    if (!verwaltung?.offen) return '';
    const zustand = anmeldung.zustand();
    const verwalter = istVerwalter(speicher);
    const laeuft = verwaltung.laeuft;
    const abmelden = zustand === 'abgemeldet' ? ''
      : `<button type="button" class="knopf" data-verwaltung="abmelden" ${laeuft ? 'disabled' : ''}>
          ${laeuft ? 'Wird abgeglichen …' : 'Abmelden'}</button>`;
    const meldung = verwaltung.meldung;
    verwaltung.meldung = null;
    return `<section class="karte verwaltung" aria-label="Verwaltung">
        <h2 class="karte-titel">Verwaltung</h2>
        ${meldung ? `<p class="hinweis" role="status">${text(meldung)}</p>` : ''}
        <p class="info">${text(sicherungText(letzteSicherung(speicher), jetzt()))}</p>
        <button type="button" class="knopf knopf-voll" data-verwaltung="sichern">Alles sichern</button>
        <p class="info">Rezepte, Vorlagen und Einstellungen als Datei. Im Teilen-Menü
          „In Dateien sichern“ wählen (z. B. iCloud Drive).</p>
        <button type="button" class="knopf" data-verwaltung="wiederherstellen">Aus Sicherung wiederherstellen</button>
        <input type="file" class="unsichtbar" data-verwaltung-datei tabindex="-1" aria-hidden="true">
        <p class="info">Holt nur zurück, was hier fehlt oder gelöscht ist. Vorhandenes bleibt, wie es ist.</p>
        <p class="info">${text(ZUSTAND_TEXT[zustand] ?? '')}</p>
        <button type="button" class="knopf" data-verwaltung="verwalter" aria-pressed="${verwalter}">
          Verwalter-Handy: ${verwalter ? 'an' : 'aus'}</button>
        <p class="info">Das Verwalter-Handy zeigt unten auf der Startseite, ob beide Handys abgleichen.</p>
        ${abmelden}
        <button type="button" class="knopf knopf-leise" data-verwaltung="schliessen">Schließen</button>
      </section>`;
  }

  async function sichern() {
    if (verwaltung.laeuft) return;
    const datei = sicherungsDatei(speicher, jetzt());
    let geteilt = false;
    try {
      geteilt = await teilen(datei);
    } catch {
      verwaltung.meldung = 'Sichern hat nicht geklappt. Bitte noch einmal versuchen.';
    }
    if (geteilt) {
      merkeSicherung(speicher, jetzt());
      verwaltung.meldung = 'Gesichert.';
    }
    zeichneVerwaltung();
    zeichne();
  }

  /** Datei gewählt: prüfen, nachfragen, nur Fehlendes zurückholen. */
  async function wiederherstellen(datei) {
    if (!datei) return;
    let inhalt = null;
    try {
      inhalt = datei.size > 5_000_000 ? null : await datei.text();
    } catch {
      inhalt = null;
    }
    const gelesen = liesSicherung(inhalt);
    if (!gelesen) {
      verwaltung.meldung = 'Das ist keine Sicherung des Kochbuchs.';
      return zeichneVerwaltung();
    }
    const pruefung = pruefeWiederherstellung(speicher, gelesen);
    if (pruefung.anzahlFehlen === 0) {
      verwaltung.meldung = 'Nichts wiederherzustellen – alles aus der Sicherung ist schon da.';
      return zeichneVerwaltung();
    }
    const vom = gelesen.erstellt ? ` vom ${new Date(gelesen.erstellt).toLocaleDateString('de-DE')}` : '';
    const frage = `Sicherung${vom}: ${fehlenText(pruefung)} `
      + `${pruefung.anzahlFehlen === 1 ? 'fehlt hier und wird' : 'fehlen hier und werden'} wiederhergestellt. `
      + 'Alles andere bleibt, wie es ist. Fortfahren?';
    if (!fragen(frage)) return;
    const ergebnis = stelleWiederHer(speicher, gelesen);
    verwaltung.meldung = ergebnis.fehler > 0
      ? 'Nicht alles ließ sich speichern. Ist der Speicher des Handys voll?'
      : `${ergebnis.wiederhergestellt === 1 ? '1 Eintrag' : `${ergebnis.wiederhergestellt} Einträge`} wiederhergestellt.`;
    nachWiederherstellen();
    zeichneVerwaltung();
    zeichne();
  }

  function zeichneVerwaltung() {
    if (verwaltung?.ziel) verwaltung.ziel.innerHTML = verwaltungHtml();
  }

  function schalteVerwalter() {
    setzeVerwalter(speicher, !istVerwalter(speicher));
    mitglieder = undefined;
    ladeMitglieder({ erzwingen: true });
    zeichneVerwaltung();
    zeichne();
  }

  /**
   * Abmelden ohne Datenverlust: erst noch einmal abgleichen; was dann noch offen ist,
   * bleibt auf dem Handy und geht nach der nächsten Anmeldung hoch.
   */
  async function abmelden() {
    if (verwaltung.laeuft) return;
    verwaltung.laeuft = true;
    zeichneVerwaltung();
    try {
      await abgleichen();
    } catch {
      // abgleichen wirft nie – und wenn doch, bleibt alles offen
    }
    const n = anzahlOffen();
    const frage = n === 0
      ? 'Dieses Handy abmelden? Alle Vorlagen bleiben auf dem Handy.'
      : `${n === 1 ? '1 Änderung ist' : `${n} Änderungen sind`} noch nicht hochgeladen. `
        + 'Sie bleiben auf diesem Handy und gehen nach der nächsten Anmeldung hoch. Jetzt abmelden?';
    if (fragen(frage)) {
      await anmeldung.abmelden();
      speicher.setzeSyncStand(0); // nach der nächsten Anmeldung alles noch einmal herunterladen
      mitglieder = undefined;
      verwaltung.offen = false;
    }
    verwaltung.laeuft = false;
    zeichneVerwaltung();
    zeichne();
  }

  return {
    html() {
      const zustand = anmeldung.zustand();
      const verwalter = istVerwalter(speicher);
      let inhalt;
      let achtung = false;
      if (verwalter) {
        const zeilen = statusZeilen({
          zustand,
          offen: anzahlOffen(),
          mitglieder: zustand === 'angemeldet' ? mitglieder : false,
          konto: anmeldung.konto(),
          jetzt: jetzt(),
          gesichert: letzteSicherung(speicher),
        });
        achtung = zeilen.some((z) => z.achtung);
        inhalt = `${statusHtml(zeilen)}${zustand === 'angemeldet' ? '' : formular(true)}`;
      } else if (zustand === 'angemeldet') {
        return ''; // anderes Handy: nichts zu sehen, nichts zu tun
      } else {
        inhalt = formular(false);
      }
      return `<details class="klappe" data-klappe="abgleich" ${offen ? 'open' : ''}>
          <summary>Abgleich zwischen den Handys${achtung ? ' <span class="achtung">· bitte ansehen</span>' : ''}</summary>
          <div class="klappe-inhalt">${inhalt}</div>
        </details>`;
    },

    verbinde(wurzel, neuZeichnen) {
      zeichne = neuZeichnen;
      wurzel.addEventListener('toggle', (e) => {
        if (e.target.dataset?.klappe !== 'abgleich') return;
        offen = e.target.open;
        if (offen) ladeMitglieder();
      }, true);
      wurzel.addEventListener('submit', (e) => {
        if (!e.target.matches?.('[data-anmelden]')) return;
        e.preventDefault();
        anmelden(e.target);
      });
    },

    verbindeVerwaltung(version, ziel) {
      verwaltung = { ziel, offen: false, laeuft: false, meldung: null };
      let zeitgeber = null;
      const abbrechen = () => {
        clearTimeout(zeitgeber);
        zeitgeber = null;
      };
      version.addEventListener('pointerdown', () => {
        abbrechen();
        zeitgeber = setTimeout(() => {
          verwaltung.offen = true;
          zeichneVerwaltung();
          ziel.scrollIntoView?.({ block: 'nearest' });
        }, LANG_DRUECKEN);
      });
      for (const art of ['pointerup', 'pointercancel', 'pointerleave']) version.addEventListener(art, abbrechen);
      version.addEventListener('contextmenu', (e) => e.preventDefault());
      ziel.addEventListener('change', (e) => {
        const feld = e.target;
        if (!feld?.matches?.('[data-verwaltung-datei]')) return;
        const datei = feld.files?.[0];
        feld.value = ''; // dieselbe Datei später noch einmal wählbar
        wiederherstellen(datei);
      });
      ziel.addEventListener('click', (e) => {
        const aktion = e.target.closest?.('[data-verwaltung]')?.dataset.verwaltung;
        if (aktion === 'verwalter') schalteVerwalter();
        if (aktion === 'abmelden') abmelden();
        if (aktion === 'sichern') sichern();
        if (aktion === 'wiederherstellen') ziel.querySelector?.('[data-verwaltung-datei]')?.click();
        if (aktion === 'schliessen') {
          verwaltung.offen = false;
          zeichneVerwaltung();
        }
      });
    },

    bereit,

    nachAbgleich() {
      geladenUm = 0; // „heute abgeglichen“ beim nächsten Aufklappen frisch
      if (offen) ladeMitglieder();
      zeichne();
    },

    start() {
      ladeMitglieder();
    },

    /** Für Tests: Verwaltung öffnen wie nach langem Drücken. */
    oeffneVerwaltung() {
      verwaltung.offen = true;
      zeichneVerwaltung();
    },

    /** Für Tests: Mitglieder jetzt laden. */
    ladeMitglieder,
  };
}
