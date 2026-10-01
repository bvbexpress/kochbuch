// html.js – kleine Helfer zum Bauen von HTML-Text.

/** Schützt vor HTML in Namen (wichtig bei eigenen Vorlagen und Links von außen). */
export function text(wert) {
  return String(wert)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
