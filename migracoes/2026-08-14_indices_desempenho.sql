-- ============================================================================
-- MIGRAÇÃO 2026-08-14 — índices de chave estrangeira (item 15 da auditoria)
-- Aplicada em 17/08/2026. Ver nota de revisão no fim do arquivo.
--
-- SEPARADA DE PROPÓSITO: mudança de desempenho não anda junto com correção de
-- integridade. Se alguma coisa piorar, dá pra desfazer só esta parte.
--
-- O Advisor do Supabase apontou chaves estrangeiras sem índice. Na prática, sem
-- índice o Postgres varre a tabela inteira toda vez que alguém pede "os
-- compromissos deste serviço" ou "as fotos deste cliente". Com 243 linhas de
-- agenda isso não dói; a conta cresce junto com o histórico, e o app carrega
-- essas listas em toda abertura de tela.
--
-- CONCURRENTLY ficou de fora porque o SQL Editor roda dentro de uma transação e
-- não aceita. As tabelas são pequenas, o lock é de instantes.
-- ============================================================================

create index if not exists idx_agenda_servico_id on public.agenda (servico_id);
create index if not exists idx_servicos_cliente_id on public.servicos (cliente_id);
create index if not exists idx_fotos_cliente_id on public.fotos (cliente_id);
create index if not exists idx_fotos_servico_id on public.fotos (servico_id);

-- dividas nasceu depois da auditoria e entrou com as duas chaves sem índice.
create index if not exists idx_dividas_cliente_id on public.dividas (cliente_id);
create index if not exists idx_dividas_fornecedor_id on public.dividas (fornecedor_id);

-- ----------------------------------------------------------------------------
-- REVISÃO 17/08/2026 — financeiro saiu desta lista
--
-- A versão original criava também idx_financeiro_servico_id, _fornecedor_id e
-- _agenda_id. A tabela JÁ tinha os três, com outro nome (financeiro_servico_id_idx,
-- financeiro_fornecedor_id_idx, financeiro_agenda_id_idx) — a conferência de 14/08
-- não os viu porque filtrava por `indexname like 'idx_%'`. Rodando assim, o banco
-- ficou com três pares de índices idênticos, que só custam escrita e disco.
--
-- Foram criados e removidos no mesmo dia (migração
-- `indices_desempenho_corrige_duplicatas_e_dividas`), ficando os originais. Por
-- isso este arquivo não menciona mais financeiro: o índice que faltava era zero.
--
-- Lição pro próximo: conferir índice por COLUNA (pg_index / pg_constraint), nunca
-- por prefixo de nome.
-- ----------------------------------------------------------------------------

-- Conferência — toda chave estrangeira do schema com pelo menos um índice que
-- comece pela coluna dela. `tem_indice` = 0 em qualquer linha significa que
-- faltou alguma coisa.
select c.conrelid::regclass::text as tabela,
       c.conname                  as chave_estrangeira,
       (select count(*) from pg_index i
         where i.indrelid = c.conrelid
           and (i.indkey::int2[])[0] = c.conkey[1]) as tem_indice
from pg_constraint c
where c.contype = 'f' and c.connamespace = 'public'::regnamespace
order by 1, 2;
