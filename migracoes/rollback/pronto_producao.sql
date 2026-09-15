-- Reversão estrita. Exige que a prontidão de cada serviço tenha sido preservada
-- ou resolvida explicitamente antes. Nunca converter todos para produção.
begin;
set local lock_timeout = '5s';
lock table public.servicos in share row exclusive mode;
do $$ begin
  if exists (select 1 from public.servicos where status = 'pronto') then
    raise exception 'Há serviços prontos. Não é seguro remover sua representação.';
  end if;
end $$;
alter table public.servicos drop constraint if exists servicos_status_check;
alter table public.servicos add constraint servicos_status_check
  check (status in ('lead','orcamento','agendado','producao','entregue','pago','perdido'));
do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'private.trg_servico_exige_whatsapp()'::regprocedure,
    'private.trg_cliente_preserva_whatsapp_ativo()'::regprocedure
  ] loop
    execute replace(pg_get_functiondef(fn),
      '''lead'',''orcamento'',''agendado'',''producao'',''pronto''',
      '''lead'',''orcamento'',''agendado'',''producao''');
  end loop;
end $$;
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.servicos'::regclass and conname = 'servicos_status_check';
commit;
