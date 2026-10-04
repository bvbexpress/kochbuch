-- connector-pruefen.sql – Was darf die Connector-Rolle? (nur lesen, ändert nichts)
--
-- Im Supabase-Dashboard unter „SQL Editor“ ausführen, nachdem schema.sql gelaufen ist.
-- Erwartet: genau vier Zeilen, alle „funktion“ im Schema `connector`:
--   connector.rezept_lesen, connector.rezept_speichern, connector.rezepte_finden, connector.zutaten_liste
-- Jede weitere Zeile (Tabelle oder Funktion) bitte melden.
-- tests/datenbank.test.js führt dieselbe Datei aus.

select 'funktion' as art, n.nspname || '.' || p.proname as name
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and has_schema_privilege('kochbuch_connector', n.oid, 'usage')
  and has_function_privilege('kochbuch_connector', p.oid, 'execute')
union all
select 'tabelle', n.nspname || '.' || c.relname
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'v', 'm', 'p', 'f', 'S') and n.nspname not in ('pg_catalog', 'information_schema')
  and (has_table_privilege('kochbuch_connector', c.oid, 'select')
    or has_table_privilege('kochbuch_connector', c.oid, 'insert')
    or has_table_privilege('kochbuch_connector', c.oid, 'update')
    or has_table_privilege('kochbuch_connector', c.oid, 'delete')
    or has_table_privilege('kochbuch_connector', c.oid, 'truncate'))
order by 1, 2;
