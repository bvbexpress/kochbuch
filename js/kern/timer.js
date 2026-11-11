// timer.js – Timer je Schritt: Tipper auf eine hervorgehobene Zeit im Schritttext startet einen Timer.
// Mehrere können gleichzeitig laufen. Sie stehen als schmale Leiste unten (außerhalb von #inhalt, also in
// jedem Rezept und jeder Liste sichtbar). Am Ende: Ton und blinkende Leiste; die Leiste bleibt, bis sie
// angetippt wird (auch nach der Rückkehr aus dem Hintergrund: „abgelaufen seit 14:32“).
//
// Gerechnet wird nur mit der Endzeit (Uhr des Handys), nie mit einem mitlaufenden Zähler – so stimmt die
// Restzeit auch, wenn iOS die App zwischendurch anhält. Die Endzeiten stehen als Geräte-Einstellung `timer`
// (kein Sync, keine Sicherung), damit ein Timer ein Beenden der App überlebt.
//
//   Logik:        erstelleTimer({ speicher }) → starte, beende, liste, laeuft, beiAenderung
//   Oberfläche:   starteTimerLeiste({ timer, ziel }) – Klick-Zuhörer, Leiste, Ton

import { text } from './html.js';

export const MAX_MINUTEN = 24 * 60; // länger als ein Tag ist kein Küchentimer
const MAX_TIMER = 20;
const MAX_LABEL = 80;

/** Minuten einer Zeitangabe → Millisekunden, oder null, wenn kein sinnvoller Timer daraus wird. */
export function timerDauerMs(min) {
  return Number.isFinite(min) && min > 0 && min <= MAX_MINUTEN ? Math.round(min * 60_000) : null;
}

/** Restzeit als „8:05“ bzw. „1:02:10“ (aufgerundet auf ganze Sekunden). */
export function restText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sek = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sek}` : `${m}:${sek}`;
}

/** „14:32“ in der Ortszeit des Handys. */
export function uhrText(ms) {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function gueltig(t) {
  return t && typeof t === 'object' && typeof t.id === 'string' && t.id !== ''
    && Number.isFinite(t.ende) && typeof t.label === 'string';
}

/**
 * Die Timer. `speicher` = kern/speicher.js (nur Geräte-Einstellung `timer`), `jetzt` = Uhr (für Tests).
 * Ein Timer: { id, label, ende (ms) }. Abgelaufene bleiben, bis `beende` sie entfernt.
 */
export function erstelleTimer({ speicher, jetzt = () => Date.now() }) {
  const zuhoerer = [];
  const lade = () => {
    const roh = speicher.einstellung('timer', []);
    return Array.isArray(roh)
      ? roh.filter(gueltig).slice(0, MAX_TIMER).map((t) => ({ id: t.id, label: t.label.slice(0, MAX_LABEL), ende: t.ende }))
      : [];
  };
  let alle = lade(); // gelesen wird einmal, geschrieben bei jeder Änderung

  function aendere(neu) {
    alle = neu;
    speicher.setzeEinstellung('timer', alle);
    zuhoerer.forEach((f) => f());
  }

  return {
    /** Startet einen Timer; false, wenn derselbe schon läuft (nichts passiert) oder die Dauer unsinnig ist.
     *  Ein abgelaufener mit gleicher id wird neu gestartet. */
    starte({ id, label, min }) {
      const ms = timerDauerMs(min);
      const vorhanden = alle.find((t) => t.id === id);
      if (ms === null || typeof id !== 'string' || id === '' || (vorhanden && vorhanden.ende > jetzt())) return false;
      if (!vorhanden && alle.length >= MAX_TIMER) return false;
      const neu = { id, label: String(label ?? '').slice(0, MAX_LABEL), ende: jetzt() + ms };
      aendere([...alle.filter((t) => t.id !== id), neu]);
      return true;
    },

    beende(id) {
      if (alle.some((t) => t.id === id)) aendere(alle.filter((t) => t.id !== id));
    },

    /** Abgelaufene zuerst (am längsten her zuerst), dann nach Restzeit. `rest` ≤ 0 = abgelaufen. */
    liste() {
      const j = jetzt();
      return alle.map((t) => ({ ...t, rest: t.ende - j, abgelaufen: t.ende <= j }))
        .sort((a, b) => a.ende - b.ende);
    },

    /** Läuft dieser Timer gerade (nicht abgelaufen)? */
    laeuft(id) {
      return alle.some((t) => t.id === id && t.ende > jetzt());
    },

    beiAenderung(f) {
      zuhoerer.push(f);
    },
  };
}

// ---------- Ton ----------

/** Piepen per Web Audio (ohne Datei). `entsperre` muss in einem Tipper aufgerufen werden (iOS). */
export function erstelleTon(umgebung = globalThis) {
  const AudioKlasse = umgebung.AudioContext ?? umgebung.webkitAudioContext;
  let kontext = null;
  const hole = () => {
    if (!AudioKlasse) return null;
    try {
      kontext ??= new AudioKlasse();
      if (kontext.state === 'suspended') kontext.resume().catch(() => {});
    } catch {
      kontext = null;
    }
    return kontext;
  };
  return {
    entsperre: hole,
    /** Drei kurze Töne. Fehler bleiben still (die blinkende Leiste ist das verlässliche Signal). */
    piepe() {
      const k = hole();
      if (!k) return;
      try {
        [0, 0.25, 0.5].forEach((versatz) => {
          const start = k.currentTime + versatz;
          const o = k.createOscillator();
          const g = k.createGain();
          o.type = 'sine';
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
          o.connect(g).connect(k.destination);
          o.start(start);
          o.stop(start + 0.2);
        });
      } catch { /* still */ }
    },
  };
}

// ---------- Oberfläche ----------

const TAKT = 1000;
const WIEDERHOLUNG = 5000; // Ton wiederholt sich, solange ein abgelaufener Timer wartet …
const MAX_WIEDERHOLUNGEN = 12; // … höchstens so oft (etwa eine Minute)

/** HTML der Leiste; ohne Timer leer. */
export function leisteHtml(liste) {
  return liste.map((t) => (t.abgelaufen
    ? `<li class="timer timer-fertig">
        <button type="button" class="timer-knopf" data-timer-weg="${text(t.id)}">
          <span class="timer-name">${text(t.label)}</span>
          <span class="timer-zeit">Abgelaufen · seit ${text(uhrText(t.ende))}</span>
        </button>
      </li>`
    : `<li class="timer">
        <span class="timer-name">${text(t.label)}</span>
        <span class="timer-zeit zahl">${restText(t.rest)}</span>
        <button type="button" class="timer-stopp" data-timer-weg="${text(t.id)}" aria-label="Timer stoppen: ${text(t.label)}">✕</button>
      </li>`)).join('');
}

/**
 * Einmal beim Start. `ziel` = Element der Leiste (in index.html). Hört am Dokument auf Tipper auf
 * `.zeit[data-timer-id]` (Zeiten in Schritten, gesetzt von teile.js) und auf `[data-timer-weg]`.
 */
export function starteTimerLeiste({ timer, ziel, ton = erstelleTon(), umgebung = globalThis }) {
  const { document } = umgebung;
  const gemeldet = new Set(); // abgelaufene, für die schon gepiept wurde
  let takt = null;
  let wiederholung = null;
  let wiederholt = 0;

  function markiere() {
    document.querySelectorAll('.zeit[data-timer-id]').forEach((el) => {
      el.classList.toggle('zeit-laeuft', timer.laeuft(el.dataset.timerId));
    });
  }

  function melde(liste) {
    const wartend = liste.filter((t) => t.abgelaufen);
    [...gemeldet].forEach((id) => { if (!wartend.some((t) => t.id === id)) gemeldet.delete(id); });
    const neu = wartend.filter((t) => !gemeldet.has(t.id));
    neu.forEach((t) => gemeldet.add(t.id));
    if (neu.length) {
      ton.piepe();
      wiederholt = 0;
    }
    if (wartend.length && !wiederholung) {
      wiederholung = umgebung.setInterval(() => {
        if (++wiederholt > MAX_WIEDERHOLUNGEN) return stoppeWiederholung();
        if (document.visibilityState !== 'hidden') ton.piepe();
      }, WIEDERHOLUNG);
    }
    if (!wartend.length) stoppeWiederholung();
  }

  function stoppeWiederholung() {
    umgebung.clearInterval(wiederholung);
    wiederholung = null;
  }

  function zeichne() {
    const liste = timer.liste();
    ziel.hidden = liste.length === 0;
    ziel.classList.toggle('hat-fertige', liste.some((t) => t.abgelaufen));
    ziel.innerHTML = liste.length ? `<ul class="timer-liste">${leisteHtml(liste)}</ul>` : '';
    // Platz schaffen, damit die Leiste nichts verdeckt (Fuß der Seite, letzte Schritte)
    document.body.style.paddingBottom = liste.length ? `${ziel.offsetHeight}px` : '';
    markiere();
    melde(liste);
    if (liste.length && !takt) takt = umgebung.setInterval(zeichne, TAKT);
    if (!liste.length && takt) {
      umgebung.clearInterval(takt);
      takt = null;
    }
  }

  document.addEventListener('click', (e) => {
    const zeit = e.target.closest?.('.zeit[data-timer-id]');
    if (zeit) {
      // Zeit antippen startet nur den Timer, hakt den Schritt nicht ab (Zuhörer der Rezepte laufen danach)
      e.stopPropagation();
      ton.entsperre(); // im Tipper, sonst bleibt iOS später stumm
      timer.starte({ id: zeit.dataset.timerId, label: zeit.dataset.timerLabel, min: Number(zeit.dataset.timerMin) });
      return;
    }
    const weg = e.target.closest?.('[data-timer-weg]');
    if (weg) timer.beende(weg.dataset.timerWeg);
  }, true);

  timer.beiAenderung(zeichne);
  // Rückkehr aus dem Hintergrund: sofort neu rechnen (Intervalle stehen dort still)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') zeichne();
  });
  zeichne();
  return { zeichne, markiere };
}
