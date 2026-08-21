-- Deve ser executado em ambiente vazio reconstruido pela baseline.
-- Fingerprint da producao capturado em 2026-08-21: 76b69d58b169752390f163928566e021e4ad49ecc5c33a98620c2d5ffbaacd63
-- Objetos considerados: colunas, constraints, indices, policies, funcoes, triggers, views e estado RLS.

with objects as (
  select 'col|'||c.relname||'|'||a.attnum::text||'|'||a.attname||'|'||pg_catalog.format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull::text||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') as s
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind='r'
  union all
  select 'con|'||conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid,true) from pg_constraint where connamespace='public'::regnamespace
  union all select 'idx|'||tablename||'|'||indexname||'|'||indexdef from pg_indexes where schemaname='public'
  union all select 'pol|'||tablename||'|'||policyname||'|'||permissive||'|'||array_to_string(roles,',')||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname='public'
  union all select 'fn|'||p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||p.prosecdef::text||'|'||pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select 'trg|'||c.relname||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid,true) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
  union all select 'view|'||c.relname||'|'||coalesce(array_to_string(c.reloptions,','),'')||'|'||pg_get_viewdef(c.oid,true) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'
  union all select 'rls|'||c.relname||'|'||c.relrowsecurity::text||'|'||c.relforcerowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
)
select encode(digest(string_agg(s,E'\n' order by s),'sha256'),'hex') as schema_fingerprint, count(*) as object_count from objects;
