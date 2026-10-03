// abgleich.js – Bereich „Abgleich“ auf der Startseite (Etappe 2).
//
// - Anmeldung einmal pro Handy: E-Mail + Passwort (der Schlüsselbund füllt aus), danach nie wieder.
// - Verwalter-Handy: Häkchen beim Anmelden (Geräte-Einstellung). Nachträglich nur über die versteckte
//   Verwaltung: langes Drücken auf die Versionsnummer ganz unten → „Abmelden“, „Verwalter-Handy an/aus“.
// - Status nur auf dem Verwalter-Handy: Anmeldung, wartende Änderungen und
//   wann jedes Handy zuletzt abgeglichen hat („Handy 2: seit 4 Tagen nicht abgeglichen“).
//   Braucht etwas Aufmerksamkeit, steht das ruhig im Titel der Klappe – nur dort, nur auf diesem Handy.
// - Auf allen anderen Handys verschwindet die Klappe nach der Anmeldung ganz. Sie kommt nur wieder,
//   wenn Supabase die Anmeldung ablehnt (dann mit dem Formular, ohne Meldung).
//
// - Umzug (erste Anmeldung): Auf dem Verwalter-Handy wird vor dem ersten Hochladen ein Sicherungs-Link
//   angeboten; bis „Abgleich starten“ getippt ist, gleicht dieses Handy nicht ab (`bereit()`).
//
// Abgeglichen wird über kern/ausloeser.js; die Oberfläche stößt es nur nach der Anmeldung,
// nach „Abgleich starten“ und vor dem Abmelden an.

import { SAMMLUNGEN } from './sync.js';
import { text } from './html.js';

const VERWALTER = 'abgleich.verwalter'; // Geräte-Einstellung: true = dieses Handy zeigt den Status
const UMZUG = 'abgleich.umzug';         // Geräte-Einstellung: true = erster Abgleich ist erlaubt/erfolgt
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
 */
export function statusZeilen({ zustand, offen, mitglieder, konto, jetzt }) {
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
  return zeilen;
}

/**
 * Bereich „Abgleich“ für die Startseite und die versteckte Verwaltung.
 *   abgleichen – () => Promise: jetzt abgleichen (kern/ausloeser.js, prüft selbst `bereit()`)
 *   sicherung  – { anzahl(), erstellen() }: eigene Vorlagen zählen, Sicherungs-Link anbieten (Umzug)
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
  sicherung = null,
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
  let verwaltung = null; // { ziel, offen, laeuft } – versteckte Verwaltung unter der Versionsnummer

  /** Verwalter-Handy, noch nie abgeglichen, eigene Vorlagen da: erst Sicherung anbieten. */
  const umzugOffen = () => istVerwalter(speicher) && speicher.einstellung(UMZUG) !== true
    && (sicherung?.anzahl() ?? 0) > 0;
  const bereit = () => anmeldung.zustand() === 'angemeldet' && !umzugOffen();

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

  function umzugHtml() {
    const n = sicherung.anzahl();
    return `<div class="umzug">
        <p class="info">Vor dem ersten Abgleich: ${n === 1 ? 'deine Vorlage' : `deine ${n} Vorlagen`} als Link sichern
          (z. B. in Notizen ablegen). Danach „Abgleich starten“.</p>
        <div class="aktionen">
          <button type="button" class="knopf knopf-voll" data-umzug="sichern">Sicherung erstellen</button>
          <button type="button" class="knopf" data-umzug="starten">Abgleich starten</button>
        </div>
      </div>`;
  }

  function starteUmzug() {
    speicher.setzeEinstellung(UMZUG, true);
    zeichne();
    abgleichen();
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
    return `<section class="karte verwaltung" aria-label="Verwaltung">
        <h2 class="karte-titel">Verwaltung</h2>
        <p class="info">${text(ZUSTAND_TEXT[zustand] ?? '')}</p>
        <button type="button" class="knopf" data-verwaltung="verwalter" aria-pressed="${verwalter}">
          Verwalter-Handy: ${verwalter ? 'an' : 'aus'}</button>
        <p class="info">Das Verwalter-Handy zeigt unten auf der Startseite, ob beide Handys abgleichen.</p>
        ${abmelden}
        <button type="button" class="knopf knopf-leise" data-verwaltung="schliessen">Schließen</button>
      </section>`;
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
        const umzug = zustand === 'angemeldet' && umzugOffen();
        const zeilen = statusZeilen({
          zustand,
          offen: anzahlOffen(),
          mitglieder: zustand === 'angemeldet' ? mitglieder : false,
          konto: anmeldung.konto(),
          jetzt: jetzt(),
        });
        achtung = umzug || zeilen.some((z) => z.achtung);
        inhalt = `${umzug ? umzugHtml() : ''}${statusHtml(zeilen)}${zustand === 'angemeldet' ? '' : formular(true)}`;
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
      wurzel.addEventListener('click', (e) => {
        const knopf = e.target.closest?.('[data-umzug]');
        if (!knopf || !umzugOffen()) return;
        if (knopf.dataset.umzug === 'sichern') sicherung.erstellen();
        if (knopf.dataset.umzug === 'starten') starteUmzug();
      });
    },

    verbindeVerwaltung(version, ziel) {
      verwaltung = { ziel, offen: false, laeuft: false };
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
      ziel.addEventListener('click', (e) => {
        const aktion = e.target.closest?.('[data-verwaltung]')?.dataset.verwaltung;
        if (aktion === 'verwalter') schalteVerwalter();
        if (aktion === 'abmelden') abmelden();
        if (aktion === 'schliessen') {
          verwaltung.offen = false;
          zeichneVerwaltung();
        }
      });
    },

    bereit,

    nachAbgleich(bericht) {
      if (bericht?.ok) speicher.setzeEinstellung(UMZUG, true); // ab jetzt nie mehr Sicherung vorab
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
