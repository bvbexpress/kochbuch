// Test-Connector „Hallo“ (Etappe 3, Schritt 0) – Supabase Edge Function, im Dashboard eingefügt.
// Ein winziger MCP-Server mit genau einem Werkzeug `hallo`. Er liest und schreibt keine Daten.
// Er klärt nur: Erreicht claude.ai die Funktion, und wie kommt der Schlüssel an?
//   - als Kopfzeile (`Authorization: Bearer <Schlüssel>` oder `x-api-key`) – Weg „Request headers“
//   - im Pfad (`…/functions/v1/hallo/<Schlüssel>`) – Plan B 1
// Der Schlüssel steht nur als Secret `KOCHBUCH_SCHLUESSEL` in Supabase, nie im Repo.
// Bewusst ohne Typen geschrieben: dieselbe Datei läuft in Deno (Supabase) und in den Tests (Node).

const VERSIONEN = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MIN_LAENGE = 32;

const WERKZEUG = {
  name: 'hallo',
  description: 'Testet die Verbindung zum Kochbuch. Antwortet mit einem Gruß und sagt, wie der Schlüssel ankam.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/** Vergleich in fester Zeit (verrät nicht, wie viele Zeichen stimmen). */
function gleich(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let unterschied = 0;
  for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return unterschied === 0;
}

/** Wie kam ein gültiger Schlüssel an? 'kopfzeile' | 'pfad' | null (kein gültiger). */
export function zugang(anfrage, schluessel) {
  if (typeof schluessel !== 'string' || schluessel.length < MIN_LAENGE) return null; // ohne Secret nie offen
  const kopf = anfrage.headers.get('authorization') ?? '';
  const bearer = kopf.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (gleich(bearer, schluessel) || gleich(anfrage.headers.get('x-api-key') ?? undefined, schluessel)) return 'kopfzeile';
  const letzter = new URL(anfrage.url).pathname.split('/').filter(Boolean).pop();
  if (gleich(letzter, schluessel)) return 'pfad';
  return null;
}

function antwort(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function fehler(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** Eine JSON-RPC-Nachricht. Benachrichtigungen (ohne id) → null (keine Antwort). */
export function nachricht(n, weg) {
  if (!n || typeof n !== 'object' || n.jsonrpc !== '2.0' || typeof n.method !== 'string') {
    return fehler(n?.id, -32600, 'Ungültige Anfrage');
  }
  if (n.id === undefined) return null;
  switch (n.method) {
    case 'initialize': {
      const gewuenscht = n.params?.protocolVersion;
      return antwort(n.id, {
        protocolVersion: VERSIONEN.includes(gewuenscht) ? gewuenscht : VERSIONEN[1],
        capabilities: { tools: {} },
        serverInfo: { name: 'kochbuch-hallo', version: '0.1.0' },
        instructions: 'Test-Connector des Kochbuchs. Nur das Werkzeug „hallo“.',
      });
    }
    case 'ping':
      return antwort(n.id, {});
    case 'tools/list':
      return antwort(n.id, { tools: [WERKZEUG] });
    case 'tools/call': {
      if (n.params?.name !== WERKZEUG.name) return fehler(n.id, -32602, 'Unbekanntes Werkzeug');
      const ueber = weg === 'pfad' ? 'im Pfad der Adresse' : 'als Kopfzeile (Request header)';
      return antwort(n.id, {
        content: [{ type: 'text', text: `Hallo vom Kochbuch! Die Verbindung steht. Der Schlüssel kam ${ueber}.` }],
      });
    }
    default:
      return fehler(n.id, -32601, 'Unbekannte Methode');
  }
}

const json = (daten, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { 'content-type': 'application/json' } });

/** Bearbeitet eine HTTP-Anfrage (MCP „Streamable HTTP“, nur JSON-Antworten, ohne Sitzung). */
export async function bearbeite(anfrage, schluessel) {
  const weg = zugang(anfrage, schluessel);
  if (!weg) return json({ fehler: 'nicht erlaubt' }, 401);
  if (anfrage.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });

  let eingang;
  try {
    eingang = JSON.parse(await anfrage.text());
  } catch {
    return json(fehler(null, -32700, 'Kein gültiges JSON'), 400);
  }
  const liste = Array.isArray(eingang) ? eingang : [eingang];
  // Protokoll für den Test (ohne Schlüssel): welcher Weg, welche Methoden, welcher Absender
  console.log(JSON.stringify({ weg, methoden: liste.map((n) => n?.method), agent: anfrage.headers.get('user-agent') }));

  const ergebnisse = liste.map((n) => nachricht(n, weg)).filter((e) => e !== null);
  if (ergebnisse.length === 0) return new Response(null, { status: 202 });
  return json(Array.isArray(eingang) ? ergebnisse : ergebnisse[0]);
}

if (globalThis.Deno) {
  Deno.serve((anfrage) => bearbeite(anfrage, Deno.env.get('KOCHBUCH_SCHLUESSEL')));
}
