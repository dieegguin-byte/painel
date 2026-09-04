-- REALTIME NAS DEMAIS TABELAS QUE O APP LE (04/09/2026, pedido de Diego "arruma tudo que for preciso").
--
-- ESCOLHIDAS POR MEDICAO, nao por palpite. Gravacoes nos ultimos 7 dias:
--   financeiro 42 · agenda 34 · clientes 14 · servicos 13 · caixa_entrada 11 · pessoais 8
--   fornecedores 1 · estoque_movimentos 0 · rotinas 0
--
-- Entram as seis de cima + `avisos_operacionais` (nova, e o Classic vai escrever nela).
--
-- FICAM DE FORA de proposito: `fornecedores`, `rotinas`, `estoque`/`estoque_movimentos`, `distancias`,
-- `profissionais` e `dividas` -- entre 0 e 1 gravacao por semana. Publicar tabela parada nao deixa o app
-- mais vivo, so poe mais uma inscricao no socket de um celular que trabalha no 4G e as vezes sem sinal.
-- Elas continuam chegando pelo botao Atualizar e pela recarga de primeiro plano.
--
-- Tambem ficam de fora as tabelas que o app NAO le (push_*, amostras_*, marketing_atribuicoes,
-- github_change_requests): evento que ninguem consome e so custo.
--
-- REPLICA IDENTITY continua no DEFAULT em todas: o app usa o evento apenas como gatilho pra reler a
-- carga inteira, entao nunca precisa do valor antigo das colunas.
alter publication supabase_realtime add table public.servicos;
alter publication supabase_realtime add table public.financeiro;
alter publication supabase_realtime add table public.caixa_entrada;
alter publication supabase_realtime add table public.clientes;
alter publication supabase_realtime add table public.pessoais;
alter publication supabase_realtime add table public.avisos_operacionais;
