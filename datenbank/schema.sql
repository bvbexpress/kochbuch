-- schema.sql – Datenbank für den Abgleich zwischen den Handys (Supabase / PostgreSQL).
--
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen. Mehrfaches Ausführen schadet nicht.
-- Enthält KEINE persönlichen Daten. Haushalt und Mitglieder werden getrennt per Zusatz-SQL
-- angelegt (enthält E-Mail-Adressen – gehört nie ins Repo).
--
-- Aufbau:
--   haushalte    – ein Haushalt (bei uns genau einer)
--   mitglieder   – welches Konto zu welchem Haushalt gehört; pflegt nur der Verwalter im Dashboard
--   datensaetze  – alle synchronisierten Daten (Vorlagen, Mehle, … – je Bereich eine `sammlung`)
--
-- Zugriff:
--   Lesen nur für angemeldete Mitglieder, nur der eigene Haushalt (Row Level Security).
--   Schreiben nur über die Funktion `hochladen` – sie schreibt nur, wenn die Server-Version
--   noch die ist, auf der die Änderung beruht. Sonst meldet sie den Konflikt mit dem Server-Stand.
--   Herunterladen über `herunterladen(seit)`: alles mit `stand` > seit; merkt den letzten Abgleich.
--   `ping` (ohne Anmeldung) hält das Projekt wach.
--   Connector (Claude): eigene Rolle `kochbuch_connector`, nur Funktionen im Schema `connector` (ganz unten).
--
-- Die eigentliche Arbeit machen Funktionen im Schema `intern`, das von außen nicht erreichbar ist.
-- In `public` stehen nur dünne Hüllen, die mit den Rechten des Aufrufers laufen.

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.haushalte (
  id      uuid primary key default gen_random_uuid(),
  name    text not null check (char_length(name) between 1 and 100)
);

create table if not exists public.mitglieder (
  konto             uuid primary key references auth.users (id) on delete cascade,
  haushalt          uuid not null references public.haushalte (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 50),  -- z. B. „Handy 2“
  letzter_abgleich  timestamptz                                                 -- setzt `herunterladen`
);

create index if not exists mitglieder_haushalt on public.mitglieder (haushalt);

-- Fortlaufende Nummer jeder Änderung („alles seit stand“)
create sequence if not exists public.datensaetze_stand;

create table if not exists public.datensaetze (
  haushalt       uuid not null references public.haushalte (id) on delete cascade,
  sammlung       text not null check (sammlung ~ '^[a-z][a-z0-9_]{0,39}$'),
  id             text not null check (char_length(id) between 1 and 100),
  daten          jsonb not null check (jsonb_typeof(daten) = 'object'),
  geloescht      boolean not null default false,
  version        integer not null check (version > 0),
  stand          bigint not null,
  geaendert_von  uuid references auth.users (id) on delete set null,
  geaendert_am   timestamptz not null default now(),
  primary key (haushalt, sammlung, id)
);

create unique index if not exists datensaetze_haushalt_stand on public.datensaetze (haushalt, stand);

-- ---------------------------------------------------------------------------
-- Rechte: erst alles weg, dann nur das Nötige
-- ---------------------------------------------------------------------------
-- Alle Freigaben stehen hier ausdrücklich. Das Skript verlässt sich nicht auf Grundeinstellungen
-- des Projekts (z. B. „Automatically expose new tables“ aus/an, „Enable automatic RLS“).

grant usage on schema public to anon, authenticated;

-- „Enable automatic RLS“ legt public.rls_auto_enable() an, für alle ausführbar (Security Advisor warnt).
-- Sie wird nur als Event-Trigger gebraucht, der auch ohne dieses Recht weiter auslöst.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

alter table public.haushalte   enable row level security;
alter table public.mitglieder  enable row level security;
alter table public.datensaetze enable row level security;

revoke all on public.haushalte, public.mitglieder, public.datensaetze from public, anon, authenticated;
revoke all on sequence public.datensaetze_stand from public, anon, authenticated;
grant select on public.haushalte, public.mitglieder, public.datensaetze to authenticated;

create schema if not exists intern;
revoke all on schema intern from public, anon;
grant usage on schema intern to authenticated;

-- Haushalt des angemeldeten Kontos (oder null)
create or replace function intern.mein_haushalt()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.haushalt from public.mitglieder m where m.konto = (select auth.uid());
$$;

revoke all on function intern.mein_haushalt() from public, anon;
grant execute on function intern.mein_haushalt() to authenticated;

drop policy if exists "eigener Haushalt" on public.haushalte;
create policy "eigener Haushalt" on public.haushalte
  for select to authenticated using (id = (select intern.mein_haushalt()));

drop policy if exists "eigener Haushalt" on public.mitglieder;
create policy "eigener Haushalt" on public.mitglieder
  for select to authenticated using (haushalt = (select intern.mein_haushalt()));

drop policy if exists "eigener Haushalt" on public.datensaetze;
create policy "eigener Haushalt" on public.datensaetze
  for select to authenticated using (haushalt = (select intern.mein_haushalt()));

-- ---------------------------------------------------------------------------
-- Hochladen
-- ---------------------------------------------------------------------------
-- Eingabe: Liste von { sammlung, id, daten, geloescht, basis }
--   basis = Server-Version, auf der die Änderung beruht (0 = neu)
-- Ergebnis: Liste in gleicher Reihenfolge, je Eintrag
--   { sammlung, id, ok: true,  version }                       – gespeichert
--   { sammlung, id, ok: false, version, daten, geloescht }      – Konflikt: so steht es auf dem Server
--                                                                 (version 0, daten null = gibt es dort nicht)
--   { sammlung, id, ok: false, fehler: 'ungueltig' }           – unbrauchbarer Eintrag, wird nie gespeichert

create or replace function intern.hochladen(aenderungen jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_konto     uuid := auth.uid();
  v_haushalt  uuid;
  v_eintrag   jsonb;
  v_sammlung  text;
  v_id        text;
  v_basis     integer;
  v_alt       public.datensaetze%rowtype;
  v_ergebnis  jsonb := '[]'::jsonb;
begin
  select m.haushalt into v_haushalt from public.mitglieder m where m.konto = v_konto;
  if v_haushalt is null then
    raise exception 'Kein Mitglied eines Haushalts' using errcode = '42501';
  end if;
  if jsonb_typeof(aenderungen) is distinct from 'array' or jsonb_array_length(aenderungen) > 200 then
    raise exception 'Erwartet: Liste mit höchstens 200 Änderungen' using errcode = '22023';
  end if;

  -- Schreiben je Haushalt nacheinander: so steigt `stand` in der Reihenfolge, in der Änderungen
  -- sichtbar werden, und „alles seit stand“ verpasst nie etwas.
  perform pg_advisory_xact_lock(hashtextextended(v_haushalt::text, 0));

  for v_eintrag in select e from jsonb_array_elements(aenderungen) as e loop
    v_sammlung := v_eintrag->>'sammlung';
    v_id := v_eintrag->>'id';

    if jsonb_typeof(v_eintrag) is distinct from 'object'
      or jsonb_typeof(v_eintrag->'sammlung') is distinct from 'string'
      or v_sammlung !~ '^[a-z][a-z0-9_]{0,39}$'
      or jsonb_typeof(v_eintrag->'id') is distinct from 'string'
      or char_length(v_id) not between 1 and 100
      or jsonb_typeof(v_eintrag->'daten') is distinct from 'object'
      or octet_length((v_eintrag->'daten')::text) > 100000
      or jsonb_typeof(v_eintrag->'geloescht') is distinct from 'boolean'
      or jsonb_typeof(v_eintrag->'basis') is distinct from 'number'
      or (v_eintrag->>'basis') !~ '^[0-9]{1,9}$'
    then
      v_ergebnis := v_ergebnis || jsonb_build_array(jsonb_build_object(
        'sammlung', v_eintrag->'sammlung', 'id', v_eintrag->'id', 'ok', false, 'fehler', 'ungueltig'));
      continue;
    end if;
    v_basis := (v_eintrag->>'basis')::integer;

    select d.* into v_alt from public.datensaetze d
      where d.haushalt = v_haushalt and d.sammlung = v_sammlung and d.id = v_id
      for update;

    if coalesce(v_alt.version, 0) <> v_basis then
      v_ergebnis := v_ergebnis || jsonb_build_array(jsonb_build_object(
        'sammlung', v_sammlung, 'id', v_id, 'ok', false,
        'version', coalesce(v_alt.version, 0), 'daten', v_alt.daten, 'geloescht', v_alt.geloescht));
      continue;
    end if;

    insert into public.datensaetze as d (haushalt, sammlung, id, daten, geloescht, version, stand, geaendert_von)
    values (v_haushalt, v_sammlung, v_id, v_eintrag->'daten', (v_eintrag->>'geloescht')::boolean,
            v_basis + 1, nextval('public.datensaetze_stand'), v_konto)
    on conflict (haushalt, sammlung, id) do update set
      daten = excluded.daten,
      geloescht = excluded.geloescht,
      version = excluded.version,
      stand = excluded.stand,
      geaendert_von = excluded.geaendert_von,
      geaendert_am = now();

    v_ergebnis := v_ergebnis || jsonb_build_array(jsonb_build_object(
      'sammlung', v_sammlung, 'id', v_id, 'ok', true, 'version', v_basis + 1));
  end loop;

  return v_ergebnis;
end;
$$;

-- ---------------------------------------------------------------------------
-- Herunterladen
-- ---------------------------------------------------------------------------
-- Ergebnis: { datensaetze: [{ sammlung, id, daten, geloescht, version, stand }], stand, mehr }
--   stand – höchster gelieferter Stand (beim nächsten Mal als `seit` mitgeben)
--   mehr  – true: es kann noch mehr geben, gleich noch einmal abrufen
-- Merkt sich nebenbei den letzten Abgleich des Kontos (für die Anzeige auf dem Verwalter-Handy).

create or replace function intern.herunterladen(seit bigint, anzahl integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_konto     uuid := auth.uid();
  v_haushalt  uuid;
  v_grenze    integer := least(greatest(coalesce(anzahl, 500), 1), 1000);
  v_zeilen    jsonb;
begin
  select m.haushalt into v_haushalt from public.mitglieder m where m.konto = v_konto;
  if v_haushalt is null then
    raise exception 'Kein Mitglied eines Haushalts' using errcode = '42501';
  end if;

  update public.mitglieder set letzter_abgleich = now() where konto = v_konto;

  select coalesce(jsonb_agg(to_jsonb(z) order by z.stand), '[]'::jsonb) into v_zeilen
  from (
    select d.sammlung, d.id, d.daten, d.geloescht, d.version, d.stand
    from public.datensaetze d
    where d.haushalt = v_haushalt and d.stand > coalesce(seit, 0)
    order by d.stand
    limit v_grenze
  ) z;

  return jsonb_build_object(
    'datensaetze', v_zeilen,
    'stand', coalesce((v_zeilen->-1->>'stand')::bigint, greatest(coalesce(seit, 0), 0)),
    'mehr', jsonb_array_length(v_zeilen) = v_grenze
  );
end;
$$;

revoke all on function intern.hochladen(jsonb) from public, anon;
revoke all on function intern.herunterladen(bigint, integer) from public, anon;
grant execute on function intern.hochladen(jsonb) to authenticated;
grant execute on function intern.herunterladen(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Von außen aufrufbar (/rest/v1/rpc/…)
-- ---------------------------------------------------------------------------

create or replace function public.hochladen(aenderungen jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select intern.hochladen(aenderungen); $$;

create or replace function public.herunterladen(seit bigint, anzahl integer default 500)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select intern.herunterladen(seit, anzahl); $$;

-- Lebenszeichen gegen das Pausieren (GitHub Action, ohne Anmeldung). Liest keine Daten.
create or replace function public.ping()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select 'ok'::text; $$;

revoke all on function public.hochladen(jsonb) from public, anon;
revoke all on function public.herunterladen(bigint, integer) from public, anon;
revoke all on function public.ping() from public;
grant execute on function public.hochladen(jsonb) to authenticated;
grant execute on function public.herunterladen(bigint, integer) to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- ===========================================================================
-- Connector „Rezepte direkt aus Claude“ (Etappe 3)
-- ===========================================================================
-- Die Edge Function des Connectors meldet sich als eigene Datenbank-Rolle `kochbuch_connector` an
-- (nicht `service_role`, nicht über PostgREST). Diese Rolle darf GENAU vier Funktionen im Schema
-- `connector` ausführen und sonst nichts: keine Tabelle lesen oder schreiben, keine andere Funktion.
--
--   zutaten_liste()           – Zutatenkatalog des Haushalts: [{ id, name }]
--   rezepte_finden(suche)     – Rezepte nach Name (Teilwort) oder id: [{ id, name, art, kategorie, ernaehrung, version }]
--   rezept_lesen(id)          – ein Rezept: { id, version, daten } oder null
--   rezept_speichern(eingabe) – Rezepte anlegen/aktualisieren und neue Zutaten anlegen (siehe unten)
--
-- Nur Sammlungen `rezepte` und `zutaten`, nie Löschen, nie ein anderer Haushalt. Schreibt nur in den
-- Haushalt mit `haushalte.connector = true` (der Verwalter setzt das einmal, höchstens einer).
-- `geaendert_von` bleibt leer (= vom Connector); im Rezept steht `quelle` ('claude' | 'import').
--
-- Die Rolle wird ohne Anmeldung angelegt (nologin). Anmeldung und Passwort setzt der Verwalter erst,
-- wenn die Edge Function da ist – das Passwort steht nie im Repo. Das Skript ändert daran später nichts.

alter table public.haushalte add column if not exists connector boolean not null default false;
create unique index if not exists haushalte_ein_connector on public.haushalte (connector) where connector;

do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'kochbuch_connector') then
    create role kochbuch_connector nologin noinherit;
  end if;
end $$;
alter role kochbuch_connector connection limit 3;
alter role kochbuch_connector set statement_timeout = '10s';

-- Niemand außer dem Besitzer legt etwas in `public` an (seit PostgreSQL 15 ohnehin Grundeinstellung).
revoke create on schema public from public;

create schema if not exists connector;
revoke all on schema connector from public, anon, authenticated;
grant usage on schema connector to kochbuch_connector;

-- Haushalt des Connectors (oder Fehler)
create or replace function intern.connector_haushalt()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_haushalt uuid;
begin
  select h.id into v_haushalt from public.haushalte h where h.connector;
  if v_haushalt is null then
    raise exception 'Kein Haushalt für den Connector freigegeben' using errcode = '42501';
  end if;
  return v_haushalt;
end;
$$;

-- Nutzdaten ohne Verwaltungsfelder (wie `inhaltVon` in js/kern/sync.js)
create or replace function intern.connector_inhalt(d jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select d - array['id', 'erstellt', 'geaendert', 'geloescht', 'konflikt', 'sync']; $$;

-- Text mit 1..max Zeichen (nicht nur Leerzeichen)?
create or replace function intern.connector_text(x jsonb, max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(x) = 'string' and btrim(x #>> '{}') <> '' and char_length(x #>> '{}') <= max, false);
$$;

-- Zahl > 0 und <= max?
create or replace function intern.connector_zahl(x jsonb, max numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(x) = 'number' and x::numeric > 0 and x::numeric <= max, false);
$$;

-- Prüft ein Rezept (Nutzdaten ohne id/Zeitstempel). Gibt den Grund zurück, oder null = in Ordnung.
-- Grenzen wie `bereinigeRezept` in js/rezepte/rezept.js. Die Edge Function bereinigt vorher;
-- hier wird nichts gekürzt, nur abgewiesen – damit nie Unsinn ein gutes Rezept ersetzt.
create or replace function intern.connector_pruefe_rezept(d jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_feld    text;
  v_backen  boolean;
  v_z       jsonb;
  v_je      jsonb;
  v_e       jsonb;
  v_ids     text[] := '{}';
  v_schritt text[];
begin
  if jsonb_typeof(d) is distinct from 'object' then return 'daten'; end if;
  if octet_length(d::text) > 100000 then return 'zu groß'; end if;
  select k into v_feld from jsonb_object_keys(d) k
    where k <> all (array['art', 'name', 'kategorie', 'portionen', 'portionsart', 'zutaten', 'schritte',
      'schrittzutaten', 'schrittgeraete', 'status', 'ernaehrung', 'auchVegetarisch', 'notiz', 'quelle',
      'teig', 'mehl', 'modus', 'teiglinge', 'schrittteig'])
    limit 1;
  if v_feld is not null then return 'unbekanntes Feld ' || v_feld; end if;

  if jsonb_typeof(d->'art') is distinct from 'string' or d->>'art' not in ('kochen', 'backen') then return 'art'; end if;
  v_backen := d->>'art' = 'backen';
  if not intern.connector_text(d->'name', 80) then return 'name'; end if;
  if d ? 'kategorie' and not (jsonb_typeof(d->'kategorie') = 'string' and d->>'kategorie' ~ '^[a-z]{1,40}$') then
    return 'kategorie';
  end if;
  if coalesce(jsonb_typeof(d->'portionen'), 'null') = 'null' then
    if not v_backen then return 'portionen'; end if;
  elsif not intern.connector_zahl(d->'portionen', 1000) then
    return 'portionen';
  end if;
  if d ? 'portionsart' and not (jsonb_typeof(d->'portionsart') = 'string'
    and d->>'portionsart' in ('personen', 'stueck', 'laibe')) then return 'portionsart'; end if;
  if d ? 'status' and not (jsonb_typeof(d->'status') = 'string' and d->>'status' in ('erprobt', 'testen')) then
    return 'status';
  end if;
  -- Was der Connector speichert, kommt von Claude: 'claude' oder (beim Import) 'import', nie 'hand'
  if jsonb_typeof(d->'quelle') is distinct from 'string' or d->>'quelle' not in ('claude', 'import') then
    return 'quelle';
  end if;
  if d ? 'notiz' and not (jsonb_typeof(d->'notiz') = 'string' and char_length(d->>'notiz') <= 2000) then
    return 'notiz';
  end if;
  -- Ernährungsform (optional); „auch vegetarisch“ nur als true und nur bei Fisch/Fleisch
  if d ? 'ernaehrung' and not (jsonb_typeof(d->'ernaehrung') = 'string'
    and d->>'ernaehrung' in ('vegan', 'vegetarisch', 'fisch', 'fleisch')) then return 'ernaehrung'; end if;
  if d ? 'auchVegetarisch' and not (d->'auchVegetarisch' = 'true'::jsonb
    and coalesce(d->>'ernaehrung', '') in ('fisch', 'fleisch')) then return 'auchVegetarisch'; end if;

  -- Zutaten
  if jsonb_typeof(coalesce(d->'zutaten', '[]')) <> 'array' or jsonb_array_length(coalesce(d->'zutaten', '[]')) > 80 then
    return 'zutaten';
  end if;
  for v_z in select z from jsonb_array_elements(coalesce(d->'zutaten', '[]')) z loop
    if jsonb_typeof(v_z) <> 'object'
      or exists (select from jsonb_object_keys(v_z) k where k not in ('zutat', 'menge', 'einheit', 'regel'))
    then return 'zutaten'; end if;
    if jsonb_typeof(v_z->'zutat') is distinct from 'string' or v_z->>'zutat' !~ '^[A-Za-z0-9_-]{1,60}$'
      or (coalesce(jsonb_typeof(v_z->'menge'), 'null') <> 'null' and not intern.connector_zahl(v_z->'menge', 100000))
      or (v_z ? 'einheit' and not (jsonb_typeof(v_z->'einheit') = 'string' and char_length(v_z->>'einheit') <= 20))
      or (v_z ? 'regel' and not (jsonb_typeof(v_z->'regel') = 'string' and v_z->>'regel' in ('linear', 'ganz', 'fix')))
    then return 'zutaten'; end if;
    v_ids := v_ids || (v_z->>'zutat');
  end loop;

  -- Schritte und Zutaten je Schritt
  if jsonb_typeof(coalesce(d->'schritte', '[]')) <> 'array' or jsonb_array_length(coalesce(d->'schritte', '[]')) > 60
    or exists (select from jsonb_array_elements(coalesce(d->'schritte', '[]')) s where not intern.connector_text(s, 500))
  then return 'schritte'; end if;
  if coalesce(jsonb_typeof(d->'schrittzutaten'), 'null') <> 'null' then
    if jsonb_typeof(d->'schrittzutaten') <> 'array'
      or jsonb_array_length(d->'schrittzutaten') <> jsonb_array_length(coalesce(d->'schritte', '[]'))
    then return 'schrittzutaten'; end if;
    for v_je in select j from jsonb_array_elements(d->'schrittzutaten') j loop
      if jsonb_typeof(v_je) <> 'array' or jsonb_array_length(v_je) > 20 then return 'schrittzutaten'; end if;
      v_schritt := '{}';
      for v_e in select e from jsonb_array_elements(v_je) e loop
        if jsonb_typeof(v_e) <> 'object'
          or exists (select from jsonb_object_keys(v_e) k where k not in ('zutat', 'menge'))
        then return 'schrittzutaten'; end if;
        if jsonb_typeof(v_e->'zutat') is distinct from 'string'
          or not ((v_e->>'zutat') = any (v_ids))           -- nur Zutaten des Rezepts
          or (v_e->>'zutat') = any (v_schritt)              -- jede höchstens einmal je Schritt
          or (coalesce(jsonb_typeof(v_e->'menge'), 'null') <> 'null' and not intern.connector_zahl(v_e->'menge', 100000))
        then return 'schrittzutaten'; end if;
        v_schritt := v_schritt || (v_e->>'zutat');
      end loop;
    end loop;
  end if;

  -- Gerät je Schritt (optional): gleiche Länge wie die Schritte, Texte bis 40 Zeichen, leer = kein Gerät
  if coalesce(jsonb_typeof(d->'schrittgeraete'), 'null') <> 'null' then
    if jsonb_typeof(d->'schrittgeraete') <> 'array'
      or jsonb_array_length(d->'schrittgeraete') <> jsonb_array_length(coalesce(d->'schritte', '[]'))
      or exists (select from jsonb_array_elements(d->'schrittgeraete') g
        where jsonb_typeof(g) <> 'string' or char_length(g #>> '{}') > 40)
    then return 'schrittgeraete'; end if;
  end if;

  -- Teigteile je Schritt (nur Back-Rezepte, optional): gleiche Länge wie die Schritte, je Schritt höchstens 9 Einträge
  -- { teil, anteil? } mit bekanntem Teil und anteil > 0 bis 1 (TEIG_TEILE in js/rezepte/rezept.js)
  if coalesce(jsonb_typeof(d->'schrittteig'), 'null') <> 'null' then
    if not v_backen or jsonb_typeof(d->'schrittteig') <> 'array'
      or jsonb_array_length(d->'schrittteig') <> jsonb_array_length(coalesce(d->'schritte', '[]'))
    then return 'schrittteig'; end if;
    for v_je in select j from jsonb_array_elements(d->'schrittteig') j loop
      if jsonb_typeof(v_je) <> 'array' or jsonb_array_length(v_je) > 9 then return 'schrittteig'; end if;
      for v_e in select e from jsonb_array_elements(v_je) e loop
        if jsonb_typeof(v_e) <> 'object'
          or exists (select from jsonb_object_keys(v_e) k where k not in ('teil', 'anteil'))
          or jsonb_typeof(v_e->'teil') is distinct from 'string'
          or (v_e->>'teil') not in ('mehl', 'wasser', 'starter', 'salz', 'oel', 'hefe', 'saaten', 'quellwasser', 'zusaetze')
          or (coalesce(jsonb_typeof(v_e->'anteil'), 'null') <> 'null'
              and not (jsonb_typeof(v_e->'anteil') = 'number' and (v_e->>'anteil')::numeric > 0 and (v_e->>'anteil')::numeric <= 1))
        then return 'schrittteig'; end if;
      end loop;
    end loop;
  end if;

  -- Teigwerte nur bei Back-Rezepten (Einzelheiten prüft die Edge Function streng, die App beim Laden mit `bereinigeTeig`)
  if v_backen then
    if jsonb_typeof(d->'teig') is distinct from 'object' then return 'teig'; end if;
    if not intern.connector_zahl(d->'mehl', 100000) then return 'mehl'; end if;
    if d ? 'modus' and not (jsonb_typeof(d->'modus') = 'string' and d->>'modus' in ('mehl', 'teiglinge')) then
      return 'modus';
    end if;
    if d ? 'teiglinge' and jsonb_typeof(d->'teiglinge') <> 'object' then return 'teiglinge'; end if;
  elsif d ?| array['teig', 'mehl', 'modus', 'teiglinge'] then
    return 'teig';
  end if;
  return null;
end;
$$;

-- Prüft einen neuen Katalogeintrag { id, name, art }. Grund oder null.
-- Die id folgt aus dem Namen (`zutatId` in js/rezepte/katalog.js) – das rechnet die Edge Function.
create or replace function intern.connector_pruefe_zutat(z jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(z) is distinct from 'object' then return 'zutat'; end if;
  if exists (select from jsonb_object_keys(z) k where k not in ('id', 'name', 'art')) then return 'zutat'; end if;
  if jsonb_typeof(z->'id') is distinct from 'string' or z->>'id' !~ '^[a-z0-9]{1,60}$' then return 'id'; end if;
  if not intern.connector_text(z->'name', 80) then return 'name'; end if;
  if z ? 'art' and not (jsonb_typeof(z->'art') = 'string' and z->>'art' in
    ('mehl', 'saat', 'zusatz', 'gemuese', 'obst', 'fleisch', 'milchprodukt', 'gewuerz', 'vorrat', 'sonstiges'))
  then return 'art'; end if;
  return null;
end;
$$;

revoke all on function intern.connector_haushalt() from public, anon, authenticated;
revoke all on function intern.connector_inhalt(jsonb) from public, anon, authenticated;
revoke all on function intern.connector_text(jsonb, integer) from public, anon, authenticated;
revoke all on function intern.connector_zahl(jsonb, numeric) from public, anon, authenticated;
revoke all on function intern.connector_pruefe_rezept(jsonb) from public, anon, authenticated;
revoke all on function intern.connector_pruefe_zutat(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lesen (nur Rezepte und Zutaten des Connector-Haushalts, nie Gelöschtes)
-- ---------------------------------------------------------------------------

create or replace function connector.zutaten_liste()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.daten->>'name') order by d.daten->>'name'), '[]')
  from public.datensaetze d
  where d.haushalt = intern.connector_haushalt() and d.sammlung = 'zutaten' and not d.geloescht
    and jsonb_typeof(d.daten->'name') = 'string';
$$;

-- suche: Teil des Namens (Groß/klein egal) oder genaue id; leer = alle. Höchstens 100 Treffer.
create or replace function connector.rezepte_finden(suche text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'art', z.art,
    'kategorie', z.kategorie, 'ernaehrung', z.ernaehrung, 'version', z.version) order by z.name, z.id), '[]')
  from (
    select d.id, d.daten->>'name' as name, d.daten->>'art' as art, d.daten->>'kategorie' as kategorie,
      d.daten->>'ernaehrung' as ernaehrung, d.version
    from public.datensaetze d
    where d.haushalt = intern.connector_haushalt() and d.sammlung = 'rezepte' and not d.geloescht
      and (coalesce(btrim(suche), '') = ''
        or d.id = lower(btrim(suche))
        or strpos(lower(d.daten->>'name'), lower(btrim(left(suche, 100)))) > 0)
    order by d.daten->>'name', d.id
    limit 100
  ) z;
$$;

create or replace function connector.rezept_lesen(rezept_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', d.id, 'version', d.version, 'daten', intern.connector_inhalt(d.daten))
  from public.datensaetze d
  where d.haushalt = intern.connector_haushalt() and d.sammlung = 'rezepte' and not d.geloescht
    and d.id = rezept_id;
$$;

-- ---------------------------------------------------------------------------
-- Speichern
-- ---------------------------------------------------------------------------
-- Eingabe: { zutaten: [{ id, name, art }], rezepte: [{ id?, basis?, daten }] }
--   zutaten – neue Katalogeinträge; gibt es die id schon, bleibt der Eintrag, wie er ist
--   rezepte – ohne id = neues Rezept; basis = Version, auf der Claude aufbaut (rezept_lesen)
-- Ergebnis: { zutaten: [...], rezepte: [...] } in gleicher Reihenfolge, je Rezept
--   { id, ok: true, version }                      – gespeichert (oder schon genau so vorhanden)
--   { id, ok: false, kopie, version: 1 }           – inzwischen anders geändert: Original bleibt,
--                                                    Claudes Fassung ist die Kopie `kopie` mit Vermerk
--   { id?, ok: false, fehler: 'ungueltig', grund } – nicht gespeichert
-- Nie gelöscht, nie überschrieben ohne passende Version (Ausnahme: ein gelöschtes Rezept wird
-- wieder lebendig – „Ändern gewinnt gegen Löschen“ wie beim Abgleich).

create or replace function connector.rezept_speichern(eingabe jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_haushalt  uuid := intern.connector_haushalt();
  v_jetzt     bigint := floor(extract(epoch from now()) * 1000);
  v_e         jsonb;
  v_grund     text;
  v_id        text;
  v_basis     integer;
  v_inhalt    jsonb;
  v_alt       public.datensaetze%rowtype;
  v_kopie     text;
  v_zusatz    text;
  v_zutaten   jsonb := '[]';
  v_rezepte   jsonb := '[]';
begin
  if jsonb_typeof(eingabe) is distinct from 'object'
    or jsonb_typeof(coalesce(eingabe->'zutaten', '[]')) <> 'array'
    or jsonb_typeof(coalesce(eingabe->'rezepte', '[]')) <> 'array'
  then
    raise exception 'Erwartet: { zutaten: [...], rezepte: [...] }' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(eingabe->'zutaten', '[]')) > 200
    or jsonb_array_length(coalesce(eingabe->'rezepte', '[]')) > 50
  then
    raise exception 'Höchstens 50 Rezepte und 200 Zutaten auf einmal' using errcode = '22023';
  end if;

  -- wie `hochladen`: je Haushalt nacheinander schreiben
  perform pg_advisory_xact_lock(hashtextextended(v_haushalt::text, 0));

  -- Zutaten: nur neu anlegen (oder einen gelöschten Eintrag zurückholen), nie ändern
  for v_e in select e from jsonb_array_elements(coalesce(eingabe->'zutaten', '[]')) e loop
    v_grund := intern.connector_pruefe_zutat(v_e);
    if v_grund is not null then
      v_zutaten := v_zutaten || jsonb_build_array(jsonb_build_object(
        'id', case when jsonb_typeof(v_e) = 'object' then v_e->'id' end, 'ok', false, 'fehler', 'ungueltig', 'grund', v_grund));
      continue;
    end if;
    v_id := v_e->>'id';
    select d.* into v_alt from public.datensaetze d
      where d.haushalt = v_haushalt and d.sammlung = 'zutaten' and d.id = v_id
      for update;
    if found and not v_alt.geloescht then
      v_zutaten := v_zutaten || jsonb_build_array(jsonb_build_object('id', v_id, 'ok', true, 'neu', false));
      continue;
    end if;
    insert into public.datensaetze as d (haushalt, sammlung, id, daten, geloescht, version, stand, geaendert_von)
    values (v_haushalt, 'zutaten', v_id,
            jsonb_build_object('id', v_id, 'name', btrim(v_e->>'name'), 'art', coalesce(v_e->>'art', 'sonstiges'),
              'erstellt', v_jetzt, 'geaendert', v_jetzt, 'geloescht', false),
            false, coalesce(v_alt.version, 0) + 1, nextval('public.datensaetze_stand'), null)
    on conflict (haushalt, sammlung, id) do update set
      daten = excluded.daten, geloescht = false, version = excluded.version, stand = excluded.stand,
      geaendert_von = null, geaendert_am = now();
    v_zutaten := v_zutaten || jsonb_build_array(jsonb_build_object('id', v_id, 'ok', true, 'neu', true));
  end loop;

  -- Rezepte
  for v_e in select e from jsonb_array_elements(coalesce(eingabe->'rezepte', '[]')) e loop
    v_grund := null;
    if jsonb_typeof(v_e) is distinct from 'object'
      or exists (select from jsonb_object_keys(case when jsonb_typeof(v_e) = 'object' then v_e else '{}' end) k
                 where k not in ('id', 'basis', 'daten'))
    then
      v_grund := 'eintrag';
    elsif v_e ? 'id' and not (jsonb_typeof(v_e->'id') = 'string'
      and v_e->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then
      v_grund := 'id';
    elsif v_e ? 'basis' and not (jsonb_typeof(v_e->'basis') = 'number' and v_e->>'basis' ~ '^[0-9]{1,9}$') then
      v_grund := 'basis';
    else
      v_grund := intern.connector_pruefe_rezept(v_e->'daten');
    end if;
    if v_grund is not null then
      v_rezepte := v_rezepte || jsonb_build_array(jsonb_build_object(
        'id', case when jsonb_typeof(v_e) = 'object' then v_e->'id' end, 'ok', false, 'fehler', 'ungueltig', 'grund', v_grund));
      continue;
    end if;

    v_id := coalesce(v_e->>'id', gen_random_uuid()::text);
    v_basis := coalesce((v_e->>'basis')::integer, 0);
    v_inhalt := v_e->'daten';
    select d.* into v_alt from public.datensaetze d
      where d.haushalt = v_haushalt and d.sammlung = 'rezepte' and d.id = v_id
      for update;

    if found and not v_alt.geloescht and intern.connector_inhalt(v_alt.daten) = v_inhalt then
      -- schon genau so vorhanden (z. B. Wiederholung nach Netzfehler): nichts schreiben
      v_rezepte := v_rezepte || jsonb_build_array(jsonb_build_object('id', v_id, 'ok', true, 'version', v_alt.version));

    elsif not found or v_alt.geloescht or v_alt.version = v_basis then
      insert into public.datensaetze as d (haushalt, sammlung, id, daten, geloescht, version, stand, geaendert_von)
      values (v_haushalt, 'rezepte', v_id,
              v_inhalt || jsonb_build_object('id', v_id,
                'erstellt', case when found and jsonb_typeof(v_alt.daten->'erstellt') = 'number'
                                 then v_alt.daten->'erstellt' else to_jsonb(v_jetzt) end,
                'geaendert', v_jetzt, 'geloescht', false),
              false, coalesce(v_alt.version, 0) + 1, nextval('public.datensaetze_stand'), null)
      on conflict (haushalt, sammlung, id) do update set
        daten = excluded.daten, geloescht = false, version = excluded.version, stand = excluded.stand,
        geaendert_von = null, geaendert_am = now();
      v_rezepte := v_rezepte || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'ok', true, 'version', coalesce(v_alt.version, 0) + 1));

    else
      -- Konflikt: Original bleibt, Claudes Fassung wird Kopie „Name (Änderung vom 4.10.)“ mit Vermerk
      -- (wie in js/kern/sync.js). Gibt es dieselbe Kopie schon (Wiederholung), keine zweite.
      v_zusatz := ' (Änderung vom ' || to_char(now() at time zone 'Europe/Berlin', 'FMDD.FMMM.') || ')';
      v_inhalt := jsonb_set(v_inhalt, '{name}', to_jsonb(btrim(left(btrim(regexp_replace(v_inhalt->>'name',
        ' \(Änderung vom \d{1,2}\.\d{1,2}\.\)$', '')), 80 - char_length(v_zusatz))) || v_zusatz));
      select d.id into v_kopie from public.datensaetze d
        where d.haushalt = v_haushalt and d.sammlung = 'rezepte' and not d.geloescht
          and d.daten->'konflikt'->>'von' = v_id and intern.connector_inhalt(d.daten) = v_inhalt
        limit 1;
      if v_kopie is null then
        v_kopie := gen_random_uuid()::text;
        insert into public.datensaetze (haushalt, sammlung, id, daten, geloescht, version, stand, geaendert_von)
        values (v_haushalt, 'rezepte', v_kopie,
                v_inhalt || jsonb_build_object('id', v_kopie, 'erstellt', v_jetzt, 'geaendert', v_jetzt,
                  'geloescht', false, 'konflikt', jsonb_build_object('von', v_id, 'am', v_jetzt)),
                false, 1, nextval('public.datensaetze_stand'), null);
      end if;
      v_rezepte := v_rezepte || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'ok', false, 'kopie', v_kopie, 'version', 1));
    end if;
  end loop;

  return jsonb_build_object('zutaten', v_zutaten, 'rezepte', v_rezepte);
end;
$$;

-- Nur die Connector-Rolle, sonst niemand
revoke all on function connector.zutaten_liste() from public, anon, authenticated;
revoke all on function connector.rezepte_finden(text) from public, anon, authenticated;
revoke all on function connector.rezept_lesen(text) from public, anon, authenticated;
revoke all on function connector.rezept_speichern(jsonb) from public, anon, authenticated;
grant execute on function connector.zutaten_liste() to kochbuch_connector;
grant execute on function connector.rezepte_finden(text) to kochbuch_connector;
grant execute on function connector.rezept_lesen(text) to kochbuch_connector;
grant execute on function connector.rezept_speichern(jsonb) to kochbuch_connector;
