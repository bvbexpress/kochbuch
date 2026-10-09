// zurueckwischen.js – Zurück per Wischen: vom linken Bildschirmrand nach rechts ziehen = Zurück-Pfeil antippen.
// Es wird der sichtbare Zurück-Pfeil angetippt, also gelten dieselben Wege und dieselbe Rückfrage wie beim Pfeil.
// Ohne Pfeil (Startseite) passiert nichts. Kollidiert nicht mit dem Wischen nach links (wischen.js), dem Scrollen
// (senkrechte Bewegung bricht ab) und Eingabefeldern (Start am Rand, nie in einem Feld).

export const RAND = 24; // so schmal ist die Startzone am linken Rand (px)
const ANFANG = 10; // so weit muss der Finger wandern, bevor die Richtung zählt (px)
const WEIT = 60; // so weit nach rechts = Zurück (px)
const SCHNELL_WEIT = 30; // bei einer schnellen Bewegung reicht weniger (px) …
const SCHNELL_DAUER = 250; // … wenn sie höchstens so lange (ms) dauert
const MAX_ZUG = 72; // so weit folgt die Seite dem Finger höchstens (px)

/** 'ja', wenn die Bewegung ein Zurück-Wischen ist (waagrecht nach rechts, weit oder schnell genug). */
export function gilt({ dx, dy, dauer }) {
  if (dx <= 0 || Math.abs(dy) > dx * 0.6) return false;
  return dx >= WEIT || (dx >= SCHNELL_WEIT && dauer <= SCHNELL_DAUER);
}

/** Startet am Rand? (nur der äußerste Streifen links) */
export function amRand(x) {
  return x >= 0 && x <= RAND;
}

const FELD = 'input, textarea, select, [contenteditable="true"]';

/**
 * wurzel – Element der App, darin steht der Zurück-Pfeil (.knopf-zurueck); es bewegt sich beim Wischen mit
 * Optionen für Tests: ziel (Standard document), wenigerBewegung() (Standard: Systemeinstellung)
 */
export function startZurueckwischen(wurzel, {
  ziel = document,
  wenigerBewegung = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
} = {}) {
  let aktiv = null; // { x0, y0, t0, knopf, gezogen }

  function zurueckgesetzt(mitFeder) {
    wurzel.style.transition = mitFeder ? 'transform var(--dauer, 0.18s) var(--kurve, ease-out)' : '';
    wurzel.style.transform = '';
  }

  ziel.addEventListener('touchstart', (e) => {
    aktiv = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!amRand(t.clientX) || e.target.closest?.(FELD)) return;
    const knopf = [...wurzel.querySelectorAll('.knopf-zurueck')].find((k) => !k.closest('[hidden]') && !k.disabled);
    if (!knopf) return;
    aktiv = { x0: t.clientX, y0: t.clientY, t0: e.timeStamp, knopf, gezogen: false };
  }, { passive: true });

  ziel.addEventListener('touchmove', (e) => {
    if (!aktiv) return;
    const t = e.touches[0];
    const dx = t.clientX - aktiv.x0;
    const dy = t.clientY - aktiv.y0;
    if (!aktiv.gezogen) {
      if (Math.abs(dy) > ANFANG && Math.abs(dy) > Math.abs(dx)) { aktiv = null; return; } // senkrecht: Scrollen
      if (dx < -ANFANG) { aktiv = null; return; } // nach innen gewischt: nicht unsere Geste
      if (dx <= ANFANG) return;
      aktiv.gezogen = true;
    }
    if (e.cancelable) e.preventDefault(); // Seite steht still, nur wir bewegen sie
    if (wenigerBewegung()) return;
    aktiv.bewegt = true;
    wurzel.style.transition = 'none';
    wurzel.style.transform = `translateX(${Math.min(Math.max(dx, 0), MAX_ZUG) * 0.6}px)`;
  }, { passive: false });

  function ende(e) {
    const a = aktiv;
    aktiv = null;
    if (!a?.gezogen) return;
    if (a.bewegt) zurueckgesetzt(true);
    const t = e.changedTouches?.[0];
    if (e.type === 'touchend' && t && gilt({ dx: t.clientX - a.x0, dy: t.clientY - a.y0, dauer: e.timeStamp - a.t0 })) {
      a.knopf.click();
    }
  }
  ziel.addEventListener('touchend', ende);
  ziel.addEventListener('touchcancel', ende);
}
