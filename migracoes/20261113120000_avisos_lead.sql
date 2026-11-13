-- Leads a resolver (Diego, 13/11/2026: "está faltando Leads a Resolver ... resumo rápido da situação e o WhatsApp").
-- A auditoria das 02h20 passa a gravar em avisos_operacionais UMA linha por lead que espera o Diego: dominio 'lead',
-- referencia_id = id do serviço, aviso = resumo rápido do caso. O Painel mostra essas linhas no card "Leads a resolver"
-- (ver LeadsAResolverCard no nova.html). A trava do dominio tinha lista fechada; aqui ela só ganha 'lead'.
-- Nada é apagado: a trava nova aceita tudo que a velha aceitava. Idempotente (pode rodar de novo).
alter table public.avisos_operacionais drop constraint if exists avisos_operacionais_dominio_check, add constraint avisos_operacionais_dominio_check check (dominio = any (array['agenda', 'financeiro', 'producao', 'compras', 'geral', 'encaixe_rota', 'resumo_manha', 'lead']));
select pg_get_constraintdef(oid) as trava, (select count(*) from public.avisos_operacionais) as linhas from pg_constraint where conname = 'avisos_operacionais_dominio_check';
