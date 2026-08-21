-- Teste adversarial do hardening V4. Executar somente em DEV/STAGING.

-- Autorizado deve ver fixtures, escrever e nao ter TRUNCATE.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
begin
  if not public.usuario_autorizado() then raise exception 'usuario fixture deveria estar autorizado'; end if;
  if (select count(*) from public.clientes) <> 2 then raise exception 'autorizado nao enxerga clientes esperados'; end if;
  if has_table_privilege('authenticated','public.clientes','TRUNCATE') then raise exception 'authenticated nao pode ter TRUNCATE'; end if;
  insert into public.clientes(id,nome,telefone,cidade)
  values ('abababab-abab-4bab-8bab-abababababab','Teste RLS autorizado','5561998123456','Luziânia');
  if not exists(select 1 from public.clientes where id='abababab-abab-4bab-8bab-abababababab') then raise exception 'insert autorizado falhou'; end if;
end $$;
rollback;

-- Nao autorizado deve ver zero linhas e INSERT precisa falhar.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$
begin
  if public.usuario_autorizado() then raise exception 'usuario desconhecido nao pode estar autorizado'; end if;
  if exists(select 1 from public.clientes) then raise exception 'nao autorizado enxergou clientes'; end if;
  if exists(select 1 from public.servicos) then raise exception 'nao autorizado enxergou servicos'; end if;
  if exists(select 1 from public.marketing_atribuicoes) then raise exception 'nao autorizado enxergou marketing'; end if;
  begin
    insert into public.clientes(id,nome,telefone,cidade)
    values ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd','NAO DEVE ENTRAR','5561999123456','Luziânia');
    raise exception 'insert nao autorizado passou indevidamente';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;

select 'rls hardening: ok' as result;
