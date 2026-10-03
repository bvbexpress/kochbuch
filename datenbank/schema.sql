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
