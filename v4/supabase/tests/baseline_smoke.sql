-- Smoke tests estruturais e de seed.
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relkind='r';
  if n <> 16 then raise exception 'esperadas 16 tabelas public, encontradas %', n; end if;
  select count(*) into n from pg_policies where schemaname='public';
  if n <> 15 then raise exception 'esperadas 15 policies, encontradas %', n; end if;
  select count(*) into n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and not t.tgisinternal;
  if n <> 5 then raise exception 'esperados 5 triggers, encontrados %', n; end if;
  if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname='vw_marketing_funil' and c.relkind='v') then raise exception 'view vw_marketing_funil ausente'; end if;
  if not exists (select 1 from public.clientes where id='11111111-1111-4111-8111-111111111111') then raise exception 'seed de clientes ausente'; end if;
  if not exists (select 1 from public.servicos where id='44444444-4444-4444-8444-444444444444' and status='orcamento') then raise exception 'seed de servico ausente'; end if;
  if not exists (select 1 from public.financeiro where id='77777777-7777-4777-8777-777777777777' and tipo='entrada' and escopo='empresa' and status='pago') then raise exception 'seed financeiro ausente'; end if;
end $$;
select 'baseline smoke: ok' as result;
