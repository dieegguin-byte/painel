-- ============================================================================
-- MIGRAÇÃO 2026-08-14 — índices de chave estrangeira (item 15 da auditoria)
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
create index if not exists idx_financeiro_servico_id on public.financeiro (servico_id);
create index if not exists idx_financeiro_fornecedor_id on public.financeiro (fornecedor_id);
create index if not exists idx_financeiro_agenda_id on public.financeiro (agenda_id);
-- financeiro.servico_id/fornecedor_id/agenda_id não estavam na lista do Advisor,
-- mas são exatamente os filtros que a aba Compras, a trava de material e o
-- fechamento de entrega fazem a cada operação.

-- Conferência:
select indexname from pg_indexes
where schemaname = 'public' and indexname like 'idx_%'
order by indexname;
