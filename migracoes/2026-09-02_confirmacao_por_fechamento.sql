-- CONFIRMACAO DE SERVICO: O DOCUMENTO E DO FECHAMENTO, NAO DO SERVICO.
--
-- Diego comparou o PDF que o app gera (commit 706ab37) com o que ele vinha usando -- o
-- Confirmacao_Servico_Ivoneide de 22/08/2026, montado a partir do MODELO_MESTRE_CONFIRMACAO_SERVICO.docx --
-- e o dele era melhor. Nao era gosto: eram duas diferencas estruturais.
--
-- 1) UM FECHAMENTO PODE SER VARIOS SERVICOS. O documento de 22/08 cobre os DOIS servicos da Ivoneide
--    (2 sofas + 3 poltronas) como UM acordo de R$ 4.800,00. No banco sao duas linhas, R$ 2.200 e R$ 2.600.
--    O app emitiria dois papeis, cada um dizendo "TOTAL CONTRATADO" -- e nenhum dos dois e o valor que a
--    cliente combinou. O commit fa5ce49 tratou isso como colisao de NOME DE ARQUIVO; era sintoma. A causa
--    e que fechamento e servico nao sao a mesma coisa.
--
-- 2) O MODELO MESTRE E UM FORMULARIO COM ESPACOS ESCRITOS POR GENTE. Ele tem ROTULO_1..4/DETALHE_1..4
--    livres, e por isso o documento bom diz "Itens: 2 sofas retrateis/reclinaveis + 3 poltronas" e
--    "Acabamentos: reduzir os bracos pela metade". Isso e SINTESE: nenhum campo do banco contem essa frase.
--    O app tentou derivar tudo de campo, nao tinha espaco curado, e acabou despejando `descricao` inteira --
--    que foi exatamente o vazamento de taxa de cartao e preco velho corrigido hoje em a7a56b0. O documento
--    pobre e o vazamento tem a MESMA origem: faltava o espaco curado.
--
-- Decisao de Diego em 02/09/2026, com as duas opcoes na mesa: HIBRIDO. Se o campo curado existir, o
-- documento usa e fica igual ao modelo; se estiver vazio, cai no que o app ja deriva hoje. Comeca
-- funcionando sem depender de ninguem preencher, e melhora sozinho conforme for preenchido.
--
-- NENHUMA das duas colunas tem trava nem default: servico sem elas se comporta exatamente como antes.
--
-- Rollback:
--   alter table public.servicos drop column if exists confirmacao;
--   drop index if exists public.servicos_fechamento_ref_idx;
--   alter table public.servicos drop column if exists fechamento_ref;
-- (o app le os dois campos de forma defensiva -- sem eles o comportamento volta ao de hoje, sem quebrar
--  tela nenhuma.)

alter table public.servicos
  add column if not exists fechamento_ref text;

alter table public.servicos
  add column if not exists confirmacao jsonb;

comment on column public.servicos.fechamento_ref is
  'Agrupa servicos que sao UM acordo so para a Confirmacao de Servico. Servicos com o mesmo valor nao-nulo saem num documento unico, com o valor somado. NULO = o servico e o proprio fechamento (comportamento padrao). Preencher SO quando o cliente combinou os servicos juntos; nunca por semelhanca de nome ou proximidade de data.';

comment on column public.servicos.confirmacao is
  'Texto CURADO da Confirmacao de Servico, no formato do MODELO_MESTRE_CONFIRMACAO_SERVICO.docx. Preenchido por quem fecha (Classic/Diego), nunca derivado. Campo ausente cai no que o app deriva. Shape: {referencia, linhas:[{rotulo,detalhe}] ate 4, prazo, financeiro:[{rotulo,valor,nota}] ate 3, condicao_escolhida, total, status_rotulo, status_resumo}. Os valores sao STRINGS JA FORMATADAS ("R$ 4.800,00") porque sao a frase que vai impressa -- quem escreve responde pelo numero. NAO colocar aqui nada que seja anotacao interna: este texto vai IMPRESSO na mao do cliente.';

-- Num grupo de fechamento, o documento usa a PRIMEIRA confirmacao nao-nula (o app ordena por criado_em).
-- Nao ha necessidade de repetir o mesmo texto em todos os servicos do grupo.
create index if not exists servicos_fechamento_ref_idx
  on public.servicos (fechamento_ref)
  where fechamento_ref is not null;

-- Confere que aplicou.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='servicos'
       and column_name in ('fechamento_ref','confirmacao')) as colunas_criadas_esperado_2,
  (select count(*) from pg_indexes
     where schemaname='public' and indexname='servicos_fechamento_ref_idx') as indice_criado_esperado_1;
