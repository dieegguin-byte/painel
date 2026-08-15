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
-- lista de fornecedores, telefone de contato incluído.
--
-- REVISADO EM 15/08 depois da conferência do ChatGPT Work: a primeira versão
-- liberava para o papel `authenticated`, o que bloqueia anônimo mas autoriza
-- QUALQUER usuário autenticado do projeto. Como a decisão de quem pode operar não
-- pode morar num papel genérico, entra uma lista de usuários autorizados e a
-- política pergunta por ela.
--
-- A função é SECURITY DEFINER de propósito: sem isso, consultar a lista de dentro
-- da política da própria lista vira recursão. Ela só devolve verdadeiro/falso.
--
-- ESTA MIGRAÇÃO MEXE SÓ EM fornecedores. Aplicar a mesma política às outras
-- tabelas (item nº 8 da auditoria) é o passo seguinte, depois de confirmar aqui
-- que o app continua lendo e gravando normal — trocar tudo de uma vez arrisca
-- deixar o Diego sem app no meio do expediente.
-- ----------------------------------------------------------------------------
create table if not exists public.usuarios_autorizados (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  criado_em timestamptz not null default now()
);

alter table public.usuarios_autorizados enable row level security;
drop policy if exists autorizado_le_a_si on public.usuarios_autorizados;
create policy autorizado_le_a_si on public.usuarios_autorizados
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Quem opera hoje. Se um dia entrar outra pessoa (ou outra conta do Diego), é
-- uma linha aqui — não é mexer em política.
insert into public.usuarios_autorizados (user_id, email)
select id, email from auth.users where lower(email) = 'dieegguin@gmail.com'
on conflict (user_id) do nothing;

-- TRAVA DE SEGURANÇA DA PRÓPRIA MIGRAÇÃO: se a lista ficar vazia (e-mail
-- diferente do esperado, por exemplo), a política nova trancaria o app inteiro
-- pra fora dos fornecedores. Melhor parar aqui e não aplicar nada.
do $$
begin
  if not exists (select 1 from public.usuarios_autorizados) then
    raise exception 'Nenhum usuário autorizado foi encontrado em auth.users. Confira o e-mail de login antes de aplicar — sem isso a política tranca o app.';
  end if;
end $$;

create or replace function public.usuario_autorizado() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.usuarios_autorizados u where u.user_id = auth.uid());
$$;

alter table public.fornecedores enable row level security;
drop policy if exists auth_all on public.fornecedores;
drop policy if exists operador_autorizado on public.fornecedores;
create policy operador_autorizado on public.fornecedores
  for all
  to authenticated
  using ((select public.usuario_autorizado()))
  with check ((select public.usuario_autorizado()));

-- Confere depois de rodar (tem que voltar rowsecurity = true e 1 política):
--   select relrowsecurity from pg_class where relname = 'fornecedores';
--   select polname from pg_policy where polrelid = 'public.fornecedores'::regclass;
-- E, com a sessão do app aberta, abrir a aba Fornecedores: tem que listar os 10
-- cadastros normalmente. Se vier vazio, desfaça com:
--   drop policy if exists operador_autorizado on public.fornecedores;
--   alter table public.fornecedores disable row level security;


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
-- Índice único NÃO aceita NOT VALID: se existir duplicata, a criação falha.
-- Havendo duplicata, esta migração FALHA de propósito (corrigido em 15/08, a
-- pedido da conferência: antes só emitia aviso, e um aviso no meio de um script
-- longo passa batido — daria pra achar que aplicou tudo quando não aplicou).
-- Se falhar: consolidar as duplicatas primeiro (mudar a errada, nunca apagar —
-- Regra Nº 7) e rodar de novo. Na auditoria de 14/08 não havia duplicata ativa.
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
    raise exception 'ÍNDICE NÃO CRIADO E MIGRAÇÃO INTERROMPIDA: existem % combinações de serviço+título+data duplicadas na agenda. Rode "select servico_id, titulo, data, count(*) from agenda group by 1,2,3 having count(*) > 1", consolide e execute de novo.', duplicadas;
  end if;

  execute 'drop index if exists agenda_sem_duplicata';
  execute 'create unique index agenda_sem_duplicata on public.agenda (servico_id, titulo, data) where servico_id is not null';
end $$;


-- ----------------------------------------------------------------------------
-- 5. Conferência final — o que deve aparecer depois de rodar
-- ----------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'fornecedores') as fornecedores_com_rls,
  (select count(*) from pg_policy where polrelid = 'public.fornecedores'::regclass) as politicas_fornecedores,
  (select count(*) from public.usuarios_autorizados) as operadores_autorizados,
  (select count(*) from pg_trigger where tgname = 'trg_caixa_print_precisa_ser_lido') as trava_print,
  (select count(*) from pg_trigger where tgname = 'trg_agenda_feito_no_futuro') as trava_agenda_futuro,
  (select count(*) from pg_indexes where indexname = 'agenda_sem_duplicata') as indice_agenda;
-- Esperado: true, 1, 1, 1, 1, 1


-- ----------------------------------------------------------------------------
-- 6. CONFERÊNCIA MANUAL, fora do SQL (item nº 8 da auditoria)
-- No painel do Supabase: Authentication > Providers > Email, conferir que o
-- cadastro público (Allow new users to sign up) está DESLIGADO. O app já usa
-- shouldCreateUser:false, mas isso é só a tela — quem chama a API direto ignora.
-- ----------------------------------------------------------------------------
