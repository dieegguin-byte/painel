-- ============================================================================
-- MIGRAÇÃO 2026-08-14 — P0 de segurança (itens 6 e 7 da auditoria do Drive)
--
-- POR QUE ESTE ARQUIVO EXISTE: o TRAVAS_BANCO.sql era uma coleção de blocos
-- pra copiar e colar, e ninguém sabia o que já tinha rodado. A auditoria de
-- 14/08 achou justamente isso: a TRAVA 8 (print) e o índice agenda_sem_duplicata
-- estão escritos lá e NÃO estão no banco. Daqui pra frente cada mudança de
-- schema vira um arquivo com data em migracoes/, escrito pra poder rodar de
-- novo sem estragar nada (idempotente).
--
-- COMO RODAR: Supabase > SQL Editor > cola o arquivo inteiro > Run.
-- Rodar duas vezes não faz mal.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ: não apaga nada, não muda dado operacional e não
-- altera nenhuma linha de cliente, serviço, agenda ou financeiro.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. RLS na tabela fornecedores (Advisor: "RLS disabled in public")
-- Era a única tabela pública sem RLS: qualquer chave anônima lia e escrevia a
-- lista de fornecedores, telefone de contato incluído. A política é a mesma das
-- outras tabelas — quem está autenticado no app faz tudo, anônimo não faz nada.
-- O (select auth.role()) no lugar de auth.role() é a forma recomendada pelo
-- Supabase: assim o Postgres avalia uma vez por consulta, não uma vez por linha.
-- ----------------------------------------------------------------------------
alter table public.fornecedores enable row level security;

drop policy if exists auth_all on public.fornecedores;
create policy auth_all on public.fornecedores
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- Confere depois de rodar (tem que voltar rowsecurity = true e 1 política):
--   select relrowsecurity from pg_class where relname = 'fornecedores';
--   select polname from pg_policy where polrelid = 'public.fornecedores'::regclass;


-- ----------------------------------------------------------------------------
-- 2. TRAVA 8 — item com print não fecha sem alguém ter aberto o print
-- Está descrita no TRAVAS_BANCO.sql desde 07/08 e nunca foi aplicada. É a trava
-- da REGRA Nº 1: foi assim que o print da Wesliane passou batido em 04/08 e o
-- serviço dela (R$1.650) ficou sem lista de material.
--
-- COMO PASSAR POR ELA (o jeito certo): abrir a imagem, ler nome/telefone/cidade/
-- material/medidas e gravar em `conversa` uma mensagem com meta
-- {"print_lido": true}. Quem confirma pela tela de triagem passa sozinho — o
-- resolveInbox do nova.html carimba isso, porque a galeria está aberta na frente.
-- ----------------------------------------------------------------------------
create or replace function trava_caixa_print_precisa_ser_lido() returns trigger as $$
begin
  if new.processado = true
     and coalesce(old.processado, false) = false
     and new.texto like '%[[TB_INBOX_IMG]]%'
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(new.conversa::jsonb, '[]'::jsonb)) as m
       where (m -> 'meta' ->> 'print_lido') = 'true'
     ) then
    raise exception
      'Este item tem print e nada registra que ele foi aberto. Abra a imagem, leia o que está nela (nome, telefone, cidade, material, medidas) e grave em conversa uma mensagem com meta {"print_lido": true} antes de processar. REGRA Nº 1 — foi assim que o print da Wesliane passou batido em 04/08 e o serviço dela ficou sem material.';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_caixa_print_precisa_ser_lido on public.caixa_entrada;
create trigger trg_caixa_print_precisa_ser_lido
  before insert or update on public.caixa_entrada
  for each row execute function trava_caixa_print_precisa_ser_lido();

-- Pra desfazer, se atrapalhar:
--   drop trigger if exists trg_caixa_print_precisa_ser_lido on public.caixa_entrada;


-- ----------------------------------------------------------------------------
-- 3. search_path fixo nas funções de trava (Advisor: "function_search_path_mutable")
-- Sem search_path fixo, quem chama a função pode trocar o caminho de busca e
-- fazer o Postgres achar outra tabela/função com o mesmo nome. Nas funções que
-- existem justamente pra impedir gravação errada, isso é o buraco no cofre.
-- ----------------------------------------------------------------------------
alter function public.trava_agenda_feito_no_futuro() set search_path = public, pg_temp;
alter function public.trava_caixa_print_precisa_ser_lido() set search_path = public, pg_temp;


-- ----------------------------------------------------------------------------
-- 4. Índice único que impede o mesmo compromisso duas vezes
-- Índice único NÃO aceita NOT VALID: se existir duplicata, a criação falha e o
-- resto da migração para. Por isso o bloco confere antes e avisa em vez de
-- quebrar — se aparecer a mensagem, é pra consolidar as duplicatas primeiro
-- (mudar a errada, nunca apagar — Regra Nº 7) e rodar de novo.
-- Na auditoria de 14/08 não havia duplicata ativa.
-- ----------------------------------------------------------------------------
do $$
declare
  duplicadas int;
begin
  select count(*) into duplicadas from (
    select servico_id, titulo, data
    from public.agenda
    where servico_id is not null
    group by 1, 2, 3
    having count(*) > 1
  ) d;

  if duplicadas > 0 then
    raise notice 'ÍNDICE NÃO CRIADO: existem % combinações de serviço+título+data duplicadas na agenda. Consolide antes e rode de novo.', duplicadas;
  else
    execute 'drop index if exists agenda_sem_duplicata';
    execute 'create unique index agenda_sem_duplicata on public.agenda (servico_id, titulo, data) where servico_id is not null';
    raise notice 'Índice agenda_sem_duplicata criado.';
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 5. Conferência final — o que deve aparecer depois de rodar
-- ----------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'fornecedores') as fornecedores_com_rls,
  (select count(*) from pg_policy where polrelid = 'public.fornecedores'::regclass) as politicas_fornecedores,
  (select count(*) from pg_trigger where tgname = 'trg_caixa_print_precisa_ser_lido') as trava_print,
  (select count(*) from pg_trigger where tgname = 'trg_agenda_feito_no_futuro') as trava_agenda_futuro,
  (select count(*) from pg_indexes where indexname = 'agenda_sem_duplicata') as indice_agenda;
-- Esperado: true, 1, 1, 1, 1
