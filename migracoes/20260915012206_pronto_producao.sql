-- PRONTO é produção concluída, sem entrega nem efeito financeiro.
-- DDL idempotente; dados operacionais são corrigidos separadamente após publicação.
set lock_timeout = '5s';
alter table public.servicos drop constraint if exists servicos_status_check;
alter table public.servicos add constraint servicos_status_check
  check (status in ('lead','orcamento','agendado','producao','pronto','entregue','pago','perdido'));

-- Preservar as proteções vigentes de cliente/WhatsApp para o novo estado ativo.
-- Reutilizar a definição real mantém atributos, privilégios e corpo não relacionado.
do $$
declare fn regprocedure; ddl text;
begin
  foreach fn in array array[
    'private.trg_servico_exige_whatsapp()'::regprocedure,
    'private.trg_cliente_preserva_whatsapp_ativo()'::regprocedure
  ] loop
    ddl := pg_get_functiondef(fn);
    if position('''pronto''' in ddl) = 0 then
      if position('''lead'',''orcamento'',''agendado'',''producao''' in ddl) = 0 then
        raise exception 'Definição de % mudou: revisar antes de migrar', fn;
      end if;
      execute replace(ddl, '''lead'',''orcamento'',''agendado'',''producao''',
                          '''lead'',''orcamento'',''agendado'',''producao'',''pronto''');
    end if;
  end loop;
end $$;

select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.servicos'::regclass and conname = 'servicos_status_check';

-- Reversão de aplicação: reverter o commit de nova.html somente depois de resolver
-- cada serviço pronto; não reclassificar fatos posteriores automaticamente.
-- A extensão do CHECK e das proteções pode permanecer: é retrocompatível.
-- Reversão estrita do schema (somente se não existir nenhum status pronto):
-- 1. Em transação, exigir NOT EXISTS (SELECT 1 FROM public.servicos WHERE status='pronto').
-- 2. Restaurar o CHECK acima sem 'pronto' e remover ,'pronto' das duas listas das funções.
-- Nenhum registro, coluna, histórico, vínculo, agenda ou financeiro é excluído.
