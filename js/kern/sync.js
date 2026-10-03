// sync.js – Abgleich der Datensätze mit dem Server (Etappe 2).
//
// Ablauf von `abgleichen()`:
//   1. Hochladen: alle offenen Datensätze, je mit der Server-Version, auf der sie beruhen.
//      Der Server speichert nur, wenn seine Version noch dieselbe ist – sonst Konflikt.
//   2. Herunterladen: „alles seit stand“, Seite für Seite, und lokal übernehmen.
//      Offene Änderungen werden dabei nie überschrieben (das klärt das Hochladen).
// Entscheidend ist immer die Server-Version, nie die Uhr des Handys.
//
// Konflikte (der Server hat inzwischen eine andere Fassung):
//   - inhaltlich gleich                → kein Konflikt, Server-Fassung übernehmen
//   - Löschen gegen Ändern             → Ändern gewinnt (egal auf welchem Handy)
//   - Art 'kopie' (Vorlagen, Rezepte)  → Server-Fassung bleibt, die eigene wird zur Kopie mit
//                                        Vermerk `konflikt: { von, am }` (kein Dialog)
//   - Art 'zuletzt' (Einzelwerte)      → zuletzt hochgeladen gewinnt: eigene erneut hochladen
//
// Der Server wird von außen mitgegeben (`hochladen`, `herunterladen` wie in datenbank/schema.sql),
// damit dieser Teil ohne Netz getestet werden kann. Fehler (kein Netz, Server pausiert) werfen nie:
// `abgleichen` meldet sie nur im Ergebnis, offene Änderungen bleiben offen.

/** Synchronisierte Sammlungen und wie Konflikte gelöst werden. */
export const SAMMLUNGEN = {
  teigvorlagen: 'kopie',
  mehle: 'zuletzt',
  saaten: 'zuletzt',
  zusaetze: 'zuletzt',
};

const PAKET = 200;          // höchstens so viele Änderungen je Hochladen (Grenze in schema.sql)
const RUNDEN = 5;           // Hochlade-Runden je Abgleich (nach Konflikten oder Änderungen währenddessen)
const SEITEN = 100;         // Schutz vor endlosem Herunterladen
const SAMMLUNG_MUSTER = /^[a-z][a-z0-9_]{0,39}$/; // wie in schema.sql

export function erstelleSync({ speicher, server, sammlungen = SAMMLUNGEN, jetzt = () => Date.now() }) {
  let laeuft = null;   // laufender Abgleich (immer nur einer gleichzeitig)
  let erneut = false;  // während des Abgleichs erneut angestoßen → danach noch einmal

  async function hochladenAlle(bericht) {
    const abgewiesen = new Set(); // vom Server als ungültig abgewiesen: bleibt offen, erst beim nächsten Abgleich wieder
    for (let runde = 0; runde < RUNDEN; runde++) {
      const offen = Object.keys(sammlungen)
        .flatMap((sammlung) => speicher.offene(sammlung).map((o) => ({ sammlung, ...o })))
        .filter((o) => !abgewiesen.has(schluessel(o.sammlung, o.datensatz.id)));
      if (!offen.length) return;

      for (let i = 0; i < offen.length; i += PAKET) {
        const paket = offen.slice(i, i + PAKET);
        const antwort = await server.hochladen(paket.map(({ sammlung, datensatz, version }) => ({
          sammlung,
          id: datensatz.id,
          daten: datensatz,
          geloescht: datensatz.geloescht === true,
          basis: version,
        })));
        if (!Array.isArray(antwort)) throw new Error('Antwort beim Hochladen unbrauchbar');

        paket.forEach(({ sammlung, datensatz }, n) => {
          const e = antwort[n];
          if (!e || typeof e !== 'object' || e.sammlung !== sammlung || e.id !== datensatz.id) return; // bleibt offen
          if (e.ok === true) {
            if (speicher.hochgeladen(sammlung, datensatz, e.version)) bericht.hochgeladen++;
          } else if (e.fehler) {
            abgewiesen.add(schluessel(sammlung, datensatz.id));
            bericht.abgewiesen++;
          } else {
            loeseKonflikt(sammlung, e, bericht);
          }
        });
      }
    }
  }

  /** Konflikt-Antwort des Servers { id, version, daten, geloescht } mit dem aktuellen eigenen Stand lösen. */
  function loeseKonflikt(sammlung, e, bericht) {
    // aktueller Stand – kann sich während des Hochladens geändert haben
    const eigen = speicher.offene(sammlung).find((o) => o.datensatz.id === e.id)?.datensatz;
    if (!eigen || !Number.isSafeInteger(e.version) || e.version < 0) return;
    if (e.version === 0) {
      speicher.neueBasis(sammlung, e.id, 0); // gibt es auf dem Server nicht (mehr): neu hochladen
      return;
    }
    const fremd = { id: e.id, daten: e.daten, geloescht: e.geloescht === true, version: e.version };
    if (!fremd.geloescht && !istObjekt(fremd.daten)) return; // unbrauchbar: bleibt offen

    const serverFassung = () => speicher.vomServer(sammlung, fremd, { offeneErsetzen: true });

    if (gleicherInhalt(eigen, fremd)) {
      serverFassung();
    } else if (eigen.geloescht) {
      serverFassung(); // Ändern gewinnt gegen Löschen
    } else if (fremd.geloescht || sammlungen[sammlung] !== 'kopie') {
      speicher.neueBasis(sammlung, e.id, e.version); // eigene Änderung gilt: auf Server-Fassung aufsetzen
    } else {
      // Erst die Kopie sichern, dann überschreiben – so geht bei einem Abbruch nichts verloren.
      // Gibt es die Kopie schon (abgebrochener Abgleich), keine zweite anlegen.
      const { id, erstellt, geaendert, geloescht, konflikt, ...inhalt } = eigen;
      const vorhanden = speicher.alle(sammlung).some((d) => d.konflikt?.von === id && gleich(inhaltVon(d), inhalt));
      if (!vorhanden && !speicher.speichere(sammlung, { ...inhalt, konflikt: { von: id, am: jetzt() } })) return;
      if (serverFassung() === 'uebernommen' && !vorhanden) bericht.kopien++;
    }
  }

  async function herunterladenAlle(bericht) {
    for (let seite = 0; seite < SEITEN; seite++) {
      const seit = speicher.syncStand();
      const antwort = await server.herunterladen(seit);
      if (!antwort || !Array.isArray(antwort.datensaetze) || !Number.isSafeInteger(antwort.stand)) {
        throw new Error('Antwort beim Herunterladen unbrauchbar');
      }
      for (const d of antwort.datensaetze) {
        // Auch Sammlungen, die diese App-Version nicht kennt, werden gespeichert –
        // sonst fehlen sie nach einem Update, weil `stand` schon weiter ist.
        if (!d || typeof d.sammlung !== 'string' || !SAMMLUNG_MUSTER.test(d.sammlung)) continue;
        const ergebnis = speicher.vomServer(d.sammlung, d);
        if (ergebnis === null) throw new Error('Speichern gescheitert'); // Stand nicht weiterzählen
        if (ergebnis === 'uebernommen') bericht.heruntergeladen++;
      }
      if (antwort.stand > seit && !speicher.setzeSyncStand(antwort.stand)) throw new Error('Speichern gescheitert');
      if (!antwort.mehr || antwort.stand <= seit) return;
    }
  }

  async function einmal() {
    const bericht = { ok: true, hochgeladen: 0, heruntergeladen: 0, kopien: 0, abgewiesen: 0 };
    try {
      await hochladenAlle(bericht);
      await herunterladenAlle(bericht);
    } catch (fehler) {
      bericht.ok = false;
      bericht.fehler = String(fehler?.message ?? fehler);
    }
    bericht.offen = Object.keys(sammlungen).reduce((n, s) => n + speicher.offene(s).length, 0);
    return bericht;
  }

  return {
    /**
     * Gleicht einmal ab. Wird nie abgelehnt. Ergebnis:
     *   { ok, fehler?, hochgeladen, heruntergeladen, kopien, abgewiesen, offen }
     * Läuft schon ein Abgleich, wird er danach wiederholt (für Änderungen währenddessen).
     */
    abgleichen() {
      if (laeuft) {
        erneut = true;
        return laeuft;
      }
      laeuft = (async () => {
        let bericht;
        do {
          erneut = false;
          bericht = await einmal();
        } while (erneut && bericht.ok);
        return bericht;
      })().finally(() => {
        laeuft = null;
      });
      return laeuft;
    },
  };
}

const schluessel = (sammlung, id) => `${sammlung}/${id}`;

const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Nutzdaten ohne Verwaltungsfelder (Zeitstempel, id, Vermerk). */
function inhaltVon(d) {
  const { id, erstellt, geaendert, geloescht, konflikt, sync, ...inhalt } = d;
  return inhalt;
}

/** Gleicher Inhalt? Beide gelöscht zählt als gleich; Zeitstempel zählen nicht. */
function gleicherInhalt(eigen, fremd) {
  if (eigen.geloescht || fremd.geloescht) return eigen.geloescht === true && fremd.geloescht;
  return gleich(inhaltVon(eigen), inhaltVon(fremd.daten));
}

/** Vergleich unabhängig von der Reihenfolge der Felder (die Datenbank sortiert sie um). */
const gleich = (a, b) => JSON.stringify(geordnet(a)) === JSON.stringify(geordnet(b));

function geordnet(x) {
  if (Array.isArray(x)) return x.map(geordnet);
  if (!istObjekt(x)) return x;
  return Object.fromEntries(Object.keys(x).sort().map((k) => [k, geordnet(x[k])]));
}
