// wischen.js – Zeilen der Vorlagenliste nach links wischen: der rote Knopf dahinter wird sichtbar.
// Nur die Geste. Was der Knopf tut (löschen, ausblenden, „Rückgängig“), steht in ansicht.js.
// Senkrecht scrollen bleibt unberührt (`touch-action: pan-y` in teig.css).

const BREITE = 128; // Breite des roten Knopfes (px), passt zu `--weg-breite` in teig.css
const ANFANG = 10; // so weit muss der Finger waagrecht wandern, bevor es ein Wischen ist (px)

/**
 * wurzel  – Element mit der Liste (Zuhörer hängen hier, überstehen also das Neuzeichnen)
 * beiEnde – () => …, wenn ein Wischen vorbei ist (z. B. verpasste Aktualisierung nachholen)
 * Ergebnis: { zieht(), schliesse() }
 */
export function erstelleWischen(wurzel, { beiEnde = () => {} } = {}) {
  let aktiv = null; // { zeile, inhalt, x0, y0, start, gezogen, id }
  let offen = null; // Zeile mit sichtbarem Knopf
  let ohneKlick = false; // direkt nach einem Wischen kein Antippen auslösen

  function setze(zeile, x) {
    zeile.querySelector('.vorlage-inhalt').style.transform = x === 0 ? '' : `translateX(${x}px)`;
  }

  function schliesse() {
    if (offen?.isConnected) {
      offen.classList.remove('offen');
      setze(offen, 0);
    }
    offen = null;
  }

  wurzel.addEventListener('pointerdown', (e) => {
    const inhalt = e.target.closest?.('.vorlage-inhalt');
    const zeile = inhalt?.closest('.vorlage-zeile');
    if (offen && offen !== zeile && !e.target.closest('.vorlage-weg')) schliesse();
    if (!zeile || !e.isPrimary) return;
    aktiv = { zeile, inhalt, x0: e.clientX, y0: e.clientY, start: zeile === offen ? -BREITE : 0, gezogen: false, id: e.pointerId };
  });

  wurzel.addEventListener('pointermove', (e) => {
    if (!aktiv || e.pointerId !== aktiv.id) return;
    const dx = e.clientX - aktiv.x0;
    const dy = e.clientY - aktiv.y0;
    if (!aktiv.gezogen) {
      if (Math.abs(dy) > ANFANG) aktiv = null; // senkrecht: Scrollen
      else if (Math.abs(dx) > ANFANG && Math.abs(dx) > Math.abs(dy)) {
        aktiv.gezogen = true;
        aktiv.zeile.classList.add('zieht');
      }
      if (!aktiv?.gezogen) return;
    }
    setze(aktiv.zeile, Math.min(0, Math.max(-BREITE, aktiv.start + dx)));
  });

  function loslassen(e) {
    if (!aktiv || e.pointerId !== aktiv.id) return;
    const { zeile, inhalt, gezogen } = aktiv;
    aktiv = null;
    if (!gezogen) return;
    zeile.classList.remove('zieht');
    const x = new DOMMatrixReadOnly(getComputedStyle(inhalt).transform).m41;
    ohneKlick = true;
    setTimeout(() => (ohneKlick = false), 350);
    if (x < -BREITE / 2) {
      if (offen && offen !== zeile) schliesse();
      offen = zeile;
      zeile.classList.add('offen');
      setze(zeile, -BREITE);
    } else {
      offen = zeile;
      schliesse();
    }
    beiEnde();
  }
  wurzel.addEventListener('pointerup', loslassen);
  wurzel.addEventListener('pointercancel', loslassen);

  // Nach dem Wischen kein Antippen; auf eine offene Zeile tippen schließt sie nur
  wurzel.addEventListener('click', (e) => {
    const inhalt = e.target.closest?.('.vorlage-inhalt');
    const offenAntippen = offen && inhalt && inhalt.closest('.vorlage-zeile') === offen;
    if (ohneKlick && inhalt) {
      e.preventDefault();
      e.stopPropagation();
    } else if (offenAntippen) {
      e.preventDefault();
      e.stopPropagation();
      schliesse();
    }
  }, true);

  return { zieht: () => Boolean(aktiv?.gezogen), schliesse };
}
