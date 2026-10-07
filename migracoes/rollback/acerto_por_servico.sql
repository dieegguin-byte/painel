-- DESFAZ 20261006190000_acerto_por_servico.sql
--
-- ⚠ O `drop column` apaga os valores de mão de obra combinada que já tiverem sido anotados.
-- Antes de rodar, guarde-os:
--   select id, titulo, profissional_id, valor_mao_de_obra from public.servicos where valor_mao_de_obra is not null;
-- O app publicado depois de 06/10 lê essa coluna: desfazer o banco sem voltar o app deixa a aba
-- Profissionais sem o combinado (ela continua abrindo, só mostra tudo como "sem valor").

drop view if exists public.v_acerto_profissional;
drop view if exists public.v_acerto_profissional_servico;
alter table public.servicos drop constraint if exists servicos_valor_mao_de_obra_nao_negativo;
alter table public.servicos drop column if exists valor_mao_de_obra;
