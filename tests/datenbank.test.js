// Tests für datenbank/schema.sql gegen ein echtes PostgreSQL.
//
// Startet eine leere Wegwerf-Datenbank und baut die Teile von Supabase nach, die das Skript
// braucht (Rollen anon/authenticated, auth.users, auth.uid()). Alle Tests laufen zweimal:
//   standard – alte Supabase-Grundeinstellung: neue Tabellen/Funktionen automatisch für alle freigegeben
//   streng   – „Automatically expose new tables“ aus, „Enable automatic RLS“ an, keine Freigabe
//              von public: Das Skript muss alle nötigen Freigaben selbst setzen.
// Ist PostgreSQL nicht installiert, werden die Tests lokal übersprungen.
// Bei GitHub (GITHUB_ACTIONS) dürfen sie nie übersprungen werden: Dort wird der Lauf dann rot.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bearbeite } from '../supabase/functions/kochbuch/index.ts';
import { bereinigeRezept } from '../js/rezepte/rezept.js';

const wurzel = new URL('..', import.meta.url).pathname;
const schema = readFileSync(join(wurzel, 'datenbank/schema.sql'), 'utf8');
const pruefung = readFileSync(join(wurzel, 'datenbank/connector-pruefen.sql'), 'utf8');

/** Ordner mit initdb/pg_ctl/psql, oder null. */
function postgresOrdner() {
  const basis = '/usr/lib/postgresql';
  if (!existsSync(basis)) return null;
  const versionen = readdirSync(basis).filter((v) => existsSync(join(basis, v, 'bin/initdb'))).sort((a, b) => b - a);
  return versionen.length ? join(basis, versionen[0], 'bin') : null;
}

const bin = postgresOrdner();
const beiGitHub = process.env.GITHUB_ACTIONS === 'true';
const ohne = bin || beiGitHub ? false : 'PostgreSQL nicht installiert';
const alsRoot = process.getuid?.() === 0; // initdb verweigert root → als Benutzer postgres starten
let ordner;
let db; // Datenbank der gerade laufenden Testgruppe

function aufruf(programm, argumente) {
  const [befehl, args] = alsRoot
    ? ['runuser', ['-u', 'postgres', '--', join(bin, programm), ...argumente]]
    : [join(bin, programm), argumente];
  return execFileSync(befehl, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Führt SQL aus und gibt die Ausgabe zurück (eine Zeile je Ergebnis, Spalten mit |). */
function sql(befehle) {
  return aufruf('psql', ['-h', ordner, '-p', '54329', '-U', 'postgres', '-d', db,
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


/** SQL als Connector-Rolle (so meldet sich später die Edge Function an). */
// `session authorization` statt `role`: Die Sitzung gehört dann wirklich der Rolle (wie nach der Anmeldung).
const connector = (befehle) => sql(`begin; set local session authorization kochbuch_connector; ${befehle}; commit;`);
const sqlText = (x) => `'${JSON.stringify(x).replaceAll("'", "''")}'`;
const speichern = (eingabe) => json(connector(`select connector.rezept_speichern(${sqlText(eingabe)}::jsonb)`));
const finden = (suche) => json(connector(`select connector.rezepte_finden(${sqlText(suche).replace(/^'"|"'$/g, "'")})`));
const lesen = (id) => {
  const text = connector(`select connector.rezept_lesen('${id}')`);
  return text ? json(text) : null;
};
/** Kleines gültiges Koch-Rezept, wie es die Edge Function schicken würde. */
const rezept = (name) => ({
  art: 'kochen', name, kategorie: 'currys', portionen: 4, portionsart: 'personen',
  zutaten: [{ zutat: 'linsen', menge: 200, einheit: 'g', regel: 'linear' }, { zutat: 'salz', menge: null, einheit: '', regel: 'fix' }],
  schritte: ['Linsen waschen.', 'Kochen.'],
  schrittzutaten: [[{ zutat: 'linsen' }], []],
  status: 'erprobt', notiz: '', quelle: 'claude',
});

// Teile von Supabase, die es in jedem Projekt gibt
const SUPABASE = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  -- Erweiterungen wie bei Supabase im Schema extensions (nur für diese Rollen benutzbar).
  -- pg_stat_statements gibt seine Ansichten selbst für alle (PUBLIC) frei, pgcrypto/uuid-ossp ihre Funktionen.
  create schema extensions;
  grant usage on schema extensions to anon, authenticated;
  create extension pg_stat_statements with schema extensions;
  create extension pgcrypto with schema extensions;
  create extension "uuid-ossp" with schema extensions;
  insert into auth.users values
    ('${A}', 'a@beispiel.invalid'), ('${B}', 'b@beispiel.invalid'),
    ('${F}', 'f@beispiel.invalid'), ('${X}', 'x@beispiel.invalid');
`;

const MODI = {
  standard: `
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `,
  streng: `
    revoke all on schema public from public;
    -- so legt Supabase die Funktion für „Enable automatic RLS“ an (für alle ausführbar)
    create function public.rls_auto_enable() returns event_trigger language plpgsql
      security definer set search_path = '' as $$
    declare o record;
    begin
      for o in select * from pg_event_trigger_ddl_commands()
        where command_tag = 'CREATE TABLE' and schema_name = 'public' loop
        execute format('alter table %s enable row level security', o.object_identity);
      end loop;
    end $$;
    grant execute on function public.rls_auto_enable() to anon, authenticated;
    create event trigger rls_auto_enable on ddl_command_end when tag in ('CREATE TABLE')
      execute function public.rls_auto_enable();
  `,
};

// So legt der Verwalter Haushalt und Mitglieder an (wie das Zusatz-SQL im Chat)
const ZUSATZ = `
  with h as (insert into public.haushalte (name) values ('Zuhause') returning id)
  insert into public.mitglieder (konto, haushalt, name)
  select u.id, h.id, v.name
  from h cross join (values ('A@beispiel.invalid', 'Handy 1'), ('b@beispiel.invalid', 'Handy 2')) as v (email, name)
  join auth.users u on lower(u.email) = lower(v.email);

  with h as (insert into public.haushalte (name) values ('Fremd') returning id)
  insert into public.mitglieder (konto, haushalt, name) select '${F}', id, 'Fremd' from h;
`;

before(() => {
  if (ohne) return;
  if (!bin) throw new Error('PostgreSQL fehlt bei GitHub – die Datenbank-Tests dürfen dort nicht übersprungen werden');
  ordner = mkdtempSync(join(tmpdir(), 'kb-'));
  if (alsRoot) execFileSync('chown', ['postgres', ordner]);
  chmodSync(ordner, 0o700);
  aufruf('initdb', ['-D', join(ordner, 'daten'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync']);
  aufruf('pg_ctl', ['-D', join(ordner, 'daten'), '-w', '-l', join(ordner, 'log'),
    '-o', `-k ${ordner} -c listen_addresses='' -p 54329 -c fsync=off`, 'start']);

  db = 'postgres';
  sql('create role anon nologin; create role authenticated nologin;');
  for (const name of Object.keys(MODI)) sql(`create database ${name}`);
});

after(() => {
  if (ohne || !ordner) return;
  try { aufruf('pg_ctl', ['-D', join(ordner, 'daten'), '-m', 'immediate', 'stop']); } catch {}
  rmSync(ordner, { recursive: true, force: true });
});

test('Skript enthält keine E-Mail-Adressen und keine Passwörter', () => {
  assert.doesNotMatch(schema, /[\w.+-]+@[\w-]+\.[\w.]+/);
  assert.doesNotMatch(schema, /password/i);
});

for (const [modus, grundausstattung] of Object.entries(MODI)) describe(`Supabase ${modus}`, () => {
  before(() => {
    if (ohne) return;
    db = modus;
    sql(SUPABASE + grundausstattung);
    sql(schema);
    sql(schema); // zweimal ausführen darf nicht schaden
    sql(ZUSATZ);
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

  // ---------- Connector (Etappe 3, Schritt 7) ----------

  describe('Connector-Rolle', () => {
    before(() => {
      if (ohne) return;
      sql(`update public.haushalte set connector = (name = 'Zuhause')`);
    });

    test('Rolle ohne Sonderrechte, ohne Anmeldung, in keiner anderen Rolle', { skip: ohne }, () => {
      assert.equal(sql(`select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication, rolinherit, rolcanlogin
        from pg_roles where rolname = 'kochbuch_connector'`), 'f|f|f|f|f|f|f');
      assert.equal(sql(`select count(*) from pg_auth_members where member = 'kochbuch_connector'::regrole`), '0');
      assert.equal(sql(`select count(*) from pg_auth_members where roleid = 'kochbuch_connector'::regrole`), '0');
      for (const rolle of ['anon', 'authenticated', 'postgres']) {
        assert.match(fehler(() => connector(`set role ${rolle}`)), /permission denied/, rolle);
      }
    });

    test('Darf genau die vier Connector-Funktionen ausführen – keine andere, keine Tabelle', { skip: ohne }, () => {
      // dieselbe Abfrage, die der Verwalter im Dashboard ausführt (keine Tabelle, keine andere Funktion)
      assert.deepEqual(sql(pruefung).split('\n'), [
        'funktion|connector.rezept_lesen', 'funktion|connector.rezept_speichern',
        'funktion|connector.rezepte_finden', 'funktion|connector.zutaten_liste',
      ]);
      // Die Erweiterungen geben Objekte für alle frei (wie bei Supabase) – erreichbar sind sie trotzdem nicht
      assert.equal(sql(`select has_table_privilege('kochbuch_connector', 'extensions.pg_stat_statements', 'select')`), 't');
      assert.equal(sql(`select has_schema_privilege('kochbuch_connector', 'extensions', 'usage')`), 'f');
    });

    test('Die Kontrollabfrage meldet es, sobald ein Schema für alle benutzbar wird', { skip: ohne }, () => {
      sql('grant usage on schema extensions to public');
      try {
        const zeilen = sql(pruefung).split('\n');
        assert.ok(zeilen.includes('schema|extensions'), zeilen.join(' '));
        assert.ok(zeilen.includes('tabelle|extensions.pg_stat_statements'));
        assert.ok(zeilen.includes('funktion|extensions.crypt'));
        assert.ok(zeilen.includes('funktion|extensions.uuid_generate_v4'));
      } finally {
        sql('revoke usage on schema extensions from public');
      }
      assert.equal(sql(pruefung).split('\n').length, 4);
    });

    test('Direkter Zugriff, Sync-Funktionen und Anlegen: alles verboten', { skip: ohne }, () => {
      for (const befehl of [
        'select * from public.datensaetze',
        'select * from public.mitglieder',
        'select * from public.haushalte',
        'select * from auth.users',
        `insert into public.datensaetze (haushalt, sammlung, id, daten, version, stand)
           values (gen_random_uuid(), 'rezepte', 'x', '{}', 1, 1)`,
        `update public.datensaetze set geloescht = true`,
        `delete from public.datensaetze`,
        `select public.hochladen('[]')`,
        `select public.herunterladen(0)`,
        `select intern.hochladen('[]')`,
        `select intern.mein_haushalt()`,
        `select intern.connector_haushalt()`,
        `select public.ping()`,
        `select nextval('public.datensaetze_stand')`,
        'create table public.eigen (id int)',
        'create function public.eigen() returns int language sql as $$ select 1 $$',
        'create schema eigen',
        'create table connector.eigen (id int)',
        'select * from extensions.pg_stat_statements',
        'select * from extensions.pg_stat_statements_info',
        `select extensions.crypt('a', extensions.gen_salt('bf'))`,
        'select extensions.uuid_generate_v4()',
      ]) assert.match(fehler(() => connector(befehl)), /permission denied/, befehl);
    });

    test('Handys und anonym kommen nicht an die Connector-Funktionen', { skip: ohne }, () => {
      for (const konto of [A, null]) {
        assert.match(fehler(() => als(konto, `select connector.zutaten_liste()`)), /permission denied/);
        assert.match(fehler(() => als(konto, `select connector.rezept_speichern('{}')`)), /permission denied/);
        assert.match(fehler(() => als(konto, `select intern.connector_pruefe_rezept('{}')`)), /permission denied/);
      }
    });

    test('Anlegen: neues Rezept samt neuen Zutaten kommt auf beiden Handys an', { skip: ohne }, () => {
      const { stand } = runter(A, 0, 1000);
      const e = speichern({
        zutaten: [{ id: 'kokosmilch', name: 'Kokosmilch', art: 'vorrat' }],
        rezepte: [{ daten: rezept('Linsen-Dal') }],
      });
      assert.deepEqual(e.zutaten, [{ id: 'kokosmilch', ok: true, neu: true }]);
      const [r] = e.rezepte;
      assert.equal(r.ok, true);
      assert.equal(r.version, 1);
      assert.match(r.id, /^[0-9a-f-]{36}$/);

      const neu = runter(B, stand).datensaetze;
      const d = neu.find((x) => x.id === r.id);
      assert.equal(d.sammlung, 'rezepte');
      assert.equal(d.geloescht, false);
      assert.equal(d.daten.id, r.id);
      assert.equal(d.daten.name, 'Linsen-Dal');
      assert.equal(d.daten.quelle, 'claude');
      assert.ok(Number.isSafeInteger(d.daten.erstellt) && d.daten.erstellt === d.daten.geaendert);
      assert.deepEqual(neu.find((x) => x.id === 'kokosmilch').daten,
        { id: 'kokosmilch', name: 'Kokosmilch', art: 'vorrat', erstellt: d.daten.erstellt, geaendert: d.daten.erstellt, geloescht: false });
      assert.equal(sql(`select count(*) from public.datensaetze where id = '${r.id}' and geaendert_von is null
        and haushalt = (select id from public.haushalte where name = 'Zuhause')`), '1');
    });

    test('Vorhandene Zutaten bleiben unverändert', { skip: ohne }, () => {
      hoch(A, [{ sammlung: 'zutaten', id: 'ingwer', daten: { id: 'ingwer', name: 'Ingwer', art: 'gemuese' }, geloescht: false, basis: 0 }]);
      const e = speichern({ zutaten: [{ id: 'ingwer', name: 'INGWER!', art: 'sonstiges' }] });
      assert.deepEqual(e.zutaten, [{ id: 'ingwer', ok: true, neu: false }]);
      const d = runter(A, 0, 1000).datensaetze.find((x) => x.id === 'ingwer');
      assert.deepEqual([d.version, d.daten.name, d.daten.art], [1, 'Ingwer', 'gemuese']);
    });

    test('Wiederholung mit gleicher id und gleichem Inhalt: kein Doppel, keine neue Version', { skip: ohne }, () => {
      const id = '11111111-1111-4111-8111-111111111111';
      assert.equal(speichern({ rezepte: [{ id, basis: 0, daten: rezept('Pho') }] }).rezepte[0].version, 1);
      const nochmal = speichern({ rezepte: [{ id, basis: 0, daten: rezept('Pho') }] }).rezepte[0];
      assert.deepEqual(nochmal, { id, ok: true, version: 1 });
      assert.equal(finden('Pho').length, 1);
    });

    test('Aktualisieren mit passender Version; erstellt bleibt', { skip: ohne }, () => {
      const { id } = speichern({ rezepte: [{ daten: rezept('Chili') }] }).rezepte[0];
      const erstellt = lesen(id).daten.erstellt;
      assert.equal(erstellt, undefined); // Verwaltungsfelder gibt rezept_lesen nicht heraus
      const e = speichern({ rezepte: [{ id, basis: 1, daten: { ...rezept('Chili'), notiz: 'weniger Salz' } }] }).rezepte[0];
      assert.deepEqual(e, { id, ok: true, version: 2 });
      const l = lesen(id);
      assert.equal(l.version, 2);
      assert.equal(l.daten.notiz, 'weniger Salz');
      const d = runter(A, 0, 1000).datensaetze.find((x) => x.id === id);
      assert.ok(d.daten.erstellt <= d.daten.geaendert);
    });

    test('Veraltete Version: Original bleibt, Claudes Fassung wird Kopie mit Vermerk (nie überschreiben)', { skip: ohne }, () => {
      const { id } = speichern({ rezepte: [{ daten: rezept('Gulasch') }] }).rezepte[0];
      // Handy ändert inzwischen (Version 2)
      const server = runter(A, 0, 1000).datensaetze.find((x) => x.id === id);
      hoch(A, [{ sammlung: 'rezepte', id, daten: { ...server.daten, notiz: 'vom Handy' }, geloescht: false, basis: 1 }]);

      const e = speichern({ rezepte: [{ id, basis: 1, daten: { ...rezept('Gulasch'), notiz: 'von Claude' } }] }).rezepte[0];
      assert.equal(e.ok, false);
      assert.equal(e.version, 1);
      assert.notEqual(e.kopie, id);
      assert.equal(lesen(id).daten.notiz, 'vom Handy');
      assert.equal(lesen(id).version, 2);

      const kopie = runter(A, 0, 1000).datensaetze.find((x) => x.id === e.kopie);
      assert.match(kopie.daten.name, /^Gulasch \(Änderung vom \d{1,2}\.\d{1,2}\.\)$/);
      assert.equal(kopie.daten.notiz, 'von Claude');
      assert.equal(kopie.daten.konflikt.von, id);
      assert.ok(Number.isSafeInteger(kopie.daten.konflikt.am));

      // Wiederholung: dieselbe Kopie, keine zweite
      const nochmal = speichern({ rezepte: [{ id, basis: 1, daten: { ...rezept('Gulasch'), notiz: 'von Claude' } }] }).rezepte[0];
      assert.equal(nochmal.kopie, e.kopie);
      assert.equal(finden('Gulasch').length, 2);
      // Veraltete Version, aber gleicher Inhalt wie auf dem Server: kein Konflikt
      const gleich = speichern({ rezepte: [{ id, basis: 1, daten: { ...rezept('Gulasch'), notiz: 'vom Handy' } }] }).rezepte[0];
      assert.deepEqual(gleich, { id, ok: true, version: 2 });
    });

    test('Ändern gewinnt gegen Löschen: gelöschtes Rezept kommt zurück', { skip: ohne }, () => {
      const { id } = speichern({ rezepte: [{ daten: rezept('Ramen') }] }).rezepte[0];
      hoch(A, [{ sammlung: 'rezepte', id, daten: { id }, geloescht: true, basis: 1 }]);
      assert.equal(lesen(id), null);
      assert.equal(finden('Ramen').length, 0);
      const e = speichern({ rezepte: [{ id, basis: 1, daten: rezept('Ramen') }] }).rezepte[0];
      assert.deepEqual(e, { id, ok: true, version: 3 });
      assert.equal(runter(A, 0, 1000).datensaetze.find((x) => x.id === id).geloescht, false);
    });

    test('Kann nichts löschen und keine anderen Sammlungen anfassen', { skip: ohne }, () => {
      hoch(A, [vorlage('77777777-7777-4777-8777-777777777777', 'Teigvorlage')]);
      const e = speichern({ rezepte: [
        { id: '77777777-7777-4777-8777-777777777777', basis: 1, daten: rezept('Überschreibt Vorlage?') },
        { daten: { ...rezept('Weg'), geloescht: true } },
        { daten: rezept('Weg'), geloescht: true },
        { daten: rezept('Andere'), sammlung: 'teigvorlagen' },
      ] }).rezepte;
      // Gleiche id in einer anderen Sammlung = eigener Datensatz; die Vorlage bleibt
      assert.equal(e[0].ok, true);
      const vorlageDanach = runter(A, 0, 1000).datensaetze.find((x) => x.sammlung === 'vorlagen' && x.id === '77777777-7777-4777-8777-777777777777');
      assert.deepEqual([vorlageDanach.version, vorlageDanach.daten.name], [1, 'Teigvorlage']);
      assert.deepEqual(e.slice(1).map((x) => x.fehler), ['ungueltig', 'ungueltig', 'ungueltig']);
      assert.equal(sql(`select count(*) from public.datensaetze where geloescht and geaendert_von is null`), '0');
      // ohne Konto geschrieben: nur Rezepte und Zutaten (v-c stammt vom gelöschten Konto weiter oben)
      assert.equal(sql(`select string_agg(distinct sammlung, ',') from public.datensaetze
        where geaendert_von is null and id <> 'v-c'`), 'rezepte,zutaten');
    });

    test('Liest nur Rezepte und Zutaten des eigenen Haushalts', { skip: ohne }, () => {
      hoch(F, [{ sammlung: 'rezepte', id: '22222222-2222-4222-8222-222222222222',
        daten: { ...rezept('Fremdes Curry'), id: '22222222-2222-4222-8222-222222222222' }, geloescht: false, basis: 0 }]);
      hoch(F, [{ sammlung: 'zutaten', id: 'fremdzutat', daten: { id: 'fremdzutat', name: 'Fremdzutat' }, geloescht: false, basis: 0 }]);
      hoch(A, [vorlage('v-curry', 'Curry-Vorlage'), { sammlung: 'mehle', id: 'curry', daten: { id: 'curry', name: 'Curry-Mehl' }, geloescht: false, basis: 0 }]);

      assert.equal(finden('Curry').length, 0);
      assert.equal(lesen('22222222-2222-4222-8222-222222222222'), null);
      assert.equal(lesen('v-curry'), null);
      const namen = json(connector('select connector.zutaten_liste()')).map((z) => z.name);
      assert.ok(namen.includes('Kokosmilch') && namen.includes('Ingwer'));
      assert.ok(!namen.includes('Fremdzutat') && !namen.includes('Curry-Mehl'));
    });

    test('Finden: Teilwort ohne Groß/klein, genaue id, leer = alle; Sonderzeichen wörtlich', { skip: ohne }, () => {
      const { id } = speichern({ rezepte: [{ daten: rezept('Pasta 100% Vollkorn') }] }).rezepte[0];
      assert.deepEqual(finden('VOLLKORN').map((r) => r.id), [id]);
      assert.deepEqual(finden(id).map((r) => r.name), ['Pasta 100% Vollkorn']);
      assert.deepEqual(finden('0%').map((r) => r.id), [id]);
      assert.equal(finden('_').length, 0);
      const r = finden('vollkorn')[0];
      assert.deepEqual(Object.keys(r).sort(), ['art', 'id', 'kategorie', 'name', 'version']);
      assert.ok(json(connector(`select connector.rezepte_finden('')`)).length >= 5);
      assert.ok(json(connector(`select connector.rezepte_finden()`)).length >= 5);
    });

    test('Unbrauchbare Rezepte werden einzeln abgewiesen, mit Grund', { skip: ohne }, () => {
      const k = rezept('K');
      const gruende = speichern({ rezepte: [
        'kein Objekt',
        { daten: k, extra: 1 },
        { id: 'keine-uuid', daten: k },
        { id: '33333333-3333-4333-8333-33333333333A', daten: k },
        { basis: -1, daten: k },
        { basis: 1.5, daten: k },
        { daten: [] },
        { daten: { ...k, unbekannt: 1 } },
        { daten: { ...k, art: 'grillen' } },
        { daten: { ...k, name: '   ' } },
        { daten: { ...k, name: 'x'.repeat(81) } },
        { daten: { ...k, portionen: undefined } },
        { daten: { ...k, portionen: 0 } },
        { daten: { ...k, portionen: '4' } },
        { daten: { ...k, quelle: 'hand' } },
        { daten: { ...k, quelle: undefined } },
        { daten: { ...k, status: 'lecker' } },
        { daten: { ...k, notiz: 'x'.repeat(2001) } },
        { daten: { ...k, kategorie: 'Pasta!' } },
        { daten: { ...k, zutaten: [{ zutat: 'a b', menge: 1 }] } },
        { daten: { ...k, zutaten: [{ zutat: 'salz', menge: -1 }] } },
        { daten: { ...k, zutaten: [{ zutat: 'salz', name: 'Salz' }] } },
        { daten: { ...k, zutaten: [{ zutat: 'salz', regel: 'quadratisch' }] } },
        { daten: { ...k, zutaten: Array.from({ length: 81 }, () => ({ zutat: 'salz' })) } },
        { daten: { ...k, schritte: ['ok', 3] } },
        { daten: { ...k, schritte: [''] } },
        { daten: { ...k, schrittzutaten: [[]] } },
        { daten: { ...k, schrittzutaten: [[{ zutat: 'pfeffer' }], []] } },
        { daten: { ...k, schrittzutaten: [[{ zutat: 'linsen' }, { zutat: 'linsen' }], []] } },
        { daten: { ...k, schrittzutaten: [[{ zutat: 'linsen', menge: 0 }], []] } },
        { daten: { ...k, schrittgeraete: ['Wok'] } },
        { daten: { ...k, schrittgeraete: ['Wok', 3] } },
        { daten: { ...k, schrittgeraete: ['Wok', 'x'.repeat(41)] } },
        { daten: { ...k, schrittgeraete: 'Wok' } },
        { daten: { ...k, teig: {} } },
        { daten: { ...k, art: 'backen', portionen: undefined } },
        { daten: { ...k, notiz: 'x'.repeat(99_000), schritte: ['ä'.repeat(500), 'b'] } },
      ] }).rezepte;
      assert.ok(gruende.every((x) => x.ok === false && x.fehler === 'ungueltig'), JSON.stringify(gruende));
      assert.deepEqual(gruende.map((x) => x.grund), [
        'eintrag', 'eintrag', 'id', 'id', 'basis', 'basis', 'daten', 'unbekanntes Feld unbekannt', 'art', 'name', 'name',
        'portionen', 'portionen', 'portionen', 'quelle', 'quelle', 'status', 'notiz', 'kategorie',
        'zutaten', 'zutaten', 'zutaten', 'zutaten', 'zutaten', 'schritte', 'schritte',
        'schrittzutaten', 'schrittzutaten', 'schrittzutaten', 'schrittzutaten',
        'schrittgeraete', 'schrittgeraete', 'schrittgeraete', 'schrittgeraete', 'teig', 'teig', 'zu groß',
      ]);
      assert.equal(finden('K').filter((r) => r.name === 'K').length, 0);
    });

    test('Gültige Varianten: Teilmengen je Schritt, Back-Rezept, nach Geschmack', { skip: ohne }, () => {
      const e = speichern({ rezepte: [
        { daten: { ...rezept('Brühe'), schrittzutaten: [[{ zutat: 'linsen', menge: 100 }], [{ zutat: 'linsen' }]] } },
        { daten: { ...rezept('Mit Geräten'), schrittgeraete: ['Wok', ''] } },
        { daten: { ...rezept('Ohne Zuordnung'), schrittzutaten: null, zutaten: [{ zutat: 'salz', menge: null, einheit: '', regel: 'fix' }] } },
        { daten: { art: 'backen', name: 'Pizza', quelle: 'import', status: 'testen', teig: { mehle: [] }, mehl: 500,
          modus: 'teiglinge', teiglinge: { anzahl: 4, gewicht: 250 }, zutaten: [], schritte: [] } },
      ] }).rezepte;
      assert.deepEqual(e.map((x) => x.ok), [true, true, true, true]);
    });

    test('Zu viel auf einmal und falsche Form werden ganz abgelehnt', { skip: ohne }, () => {
      assert.match(fehler(() => speichern({ rezepte: Array.from({ length: 51 }, (_, i) => ({ daten: rezept(`R${i}`) })) })), /Höchstens 50/);
      assert.match(fehler(() => speichern({ zutaten: Array.from({ length: 201 }, (_, i) => ({ id: `z${i}`, name: `Z${i}` })) })), /Höchstens 50/);
      assert.match(fehler(() => speichern([])), /Erwartet/);
      assert.match(fehler(() => speichern({ rezepte: {} })), /Erwartet/);
      const z = speichern({ zutaten: [{ id: 'Groß', name: 'Groß' }, { id: 'ok', name: ' ' }, { id: 'ok', name: 'Ok', art: 'stein' }, { id: 'ok', name: 'Ok', x: 1 }] }).zutaten;
      assert.deepEqual(z.map((x) => x.grund), ['id', 'name', 'art', 'zutat']);
    });

    test('Ohne freigegebenen Haushalt geht nichts; höchstens ein Haushalt freigegeben', { skip: ohne }, () => {
      sql(`update public.haushalte set connector = false`);
      try {
        assert.match(fehler(() => connector('select connector.zutaten_liste()')), /Kein Haushalt/);
        assert.match(fehler(() => speichern({ rezepte: [{ daten: rezept('Nirgends') }] })), /Kein Haushalt/);
        assert.match(fehler(() => sql(`update public.haushalte set connector = true`)), /haushalte_ein_connector/);
      } finally {
        sql(`update public.haushalte set connector = (name = 'Zuhause')`);
      }
      // Ein Handy kann die Freigabe nicht setzen
      assert.match(fehler(() => als(F, `update public.haushalte set connector = true`)), /permission denied/);
    });

    test('Erneutes Ausführen des Skripts lässt Anmeldung und Freigabe stehen', { skip: ohne }, () => {
      sql(`alter role kochbuch_connector login`);
      try {
        sql(schema);
        assert.equal(sql(`select rolcanlogin from pg_roles where rolname = 'kochbuch_connector'`), 't');
        assert.equal(sql(`select name from public.haushalte where connector`), 'Zuhause');
        assert.equal(sql(`select rolconnlimit, array_to_string(rolconfig, ',') from pg_roles where rolname = 'kochbuch_connector'`),
          '3|statement_timeout=10s');
      } finally {
        sql(`alter role kochbuch_connector nologin`);
      }
    });

    // ---------- Edge Function (Schritt 8) gegen diese Datenbank ----------

    test('Edge Function: anlegen, finden, aktualisieren, Konflikt – App übernimmt alles unverändert', { skip: ohne }, async () => {
      const textWert = (s) => `'${String(s).replaceAll("'", "''")}'`;
      const datenbank = {
        zutatenListe: async () => json(connector('select connector.zutaten_liste()')),
        rezepteFinden: async (s) => json(connector(`select connector.rezepte_finden(${textWert(s)})`)),
        rezeptLesen: async (id) => lesen(id.replaceAll("'", '')),
        rezeptSpeichern: async (e) => speichern(e),
      };
      let nr = 0;
      const rufe = async (name, args) => {
        const a = await bearbeite(new Request('https://x.invalid/functions/v1/kochbuch', {
          method: 'POST', headers: { authorization: `Bearer ${'k'.repeat(40)}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++nr, method: 'tools/call', params: { name, arguments: args } }),
        }), { schluessel: 'k'.repeat(40), db: datenbank });
        const { result } = await a.json();
        assert.equal(result.isError, undefined, result.content[0].text);
        return JSON.parse(result.content[0].text);
      };
      const zeile = (id) => runter(A, 0, 5000).datensaetze.find((x) => x.sammlung === 'rezepte' && x.id === id);
      /** So sieht die App das Rezept (bereinigeRezept); muss dem Gespeicherten genau entsprechen. */
      const wieApp = (d) => {
        const { erstellt, geaendert, geloescht, ...inhalt } = d;
        assert.deepEqual(bereinigeRezept(inhalt), inhalt);
      };

      const roh = {
        name: 'Edge-Curry', kategorie: 'Currys & Dal', portionen: 2,
        zutaten: [{ name: 'Kichererbsen', menge: 240, einheit: 'g', art: 'vorrat' }, { name: 'Ingwer', menge: 1, einheit: 'TL' },
          { name: "Chili's", menge: null, regel: 'fix' }],
        schritte: ['Kichererbsen abgießen.', 'Mit Ingwer und Chili anbraten.'],
        schrittzutaten: [[{ name: 'Kichererbsen' }], [{ name: 'Ingwer' }, { name: "Chili's" }]],
      };
      const [neu] = (await rufe('rezept_anlegen', { rezepte: [roh] })).rezepte;
      assert.deepEqual([neu.gespeichert, neu.version], [true, 1]);
      wieApp(zeile(neu.id).daten);
      assert.equal(zeile(neu.id).daten.zutaten[2].zutat, 'chilis');
      assert.ok((await rufe('zutaten_liste', {})).zutaten.includes('Kichererbsen'));

      // Gleicher Name noch einmal: nicht angelegt
      assert.match((await rufe('rezept_anlegen', { rezepte: [roh] })).rezepte[0].fehler[0], /Gibt es schon/);
      assert.equal(finden('Edge-Curry').length, 1);

      // Lesen → unverändert zurückschicken = nichts geschrieben (gleiche Version)
      const { id, version, ...gelesen } = await rufe('rezepte_finden', { id: neu.id });
      assert.equal(version, 1);
      assert.equal((await rufe('rezept_aktualisieren', { id, version, ...gelesen })).version, 1);

      // Ändern mit passender Version
      const n = await rufe('rezept_aktualisieren', { id, version: 1, notiz: 'Mit Limette.', portionen: 3 });
      assert.deepEqual([n.gespeichert, n.version], [true, 2]);
      wieApp(zeile(id).daten);
      assert.equal(zeile(id).daten.notiz, 'Mit Limette.');

      // Handy ändert dazwischen → Claudes Änderung auf alter Version wird Kopie, Original bleibt
      const handy = zeile(id);
      hoch(A, [{ sammlung: 'rezepte', id, daten: { ...handy.daten, notiz: 'Vom Handy.' }, geloescht: false, basis: 2 }]);
      const k = await rufe('rezept_aktualisieren', { id, version: 2, notiz: 'Von Claude.' });
      assert.equal(k.gespeichert, false);
      assert.equal(zeile(id).daten.notiz, 'Vom Handy.');
      const kopie = zeile(k.kopie).daten;
      assert.deepEqual([kopie.notiz, kopie.konflikt.von], ['Von Claude.', id]);
      assert.match(kopie.name, /^Edge-Curry \(Änderung vom \d+\.\d+\.\)$/);
      const { konflikt, ...ohneVermerk } = kopie;
      wieApp(ohneVermerk);
    });
  });

  if (modus === 'streng') test('Automatische RLS: nicht von außen ausführbar, wirkt aber weiter', { skip: ohne }, () => {
    for (const rolle of ['anon', 'authenticated']) {
      assert.equal(sql(`select has_function_privilege('${rolle}', 'public.rls_auto_enable()', 'execute')`), 'f', rolle);
    }
    // Neue Tabelle von einer Rolle ohne Ausführungsrecht (wie im Dashboard, kein Superuser)
    sql(`create role tabellenbauer nologin; grant create, usage on schema public to tabellenbauer`);
    assert.equal(sql(`select has_function_privilege('tabellenbauer', 'public.rls_auto_enable()', 'execute')`), 'f');
    sql(`set role tabellenbauer; create table public.probe (id int)`);
    assert.equal(sql(`select relrowsecurity from pg_class where oid = 'public.probe'::regclass`), 't');
  });
});
