-- CICLO DE COBRANÇA (28/07/2026) — uma coluna só.
-- Contexto: na revisão de 28/07 havia 31 leads parados. Cobrar era tarefa avulsa: Diego cobrava, marcava
-- feito, e não existia "próxima" — o item morria em silêncio (o Francisco levou 4 idas frustradas sem o app
-- avisar). Agora cobrança é ciclo: volta a cada 3 dias, conta as tentativas, e na 3ª o app propõe encerrar.
--
-- O QUANDO da próxima cobrança continua sendo `agenda.data` (fonte única, sem data duplicada).
-- Esta coluna guarda só o CONTADOR, que é o que não existia em lugar nenhum.

ALTER TABLE servicos ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0;

-- Conferência:
-- SELECT id, titulo, status, tentativas, prazo FROM servicos WHERE status IN ('lead','orcamento') ORDER BY prazo;
