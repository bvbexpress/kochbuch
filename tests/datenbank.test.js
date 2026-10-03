// Tests für datenbank/schema.sql gegen ein echtes PostgreSQL.
//
// Startet eine leere Wegwerf-Datenbank und baut die Teile von Supabase nach, die das Skript
// braucht (Rollen anon/authenticated, auth.users, auth.uid(), Standard-Rechte in public).
// Ist PostgreSQL nicht installiert, werden die Tests übersprungen (GitHub hat es installiert).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wurzel = new URL('..', import.meta.url).pathname;
const schema = readFileSync(join(wurzel, 'datenbank/schema.sql'), 'utf8');

/** Ordner mit initdb/pg_ctl/psql, oder null. */
function postgresOrdner() {
  const basis = '/usr/lib/postgresql';
  if (!existsSync(basis)) return null;
  const versionen = readdirSync(basis).filter((v) => existsSync(join(basis, v, 'bin/initdb'))).sort((a, b) => b - a);
  return versionen.length ? join(basis, versionen[0], 'bin') : null;
}

const bin = postgresOrdner();
const ohne = bin ? false : 'PostgreSQL nicht installiert';
const alsRoot = process.getuid?.() === 0; // initdb verweigert root → als Benutzer postgres starten
let ordner;

function aufruf(programm, argumente) {
  const [befehl, args] = alsRoot
    ? ['runuser', ['-u', 'postgres', '--', join(bin, programm), ...argumente]]
    : [join(bin, programm), argumente];
  return execFileSync(befehl, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Führt SQL aus und gibt die Ausgabe zurück (eine Zeile je Ergebnis, Spalten mit |). */
function sql(befehle) {
  return aufruf('psql', ['-h', ordner, '-p', '54329', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', befehle]).trim();
}

/** SQL als Konto (oder anonym, konto = null), wie es über die Supabase-Schnittstelle ankäme. */
function als(konto, befehle) {
  const rolle = konto ? 'authenticated' : 'anon';
  return sql(`begin; set local role ${rolle}; set local request.jwt.claim.sub = '${konto ?? ''}';
    ${befehle}; commit;`);
}

/** Erwartet einen Fehler; gibt die Meldung zurück. */
function fehler(fn) {
  try { fn(); } catch (e) { return String(e.stderr ?? e.message); }
  assert.fail('Fehler erwartet');
}

const json = (text) => JSON.parse(text);

// Feste Testkonten (keine echten Daten)
const A = '00000000-0000-4000-8000-00000000000a'; // Haushalt 1
const B = '00000000-0000-4000-8000-00000000000b'; // Haushalt 1
const F = '00000000-0000-4000-8000-00000000000f'; // fremder Haushalt
const X = '00000000-0000-4000-8000-0000000000ff'; // Konto ohne Haushalt

const hoch = (konto, aenderungen) =>
  json(als(konto, `select public.hochladen('${JSON.stringify(aenderungen).replaceAll("'", "''")}'::jsonb)`));
const runter = (konto, seit, anzahl = 500) =>
  json(als(konto, `select public.herunterladen(${seit}, ${anzahl})`));
const vorlage = (id, name, basis = 0, geloescht = false) =>
  ({ sammlung: 'vorlagen', id, daten: { id, name }, geloescht, basis });

before(() => {
  if (ohne) return;
  ordner = mkdtempSync(join(tmpdir(), 'kb-'));
  if (alsRoot) execFileSync('chown', ['postgres', ordner]);
  chmodSync(ordner, 0o700);
  aufruf('initdb', ['-D', join(ordner, 'daten'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync']);
  aufruf('pg_ctl', ['-D', join(ordner, 'daten'), '-w', '-l', join(ordner, 'log'),
    '-o', `-k ${ordner} -c listen_addresses='' -p 54329 -c fsync=off`, 'start']);

  // Nachbau der Supabase-Grundausstattung
  sql(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    insert into auth.users values
      ('${A}', 'a@beispiel.invalid'), ('${B}', 'b@beispiel.invalid'),
      ('${F}', 'f@beispiel.invalid'), ('${X}', 'x@beispiel.invalid');
  `);
  sql(schema);
  sql(schema); // zweimal ausführen darf nicht schaden

  // So legt der Verwalter Haushalt und Mitglieder an (wie das Zusatz-SQL im Chat)
  sql(`
    with h as (insert into public.haushalte (name) values ('Zuhause') returning id)
    insert into public.mitglieder (konto, haushalt, name)
    select u.id, h.id, v.name
    from h cross join (values ('A@beispiel.invalid', 'Handy 1'), ('b@beispiel.invalid', 'Handy 2')) as v (email, name)
    join auth.users u on lower(u.email) = lower(v.email);

    with h as (insert into public.haushalte (name) values ('Fremd') returning id)
    insert into public.mitglieder (konto, haushalt, name) select '${F}', id, 'Fremd' from h;
  `);
});

after(() => {
  if (ohne || !ordner) return;
  try { aufruf('pg_ctl', ['-D', join(ordner, 'daten'), '-m', 'immediate', 'stop']); } catch {}
  rmSync(ordner, { recursive: true, force: true });
});

test('Skript enthält keine E-Mail-Adressen', () => {
  assert.doesNotMatch(schema, /[\w.+-]+@[\w-]+\.[\w.]+/);
});

test('Zusatz-SQL hat beide Konten dem Haushalt zugeordnet', { skip: ohne }, () => {
  assert.equal(sql(`select count(*) from public.mitglieder m join public.haushalte h on h.id = m.haushalt
    where h.name = 'Zuhause'`), '2');
});

test('Hochladen neu (Basis 0) → Version 1; Herunterladen liefert es beiden Handys', { skip: ohne }, () => {
  const [e] = hoch(A, [vorlage('v-neu', 'Pizza')]);
  assert.deepEqual(e, { sammlung: 'vorlagen', id: 'v-neu', ok: true, version: 1 });

  const r = runter(B, 0);
  const d = r.datensaetze.find((x) => x.id === 'v-neu');
  assert.deepEqual({ ...d, stand: undefined }, {
    sammlung: 'vorlagen', id: 'v-neu', daten: { id: 'v-neu', name: 'Pizza' }, geloescht: false, version: 1, stand: undefined,
  });
  assert.equal(r.stand, Math.max(...r.datensaetze.map((x) => x.stand)));
  assert.equal(r.mehr, false);
});

test('Ändern auf aktueller Version klappt, auf veralteter gibt es den Server-Stand zurück', { skip: ohne }, () => {
  hoch(A, [vorlage('v-k', 'Brot')]);
  assert.equal(hoch(B, [vorlage('v-k', 'Brot B', 1)])[0].version, 2);

  const [konflikt] = hoch(A, [vorlage('v-k', 'Brot A', 1)]);
  assert.deepEqual(konflikt, {
    sammlung: 'vorlagen', id: 'v-k', ok: false, version: 2, daten: { id: 'v-k', name: 'Brot B' }, geloescht: false,
  });
  // „neu“ für etwas, das es schon gibt, ist ebenfalls ein Konflikt
  assert.equal(hoch(A, [vorlage('v-k', 'Brot A', 0)])[0].ok, false);
  // Basis höher als auf dem Server, oder Datensatz fehlt auf dem Server
  assert.deepEqual(hoch(A, [vorlage('v-fehlt', 'X', 3)])[0],
    { sammlung: 'vorlagen', id: 'v-fehlt', ok: false, version: 0, daten: null, geloescht: null });
});

test('Löschen ist ein Grabstein mit neuer Version', { skip: ohne }, () => {
  hoch(A, [vorlage('v-l', 'Weg')]);
  assert.equal(hoch(A, [vorlage('v-l', 'Weg', 1, true)])[0].version, 2);
  const d = runter(B, 0).datensaetze.find((x) => x.id === 'v-l');
  assert.equal(d.geloescht, true);
  assert.equal(d.version, 2);
});

test('„Alles seit stand“ liefert nur Neueres, in Reihenfolge, seitenweise', { skip: ohne }, () => {
  const { stand } = runter(A, 0, 1000);
  hoch(A, [vorlage('s-1', '1'), vorlage('s-2', '2'), vorlage('s-3', '3')]);
  const seite1 = runter(B, stand, 2);
  assert.deepEqual(seite1.datensaetze.map((x) => x.id), ['s-1', 's-2']);
  assert.equal(seite1.mehr, true);
  const seite2 = runter(B, seite1.stand, 2);
  assert.deepEqual(seite2.datensaetze.map((x) => x.id), ['s-3']);
  assert.equal(seite2.mehr, false);
  const leer = runter(B, seite2.stand, 2);
  assert.deepEqual(leer.datensaetze, []);
  assert.equal(leer.stand, seite2.stand);
});

test('Unbrauchbare Einträge werden einzeln abgewiesen, der Rest gespeichert', { skip: ohne }, () => {
  const e = hoch(A, [
    { sammlung: 'Vorlagen!', id: 'u-1', daten: {}, geloescht: false, basis: 0 },
    { sammlung: 'vorlagen', id: '', daten: {}, geloescht: false, basis: 0 },
    { sammlung: 'vorlagen', id: 'u-2', daten: [1], geloescht: false, basis: 0 },
    { sammlung: 'vorlagen', id: 'u-3', daten: {}, geloescht: 'nein', basis: 0 },
    { sammlung: 'vorlagen', id: 'u-4', daten: {}, geloescht: false, basis: 1.5 },
    { sammlung: 'vorlagen', id: 'u-5', daten: {}, geloescht: false, basis: -1 },
    { sammlung: 'vorlagen', id: 'u-6', daten: { text: 'x'.repeat(100_001) }, geloescht: false, basis: 0 },
    'kein Objekt',
    vorlage('u-ok', 'Gut'),
  ]);
  assert.deepEqual(e.map((x) => x.ok), [false, false, false, false, false, false, false, false, true]);
  assert.ok(e.slice(0, 8).every((x) => x.fehler === 'ungueltig'));
});

test('Mehr als 200 Änderungen auf einmal werden abgelehnt', { skip: ohne }, () => {
  const viele = Array.from({ length: 201 }, (_, i) => vorlage(`m-${i}`, 'x'));
  assert.match(fehler(() => hoch(A, viele)), /höchstens 200/);
});

test('Eingebaute Mehl-ids (keine UUID) sind erlaubt, Sammlungen getrennt', { skip: ohne }, () => {
  const [e] = hoch(A, [{ sammlung: 'mehle', id: 'weizen550', daten: { id: 'weizen550', wasser: 63 }, geloescht: false, basis: 0 }]);
  assert.equal(e.ok, true);
  assert.equal(hoch(A, [vorlage('weizen550', 'gleiche id, andere Sammlung')])[0].ok, true);
});

test('Fremder Haushalt sieht nichts und kann nichts überschreiben', { skip: ohne }, () => {
  hoch(A, [vorlage('v-geheim', 'Geheim')]);
  assert.ok(!runter(F, 0).datensaetze.some((x) => x.id === 'v-geheim'));
  assert.equal(als(F, `select count(*) from public.datensaetze where id = 'v-geheim'`), '0');
  assert.equal(als(F, `select count(*) from public.mitglieder`), '1');
  assert.equal(als(F, `select string_agg(name, ',') from public.haushalte`), 'Fremd');

  // gleiche id im fremden Haushalt = eigener, getrennter Datensatz
  assert.equal(hoch(F, [vorlage('v-geheim', 'Meins')])[0].version, 1);
  const a = runter(A, 0, 1000).datensaetze.find((x) => x.id === 'v-geheim');
  assert.equal(a.daten.name, 'Geheim');
});

test('Konto ohne Haushalt: kein Zugriff', { skip: ohne }, () => {
  assert.match(fehler(() => hoch(X, [vorlage('x', 'x')])), /Kein Mitglied/);
  assert.match(fehler(() => runter(X, 0)), /Kein Mitglied/);
  assert.equal(als(X, 'select count(*) from public.datensaetze'), '0');
  assert.equal(als(X, 'select count(*) from public.mitglieder'), '0');
});

test('Ohne Anmeldung: nur ping', { skip: ohne }, () => {
  assert.equal(als(null, 'select public.ping()'), 'ok');
  assert.match(fehler(() => als(null, `select public.hochladen('[]')`)), /permission denied/);
  assert.match(fehler(() => als(null, 'select public.herunterladen(0)')), /permission denied/);
  assert.match(fehler(() => als(null, 'select intern.hochladen(\'[]\')')), /permission denied/);
  assert.match(fehler(() => als(null, 'select * from public.datensaetze')), /permission denied/);
  assert.match(fehler(() => als(null, 'select * from public.mitglieder')), /permission denied/);
});

test('Angemeldet: direkt in Tabellen schreiben ist verboten (nur über hochladen)', { skip: ohne }, () => {
  for (const befehl of [
    `insert into public.datensaetze (haushalt, sammlung, id, daten, version, stand)
       select haushalt, 'vorlagen', 'direkt', '{}', 1, 999999 from public.mitglieder limit 1`,
    `update public.datensaetze set version = 99`,
    `delete from public.datensaetze`,
    `insert into public.mitglieder (konto, haushalt, name) select '${X}', haushalt, 'Eindringling' from public.mitglieder limit 1`,
    `update public.mitglieder set haushalt = haushalt`,
    `insert into public.haushalte (name) values ('Neu')`,
    `select nextval('public.datensaetze_stand')`,
  ]) assert.match(fehler(() => als(A, befehl)), /permission denied/, befehl);
});

test('Herunterladen merkt den letzten Abgleich je Konto; das andere Handy sieht ihn', { skip: ohne }, () => {
  sql(`update public.mitglieder set letzter_abgleich = null`);
  runter(B, 0);
  const zeilen = als(A, `select name, letzter_abgleich is not null from public.mitglieder order by name`);
  assert.equal(zeilen, 'Handy 1|f\nHandy 2|t');
});

test('Gelöschtes Konto: Mitgliedschaft fällt weg, Datensätze bleiben', { skip: ohne }, () => {
  sql(`insert into auth.users values ('00000000-0000-4000-8000-0000000000c0', 'c@beispiel.invalid');
    insert into public.mitglieder (konto, haushalt, name)
      select '00000000-0000-4000-8000-0000000000c0', haushalt, 'Alt' from public.mitglieder where konto = '${A}';`);
  hoch('00000000-0000-4000-8000-0000000000c0', [vorlage('v-c', 'Von C')]);
  sql(`delete from auth.users where id = '00000000-0000-4000-8000-0000000000c0'`);
  assert.ok(runter(A, 0, 1000).datensaetze.some((x) => x.id === 'v-c'));
  assert.equal(sql(`select count(*) from public.mitglieder where name = 'Alt'`), '0');
});
