// rechner.js – die reine Rechenlogik des Teigrechners.
//
// Grundregel: Alle Prozente beziehen sich auf das GESAMTMEHL,
// also inklusive des Mehls im Starter. Der Starter hat 100 % Hydration,
// besteht also je zur Hälfte aus Mehl und Wasser.
//
// Ein Teig wird in Prozent beschrieben (siehe `teigAusGramm`):
// {
//   hydration: 76.9,         // Gesamtwasser in % vom Gesamtmehl
//   starter: 15.4,           // Starter in % vom Gesamtmehl
//   salz: 2.2, oel: 4.6,
//   hefe: 0, hefeArt: 'frisch' | 'trocken',
//   mehlsorten: [{ id: 'tipo00', name: 'Tipo 00', anteil: 100 }], // Anteile am zugegebenen Mehl, Summe 100
//   saaten: [{ id: 'leinsamen', name: 'Leinsamen', prozent: 4.5 }], // Quellstück: Saaten in % vom Gesamtmehl
//   quellwasser: 14.5,       // Quellwasser in % vom Gesamtmehl
// }

const TROCKENHEFE_FAKTOR = 3; // 3 g Frischhefe ≈ 1 g Trockenhefe

/** Summe der Zutaten pro 1 g Gesamtmehl (ohne Mehl selbst). */
function anteileProGrammMehl(teig) {
  const saatenProzent = summe((teig.saaten ?? []).map((s) => s.prozent));
  return (
    (teig.hydration + teig.salz + teig.oel + teig.hefe + saatenProzent + quellwasserProzent(teig)) / 100
  );
}

/**
 * Gesamtmehl aus der Teigmenge: Anzahl × Gewicht der Teiglinge.
 * Der Starter muss hier nicht extra berücksichtigt werden, weil sein Mehl
 * und Wasser schon im Gesamtmehl und in der Hydration stecken.
 */
export function mehlAusTeiglingen(teig, anzahl, gewicht) {
  const teigGesamt = anzahl * gewicht;
  if (teigGesamt <= 0) return 0;
  return teigGesamt / (1 + anteileProGrammMehl(teig));
}

/**
 * Gesamtmehl aus dem zugegebenen Mehl (das, was man abwiegt).
 * Zugegebenes Mehl = Gesamtmehl − Mehl im Starter
 *                  = Gesamtmehl × (1 − Starter% / 200)
 * Bei 200 % Starter oder mehr bestünde das Mehl nur noch aus Starter → 0.
 */
export function gesamtmehlAusMehl(teig, mehl) {
  const nenner = 1 - teig.starter / 200;
  if (mehl <= 0 || nenner <= 0) return 0;
  return mehl / nenner;
}

/**
 * Rechnet einen Teig für eine bestimmte Gesamtmehlmenge in Gramm aus.
 * Ergebnis: ungerundete Grammzahlen und eine Liste von Hinweisen.
 */
export function berechne(teig, gesamtmehl) {
  const p = (prozent) => (gesamtmehl * prozent) / 100;

  const starter = p(teig.starter);
  const starterMehl = starter / 2;
  const starterWasser = starter / 2;

  const mehl = gesamtmehl - starterMehl;       // zugegebenes Mehl
  const wasserGesamt = p(teig.hydration);
  const wasser = wasserGesamt - starterWasser; // zugegebenes Wasser

  const hinweise = [];
  if (mehl < 0 || teig.starter >= 200) hinweise.push('starter-zu-viel');
  if (wasser < 0) hinweise.push('hydration-zu-niedrig');

  const mehlsorten = verteileMehl(teig.mehlsorten ?? [], Math.max(mehl, 0), hinweise);

  const saaten = (teig.saaten ?? []).map((s) => ({ id: s.id, name: s.name, gramm: p(s.prozent) }));
  const saatenGesamt = summe(saaten.map((s) => s.gramm));
  const quellwasser = p(quellwasserProzent(teig));

  const salz = p(teig.salz);
  const oel = p(teig.oel);
  const hefe = p(teig.hefe);

  const teigGesamt = gesamtmehl + wasserGesamt + salz + oel + hefe + saatenGesamt + quellwasser;

  return {
    gesamtmehl,
    mehl: Math.max(mehl, 0),
    mehlsorten,
    wasser: Math.max(wasser, 0),
    wasserGesamt,
    starter,
    starterMehl,
    starterWasser,
    salz,
    oel,
    hefe,
    saaten,
    quellwasser,
    teigGesamt,
    hinweise,
  };
}

/**
 * Verteilt das zugegebene Mehl auf die Sorten.
 * Ergeben die Anteile nicht 100 %, wird trotzdem im Verhältnis verteilt
 * und ein Hinweis angehängt, damit die Grammzahlen immer zusammenpassen.
 */
function verteileMehl(sorten, mehl, hinweise) {
  const anteilSumme = summe(sorten.map((s) => s.anteil));
  if (sorten.length > 0 && Math.abs(anteilSumme - 100) > 0.01) {
    hinweise.push('mehlanteile-nicht-100');
  }
  if (anteilSumme <= 0) {
    return sorten.map((s) => ({ id: s.id, name: s.name, gramm: 0 }));
  }
  return sorten.map((s) => ({ id: s.id, name: s.name, gramm: (mehl * s.anteil) / anteilSumme }));
}

/**
 * Wandelt ein Rezept in Gramm (so wie man es aufschreibt) in einen Teig in Prozent um.
 * Wird für die eingebauten Vorlagen benutzt.
 * Liefert { teig, gesamtmehl, mehl } – mehl ist das zugegebene Mehl.
 */
export function teigAusGramm(rezept) {
  const mehlZugegeben = summe(rezept.mehlsorten.map((s) => s.gramm));
  const starter = rezept.starter ?? 0;
  const gesamtmehl = mehlZugegeben + starter / 2;
  const inProzent = (gramm) => (gesamtmehl > 0 ? ((gramm ?? 0) / gesamtmehl) * 100 : 0);

  const saaten = rezept.saaten ?? [];

  const teig = {
    hydration: inProzent((rezept.wasser ?? 0) + starter / 2),
    starter: inProzent(starter),
    salz: inProzent(rezept.salz),
    oel: inProzent(rezept.oel),
    hefe: inProzent(rezept.hefe),
    hefeArt: rezept.hefeArt ?? 'frisch',
    mehlsorten: rezept.mehlsorten.map((s) => ({
      id: s.id,
      name: s.name,
      anteil: mehlZugegeben > 0 ? (s.gramm / mehlZugegeben) * 100 : 0,
    })),
    saaten: saaten.map((s) => ({ id: s.id, name: s.name, prozent: inProzent(s.gramm) })),
    quellwasser: saaten.length > 0 ? inProzent(rezept.quellwasser) : 0,
  };
  return { teig, gesamtmehl, mehl: mehlZugegeben };
}

/**
 * Rechnet den Hefe-Prozentwert beim Umschalten der Hefeart um.
 * Frisch → trocken: durch 3. Trocken → frisch: mal 3.
 */
export function hefeUmrechnen(prozent, vonArt, nachArt) {
  if (vonArt === nachArt) return prozent;
  return nachArt === 'trocken' ? prozent / TROCKENHEFE_FAKTOR : prozent * TROCKENHEFE_FAKTOR;
}

/**
 * Starter-Auffrischung.
 * bedarf: so viel Starter braucht das Rezept (g)
 * rest:   so viel soll zurück in den Kühlschrank (g)
 * verhaeltnis: [Anstellgut, Mehl, Wasser], z. B. [1, 1.5, 1.5]
 */
export function auffrischen(bedarf, rest, verhaeltnis) {
  const [a, m, w] = verhaeltnis;
  const gesamt = bedarf + rest;
  const teile = a + m + w;
  if (gesamt <= 0 || teile <= 0) {
    return { gesamt: 0, anstellgut: 0, mehl: 0, wasser: 0, hydration: 0 };
  }
  const teil = gesamt / teile;
  // Hydration des aufgefrischten Starters: Anstellgut selbst hat 100 %.
  const mehlGesamt = (a / 2 + m) * teil;
  const wasserGesamt = (a / 2 + w) * teil;
  return {
    gesamt,
    anstellgut: a * teil,
    mehl: m * teil,
    wasser: w * teil,
    hydration: mehlGesamt > 0 ? (wasserGesamt / mehlGesamt) * 100 : 0,
  };
}

// ---------- Mehlmischung und Wasseraufnahme ----------

/**
 * Wasseraufnahme einer Mischung: nach Anteil gewichteter Mittelwert.
 * wasserVon: Funktion id → Wasseraufnahme in %.
 * Ohne Anteile (alles 0) gibt es keinen Mischwert → null.
 */
export function mischwert(sorten, wasserVon) {
  const anteile = summe(sorten.map((s) => s.anteil));
  if (anteile <= 0) return null;
  return summe(sorten.map((s) => s.anteil * wasserVon(s.id))) / anteile;
}

/**
 * Neue Hydration nach einer Änderung der Mehlmischung.
 * Es wird nur der Mehr- oder Minderbedarf dazugerechnet, damit eine
 * erprobte oder selbst eingetippte Hydration erhalten bleibt.
 * Das Starter-Mehl ändert sich nicht, darum zählt nur der Anteil
 * des zugegebenen Mehls am Gesamtmehl.
 */
export function hydrationNachMehlwechsel(teig, alteSorten, neueSorten, wasserVon) {
  const vorher = mischwert(alteSorten, wasserVon);
  const nachher = mischwert(neueSorten, wasserVon);
  if (vorher === null || nachher === null) return teig.hydration;
  const anteilZugegeben = Math.max(1 - teig.starter / 200, 0);
  return Math.max(teig.hydration + (nachher - vorher) * anteilZugegeben, 0);
}

/**
 * Setzt die Grammzahl einer Mehlsorte (Eingabe in Gramm statt Prozent).
 * Die übrigen Sorten behalten ihre Gramm, das zugegebene Mehl ist die Summe.
 * Liefert { mehlsorten, mehl } mit neuen Anteilen.
 */
export function mehlsortenMitGramm(sorten, index, gramm, mehl) {
  const anteile = summe(sorten.map((s) => s.anteil));
  const grammListe = sorten.map((s, i) =>
    i === index ? gramm : anteile > 0 ? (mehl * s.anteil) / anteile : 0,
  );
  const neuesMehl = summe(grammListe);
  return {
    mehl: neuesMehl,
    mehlsorten: sorten.map((s, i) => ({
      ...s,
      anteil: neuesMehl > 0 ? (grammListe[i] / neuesMehl) * 100 : 0,
    })),
  };
}

/**
 * Setzt den Anteil einer Mehlsorte in %.
 * Bei genau zwei Sorten wird die andere auf 100 % ergänzt – das ist der
 * häufigste Fall und erspart das Nachrechnen.
 */
export function mehlsortenMitAnteil(sorten, index, anteil) {
  return sorten.map((s, i) => {
    if (i === index) return { ...s, anteil };
    if (sorten.length === 2) return { ...s, anteil: Math.max(100 - anteil, 0) };
    return { ...s };
  });
}

// ---------- Quellstück ----------

/** Quellwasser in % vom Gesamtmehl; negative Werte gibt es nicht. */
function quellwasserProzent(teig) {
  return Math.max(teig.quellwasser ?? 0, 0);
}

/** Wasserbedarf der Saaten laut Quellverhältnis, in % vom Gesamtmehl. */
export function quellbedarf(saaten, verhaeltnisVon) {
  return summe(saaten.map((s) => s.prozent * verhaeltnisVon(s.id)));
}

/**
 * Neues Quellwasser nach einer Änderung der Saaten.
 * Wie beim Mehl: nur der Mehr- oder Minderbedarf der geänderten Saaten
 * kommt dazu, das Quellwasser der Vorlage bleibt sonst erhalten.
 * Ohne Saaten gibt es kein Quellwasser.
 *
 * Beim Entfernen einer Saat kann dabei zu wenig übrig bleiben (die Vorlage
 * hatte weniger Wasser als die Verhältnisse). Dann gilt der Bedarf der
 * übrigen Saaten laut Verhältnis – aber nie mehr Wasser als vorher.
 */
export function quellwasserNachSaatwechsel(teig, alteSaaten, neueSaaten, verhaeltnisVon) {
  if (neueSaaten.length === 0) return 0;
  const vorher = teig.quellwasser ?? 0;
  const bedarf = quellbedarf(neueSaaten, verhaeltnisVon);
  const neu = vorher + bedarf - quellbedarf(alteSaaten, verhaeltnisVon);
  if (neueSaaten.length < alteSaaten.length) return Math.max(neu, Math.min(bedarf, vorher));
  return neu;
}

// ---------- Hinweise zur Mehlart ----------

export const HAFER_GRENZE = 20;   // ab hier deutlicher Hinweis (% vom zugegebenen Mehl)
export const ROGGEN_GRENZE = 50;  // ab hier ohne Sauerteig ein Hinweis

/**
 * Hinweise zur Mehlmischung. artVon: Funktion (id, name) → 'hafer' | 'roggen' | null.
 */
export function mehlHinweise(teig, artVon) {
  const sorten = teig.mehlsorten ?? [];
  const anteile = summe(sorten.map((s) => s.anteil));
  if (anteile <= 0) return [];
  const anteilVon = (art) =>
    (summe(sorten.filter((s) => artVon(s.id, s.name) === art).map((s) => s.anteil)) / anteile) * 100;

  const hinweise = [];
  const hafer = anteilVon('hafer');
  if (hafer >= HAFER_GRENZE) hinweise.push('hafer-viel');
  else if (hafer > 0) hinweise.push('hafer');
  if (anteilVon('roggen') >= ROGGEN_GRENZE && !(teig.starter > 0)) hinweise.push('roggen-ohne-sauerteig');
  return hinweise;
}

function summe(zahlen) {
  return zahlen.reduce((a, b) => a + (b || 0), 0);
}
